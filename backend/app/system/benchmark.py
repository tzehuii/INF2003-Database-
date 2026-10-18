"""Read-only performance benchmark comparing MariaDB and MongoDB.

Each workload answers one question the application asks, written the natural
way for each database: joins in MariaDB, embedded documents and batched ``$in``
lookups in MongoDB. Both databases get the same parameters in the same order,
and the answers are compared, so a fast wrong answer cannot win.

Timing is taken around the database calls only (driver round trip plus any
merging the workload needs in Python), never around HTTP or JSON rendering.

For each workload and database the benchmark records:

- first run: the first call, before warm-up. Both servers keep data in memory
  between runs, so this is not a true cold cache, only an unwarmed query.
- latency: ``iterations`` calls one at a time after a short warm-up, reported as
  average, p95 (95% of calls were at least this fast), min and max.
- throughput: completed calls per second with N calls in flight at once, one
  connection per worker thread, for ``duration_seconds`` per level.

Nothing here writes to either database.
"""

from __future__ import annotations

import math
import os
import platform
import random
import re
import threading
import time
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Callable

import mariadb
import pymongo

from ..databases import connect_mariadb
from .jobs import Job

DATABASES = ("mariadb", "mongodb")
WARMUP_CALLS = 5
CHECK_CALLS = 5  # answers compared between the two databases
LATENCY_TIME_CAP_SECONDS = 20
SAMPLE_SEED = 2003
SAMPLE_SIZE = 200

CONCURRENCY_CHOICES = (1, 2, 4, 8, 16, 32)

# Common words in company names. Each search stops at the first 20 matches in
# UEN order, so frequent words finish early and rarer ones scan further.
SEARCH_TERMS = ("TRADING", "ENGINEERING", "HOLDINGS", "CONSTRUCTION", "LOGISTICS",
                "FOOD", "DESIGN", "MARINE", "MEDICAL", "TECHNOLOGY")


def text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, Decimal):
        return f"{value:.2f}"
    if hasattr(value, "to_decimal"):
        return f"{value.to_decimal():.2f}"
    return str(value)


def sql(connection, query: str, params: tuple = ()) -> list[tuple]:
    cursor = connection.cursor()
    try:
        cursor.execute(query, params)
        return cursor.fetchall()
    finally:
        cursor.close()


# --------------------------------------------------------------------------
# Query plans
# --------------------------------------------------------------------------

def mariadb_plan(connection, query: str, params: tuple = (), aliases: dict[str, str] | None = None) -> list[str]:
    """Summarise EXPLAIN as one line per table: which index, and whether it scans.

    EXPLAIN names tables by their alias in the query, so ``aliases`` maps them
    back to table names for display.
    """

    aliases = aliases or {}
    cursor = connection.cursor()
    try:
        cursor.execute("EXPLAIN " + query, params)
        columns = [column[0] for column in cursor.description]
        lines = []
        for row in cursor.fetchall():
            step = dict(zip(columns, row))
            table = step["table"] or ""
            table = "subquery result" if table.startswith("<derived") else aliases.get(table, table)
            access = f"index {step['key']}" if step["key"] else "no index"
            if step["type"] == "ALL":
                access = "full table scan"
            elif step["type"] == "index":
                access += " (full index scan)"
            lines.append(f"{table}: {access}")
        return lines
    finally:
        cursor.close()


def _winning_plans(node: Any) -> list[dict]:
    found = []
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "winningPlan" and isinstance(value, dict):
                found.append(value)
            else:
                found.extend(_winning_plans(value))
    elif isinstance(node, list):
        for item in node:
            found.extend(_winning_plans(item))
    return found


def _stages(node: Any, stages: set, indexes: set, filtered: list) -> None:
    if isinstance(node, dict):
        if "stage" in node:
            stages.add(node["stage"])
            if node.get("filter") and node["stage"] in ("FETCH", "COLLSCAN"):
                filtered.append(True)
        if "indexName" in node:
            indexes.add(node["indexName"])
        for value in node.values():
            _stages(value, stages, indexes, filtered)
    elif isinstance(node, list):
        for item in node:
            _stages(item, stages, indexes, filtered)


