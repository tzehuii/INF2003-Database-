# Supplier CRUD, search, combined filters and company links

# Features this file covers:
# - Create, view, rename and delete suppliers.
# - Link a supplier to one registered company, remove the link, or match it again by name.
# - Search suppliers by name and filter by link status, awards, agency and total awarded, with sorting.
# - Run each request against the database selected in the website header.

# Routes (GET reads, POST creates, PATCH edits and DELETE removes records):
#   /api/system/suppliers                             supplier list and create
#   /api/system/suppliers/summary                     how many suppliers are linked, ambiguous or unmatched
#   /api/system/suppliers/item?name=                  one supplier: read, rename, delete
#   /api/system/suppliers/item/link?name=             link to a company, remove the link, or match by name
#   /api/system/suppliers/item/candidates?name=       companies whose normalized name matches the supplier's
# Supplier names can contain "/" (for example "DDI-ASIA/PACIFIC INTERNATIONAL, LTD."), so the name
# travels as a query parameter instead of a path segment.

# How the two databases store the same data:
# - MariaDB: one Supplier row per supplier. SupplierEntityMatch holds one row per candidate company:
#   exactly one row links the supplier to that company, several rows mean the name match is ambiguous.
#   TenderAward rows refer to the supplier by ID, so a rename changes one row, and the foreign key
#   (ON DELETE RESTRICT) blocks deleting a supplier that still has awards.
# - MongoDB: one suppliers document per supplier, keyed by its name. The embedded match object holds
#   the link status, the number of candidates and the linked company's UEN, and the collection
#   validator keeps those consistent. Awards inside tenders refer to the supplier by name, so a rename
#   also rewrites those awards.

# Import libraries.
from collections import defaultdict
from contextlib import contextmanager
from decimal import Decimal
import logging
import re
from typing import Annotated, Literal

import mariadb
from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import Field, field_validator, model_validator
from pymongo.collation import Collation
from pymongo.errors import ConnectionFailure, DuplicateKeyError, PyMongoError

from ..databases import connect_mariadb
from .companies import CleanModel, day, envelope, execute, fail, invalid, label, sqlrows
from .tenders import contains, like, money, next_source_record, page_of

# Set the shared URL prefix and the allowed database choices.
router = APIRouter(prefix="/api/system/suppliers", tags=["system-suppliers"])
Database = Annotated[Literal["mariadb", "mongodb"], Query()]
SupplierName = Annotated[str, Query(min_length=1, max_length=500)]
Money = Annotated[Decimal | None, Query(ge=0)]
logger = logging.getLogger(__name__)

# Legal-form endings removed from the end of a normalized name, longest first. Together with the
# rules in normalize_supplier this reproduces every imported normalized supplier and company name.
LEGAL_SUFFIXES = ("LIMITED LIABILITY PARTNERSHIP", "LIMITED PARTNERSHIP", "PRIVATE LIMITED", "PTE LIMITED",
                  "PTE LTD", "LIMITED", "LLP", "LTD", "LP", "PTE")

# How each database recorded an automatic name match when the data was imported.
NAME_MATCH = {"mariadb": "exact_normalized_name", "mongodb": "normalized_name_exact"}
MANUAL = "manual"

# Two supplier names are the same if they differ only in letter case or accents, like the
# MariaDB utf8mb4_uca1400_ai_ci collation on Supplier.supplier_name_raw.
SAME_NAME = Collation(locale="en", strength=1)

# A name match with more candidates than this is reported as ambiguous without listing them all.
MAX_CANDIDATES = 50

# Sort choices offered by the list screen: SQL ORDER BY, and the key MongoDB results are sorted by.
SUPPLIER_SORTS = {
    "name_asc": "s.supplier_name_raw",
    "name_desc": "s.supplier_name_raw DESC",
    "total_desc": "total_amount DESC, s.supplier_name_raw",
    "total_asc": "total_amount, s.supplier_name_raw",
    "awards_desc": "award_count DESC, s.supplier_name_raw",
}


# Uppercase, "&" as AND, punctuation as spaces, then drop trailing legal forms such as PTE LTD.
def normalize_supplier(name):
    text = " ".join(re.sub(r"[^A-Z0-9]+", " ", name.upper().replace("&", " AND ")).split())
    stripped = True
    while stripped:
        stripped = False
        for suffix in LEGAL_SUFFIXES:
            if text.endswith(" " + suffix):
                text, stripped = text[:-len(suffix) - 1], True
                break
    return text


