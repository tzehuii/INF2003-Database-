# Company and Address Management (System view)
# Company/address CRUD, company search and combined filters for MariaDB and MongoDB.

# Features this file covers:
# - Create, view, edit and delete companies and their addresses.
# - Search by company name or UEN.
# - Filter by status, postal code, street and registration dates.
# - Run each request against the database selected in the website header.

# All routes start with /api/system/companies.
# GET reads, POST creates, PATCH edits and DELETE removes records.

# Import libraries.
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta
import logging
import re
from time import monotonic
from typing import Annotated, Literal, ClassVar

import mariadb
from fastapi import APIRouter, HTTPException, Path, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic_core import PydanticCustomError
from pymongo.errors import ConnectionFailure, DuplicateKeyError, PyMongoError

from ..databases import connect_mariadb

# Set the shared URL prefix and the allowed database choices.
router = APIRouter(prefix="/api/system/companies", tags=["system-companies"])
Database = Annotated[Literal["mariadb", "mongodb"], Query()]
Uen = Annotated[str, Path(min_length=1, max_length=20)]
logger = logging.getLogger(__name__)

# Address field lengths match the MariaDB schema and apply to both databases.
ADDRESS_FIELDS = {"type": 30, "block": 30, "street_name": 255, "level_no": 20,
                  "unit_no": 20, "building_name": 255, "postal_code": 20,
                  "other_address_line1": 500, "other_address_line2": 500}

# The API calls this field type; the SQL column is named address_type.
SQL_ADDRESS_FIELDS = ["address_type" if k == "type" else k for k in ADDRESS_FIELDS]

# ACRA UEN formats: business (8 digits + letter), local company (9 digits + letter),
# and other entities (T/S/R + year + entity type + 4 digits + letter). Every imported UEN matches.
UEN_PATTERN = re.compile(r"[0-9]{8}[A-Z]|[0-9]{9}[A-Z]|[STR][0-9]{2}[A-Z]{2}[0-9]{4}[A-Z]")

# The oldest imported registration is 1887, so earlier dates are treated as typing mistakes.
EARLIEST_REGISTRATION = date(1800, 1, 1)

# Registry statuses are cached per database because reading them scans every company.
STATUS_CACHE_SECONDS = 600
status_cache = {}

# Stop the request with an HTTP error and a message the frontend can display.
def fail(status, code, message):
    raise HTTPException(status_code=status, detail={"code": code, "message": message})

# Raise a validation error whose message is shown to the user without a "Value error" prefix.
def invalid(code, message):
    raise PydanticCustomError(code, message)

# Trim incoming text and reject unexpected JSON fields on all forms.
class CleanModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

# Validate address form fields using the same length limits in both databases.
class AddressInput(CleanModel):
    allow_existing_postal: ClassVar[bool] = False
    type: str | None = Field(default=None, max_length=30)
    block: str | None = Field(default=None, max_length=30)
    street_name: str | None = Field(default=None, max_length=255)
    level_no: str | None = Field(default=None, max_length=20)
    unit_no: str | None = Field(default=None, max_length=20)
    building_name: str | None = Field(default=None, max_length=255)
    postal_code: str | None = Field(default=None, max_length=20)
    other_address_line1: str | None = Field(default=None, max_length=500)
    other_address_line2: str | None = Field(default=None, max_length=500)

    # Convert blank inputs to None (stored as NULL) and store text in uppercase like the ACRA data.
    @field_validator("*", mode="before")
    @classmethod
    def blanks(cls, value):
        if isinstance(value, str):
            return value.strip().upper() or None
        return value

    # Level and unit numbers only contain letters, digits and hyphens, for example 05 or 12A.
    @field_validator("level_no", "unit_no")
    @classmethod
    def unit_format(cls, value):
        if value is not None and not re.fullmatch(r"[A-Z0-9-]+", value):
            invalid("invalid_unit", "Level and unit may only contain letters, digits and hyphens, for example 05 or 12A.")
        return value

    # Local addresses need a street and six-digit postal code; foreign formats vary.
    @model_validator(mode="after")
    def complete(self):
        if self.type not in ("LOCAL", "FOREIGN"):
            invalid("invalid_address_type", "Choose LOCAL or FOREIGN as the address type.")

        if self.type == "LOCAL":
            if not self.street_name:
                invalid("missing_street", "Enter the street name for a local address.")
            if not self.allow_existing_postal and (not self.postal_code or not re.fullmatch(r"[0-9]{6}", self.postal_code)):
                invalid("invalid_postal_code", "A local postal code must contain exactly 6 digits.")

        elif not (self.street_name or self.other_address_line1):
            invalid("missing_foreign_line", "Enter a street name or address line 1 for a foreign address.")
        return self