def mongodb_plan(collection_name: str, explain: dict) -> str:
    """Summarise a MongoDB explain result for one collection."""

    stages, indexes, filtered = set(), set(), []
    for plan in _winning_plans(explain):
        _stages(plan, stages, indexes, filtered)
    if "COLLSCAN" in stages:
        access = "full collection scan"
    elif indexes:
        access = "index " + ", ".join(sorted(indexes))
        if filtered:
            access += " (checks every document it reads)"
    elif any("IDHACK" in stage or "EXPRESS" in stage for stage in stages):
        access = "index _id_"
    else:
        access = ", ".join(sorted(stages)) or "no plan reported"
    return f"{collection_name}: {access}"


# --------------------------------------------------------------------------
# Workloads
# --------------------------------------------------------------------------

class Workload:
    id: str
    label: str
    description: str
    mariadb_method: str
    mongodb_method: str

    def parameters(self, context: dict) -> list:
        return [None]

    def mariadb(self, connection, parameter):
        raise NotImplementedError

    def mongodb(self, db, parameter):
        raise NotImplementedError

    def mariadb_plan(self, connection, parameter) -> list[str]:
        raise NotImplementedError

    def mongodb_plan(self, db, parameter) -> list[str]:
        raise NotImplementedError

    def describe(self) -> dict[str, str]:
        return {"id": self.id, "label": self.label, "description": self.description,
                "mariadb_method": self.mariadb_method, "mongodb_method": self.mongodb_method}


class CompanyLookup(Workload):
    id = "company_lookup"
    label = "Company lookup by UEN"
    description = "Read one company's name, status and registration date by its UEN. A point read on a unique key."
    mariadb_method = "1 query on Company"
    mongodb_method = "1 find on companies"

    QUERY = "SELECT company_name, status, registration_date FROM Company WHERE uen = ?"

    def parameters(self, context):
        return context["uens"]

    def mariadb(self, connection, uen):
        rows = sql(connection, self.QUERY, (uen,))
        return tuple(text(value) for value in rows[0]) if rows else None

    def mongodb(self, db, uen):
        document = db.companies.find_one({"_id": uen}, {"name": 1, "status": 1, "registration.incorporation_date": 1})
        if document is None:
            return None
        return (text(document.get("name")), text(document.get("status")),
                text((document.get("registration") or {}).get("incorporation_date")))

    def mariadb_plan(self, connection, uen):
        return mariadb_plan(connection, self.QUERY, (uen,))

    def mongodb_plan(self, db, uen):
        return [mongodb_plan("companies", db.companies.find({"_id": uen}).limit(1).explain())]


ADDRESS_COLUMNS = ("address_type", "block", "street_name", "level_no", "unit_no", "building_name", "postal_code")
ADDRESS_KEYS = ("type", "block", "street_name", "level_no", "unit_no", "building_name", "postal_code")


