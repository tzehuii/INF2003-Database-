# Company sorting and database-switch regression checks

Last checked: 17 October 2026, local MariaDB and MongoDB.

## Automated API tests

Run from the repository root with the backend and both databases running:

```powershell
.\.venv\Scripts\python.exe -m unittest backend.tests.test_public_company_sorting -v
```

These three tests run read-only checks against both databases:

- All five sortable fields work in ascending and descending order while status and primary-industry filters remain applied.
- Two adjacent sorted pages equal the same combined page, do not overlap, and repeat consistently.
- Unsupported sort fields and directions return HTTP 422.

Latest result: all three passed. No imported records changed.

## Browser checks (not part of the Python automated suite)

Repeat after changing page state, loading behaviour or the database selector.

| Check | Steps | Expected | Latest result |
| --- | --- | --- | --- |
| Public search/filter/sort preservation | Search UEN 00001300E; choose Terminated and R; click Search; sort UEN descending; switch MariaDB to MongoDB and back. | Search, both selections and descending arrow remain; a result row remains visible; no full-table Loading replacement. | Passed |
| System directory preservation | Search 00001300E in System Companies & Addresses; switch databases. | Query remains; table remains visible; its document position does not move; no Loading available statuses line. | Passed |
| System company details preservation | Open View / manage for 00001300E; switch databases. | Same company stays open; detail card stays in place; no skeleton replacement; edit/delete wait for the target database to finish loading. | Previously passed; repeat with each browser check run. |

Initial page loading can show a loading state. Switching an already-loaded view should retain its layout while requesting real target-database results. A company absent from the target database should show an honest not-found result, not pretend both databases contain it.
