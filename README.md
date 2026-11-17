# BTA: Business and Tender Analytics

Business and Tender Analytics brings Singapore company registration, industry classification and government procurement information into one web application. Users can explore companies and tender awards, save companies, and view registered locations on a map. Administrators can maintain records and compare the MariaDB and MongoDB implementations.

The project implements corresponding features using a relational database and a document database. It includes tools for inspecting their structures, checking data consistency and comparing query performance.

## Application features

| View | Features |
| --- | --- |
| Public — Companies | Search by UEN or current/former company name; filter by registry status, primary industry and linked awards; sort records and select the page size or page number. |
| Public — Company details | View available company information, addresses, business activities, former names, linked awards and address mapping. |
| Public — Saved companies | Bookmark companies, search and sort saved entries, remove entries and undo a recent removal. Bookmark membership is shared across database switches in the same browser. |
| Public — Company map | Search active companies by industry, explore clustered locations, follow the visible map area, and filter mapped or unmapped results. Location checks show progress and preserve uncertain source addresses. |
| Public — Award analysis | Explore agency and industry award analysis, including aggregated supplier awards and industry classifications. |
| System — Record management | Create, view, update and delete records through the Business Activities, Suppliers, Tenders & Awards, and Companies & Addresses modules, subject to validation and relationship checks. |
| System — Database schema | Inspect database structures, relationships, collection designs, indexes and record counts. |
| System — Data consistency | Compare record counts and run a detailed comparison of the business data represented in both databases. Checks report differences; they do not synchronise records. |
| System — Performance | Compare company lookup, company profile retrieval, company name search, agency award aggregation and industry award aggregation workloads. |

Public browsing does not require administrator sign-in. System functions require an authenticated administrator session.

## Architecture and database behaviour

```text
Browser: React + Vite + TypeScript
                 |
                 | HTTP /api requests
                 v
          FastAPI backend
          /             \
     MariaDB           MongoDB
```

The backend handles validation, authentication and database-specific queries. MariaDB stores related information in 12 tables. MongoDB represents the corresponding information in seven collections, embedding selected data such as company addresses, former names, activities and tender awards.

- **Database selection:** Ordinary browsing and record-management operations use the selected database. Editing a company, supplier or tender in one database does not automatically copy that edit to the other database. Schema, consistency and performance pages inspect or compare both implementations.
- **Saved companies:** Bookmark membership is retained in browser storage and mirrored to saved lists in both databases. This does not copy company records. Synchronisation requires the company to exist in the target database and that database to be reachable; use the retry option if synchronisation is incomplete. This is a browser-based feature, not an account-based service shared across devices.
- **Model differences:** MariaDB supports multiple addresses per company, while the current MongoDB company document stores one address object. These differences matter when interpreting comparisons after database-specific edits.
- **Mapping:** Leaflet displays OpenStreetMap tiles. SLA OneMap resolves address information into coordinates. A local SQLite cache stores derived map data; it is separate from the source company records and requires no additional database server.

## Requirements

The commands below are for **Windows PowerShell**, run from the repository root. Install the required tools and ensure their commands are available on `PATH`.

| Software | Project requirement / recorded version | Purpose |
| --- | --- | --- |
| Python | 3.13 | FastAPI backend and Python scripts |
| Node.js and npm | Supported LTS release, 22.12 or newer | Frontend dependencies, development server and build |
| MariaDB Server | MariaDB 12; recorded setup uses 12.3.3 | Relational database |
| MongoDB Server | Recorded setup uses 8.3.11 | Document database |
| MongoDB Database Tools | Recorded setup uses 100.18.0 | `mongorestore` for the supplied archive |
| MariaDB command-line client | Compatible with the server | Schema and SQL data import |

The recorded versions describe the project setup, not a guarantee that every other version has been tested. Python package versions are pinned in `requirements.txt`; frontend dependencies are defined in `frontend/package.json` and `frontend/package-lock.json`.

Use **MariaDB Server**, rather than assuming that a MySQL installation supports the supplied schema. The schema uses the MariaDB collation `utf8mb4_uca1400_ai_ci`.

## First-time setup

### 1. Install application dependencies

Open PowerShell in the cloned project folder:

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm.cmd --prefix frontend ci
```

The commands use the virtual environment's Python directly, so activating the environment is optional. `npm.cmd` also avoids PowerShell execution-policy errors associated with `npm.ps1`.

### 2. Configure the environment

Create the local configuration only if it does not already exist:

```powershell
if (-not (Test-Path -LiteralPath .env)) {
    Copy-Item -LiteralPath .env.example -Destination .env
}
```

Edit the repository-root `.env` with your local connection details:

```dotenv
MARIADB_HOST=127.0.0.1
MARIADB_PORT=3306
MARIADB_USER=your_local_username
MARIADB_PASSWORD=your_local_password
MARIADB_DATABASE=inf2003_db_mariadb

MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB_NAME=inf2003_mongodb
```

**Use your actual MariaDB port.** The example file uses `3307`; the block above illustrates `3306`. The import commands and backend configuration must connect to the same server and port.

Both database configurations are required when loading backend settings. The application expects the database names `inf2003_db_mariadb` and `inf2003_mongodb`. Process environment variables take precedence over values in `.env`.

Keep real credentials in local configuration. Do not commit `.env` or add credentials to screenshots or reports. Optional OneMap settings are explained below.

### 3. Restore the project datasets

**Skip this step if your databases already contain the current project data.** Start both database services before importing or running the application.

Obtain the matching MariaDB data-only SQL dump and compressed MongoDB archive from the project's data/submission package. The large dataset files are not included in this checkout. Use the same dataset version for both databases so that consistency and performance comparisons are meaningful.

The examples below assume the supplied files have been placed in `C:\ProjectApp-data`. Replace the filenames with those in your package and change the MariaDB port if necessary. Use fresh project databases for the initial restore; the schema contains table-creation statements and is not an upgrade script for existing tables.

#### MariaDB

Create the schema first, then import the data-only dump. Run these commands from the repository root:

```powershell
mariadb --host=127.0.0.1 --port=3306 --user=root --password --execute="source sql/INF2003_Grp1_database_schema_mariadb.sql"
mariadb --host=127.0.0.1 --port=3306 --user=root --password --database=inf2003_db_mariadb --execute="source C:/ProjectApp-data/inf2003_data_only.sql"
```

Replace `root` with your import user if needed. `--password` prompts for the password without placing it directly in the command.

#### MongoDB

```powershell
mongorestore --uri="mongodb://127.0.0.1:27017" --gzip --archive="C:\ProjectApp-data\inf2003_mongodb.archive" --nsInclude="inf2003_mongodb.*" --stopOnError
```

The supplied archive contains the MongoDB records, supplier links, indexes and validators. A separate supplier-matching step is not required after restoring that archive. Use your configured connection URI if MongoDB runs elsewhere or requires authentication.

#### Updating an older MariaDB installation

Older project databases without bookmark timestamps require this migration once:

```powershell
mariadb --host=127.0.0.1 --port=3306 --user=root --password --execute="source sql/20261016_saved_company_timestamps.sql"
```

The migration adds the missing `saved_at` column if necessary and can be rerun safely. Fresh databases created with the current schema already include it. Do not rerun the full schema to apply this migration.

## Run the application

Once dependencies, configuration and datasets are ready, start the application in **two terminals**, both opened at the repository root. Keep both database services running.

### Terminal 1 — backend

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

### Terminal 2 — frontend

```powershell
npm.cmd --prefix frontend run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

| Address | Purpose |
| --- | --- |
| <http://127.0.0.1:5173> | Web application |
| <http://127.0.0.1:8000/docs> | FastAPI interactive API documentation |
| <http://127.0.0.1:8000/health> | Backend and database connectivity check |

The frontend development server forwards `/api` requests to port `8000` through `frontend/vite.config.ts`. If you change the backend port, update that proxy target as well.

To stop the application, press **Ctrl+C in each application terminal**. This stops the frontend and backend processes; database services remain running separately.

### Administrator sign-in

Select **System** and sign in with the local demonstration account:

```text
Username: admin01
Password: INF2003Admin
```

Protected backend routes also check authentication; opening a System API URL without an authenticated request is rejected. Sessions are held in backend memory, so restarting the backend requires signing in again.

