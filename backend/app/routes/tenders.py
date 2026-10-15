# Tender/award CRUD, search and combined filters 

# Features this file covers:
# - Create, view, edit and delete tenders and their supplier awards.
# - Search tenders by tender number or description, and awards by supplier or tender number.
# - Filter by agency, status, supplier, award date range and amount range, with sorting.
# - Run each request against the database selected in the website header.

# Routes (GET reads, POST creates, PATCH edits and DELETE removes records):
#   /api/system/tenders                         tender list and create
#   /api/system/tenders/options                 agency and status dropdown choices
#   /api/system/tenders/suppliers               supplier name lookup for the award form
#   /api/system/tenders/{tender_no}             one tender: read, edit, delete
#   /api/system/tenders/{tender_no}/awards      add an award; /{award_id} edits or deletes it
#   /api/system/tender-awards                   flat award list across all tenders

# How the two databases store the same data:
# - MariaDB: Tender rows link to GovernmentAgency by agency_id; TenderAward rows link a
#   Tender to a Supplier by ID. Deleting a tender cascades to its awards.
# - MongoDB: one tenders document per tender (_id is the tender number) holding the agency
#   name and an embedded awards array. The collection validator requires a tender with no
#   awards to carry a no_award_record instead. Award IDs are their source_record numbers.

# Import libraries.
from contextlib import contextmanager
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
import logging
import re
from typing import Annotated, Literal

import mariadb
from bson.decimal128 import Decimal128
from fastapi import APIRouter, HTTPException, Path, Query, Request, Response
from pydantic import Field, field_validator, model_validator
from pymongo.collation import Collation
from pymongo.errors import ConnectionFailure, DuplicateKeyError, PyMongoError

from ..databases import connect_mariadb
from .companies import CleanModel, day, envelope, execute, fail, invalid, label, mongo_day, sqlrows

# Set the shared URL prefix and the allowed database choices.
router = APIRouter(prefix="/api/system", tags=["system-tenders"])
Database = Annotated[Literal["mariadb", "mongodb"], Query()]
TenderNo = Annotated[str, Path(min_length=1, max_length=100)]
AwardId = Annotated[str, Path(pattern=r"^[0-9]{1,10}$")]
Money = Annotated[Decimal | None, Query(ge=0)]
logger = logging.getLogger(__name__)

# A tender with this status has no supplier awards, so awards cannot be attached to it.
NO_SUPPLIERS = "Awarded to No Suppliers"

# GeBIZ data starts in 2021, so award dates before 2000 are treated as typing mistakes.
EARLIEST_AWARD = date(2000, 1, 1)

# DECIMAL(18,2) in MariaDB: at most 16 digits before the decimal point.
MAX_AMOUNT = Decimal("9999999999999999.99")
CENTS = Decimal("0.01")

# Supplier names match and sort without regard to case, like the MariaDB collation.
CASE_INSENSITIVE = Collation(locale="en", strength=2)

# Sort choices offered by the list screens, mapped to SQL ORDER BY and MongoDB $sort.
TENDER_SORTS = {
    "date_desc": ("t.award_date DESC, t.tender_no", {"award_date": -1, "_id": 1}),
    "date_asc": ("t.award_date, t.tender_no", {"award_date": 1, "_id": 1}),
    "amount_desc": ("total_amount DESC, t.tender_no", {"total_amount": -1, "_id": 1}),
    "amount_asc": ("total_amount, t.tender_no", {"total_amount": 1, "_id": 1}),
    "tender_no": ("t.tender_no", {"_id": 1}),
}
AWARD_SORTS = {
    "date_desc": ("t.award_date DESC, t.tender_no, a.award_id", {"award_date": -1, "tender_no": 1, "source_record": 1}),
    "date_asc": ("t.award_date, t.tender_no, a.award_id", {"award_date": 1, "tender_no": 1, "source_record": 1}),
    "amount_desc": ("a.awarded_amt DESC, a.award_id", {"amount": -1, "source_record": 1}),
    "amount_asc": ("a.awarded_amt, a.award_id", {"amount": 1, "source_record": 1}),
    "supplier": ("s.supplier_name_raw, a.award_id", {"supplier": 1, "source_record": 1}),
}

