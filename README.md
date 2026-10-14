# BTA: Business and Tender Analytics

Business and Tender Analytics using MariaDB, MongoDB, FastAPI and React.

Windows PowerShell commands run from the repository root. Both database services must be running, with the listed tools available on `PATH`.

## Requirements

| Software | Version | Command |
| --- | --- | --- |
| Python | 3.13 | `py` |
| Node.js and npm | Supported LTS, 22.12 or newer | `node`, `npm` |
| MariaDB Server and client | 12.3, tested with 12.3.3 | `mariadb` |
| MongoDB Community Server | Tested with 8.3.11 | MongoDB service |
| MongoDB Database Tools | Tested with 100.18.0 | `mongorestore` |

## Database restore

| File | Contents |
| --- | --- |
| `inf2003_data_only.sql` | MariaDB data, loaded after the repository schema |
| `inf2003_mongodb.archive` | MongoDB records, company connections, indexes and validators |

Commands below use `C:\ProjectApp-data\` as an example backup location. Paths, ports and credentials must match the local environment.

**Restore into fresh databases only.** Existing current databases need no import. These commands do not replace older copies safely. Back up existing work before replacement, and stop if an import fails.

### MariaDB

Schema first, then data. `--password` prompts for the administrator account's password.

```powershell
mariadb --host=127.0.0.1 --port=3306 --user=root --password --execute="source sql/INF2003_Grp1_database_schema_mariadb.sql"
mariadb --host=127.0.0.1 --port=3306 --user=root --password --execute="source C:/ProjectApp-data/inf2003_data_only.sql"
```

### MongoDB

```powershell
mongorestore --uri="mongodb://127.0.0.1:27017" --gzip --archive="C:\ProjectApp-data\inf2003_mongodb.archive" --nsInclude="inf2003_mongodb.*" --stopOnError
```

No separate supplier-matching step is required after restoring the supplied archive.

## Dependencies

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm --prefix frontend ci
```

## Configuration

The backend reads the repository-root `.env`. Create it only if absent.

```powershell
Copy-Item .env.example .env
```

Example values for `.env` follow. Replace the account credentials and connection details with local values.

```dotenv
MARIADB_HOST=127.0.0.1
MARIADB_PORT=3306
MARIADB_USER=your_local_username
MARIADB_PASSWORD=your_local_password
MARIADB_DATABASE=inf2003_db_mariadb

MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB_NAME=inf2003_mongodb
```

Both database names are fixed. Both connections are required. The MariaDB account needs read/write access to the project database. `.env.example` uses port `3307`, which may differ from the local server. Process environment variables override `.env`. Credentials must not be committed.

## Run

Backend and frontend run in separate terminals.

### Backend

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

### Frontend

```powershell
npm --prefix frontend run dev
```

## Connectivity check

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/health"
```

Expected response has `status` equal to `ok` and both databases marked `reachable`. This confirms connectivity, not a complete data import. **System → Business Activities** loads the real catalogue in either database mode.
