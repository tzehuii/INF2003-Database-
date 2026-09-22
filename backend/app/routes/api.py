"""Business API routes.

Every route below declares the request and response shape. None of them is
implemented yet, so each one returns HTTP ``501`` with an explicit
``not_implemented`` code instead of contacting a database or returning invented
data.

This module deliberately imports no database driver, no connector helper, and no
credential. A request to any ``/api`` route therefore cannot read or write
MariaDB or MongoDB data.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse

from ..api_models import (
    AgenciesResponse,
    AgencyAwardsResponse,
    CompaniesResponse,
    CompanyAwardsResponse,
    CompanyDetailResponse,
    CompanyStatusesResponse,
    DatabaseMode,
    DomainErrorResponse,
    IndustriesResponse,
    IndustryAwardsResponse,
    SavedListCreate,
    SavedListDetailResponse,
    SavedListEntryCreate,
    SavedListEntryResponse,
    SavedListEntryUpdate,
    SavedListRename,
    SavedListResponse,
    SavedListsResponse,
)

router = APIRouter(prefix="/api", tags=["business"])

# The single response body used by every declared business route. It stays
# deliberately free of credentials, query text, connector messages, stack
# traces, and local paths.
NOT_IMPLEMENTED_CODE = "not_implemented"
NOT_IMPLEMENTED_MESSAGE = (
    "This API route is declared but its business logic is not implemented yet."
)

# One 422 code covers both ways a company search can be unusable, so the message
# names every satisfied-condition, not just the first. A short ``q`` and a
# missing filter fail for the same user-facing reason: there is nothing specific
# enough to search on. The message states the requirement rather than the
# parameter names, so it still reads correctly when ``q`` was supplied and
# rejected for being too short.
MIN_COMPANY_SEARCH_LENGTH = 2
INVALID_SEARCH_MESSAGE = (
    "A company search needs at least one usable filter: q with at least "
    f"{MIN_COMPANY_SEARCH_LENGTH} characters after trimming, a status label, or "
    "require_linked_award=true."
)


def not_implemented() -> JSONResponse:
    """Return the shared response for every declared business route."""

    return JSONResponse(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        content={"detail": {"code": NOT_IMPLEMENTED_CODE, "message": NOT_IMPLEMENTED_MESSAGE}},
    )


# Documented on every business route so the HTTP 501 behaviour is visible in
# /docs and /openapi.json rather than looking like real data.
NOT_IMPLEMENTED = {
    501: {
        "description": (
            f"`{NOT_IMPLEMENTED_CODE}`: {NOT_IMPLEMENTED_MESSAGE} "
            "Temporary placeholder, not finished behaviour."
        ),
        "content": {
            "application/json": {
                "example": {
                    "detail": {
                        "code": NOT_IMPLEMENTED_CODE,
                        "message": NOT_IMPLEMENTED_MESSAGE,
                    }
                }
            }
        },
    }
}


def domain_error(code: str, message: str) -> dict:
    """Build one documented domain-error entry for a route's ``responses`` map."""

    return {
        "model": DomainErrorResponse,
        "description": f"`{code}`: {message}",
        "content": {
            "application/json": {
                "example": {"detail": {"code": code, "message": message}}
            }
        },
    }


# Documented domain errors. Only the important ones are attached to routes.
INVALID_DATE_RANGE = domain_error(
    "invalid_date_range", "start_date must not be after end_date."
)
SUPPLIER_MATCHING_NOT_READY = domain_error(
    "supplier_matching_not_ready",
    "Accepted supplier-company links are not available in the selected database.",
)
DATABASE_UNAVAILABLE = domain_error(
    "database_unavailable", "The selected database could not be reached."
)
COMPANY_NOT_FOUND = domain_error(
    "company_not_found", "No company was found for the supplied UEN."
)
AGENCY_NOT_FOUND = domain_error(
    "agency_not_found", "No agency was found for the supplied agency name."
)
INDUSTRY_NOT_FOUND = domain_error(
    "industry_not_found", "No industry was found for the supplied SSIC code."
)
INDUSTRY_HAS_NO_CHILDREN = domain_error(
    "industry_has_no_children", "The selected SSIC node has no immediate children."
)
DUPLICATE_LIST_NAME = domain_error(
    "duplicate_list_name",
    "A saved list with the same normalised name already exists.",
)
SAVED_LIST_NOT_FOUND = domain_error(
    "saved_list_not_found", "No saved list was found for the supplied identifier."
)
SAVED_LIST_ENTRY_NOT_FOUND = domain_error(
    "saved_list_entry_not_found", "The saved list does not contain the supplied company."
)
DUPLICATE_LIST_ENTRY = domain_error(
    "duplicate_list_entry", "The saved list already contains the supplied company."
)