class CompanyProfile(Workload):
    id = "company_profile"
    label = "Full company profile"
    description = ("Read a company with its address, industries (with titles) and former names, as the company "
                   "page shows it. MariaDB joins related tables; MongoDB reads one document plus industry titles.")
    mariadb_method = "3 queries: Company + Address join, industries join, former names"
    mongodb_method = "2 finds: the company document, then industry titles"

    COMPANY = ("SELECT c.company_id, c.company_name, c.status, c.registration_date, "
               + ", ".join(f"a.{column}" for column in ADDRESS_COLUMNS)
               + " FROM Company c LEFT JOIN Address a ON a.company_id = c.company_id WHERE c.uen = ?")
    INDUSTRIES = ("SELECT LOWER(ca.activity_type), b.ssic_code, b.ssic_title FROM CompanyActivity ca "
                  "JOIN BusinessActivity b ON b.activity_id = ca.activity_id WHERE ca.company_id = ?")
    FORMER = "SELECT former_name FROM FormerEntityName WHERE company_id = ? ORDER BY source_slot"

    def parameters(self, context):
        return context["uens"]

    def mariadb(self, connection, uen):
        rows = sql(connection, self.COMPANY, (uen,))
        if not rows:
            return None
        company = rows[0]
        industries = sql(connection, self.INDUSTRIES, (company[0],))
        former = sql(connection, self.FORMER, (company[0],))
        return (text(company[1]), text(company[2]), text(company[3]), tuple(text(v) for v in company[4:]),
                tuple(sorted(industries)), tuple(name for (name,) in former))

    def mongodb(self, db, uen):
        document = db.companies.find_one({"_id": uen})
        if document is None:
            return None
        codes = {kind: (document["activities"].get(kind) or {}).get("code") for kind in ("primary", "secondary")}
        codes = {kind: code for kind, code in codes.items() if code}
        titles = {item["_id"]: item["title"] for item in db.industries.find({"_id": {"$in": list(codes.values())}}, {"title": 1})}
        address = document.get("address") or {}
        former = sorted(document.get("former_names") or [], key=lambda item: item["source_slot"])
        return (text(document.get("name")), text(document.get("status")),
                text((document.get("registration") or {}).get("incorporation_date")),
                tuple(text(address.get(key)) for key in ADDRESS_KEYS),
                tuple(sorted((kind, code, titles.get(code)) for kind, code in codes.items())),
                tuple(item["name"] for item in former))

    def mariadb_plan(self, connection, uen):
        company_id = sql(connection, "SELECT company_id FROM Company WHERE uen = ?", (uen,))[0][0]
        aliases = {"c": "Company", "a": "Address", "ca": "CompanyActivity", "b": "BusinessActivity"}
        return (mariadb_plan(connection, self.COMPANY, (uen,), aliases)
                + mariadb_plan(connection, self.INDUSTRIES, (company_id,), aliases)
                + mariadb_plan(connection, self.FORMER, (company_id,)))

    def mongodb_plan(self, db, uen):
        return [mongodb_plan("companies", db.companies.find({"_id": uen}).limit(1).explain()),
                mongodb_plan("industries", db.industries.find({"_id": {"$in": ["01410", "46510"]}}).explain())]


class NameSearch(Workload):
    id = "name_search"
    label = "Company name search"
    description = ("Find the first 20 companies, in UEN order, whose name contains a word, as the Companies page "
                   "does. A 'contains' match cannot use a name index in either database.")
    mariadb_method = "1 query: LIKE '%word%' ordered by UEN"
    mongodb_method = "1 find: case-insensitive regex sorted by _id"

    QUERY = "SELECT uen FROM Company WHERE company_name LIKE ? ORDER BY uen LIMIT 20"

    def parameters(self, context):
        return list(SEARCH_TERMS)

    def mariadb(self, connection, term):
        return tuple(uen for (uen,) in sql(connection, self.QUERY, (f"%{term}%",)))

    def _find(self, db, term):
        return db.companies.find({"name": {"$regex": re.escape(term), "$options": "i"}}, {"_id": 1}).sort("_id", 1).limit(20)

    def mongodb(self, db, term):
        return tuple(document["_id"] for document in self._find(db, term))

    def mariadb_plan(self, connection, term):
        return mariadb_plan(connection, self.QUERY, (f"%{term}%",))

    def mongodb_plan(self, db, term):
        return [mongodb_plan("companies", self._find(db, term).explain())]


class AgencyTotals(Workload):
    id = "agency_totals"
    label = "Award totals per agency"
    description = "Total awarded amount and number of awards for every government agency. A grouped aggregate over all 17,825 awards."
    mariadb_method = "1 query: TenderAward joined to Tender and GovernmentAgency, GROUP BY"
    mongodb_method = "1 aggregation: $unwind awards, $group by agency"

    QUERY = ("SELECT g.agency_name, SUM(a.awarded_amt), COUNT(*) FROM TenderAward a "
             "JOIN Tender t ON t.tender_id = a.tender_id JOIN GovernmentAgency g ON g.agency_id = t.agency_id "
             "GROUP BY g.agency_name")
    PIPELINE = [{"$unwind": "$awards"},
                {"$group": {"_id": "$agency_name", "total": {"$sum": "$awards.amount"}, "awards": {"$sum": 1}}}]

    def mariadb(self, connection, _):
        return tuple(sorted((agency, text(total), count) for agency, total, count in sql(connection, self.QUERY)))

    def mongodb(self, db, _):
        return tuple(sorted((row["_id"], text(row["total"]), row["awards"]) for row in db.tenders.aggregate(self.PIPELINE)))

    def mariadb_plan(self, connection, _):
        return mariadb_plan(connection, self.QUERY, aliases={"a": "TenderAward", "t": "Tender", "g": "GovernmentAgency"})

    def mongodb_plan(self, db, _):
        return [mongodb_plan("tenders", db.command("aggregate", "tenders", pipeline=self.PIPELINE, explain=True))]


