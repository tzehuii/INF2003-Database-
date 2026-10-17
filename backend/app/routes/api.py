"""Public company search, award analytics, and persistent saved companies."""
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal
from typing import Annotated
import re

from bson import ObjectId, Int64
from bson.errors import InvalidId
from fastapi import APIRouter, Query, Request, Response
from ..api_models import SavedListCreate, SavedListEntryCreate, normalize_saved_list_name
from .companies import store, sqlrows, execute, fail, day, mongo_day, registry_statuses, ADDRESS_FIELDS, UEN_PATTERN

router = APIRouter(prefix="/api", tags=["business"])
Database = Annotated[str, Query(pattern="^(mariadb|mongodb)$")]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0)]


def envelope(data, database, limit=None, offset=0, more=False):
    meta = {"database": database}
    if limit is not None:
        items = data.get("items", data.get("entries", []))
        meta["pagination"] = {"limit": limit, "offset": offset, "returned": len(items),
                              "has_more": more, "next_offset": offset + limit if more else None}
    return {"data": data, "meta": meta}


def page(items, database, limit, offset):
    return envelope({"items": items[offset:offset+limit]}, database, limit, offset, len(items)>offset+limit)


def date_range(start, end):
    if start and end and start > end:
        fail(422, "invalid_date_range", "Start date must not be after end date.")


def money(value):
    return format(value, ".2f")


def amount(value):
    return value.to_decimal() if hasattr(value, "to_decimal") else Decimal(str(value))


def percent(part, total):
    return money(part * 100 / total) if total else None


def sql_like(text):
    return "%" + text.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%"


def linked_uens(db, database, uens):
    if not uens:
        return set()
    if database == "mongodb":
        names = list(db.suppliers.find({"match.status": "accepted", "match.company_uen": {"$in": uens}}, {"_id": 1, "match.company_uen": 1}))
        mapping = {x["_id"]: x["match"]["company_uen"] for x in names}
        return {mapping[name] for name in db.tenders.distinct("awards.supplier_id", {"awards.supplier_id": {"$in": list(mapping)}}) if name in mapping}
    marks = ",".join("?" for _ in uens)
    rows = sqlrows(db, f"""SELECT DISTINCT c.uen FROM Company c
        JOIN SupplierEntityMatch m ON m.company_id=c.company_id
        JOIN (SELECT supplier_id FROM SupplierEntityMatch GROUP BY supplier_id HAVING COUNT(*)=1) accepted ON accepted.supplier_id=m.supplier_id
        JOIN TenderAward a ON a.supplier_id=m.supplier_id WHERE c.uen IN ({marks})""", tuple(uens))
    return {x["uen"] for x in rows}


def company_data(db, database, uen, detail=True):
    uen = uen.strip().upper()
    if database == "mongodb":
        doc = db.companies.find_one({"_id": uen})
        if not doc:
            fail(404, "company_not_found", "Company not found.")
        codes = [v.get("code") for v in (doc.get("activities") or {}).values() if v and v.get("code")]
        titles = {x["_id"]: x.get("title") for x in db.industries.find({"_id": {"$in": codes}}, {"title": 1})}
        activities = {}
        for kind in ["primary", "secondary"]:
            a = (doc.get("activities") or {}).get(kind) or {}
            activities[kind] = {"code": a.get("code"), "title": titles.get(a.get("code")), "source_description": a.get("source_description")} if a.get("code") else None
        item = {"uen": uen, "name": doc.get("name"), "status": doc.get("status") or "Unknown",
                "incorporation_date": day((doc.get("registration") or {}).get("incorporation_date")),
                "addresses": [doc["address"]] if doc.get("address") and any(doc["address"].values()) else [],
                "address": doc.get("address"), "former_names": [x["name"] for x in doc.get("former_names", [])], "activities": activities}
    else:
        rows = sqlrows(db, "SELECT * FROM Company WHERE uen=?", (uen,))
        if not rows:
            fail(404, "company_not_found", "Company not found.")
        doc = rows[0]
        activities = {"primary": None, "secondary": None}
        for a in sqlrows(db, """SELECT ca.activity_type,b.ssic_code,b.ssic_title,ca.source_ssic_description
            FROM CompanyActivity ca JOIN BusinessActivity b ON b.activity_id=ca.activity_id WHERE ca.company_id=?""", (doc["company_id"],)):
            activities[a["activity_type"].lower()] = {"code": a["ssic_code"], "title": a["ssic_title"], "source_description": a["source_ssic_description"]}
        addresses = sqlrows(db, "SELECT * FROM Address WHERE company_id=? ORDER BY address_id", (doc["company_id"],))
        # Return every SQL address; retain address as a compatibility alias for older clients.
        all_addresses = [{k: row["address_type" if k == "type" else k] for k in ADDRESS_FIELDS} for row in addresses]
        address = all_addresses[0] if all_addresses else None
        item = {"uen": uen, "name": doc["company_name"], "status": doc["status"] or "Unknown", "incorporation_date": day(doc["registration_date"]),
                "address": address, "addresses": all_addresses, "former_names": [r["former_name"] for r in sqlrows(db, "SELECT former_name FROM FormerEntityName WHERE company_id=? ORDER BY source_slot", (doc["company_id"],))], "activities": activities}
    item["has_linked_award"] = uen in linked_uens(db, database, [uen])
    if detail:
        return item
    return {k: item[k] for k in ["uen", "name", "status", "incorporation_date", "has_linked_award"]} | {"primary_activity": item["activities"]["primary"]}


