"""Request and response models for the JSON API.

These models define the interface only. They hold no database query and no
business logic, so the whole API surface stays readable through FastAPI's
``/docs`` and ``/openapi.json``.

Shared value rules applied here:

- dates are ``date`` values and serialise as ISO ``YYYY-MM-DD``;
- money and percentages are decimal strings, never JSON numbers;
- missing source values are ``null``;
- an empty result is a normal empty ``items`` array, not a 404.
"""

from __future__ import annotations

import unicodedata

from datetime import date
from enum import Enum

from pydantic import BaseModel, Field, field_validator

# Saved-list name limit, applied after normalisation.
SAVED_LIST_NAME_MAX_LENGTH = 200


class DatabaseMode(str, Enum):
    """The database a single request runs against. Never both at once."""

    mariadb = "mariadb"
    mongodb = "mongodb"


class ReviewStatus(str, Enum):
    """Saved-list entry review state shared by both database implementations."""

    to_check = "to_check"
    reviewed = "reviewed"


class CompanyLinkStatus(str, Enum):
    """Whether an agency supplier row has an accepted company link."""

    accepted = "accepted"
    not_accepted = "not_accepted"


class ApiMeta(BaseModel):
    """Response metadata. ``database`` echoes the selected database."""

    database: DatabaseMode


class Pagination(BaseModel):
    """Pagination metadata for the paginated routes."""

    limit: int = Field(description="Applied page size.")
    offset: int = Field(description="Applied page offset.")
    returned: int = Field(description="Number of items in this page.")
    has_more: bool = Field(description="Whether more rows are available.")
    next_offset: int | None = Field(
        default=None,
        description="Offset of the next page, or null when has_more is false.",
    )


class PaginatedMeta(BaseModel):
    """Metadata for paginated responses."""

    database: DatabaseMode
    pagination: Pagination


# --------------------------------------------------------------------------
# Companies
# --------------------------------------------------------------------------


class IndustryActivity(BaseModel):
    """One SSIC catalogue entry attached to a company."""

    code: str | None = Field(default=None, description="SSIC code, or null.")
    title: str | None = Field(default=None, description="Catalogue title, or null.")
    source_description: str | None = Field(
        default=None,
        description=(
            "Free-text activity description from the source record. Null when the "
            "source has none or the entry is not the primary assignment."
        ),
    )


class CompanyActivities(BaseModel):
    """The company's primary and secondary SSIC assignments."""

    primary: IndustryActivity | None = None
    secondary: IndustryActivity | None = None


class Address(BaseModel):
    """Registered address fields held by both database implementations."""

    type: str | None = None
    block: str | None = None
    street_name: str | None = None
    level_no: str | None = None
    unit_no: str | None = None
    building_name: str | None = None
    postal_code: str | None = None
    other_address_line1: str | None = None
    other_address_line2: str | None = None


class CompanySummary(BaseModel):
    """One company row returned by company search."""

    uen: str = Field(description="Company identity.")
    name: str | None = Field(default=None, description="Current entity name.")
    status: str = Field(description="Source registry status label.")
    incorporation_date: date | None = Field(
        default=None, description="Source registration or incorporation date."
    )
    primary_activity: IndustryActivity | None = None
    has_linked_award: bool | None = Field(
        default=None,
        description="Boolean when supplier matching is ready, otherwise null.",
    )


class CompanyDetail(BaseModel):
    """One company returned by the company detail route."""

    uen: str
    name: str | None = None
    status: str
    incorporation_date: date | None = None
    address: Address | None = None
    former_names: list[str] = Field(
        default_factory=list, description="Former names in source order."
    )
    activities: CompanyActivities = Field(default_factory=CompanyActivities)
    has_linked_award: bool | None = Field(
        default=None,
        description="Boolean when supplier matching is ready, otherwise null.",
    )


class CompanyAward(BaseModel):
    """One award row reached through an accepted supplier-company link."""

    tender_no: str
    tender_description: str | None = None
    agency_name: str | None = None
    award_date: date | None = None
    supplier_name: str
    amount: str = Field(description="Exact decimal string, never a JSON number.")


class CompanyStatusesData(BaseModel):
    """Registry status labels for the status filter."""

    items: list[str] = Field(default_factory=list)


class CompanyStatusesResponse(BaseModel):
    data: CompanyStatusesData
    meta: ApiMeta


class CompaniesData(BaseModel):
    """One page of company search results."""

    items: list[CompanySummary] = Field(default_factory=list)


class CompaniesResponse(BaseModel):
    data: CompaniesData
    meta: PaginatedMeta


class CompanyDetailResponse(BaseModel):
    data: CompanyDetail
    meta: ApiMeta


class CompanyAwardsData(BaseModel):
    """One page of a company's linked awards."""

    items: list[CompanyAward] = Field(default_factory=list)