COMPANY_LIST_ERRORS = {
    404: COMPANY_NOT_FOUND,
    409: SUPPLIER_MATCHING_NOT_READY,
    503: DATABASE_UNAVAILABLE,
    **NOT_IMPLEMENTED,
}
# Company search can reject the input with either documented 422 code, so the
# 422 entry lists both while still showing the documented error shape.
COMPANY_SEARCH_ERRORS = {
    409: SUPPLIER_MATCHING_NOT_READY,
    422: {
        "model": DomainErrorResponse,
        "description": (
            "`invalid_search`: no usable search filter was supplied. "
            "`unknown_status`: a supplied status label is not in the source registry."
        ),
        "content": {
            "application/json": {
                "examples": [
                    {
                        "invalid_search": {
                            "value": {
                                "detail": {
                                    "code": "invalid_search",
                                    "message": INVALID_SEARCH_MESSAGE,
                                }
                            }
                        }
                    },
                    {
                        "unknown_status": {
                            "value": {
                                "detail": {
                                    "code": "unknown_status",
                                    "message": (
                                        "A supplied status label is not present in "
                                        "the source registry."
                                    ),
                                }
                            }
                        }
                    },
                ]
            }
        },
    },
    503: DATABASE_UNAVAILABLE,
    **NOT_IMPLEMENTED,
}

# Every business route requires exactly one database selector.
DatabaseQuery = Annotated[
    DatabaseMode,
    Query(description="Database this request runs against. Never both at once."),
]

LimitQuery = Annotated[
    int,
    Query(ge=1, le=100, description="Page size, from 1 through 100."),
]
OffsetQuery = Annotated[int, Query(ge=0, description="Nonnegative page offset.")]
StartDateQuery = Annotated[date | None, Query(description="Optional inclusive start date.")]
EndDateQuery = Annotated[date | None, Query(description="Optional inclusive end date.")]
SearchQuery = Annotated[
    str | None, Query(description="Trimmed literal search text.")
]
# Company search applies the minimum-length rule, so it documents that rule on
# its own parameter. The agency selector does not apply one, which is why the
# two routes cannot share a single description.
CompanySearchQuery = Annotated[
    str | None,
    Query(
        description=(
            f"Trimmed literal search text. At least {MIN_COMPANY_SEARCH_LENGTH} "
            "characters when supplied."
        )
    ),
]
StatusQuery = Annotated[
    list[str] | None,
    Query(
        alias="status",
        description="Exact source registry status label. May be repeated.",
    ),
]
RequireLinkedAwardQuery = Annotated[
    bool, Query(description="Include only companies with an accepted linked award.")
]
ParentCodeQuery = Annotated[
    str | None,
    Query(description="SSIC code whose immediate children are returned."),
]


def require_date_range(
    start_date: StartDateQuery = None,
    end_date: EndDateQuery = None,
) -> None:
    """Reject a date range whose start is after its end.

    Each boundary may be used alone, so the check runs only when both are given.
    """

    if start_date is not None and end_date is not None and start_date > end_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "invalid_date_range",
                "message": "start_date must not be after end_date.",
            },
        )


def validate_company_search_text(q: str | None) -> str | None:
    """Trim the company search text and apply the minimum-length rule.

    The trimmed value is what the route body passes on, so neither adapter has
    to decide for itself how surrounding whitespace is treated. That keeps the
    MariaDB and MongoDB search behaviour comparable.

    A UEN is 9 or 10 characters in the source data, so the contract's exact-UEN
    exception cannot make a shorter query valid and the minimum applies to every
    supplied ``q``.
    """

    if q is None:
        return None

    trimmed = q.strip()

    # Blank text is not a filter. Returning ``None`` lets the filter check below
    # report it as a missing filter rather than as a length failure.
    if not trimmed:
        return None

    if len(trimmed) < MIN_COMPANY_SEARCH_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "invalid_search", "message": INVALID_SEARCH_MESSAGE},
        )

    return trimmed


def require_company_search_filter(
    q: CompanySearchQuery = None,
    status_filter: StatusQuery = None,
    require_linked_award: RequireLinkedAwardQuery = False,
) -> str | None:
    """Validate a company search and return its trimmed search text.

    ``q`` is declared here with the company annotation rather than in the route
    signature. FastAPI merges the query parameters a route and its dependencies
    declare under the same name and keeps the dependency's copy, so the
    annotation that documents the minimum-length rule has to sit on this
    parameter for the generated OpenAPI document to describe the rule the check
    actually applies.

    The minimum-length rule is applied whenever ``q`` is supplied, including
    when another filter is present, because a one-character substring still
    makes a poor search.

    At least one of a usable ``q``, ``status``, or ``require_linked_award=true``
    is required. Returning the trimmed text means the route body searches on the
    same value the check approved.
    """

    search_text = validate_company_search_text(q)

    if not search_text and not status_filter and not require_linked_award:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "invalid_search", "message": INVALID_SEARCH_MESSAGE},
        )

    return search_text