@router.get("/company-statuses")
def statuses(request: Request, database: Database):
    with store(request, database) as db:
        return envelope({"items": registry_statuses(db, database)}, database)


@router.get("/companies")
def companies(request: Request, database: Database, q: str = Query(default="", max_length=500),
              status: Annotated[list[str] | None, Query()] = None, require_linked_award: bool = False,
              limit: Limit = 25, offset: Offset = 0, industry_code: str = "",
              sort_by: str = Query(default="uen", pattern="^(uen|name|status|registration_date|primary_activity)$"),
              sort_direction: str = Query(default="asc", pattern="^(asc|desc)$")):
    q = q.strip()
    industry_code = industry_code.strip().upper()
    # Full UENs use an indexed lookup; names still search current and former names.
    exact_uen = bool(UEN_PATTERN.fullmatch(q.upper()))
    if q and len(q) < 2:
        fail(422, "invalid_search", "Enter at least two characters to search.")
    with store(request, database) as db:
        # A broad industry includes its descendants; match the company primary activity only.
        activity_codes = industry_descendants(catalogue(db, database), industry_code) if industry_code else []
        if database == "mongodb":
            filters = {}
            if activity_codes:
                filters["activities.primary.code"] = {"$in": activity_codes}
            if q:
                if exact_uen:
                    filters["_id"] = q.upper()
                else:
                    filters["$or"] = [{"_id": q.upper()}, {"name": {"$regex": re.escape(q), "$options": "i"}}, {"former_names.name": {"$regex": re.escape(q), "$options": "i"}}]
            if status:
                filters["status"] = {"$in": status}
            if require_linked_award:
                accepted = list(db.suppliers.find({"match.status": "accepted"}, {"match.company_uen": 1}))
                suppliers = {x["_id"]: x["match"]["company_uen"] for x in accepted}
                used = db.tenders.distinct("awards.supplier_id")
                allowed = sorted({suppliers[x] for x in used if x in suppliers})
                if exact_uen:
                    filters["_id"] = q.upper() if q.upper() in allowed else {"$in": []}
                else:
                    filters["_id"] = {"$in": allowed}
            # Sort before pagination; a UEN tie-breaker keeps adjacent pages stable.
            field = {"uen": "_id", "name": "name", "status": "status", "registration_date": "registration.incorporation_date", "primary_activity": "activities.primary.code"}[sort_by]
            direction = 1 if sort_direction == "asc" else -1
            ordering = [(field, direction)] + ([] if field == "_id" else [("_id", direction)])
            ids = [x["_id"] for x in db.companies.find(filters, {"_id": 1}).sort(ordering).allow_disk_use(True).skip(offset).limit(limit+1)]
        else:
            where, params = [], []
            if activity_codes:
                placeholders = ",".join("?" for _ in activity_codes)
                where.append("EXISTS (SELECT 1 FROM CompanyActivity ca JOIN BusinessActivity ba ON ba.activity_id=ca.activity_id WHERE ca.company_id=c.company_id AND ca.activity_type='Primary' AND ba.ssic_code IN (" + placeholders + "))")
                params.extend(activity_codes)
            if q:
                if exact_uen:
                    where.append("c.uen=?"); params.append(q.upper())
                else:
                    where.append("(c.uen=? OR c.company_name LIKE ? ESCAPE '!' OR EXISTS (SELECT 1 FROM FormerEntityName f WHERE f.company_id=c.company_id AND f.former_name LIKE ? ESCAPE '!'))")
                    params.extend([q.upper(), sql_like(q), sql_like(q)])
            if status:
                where.append("c.status IN (" + ",".join("?" for _ in status) + ")")
                params.extend(status)
            if require_linked_award:
                where.append("EXISTS (SELECT 1 FROM SupplierEntityMatch m JOIN TenderAward a ON a.supplier_id=m.supplier_id WHERE m.company_id=c.company_id AND (SELECT COUNT(*) FROM SupplierEntityMatch m2 WHERE m2.supplier_id=m.supplier_id)=1)")
            # SQL identifiers come only from this whitelist, never directly from user input.
            field = {"uen": "c.uen", "name": "c.company_name", "status": "c.status", "registration_date": "c.registration_date",
                     "primary_activity": "sort_activity.ssic_code"}[sort_by]
            direction = "ASC" if sort_direction == "asc" else "DESC"
            ordering = field + " " + direction + (", c.uen " + direction if sort_by != "uen" else "")
            # Join the primary assignment once instead of executing a subquery for every company.
            sorting_join = " LEFT JOIN CompanyActivity sort_assignment ON sort_assignment.company_id=c.company_id AND sort_assignment.activity_type='Primary' LEFT JOIN BusinessActivity sort_activity ON sort_activity.activity_id=sort_assignment.activity_id" if sort_by == "primary_activity" else ""
            query = "SELECT c.uen FROM Company c" + sorting_join + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY " + ordering + " LIMIT ? OFFSET ?"
            ids = [x["uen"] for x in sqlrows(db, query, (*params, limit+1, offset))]
        items = [company_data(db, database, uen, False) for uen in ids[:limit]]
        return envelope({"items": items}, database, limit, offset, len(ids)>limit)