class IndustryTotals(Workload):
    id = "industry_totals"
    label = "Award totals per industry section"
    description = ("Total awarded amount per SSIC section (A, B, C ...) for awards whose supplier is linked to one "
                   "company. Crosses awards, suppliers, companies and the industry tree.")
    mariadb_method = "1 query joining 9 tables (award, supplier link, company industry, 5 levels of the SSIC tree)"
    mongodb_method = "4 batched finds (tenders, suppliers, companies, industries) merged in Python, as the Industry Awards page does"

    QUERY = """
        SELECT s1.ssic_code, SUM(a.awarded_amt), COUNT(*) FROM TenderAward a
        JOIN (SELECT supplier_id, MIN(company_id) company_id FROM SupplierEntityMatch
              GROUP BY supplier_id HAVING COUNT(*) = 1) m ON m.supplier_id = a.supplier_id
        JOIN CompanyActivity ca ON ca.company_id = m.company_id AND ca.activity_type = 'Primary'
        JOIN BusinessActivity s5 ON s5.activity_id = ca.activity_id
        JOIN BusinessActivity s4 ON s4.activity_id = s5.parent_activity_id
        JOIN BusinessActivity s3 ON s3.activity_id = s4.parent_activity_id
        JOIN BusinessActivity s2 ON s2.activity_id = s3.parent_activity_id
        JOIN BusinessActivity s1 ON s1.activity_id = s2.parent_activity_id
        GROUP BY s1.ssic_code"""

    def mariadb(self, connection, _):
        return tuple(sorted((section, text(total), count) for section, total, count in sql(connection, self.QUERY)))

    def mongodb(self, db, _):
        tenders = list(db.tenders.find({}, {"awards.supplier_id": 1, "awards.amount": 1}))
        names = list({award["supplier_id"] for tender in tenders for award in tender["awards"]})
        suppliers = {item["_id"]: item["match"]["company_uen"] for item in db.suppliers.find(
            {"_id": {"$in": names}, "match.status": "accepted"}, {"match.company_uen": 1})}
        companies = {item["_id"]: item["activities"]["primary"]["code"] for item in db.companies.find(
            {"_id": {"$in": list(set(suppliers.values()))}}, {"activities.primary.code": 1})}
        sections = {item["_id"]: item["ancestor_codes"][0] for item in db.industries.find(
            {"level": "Sub-class"}, {"ancestor_codes": 1})}
        totals = defaultdict(lambda: [Decimal(0), 0])
        for tender in tenders:
            for award in tender["awards"]:
                uen = suppliers.get(award["supplier_id"])
                section = sections.get(companies.get(uen)) if uen else None
                if section:
                    totals[section][0] += award["amount"].to_decimal()
                    totals[section][1] += 1
        return tuple(sorted((section, text(total), count) for section, (total, count) in totals.items()))

    def mariadb_plan(self, connection, _):
        levels = {f"s{depth}": f"BusinessActivity (level {depth})" for depth in range(1, 6)}
        return mariadb_plan(connection, self.QUERY, aliases={"a": "TenderAward", "ca": "CompanyActivity", **levels})

    def mongodb_plan(self, db, _):
        return [mongodb_plan("tenders", db.tenders.find({}, {"awards": 1}).explain()),
                mongodb_plan("suppliers", db.suppliers.find({"_id": {"$in": ["a", "b"]}, "match.status": "accepted"}).explain()),
                mongodb_plan("companies", db.companies.find({"_id": {"$in": ["a", "b"]}}).explain()),
                mongodb_plan("industries", db.industries.find({"level": "Sub-class"}).explain())]


WORKLOADS: dict[str, Workload] = {w.id: w for w in (CompanyLookup(), CompanyProfile(), NameSearch(),
                                                     AgencyTotals(), IndustryTotals())}


# --------------------------------------------------------------------------
# Measurement
# --------------------------------------------------------------------------