class CompanyAwardsResponse(BaseModel):
    data: CompanyAwardsData
    meta: PaginatedMeta


# --------------------------------------------------------------------------
# Agencies
# --------------------------------------------------------------------------


class AgencyItem(BaseModel):
    """One agency selector entry."""

    agency_name: str


class AgencyPeriod(BaseModel):
    """The applied date range. Each boundary is null when not supplied."""

    start_date: date | None = None
    end_date: date | None = None


class CompanyLink(BaseModel):
    """Accepted company identity for an agency supplier row.

    Both ``uen`` and ``name`` stay null unless an accepted supplier-company
    link exists, so an unaccepted supplier never receives a company identity.
    """

    status: CompanyLinkStatus
    uen: str | None = None
    name: str | None = None


class AgencySupplierItem(BaseModel):
    """One supplier row in an agency comparison."""

    supplier_name: str = Field(description="Exact preserved GeBIZ supplier name.")
    total_award_amount: str
    award_row_count: int
    tender_count: int
    share_percent: str | None = Field(
        default=None, description="Null when the named-supplier total is zero."
    )
    company_link: CompanyLink


class AgencyAwardsSummary(BaseModel):
    """Agency totals, calculated before pagination and before filtering rows."""

    agency_name: str = Field(description="Exact selected agency name.")
    period: AgencyPeriod
    supplier_count: int = Field(description="Count of preserved supplier identities.")
    award_row_count: int
    tender_count: int
    total_award_amount: str
    average_supplier_total: str | None = Field(
        default=None, description="Null when the agency has no supplier."
    )
    excluded_no_supplier_tender_count: int


class AgenciesData(BaseModel):
    """One page of the agency selector."""

    items: list[AgencyItem] = Field(default_factory=list)


class AgenciesResponse(BaseModel):
    data: AgenciesData
    meta: PaginatedMeta


class AgencyAwardsData(BaseModel):
    """Agency summary plus one page of supplier rows."""

    summary: AgencyAwardsSummary
    items: list[AgencySupplierItem] = Field(default_factory=list)


class AgencyAwardsResponse(BaseModel):
    data: AgencyAwardsData
    meta: PaginatedMeta


# --------------------------------------------------------------------------
# Industries
# --------------------------------------------------------------------------


class IndustryItem(BaseModel):
    """One SSIC hierarchy node."""

    code: str
    title: str | None = None
    level: str | None = Field(default=None, description="Source hierarchy level label.")
    has_children: bool = False


class IndustryAwardChild(BaseModel):
    """Award totals for one immediate child branch of the SSIC hierarchy."""

    code: str
    title: str | None = None
    level: str | None = None
    total_award_amount: str
    award_row_count: int
    company_count: int
    share_percent: str | None = None


class IndustryAwardCoverage(BaseModel):
    """Rows excluded from industry totals, reported so exclusions stay visible."""

    excluded_no_accepted_link_award_row_count: int
    excluded_unresolved_primary_ssic_award_row_count: int


class IndustryAwardsSummary(BaseModel):
    """Industry totals for the selected parent and period."""

    parent_code: str | None = Field(
        default=None, description="Null when the grouping is by Section."
    )
    period: AgencyPeriod
    total_award_amount: str
    award_row_count: int
    company_count: int
    coverage: IndustryAwardCoverage


class IndustriesData(BaseModel):
    """One level of the SSIC hierarchy. Not paginated."""

    items: list[IndustryItem] = Field(default_factory=list)


class IndustriesResponse(BaseModel):
    data: IndustriesData
    meta: ApiMeta


class IndustryAwardsData(BaseModel):
    """Industry summary plus one item per immediate child branch."""

    summary: IndustryAwardsSummary
    items: list[IndustryAwardChild] = Field(default_factory=list)


class IndustryAwardsResponse(BaseModel):
    data: IndustryAwardsData
    meta: ApiMeta


# --------------------------------------------------------------------------
# Saved lists
# --------------------------------------------------------------------------


def normalize_saved_list_name(name: str) -> str:
    """Normalise a list name for the shared uniqueness and ordering rule.

    The rule is Unicode NFKD normalisation, combining accent removal, surrounding
    whitespace trimming, and case-insensitive comparison. Internal whitespace and
    punctuation stay significant.
    """

    decomposed = unicodedata.normalize("NFKD", name)
    without_accents = "".join(
        character for character in decomposed if not unicodedata.combining(character)
    )
    return without_accents.strip().casefold()


def validate_saved_list_name(value: str) -> str:
    """Apply the saved-list name rule and return the stored name.

    Surrounding whitespace is not part of the name, so it is trimmed here. The
    name must stay nonblank and within the documented length after normalisation.
    """

    normalized = normalize_saved_list_name(value)
    if not normalized:
        raise ValueError("A saved-list name must not be blank.")
    if len(normalized) > SAVED_LIST_NAME_MAX_LENGTH:
        raise ValueError(
            f"A saved-list name must be at most "
            f"{SAVED_LIST_NAME_MAX_LENGTH} characters."
        )
    return value.strip()