# Validate one supplier award: an existing supplier name and a non-negative amount.
class AwardInput(CleanModel):
    supplier: str = Field(min_length=1, max_length=500)
    amount: Decimal

    # Keep amounts within DECIMAL(18,2) and store them with exactly two decimal places.
    @field_validator("amount")
    @classmethod
    def realistic_amount(cls, value):
        if not value.is_finite() or value < 0 or value > MAX_AMOUNT or value.as_tuple().exponent < -2:
            invalid("invalid_amount", "The awarded amount must be 0 or more, with at most 2 decimal places.")
        return value.quantize(CENTS)

# Fields sent by the edit-tender form; the tender number cannot be edited.
class TenderInput(CleanModel):
    description: str = Field(min_length=1, max_length=2000)
    agency: str = Field(min_length=1, max_length=255)
    status: str = Field(min_length=1, max_length=100)
    award_date: date

    # An award date cannot be in the future or earlier than any real GeBIZ record.
    @field_validator("award_date")
    @classmethod
    def realistic_date(cls, value):
        if not EARLIEST_AWARD <= value <= date.today():
            invalid("invalid_award_date", "The award date must be between 2000-01-01 and today.")
        return value

# Create-tender form: also requires a tender number and accepts the first awards.
class TenderCreate(TenderInput):
    tender_no: str = Field(min_length=1, max_length=100)
    awards: list[AwardInput] = Field(default_factory=list, max_length=200)

    # Every imported tender number is uppercase letters and digits, for example ACR000ETT21000001.
    @field_validator("tender_no")
    @classmethod
    def official_number(cls, value):
        value = value.upper()
        if not re.fullmatch(r"[A-Z0-9]+", value):
            invalid("invalid_tender_no", "The tender number may only contain letters and digits, for example ACR000ETT21000001.")
        return value

    # A no-supplier tender cannot list awards, and each supplier appears once per tender.
    @model_validator(mode="after")
    def consistent_awards(self):
        if self.status == NO_SUPPLIERS and self.awards:
            invalid("awards_not_allowed", f"A tender marked '{NO_SUPPLIERS}' cannot have awards.")
        names = [award.supplier.casefold() for award in self.awards]
        if len(names) != len(set(names)):
            invalid("duplicate_supplier", "Each supplier can only be awarded once per tender.")
        return self

# Open the selected store; commit SQL writes or roll back failed requests.
@contextmanager
def store(request, database):
    handle = None
    try:
        if database == "mariadb":
            handle = connect_mariadb(request.app.state.settings)
        else:
            handle = request.app.state.mongodb_client[request.app.state.settings.mongodb_db_name]

        # Give the route its database handle. The code after yield runs when it finishes.
        yield handle

        # Commit only after the route succeeds; failed SQL writes are rolled back below.
        if database == "mariadb":
            handle.commit()

    except HTTPException:
        if database == "mariadb" and handle is not None:
            handle.rollback()
        raise

    # Translate driver exceptions into messages the frontend can show safely.
    except (DuplicateKeyError, mariadb.IntegrityError):
        if database == "mariadb" and handle is not None:
            handle.rollback()
        fail(409, "conflict", "This tender number already exists or the record is used by other data.")

    except (mariadb.OperationalError, mariadb.InterfaceError, ConnectionFailure):
        fail(503, "database_unavailable", "The selected database could not be reached.")

    except (mariadb.Error, PyMongoError) as error:
        if database == "mariadb" and handle is not None:
            handle.rollback()
        logger.warning("Tender operation failed (%s)", type(error).__name__)
        fail(500, "database_error", "The database could not complete the request.")

    finally:
        if database == "mariadb" and handle is not None:
            handle.close()

# Format a SQL Decimal or MongoDB Decimal128 as a two-decimal string; JSON numbers would lose cents.
def money(value):
    if isinstance(value, Decimal128):
        value = value.to_decimal()
    return f"{Decimal(value or 0).quantize(CENTS)}"

# Convert a Decimal to the Decimal128 type the MongoDB validator requires for amounts.
def mongo_money(value):
    return Decimal128(str(value))

# Escape SQL wildcards so user search text is matched literally.
def like(value):
    return "%" + value.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%"

# Case-insensitive "contains" match for MongoDB, treating user text literally.
def contains(value):
    return {"$regex": re.escape(value), "$options": "i"}

# Reject reversed date or amount ranges before making a database query.
def check_ranges(award_from, award_to, min_amount, max_amount):
    if award_from and award_to and award_from > award_to:
        fail(422, "invalid_dates", "The start date must be on or before the end date.")
    if min_amount is not None and max_amount is not None and min_amount > max_amount:
        fail(422, "invalid_amounts", "The minimum amount must not be more than the maximum amount.")