def percentile(ordered: list[float], fraction: float) -> float:
    """Nearest-rank percentile of an already sorted list."""

    return ordered[max(0, math.ceil(fraction * len(ordered)) - 1)]


def stats(latencies_ms: list[float]) -> dict[str, float]:
    if not latencies_ms:
        return {}
    ordered = sorted(latencies_ms)
    return {
        "avg_ms": round(sum(ordered) / len(ordered), 3),
        "p95_ms": round(percentile(ordered, 0.95), 3),
        "min_ms": round(ordered[0], 3),
        "max_ms": round(ordered[-1], 3),
    }


def _call(workload: Workload, database: str) -> Callable:
    return workload.mariadb if database == "mariadb" else workload.mongodb


def latency_phase(job: Job, workload: Workload, database: str, handle, parameters: list,
                  iterations: int) -> tuple[dict, list]:
    """Time calls one at a time. Returns the stats and the first answers."""

    run = _call(workload, database)
    count = len(parameters)

    started = time.perf_counter()
    run(handle, parameters[0])
    first_ms = (time.perf_counter() - started) * 1000

    for index in range(WARMUP_CALLS):
        job.check_cancelled()
        run(handle, parameters[(index + 1) % count])

    latencies, answers = [], []
    phase_started = time.perf_counter()
    capped = False
    for index in range(iterations):
        job.check_cancelled()
        started = time.perf_counter()
        answer = run(handle, parameters[index % count])
        latencies.append((time.perf_counter() - started) * 1000)
        if index < CHECK_CALLS:
            answers.append(answer)
        if time.perf_counter() - phase_started > LATENCY_TIME_CAP_SECONDS and index + 1 < iterations:
            capped = True
            break

    return {"first_run_ms": round(first_ms, 3), "calls": len(latencies), "capped": capped, **stats(latencies)}, answers


def throughput_phase(job: Job, workload: Workload, database: str, settings, mongo_db, parameters: list,
                     workers: int, duration: float) -> dict:
    """Keep ``workers`` calls in flight for ``duration`` seconds and count completions."""

    run = _call(workload, database)
    count = len(parameters)
    connections = [connect_mariadb(settings) for _ in range(workers)] if database == "mariadb" else []
    handles = connections or [mongo_db] * workers
    barrier = threading.Barrier(workers + 1)
    window = {"start": 0.0, "deadline": 0.0}
    latencies: list[list[float]] = [[] for _ in range(workers)]
    finished = [0.0] * workers
    errors = [0] * workers

    def worker(slot: int) -> None:
        barrier.wait()
        position = slot
        while time.perf_counter() < window["deadline"] and not job.cancel_requested:
            started = time.perf_counter()
            try:
                run(handles[slot], parameters[position % count])
            except Exception:
                errors[slot] += 1
                break
            latencies[slot].append((time.perf_counter() - started) * 1000)
            position += workers
        finished[slot] = time.perf_counter()

    threads = [threading.Thread(target=worker, args=(slot,), daemon=True) for slot in range(workers)]
    try:
        for thread in threads:
            thread.start()
        window["start"] = time.perf_counter()
        window["deadline"] = window["start"] + duration
        barrier.wait()
        for thread in threads:
            thread.join()
    finally:
        for connection in connections:
            connection.close()
    job.check_cancelled()

    elapsed = max(finished) - window["start"]
    every = [value for slot in latencies for value in slot]
    return {
        "workers": workers,
        "duration_seconds": round(elapsed, 3),
        "calls": len(every),
        "errors": sum(errors),
        "calls_per_second": round(len(every) / elapsed, 2) if elapsed > 0 else 0,
        **stats(every),
    }