### Verify connectivity

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8000/health
```

A successful health response confirms connectivity. It does not establish that all datasets have been imported or that their contents match. Use the System view's data consistency checks for those comparisons.

## Optional: OneMap and company-map preparation

OneMap is used to obtain coordinates from Singapore addresses; it is not the application's company-data source. Company browsing and other database functions can run without OneMap credentials, but new location checks may pause until authentication is available.

Set these optional values in the repository-root `.env`:

```dotenv
ONEMAP_EMAIL=
ONEMAP_PASSWORD=
ONEMAP_ACCESS_TOKEN=
```

Use your OneMap account email and password to allow token renewal, or supply an access token. A non-empty `ONEMAP_ACCESS_TOKEN` takes precedence and must be replaced when it expires. Keep these credentials on the backend and restart it after changing the environment configuration.

The map shows source-loading and location-check progress, with separate mapped, unmapped and pending states. Confirmed locations are cached for later searches. Historical, incomplete or ambiguous addresses are preserved rather than silently rewritten or assigned an unsupported pin. An active registration status does not establish that a company currently operates at its registered address.

To prepare an industry before a demonstration, run this in another terminal while the backend is available on port `8000`:

```powershell
.\.venv\Scripts\python.exe -m backend.scripts.prepare_company_maps --industry Q --database both
```

To prepare all industries:

```powershell
.\.venv\Scripts\python.exe -m backend.scripts.prepare_company_maps --all-industries --database both
```

Preparing all industries can take substantial time and is not required for ordinary startup. Results are cached locally rather than committed to Git. After changing company/address records, use **Refresh source data** to update the affected map snapshot; the map is not automatically refreshed after every source edit.

See [Company map documentation](docs/company-map.md) for matching rules, map-area filtering, caching, preparation and troubleshooting.

## Testing and validation

Install dependencies before running these commands. Test results depend on the current checkout and environment; this README does not assert that every test has passed on a new installation.

### Frontend regression tests

```powershell
node --test "frontend/tests/*.test.cjs"
```

These cover behaviour such as navigation state, database switching, saved-company rendering, shared bookmarks and address-map handling.

### Frontend production build

```powershell
npm.cmd --prefix frontend run build
```

This runs TypeScript checking and the Vite build. The development proxy is not a production deployment configuration; serving the built frontend also requires an appropriate backend/API routing setup.

### Backend tests

Start the backend on port `8000` and make both project databases available, then run:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -p "test_*.py" -v
```

The suite includes API integration tests as well as validation, filtering, sorting, bookmark and mapping checks. Some checks require prepared data or optional map configuration. Integration tests may create and clean up test records, so run them against a local development/test installation rather than a database containing important independent edits.

For manual checks, verify public searches and pagination, company details, saving/removing across database switches, administrator CRUD and validation, map-area filtering, and layouts at different screen sizes. Additional regression notes are in [Company regression checks](docs/testing/company-regression-checks.md).

### Consistency and performance checks

Use **System → Data Consistency** to compare counts and then detailed records. Equal counts alone do not prove that field values and relationships match. Differences after edits to only one database should be investigated in that context.

Use **System → Performance** to run equivalent read workloads against both databases. Record the selected workloads, repetitions, concurrency, duration and environment when reporting results. The benchmark measures database operations and associated backend processing, excluding browser rendering and HTTP response delivery; results should not be presented as full website response times.

## Repository structure

```text
backend/
  app/                 FastAPI application, routes and database-specific logic
  scripts/             Company-map preparation utilities
  tests/               Backend unit and API integration tests
docs/                  Feature documentation and regression notes
frontend/
  src/                 React application
  tests/               Frontend regression tests
scripts/               Database maintenance utilities
sql/                   MariaDB schema and migrations
.env.example           Configuration template without real credentials
requirements.txt       Python dependencies
```

## Troubleshooting

| Issue | Check / action |
| --- | --- |
| Database could not be reached | Confirm that the selected database service is running and that the host, port, credentials and fixed database name in the backend configuration are correct. Check `/health`. |
| Missing-setting error during backend startup | Supply all required MariaDB and MongoDB settings. Check process environment variables too, because they override `.env`. |
| Unknown collation `utf8mb4_uca1400_ai_ci` | Check the actual database server and version connected to by the import command. Use the supported MariaDB server/port; a MySQL instance or older MariaDB server may reject this collation. |
| Table already exists during schema import | The full schema is intended for a fresh setup. Use the relevant migration for an existing installation rather than rerunning table creation. |
| `node`, `npm`, `mariadb` or `mongorestore` not recognised | Install the corresponding tool, add its executable directory to `PATH`, then open a new terminal. |
| PowerShell blocks `npm.ps1` | Use the documented `npm.cmd` commands. |
| Port `5173` or `8000` is in use | Stop the earlier application process in its terminal, or identify the conflicting service. Keep frontend proxy and backend ports aligned if changing the setup. |
| Administrator API returns `not_authenticated` | Sign in through the System view. A direct browser request without the application's authentication token is expected to be rejected. |
| Saved companies have incomplete synchronisation | Ensure both databases are reachable and the company exists in both, then retry. Bookmark mirroring does not import a missing company. |
| Map checks pause or locations are unavailable | Check OneMap authentication and network access. Some source addresses cannot be resolved confidently even with valid credentials. |
| Map does not reflect a recent source edit | Refresh source data for the relevant industry/database. Cached map results are derived snapshots. |

## Current deployment limitations

This setup is intended for local project development and demonstration. The demonstration administrator credentials and in-memory sessions should be replaced with an appropriate authentication and session-management approach before production deployment.

MariaDB transactions support committing or rolling back related writes together. MongoDB updates are atomic within a document, but operations spanning several documents are not covered by a multi-document transaction in the current standalone deployment. Application reference checks help maintain relationships, but do not provide the same guarantees as relational foreign keys or a transaction spanning all affected documents.