# --------------------------------------------------------------------------
# Company routes
# --------------------------------------------------------------------------


@router.get(
    "/company-statuses",
    response_model=CompanyStatusesResponse,
    summary="List registry status labels",
    responses={503: DATABASE_UNAVAILABLE, **NOT_IMPLEMENTED},
)
def list_company_statuses(database: DatabaseQuery) -> CompanyStatusesResponse:
    """Return distinct source registry status labels in ascending order."""

    return not_implemented()


@router.get(
    "/companies",
    response_model=CompaniesResponse,
    summary="Search companies",
    responses=COMPANY_SEARCH_ERRORS,
)
def search_companies(
    database: DatabaseQuery,
    status_filter: StatusQuery = None,
    require_linked_award: RequireLinkedAwardQuery = False,
    limit: LimitQuery = 25,
    offset: OffsetQuery = 0,
    search_text: str | None = Depends(require_company_search_filter),
) -> CompaniesResponse:
    """Search companies by exact UEN or literal case-insensitive name text.

    ``q`` is accepted through ``require_company_search_filter``, which validates
    it and hands back ``search_text``, its trimmed form. Phase 4 searches on that
    value rather than on the raw parameter.
    """

    return not_implemented()


@router.get(
    "/companies/{uen}",
    response_model=CompanyDetailResponse,
    summary="View one company",
    responses={404: COMPANY_NOT_FOUND, 503: DATABASE_UNAVAILABLE, **NOT_IMPLEMENTED},
)
def read_company(database: DatabaseQuery, uen: str) -> CompanyDetailResponse:
    """Return one company using its exact UEN."""

    return not_implemented()


@router.get(
    "/companies/{uen}/awards",
    response_model=CompanyAwardsResponse,
    summary="List a company's accepted linked awards",
    responses=COMPANY_LIST_ERRORS | {422: INVALID_DATE_RANGE},
)
def list_company_awards(
    database: DatabaseQuery,
    uen: str,
    start_date: StartDateQuery = None,
    end_date: EndDateQuery = None,
    limit: LimitQuery = 25,
    offset: OffsetQuery = 0,
    _range: None = Depends(require_date_range),
) -> CompanyAwardsResponse:
    """Return award rows connected through accepted supplier links."""

    return not_implemented()


# --------------------------------------------------------------------------
# Agency routes
# --------------------------------------------------------------------------


@router.get(
    "/agencies",
    response_model=AgenciesResponse,
    summary="List agencies",
    responses={503: DATABASE_UNAVAILABLE, **NOT_IMPLEMENTED},
)
def list_agencies(
    database: DatabaseQuery,
    q: SearchQuery = None,
    limit: LimitQuery = 25,
    offset: OffsetQuery = 0,
) -> AgenciesResponse:
    """Return distinct agency names for the agency selector."""

    return not_implemented()


@router.get(
    "/agency-awards",
    response_model=AgencyAwardsResponse,
    summary="Compare suppliers for one agency",
    responses={
        404: AGENCY_NOT_FOUND,
        422: INVALID_DATE_RANGE,
        503: DATABASE_UNAVAILABLE,
        **NOT_IMPLEMENTED,
    },
)
def read_agency_awards(
    database: DatabaseQuery,
    agency_name: Annotated[
        str, Query(description="Exact agency name selected from /api/agencies.")
    ],
    start_date: StartDateQuery = None,
    end_date: EndDateQuery = None,
    above_average_only: Annotated[
        bool,
        Query(description="Return only suppliers above the filtered average."),
    ] = False,
    limit: LimitQuery = 25,
    offset: OffsetQuery = 0,
    _range: None = Depends(require_date_range),
) -> AgencyAwardsResponse:
    """Return agency totals and supplier rows, including unaccepted suppliers."""

    return not_implemented()


# --------------------------------------------------------------------------
# Industry routes
# --------------------------------------------------------------------------


@router.get(
    "/industries",
    response_model=IndustriesResponse,
    summary="Browse one SSIC level",
    responses={404: INDUSTRY_NOT_FOUND, 503: DATABASE_UNAVAILABLE, **NOT_IMPLEMENTED},
)
def list_industries(
    database: DatabaseQuery,
    parent_code: ParentCodeQuery = None,
) -> IndustriesResponse:
    """Return Section nodes, or the immediate children of ``parent_code``."""

    return not_implemented()


