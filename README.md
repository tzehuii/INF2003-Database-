# ProjectApp

Run the Business and Tender Analytics web application locally on Windows. Use PowerShell for the commands below.

## First-time setup

### 1. Install the required software

- Python 3.13, with the Windows Python launcher (`py`).
- Node.js 22.12 or newer in a supported LTS release, including npm.
- MariaDB 12.3, matching the supplied database dump, including the `mariadb` command-line client.
- MongoDB Community Server and MongoDB Database Tools, including `mongorestore`.

Start the MariaDB and MongoDB services. Make sure `py`, `npm`, `mariadb` and `mongorestore` are available in your terminal. Open a new terminal after installing software.

Download or clone this repository, then open PowerShell in its root folder, the folder containing this README.

### 2. Load the databases once

Skip this step if both project databases are already populated on your machine. Import only into a fresh local setup, not a database containing work you want to keep.

Obtain these files from the project team. They are distributed separately from the repository.

- `inf2003_data_only.sql`, the MariaDB data dump.
- `inf2003_mongodb.archive`, the compressed MongoDB backup.

In the full project folder, the files are in `05_Data/` and `04_Outputs/` respectively. For the commands below, place copies in `C:\ProjectApp-data\`, outside the repository.

**MariaDB**

From the repository root, connect using your local administrator account. Replace `3306` with your actual MariaDB port in both commands. Enter your password when prompted.

```powershell
mariadb --host=127.0.0.1 --port=3306 --user=root --password --execute="source sql/INF2003_Grp1_database_schema_mariadb.sql"
mariadb --host=127.0.0.1 --port=3306 --user=root --password --execute="source C:/ProjectApp-data/inf2003_data_only.sql"
```

Run the schema command first, then the data command. They create and populate `inf2003_db_mariadb`. The data import is large and may take a while.

**MongoDB**

Restore the backup into your local server.

```powershell
mongorestore --uri="mongodb://127.0.0.1:27017" --gzip --archive="C:\ProjectApp-data\inf2003_mongodb.archive" --stopOnError
```

This restores `inf2003_mongodb`. If your server requires authentication or uses another address, use its connection URI instead. Do not proceed if either import reports errors.

### 3. Install application dependencies

From the repository root, run these commands once.

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm --prefix frontend ci
```

### 4. Set your database connection details

Copy the example configuration only if you do not already have a `.env` file.

```powershell
Copy-Item .env.example .env
notepad .env
```

Set `MARIADB_HOST`, `MARIADB_PORT`, `MARIADB_USER` and `MARIADB_PASSWORD` to your local connection details. The example port is `3307`, so change it if your server uses another port. Set `MONGODB_URI` to your MongoDB connection URI.

Keep the database names as `MARIADB_DATABASE=inf2003_db_mariadb` and `MONGODB_DB_NAME=inf2003_mongodb`. Save the file. Never commit `.env` or share its passwords.

## Run the application

Use these steps after setup and whenever you want to run the app again. Keep both database services running.

**Terminal 1**, from the repository root, start the backend.

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

**Terminal 2**, also from the repository root, start the frontend.

```powershell
npm --prefix frontend run dev
```

Open **http://localhost:5173/**, or the address printed by Vite if that port is occupied. Keep both terminals open. Press `Ctrl+C` in each terminal to stop the app.

To check database connectivity, open **http://127.0.0.1:8000/health**. A healthy response shows `status` as `ok` and both databases as `reachable`. In the app, switch to **System → Business Activities** to browse the real catalogue in either database. Public pages may still show labelled sample data or a not-implemented notice.

## Troubleshooting

- **A command is not recognised.** Check that the required software is installed and its executable folder is on your Windows `PATH`. Reopen PowerShell after changing it.
- **Python package installation fails for `mariadb`.** Check that you are using Python 3.13. If the error asks for Connector/C or build tools, install the requested MariaDB Connector/C or Microsoft C++ Build Tools, then retry.
- **The backend reports missing settings or an unreachable database.** Check the root `.env`, database services, ports, credentials and exact database names. Restart the backend after editing `.env`. Existing environment variables override `.env`.
- **The catalogue is empty.** Confirm both imports completed successfully. A reachable database is not necessarily populated.
- **MongoDB creation reports a validation error.** Ask the team for a current backup. Older backups may reject manually created activities. Do not disable database validation.
- **The page cannot reach the backend.** Keep Terminal 1 running on port `8000`, then refresh the page.
