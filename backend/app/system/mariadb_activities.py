"""Business Activity operations against MariaDB.

The catalogue lives in ``BusinessActivity``. Hierarchy comes from the
``parent_activity_id`` foreign key. Every function takes one open connection and
touches only that database.

Writes that depend on a read (create and delete) run in one transaction and lock
the row they depend on, so a parent cannot disappear, and a deletable entry
cannot gain a child, between the check and the write.
"""

from __future__ import annotations

import mariadb

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

_ESCAPE = "|"


def _like_escape(text: str) -> str:
    """Make ``text`` literal inside a LIKE pattern that uses ``|`` as escape."""

    return (
        text.replace(_ESCAPE, _ESCAPE * 2).replace("%", f"{_ESCAPE}%").replace("_", f"{_ESCAPE}_")
    )


def _rollback(conn) -> None:
    try:
        conn.rollback()
    except mariadb.Error:
        pass


def _node(row) -> dict:
    return {"code": row[0], "title": row[1], "level": row[2]}


def _find(cur, code: str, lock: bool = False):
    """Return ``(activity_id, code, title, level)`` for ``code`` or None."""

    cur.execute(
        "SELECT activity_id, ssic_code, ssic_title, ssic_level FROM BusinessActivity "
        "WHERE ssic_code = ?" + (" FOR UPDATE" if lock else ""),
        (code,),
    )
    return cur.fetchone()


def _paths(cur, rows) -> dict[int, list[dict]]:
    """Return each row's ancestors, Section first, keyed by activity id.

    ``rows`` are ``(activity_id, parent_activity_id, code, title, level)``. The
    hierarchy has five levels, so at most four extra lookups are needed.
    """

    known = {row[0]: row for row in rows}
    missing = {row[1] for row in rows if row[1] is not None and row[1] not in known}
    while missing:
        marks = ",".join("?" for _ in missing)
        cur.execute(
            "SELECT activity_id, parent_activity_id, ssic_code, ssic_title, ssic_level "
            f"FROM BusinessActivity WHERE activity_id IN ({marks})",
            tuple(missing),
        )
        fetched = cur.fetchall()
        for row in fetched:
            known[row[0]] = row
        missing = {row[1] for row in fetched if row[1] is not None and row[1] not in known}

    paths: dict[int, list[dict]] = {}
    for row in rows:
        chain: list[dict] = []
        parent_id = row[1]
        while parent_id is not None and parent_id in known:
            parent = known[parent_id]
            chain.append({"code": parent[2], "title": parent[3], "level": parent[4]})
            parent_id = parent[1]
        paths[row[0]] = list(reversed(chain))
    return paths


def list_children(conn, parent_code: str | None, section: str | None) -> list[dict]:
    """Return Sections, or the immediate children of ``parent_code``.

    ``section`` limits the top level to one Section. Below the top level every
    entry already belongs to the chosen Section, so it has no further effect.
    """

    cur = conn.cursor()
    try:
        if parent_code is None:
            sql = (
                "SELECT b.ssic_code, b.ssic_title, b.ssic_level, "
                "EXISTS(SELECT 1 FROM BusinessActivity c "
                "WHERE c.parent_activity_id = b.activity_id) "
                "FROM BusinessActivity b WHERE b.ssic_level = 'Section'"
            )
            params: tuple = ()
            if section is not None:
                sql += " AND b.ssic_code = ?"
                params = (section,)
            cur.execute(sql + " ORDER BY b.ssic_code", params)
        else:
            parent = _find(cur, parent_code)
            if parent is None:
                raise not_found(parent_code)
            cur.execute(
                "SELECT b.ssic_code, b.ssic_title, b.ssic_level, "
                "EXISTS(SELECT 1 FROM BusinessActivity c "
                "WHERE c.parent_activity_id = b.activity_id) "
                "FROM BusinessActivity b WHERE b.parent_activity_id = ? "
                "ORDER BY b.ssic_code",
                (parent[0],),
            )
        return [{**_node(row), "has_children": bool(row[3])} for row in cur.fetchall()]
    finally:
        cur.close()


def search(conn, text: str, section: str | None, limit: int) -> tuple[list[dict], bool]:
    """Find entries whose title contains ``text`` or whose code starts with it.

    The column collation is case-insensitive. Returns the matches, shallowest
    level first, and whether more matches exist beyond ``limit``.
    """

    escaped = _like_escape(text)
    cur = conn.cursor()
    try:
        select = (
            "SELECT b.activity_id, b.parent_activity_id, b.ssic_code, b.ssic_title, "
            "b.ssic_level FROM BusinessActivity b "
        )
        where = (
            f"(b.ssic_title LIKE ? ESCAPE '{_ESCAPE}' OR b.ssic_code LIKE ? ESCAPE '{_ESCAPE}')"
        )
        order = " ORDER BY CHAR_LENGTH(b.ssic_code), b.ssic_code LIMIT ?"
        like_params = (f"%{escaped}%", f"{escaped}%")

        if section is None:
            cur.execute(select + "WHERE " + where + order, (*like_params, limit + 1))
        else:
            cur.execute(
                "WITH RECURSIVE branch AS ("
                "SELECT activity_id FROM BusinessActivity WHERE ssic_code = ? "
                "UNION ALL "
                "SELECT c.activity_id FROM BusinessActivity c "
                "JOIN branch ON c.parent_activity_id = branch.activity_id) "
                + select
                + "JOIN branch ON branch.activity_id = b.activity_id WHERE "
                + where
                + order,
                (section, *like_params, limit + 1),
            )
        rows = cur.fetchall()
        has_more = len(rows) > limit
        rows = rows[:limit]
        paths = _paths(cur, rows)
        items = [
            {
                "code": row[2],
                "title": row[3],
                "level": row[4],
                "parent_path": paths[row[0]],
            }
            for row in rows
        ]
        return items, has_more
    finally:
        cur.close()