# MongoDB stores award dates as midnight datetimes; use an exclusive next-day upper bound.
def mongo_date_bounds(award_from, award_to):
    bounds = {}
    if award_from:
        bounds["$gte"] = mongo_day(award_from)
    if award_to:
        bounds["$lt"] = mongo_day(award_to) + timedelta(days=1)
    return bounds

# Shape one page of results with the total so the frontend can show page counts.
def page_of(items, total, page, limit):
    return {"items": items, "total": total, "page": page, "limit": limit,
            "has_more": (page - 1) * limit + len(items) < total}

# Expose a MongoDB tender document in the same shape as the SQL rows.
def mongo_tender(doc):
    awards = sorted(doc.get("awards") or [], key=lambda a: a["source_record"])
    items = [{"id": str(a["source_record"]), "supplier": a["supplier_id"], "amount": money(a["amount"])} for a in awards]
    return {"tender_no": doc["_id"], "description": doc.get("description"), "agency": doc.get("agency_name"),
            "status": doc.get("status"), "award_date": day(doc.get("award_date")), "awards": items,
            "award_count": len(items), "total_amount": money(sum(Decimal(a["amount"]) for a in items))}

# Look up one tender and its awards in the selected database, or raise 404 if it is missing.
# Tender numbers are stored in uppercase, so lowercase links behave the same in both databases.
def read(db, database, tender_no):
    tender_no = tender_no.strip().upper()
    if database == "mongodb":
        doc = db.tenders.find_one({"_id": tender_no})
        if doc is not None:
            return mongo_tender(doc)
    else:
        rows = sqlrows(db, "SELECT t.tender_id, t.tender_no, t.tender_description, t.tender_status, t.award_date, g.agency_name "
                           "FROM Tender t JOIN GovernmentAgency g ON g.agency_id=t.agency_id WHERE t.tender_no=?", (tender_no,))
        if rows:
            row = rows[0]
            awards = sqlrows(db, "SELECT a.award_id, s.supplier_name_raw, a.awarded_amt FROM TenderAward a "
                                 "JOIN Supplier s ON s.supplier_id=a.supplier_id WHERE a.tender_id=? ORDER BY a.award_id", (row["tender_id"],))
            items = [{"id": str(a["award_id"]), "supplier": a["supplier_name_raw"], "amount": money(a["awarded_amt"])} for a in awards]
            return {"tender_no": row["tender_no"], "description": row["tender_description"], "agency": row["agency_name"],
                    "status": row["tender_status"], "award_date": day(row["award_date"]), "awards": items,
                    "award_count": len(items), "total_amount": money(sum(a["awarded_amt"] for a in awards))}

    fail(404, "tender_not_found", f"The tender was not found in {label(database)}.")

# Lock and return the SQL tender_id so award writes cannot race with a delete of the same tender.
def lock_tender(db, tender_no):
    rows = sqlrows(db, "SELECT tender_id FROM Tender WHERE tender_no=? FOR UPDATE", (tender_no,))
    if not rows:
        fail(404, "tender_not_found", "The tender no longer exists.")
    return rows[0]["tender_id"]

# Return the agency names used for the dropdown.
# MariaDB keeps an agency table; MongoDB stores the agency name on each tender.
def agency_names(db, database):
    if database == "mongodb":
        values = db.tenders.distinct("agency_name")
    else:
        values = [row["agency_name"] for row in sqlrows(db, "SELECT agency_name FROM GovernmentAgency")]
    return sorted((v for v in values if isinstance(v, str) and v.strip()), key=str.casefold)

# Return the tender statuses used in the data, for the dropdown and for validation.
def tender_statuses(db, database):
    if database == "mongodb":
        values = db.tenders.distinct("status")
    else:
        values = [row["tender_status"] for row in sqlrows(db, "SELECT DISTINCT tender_status FROM Tender WHERE tender_status IS NOT NULL")]
    return sorted(v for v in values if isinstance(v, str) and v.strip())

# Reject a status outside the GeBIZ vocabulary, unless the tender already has it.
def check_status(db, database, status, current=None):
    if status != current and status not in tender_statuses(db, database):
        fail(422, "invalid_status", f"Choose a tender status that exists in {label(database)}.")