# Validate the supplier name form used for create and rename.
class SupplierInput(CleanModel):
    name: str = Field(min_length=1, max_length=500)

    # Collapse repeated spaces, and require something a company name could match: a name made only
    # of punctuation or legal forms (for example "PTE. LTD.") normalizes to nothing useful.
    @field_validator("name")
    @classmethod
    def meaningful_name(cls, value):
        value = " ".join(value.split())
        if normalize_supplier(value) in ("", *LEGAL_SUFFIXES):
            invalid("invalid_name", "The supplier name needs at least one letter or digit besides a legal form such as PTE LTD.")
        return value


# Link form: link to one company by UEN, remove the link, or match again by normalized name.
class LinkInput(CleanModel):
    mode: Literal["company", "none", "match"]
    uen: str | None = Field(default=None, max_length=20)

    @model_validator(mode="after")
    def company_needs_uen(self):
        if self.mode == "company" and not self.uen:
            invalid("uen_required", "Enter the UEN of the company to link.")
        if self.uen:
            self.uen = self.uen.upper()
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
        fail(409, "conflict", "A supplier with this name already exists, or the supplier is used by other data.")

    except (mariadb.OperationalError, mariadb.InterfaceError, ConnectionFailure):
        fail(503, "database_unavailable", "The selected database could not be reached.")

    except (mariadb.Error, PyMongoError) as error:
        if database == "mariadb" and handle is not None:
            handle.rollback()
        logger.warning("Supplier operation failed (%s)", type(error).__name__)
        fail(500, "database_error", "The database could not complete the request.")

    finally:
        if database == "mariadb" and handle is not None:
            handle.close()

# --------------------------------------------------------------------- helpers --

# The link as the screens show it: status, number of candidates, how it was made, and the company.
def link_view(status, candidate_count, method, company):
    return {"status": status, "candidate_count": candidate_count,
            "method": None if status != "accepted" else ("manual" if method == MANUAL else "name"),
            "company": company if status == "accepted" else None}


# MariaDB link status from the number of match rows: one row links, several are ambiguous.
def sql_status(candidate_count):
    return "accepted" if candidate_count == 1 else "ambiguous" if candidate_count > 1 else "unmatched"


# One registered company by UEN, or None. MariaDB also returns its company_id for match rows.
def find_company(db, database, uen):
    if database == "mongodb":
        doc = db.companies.find_one({"_id": uen}, {"name": 1, "status": 1})
        return doc and {"uen": doc["_id"], "name": doc.get("name"), "status": doc.get("status")}
    rows = sqlrows(db, "SELECT company_id, uen, company_name, status FROM Company WHERE uen=?", (uen,))
    return rows and {"company_id": rows[0]["company_id"], "uen": rows[0]["uen"], "name": rows[0]["company_name"],
                     "status": rows[0]["status"]}


# Companies whose normalized name equals the supplier's, in UEN order. MongoDB has no index on
# companies.normalized_name, so there this reads every company (about two seconds).
def name_candidates(db, database, normalized, limit=MAX_CANDIDATES):
    if database == "mongodb":
        docs = db.companies.find({"normalized_name": normalized}, {"name": 1, "status": 1}).sort("_id", 1).limit(limit + 1).max_time_ms(30000)
        return [{"uen": d["_id"], "name": d.get("name"), "status": d.get("status")} for d in docs]
    rows = sqlrows(db, "SELECT company_id, uen, company_name, status FROM Company WHERE normalized_name=? ORDER BY uen LIMIT ?",
                   (normalized, limit + 1))
    return [{"company_id": r["company_id"], "uen": r["uen"], "name": r["company_name"], "status": r["status"]} for r in rows]


# The MongoDB match object for a set of linked or candidate companies. The validator requires
# exactly this shape: an accepted link has one candidate and a company UEN; otherwise both UENs are null.
def mongo_match(companies, method):
    if len(companies) == 1:
        uen = companies[0]["uen"]
        return {"status": "accepted", "candidate_count": 1, "candidate_uen": uen, "company_uen": uen, "method": method}
    return {"status": "ambiguous" if companies else "unmatched", "candidate_count": len(companies),
            "candidate_uen": None, "company_uen": None, "method": None}


