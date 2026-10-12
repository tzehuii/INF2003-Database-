"""Business Activities routes for the System view.

Each request runs against exactly one database, chosen by the ``database`` query
parameter. Nothing is written to the other database, and nothing here reads
sample data: a database that cannot be reached produces an HTTP ``503`` rather
than a substitute answer.
"""

from __future__ import annotations

import logging
import re
from contextlib import contextmanager
from typing import Annotated, Any

import mariadb
from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from pymongo.errors import ConnectionFailure, PyMongoError

from ..api_models import (
    ActivityChildrenResponse,
    ActivityCreate,
    ActivityDetailResponse,
    ActivityNextCodeResponse,
    ActivityRename,
    ActivitySearchResponse,
    DatabaseMode,
    DomainErrorResponse,
)
from ..databases import connect_mariadb
from ..system import mariadb_activities, mongodb_activities
from ..system.validation import ANY_CODE_PATTERN, CatalogueError, not_found

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/system/business-activities", tags=["business-activities"])

DatabaseQuery = Annotated[
    DatabaseMode,
    Query(description="Database this request runs against. Never both at once."),
]
SectionQuery = Annotated[
    str | None,
    Query(pattern=r"^[A-Z]$", description="Section code that limits the results."),
]
ParentQuery = Annotated[
    str | None, Query(description="Code of the parent entry. Omit for Sections.")
]

AfterQuery = Annotated[
    str | None,
    Query(
        pattern=r"^[A-Z0-9]{1,5}$",
        description="A code already suggested. The next free code after it is returned instead.",
    ),
]

SEARCH_LIMIT_MAX = 200


def _error(code: str, message: str) -> dict:
    return {
        "model": DomainErrorResponse,
        "description": f"`{code}`: {message}",
        "content": {"application/json": {"example": {"detail": {"code": code, "message": message}}}},
    }


UNAVAILABLE = _error("database_unavailable", "The selected database could not be reached.")
NOT_FOUND = _error("business_activity_not_found", "No business activity has this code.")


@contextmanager
def _open_store(request: Request, database: DatabaseMode):
    """Yield ``(adapter module, open handle)`` for the selected database only."""

    settings = request.app.state.settings
    if database == DatabaseMode.mongodb:
        yield mongodb_activities, request.app.state.mongodb_client[settings.mongodb_db_name]
        return

    connection = connect_mariadb(settings)
    try:
        yield mariadb_activities, connection
    finally:
        try:
            connection.close()
        except Exception:
            pass


def _run(request: Request, database: DatabaseMode, operation: str, *args: Any) -> Any:
    """Run one adapter operation and turn failures into documented errors.

    Rule failures become their own status. A database that cannot be reached
    becomes 503. Driver messages are never returned, because they can contain
    connection details.
    """

    try:
        with _open_store(request, database) as (adapter, handle):
            return getattr(adapter, operation)(handle, *args)
    except CatalogueError as error:
        raise HTTPException(
            status_code=error.status,
            detail={"code": error.code, "message": error.message},
        ) from None
    except (mariadb.OperationalError, mariadb.InterfaceError, ConnectionFailure) as error:
        logger.warning("business activities %s: database unreachable (%s)", operation, type(error).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "database_unavailable",
                "message": "The selected database could not be reached. Nothing was changed.",
            },
        ) from None
    except (mariadb.Error, PyMongoError) as error:
        logger.warning("business activities %s: database error (%s)", operation, type(error).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "database_error",
                "message": "The selected database reported an error. The request was not completed.",
            },
        ) from None


def _meta(database: DatabaseMode) -> dict:
    return {"database": database}


def _require_code(code: str) -> str:
    """Reject a code that cannot exist, so it is never looked up with a loose collation."""

    if not re.fullmatch(ANY_CODE_PATTERN, code):
        raise HTTPException(
            status_code=404,
            detail={"code": not_found(code).code, "message": not_found(code).message},
        )
    return code