# Find an existing agency and return (MariaDB agency_id or None, stored agency name).
def resolve_agency(db, database, name):
    if database == "mongodb":
        match = next((a for a in agency_names(db, database) if a.casefold() == name.casefold()), None)
        if match:
            return None, match
    else:
        rows = sqlrows(db, "SELECT agency_id, agency_name FROM GovernmentAgency WHERE agency_name=?", (name,))
        if rows:
            return rows[0]["agency_id"], rows[0]["agency_name"]
    fail(422, "unknown_agency", f"Choose a government agency that exists in {label(database)}.")

# Find an existing supplier and return (MariaDB supplier_id or MongoDB _id, stored supplier name).
# An exact match wins; otherwise the name may differ only in letter case.
def resolve_supplier(db, database, name):
    if database == "mongodb":
        doc = db.suppliers.find_one({"_id": name}, {"_id": 1}) or db.suppliers.find_one({"_id": name}, {"_id": 1}, collation=CASE_INSENSITIVE)
        if doc:
            return doc["_id"], doc["_id"]
    else:
        rows = sqlrows(db, "SELECT supplier_id, supplier_name_raw FROM Supplier WHERE supplier_name_raw=?", (name,))
        if rows:
            return rows[0]["supplier_id"], rows[0]["supplier_name_raw"]
    fail(422, "unknown_supplier", f"Supplier '{name}' does not exist in {label(database)}. Choose a name from the supplier list.")

# Next unused MongoDB source_record number across all award and no-award records.
def next_source_record(db):
    result = list(db.tenders.aggregate([
        {"$project": {"records": {"$concatArrays": ["$awards.source_record",
            {"$cond": [{"$eq": ["$no_award_record", None]}, [], ["$no_award_record.source_record"]]}]}}},
        {"$unwind": "$records"},
        {"$group": {"_id": None, "last": {"$max": "$records"}}}]))
    return (result[0]["last"] if result else 0) + 1

# Reject a second award for the same supplier on one tender.
def check_duplicate_supplier(tender, supplier, ignore_id=None):
    if any(a["supplier"].casefold() == supplier.casefold() and a["id"] != ignore_id for a in tender["awards"]):
        fail(409, "duplicate_supplier", "This supplier already has an award on this tender. Edit that award instead.")

# Raise 404 unless the requested award belongs to this tender.
def find_award(tender, award_id):
    award = next((a for a in tender["awards"] if a["id"] == award_id), None)
    if award is None:
        fail(404, "award_not_found", "The award was not found on this tender.")
    return award

# ---------------------------------------------------------------- tender routes --

# Agencies and statuses for the dropdowns, read from the selected database.
@router.get("/tenders/options")
def tender_options(request: Request, database: Database):
    with store(request, database) as db:
        return envelope({"agencies": agency_names(db, database), "statuses": tender_statuses(db, database)}, database)

# Supplier names containing the typed text, for the award form's suggestion list.
@router.get("/tenders/suppliers")
def supplier_lookup(request: Request, database: Database, q: str = Query(min_length=2, max_length=500)):
    text = q.strip()
    with store(request, database) as db:
        if database == "mongodb":
            names = [d["_id"] for d in db.suppliers.find({"_id": contains(text)}, {"_id": 1}).collation(CASE_INSENSITIVE).sort("_id", 1).limit(20)]
        else:
            names = [r["supplier_name_raw"] for r in sqlrows(db, "SELECT supplier_name_raw FROM Supplier WHERE supplier_name_raw LIKE ? ESCAPE '!' "
                                                                 "ORDER BY supplier_name_raw LIMIT 20", (like(text),))]
        return envelope({"items": names}, database)