# Replace a supplier's link. MariaDB keeps one match row per company; MongoDB rewrites the match object.
def write_link(db, database, supplier_key, companies, method):
    if database == "mongodb":
        result = db.suppliers.update_one({"_id": supplier_key}, {"$set": {"match": mongo_match(companies, method)}})
        if not result.matched_count:
            fail(409, "supplier_changed", "The supplier changed while saving. Reload and try again.")
        return
    execute(db, "DELETE FROM SupplierEntityMatch WHERE supplier_id=?", (supplier_key,))
    for company in companies:
        # A manual link is a person's decision, so it is stored as verified.
        execute(db, "INSERT INTO SupplierEntityMatch (supplier_id,company_id,match_method,confidence_score,verified) VALUES (?,?,?,?,?)",
                (supplier_key, company["company_id"], method, None, method == MANUAL))


# Look up one supplier with its link and awards, or raise 404 if it is missing.
# An exact name wins; otherwise the name may differ only in letter case, as in the tender forms.
def read(db, database, name):
    name = " ".join(name.split())
    if database == "mongodb":
        doc = db.suppliers.find_one({"_id": name}) or db.suppliers.find_one({"_id": name}, collation=Collation(locale="en", strength=2))
        if doc is not None:
            match = doc["match"]
            company = find_company(db, database, match["company_uen"]) if match["company_uen"] else None
            if match["company_uen"] and company is None:
                company = {"uen": match["company_uen"], "name": None, "status": None}
            awards = []
            for tender in db.tenders.find({"awards.supplier_id": doc["_id"]}, {"description": 1, "agency_name": 1, "award_date": 1, "awards": 1}):
                for award in tender["awards"]:
                    if award["supplier_id"] == doc["_id"]:
                        awards.append({"id": str(award["source_record"]), "tender_no": tender["_id"],
                                       "description": tender.get("description"), "agency": tender.get("agency_name"),
                                       "award_date": day(tender.get("award_date")), "amount": money(award["amount"])})
            awards.sort(key=lambda a: (a["award_date"] or "", a["tender_no"]), reverse=True)
            status = match["status"] if match["status"] in ("accepted", "ambiguous", "unmatched") else sql_status(match["candidate_count"])
            return {"name": doc["_id"], "normalized_name": doc["normalized_name"],
                    "link": link_view(status, match["candidate_count"], match["method"], company),
                    "award_count": len(awards), "total_amount": money(sum(Decimal(a["amount"]) for a in awards)), "awards": awards}
    else:
        rows = sqlrows(db, "SELECT supplier_id, supplier_name_raw, normalized_supplier_name FROM Supplier WHERE supplier_name_raw=?", (name,))
        if rows:
            row = rows[0]
            matches = sqlrows(db, "SELECT m.match_method, c.uen, c.company_name, c.status FROM SupplierEntityMatch m "
                                  "JOIN Company c ON c.company_id=m.company_id WHERE m.supplier_id=? ORDER BY c.uen", (row["supplier_id"],))
            company = {"uen": matches[0]["uen"], "name": matches[0]["company_name"], "status": matches[0]["status"]} if len(matches) == 1 else None
            awards = sqlrows(db, "SELECT a.award_id, t.tender_no, t.tender_description, g.agency_name, t.award_date, a.awarded_amt "
                                 "FROM TenderAward a JOIN Tender t ON t.tender_id=a.tender_id JOIN GovernmentAgency g ON g.agency_id=t.agency_id "
                                 "WHERE a.supplier_id=? ORDER BY t.award_date DESC, t.tender_no DESC", (row["supplier_id"],))
            return {"name": row["supplier_name_raw"], "normalized_name": row["normalized_supplier_name"],
                    "link": link_view(sql_status(len(matches)), len(matches), matches[0]["match_method"] if matches else None, company),
                    "award_count": len(awards), "total_amount": money(sum(a["awarded_amt"] for a in awards)),
                    "awards": [{"id": str(a["award_id"]), "tender_no": a["tender_no"], "description": a["tender_description"],
                                "agency": a["agency_name"], "award_date": day(a["award_date"]), "amount": money(a["awarded_amt"])}
                               for a in awards]}

    fail(404, "supplier_not_found", f"The supplier was not found in {label(database)}.")


# Lock and return the SQL supplier_id so a write cannot race with an award change or a delete.
def lock_supplier(db, name):
    rows = sqlrows(db, "SELECT supplier_id FROM Supplier WHERE supplier_name_raw=? FOR UPDATE", (name,))
    if not rows:
        fail(404, "supplier_not_found", "The supplier no longer exists.")
    return rows[0]["supplier_id"]