@router.get("/companies/{uen}")
def company(request: Request, database: Database, uen: str):
    with store(request, database) as db:
        return envelope(company_data(db, database, uen), database)


def award_data(db, database, start=None, end=None, agency=None):
    """Return award facts once per award; ambiguous supplier matches stay unlinked."""
    date_range(start, end)
    if database == "mariadb":
        where, params = [], []
        for clause, value in [("t.award_date>=?", start), ("t.award_date<=?", end), ("g.agency_name=?", agency)]:
            if value is not None:
                where.append(clause); params.append(value)
        rows = sqlrows(db, """SELECT t.tender_no,t.tender_description,g.agency_name,t.award_date,
            a.award_id,s.supplier_name_raw supplier_name,a.awarded_amt amount,c.uen,c.company_name,ba.ssic_code primary_code
            FROM Tender t JOIN GovernmentAgency g ON g.agency_id=t.agency_id
            LEFT JOIN TenderAward a ON a.tender_id=t.tender_id LEFT JOIN Supplier s ON s.supplier_id=a.supplier_id
            LEFT JOIN (SELECT supplier_id,MIN(company_id) company_id FROM SupplierEntityMatch GROUP BY supplier_id HAVING COUNT(*)=1) m ON m.supplier_id=s.supplier_id
            LEFT JOIN Company c ON c.company_id=m.company_id
            LEFT JOIN CompanyActivity ca ON ca.company_id=c.company_id AND LOWER(ca.activity_type)='primary'
            LEFT JOIN BusinessActivity ba ON ba.activity_id=ca.activity_id""" + (" WHERE " + " AND ".join(where) if where else ""), tuple(params))
        no_awards = {x["tender_no"] for x in rows if x["award_id"] is None}
        return [x for x in rows if x["award_id"] is not None], no_awards
    filters = {}
    if agency is not None:
        filters["agency_name"] = agency
    if start or end:
        filters["award_date"] = {}
        if start: filters["award_date"]["$gte"] = mongo_day(start)
        if end: filters["award_date"]["$lt"] = mongo_day(end) + timedelta(days=1)
    tenders = list(db.tenders.find(filters, {"description": 1, "agency_name": 1, "award_date": 1, "awards": 1}))
    names = list({a["supplier_id"] for t in tenders for a in t.get("awards", [])})
    suppliers = {x["_id"]: x["match"]["company_uen"] for x in db.suppliers.find({"_id": {"$in": names}, "match.status": "accepted"}, {"match.company_uen": 1})}
    companies = {x["_id"]: x for x in db.companies.find({"_id": {"$in": list(set(suppliers.values()))}}, {"name": 1, "activities.primary.code": 1})}
    rows, no_awards = [], set()
    for t in tenders:
        if not t.get("awards"): no_awards.add(t["_id"])
        for a in t.get("awards", []):
            co = companies.get(suppliers.get(a["supplier_id"]))
            rows.append({"tender_no": t["_id"], "tender_description": t.get("description"), "agency_name": t.get("agency_name"), "award_date": t.get("award_date"),
                         "supplier_name": a["supplier_id"], "amount": amount(a["amount"]), "uen": co["_id"] if co else None,
                         "company_name": co.get("name") if co else None, "primary_code": ((co.get("activities") or {}).get("primary") or {}).get("code") if co else None})
    return rows, no_awards