# Defer postal validation on edits until the original address can be checked.
# This flag is server-defined, never accepted as a client JSON field.
class AddressUpdate(AddressInput):
    allow_existing_postal: ClassVar[bool] = True

# Keep an imported four-digit postal code only when that same address already has it.
def validate_updated_postal(body, existing):
    if body.type != "LOCAL" or (body.postal_code and re.fullmatch(r"[0-9]{6}", body.postal_code)):
        return
    legacy = existing.get("postal_code")
    if existing.get("type") == "LOCAL" and legacy and re.fullmatch(r"[0-9]{4}", legacy) and body.postal_code == legacy:
        return
    fail(422, "invalid_postal_code", "Enter a 6-digit local postal code. An existing historical 4-digit code may only be kept unchanged.")

# Fields sent by the edit-company form; the UEN cannot be edited.
class CompanyInput(CleanModel):
    name: str = Field(min_length=1, max_length=500)
    status: str = Field(min_length=1, max_length=100)
    registration_date: date | None = None

    # Accept letters and digits from any language, but reject names made only of symbols.
    @field_validator("name")
    @classmethod
    def readable_name(cls, value):
        if not any(character.isalnum() for character in value):
            invalid("invalid_name", "The company name must contain at least one letter or digit.")
        return value

    # A registration date cannot be in the future or earlier than any real registry record.
    @field_validator("registration_date")
    @classmethod
    def realistic_date(cls, value):
        if value is not None and not EARLIEST_REGISTRATION <= value <= date.today():
            invalid("invalid_registration_date", "The registration date must be between 1800-01-01 and today.")
        return value

# Create-company form: also requires a UEN and accepts an optional address.
class CompanyCreate(CompanyInput):
    uen: str = Field(min_length=1, max_length=20)
    address: AddressInput | None = None

    # Keep new UENs in uppercase and accept only the official ACRA formats.
    @field_validator("uen")
    @classmethod
    def official_uen(cls, value):
        value = value.upper()
        if not UEN_PATTERN.fullmatch(value):
            invalid("invalid_uen", "Enter a valid UEN, for example 53012345D, 196800306E or T08LL1234A.")
        return value

# Derive the stored normalized name while keeping the display name separately.
def normalize(name):
    return " ".join("".join(character if character.isalnum() else " " for character in name.upper()).split())

# Wrap results as data plus metadata identifying the selected database.
def envelope(data, database):
    return {"data": data, "meta": {"database": database}}

# Show the selected database by name in user messages.
def label(database):
    return "MariaDB" if database == "mariadb" else "MongoDB"

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
        fail(409, "conflict", "This UEN already exists or the record has related data.")

    except (mariadb.OperationalError, mariadb.InterfaceError, ConnectionFailure):
        fail(503, "database_unavailable", "The selected database could not be reached.")

    except (mariadb.Error, PyMongoError) as error:
        if database == "mariadb" and handle is not None:
            handle.rollback()
        logger.warning("Company operation failed (%s)", type(error).__name__)
        fail(500, "database_error", "The database could not complete the request.")

    finally:
        if database == "mariadb" and handle is not None:
            handle.close()