# Reject a name another supplier already uses, ignoring letter case and accents.
def check_name_free(db, database, name, current=None):
    if database == "mongodb":
        taken = [d["_id"] for d in db.suppliers.find({"_id": name}, {"_id": 1}, collation=SAME_NAME) if d["_id"] != current]
    else:
        taken = [r["supplier_name_raw"] for r in sqlrows(db, "SELECT supplier_name_raw FROM Supplier WHERE supplier_name_raw=?", (name,))
                 if r["supplier_name_raw"] != current]
    if taken:
        fail(409, "supplier_exists", f"A supplier named '{taken[0]}' already exists in {label(database)}.")

# -------------------------------------------------------------------- routes --

# Search suppliers and apply all supplied filters together. Returns one numbered page with a total.
@router.get("")
def list_suppliers(request: Request, database: Database, q: str = Query(default="", max_length=500),
                   link: Literal["", "accepted", "ambiguous", "unmatched"] = "",
                   awards: Literal["", "with", "without"] = "",
                   agency: str = Query(default="", max_length=255),
                   min_total: Money = None, max_total: Money = None,
                   sort: Literal[tuple(SUPPLIER_SORTS)] = "name_asc",
                   page: int = Query(default=1, ge=1, le=100000), limit: int = Query(default=25, ge=1, le=100)):

    if min_total is not None and max_total is not None and min_total > max_total:
        fail(422, "invalid_amounts", "The minimum amount must not be more than the maximum amount.")
    text, agency = q.strip(), agency.strip()
    offset = (page - 1) * limit

    with store(request, database) as db:
        if database == "mongodb":
            # About 6,000 suppliers: filter the documents, add award totals from one grouped pass over the
            # tenders, then sort and page in Python. The collation sorts names like MariaDB does.
            filters = {}
            if text:
                filters["_id"] = contains(text)
            if link:
                filters["match.status"] = link
            docs = list(db.suppliers.find(filters, {"normalized_name": 1, "match": 1}).sort("_id", 1).collation(SAME_NAME))

            totals = {row["_id"]: (row["count"], row["total"].to_decimal()) for row in db.tenders.aggregate([
                {"$unwind": "$awards"},
                {"$group": {"_id": "$awards.supplier_id", "count": {"$sum": 1}, "total": {"$sum": "$awards.amount"}}}])}
            awarded_by_agency = set(db.tenders.distinct("awards.supplier_id", {"agency_name": agency})) if agency else None

            rows = []
            for d in docs:
                count, total = totals.get(d["_id"], (0, Decimal(0)))
                if (awards == "with" and not count) or (awards == "without" and count):
                    continue
                if awarded_by_agency is not None and d["_id"] not in awarded_by_agency:
                    continue
                if (min_total is not None and total < min_total) or (max_total is not None and total > max_total):
                    continue
                rows.append((d, count, total))

            # Python's sort is stable, so equal totals keep the name order from the query.
            if sort == "name_desc":
                rows.reverse()
            elif sort == "total_desc":
                rows.sort(key=lambda r: r[2], reverse=True)
            elif sort == "total_asc":
                rows.sort(key=lambda r: r[2])
            elif sort == "awards_desc":
                rows.sort(key=lambda r: r[1], reverse=True)

            total_rows = len(rows)
            page_rows = rows[offset:offset + limit]
            uens = [d["match"]["company_uen"] for d, _, _ in page_rows if d["match"]["company_uen"]]
            names = {c["_id"]: c.get("name") for c in db.companies.find({"_id": {"$in": uens}}, {"name": 1})} if uens else {}
            items = [{"name": d["_id"], "normalized_name": d["normalized_name"],
                      "link": {"status": d["match"]["status"], "candidate_count": d["match"]["candidate_count"],
                               "company_uen": d["match"]["company_uen"], "company_name": names.get(d["match"]["company_uen"])},
                      "award_count": count, "total_amount": money(total)} for d, count, total in page_rows]

        else:
            clauses, params = [], []
            if text:
                clauses.append("s.supplier_name_raw LIKE ? ESCAPE '!'"); params.append(like(text))
            if link == "accepted":
                clauses.append("m.candidate_count=1")
            elif link == "ambiguous":
                clauses.append("m.candidate_count>1")
            elif link == "unmatched":
                clauses.append("m.supplier_id IS NULL")
            if awards == "with":
                clauses.append("x.supplier_id IS NOT NULL")
            elif awards == "without":
                clauses.append("x.supplier_id IS NULL")
            if agency:
                # EXISTS keeps each supplier once, however many of that agency's tenders it won.
                clauses.append("EXISTS (SELECT 1 FROM TenderAward sa JOIN Tender t ON t.tender_id=sa.tender_id "
                               "JOIN GovernmentAgency g ON g.agency_id=t.agency_id WHERE sa.supplier_id=s.supplier_id AND g.agency_name=?)")
                params.append(agency)
            if min_total is not None:
                clauses.append("COALESCE(x.total_amount,0)>=?"); params.append(min_total)
            if max_total is not None:
                clauses.append("COALESCE(x.total_amount,0)<=?"); params.append(max_total)

            # Award totals and match counts come from grouped subqueries joined to each supplier;
            # the company is joined only when exactly one match row links it.
            source = ("FROM Supplier s "
                      "LEFT JOIN (SELECT supplier_id, COUNT(*) AS award_count, SUM(awarded_amt) AS total_amount "
                      "FROM TenderAward GROUP BY supplier_id) x ON x.supplier_id=s.supplier_id "
                      "LEFT JOIN (SELECT supplier_id, COUNT(*) AS candidate_count, MIN(company_id) AS company_id "
                      "FROM SupplierEntityMatch GROUP BY supplier_id) m ON m.supplier_id=s.supplier_id "
                      "LEFT JOIN Company c ON c.company_id=m.company_id AND m.candidate_count=1"
                      + (" WHERE " + " AND ".join(clauses) if clauses else ""))
            total_rows = sqlrows(db, "SELECT COUNT(*) AS n " + source, tuple(params))[0]["n"]
            rows = sqlrows(db, "SELECT s.supplier_name_raw, s.normalized_supplier_name, COALESCE(x.award_count,0) AS award_count, "
                               "COALESCE(x.total_amount,0) AS total_amount, COALESCE(m.candidate_count,0) AS candidate_count, "
                               "c.uen, c.company_name " + source + f" ORDER BY {SUPPLIER_SORTS[sort]} LIMIT ? OFFSET ?",
                           (*params, limit, offset))
            items = [{"name": r["supplier_name_raw"], "normalized_name": r["normalized_supplier_name"],
                      "link": {"status": sql_status(int(r["candidate_count"])), "candidate_count": int(r["candidate_count"]),
                               "company_uen": r["uen"], "company_name": r["company_name"]},
                      "award_count": int(r["award_count"]), "total_amount": money(r["total_amount"])} for r in rows]

        return envelope(page_of(items, total_rows, page, limit), database)


