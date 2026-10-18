"""Compare the MariaDB and MongoDB copies of the project data.

Two checks are offered.

- ``summary`` counts the top-level records on each side. It skips data MongoDB
  embeds inside company documents (addresses, former names, industry links),
  because counting those means reading all 2.1 million documents.
- ``full_check`` compares every field of every record, embedded data included.
  It takes a few minutes, so it runs as a background job.

The full check streams companies from both databases in UEN order and walks the
two streams side by side, so memory stays flat however many companies there
are. MariaDB sorts with ``utf8mb4_bin`` so both sides use the same code-point
order as MongoDB's ``_id`` index. The smaller tables are compared in memory.

Nothing here writes to either database.
"""

from __future__ import annotations

import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Iterator

from ..databases import connect_mariadb
from .jobs import Job

EXAMPLE_LIMIT = 5
FETCH_SIZE = 20000
MONGO_BATCH_SIZE = 5000
PROGRESS_EVERY = 20000

# API address key, MariaDB column.
ADDRESS_FIELDS = (
    ("type", "address_type"), ("block", "block"), ("street_name", "street_name"),
    ("level_no", "level_no"), ("unit_no", "unit_no"), ("building_name", "building_name"),
    ("postal_code", "postal_code"), ("other_address_line1", "other_address_line1"),
    ("other_address_line2", "other_address_line2"),
)

# A supplier counts as linked to a company only when it has exactly one
# candidate, the same rule the public pages apply to both databases.
ACCEPTED_SQL = """SELECT COUNT(*) FROM (SELECT supplier_id FROM SupplierEntityMatch
                  GROUP BY supplier_id HAVING COUNT(*) = 1) accepted"""
AMBIGUOUS_SQL = """SELECT COUNT(*) FROM (SELECT supplier_id FROM SupplierEntityMatch
                   GROUP BY supplier_id HAVING COUNT(*) > 1) ambiguous"""


def _sum_sizes(collection, field: str) -> int:
    rows = list(collection.aggregate([{"$group": {"_id": None, "n": {"$sum": {"$size": f"${field}"}}}}]))
    return rows[0]["n"] if rows else 0


# key, label, MariaDB count query, MongoDB count.
SUMMARY_COUNTS = (
    ("companies", "Companies", "SELECT COUNT(*) FROM Company",
     lambda db: db.companies.count_documents({})),
    ("industries", "Industries (SSIC catalogue)", "SELECT COUNT(*) FROM BusinessActivity",
     lambda db: db.industries.count_documents({})),
    ("agencies", "Government agencies", "SELECT COUNT(*) FROM GovernmentAgency",
     lambda db: len(db.tenders.distinct("agency_name"))),
    ("tenders", "Tenders", "SELECT COUNT(*) FROM Tender",
     lambda db: db.tenders.count_documents({})),
    ("awards", "Tender awards", "SELECT COUNT(*) FROM TenderAward",
     lambda db: _sum_sizes(db.tenders, "awards")),
    ("suppliers", "Suppliers", "SELECT COUNT(*) FROM Supplier",
     lambda db: db.suppliers.count_documents({})),
    ("accepted_links", "Suppliers linked to one company", ACCEPTED_SQL,
     lambda db: db.suppliers.count_documents({"match.status": "accepted"})),
    ("ambiguous_links", "Suppliers with several candidate companies", AMBIGUOUS_SQL,
     lambda db: db.suppliers.count_documents({"match.status": "ambiguous"})),
    ("saved_lists", "Saved lists", "SELECT COUNT(*) FROM SavedList",
     lambda db: db.saved_lists.count_documents({})),
    ("saved_entries", "Saved list entries", "SELECT COUNT(*) FROM SavedListEntry",
     lambda db: db.saved_list_entries.count_documents({})),
)