@router.get(
    "/children",
    response_model=ActivityChildrenResponse,
    summary="List Sections, or the immediate children of one entry",
    responses={404: NOT_FOUND, 503: UNAVAILABLE},
)
def list_children(
    request: Request,
    database: DatabaseQuery,
    parent_code: ParentQuery = None,
    section: SectionQuery = None,
) -> dict:
    if parent_code is not None:
        _require_code(parent_code)
    items = _run(request, database, "list_children", parent_code, section)
    return {"data": {"items": items}, "meta": _meta(database)}


@router.get(
    "/search",
    response_model=ActivitySearchResponse,
    summary="Search by title text or code prefix",
    responses={422: _error("invalid_search", "Enter text to search for."), 503: UNAVAILABLE},
)
def search(
    request: Request,
    database: DatabaseQuery,
    q: Annotated[str, Query(description="Part of a title, or the start of a code.")],
    section: SectionQuery = None,
    limit: Annotated[int, Query(ge=1, le=SEARCH_LIMIT_MAX)] = 100,
) -> dict:
    text = q.strip()
    if not text:
        raise HTTPException(
            status_code=422,
            detail={"code": "invalid_search", "message": "Enter text to search for."},
        )
    items, has_more = _run(request, database, "search", text, section, limit)
    return {"data": {"items": items, "has_more": has_more}, "meta": _meta(database)}


@router.get(
    "/next-code",
    response_model=ActivityNextCodeResponse,
    summary="Suggest an unused code for a new entry",
    responses={
        404: _error("parent_not_found", "The parent entry does not exist."),
        409: _error("code_space_exhausted", "No valid unused code is left."),
        422: _error("no_child_level", "A Sub-class cannot have children."),
        503: UNAVAILABLE,
    },
)
def next_code(
    request: Request,
    database: DatabaseQuery,
    parent_code: ParentQuery = None,
    after: AfterQuery = None,
) -> dict:
    if parent_code is not None:
        _require_code(parent_code)
    data = _run(request, database, "next_code", parent_code, after)
    return {"data": data, "meta": _meta(database)}


@router.get(
    "/{code}",
    response_model=ActivityDetailResponse,
    summary="View one entry with its immediate children",
    responses={404: NOT_FOUND, 503: UNAVAILABLE},
)
def read_activity(request: Request, database: DatabaseQuery, code: str) -> dict:
    data = _run(request, database, "read_detail", _require_code(code))
    return {"data": data, "meta": _meta(database)}


@router.post(
    "",
    response_model=ActivityDetailResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create one entry",
    responses={
        404: _error("parent_not_found", "The parent entry does not exist."),
        409: _error("duplicate_code", "The code is already in use."),
        422: _error("invalid_code", "The code does not fit the entry's level or parent."),
        503: UNAVAILABLE,
    },
)
def create_activity(request: Request, database: DatabaseQuery, body: ActivityCreate) -> dict:
    parent_code = body.parent_code.strip() if body.parent_code else None
    if parent_code is not None:
        _require_code(parent_code)
    data = _run(request, database, "create", body.title, body.code, parent_code)
    return {"data": data, "meta": _meta(database)}


@router.patch(
    "/{code}",
    response_model=ActivityDetailResponse,
    summary="Change an entry's title",
    responses={
        404: NOT_FOUND,
        422: _error("invalid_title", "The title must not be blank."),
        503: UNAVAILABLE,
    },
)
def rename_activity(
    request: Request, database: DatabaseQuery, code: str, body: ActivityRename
) -> dict:
    data = _run(request, database, "rename", _require_code(code), body.title)
    return {"data": data, "meta": _meta(database)}


@router.delete(
    "/{code}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete one unused entry",
    responses={
        404: NOT_FOUND,
        409: _error("delete_blocked", "The entry has children or company assignments."),
        503: UNAVAILABLE,
    },
)
def delete_activity(request: Request, database: DatabaseQuery, code: str) -> Response:
    _run(request, database, "delete", _require_code(code))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