# Search tenders and apply all supplied filters together. Returns one numbered page with a total.
@router.get("/tenders")
def list_tenders(request: Request, database: Database, q: str = Query(default="", max_length=500),
                 agency: str = Query(default="", max_length=255), status: str = Query(default="", max_length=100),
                 supplier: str = Query(default="", max_length=500),
                 award_from: date | None = None, award_to: date | None = None,
                 min_amount: Money = None, max_amount: Money = None,
                 sort: Literal[tuple(TENDER_SORTS)] = "date_desc",
                 page: int = Query(default=1, ge=1, le=100000), limit: int = Query(default=25, ge=1, le=100)):

    check_ranges(award_from, award_to, min_amount, max_amount)
    text, agency, status, supplier = q.strip(), agency.strip(), status.strip(), supplier.strip()
    offset = (page - 1) * limit
    sql_order, mongo_order = TENDER_SORTS[sort]

    # Combine filters with AND; search text matches the tender number or description.
    with store(request, database) as db:
        if database == "mongodb":
            filters = []
            if text:
                filters.append({"$or": [{"_id": contains(text)}, {"description": contains(text)}]})
            if agency:
                filters.append({"agency_name": agency})
            if status:
                filters.append({"status": status})
            if supplier:
                filters.append({"awards.supplier_id": contains(supplier)})
            bounds = mongo_date_bounds(award_from, award_to)
            if bounds:
                filters.append({"award_date": bounds})

            # Total awarded amount is calculated per tender, then filtered like the SQL subquery.
            amount = {}
            if min_amount is not None:
                amount["$gte"] = mongo_money(min_amount)
            if max_amount is not None:
                amount["$lte"] = mongo_money(max_amount)

            pipeline = [{"$match": {"$and": filters} if filters else {}},
                        {"$addFields": {"award_count": {"$size": "$awards"}, "total_amount": {"$sum": "$awards.amount"}}}]
            if amount:
                pipeline.append({"$match": {"total_amount": amount}})

            # One query returns both the requested page and the total match count.
            pipeline.append({"$facet": {
                "items": [{"$sort": mongo_order}, {"$skip": offset}, {"$limit": limit},
                          {"$project": {"awards": 0, "no_award_record": 0}}],
                "total": [{"$count": "n"}]}})
            result = next(db.tenders.aggregate(pipeline, maxTimeMS=30000))
            total = result["total"][0]["n"] if result["total"] else 0
            items = [{"tender_no": d["_id"], "description": d["description"], "agency": d["agency_name"],
                      "status": d["status"], "award_date": day(d["award_date"]), "award_count": d["award_count"],
                      "total_amount": money(d["total_amount"])} for d in result["items"]]

        else:
            # SQL WHERE conditions and bound values are built separately.
            clauses, params = [], []
            if text:
                clauses.append("(t.tender_no LIKE ? ESCAPE '!' OR t.tender_description LIKE ? ESCAPE '!')")
                params.extend([like(text), like(text)])
            if agency:
                clauses.append("g.agency_name=?"); params.append(agency)
            if status:
                clauses.append("t.tender_status=?"); params.append(status)
            if supplier:
                # EXISTS keeps each tender once, even when several of its suppliers match.
                clauses.append("EXISTS (SELECT 1 FROM TenderAward sa JOIN Supplier s ON s.supplier_id=sa.supplier_id "
                               "WHERE sa.tender_id=t.tender_id AND s.supplier_name_raw LIKE ? ESCAPE '!')")
                params.append(like(supplier))
            if award_from:
                clauses.append("t.award_date>=?"); params.append(award_from)
            if award_to:
                clauses.append("t.award_date<=?"); params.append(award_to)
            if min_amount is not None:
                clauses.append("COALESCE(x.total_amount,0)>=?"); params.append(min_amount)
            if max_amount is not None:
                clauses.append("COALESCE(x.total_amount,0)<=?"); params.append(max_amount)

            # Award counts and totals come from one grouped subquery joined to each tender.
            source = ("FROM Tender t JOIN GovernmentAgency g ON g.agency_id=t.agency_id "
                      "LEFT JOIN (SELECT tender_id, COUNT(*) AS award_count, SUM(awarded_amt) AS total_amount "
                      "FROM TenderAward GROUP BY tender_id) x ON x.tender_id=t.tender_id"
                      + (" WHERE " + " AND ".join(clauses) if clauses else ""))
            total = sqlrows(db, "SELECT COUNT(*) AS n " + source, tuple(params))[0]["n"]
            rows = sqlrows(db, "SELECT t.tender_no, t.tender_description, t.tender_status, t.award_date, g.agency_name, "
                               "COALESCE(x.award_count,0) AS award_count, COALESCE(x.total_amount,0) AS total_amount "
                               + source + f" ORDER BY {sql_order} LIMIT ? OFFSET ?", (*params, limit, offset))
            items = [{"tender_no": r["tender_no"], "description": r["tender_description"], "agency": r["agency_name"],
                      "status": r["tender_status"], "award_date": day(r["award_date"]), "award_count": int(r["award_count"]),
                      "total_amount": money(r["total_amount"])} for r in rows]

        return envelope(page_of(items, total, page, limit), database)

# Load a tender and its awards for the detail screen.
@router.get("/tenders/{tender_no}")
def get_tender(request: Request, database: Database, tender_no: TenderNo):
    with store(request, database) as db:
        return envelope(read(db, database, tender_no), database)