# How many suppliers are linked to one company, have several possible companies, or have none.
@router.get("/summary")
def supplier_summary(request: Request, database: Database):
    with store(request, database) as db:
        if database == "mongodb":
            counts = {row["_id"]: row["n"] for row in db.suppliers.aggregate([{"$group": {"_id": "$match.status", "n": {"$sum": 1}}}])}
        else:
            # One match row links the supplier; several mean the name match is ambiguous.
            rows = sqlrows(db, "SELECT COALESCE(m.candidate_count,0) AS candidates, COUNT(*) AS n FROM Supplier s "
                               "LEFT JOIN (SELECT supplier_id, COUNT(*) AS candidate_count FROM SupplierEntityMatch "
                               "GROUP BY supplier_id) m ON m.supplier_id=s.supplier_id GROUP BY COALESCE(m.candidate_count,0)")
            counts = defaultdict(int)
            for row in rows:
                counts[sql_status(int(row["candidates"]))] += int(row["n"])
        summary = {status: int(counts.get(status, 0)) for status in ("accepted", "ambiguous", "unmatched")}
        return envelope({**summary, "total": sum(summary.values())}, database)


# Load a supplier with its company link and awards for the detail screen.
@router.get("/item")
def get_supplier(request: Request, database: Database, name: SupplierName):
    with store(request, database) as db:
        return envelope(read(db, database, name), database)


# Companies whose normalized name matches the supplier's, for choosing a link.
@router.get("/item/candidates")
def supplier_candidates(request: Request, database: Database, name: SupplierName):
    with store(request, database) as db:
        supplier = read(db, database, name)
        companies = name_candidates(db, database, supplier["normalized_name"])
        return envelope({"normalized_name": supplier["normalized_name"], "more": len(companies) > MAX_CANDIDATES,
                         "items": [{k: v for k, v in c.items() if k != "company_id"} for c in companies[:MAX_CANDIDATES]]}, database)


