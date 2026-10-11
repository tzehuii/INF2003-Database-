"""Business Activity operations against MongoDB.

The catalogue is the ``industries`` collection. A document's ``_id`` is its SSIC
code, ``parent_code`` names its parent, and ``ancestor_codes`` lists its
ancestors from the Section down. MongoDB has no foreign keys, so the checks that
MariaDB leaves to constraints are made here in code. Every function takes the
one open ``Database`` and touches only that database.

Company assignments live in ``companies.activities.primary.code`` and
``companies.activities.secondary.code``.
"""

from __future__ import annotations

import re

from pymongo.errors import DuplicateKeyError, WriteError

from .validation import (
    CatalogueError,
    check_code,
    child_level,
    clean_title,
    delete_blocked,
    duplicate_code,
    level_for_new_entry,
    not_found,
    parent_not_found,
    suggest_code,
)

# Used only when the collection has no Section to copy the edition from.
DEFAULT_EDITION = 2025

_DOCUMENT_VALIDATION_FAILED = 121


def _node(document: dict) -> dict:
    return {"code": document["_id"], "title": document["title"], "level": document["level"]}


def _path(db, documents: list[dict]) -> dict[str, list[dict]]:
    """Return each document's ancestors, Section first, keyed by code."""

    wanted = {code for document in documents for code in document["ancestor_codes"]}
    found = {}
    if wanted:
        found = {
            ancestor["_id"]: _node(ancestor)
            for ancestor in db.industries.find({"_id": {"$in": list(wanted)}})
        }
    return {
        document["_id"]: [found[code] for code in document["ancestor_codes"] if code in found]
        for document in documents
    }


def list_children(db, parent_code: str | None, section: str | None) -> list[dict]:
    """Return Sections, or the immediate children of ``parent_code``.

    ``section`` limits the top level to one Section. Below the top level every
    entry already belongs to the chosen Section, so it has no further effect.
    """

    if parent_code is None:
        query: dict = {"level": "Section"}
        if section is not None:
            query["_id"] = section
    else:
        if db.industries.find_one({"_id": parent_code}, {"_id": 1}) is None:
            raise not_found(parent_code)
        query = {"parent_code": parent_code}

    documents = list(db.industries.find(query).sort("_id", 1))
    parents_in_use = set(
        db.industries.distinct(
            "parent_code", {"parent_code": {"$in": [document["_id"] for document in documents]}}
        )
    )
    return [
        {**_node(document), "has_children": document["_id"] in parents_in_use}
        for document in documents
    ]


def search(db, text: str, section: str | None, limit: int) -> tuple[list[dict], bool]:
    """Find entries whose title contains ``text`` or whose code starts with it.

    Matching ignores letter case. Returns the matches, shallowest level first,
    and whether more matches exist beyond ``limit``.
    """

    escaped = re.escape(text)
    match: dict = {
        "$or": [
            {"title": {"$regex": escaped, "$options": "i"}},
            {"_id": {"$regex": f"^{escaped}", "$options": "i"}},
        ]
    }
    if section is not None:
        match = {
            "$and": [match, {"$or": [{"_id": section}, {"ancestor_codes": section}]}]
        }

    # A code's length is its level, so sorting by length lists Sections first.
    documents = list(
        db.industries.aggregate(
            [
                {"$match": match},
                {"$addFields": {"code_length": {"$strLenCP": "$_id"}}},
                {"$sort": {"code_length": 1, "_id": 1}},
                {"$limit": limit + 1},
            ]
        )
    )
    has_more = len(documents) > limit
    documents = documents[:limit]
    paths = _path(db, documents)
    items = [{**_node(document), "parent_path": paths[document["_id"]]} for document in documents]
    return items, has_more