# Run a parameterized SQL SELECT and return rows as dictionaries.
def sqlrows(db, query, params=()):
    cur = db.cursor(dictionary=True)
    try:
        # Bind values separately so user input cannot become part of the SQL syntax.
        cur.execute(query, params)
        return cur.fetchall()

    finally:
        cur.close()

# Run a SQL write and return its inserted ID; store() handles commit/rollback.
def execute(db, query, params=()):
    cur = db.cursor()
    try:
        cur.execute(query, params)
        return cur.lastrowid

    finally:
        cur.close()

# Format a database date as YYYY-MM-DD for JSON and frontend date inputs.
def day(value):
    return value.strftime("%Y-%m-%d") if value else None

# Convert a form date to the midnight datetime MongoDB stores for dates.
def mongo_day(value):
    return datetime.combine(value, time.min) if value else None

# Expose the embedded MongoDB address in the same list shape as SQL rows.
def mongo_item(doc):
    address = doc.get("address") or {}
    return {"uen": doc["_id"], "name": doc.get("name"), "status": doc.get("status"),
            "registration_date": day((doc.get("registration") or {}).get("incorporation_date")),
            "addresses": [{"id": "embedded", **address}] if any(address.values()) else []}

# Combine SQL company rows with addresses in the shared API response format.
def sql_items(db, rows):
    result = [{"uen": r["uen"], "name": r["company_name"], "status": r["status"],
               "registration_date": day(r["registration_date"]), "addresses": []} for r in rows]
    if not rows:
        return result

    # Fetch addresses in one batch to avoid an extra query for every company.
    mapping = {r["company_id"]: result[i] for i, r in enumerate(rows)}
    marks = ",".join("?" for _ in rows)
    addresses = sqlrows(db, f"SELECT * FROM Address WHERE company_id IN ({marks}) ORDER BY address_id", tuple(mapping))

    # Rename address_type back to type so both databases return the same keys.
    for a in addresses:
        mapping[a["company_id"]]["addresses"].append({"id": str(a["address_id"]), **{
            k: a["address_type" if k == "type" else k] for k in ADDRESS_FIELDS}})

    return result

# Look up one company in the selected database, or raise 404 if it is missing.
# UENs are stored in uppercase, so lowercase links behave the same in both databases.
def read(db, database, uen):
    uen = uen.strip().upper()
    if database == "mongodb":
        doc = db.companies.find_one({"_id": uen})
        if doc is not None:
            return mongo_item(doc)
    else:
        rows = sqlrows(db, "SELECT * FROM Company WHERE uen=?", (uen,))
        if rows:
            return sql_items(db, rows)[0]

    fail(404, "company_not_found", f"The company was not found in {label(database)}.")

# Lock and return the SQL company_id so a write cannot race with a delete of the same company.
def lock_company(db, uen):
    rows = sqlrows(db, "SELECT company_id FROM Company WHERE uen=? FOR UPDATE", (uen,))
    if not rows:
        fail(404, "company_not_found", "The company no longer exists.")
    return rows[0]["company_id"]

# Return the distinct registry statuses, reusing a recent result to avoid a full scan each time.
def registry_statuses(db, database):
    cached = status_cache.get(database)
    if cached and cached[0] > monotonic():
        return cached[1]

    if database == "mongodb":
        values = db.companies.distinct("status")
    else:
        values = [row["status"] for row in sqlrows(db, "SELECT DISTINCT status FROM Company WHERE status IS NOT NULL")]

    # Keep only real text values in alphabetical order for the dropdown.
    items = sorted(value for value in values if isinstance(value, str) and value.strip())
    status_cache[database] = (monotonic() + STATUS_CACHE_SECONDS, items)
    return items