class SavedListCreate(BaseModel):
    """Request body for creating a saved list."""

    name: str = Field(description="List name, nonblank and at most 200 characters.")

    @field_validator("name")
    @classmethod
    def check_name(cls, value: str) -> str:
        """Reject a name that is blank or too long after normalisation."""

        return validate_saved_list_name(value)


class SavedListRename(BaseModel):
    """Request body for replacing a saved-list name."""

    name: str = Field(description="Replacement name.")

    @field_validator("name")
    @classmethod
    def check_name(cls, value: str) -> str:
        """Apply the same name rule as list creation."""

        return validate_saved_list_name(value)


class SavedListEntryCreate(BaseModel):
    """Request body for adding a company to a saved list."""

    company_uen: str = Field(description="Company identity to add.")
    review_status: ReviewStatus = Field(
        default=ReviewStatus.to_check,
        description="Entry review state. Defaults to to_check.",
    )


class SavedListEntryUpdate(BaseModel):
    """Request body for changing an entry's review status."""

    review_status: ReviewStatus


class SavedListEntry(BaseModel):
    """One company inside a saved list."""

    company_uen: str
    company_name: str | None = None
    company_status: str | None = None
    review_status: ReviewStatus


class SavedListSummary(BaseModel):
    """Saved-list metadata without entries."""

    id: str = Field(description="Opaque list identity, always a string.")
    name: str
    entry_count: int


class SavedListDetail(BaseModel):
    """Saved-list metadata with one page of entries."""

    id: str
    name: str
    entry_count: int
    entries: list[SavedListEntry] = Field(default_factory=list)


class SavedListsData(BaseModel):
    """One page of saved-list metadata."""

    items: list[SavedListSummary] = Field(default_factory=list)


class SavedListsResponse(BaseModel):
    data: SavedListsData
    meta: PaginatedMeta


class SavedListResponse(BaseModel):
    data: SavedListSummary
    meta: ApiMeta


class SavedListDetailResponse(BaseModel):
    data: SavedListDetail
    meta: PaginatedMeta


class SavedListEntryResponse(BaseModel):
    """A created or updated saved-list entry. The entry is the ``data`` object."""

    data: SavedListEntry
    meta: ApiMeta


# --------------------------------------------------------------------------
# Business Activities (System view)
# --------------------------------------------------------------------------


class ActivityNode(BaseModel):
    """One catalogue entry, as it appears in a path or parent reference."""

    code: str
    title: str
    level: str


class ActivityChild(ActivityNode):
    """An entry in a tree level."""

    has_children: bool


class ActivitySearchItem(ActivityNode):
    """A search match with its ancestors, Section first."""

    parent_path: list[ActivityNode] = Field(default_factory=list)


class ActivityDetail(ActivityNode):
    """One entry with its place in the hierarchy and its immediate children."""

    parent: ActivityNode | None = None
    path: list[ActivityNode] = Field(default_factory=list)
    child_level: str | None = Field(
        default=None, description="Level of a new child, or null for a Sub-class."
    )
    children: list[ActivityChild] = Field(default_factory=list)


class ActivityChildrenData(BaseModel):
    items: list[ActivityChild] = Field(default_factory=list)


class ActivitySearchData(BaseModel):
    items: list[ActivitySearchItem] = Field(default_factory=list)
    has_more: bool = Field(description="Whether more matches exist than were returned.")


class ActivityNextCode(BaseModel):
    code: str = Field(description="An unused, valid code for the new entry.")
    level: str = Field(description="Level the new entry would have.")


class ActivityCreate(BaseModel):
    """Request body for creating one catalogue entry."""

    title: str
    code: str
    parent_code: str | None = Field(
        default=None, description="Parent code, or null to create a Section."
    )


class ActivityRename(BaseModel):
    """Request body for changing an entry's title."""

    title: str


class ActivityChildrenResponse(BaseModel):
    data: ActivityChildrenData
    meta: ApiMeta


class ActivitySearchResponse(BaseModel):
    data: ActivitySearchData
    meta: ApiMeta


class ActivityDetailResponse(BaseModel):
    data: ActivityDetail
    meta: ApiMeta


class ActivityNextCodeResponse(BaseModel):
    data: ActivityNextCode
    meta: ApiMeta


# --------------------------------------------------------------------------
# Domain error shape
# --------------------------------------------------------------------------


class DomainErrorDetail(BaseModel):
    """A documented domain error: a short code and a safe message."""

    code: str
    message: str


class DomainErrorResponse(BaseModel):
    """The shared domain error envelope."""

    detail: DomainErrorDetail