def read_detail(db, code: str) -> dict:
    """Return one entry with its ancestors and immediate children."""

    document = db.industries.find_one({"_id": code})
    if document is None:
        raise not_found(code)
    path = _path(db, [document])[code]
    return {
        **_node(document),
        "parent": path[-1] if path else None,
        "path": path,
        "child_level": child_level(document["level"]),
        "children": list_children(db, code, None),
    }


def next_code(db, parent_code: str | None, after: str | None = None) -> dict:
    """Suggest an unused code for a new child of ``parent_code``."""

    parent_level = None
    if parent_code is not None:
        parent = db.industries.find_one({"_id": parent_code}, {"level": 1})
        if parent is None:
            raise parent_not_found(parent_code)
        parent_level = parent["level"]
    level = level_for_new_entry(parent_level)

    def find_used(candidates: list[str]) -> set[str]:
        return {
            document["_id"]
            for document in db.industries.find({"_id": {"$in": candidates}}, {"_id": 1})
        }

    return {"code": suggest_code(level, parent_code, find_used, after), "level": level}


def create(db, title: str, code: str, parent_code: str | None) -> dict:
    """Insert one entry under ``parent_code`` and return it read back.

    ``source_record`` is stored as null: a manually created entry has no row in
    the source CSV, and none is invented.
    """

    title = clean_title(title)

    parent = None
    if parent_code is not None:
        parent = db.industries.find_one({"_id": parent_code})
        if parent is None:
            raise parent_not_found(parent_code)

    level = level_for_new_entry(parent["level"] if parent else None)
    code = check_code(level, code, parent_code)

    if db.industries.find_one({"_id": code}, {"_id": 1}) is not None:
        raise duplicate_code(code)

    if parent is not None:
        edition = parent["edition"]
        ancestors = [*parent["ancestor_codes"], parent["_id"]]
    else:
        latest = db.industries.find_one({"level": "Section"}, sort=[("edition", -1)])
        edition = latest["edition"] if latest else DEFAULT_EDITION
        ancestors = []

    document = {
        "_id": code,
        "title": title,
        "level": level,
        "parent_code": parent_code,
        "ancestor_codes": ancestors,
        "edition": edition,
        "source_record": None,
    }
    try:
        db.industries.insert_one(document)
    except DuplicateKeyError:
        # Another request took the code after the check above.
        raise duplicate_code(code) from None
    except WriteError as error:
        if error.code == _DOCUMENT_VALIDATION_FAILED:
            raise CatalogueError(
                422,
                "document_rejected",
                "The database rejected the entry because it does not satisfy the "
                "collection's validation rules.",
            ) from None
        raise

    return read_detail(db, code)


def rename(db, code: str, title: str) -> dict:
    """Change only the title of one entry and return it read back."""

    title = clean_title(title)
    result = db.industries.update_one({"_id": code}, {"$set": {"title": title}})
    if result.matched_count == 0:
        raise not_found(code)
    return read_detail(db, code)


def _company_uses(db, code: str, field: str) -> bool:
    return (
        db.companies.find_one({f"activities.{field}.code": code}, {"_id": 1}) is not None
    )


def delete(db, code: str) -> None:
    """Delete one entry if it has no children and no company assignment.

    Eligibility is read from the database at the moment of deletion. Nothing is
    changed when the entry is blocked.
    """

    if db.industries.find_one({"_id": code}, {"_id": 1}) is None:
        raise not_found(code)

    has_children = db.industries.find_one({"parent_code": code}, {"_id": 1}) is not None

    # The companies collection has no index on these fields, so look for any use
    # in one pass first and only separate primary from secondary when one exists.
    primary = secondary = False
    any_use = db.companies.find_one(
        {"$or": [{"activities.primary.code": code}, {"activities.secondary.code": code}]},
        {"_id": 1},
    )
    if any_use is not None:
        primary = _company_uses(db, code, "primary")
        secondary = _company_uses(db, code, "secondary")

    if has_children or primary or secondary:
        raise delete_blocked(code, has_children, primary, secondary)

    db.industries.delete_one({"_id": code})
