# INF2003-Database-

Team repository for the INF2003 Business and Tender Analytics application. It currently holds the MariaDB schema, a FastAPI backend skeleton, and the declared business API routes.

## Implemented scope

The backend currently provides the runnable foundation and the declared API surface.

- A FastAPI application with one working route, `GET /health`.
- A configuration loader for the database connection settings.
- A MariaDB connectivity check that runs `SELECT 1`.
- A MongoDB connectivity check that runs the `ping` command.
- Declared business routes under `/api` that return HTTP `501` until implemented.

Business features are deliberately not implemented yet. There is no company search, filtering, agency or industry analysis, saved lists, supplier matching, database comparison, or frontend code. The backend also runs no table queries and no writes, so the existing MariaDB and MongoDB databases stay read-only inputs.

## Prerequisite

Python **3.13** is required. Python 3.12 or older does not satisfy the specification.

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
- The example port `3307` is confirmed only for the current development machine. Use the port from your own MariaDB configuration.
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
