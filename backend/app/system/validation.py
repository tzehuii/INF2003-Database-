"""Business Activity rules shared by the MariaDB and MongoDB implementations.

Everything here is pure: no database access. Both adapters call the same
functions, so a rejected title or code reads the same whichever database is
selected.

Code format (unchanged from the imported SSIC data):

- Section: one uppercase letter.
- Division: two digits. Its Section is its parent, not a code prefix.
- Group, Class, Sub-class: three, four and five digits, each extending the
  parent's code.
"""

from __future__ import annotations

import re
import string
from typing import Callable, Collection

LEVELS = ("Section", "Division", "Group", "Class", "Sub-class")

# MariaDB BusinessActivity.ssic_title is VARCHAR(500). Applied to both databases
# so the two behave the same.
TITLE_MAX_LENGTH = 500

_CODE_PATTERNS = {
    "Section": re.compile(r"[A-Z]"),
    "Division": re.compile(r"[0-9]{2}"),
    "Group": re.compile(r"[0-9]{3}"),
    "Class": re.compile(r"[0-9]{4}"),
    "Sub-class": re.compile(r"[0-9]{5}"),
}

_CODE_FORMAT_TEXT = {
    "Section": "one uppercase letter from A to Z",
    "Division": "exactly 2 digits",
    "Group": "exactly 3 digits",
    "Class": "exactly 4 digits",
    "Sub-class": "exactly 5 digits",
}

# A code that can be used in a URL path or looked up in either database.
ANY_CODE_PATTERN = r"^[A-Z0-9]{1,5}$"


class CatalogueError(Exception):
    """A rule failure that the route turns into a documented domain error."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def child_level(level: str) -> str | None:
    """Return the level directly below ``level``, or None for a Sub-class."""

    index = LEVELS.index(level)
    return LEVELS[index + 1] if index + 1 < len(LEVELS) else None


def clean_title(title: str) -> str:
    """Trim a title and apply the nonblank and length rules."""

    cleaned = title.strip()
    if not cleaned:
        raise CatalogueError(422, "invalid_title", "The title must not be blank.")
    if len(cleaned) > TITLE_MAX_LENGTH:
        raise CatalogueError(
            422,
            "invalid_title",
            f"The title must be at most {TITLE_MAX_LENGTH} characters. "
            f"It is {len(cleaned)} characters long.",
        )
    return cleaned


def check_code(level: str, code: str, parent_code: str | None) -> str:
    """Validate a code for ``level`` and return it unchanged.

    Surrounding whitespace is trimmed. Nothing else is altered, so leading zeros
    and letter case are kept exactly as typed and a wrong case is reported.
    """

    cleaned = code.strip()
    if not _CODE_PATTERNS[level].fullmatch(cleaned):
        raise CatalogueError(
            422,
            "invalid_code",
            f"A {level} code must be {_CODE_FORMAT_TEXT[level]}.",
        )
    if level in ("Group", "Class", "Sub-class") and parent_code is not None:
        if not cleaned.startswith(parent_code):
            raise CatalogueError(
                422,
                "invalid_code",
                f"A {level} code must start with its parent's code {parent_code}.",
            )
    return cleaned


def level_for_new_entry(parent_level: str | None) -> str:
    """Return the level of a new entry created under a parent of ``parent_level``.

    ``None`` means no parent, which creates a Section.
    """

    if parent_level is None:
        return "Section"
    level = child_level(parent_level)
    if level is None:
        raise CatalogueError(
            422,
            "no_child_level",
            "A Sub-class is the lowest level, so it cannot have child entries.",
        )
    return level


def candidate_codes(level: str, parent_code: str | None) -> list[str]:
    """Every valid code for a new entry at ``level`` under ``parent_code``.

    Listed in the order they should be suggested. Codes ending in zero come last
    because the imported data starts numbering at 1.
    """

    if level == "Section":
        return list(string.ascii_uppercase)
    if level == "Division":
        return [f"{number:02d}" for number in range(1, 100)] + ["00"]
    assert parent_code is not None
    return [f"{parent_code}{digit}" for digit in "1234567890"]


def exhausted_error(level: str, parent_code: str | None) -> CatalogueError:
    """The error shown when no valid code is left."""

    if level == "Section":
        where = "All 26 Section codes (A to Z) are already in use."
    elif level == "Division":
        where = "All 100 Division codes (00 to 99) are already in use."
    else:
        where = (
            f"Every {level} code that starts with {parent_code} is already in use."
        )
    return CatalogueError(
        409,
        "code_space_exhausted",
        f"{where} No new {level} can be created here. "
        "Existing codes are never changed or extended to make room.",
    )


def suggest_code(
    level: str,
    parent_code: str | None,
    find_used: Callable[[list[str]], Collection[str]],
) -> str:
    """Return the first candidate code that the selected database does not use.

    ``find_used`` receives the candidates and returns those already stored.
    """

    candidates = candidate_codes(level, parent_code)
    used = set(find_used(candidates))
    for candidate in candidates:
        if candidate not in used:
            return candidate
    raise exhausted_error(level, parent_code)


def not_found(code: str) -> CatalogueError:
    """No catalogue entry exists for ``code`` in the selected database."""

    return CatalogueError(
        404,
        "business_activity_not_found",
        f"No business activity was found for code {code} in the selected database.",
    )


def parent_not_found(code: str) -> CatalogueError:
    """The chosen parent does not exist in the selected database."""

    return CatalogueError(
        404,
        "parent_not_found",
        f"The parent entry {code} does not exist in the selected database.",
    )


def duplicate_code(code: str) -> CatalogueError:
    """The code is already used by another entry in the selected database."""

    return CatalogueError(
        409,
        "duplicate_code",
        f"The code {code} is already in use in the selected database. "
        "Choose a different code.",
    )


def delete_blocked(code: str, has_children: bool, primary: bool, secondary: bool) -> CatalogueError:
    """Explain which dependants stop a deletion. Nothing has been changed."""

    reasons = []
    if has_children:
        reasons.append("it has child entries")
    if primary:
        reasons.append("at least one company uses it as its primary activity")
    if secondary:
        reasons.append("at least one company uses it as its secondary activity")
    return CatalogueError(
        409,
        "delete_blocked",
        f"{code} cannot be deleted because " + " and ".join(reasons) + ". "
        "Nothing was changed.",
    )