@router.get(
    "/industry-awards",
    response_model=IndustryAwardsResponse,
    summary="Compare award totals across SSIC branches",
    responses={
        404: INDUSTRY_NOT_FOUND,
        422: INDUSTRY_HAS_NO_CHILDREN,
        503: DATABASE_UNAVAILABLE,
        **NOT_IMPLEMENTED,
    },
)
def read_industry_awards(
    database: DatabaseQuery,
    parent_code: ParentCodeQuery = None,
    start_date: StartDateQuery = None,
    end_date: EndDateQuery = None,
    _range: None = Depends(require_date_range),
) -> IndustryAwardsResponse:
    """Return award totals per immediate child branch of the SSIC hierarchy.

    Incomplete supplier matching affects coverage, not availability. The
    response reports how many award rows were excluded because the supplier has
    no accepted company link, so partial matching produces smaller totals rather
    than a blocked request.
    """

    return not_implemented()


# --------------------------------------------------------------------------
# Saved-list routes
# --------------------------------------------------------------------------


@router.get(
    "/saved-lists",
    response_model=SavedListsResponse,
    summary="List saved lists",
    responses={503: DATABASE_UNAVAILABLE, **NOT_IMPLEMENTED},
)
def list_saved_lists(
    database: DatabaseQuery,
    limit: LimitQuery = 25,
    offset: OffsetQuery = 0,
) -> SavedListsResponse:
    """Return saved-list metadata ordered by normalised name."""

    return not_implemented()


@router.post(
    "/saved-lists",
    response_model=SavedListResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a saved list",
    responses={409: DUPLICATE_LIST_NAME, 503: DATABASE_UNAVAILABLE, **NOT_IMPLEMENTED},
)
def create_saved_list(database: DatabaseQuery, body: SavedListCreate) -> SavedListResponse:
    """Create a saved list. The name rule is enforced by the request model."""

    return not_implemented()


@router.get(
    "/saved-lists/{list_id}",
    response_model=SavedListDetailResponse,
    summary="View one saved list",
    responses={404: SAVED_LIST_NOT_FOUND, 503: DATABASE_UNAVAILABLE, **NOT_IMPLEMENTED},
)
def read_saved_list(
    database: DatabaseQuery,
    list_id: str,
    limit: LimitQuery = 25,
    offset: OffsetQuery = 0,
) -> SavedListDetailResponse:
    """Return list metadata with one page of its entries."""

    return not_implemented()


@router.patch(
    "/saved-lists/{list_id}",
    response_model=SavedListResponse,
    summary="Rename a saved list",
    responses={
        404: SAVED_LIST_NOT_FOUND,
        409: DUPLICATE_LIST_NAME,
        503: DATABASE_UNAVAILABLE,
        **NOT_IMPLEMENTED,
    },
)
def rename_saved_list(
    database: DatabaseQuery, list_id: str, body: SavedListRename
) -> SavedListResponse:
    """Replace a saved-list name. The name rule is enforced by the request model."""

    return not_implemented()


@router.delete(
    "/saved-lists/{list_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a saved list",
    responses={404: SAVED_LIST_NOT_FOUND, 503: DATABASE_UNAVAILABLE, **NOT_IMPLEMENTED},
)
def delete_saved_list(database: DatabaseQuery, list_id: str) -> None:
    """Delete a saved list and its entries. Source companies are never deleted."""

    return not_implemented()


@router.post(
    "/saved-lists/{list_id}/companies",
    response_model=SavedListEntryResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a company to a saved list",
    responses={
        404: COMPANY_NOT_FOUND,
        409: DUPLICATE_LIST_ENTRY,
        503: DATABASE_UNAVAILABLE,
        **NOT_IMPLEMENTED,
    },
)
def add_saved_list_entry(
    database: DatabaseQuery, list_id: str, body: SavedListEntryCreate
) -> SavedListEntryResponse:
    """Add a company to a saved list. New entries default to ``to_check``."""

    return not_implemented()


@router.patch(
    "/saved-lists/{list_id}/companies/{uen}",
    response_model=SavedListEntryResponse,
    summary="Change an entry's review status",
    responses={404: SAVED_LIST_ENTRY_NOT_FOUND, 503: DATABASE_UNAVAILABLE, **NOT_IMPLEMENTED},
)
def update_saved_list_entry(
    database: DatabaseQuery, list_id: str, uen: str, body: SavedListEntryUpdate
) -> SavedListEntryResponse:
    """Change one entry's review status to a valid value."""

    return not_implemented()


@router.delete(
    "/saved-lists/{list_id}/companies/{uen}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a company from a saved list",
    responses={404: SAVED_LIST_ENTRY_NOT_FOUND, 503: DATABASE_UNAVAILABLE, **NOT_IMPLEMENTED},
)
def remove_saved_list_entry(database: DatabaseQuery, list_id: str, uen: str) -> None:
    """Remove one company from a list and leave the source company unchanged."""

    return not_implemented()