# Create a supplier and match it to companies by normalized name, as the imported suppliers were.
@router.post("", status_code=201)
def create_supplier(request: Request, database: Database, body: SupplierInput):
    with store(request, database) as db:
        check_name_free(db, database, body.name)
        normalized = normalize_supplier(body.name)
        candidates = name_candidates(db, database, normalized)

        if database == "mongodb":
            # The validator needs a source record number; new suppliers take the next unused one.
            db.suppliers.insert_one({"_id": body.name, "normalized_name": normalized,
                                     "match": mongo_match(candidates, NAME_MATCH[database]),
                                     "source_first_record": next_source_record(db)})
        else:
            supplier_id = execute(db, "INSERT INTO Supplier (supplier_name_raw,normalized_supplier_name) VALUES (?,?)",
                                  (body.name, normalized))
            write_link(db, database, supplier_id, candidates, NAME_MATCH[database])

        return envelope(read(db, database, body.name), database)


# Rename a supplier. Its awards and company link stay attached; the normalized name follows the new name.
@router.patch("/item")
def rename_supplier(request: Request, database: Database, name: SupplierName, body: SupplierInput):
    with store(request, database) as db:
        current = read(db, database, name)["name"]
        if body.name == current:
            return envelope(read(db, database, current), database)
        check_name_free(db, database, body.name, current)
        normalized = normalize_supplier(body.name)

        if database == "mongodb":
            # _id cannot change, and this standalone server has no multi-document transactions. Insert the
            # renamed copy first (a duplicate stops here with nothing changed), move the awards across,
            # then remove the old document.
            doc = db.suppliers.find_one({"_id": current})
            db.suppliers.insert_one({**doc, "_id": body.name, "normalized_name": normalized})
            db.tenders.update_many({"awards.supplier_id": current}, {"$set": {"awards.$[award].supplier_id": body.name}},
                                   array_filters=[{"award.supplier_id": current}])
            db.suppliers.delete_one({"_id": current})
        else:
            supplier_id = lock_supplier(db, current)
            execute(db, "UPDATE Supplier SET supplier_name_raw=?,normalized_supplier_name=? WHERE supplier_id=?",
                    (body.name, normalized, supplier_id))

        return envelope(read(db, database, body.name), database)


# Link the supplier to one company, remove the link, or match it again by normalized name.
@router.patch("/item/link")
def set_link(request: Request, database: Database, name: SupplierName, body: LinkInput):
    with store(request, database) as db:
        supplier = read(db, database, name)
        if body.mode == "company":
            company = find_company(db, database, body.uen)
            if not company:
                fail(422, "company_not_found", f"No company with UEN {body.uen} exists in {label(database)}.")
            companies, method = [company], MANUAL
        elif body.mode == "match":
            companies, method = name_candidates(db, database, supplier["normalized_name"]), NAME_MATCH[database]
        else:
            companies, method = [], None

        key = supplier["name"] if database == "mongodb" else lock_supplier(db, supplier["name"])
        write_link(db, database, key, companies, method)
        return envelope(read(db, database, supplier["name"]), database)


# Delete a supplier that has no awards. Its company link is removed with it.
@router.delete("/item", status_code=204)
def delete_supplier(request: Request, database: Database, name: SupplierName):
    with store(request, database) as db:
        supplier = read(db, database, name)
        name = supplier["name"]
        if supplier["award_count"]:
            fail(409, "supplier_has_awards", f"{name} has {supplier['award_count']} award(s). Delete them or give them to "
                                             "another supplier in Tenders & Awards first.")
        if database == "mongodb":
            # Check again just before deleting, in case an award was added since the read.
            if db.tenders.find_one({"awards.supplier_id": name}, {"_id": 1}):
                fail(409, "supplier_has_awards", f"{name} now has awards. Reload and try again.")
            db.suppliers.delete_one({"_id": name})
        else:
            # The lock blocks new awards (their foreign key needs this row) until the delete commits.
            supplier_id = lock_supplier(db, name)
            if sqlrows(db, "SELECT 1 FROM TenderAward WHERE supplier_id=? LIMIT 1", (supplier_id,)):
                fail(409, "supplier_has_awards", f"{name} now has awards. Reload and try again.")
            # ON DELETE CASCADE removes the SupplierEntityMatch rows.
            execute(db, "DELETE FROM Supplier WHERE supplier_id=?", (supplier_id,))

    return Response(status_code=204)