def environment(settings, mongo_client) -> dict[str, Any]:
    """Versions, memory settings and data sizes, for the report."""

    connection = connect_mariadb(settings)
    try:
        version, buffer_pool = sql(connection, "SELECT VERSION(), @@innodb_buffer_pool_size")[0]
        data_bytes, index_bytes = sql(connection, """SELECT SUM(data_length), SUM(index_length)
            FROM information_schema.TABLES WHERE table_schema = ?""", (settings.mariadb_database,))[0]
    finally:
        connection.close()

    db = mongo_client[settings.mongodb_db_name]
    status = db.command("serverStatus")
    db_stats = db.command("dbStats")
    return {
        "mariadb_version": version,
        "mongodb_version": mongo_client.server_info()["version"],
        "mariadb_buffer_pool_mb": round(int(buffer_pool) / 1048576),
        "mongodb_cache_mb": round(status.get("wiredTiger", {}).get("cache", {}).get("maximum bytes configured", 0) / 1048576),
        "mariadb_data_mb": round(int(data_bytes or 0) / 1048576),
        "mariadb_index_mb": round(int(index_bytes or 0) / 1048576),
        "mongodb_data_mb": round(db_stats.get("dataSize", 0) / 1048576),
        "mongodb_storage_mb": round(db_stats.get("storageSize", 0) / 1048576),
        "mongodb_index_mb": round(db_stats.get("indexSize", 0) / 1048576),
        "cpu_count": os.cpu_count(),
        "platform": platform.platform(),
        "python_version": platform.python_version(),
        "mariadb_connector_version": mariadb.__version__,
        "pymongo_version": pymongo.version,
    }


def sample_uens(settings) -> list[str]:
    """A fixed random sample of UENs, the same on every run."""

    connection = connect_mariadb(settings)
    try:
        highest = sql(connection, "SELECT MAX(company_id) FROM Company")[0][0]
        ids = random.Random(SAMPLE_SEED).sample(range(1, highest + 1), min(SAMPLE_SIZE * 2, highest))
        marks = ",".join("?" for _ in ids)
        uens = [uen for (uen,) in sql(connection, f"SELECT uen FROM Company WHERE company_id IN ({marks})", tuple(ids))]
    finally:
        connection.close()
    random.Random(SAMPLE_SEED).shuffle(uens)
    return uens[:SAMPLE_SIZE]


def run(job: Job, settings, mongo_client, workloads: list[str], iterations: int,
        concurrency: list[int], duration_seconds: int) -> dict[str, Any]:
    mongo_db = mongo_client[settings.mongodb_db_name]
    selected = [WORKLOADS[workload_id] for workload_id in workloads]
    steps = len(selected) * len(DATABASES) * (1 + len(concurrency))
    step = 0

    job.progress("Reading database versions and sizes", step, steps)
    result: dict[str, Any] = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "environment": environment(settings, mongo_client),
        "workloads": [],
    }
    # Published as it fills, so a cancelled run keeps the workloads it finished.
    job.result = result

    job.progress("Choosing sample companies", step, steps)
    context = {"uens": sample_uens(settings)}

    for workload in selected:
        parameters = workload.parameters(context)
        entry: dict[str, Any] = {**workload.describe(), "plans": {}, "latency": {}, "throughput": [],
                                 "results_match": None, "mismatched_checks": 0}

        answers = {}
        for database in DATABASES:
            step += 1
            job.progress(f"{workload.label}: {label(database)} latency", step, steps)
            if database == "mariadb":
                connection = connect_mariadb(settings)
                try:
                    entry["plans"][database] = workload.mariadb_plan(connection, parameters[0])
                    entry["latency"][database], answers[database] = latency_phase(
                        job, workload, database, connection, parameters, iterations)
                finally:
                    connection.close()
            else:
                entry["plans"][database] = workload.mongodb_plan(mongo_db, parameters[0])
                entry["latency"][database], answers[database] = latency_phase(
                    job, workload, database, mongo_db, parameters, iterations)

        mismatched = sum(1 for a, b in zip(answers["mariadb"], answers["mongodb"]) if a != b)
        entry["results_match"] = mismatched == 0
        entry["mismatched_checks"] = mismatched
        entry["checked_calls"] = min(len(answers["mariadb"]), len(answers["mongodb"]))

        for workers in concurrency:
            level = {"workers": workers}
            for database in DATABASES:
                step += 1
                job.progress(f"{workload.label}: {label(database)} throughput, {workers} at once", step, steps)
                level[database] = throughput_phase(job, workload, database, settings, mongo_db,
                                                   parameters, workers, duration_seconds)
            entry["throughput"].append(level)

        result["workloads"].append(entry)

    result["finished_at"] = datetime.now(timezone.utc).isoformat()
    job.progress("Finished", steps, steps)
    return result


def label(database: str) -> str:
    return "MariaDB" if database == "mariadb" else "MongoDB"