# Reject a status that is not part of the registry vocabulary, unless the company already has it.
def check_status(db, database, status, current=None):
    if status != current and status not in registry_statuses(db, database):
        fail(422, "invalid_status", f"Choose a registration status that exists in {label(database)}.")

# Reject an address that is identical to another address of the same SQL company.
# <=> compares NULL values as equal, so blank fields also count as matching.
def check_duplicate_address(db, company_id, values, ignore_id=0):
    same = " AND ".join(k + " <=> ?" for k in SQL_ADDRESS_FIELDS)
    rows = sqlrows(db, f"SELECT 1 FROM Address WHERE company_id=? AND address_id<>? AND {same} LIMIT 1",
                   (company_id, ignore_id, *values))
    if rows:
        fail(409, "duplicate_address", "This company already has an identical address.")

# Search companies and apply all supplied filters together. Returns one page.
# after is the last UEN from the previous page, so the next page starts after it.
@router.get("")
def list_companies(request: Request, database: Database, q: str = Query(default="", max_length=500),
                   status: str = Query(default="", max_length=100),
                   postal_code: str = Query(default="", max_length=20),
                   street: str = Query(default="", max_length=255),
                   registered_from: date | None = None, registered_to: date | None = None,
                   viewed_uens: Annotated[list[str] | None, Query(max_length=50)] = None,
                   viewed: Literal["all", "only", "hide"] = "all",
                   page: int | None = Query(default=None, ge=1, le=100000),
                   after: str = Query(default="", max_length=20), limit: int = Query(default=25, ge=1, le=100)):

    # Numbered pages allow direct jumps; existing callers can still use UEN cursors.
    offset = ((page - 1) * limit) if page is not None else 0
    if page is not None and after:
        fail(422, "invalid_pagination", "Use a page number or a cursor, not both.")

    # Reject a reversed date range before making a database query.
    if registered_from and registered_to and registered_from > registered_to:
        fail(422, "invalid_dates", "The start date must be on or before the end date.")

    # Complete UEN-shaped identifiers use indexed equality, including a missing UEN.
    # Shorter fragments and names retain literal substring search.
    text = q.strip()
    exact_uen = bool(UEN_PATTERN.fullmatch(text.upper()))
    status, postal_code, street = status.strip(), postal_code.strip(), street.strip()

    # Combine filters with AND; name/UEN matching treats user text literally.
    with store(request, database) as db:
        if database == "mongodb":
            # MongoDB filters use nested field paths and escaped regular expressions.
            filters = []

            # Filter the complete result set before pagination, using browser viewing history.
            if viewed != "all":
                filters.append({"_id": {"$in" if viewed == "only" else "$nin": viewed_uens or []}})

            # Either the UEN or company name can match the same search text.
            if text:
                if exact_uen:
                    filters.append({"_id": text.upper()})
                else:
                    pattern = {"$regex": re.escape(text), "$options": "i"}
                    filters.append({"$or": [{"_id": pattern}, {"name": pattern}]})

            if status:
                filters.append({"status": status})

            if postal_code:
                filters.append({"address.postal_code": postal_code})

            if street:
                filters.append({"address.street_name": {"$regex": re.escape(street), "$options": "i"}})

            # Stored MongoDB dates include time; use an exclusive next-day upper bound.
            bounds = {}
            if registered_from:
                bounds["$gte"] = mongo_day(registered_from)
            if registered_to:
                bounds["$lt"] = mongo_day(registered_to) + timedelta(days=1)
            if bounds:
                filters.append({"registration.incorporation_date": bounds})

            # Continue from the last UEN rather than skipping millions of earlier records.
            if after:
                filters.append({"_id": {"$gt": after}})

            # Return only the fields the table needs, sorted by UEN like the SQL query.
            docs = list(db.companies.find({"$and": filters} if filters else {},
                {"name": 1, "status": 1, "registration.incorporation_date": 1, "address": 1})
                .sort("_id", 1).skip(offset).limit(limit + 1).max_time_ms(30000))

            items = [mongo_item(doc) for doc in docs]

        else:
            # SQL WHERE conditions and bound values are built separately.
            clauses, params = [], []

            # Bind remembered UENs as values; never place history values into SQL text.
            if viewed != "all":
                history = viewed_uens or []
                if history:
                    marks = ",".join("?" for _ in history)
                    clauses.append("c.uen " + ("IN" if viewed == "only" else "NOT IN") + f" ({marks})")
                    params.extend(history)
                elif viewed == "only":
                    clauses.append("1=0")

            # Escape SQL wildcards so user search text is matched literally.
            def like(value):
                return "%" + value.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%"

            if text:
                if exact_uen:
                    clauses.append("c.uen=?"); params.append(text.upper())
                else:
                    clauses.append("(c.uen LIKE ? ESCAPE '!' OR c.company_name LIKE ? ESCAPE '!')")
                    params.extend([like(text), like(text)])

            if status:
                clauses.append("c.status=?"); params.append(status)

            if registered_from:
                clauses.append("c.registration_date>=?"); params.append(registered_from)

            if registered_to:
                clauses.append("c.registration_date<=?"); params.append(registered_to)

            if postal_code or street:
                address_clauses = ["a.company_id=c.company_id"]

                if postal_code:
                    address_clauses.append("a.postal_code=?"); params.append(postal_code)

                if street:
                    address_clauses.append("a.street_name LIKE ? ESCAPE '!'"); params.append(like(street))

                # EXISTS keeps each company once, even when it has several matching addresses.
                clauses.append("EXISTS (SELECT 1 FROM Address a WHERE " + " AND ".join(address_clauses) + ")")

            if after:
                clauses.append("c.uen>?"); params.append(after)

            # Fetch one extra row so the response can say whether another page exists.
            query = "SELECT c.* FROM Company c" + (" WHERE " + " AND ".join(clauses) if clauses else "")
            rows = sqlrows(db, query + " ORDER BY c.uen LIMIT ? OFFSET ?", (*params, limit + 1, offset))
            items = sql_items(db, rows)

        # One extra result detects another page without counting all matching records.
        # The frontend sends next_after as after for its next request.
        more = len(items) > limit
        items = items[:limit]

        return envelope({"items": items, "has_more": more, "next_after": items[-1]["uen"] if more else None}, database)