def summary(settings, mongo_db) -> dict[str, Any]:
    """Count the top-level records in both databases, one thread per database."""

    def mariadb_counts():
        started = time.perf_counter()
        connection = connect_mariadb(settings)
        try:
            cursor = connection.cursor()
            counts = {}
            for key, _, query, _ in SUMMARY_COUNTS:
                cursor.execute(query)
                counts[key] = cursor.fetchone()[0]
            return counts, time.perf_counter() - started
        finally:
            connection.close()

    def mongodb_counts():
        started = time.perf_counter()
        return {key: count(mongo_db) for key, _, _, count in SUMMARY_COUNTS}, time.perf_counter() - started

    with ThreadPoolExecutor(max_workers=2) as pool:
        mariadb_future, mongodb_future = pool.submit(mariadb_counts), pool.submit(mongodb_counts)
        (mariadb, mariadb_seconds), (mongodb, mongodb_seconds) = mariadb_future.result(), mongodb_future.result()

    return {
        "items": [{"key": key, "label": label, "mariadb": mariadb[key], "mongodb": mongodb[key],
                   "match": mariadb[key] == mongodb[key]} for key, label, _, _ in SUMMARY_COUNTS],
        "mariadb_ms": round(mariadb_seconds * 1000),
        "mongodb_ms": round(mongodb_seconds * 1000),
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


# --------------------------------------------------------------------------
# Full check
# --------------------------------------------------------------------------

def text(value: Any) -> str | None:
    """One comparable text form for values both drivers return differently."""

    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return f"{value:.2f}"
    if hasattr(value, "to_decimal"):  # bson Decimal128
        return f"{value.to_decimal():.2f}"
    return str(value)


def classify(mariadb: Any, mongodb: Any) -> str:
    if mariadb is None:
        return "missing in MariaDB"
    if mongodb is None:
        return "missing in MongoDB"
    if isinstance(mariadb, str) and isinstance(mongodb, str):
        if mariadb.strip() == mongodb.strip():
            return "whitespace only"
        if mariadb.casefold() == mongodb.casefold():
            return "letter case only"
    return "different value"


class Area:
    """Differences found in one kind of record."""

    def __init__(self, key: str, label: str, unit: str):
        self.key, self.label, self.unit = key, label, unit
        self.mariadb_count = 0
        self.mongodb_count = 0
        self.compared = 0
        self.only = {"mariadb": [0, []], "mongodb": [0, []]}
        self.differences: dict[tuple[str, str], list] = {}

    def only_in(self, side: str, key: str, detail: str | None = None) -> None:
        entry = self.only[side]
        entry[0] += 1
        if len(entry[1]) < EXAMPLE_LIMIT:
            entry[1].append({"key": key, "detail": detail})

    def differ(self, field: str, key: str, mariadb: Any, mongodb: Any, kind: str | None = None) -> None:
        kind = kind or classify(mariadb, mongodb)
        entry = self.differences.setdefault((field, kind), [0, []])
        entry[0] += 1
        if len(entry[1]) < EXAMPLE_LIMIT:
            entry[1].append({"key": key, "mariadb": mariadb, "mongodb": mongodb})

    def compare(self, key: str, mariadb: dict[str, Any], mongodb: dict[str, Any]) -> None:
        for field, value in mariadb.items():
            if value != mongodb[field]:
                self.differ(field, key, value, mongodb[field])

    def to_dict(self) -> dict[str, Any]:
        differences = [
            {"field": field, "kind": kind, "count": count, "examples": examples}
            for (field, kind), (count, examples) in sorted(self.differences.items(), key=lambda item: -item[1][0])
        ]
        return {
            "key": self.key,
            "label": self.label,
            "mariadb_count": self.mariadb_count,
            "mongodb_count": self.mongodb_count,
            "compared": self.compared,
            "compared_unit": self.unit,
            "only_in_mariadb": {"count": self.only["mariadb"][0], "examples": self.only["mariadb"][1]},
            "only_in_mongodb": {"count": self.only["mongodb"][0], "examples": self.only["mongodb"][1]},
            "differences": differences,
            "difference_count": sum(item["count"] for item in differences)
            + self.only["mariadb"][0] + self.only["mongodb"][0],
        }


class OrderedRows:
    """Rows from one stream, checked to arrive in key order, read one key at a time."""

    def __init__(self, rows: Iterator, key=lambda row: row[0], name: str = "stream"):
        self._rows, self._key, self._name = iter(rows), key, name
        self._last: str | None = None
        self._head = self._advance()

    def _advance(self):
        row = next(self._rows, None)
        if row is not None:
            current = self._key(row)
            # A sort-order mismatch would silently pair the wrong records, so stop instead.
            if self._last is not None and current < self._last:
                raise RuntimeError(f"{self._name} is not in UEN order")
            self._last = current
        return row

    @property
    def key(self) -> str | None:
        return None if self._head is None else self._key(self._head)

    def pop(self):
        row, self._head = self._head, self._advance()
        return row

    def take(self, key: str) -> list:
        """Return every row for ``key``, skipping rows with smaller keys."""

        while self._head is not None and self._key(self._head) < key:
            self.pop()
        rows = []
        while self._head is not None and self._key(self._head) == key:
            rows.append(self.pop())
        return rows


def _sql_rows(settings, query: str, params: tuple = ()) -> Iterator[tuple]:
    """Stream a large result set on its own unbuffered connection."""

    connection = connect_mariadb(settings)
    try:
        cursor = connection.cursor(buffered=False)
        cursor.execute(query, params)
        while True:
            rows = cursor.fetchmany(FETCH_SIZE)
            if not rows:
                break
            yield from rows
        cursor.close()
    finally:
        connection.close()


def _sql_all(settings, query: str) -> list[tuple]:
    connection = connect_mariadb(settings)
    try:
        cursor = connection.cursor()
        cursor.execute(query)
        return cursor.fetchall()
    finally:
        connection.close()


def _mariadb_address(row) -> dict[str, str | None] | None:
    address = {key: text(value) for (key, _), value in zip(ADDRESS_FIELDS, row)}
    return address if any(address.values()) else None


def _compare_companies(job: Job, settings, mongo_db, areas: dict[str, Area]) -> None:
    companies, addresses = areas["companies"], areas["addresses"]
    former_names, activities = areas["former_names"], areas["activities"]
    binary = "COLLATE utf8mb4_bin"
    address_columns = ", ".join(f"a.{column}" for _, column in ADDRESS_FIELDS)

    sql_companies = OrderedRows(_sql_rows(settings, f"""
        SELECT uen, company_name, normalized_name, status, registration_date
        FROM Company ORDER BY uen {binary}"""), name="MariaDB companies")
    sql_addresses = OrderedRows(_sql_rows(settings, f"""
        SELECT c.uen, {address_columns} FROM Address a JOIN Company c ON c.company_id = a.company_id
        ORDER BY c.uen {binary}, a.address_id"""), name="MariaDB addresses")
    sql_former = OrderedRows(_sql_rows(settings, f"""
        SELECT c.uen, f.source_slot, f.former_name FROM FormerEntityName f
        JOIN Company c ON c.company_id = f.company_id ORDER BY c.uen {binary}, f.source_slot"""),
        name="MariaDB former names")
    sql_activities = OrderedRows(_sql_rows(settings, f"""
        SELECT c.uen, LOWER(ca.activity_type), b.ssic_code, ca.source_ssic_description, ca.user_described_activity
        FROM CompanyActivity ca JOIN Company c ON c.company_id = ca.company_id
        JOIN BusinessActivity b ON b.activity_id = ca.activity_id ORDER BY c.uen {binary}"""),
        name="MariaDB industry links")
    documents = OrderedRows(
        mongo_db.companies.find({}, {"name": 1, "normalized_name": 1, "status": 1,
                                     "registration.incorporation_date": 1, "address": 1,
                                     "former_names": 1, "activities": 1})
        .sort("_id", 1).batch_size(MONGO_BATCH_SIZE),
        key=lambda document: document["_id"], name="MongoDB companies")

    total = mongo_db.companies.estimated_document_count()
    processed = 0
    while sql_companies.key is not None or documents.key is not None:
        sql_key, mongo_key = sql_companies.key, documents.key
        if mongo_key is None or (sql_key is not None and sql_key < mongo_key):
            row = sql_companies.pop()
            companies.mariadb_count += 1
            companies.only_in("mariadb", row[0], row[1])
            for table in (sql_addresses, sql_former, sql_activities):
                table.take(row[0])
            continue

        document = documents.pop()
        uen = document["_id"]
        companies.mongodb_count += 1
        processed += 1
        if processed % PROGRESS_EVERY == 0:
            job.progress("Comparing companies, addresses, former names and industry links", processed, total)

        if sql_key != mongo_key:
            companies.only_in("mongodb", uen, document.get("name"))
            continue

        row = sql_companies.pop()
        companies.mariadb_count += 1
        companies.compared += 1
        registration = document.get("registration") or {}
        companies.compare(uen, {
            "name": text(row[1]), "normalized_name": text(row[2]), "status": text(row[3]),
            "registration_date": text(row[4]),
        }, {
            "name": text(document.get("name")), "normalized_name": text(document.get("normalized_name")),
            "status": text(document.get("status")), "registration_date": text(registration.get("incorporation_date")),
        })

        # Addresses: MariaDB may hold several rows, MongoDB embeds one object.
        sql_list = [address for address in (_mariadb_address(r[1:]) for r in sql_addresses.take(uen)) if address]
        embedded = {key: text((document.get("address") or {}).get(key)) for key, _ in ADDRESS_FIELDS}
        mongo_list = [embedded] if any(embedded.values()) else []
        addresses.mariadb_count += len(sql_list)
        addresses.mongodb_count += len(mongo_list)
        if len(sql_list) != len(mongo_list):
            addresses.differ("number of addresses", uen, str(len(sql_list)), str(len(mongo_list)), "different value")
        elif sql_list:
            addresses.compared += 1
            addresses.compare(uen, sql_list[0], mongo_list[0])

        sql_names = [(int(slot), name) for _, slot, name in sql_former.take(uen)]
        mongo_names = sorted((int(f["source_slot"]), f["name"]) for f in document.get("former_names") or [])
        former_names.mariadb_count += len(sql_names)
        former_names.mongodb_count += len(mongo_names)
        if sql_names or mongo_names:
            former_names.compared += 1
            if sql_names != mongo_names:
                former_names.differ("former names", uen, " | ".join(n for _, n in sql_names) or None,
                                    " | ".join(n for _, n in mongo_names) or None)

        sql_links = {kind: rest for _, kind, *rest in sql_activities.take(uen)}
        for kind in ("primary", "secondary"):
            link = (document.get("activities") or {}).get(kind) or {}
            mongo_link = [link.get("code"), text(link.get("source_description")), text(link.get("user_description"))]
            sql_link = sql_links.get(kind)
            activities.mariadb_count += sql_link is not None
            activities.mongodb_count += mongo_link[0] is not None
            if sql_link is None and mongo_link[0] is None:
                continue
            if sql_link is None or mongo_link[0] is None:
                activities.differ(f"{kind} industry", uen, sql_link and sql_link[0], mongo_link[0])
                continue
            activities.compared += 1
            activities.compare(uen, {
                f"{kind} industry code": sql_link[0], f"{kind} source description": text(sql_link[1]),
                f"{kind} user description": text(sql_link[2]),
            }, {
                f"{kind} industry code": mongo_link[0], f"{kind} source description": mongo_link[1],
                f"{kind} user description": mongo_link[2],
            })

    job.progress("Comparing companies, addresses, former names and industry links", processed, total)


def _compare_industries(settings, mongo_db, area: Area) -> None:
    mongo = {document["_id"]: document for document in mongo_db.industries.find()}
    area.mongodb_count = len(mongo)
    for code, title, level, parent in _sql_all(settings, """
            SELECT b.ssic_code, b.ssic_title, b.ssic_level, p.ssic_code FROM BusinessActivity b
            LEFT JOIN BusinessActivity p ON p.activity_id = b.parent_activity_id"""):
        area.mariadb_count += 1
        document = mongo.pop(code, None)
        if document is None:
            area.only_in("mariadb", code, title)
            continue
        area.compared += 1
        area.compare(code, {"title": title, "level": level, "parent code": parent},
                     {"title": document["title"], "level": document["level"], "parent code": document.get("parent_code")})
    for code, document in mongo.items():
        area.only_in("mongodb", code, document.get("title"))


def _compare_tenders(settings, mongo_db, tenders: Area, awards: Area) -> None:
    mongo = {document["_id"]: document for document in mongo_db.tenders.find()}
    tenders.mongodb_count = len(mongo)
    sql_awards = defaultdict(list)
    for tender_no, supplier, amount in _sql_all(settings, """
            SELECT t.tender_no, s.supplier_name_raw, a.awarded_amt FROM TenderAward a
            JOIN Tender t ON t.tender_id = a.tender_id JOIN Supplier s ON s.supplier_id = a.supplier_id"""):
        sql_awards[tender_no].append((supplier, text(amount)))
        awards.mariadb_count += 1
    awards.mongodb_count = sum(len(document["awards"]) for document in mongo.values())

    for tender_no, agency, description, status, award_date in _sql_all(settings, """
            SELECT t.tender_no, g.agency_name, t.tender_description, t.tender_status, t.award_date
            FROM Tender t JOIN GovernmentAgency g ON g.agency_id = t.agency_id"""):
        tenders.mariadb_count += 1
        document = mongo.pop(tender_no, None)
        if document is None:
            tenders.only_in("mariadb", tender_no, description)
            continue
        tenders.compared += 1
        tenders.compare(tender_no, {
            "agency": agency, "description": description, "status": text(status), "award date": text(award_date),
        }, {
            "agency": document["agency_name"], "description": document["description"],
            "status": text(document["status"]), "award date": text(document["award_date"]),
        })

        sql_list = sorted(sql_awards.get(tender_no, []))
        mongo_list = sorted((award["supplier_id"], text(award["amount"])) for award in document["awards"])
        if not sql_list and not mongo_list:
            continue
        awards.compared += 1
        if len(sql_list) != len(mongo_list):
            awards.differ("number of awards", tender_no, str(len(sql_list)), str(len(mongo_list)), "different value")
            continue
        for (sql_supplier, sql_amount), (mongo_supplier, mongo_amount) in zip(sql_list, mongo_list):
            if sql_supplier != mongo_supplier:
                awards.differ("supplier", tender_no, sql_supplier, mongo_supplier)
            if sql_amount != mongo_amount:
                awards.differ("amount", tender_no, sql_amount, mongo_amount)
    for tender_no, document in mongo.items():
        tenders.only_in("mongodb", tender_no, document.get("description"))


def _compare_suppliers(settings, mongo_db, area: Area) -> None:
    mongo = {document["_id"]: document for document in mongo_db.suppliers.find()}
    area.mongodb_count = len(mongo)
    candidates = defaultdict(list)
    for supplier, uen in _sql_all(settings, """
            SELECT s.supplier_name_raw, c.uen FROM SupplierEntityMatch m
            JOIN Supplier s ON s.supplier_id = m.supplier_id JOIN Company c ON c.company_id = m.company_id"""):
        candidates[supplier].append(uen)

    for supplier, normalized in _sql_all(settings, "SELECT supplier_name_raw, normalized_supplier_name FROM Supplier"):
        area.mariadb_count += 1
        document = mongo.pop(supplier, None)
        if document is None:
            area.only_in("mariadb", supplier)
            continue
        area.compared += 1
        match = document["match"]
        found = candidates.get(supplier, [])
        sql_status = "accepted" if len(found) == 1 else "ambiguous" if found else "unmatched"
        area.compare(supplier, {
            "normalized name": normalized,
            "link status": sql_status,
            "linked company": found[0] if len(found) == 1 else None,
            "candidate count": str(len(found)),
        }, {
            "normalized name": document["normalized_name"],
            "link status": match["status"],
            "linked company": match["company_uen"] if match["status"] == "accepted" else None,
            "candidate count": str(match["candidate_count"]),
        })
    for supplier in mongo:
        area.only_in("mongodb", supplier)


# key, label, what "compared" counts.
AREAS = (
    ("companies", "Companies", "companies"),
    ("addresses", "Addresses", "companies with an address"),
    ("former_names", "Former names", "companies with former names"),
    ("activities", "Company industry links", "industry links"),
    ("industries", "Industries (SSIC catalogue)", "industries"),
    ("tenders", "Tenders", "tenders"),
    ("awards", "Tender awards", "tenders with awards"),
    ("suppliers", "Suppliers and company links", "suppliers"),
)


def full_check(job: Job, settings, mongo_db) -> dict[str, Any]:
    """Compare every field of every record in both databases."""

    started = time.perf_counter()
    areas = {key: Area(key, label, unit) for key, label, unit in AREAS}

    job.progress("Comparing industries")
    _compare_industries(settings, mongo_db, areas["industries"])
    job.progress("Comparing tenders and awards")
    _compare_tenders(settings, mongo_db, areas["tenders"], areas["awards"])
    job.progress("Comparing suppliers and company links")
    _compare_suppliers(settings, mongo_db, areas["suppliers"])
    job.progress("Reading companies from both databases")
    _compare_companies(job, settings, mongo_db, areas)

    results = [area.to_dict() for area in areas.values()]
    return {
        "areas": results,
        "difference_count": sum(area["difference_count"] for area in results),
        "duration_seconds": round(time.perf_counter() - started, 1),
    }