@router.get("/companies/{uen}/awards")
def company_awards(request: Request, database: Database, uen: str, start_date: date | None = None, end_date: date | None = None, limit: Limit = 25, offset: Offset = 0):
    with store(request, database) as db:
        company_data(db, database, uen)
        rows, _ = award_data(db, database, start_date, end_date)
        items = [{k: (day(r[k]) if k == "award_date" else money(r[k]) if k == "amount" else r[k]) for k in ["tender_no", "tender_description", "agency_name", "award_date", "supplier_name", "amount"]} for r in rows if r["uen"] == uen.upper()]
        items.sort(key=lambda x: (x["award_date"] or "", x["tender_no"]), reverse=True)
        return page(items, database, limit, offset)


@router.get("/agencies")
def agencies(request: Request, database: Database, q: str = "", limit: Limit = 100, offset: Offset = 0):
    with store(request, database) as db:
        names = db.tenders.distinct("agency_name") if database == "mongodb" else [x["agency_name"] for x in sqlrows(db, "SELECT agency_name FROM GovernmentAgency")]
        return page([{"agency_name": x} for x in sorted(names) if q.casefold() in x.casefold()], database, limit, offset)


@router.get("/agency-awards")
def agency_awards(request: Request, database: Database, agency_name: str, start_date: date | None = None, end_date: date | None = None, above_average_only: bool = False, limit: Limit = 25, offset: Offset = 0):
    with store(request, database) as db:
        exists = db.tenders.find_one({"agency_name": agency_name}, {"_id": 1}) if database == "mongodb" else sqlrows(db, "SELECT 1 FROM GovernmentAgency WHERE agency_name=?", (agency_name,))
        if not exists: fail(404, "agency_not_found", "Agency not found.")
        rows, no_awards = award_data(db, database, start_date, end_date, agency_name)
        groups = {}
        for r in rows:
            g = groups.setdefault(r["supplier_name"], {"amount": Decimal(0), "tenders": set(), "count": 0, "uen": r["uen"], "name": r["company_name"]})
            g["amount"] += amount(r["amount"]); g["tenders"].add(r["tender_no"]); g["count"] += 1
        total = sum((x["amount"] for x in groups.values()), Decimal(0))
        average = total / len(groups) if groups else None
        items = [{"supplier_name": name, "total_award_amount": money(g["amount"]), "award_row_count": g["count"], "tender_count": len(g["tenders"]), "share_percent": percent(g["amount"], total),
                  "company_link": {"status": "accepted" if g["uen"] else "not_accepted", "uen": g["uen"], "name": g["name"]}} for name,g in groups.items() if not above_average_only or g["amount"]>average]
        items.sort(key=lambda x: (-Decimal(x["total_award_amount"]), x["supplier_name"]))
        result = page(items, database, limit, offset)
        result["data"]["summary"] = {"agency_name": agency_name, "period": {"start_date": start_date, "end_date": end_date}, "supplier_count": len(groups), "matching_supplier_count": len(items), "award_row_count": len(rows), "tender_count": len({r["tender_no"] for r in rows}),
                                     "total_award_amount": money(total), "average_supplier_total": money(average) if average is not None else None, "excluded_no_supplier_tender_count": len(no_awards)}
        return result


