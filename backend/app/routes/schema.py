# Database schema: how MariaDB and MongoDB each store the project data.

# Routes:
#   GET /api/system/schema   MariaDB tables, columns, keys, foreign keys, indexes, sizes and row counts,
#                            plus MongoDB collections, document structure, indexes, sizes and document counts

# Unlike most System pages this route always reads both databases, so it takes no `database`
# parameter. It reads only metadata and counts; nothing here writes to either database.

# Where the structure comes from:
# - MariaDB: information_schema (TABLES, COLUMNS, STATISTICS, KEY_COLUMN_USAGE, REFERENTIAL_CONSTRAINTS).
#   Row counts are exact COUNT(*) queries, because InnoDB's TABLE_ROWS is only an estimate.
# - MongoDB: each collection's $jsonSchema validator describes every field, including embedded objects
#   and arrays. $collStats gives the sizes.

# Import libraries.
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
import logging

import mariadb
from fastapi import APIRouter, Request
from pymongo.errors import PyMongoError

from ..databases import connect_mariadb
from .companies import fail

router = APIRouter(prefix="/api/system/schema", tags=["system-schema"])
logger = logging.getLogger(__name__)

MB = 1048576


# Every table in the project schema with its columns, keys, foreign keys, indexes, size and row count.
# Table names are returned as the server stores them (lowercase on Windows).
def mariadb_schema(settings):
    connection = connect_mariadb(settings)
    try:
        cursor = connection.cursor()

        def rows(query, params=()):
            cursor.execute(query, params)
            return cursor.fetchall()

        schema = (settings.mariadb_database,)
        tables = {}
        for name, data_length, index_length in rows(
                "SELECT table_name, data_length, index_length FROM information_schema.TABLES "
                "WHERE table_schema=? AND table_type='BASE TABLE' ORDER BY table_name", schema):
            tables[name] = {"name": name, "columns": [], "foreign_keys": [], "indexes": [],
                            "data_mb": round(data_length / MB, 1), "index_mb": round(index_length / MB, 1)}

        for table, column, column_type, nullable, key in rows(
                "SELECT table_name, column_name, column_type, is_nullable, column_key FROM information_schema.COLUMNS "
                "WHERE table_schema=? ORDER BY table_name, ordinal_position", schema):
            if table in tables:
                tables[table]["columns"].append({"name": column, "type": column_type, "nullable": nullable == "YES",
                                                 "primary_key": key == "PRI"})

        for table, column, ref_table, ref_column, on_delete in rows(
                "SELECT k.table_name, k.column_name, k.referenced_table_name, k.referenced_column_name, r.delete_rule "
                "FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r "
                "ON r.constraint_schema=k.table_schema AND r.constraint_name=k.constraint_name "
                "WHERE k.table_schema=? AND k.referenced_table_name IS NOT NULL ORDER BY k.table_name, k.column_name", schema):
            if table in tables:
                tables[table]["foreign_keys"].append({"column": column, "table": ref_table, "column_referenced": ref_column,
                                                      "on_delete": on_delete})

        indexes = defaultdict(lambda: {"columns": [], "unique": False})
        for table, index, column, non_unique in rows(
                "SELECT table_name, index_name, column_name, non_unique FROM information_schema.STATISTICS "
                "WHERE table_schema=? ORDER BY table_name, index_name, seq_in_index", schema):
            entry = indexes[(table, index)]
            entry["columns"].append(column)
            entry["unique"] = not non_unique
        for (table, index), entry in indexes.items():
            if table in tables:
                tables[table]["indexes"].append({"name": index, **entry})

        # The names come from information_schema, never from the request, so quoting them is safe.
        for name, table in tables.items():
            table["rows"] = rows(f"SELECT COUNT(*) FROM `{name}`")[0][0]

        version = rows("SELECT VERSION()")[0][0]
        return {"version": version, "tables": list(tables.values())}
    finally:
        connection.close()


# One field of a $jsonSchema, with its embedded fields when it holds an object or an array of objects.
def describe_field(name, node, required):
    types = node.get("bsonType") or node.get("type") or ("enum" if "enum" in node else "any")
    field = {"name": name, "types": types if isinstance(types, list) else [types], "required": name in required}
    if "enum" in node:
        field["enum"] = [value for value in node["enum"] if value is not None]
    items = node.get("items") if isinstance(node.get("items"), dict) else None
    if items is not None:
        item_types = items.get("bsonType") or items.get("type") or "any"
        field["item_types"] = item_types if isinstance(item_types, list) else [item_types]
    source = items if items is not None and items.get("properties") else node
    if source.get("properties"):
        field["fields"] = describe_fields(source)
    return field


def describe_fields(node):
    required = set(node.get("required", []))
    return [describe_field(name, child, required) for name, child in (node.get("properties") or {}).items()]


# Every collection with the document structure its validator enforces, its indexes, size and document count.
def mongodb_schema(client, database_name):
    db = client[database_name]
    collections = []
    for info in sorted(db.list_collections(), key=lambda c: c["name"]):
        name = info["name"]
        validator = (info.get("options", {}).get("validator") or {}).get("$jsonSchema") or {}
        stats = next(db[name].aggregate([{"$collStats": {"storageStats": {}}}]), {}).get("storageStats", {})
        collections.append({
            "name": name,
            "validated": bool(validator),
            "fields": describe_fields(validator),
            "indexes": [{"name": i["name"], "keys": list(i["key"].keys()), "unique": bool(i.get("unique"))}
                        for i in db[name].list_indexes()],
            # The collection's own count; exact after a clean shutdown and far faster than counting 2.1 million documents.
            "documents": db[name].estimated_document_count(),
            "data_mb": round(stats.get("size", 0) / MB, 1),
            "storage_mb": round(stats.get("storageSize", 0) / MB, 1),
            "index_mb": round(stats.get("totalIndexSize", 0) / MB, 1),
        })
    return {"version": client.server_info()["version"], "collections": collections}


# Both databases are read in parallel; the exact MariaDB row counts take the longest (a few seconds).
@router.get("")
def schema(request: Request):
    state = request.app.state
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            maria = pool.submit(mariadb_schema, state.settings)
            mongo = pool.submit(mongodb_schema, state.mongodb_client, state.settings.mongodb_db_name)
            return {"data": {"mariadb": maria.result(), "mongodb": mongo.result()}}
    except (mariadb.Error, PyMongoError) as error:
        logger.warning("Schema read failed (%s)", type(error).__name__)
        fail(503, "database_unavailable", "Both databases must be running to show their schema.")