# Read the real registry statuses for the dropdown; no hard-coded status catalogue.
@router.get("/statuses")
def company_statuses(request: Request, database: Database):
    with store(request, database) as db:
        return envelope({"items": registry_statuses(db, database)}, database)

# Load a company and its addresses for the View / manage panel.
@router.get("/{uen}")
def get_company(request: Request, database: Database, uen: Uen):
    with store(request, database) as db:
        company = read(db, database, uen)
        if database == "mongodb":
            doc = db.companies.find_one({"_id": company["uen"]}, {"former_names": 1}) or {}
            names = [entry.get("name") for entry in sorted(doc.get("former_names", []), key=lambda entry: entry.get("source_slot", 0))]
        else:
            names = [row["former_name"] for row in sqlrows(db,
                "SELECT f.former_name FROM FormerEntityName f JOIN Company c ON c.company_id=f.company_id WHERE c.uen=? ORDER BY f.source_slot",
                (company["uen"],))]
        company["former_names"] = [name for name in names if isinstance(name, str) and name.strip()]
        return envelope(company, database)

# Create a company, optionally with an address. Rejects an existing UEN.
# body is the submitted form; CompanyCreate validates it before this function runs.
@router.post("", status_code=201)
def create_company(request: Request, database: Database, body: CompanyCreate):
    with store(request, database) as db:
        check_status(db, database, body.status)
        address = body.address.model_dump() if body.address else {k: None for k in ADDRESS_FIELDS}

        if database == "mongodb":
            # Check first for a clear message; the _id unique index still blocks a race.
            if db.companies.find_one({"_id": body.uen}, {"_id": 1}):
                fail(409, "uen_exists", f"A company with UEN {body.uen} already exists in MongoDB.")

            # Required defaults satisfy the strict validator from the MongoDB archive.
            activity = {"source_code": None, "code": None, "mapping_status": "missing",
                        "source_description": None, "user_description": None}

            registration = {k: None for k in ["issuance_agency_id", "entity_type", "business_constitution",
                                             "company_type", "paf_constitution", "uen_issue_date"]}
            registration["incorporation_date"] = mongo_day(body.registration_date)

            # One insert saves the company and its embedded address together.
            db.companies.insert_one({"_id": body.uen, "name": body.name, "status": body.status,
                "normalized_name": normalize(body.name), "search_name": body.name.upper(),
                "registration": registration, "address": address,
                "filings": {"account_due_date": None, "annual_return_date": None},
                "officer_count": None, "activities": {"primary": activity, "secondary": dict(activity)},
                "former_names": [], "auditors": [], "source_record": 1})

        else:
            # Check first for a clear message; the UNIQUE constraint still blocks a race.
            if sqlrows(db, "SELECT 1 FROM Company WHERE uen=?", (body.uen,)):
                fail(409, "uen_exists", f"A company with UEN {body.uen} already exists in MariaDB.")

            # Keep the generated company ID so the address row links to the right company.
            company_id = execute(db, "INSERT INTO Company (uen,company_name,status,registration_date,normalized_name) VALUES (?,?,?,?,?)",
                (body.uen, body.name, body.status, body.registration_date, normalize(body.name)))

            # The company and its first address commit together in one transaction.
            if body.address:
                execute(db, "INSERT INTO Address (company_id," + ",".join(SQL_ADDRESS_FIELDS) + ") VALUES (" + ",".join("?" for _ in range(len(ADDRESS_FIELDS) + 1)) + ")",
                        (company_id, *address.values()))

        return envelope(read(db, database, body.uen), database)