def read_detail(conn, code: str) -> dict:
    """Return one entry with its ancestors and immediate children."""

    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT activity_id, parent_activity_id, ssic_code, ssic_title, ssic_level "
            "FROM BusinessActivity WHERE ssic_code = ?",
            (code,),
        )
        row = cur.fetchone()
        if row is None:
            raise not_found(code)
        path = _paths(cur, [row])[row[0]]
    finally:
        cur.close()

    return {
        "code": row[2],
        "title": row[3],
        "level": row[4],
        "parent": path[-1] if path else None,
        "path": path,
        "child_level": child_level(row[4]),
        "children": list_children(conn, code, None),
    }


def _used_codes(cur, candidates: list[str]) -> set[str]:
    marks = ",".join("?" for _ in candidates)
    cur.execute(
        f"SELECT ssic_code FROM BusinessActivity WHERE ssic_code IN ({marks})",
        tuple(candidates),
    )
    return {row[0] for row in cur.fetchall()}


def next_code(conn, parent_code: str | None, after: str | None = None) -> dict:
    """Suggest an unused code for a new child of ``parent_code``."""

    cur = conn.cursor()
    try:
        parent_level = None
        if parent_code is not None:
            parent = _find(cur, parent_code)
            if parent is None:
                raise parent_not_found(parent_code)
            parent_level = parent[3]
        level = level_for_new_entry(parent_level)
        code = suggest_code(level, parent_code, lambda codes: _used_codes(cur, codes), after)
        return {"code": code, "level": level}
    finally:
        cur.close()


def create(conn, title: str, code: str, parent_code: str | None) -> dict:
    """Insert one entry under ``parent_code`` and return it read back."""

    title = clean_title(title)
    conn.autocommit = False
    cur = conn.cursor()
    try:
        parent_id = None
        parent_level = None
        if parent_code is not None:
            # The lock keeps the parent in place until this transaction ends.
            parent = _find(cur, parent_code, lock=True)
            if parent is None:
                raise parent_not_found(parent_code)
            parent_id, parent_level = parent[0], parent[3]

        level = level_for_new_entry(parent_level)
        code = check_code(level, code, parent_code)

        if _find(cur, code) is not None:
            raise duplicate_code(code)
        try:
            cur.execute(
                "INSERT INTO BusinessActivity "
                "(parent_activity_id, ssic_code, ssic_title, ssic_level) VALUES (?, ?, ?, ?)",
                (parent_id, code, title, level),
            )
        except mariadb.IntegrityError:
            # Another request took the code after the check above.
            raise duplicate_code(code) from None
        conn.commit()
    except BaseException:
        _rollback(conn)
        raise
    finally:
        cur.close()

    return read_detail(conn, code)


def rename(conn, code: str, title: str) -> dict:
    """Change only the title of one entry and return it read back."""

    title = clean_title(title)
    cur = conn.cursor()
    try:
        if _find(cur, code) is None:
            raise not_found(code)
        cur.execute("UPDATE BusinessActivity SET ssic_title = ? WHERE ssic_code = ?", (title, code))
        conn.commit()
    except BaseException:
        _rollback(conn)
        raise
    finally:
        cur.close()

    return read_detail(conn, code)


def delete(conn, code: str) -> None:
    """Delete one entry if it has no children and no company assignment.

    The checks and the delete run in one transaction while the row is locked, so
    the decision is made against the stored data and not against what a screen
    showed earlier. Nothing is changed when the entry is blocked.
    """

    conn.autocommit = False
    cur = conn.cursor()
    try:
        target = _find(cur, code, lock=True)
        if target is None:
            raise not_found(code)
        activity_id = target[0]

        cur.execute(
            "SELECT EXISTS(SELECT 1 FROM BusinessActivity WHERE parent_activity_id = ?)",
            (activity_id,),
        )
        has_children = bool(cur.fetchone()[0])

        cur.execute(
            "SELECT LOWER(activity_type) FROM CompanyActivity WHERE activity_id = ? "
            "GROUP BY LOWER(activity_type)",
            (activity_id,),
        )
        types = {row[0] for row in cur.fetchall()}
        primary = "primary" in types
        secondary = "secondary" in types

        if has_children or primary or secondary:
            raise delete_blocked(code, has_children, primary, secondary)

        try:
            cur.execute("DELETE FROM BusinessActivity WHERE activity_id = ?", (activity_id,))
        except mariadb.IntegrityError:
            # The company-activity foreign key refused the delete.
            raise CatalogueError(
                409,
                "delete_blocked",
                f"{code} cannot be deleted because company records still use it. "
                "Nothing was changed.",
            ) from None
        conn.commit()
    except BaseException:
        _rollback(conn)
        raise
    finally:
        cur.close()