# Create a tender, optionally with its first awards. Rejects an existing tender number.
@router.post("/tenders", status_code=201)
def create_tender(request: Request, database: Database, body: TenderCreate):
    with store(request, database) as db:
        check_status(db, database, body.status)
        agency_id, agency = resolve_agency(db, database, body.agency)
        suppliers = [resolve_supplier(db, database, award.supplier) for award in body.awards]

        if database == "mongodb":
            # Check first for a clear message; the _id unique index still blocks a race.
            if db.tenders.find_one({"_id": body.tender_no}, {"_id": 1}):
                fail(409, "tender_exists", f"Tender {body.tender_no} already exists in MongoDB.")

            # Awards and the no-award marker are numbered after the last imported source record.
            first = next_source_record(db)
            awards = [{"source_record": first + i, "supplier_id": name, "amount": mongo_money(award.amount)}
                      for i, ((_, name), award) in enumerate(zip(suppliers, body.awards))]
            db.tenders.insert_one({"_id": body.tender_no, "description": body.description, "agency_name": agency,
                "award_date": mongo_day(body.award_date), "status": body.status, "currency": "SGD", "awards": awards,
                "no_award_record": None if awards else {"source_record": first, "amount": mongo_money(Decimal("0.00"))}})

        else:
            # Check first for a clear message; the UNIQUE constraint still blocks a race.
            if sqlrows(db, "SELECT 1 FROM Tender WHERE tender_no=?", (body.tender_no,)):
                fail(409, "tender_exists", f"Tender {body.tender_no} already exists in MariaDB.")

            # The tender and its awards commit together in one transaction.
            tender_id = execute(db, "INSERT INTO Tender (agency_id,tender_no,tender_description,tender_status,award_date) VALUES (?,?,?,?,?)",
                                (agency_id, body.tender_no, body.description, body.status, body.award_date))
            for (supplier_id, _), award in zip(suppliers, body.awards):
                execute(db, "INSERT INTO TenderAward (tender_id,supplier_id,awarded_amt) VALUES (?,?,?)",
                        (tender_id, supplier_id, award.amount))

        return envelope(read(db, database, body.tender_no), database)

# Save the tender form fields. The tender number stays unchanged.
@router.patch("/tenders/{tender_no}")
def update_tender(request: Request, database: Database, tender_no: TenderNo, body: TenderInput):
    with store(request, database) as db:
        tender = read(db, database, tender_no)
        tender_no = tender["tender_no"]
        check_status(db, database, body.status, tender["status"])
        agency_id, agency = resolve_agency(db, database, body.agency)

        if database == "mongodb":
            # A no-supplier status is only saved if the tender still has no awards at write time.
            condition = {"_id": tender_no, **({"awards": {"$size": 0}} if body.status == NO_SUPPLIERS else {})}
            result = db.tenders.update_one(condition, {"$set": {"description": body.description, "agency_name": agency,
                "status": body.status, "award_date": mongo_day(body.award_date)}})
            if not result.matched_count:
                fail(409, "awards_exist", f"Delete this tender's awards before marking it '{NO_SUPPLIERS}'.")

        else:
            # Lock the tender so an award cannot be added while the status changes.
            tender_id = lock_tender(db, tender_no)
            if body.status == NO_SUPPLIERS and sqlrows(db, "SELECT 1 FROM TenderAward WHERE tender_id=? LIMIT 1", (tender_id,)):
                fail(409, "awards_exist", f"Delete this tender's awards before marking it '{NO_SUPPLIERS}'.")
            execute(db, "UPDATE Tender SET tender_description=?,agency_id=?,tender_status=?,award_date=? WHERE tender_id=?",
                    (body.description, agency_id, body.status, body.award_date, tender_id))

        return envelope(read(db, database, tender_no), database)

# Delete a tender. Its awards are removed with it in both databases.
@router.delete("/tenders/{tender_no}", status_code=204)
def delete_tender(request: Request, database: Database, tender_no: TenderNo):
    with store(request, database) as db:
        tender_no = read(db, database, tender_no)["tender_no"]
        if database == "mongodb":
            db.tenders.delete_one({"_id": tender_no})
        else:
            # ON DELETE CASCADE removes the TenderAward rows.
            execute(db, "DELETE FROM Tender WHERE tender_no=?", (tender_no,))

    return Response(status_code=204)

# ----------------------------------------------------------------- award routes --