# Save the company form fields. The UEN stays unchanged.
@router.patch("/{uen}")
def update_company(request: Request, database: Database, uen: Uen, body: CompanyInput):
    with store(request, database) as db:
        company = read(db, database, uen)
        uen = company["uen"]
        check_status(db, database, body.status, company["status"])

        if database == "mongodb":
            # Update only these fields, preserving activities, filings and other imported data.
            result = db.companies.update_one({"_id": uen}, {"$set": {"name": body.name, "status": body.status,
                "normalized_name": normalize(body.name), "search_name": body.name.upper(),
                "registration.incorporation_date": mongo_day(body.registration_date)}})

            if not result.matched_count:
                fail(404, "company_not_found", "The company no longer exists.")

        else:
            execute(db, "UPDATE Company SET company_name=?,status=?,registration_date=?,normalized_name=? WHERE uen=?",
                    (body.name, body.status, body.registration_date, normalize(body.name), uen))

        return envelope(read(db, database, uen), database)

# Delete a company only if no supplier links or saved-list entries depend on it.
@router.delete("/{uen}", status_code=204)
def delete_company(request: Request, database: Database, uen: Uen):
    with store(request, database) as db:
        uen = read(db, database, uen)["uen"]

        if database == "mongodb":
            linked = db.suppliers.find_one({"$or": [{"match.company_uen": uen}, {"match.candidate_uen": uen}]}, {"_id": 1})
            saved = db.saved_list_entries.find_one({"company_uen": uen}, {"_id": 1})

        else:
            # Lock the parent SQL row until this transaction commits or rolls back.
            company_id = lock_company(db, uen)
            linked = sqlrows(db, "SELECT 1 FROM SupplierEntityMatch WHERE company_id=? LIMIT 1", (company_id,))
            saved = sqlrows(db, "SELECT 1 FROM SavedListEntry WHERE company_id=? LIMIT 1", (company_id,))

        # Avoid orphaned supplier or watchlist references in either database.
        if linked or saved:
            fail(409, "delete_blocked", "Remove this company's supplier links and saved-list entries before deleting it.")

        # SQL cascades related address/activity/name rows; MongoDB deletes embedded data.
        if database == "mongodb":
            db.companies.delete_one({"_id": uen})
        else:
            execute(db, "DELETE FROM Company WHERE uen=?", (uen,))

    return Response(status_code=204)