def catalogue(db, database):
    if database == "mongodb":
        return {x["_id"]: {"code": x["_id"], "title": x.get("title"), "level": x.get("level"), "parent": x.get("parent_code")} for x in db.industries.find({}, {"title": 1, "level": 1, "parent_code": 1})}
    return {x["ssic_code"]: {"code": x["ssic_code"], "title": x["ssic_title"], "level": x["ssic_level"], "parent": x["parent_code"]} for x in sqlrows(db, "SELECT b.*,p.ssic_code parent_code FROM BusinessActivity b LEFT JOIN BusinessActivity p ON b.parent_activity_id=p.activity_id")}


# Resolve a selected section, division or specific SSIC into codes for primary-activity filtering.
def industry_descendants(nodes, code):
    if code not in nodes:
        fail(422, "invalid_industry", "Choose an industry from the SSIC list.")
    children = {}
    for node in nodes.values():
        children.setdefault(node["parent"], []).append(node["code"])
    found, pending = set(), [code]
    while pending:
        current = pending.pop()
        if current not in found:
            found.add(current)
            pending.extend(children.get(current, []))
    return sorted(found)


@router.get("/industries")
def industries(request: Request, database: Database, parent_code: str | None = None, include_all: bool = False):
    with store(request, database) as db:
        nodes = catalogue(db, database)
        if parent_code and parent_code not in nodes: fail(404, "industry_not_found", "Industry not found.")
        parents = {x["parent"] for x in nodes.values()}
        items = [{k: n[k] for k in ["code", "title", "level"]} | {"has_children": n["code"] in parents} for n in nodes.values() if include_all or n["parent"] == parent_code]
        return envelope({"items": sorted(items, key=lambda x:x["code"])}, database)


@router.get("/industry-awards")
def industry_awards(request: Request, database: Database, parent_code: str | None = None, start_date: date | None = None, end_date: date | None = None):
    with store(request, database) as db:
        nodes = catalogue(db, database)
        if parent_code and parent_code not in nodes: fail(404, "industry_not_found", "Industry not found.")
        children = {k:n for k,n in nodes.items() if n["parent"] == parent_code}
        if not children and parent_code: fail(422, "industry_has_no_children", "This industry has no child branches.")
        branch = {}
        for code in nodes:
            current, visited = code, set()
            while current in nodes and current not in visited:
                if current in children: branch[code] = current; break
                visited.add(current); current = nodes[current]["parent"]
        groups = {k: {"amount": Decimal(0), "count": 0, "companies": set()} for k in children}
        rows, _ = award_data(db, database, start_date, end_date)
        unlinked, unresolved = 0, 0
        for r in rows:
            if not r["uen"]: unlinked += 1; continue
            if r["primary_code"] not in nodes: unresolved += 1; continue
            key = branch.get(r["primary_code"])
            if key is None: continue
            g = groups[key]; g["amount"] += amount(r["amount"]); g["count"] += 1; g["companies"].add(r["uen"])
        total = sum((g["amount"] for g in groups.values()), Decimal(0))
        items = [{k:n[k] for k in ["code", "title", "level"]} | {"total_award_amount": money(groups[code]["amount"]), "award_row_count": groups[code]["count"], "company_count": len(groups[code]["companies"]), "share_percent": percent(groups[code]["amount"], total)} for code,n in children.items()]
        items.sort(key=lambda x:(-Decimal(x["total_award_amount"]),x["code"]))
        summary = {"parent_code": parent_code, "period": {"start_date": start_date, "end_date": end_date}, "total_award_amount": money(total), "award_row_count": sum(g["count"] for g in groups.values()), "company_count": len(set().union(*(g["companies"] for g in groups.values()))),
                   "coverage": {"excluded_no_accepted_link_award_row_count": unlinked, "excluded_unresolved_primary_ssic_award_row_count": unresolved}}
        return envelope({"summary": summary, "items": items}, database)


def list_key(database, value):
    try:
        return ObjectId(value) if database == "mongodb" else int(value)
    except (ValueError, TypeError, InvalidId):
        # Invalid IDs have the same public result as missing lists.
        fail(404, "saved_list_not_found", "Saved list not found.")


