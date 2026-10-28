# Company overview map



## Search and coverage

Choose an SSIC section and press Search industry. The backend streams **every matching active company** from the selected database into a local derived SQLite index. Active means Live, Live Company, or Live with a receiver appointed. All matching companies appear in the scrolling directory as soon as the source snapshot is ready, even if coordinates are still pending.

Three bounded address workers confirm locations through OneMap. Progress distinguishes source collection, location checks, completion, and paused/error states. A map is described as complete only after every source company has been checked. Large selections require time on the first run; later searches reuse the stored index for up to seven days. Refresh source data creates a new snapshot after database edits. This cache is local to the backend, ignored by Git, and does not change either source database.

Red clusters query **all confirmed coordinates in the selected index**, independently of list pages. Server-side clustering and visible bounds keep large maps manageable. The directory loads 25 rows at a time by scrolling, but list pagination never restricts the map's coverage. The map page uses industry/subcategory selection; name/UEN lookup remains on Public Companies.

Mouse-wheel zoom is enabled. By default, the directory follows the map after movement settles (350 ms), while existing cards remain visible during the request. Turn off Update results as I move the map to keep the directory fixed while reading. Search this area remains available for explicit filtering. Show all locations removes the area restriction and returns to the Singapore overview. Locate on map highlights a company's confirmed pin. Unmapped contains checked companies whose locations could not be confirmed; pending companies remain visible in All companies. Shared buildings keep a company count at close zoom.

## Address accuracy

Historical four-digit postal codes are preserved. Singapore introduced six-digit codes in September 1995; an old code alone cannot identify a current building. Individual company maps remain best-effort address searches. The matcher prioritises the recorded modern postal code and building name. Nearby OneMap points for the same block, street and postal code (within 150 m) receive an approximate address pin; conflicting postal addresses or points farther apart remain unconfirmed. Previously ambiguous cached results are rechecked with the improved matcher, while confirmed locations are preserved. Missing, ambiguous, foreign and service-error results have explicit explanations.

## OneMap setup

Register using the [official authentication documentation](https://www.onemap.gov.sg/apidocs/authentication). Set either ONEMAP_ACCESS_TOKEN or both ONEMAP_EMAIL and ONEMAP_PASSWORD in the local .env, then restart the backend. Never commit credentials. The example environment file has blank placeholders. Without working access, source companies remain searchable while location checks pause with an explanation. Search industry again resumes after credentials are fixed.

## Validation

Start the backend and both databases before live integration checks:

    .\.venv\Scripts\python.exe -m unittest backend.tests.test_address_geocoding backend.tests.test_company_map_api backend.tests.test_company_map_index backend.tests.test_company_map_index_api -v
    pnpm --dir frontend exec node --test tests/address-map.test.cjs
    pnpm --dir frontend run build

Index unit tests use temporary isolated files and fixture coordinates. They cover companies beyond the first page, marker totals, area and full-name/UEN queries, pending/unmapped states, database isolation, and service outages. Live integration checks compare the full Agriculture section in both databases; they need configured OneMap and a completed/warmed index. Former browser-only cluster/batch helpers and their tests were replaced by these backend index tests.


## Progress, result tabs and advance preparation

The sidebar shows a checked/total progress bar, percentage and separate Pending count. Checked means a confirmed location or a finished, unconfirmed address. Retryable service failures remain pending, rather than being classified as permanently unmapped. The tabs are All, Mapped and Unmapped. Area restrictions apply to All/Mapped; unmapped addresses have no coordinates and remain global to the industry selection.

During location checking, an approximate remaining-time range is calculated from smoothed observed batch throughput. It is withheld until at least 100 addresses have been checked and the browser has observed the job for ten seconds. Cached addresses and new OneMap requests vary in speed, so the estimate can change. Source collection has an indeterminate bar. Backend restarts pause interrupted jobs honestly; Search resumes them.

The optional subcategory picker includes deeper SSIC categories, not only direct children. A complete parent-industry index can provide a complete child selection by copying its already-checked rows, without additional geocoding. Stored source snapshots are reused for seven days. Use Refresh source data after edits; the source databases remain independent.

To prepare all active companies before users open the page, keep the backend running and execute from the repository root:

    .\.venv\Scripts\python.exe -m backend.scripts.prepare_company_maps --all-industries --database both

To prepare a specific industry instead:

    .\.venv\Scripts\python.exe -m backend.scripts.prepare_company_maps --industry Q --database both

The command monitors durable server jobs and prints progress. It requires no open map tab. Initial all-industry geocoding can take hours; existing address matches are reused across both database modes. Stopping the monitor leaves the current backend job running. Stopping the backend pauses work until the command or Search is run again.

Education (Q) was prepared and verified in both local databases on 21 October 2026: 21,574 active companies, 21,169 mapped and 405 unmapped. Subcategory 85508 reuses that prepared index: 2,262 companies, 2,221 mapped and 41 unmapped. These counts describe this source snapshot, not permanent dataset invariants.


## Team handover

New frontend dependency: Leaflet and its TypeScript declarations. Map tiles come from OpenStreetMap; address-to-coordinate resolution uses OneMap. Individual address links still use Google Maps. SQLite is built into Python and stores only derived local cache/index data. No additional Python package is required for the map implementation.

After pulling, run pnpm install in frontend. Keep existing database settings in .env; add the OneMap settings documented in .env.example. Do not overwrite your working database credentials. Each independently running backend needs working OneMap access; a shared backend only needs configuration once. Real .env files and backend/.cache/ are ignored and must not be committed. Prepared map files on one laptop are not automatically transferred through Git.


## Commit verification (21 October 2026)

The broader regression run covered Company/Address CRUD and validation, public company search/industry filtering/sorting, public analytics, address resolution, map source selection and persistent map-index behavior. A map integration setup was initially skipped while location caches were being rechecked after the matcher update. The separate rerun of all 39 Company/Address CRUD tests plus all four live map-index integration tests passed (43 tests, no skips). Six frontend address tests and the production frontend build passed. Git whitespace checks passed. Real .env files and backend/.cache/ were confirmed ignored and untracked.

Matcher regression coverage includes the real duplicate-address shape for 21 Senoko South Road, exact modern-postal and building-name preference, deterministic nearby same-address points, and genuinely conflicting distant points. The real KAY LIM CONSTRUCTION & TRADING PTE LTD record now has an approximate pin in the saved construction index. Older ambiguous cached records are rechecked on the next industry search.