# Add an address to an existing company.
# SQL supports multiple address rows; MongoDB stores one embedded address.
@router.post("/{uen}/addresses", status_code=201)
def create_address(request: Request, database: Database, uen: Uen, body: AddressInput):
    with store(request, database) as db:
        company = read(db, database, uen)
        uen = company["uen"]

        if database == "mongodb":
            if company["addresses"]:
                fail(409, "address_exists", "MongoDB stores one address per company. Edit the existing address instead.")

            # Conditional write prevents two concurrent adds from overwriting each other.
            empty = [{"address." + k: {"$in": [None, ""]}} for k in ADDRESS_FIELDS]
            result = db.companies.update_one({"_id": uen, "$and": empty}, {"$set": {"address": body.model_dump()}})

            if not result.matched_count:
                fail(409, "address_changed", "The company or its address changed. Reload and try again.")

        else:
            # Lock the parent SQL row until this transaction commits or rolls back.
            company_id = lock_company(db, uen)
            values = tuple(body.model_dump().values())
            check_duplicate_address(db, company_id, values)
            execute(db, "INSERT INTO Address (company_id," + ",".join(SQL_ADDRESS_FIELDS) + ") VALUES (" + ",".join("?" for _ in range(len(ADDRESS_FIELDS) + 1)) + ")",
                    (company_id, *values))

        return envelope(read(db, database, uen), database)

# Raise 404 unless the requested address belongs to this company.
def address_exists(company, address_id):
    if not any(a["id"] == address_id for a in company["addresses"]):
        fail(404, "address_not_found", "The address was not found for this company.")

# Save the address form after checking it belongs to the requested company.
@router.patch("/{uen}/addresses/{address_id}")
def update_address(request: Request, database: Database, uen: Uen, address_id: str, body: AddressUpdate):
    with store(request, database) as db:
        # Check both the company and address ID before touching address data.
        company = read(db, database, uen)
        uen = company["uen"]
        address_exists(company, address_id)
        existing = next(address for address in company["addresses"] if address["id"] == address_id)
        validate_updated_postal(body, existing)

        if database == "mongodb":
            db.companies.update_one({"_id": uen}, {"$set": {"address": body.model_dump()}})

        else:
            # Lock the company, then make sure the edit does not duplicate another address.
            company_id = lock_company(db, uen)
            values = tuple(body.model_dump().values())
            check_duplicate_address(db, company_id, values, int(address_id))
            execute(db, "UPDATE Address SET " + ",".join(k + "=?" for k in SQL_ADDRESS_FIELDS) +
                    " WHERE company_id=? AND address_id=?", (*values, company_id, address_id))

        return envelope(read(db, database, uen), database)

# Remove an address without deleting its company.
@router.delete("/{uen}/addresses/{address_id}", status_code=204)
def delete_address(request: Request, database: Database, uen: Uen, address_id: str):
    with store(request, database) as db:
        # Check both the company and address ID before touching address data.
        company = read(db, database, uen)
        uen = company["uen"]
        address_exists(company, address_id)

        if database == "mongodb":
            # The MongoDB validator requires address to exist, so clear its fields instead.
            db.companies.update_one({"_id": uen}, {"$set": {"address": {k: None for k in ADDRESS_FIELDS}}})
        else:
            execute(db, "DELETE a FROM Address a JOIN Company c ON a.company_id=c.company_id WHERE c.uen=? AND a.address_id=?", (uen, address_id))

    return Response(status_code=204)