# Add a supplier award to an existing tender.
@router.post("/tenders/{tender_no}/awards", status_code=201)
def create_award(request: Request, database: Database, tender_no: TenderNo, body: AwardInput):
    with store(request, database) as db:
        tender = read(db, database, tender_no)
        tender_no = tender["tender_no"]
        if tender["status"] == NO_SUPPLIERS:
            fail(409, "awards_not_allowed", f"This tender is marked '{NO_SUPPLIERS}'. Change its status before adding awards.")
        supplier_id, supplier = resolve_supplier(db, database, body.supplier)
        check_duplicate_supplier(tender, supplier)

        if database == "mongodb":
            # Conditional write: the supplier must still be absent and the status unchanged.
            award = {"source_record": next_source_record(db), "supplier_id": supplier, "amount": mongo_money(body.amount)}
            result = db.tenders.update_one(
                {"_id": tender_no, "status": {"$ne": NO_SUPPLIERS}, "awards.supplier_id": {"$ne": supplier}},
                {"$push": {"awards": award}, "$set": {"no_award_record": None}})
            if not result.matched_count:
                fail(409, "tender_changed", "The tender changed while saving. Reload and try again.")

        else:
            tender_id = lock_tender(db, tender_no)
            execute(db, "INSERT INTO TenderAward (tender_id,supplier_id,awarded_amt) VALUES (?,?,?)",
                    (tender_id, supplier_id, body.amount))

        return envelope(read(db, database, tender_no), database)

# Change the supplier or amount of one award on a tender.
@router.patch("/tenders/{tender_no}/awards/{award_id}")
def update_award(request: Request, database: Database, tender_no: TenderNo, award_id: AwardId, body: AwardInput):
    with store(request, database) as db:
        tender = read(db, database, tender_no)
        tender_no = tender["tender_no"]
        find_award(tender, award_id)
        supplier_id, supplier = resolve_supplier(db, database, body.supplier)
        check_duplicate_supplier(tender, supplier, award_id)

        if database == "mongodb":
            # Update only the matching array element; fail if another award now uses the supplier.
            record = int(award_id)
            result = db.tenders.update_one(
                {"_id": tender_no, "$and": [{"awards.source_record": record},
                 {"awards": {"$not": {"$elemMatch": {"supplier_id": supplier, "source_record": {"$ne": record}}}}}]},
                {"$set": {"awards.$[award].supplier_id": supplier, "awards.$[award].amount": mongo_money(body.amount)}},
                array_filters=[{"award.source_record": record}])
            if not result.matched_count:
                fail(409, "tender_changed", "The tender changed while saving. Reload and try again.")

        else:
            tender_id = lock_tender(db, tender_no)
            execute(db, "UPDATE TenderAward SET supplier_id=?,awarded_amt=? WHERE award_id=? AND tender_id=?",
                    (supplier_id, body.amount, award_id, tender_id))

        return envelope(read(db, database, tender_no), database)

# Remove one award without deleting its tender.
@router.delete("/tenders/{tender_no}/awards/{award_id}", status_code=204)
def delete_award(request: Request, database: Database, tender_no: TenderNo, award_id: AwardId):
    with store(request, database) as db:
        tender = read(db, database, tender_no)
        tender_no = tender["tender_no"]
        find_award(tender, award_id)

        if database == "mongodb":
            record = int(award_id)
            if tender["award_count"] == 1:
                # The validator requires a no-award marker once the last award is gone,
                # so both changes happen in one update. The marker keeps the award's record number.
                result = db.tenders.update_one({"_id": tender_no, "awards": {"$size": 1}, "awards.source_record": record},
                    {"$set": {"awards": [], "no_award_record": {"source_record": record, "amount": mongo_money(Decimal("0.00"))}}})
            else:
                result = db.tenders.update_one({"_id": tender_no, "awards.source_record": record, "awards.1": {"$exists": True}},
                                               {"$pull": {"awards": {"source_record": record}}})
            if not result.matched_count:
                fail(409, "tender_changed", "The tender changed while deleting. Reload and try again.")

        else:
            tender_id = lock_tender(db, tender_no)
            execute(db, "DELETE FROM TenderAward WHERE award_id=? AND tender_id=?", (award_id, tender_id))

    return Response(status_code=204)

