# ProjectApp

Team repository for the INF2003 Business and Tender Analytics application. It holds the MariaDB schema, a FastAPI backend, the declared business API routes, and a React frontend.

## Implemented scope

The backend currently provides the runnable foundation and the declared API surface, and the frontend provides the page structure.

- A FastAPI application with one working route, `GET /health`.
- A configuration loader for the database connection settings.
- A MariaDB connectivity check that runs `SELECT 1`.
- A MongoDB connectivity check that runs the `ping` command.
- Declared business routes under `/api` that return HTTP `501` until implemented.
- A React + TypeScript + Vite frontend under `frontend/` with the five pages, the global MariaDB / MongoDB selector, and a small API client.

Business features are deliberately not implemented yet. There is no company search, filtering, agency or industry analysis, saved lists, supplier matching, or database comparison. The backend runs no table queries and no writes, so the existing MariaDB and MongoDB databases stay read-only inputs. The frontend contains no SQL and no MongoDB query logic, and it displays only clearly labelled placeholder values while the business routes return `501`.

## Prerequisite

Python **3.13** is required. Python 3.12 and older are not supported.

```powershell
python --version
```

Use the explicit Python 3.13 executable when creating the environment if your default `python` is older.

## Virtual environment and dependencies

Create exactly one environment at the repository root, then install the pinned dependencies.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe --version
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Confirm the reported version is Python `3.13.x` and that dependencies are consistent.

```powershell
.\.venv\Scripts\python.exe -m pip check
```

## Configuration

Copy the committed example to a local `.env` in the repository root.

```powershell
Copy-Item .env.example .env
```

Then edit `.env` and replace the placeholder values. The required keys are `MARIADB_HOST`, `MARIADB_PORT`, `MARIADB_USER`, `MARIADB_PASSWORD`, `MARIADB_DATABASE`, `MONGODB_URI`, and `MONGODB_DB_NAME`.

- `MARIADB_DATABASE` must be `inf2003_db_mariadb` and `MONGODB_DB_NAME` must be `inf2003_mongodb`.
- The example port `3307` is a local value only. Use the port from your own MariaDB configuration.
- The example file contains placeholders only. Never commit a real `.env`, real credentials, or a real connection string.
- Real process environment variables take precedence over `.env` values.

The MongoDB key names are shared with the MongoDB scripts in the sibling `database/` folder, so both files must keep the same `MONGODB_URI` and `MONGODB_DB_NAME` values while both exist.

## Start the backend

Run this from the repository root.

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

An optional development convenience is `--reload`. It is not part of the acceptance criteria.

Stop the server with `Ctrl+C`.

## Health check

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

When both databases are reachable the route returns HTTP `200`.

```json
{
  "status": "ok",
  "databases": {
    "mariadb": "reachable",
    "mongodb": "reachable"
  }
}
```

When either database is unreachable the route returns HTTP `503` and reports each database separately. The response never includes credentials, connection strings, stack traces, or raw connector error messages.

```json
{
  "status": "degraded",
  "databases": {
    "mariadb": "unreachable",
    "mongodb": "reachable"
  }
}
```

FastAPI's interactive documentation is available at `http://127.0.0.1:8000/docs`.

## Current limitation

Business endpoints are declared but not implemented. They appear in `/docs` and `/openapi.json` with their full request and response shape, and each one returns HTTP `501` with a `not_implemented` code. `GET /health` is the only route that performs real work, and it reports database reachability alone.

## Frontend

The frontend lives in `frontend/`. It uses React, TypeScript, Vite, React Router, and plain CSS. No other runtime dependency was added.

Node.js 20.19 or newer is required by Vite 8.

```powershell
cd frontend
npm install
```

Start the backend first, in a separate terminal from the repository root.

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Then start the frontend.

```powershell
cd frontend
npm run dev
```

The development server runs at `http://localhost:5173/`. It proxies every `/api` request to the backend on `127.0.0.1:8000`, so no backend CORS change is needed and the frontend always calls the real API routes.

### Pages

| Route | Page |
| --- | --- |
| `/companies` | Company search, filters, results table, and pagination |
| `/companies/:uen` | Company detail |
| `/agency-awards` | Agency supplier comparison |
| `/industry-awards` | Industry award comparison |
| `/saved-lists` | Saved company lists and review status |

Opening `/` redirects to `/companies`. The database selector in the header is global and adds `database=mariadb` or `database=mongodb` to every business request.

Build the production bundle with the following command. The `dist/` output is not committed.

```powershell
cd frontend
npm run build
```

### Placeholder data

`frontend/src/api/mockData.ts` exists only so the page layouts can be reviewed while the business routes return `501`. Every sample company and agency name is prefixed with `(sample)`, every page that shows those values carries a visible placeholder notice, and no value is presented as real data. The file and the pages' use of it are deleted as each real API response is wired in.

The frontend shows the real backend state at the top of each page. A `501` response appears as an expected "not implemented yet" notice. A `409 supplier_matching_not_ready` response appears as a blocked state on the company-linked-award views. The backend returns `501` for those requests while the routes are unimplemented, so that blocked state is handled but not currently reachable.

Industry award analysis is not blocked. Incomplete supplier matching reduces its coverage rather than its availability, so it returns a normal response and reports excluded rows through its coverage counts. Industry totals include matched suppliers with a valid primary SSIC, and unmatched suppliers are excluded.