def saved_list(db, database, value):
    key = list_key(database, value)
    if database == "mongodb":
        doc = db.saved_lists.find_one({"_id": key})
        if doc: return {"id": str(key), "name": doc["name"], "entry_count": db.saved_list_entries.count_documents({"list_id": key})}
    else:
        rows = sqlrows(db, "SELECT l.list_id,l.list_name,COUNT(e.company_id) entry_count FROM SavedList l LEFT JOIN SavedListEntry e ON e.list_id=l.list_id WHERE l.list_id=? GROUP BY l.list_id,l.list_name", (key,))
        if rows: return {"id": str(key), "name": rows[0]["list_name"], "entry_count": rows[0]["entry_count"]}
    fail(404, "saved_list_not_found", "Saved list not found.")


@router.post("/saved-lists", status_code=201)
def create_list(request: Request, database: Database, body: SavedListCreate):
    with store(request, database) as db:
        if database == "mongodb":
            now = datetime.now(timezone.utc)
            key = db.saved_lists.insert_one({"name": body.name, "name_key": normalize_saved_list_name(body.name), "revision": Int64(0), "created_at": now, "updated_at": now}).inserted_id
        else:
            key = execute(db, "INSERT INTO SavedList (list_name) VALUES (?)", (body.name,))
        return envelope(saved_list(db, database, str(key)), database)


@router.get("/saved-lists/{list_id}")
def read_list(request: Request, database: Database, list_id: str, limit: Limit = 25, offset: Offset = 0):
    with store(request, database) as db:
        result = saved_list(db, database, list_id); key = list_key(database, list_id)
        if database == "mongodb":
            entries = list(db.saved_list_entries.find({"list_id": key}).sort("company_uen", 1).skip(offset).limit(limit+1))
            docs = {x["_id"]:x for x in db.companies.find({"_id": {"$in": [e["company_uen"] for e in entries]}}, {"name": 1, "status": 1})}
            items = [{"company_uen": e["company_uen"], "company_name": docs.get(e["company_uen"],{}).get("name"), "company_status": docs.get(e["company_uen"],{}).get("status"), "review_status": e["review_status"], "saved_at": e["created_at"].replace(tzinfo=timezone.utc).isoformat()} for e in entries]
        else:
            items = sqlrows(db, "SELECT c.uen company_uen,c.company_name,c.status company_status,e.review_status,NULL saved_at FROM SavedListEntry e JOIN Company c ON c.company_id=e.company_id WHERE e.list_id=? ORDER BY c.uen LIMIT ? OFFSET ?", (key, limit+1, offset))
        result["entries"] = items[:limit]
        return envelope(result, database, limit, offset, len(items)>limit)


@router.post("/saved-lists/{list_id}/companies", status_code=201)
def add_entry(request: Request, database: Database, list_id: str, body: SavedListEntryCreate):
    with store(request, database) as db:
        saved_list(db, database, list_id); key = list_key(database, list_id)
        uen = body.company_uen.strip().upper(); co = company_data(db, database, uen)
        if database == "mongodb":
            now = datetime.now(timezone.utc)
            db.saved_list_entries.update_one({"list_id": key, "company_uen": uen}, {"$setOnInsert": {"review_status": body.review_status.value, "created_at": now, "updated_at": now}}, upsert=True)
        else:
            execute(db, "INSERT IGNORE INTO SavedListEntry (list_id,company_id,review_status) SELECT ?,company_id,? FROM Company WHERE uen=?", (key, body.review_status.value, uen))
        if database == "mongodb":
            saved_at = db.saved_list_entries.find_one({"list_id": key, "company_uen": uen})["created_at"].replace(tzinfo=timezone.utc).isoformat()
        else:
            # The shared MariaDB schema has no saved timestamp; do not invent a date.
            saved_at = None
        return envelope({"saved_at": saved_at, "company_uen": uen, "company_name": co["name"], "company_status": co["status"], "review_status": body.review_status.value}, database)


@router.delete("/saved-lists/{list_id}/companies/{uen}", status_code=204)
def remove_entry(request: Request, database: Database, list_id: str, uen: str):
    with store(request, database) as db:
        saved_list(db, database, list_id); key = list_key(database, list_id)
        if database == "mongodb":
            db.saved_list_entries.delete_one({"list_id": key, "company_uen": uen.upper()})
        else:
            execute(db, "DELETE e FROM SavedListEntry e JOIN Company c ON c.company_id=e.company_id WHERE e.list_id=? AND c.uen=?", (key, uen.upper()))
        return Response(status_code=204)
