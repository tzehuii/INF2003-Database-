-- Apply to existing project databases for Recently saved bookmark sorting.
-- Safe to run again; existing companies and saved entries are retained.
USE inf2003_db_mariadb;
ALTER TABLE SavedListEntry
    ADD COLUMN IF NOT EXISTS saved_at TIMESTAMP(6)
    NOT NULL DEFAULT CURRENT_TIMESTAMP(6);