# Search awards across all tenders: supplier or tender number, plus tender and amount filters.
@router.get("/tender-awards")
def list_awards(request: Request, database: Database, q: str = Query(default="", max_length=500),
                agency: str = Query(default="", max_length=255), status: str = Query(default="", max_length=100),
                award_from: date | None = None, award_to: date | None = None,
                min_amount: Money = None, max_amount: Money = None,
                sort: Literal[tuple(AWARD_SORTS)] = "date_desc",
                page: int = Query(default=1, ge=1, le=100000), limit: int = Query(default=25, ge=1, le=100)):

    check_ranges(award_from, award_to, min_amount, max_amount)
    text, agency, status = q.strip(), agency.strip(), status.strip()
    offset = (page - 1) * limit
    sql_order, mongo_order = AWARD_SORTS[sort]

    with store(request, database) as db:
        if database == "mongodb":
            # Tender-level filters run first, then each embedded award becomes its own row.
            tender_filters = []
            if agency:
                tender_filters.append({"agency_name": agency})
            if status:
                tender_filters.append({"status": status})
            bounds = mongo_date_bounds(award_from, award_to)
            if bounds:
                tender_filters.append({"award_date": bounds})

            award_filters = []
            if text:
                award_filters.append({"$or": [{"_id": contains(text)}, {"awards.supplier_id": contains(text)}]})
            amount = {}
            if min_amount is not None:
                amount["$gte"] = mongo_money(min_amount)
            if max_amount is not None:
                amount["$lte"] = mongo_money(max_amount)
            if amount:
                award_filters.append({"awards.amount": amount})

            # The same award filters before $unwind skip tenders with no matching award at all.
            pipeline = [{"$match": {"$and": tender_filters + award_filters} if tender_filters or award_filters else {}},
                        {"$unwind": "$awards"}]
            if award_filters:
                pipeline.append({"$match": {"$and": award_filters}})
            pipeline += [
                {"$project": {"_id": 0, "tender_no": "$_id", "description": 1, "agency_name": 1, "status": 1, "award_date": 1,
                              "source_record": "$awards.source_record", "supplier": "$awards.supplier_id", "amount": "$awards.amount"}},
                {"$facet": {"items": [{"$sort": mongo_order}, {"$skip": offset}, {"$limit": limit}], "total": [{"$count": "n"}]}}]
            result = next(db.tenders.aggregate(pipeline, maxTimeMS=30000, collation=CASE_INSENSITIVE))
            total = result["total"][0]["n"] if result["total"] else 0
            items = [{"id": str(d["source_record"]), "tender_no": d["tender_no"], "tender_description": d["description"],
                      "agency": d["agency_name"], "status": d["status"], "award_date": day(d["award_date"]),
                      "supplier": d["supplier"], "amount": money(d["amount"])} for d in result["items"]]

        else:
            clauses, params = [], []
            if text:
                clauses.append("(s.supplier_name_raw LIKE ? ESCAPE '!' OR t.tender_no LIKE ? ESCAPE '!')")
                params.extend([like(text), like(text)])
            if agency:
                clauses.append("g.agency_name=?"); params.append(agency)
            if status:
                clauses.append("t.tender_status=?"); params.append(status)
            if award_from:
                clauses.append("t.award_date>=?"); params.append(award_from)
            if award_to:
                clauses.append("t.award_date<=?"); params.append(award_to)
            if min_amount is not None:
                clauses.append("a.awarded_amt>=?"); params.append(min_amount)
            if max_amount is not None:
                clauses.append("a.awarded_amt<=?"); params.append(max_amount)

            # Each award row joins its tender, agency and supplier for display.
            source = ("FROM TenderAward a JOIN Tender t ON t.tender_id=a.tender_id "
                      "JOIN GovernmentAgency g ON g.agency_id=t.agency_id JOIN Supplier s ON s.supplier_id=a.supplier_id"
                      + (" WHERE " + " AND ".join(clauses) if clauses else ""))
            total = sqlrows(db, "SELECT COUNT(*) AS n " + source, tuple(params))[0]["n"]
            rows = sqlrows(db, "SELECT a.award_id, t.tender_no, t.tender_description, t.tender_status, t.award_date, "
                               "g.agency_name, s.supplier_name_raw, a.awarded_amt " + source +
                               f" ORDER BY {sql_order} LIMIT ? OFFSET ?", (*params, limit, offset))
            items = [{"id": str(r["award_id"]), "tender_no": r["tender_no"], "tender_description": r["tender_description"],
                      "agency": r["agency_name"], "status": r["tender_status"], "award_date": day(r["award_date"]),
                      "supplier": r["supplier_name_raw"], "amount": money(r["awarded_amt"])} for r in rows]

        return envelope(page_of(items, total, page, limit), database)
