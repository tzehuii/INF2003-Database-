"""Configuration loading for the backend.

The backend reads its database settings from the repository-root ``.env`` file
or from real process environment variables. Process variables take precedence.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# backend/app/config.py -> repository root.
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = REPOSITORY_ROOT / ".env"

REQUIRED_KEYS = (
    "MARIADB_HOST",
    "MARIADB_PORT",
    "MARIADB_USER",
    "MARIADB_PASSWORD",
    "MARIADB_DATABASE",
    "MONGODB_URI",
    "MONGODB_DB_NAME",
)

MARIADB_DATABASE_NAME = "inf2003_db_mariadb"
MONGODB_DATABASE_NAME = "inf2003_mongodb"


@dataclass(frozen=True)
class Settings:
    """The complete database configuration."""

    mariadb_host: str
    mariadb_port: int
    mariadb_user: str
    mariadb_password: str
    mariadb_database: str
    mongodb_uri: str
    mongodb_db_name: str


def load_settings() -> Settings:
    """Load and validate the required settings.

    ``load_dotenv`` runs with ``override=False`` so that real process
    environment variables win over the local ``.env`` file.

    Raises:
        RuntimeError: A required setting is missing or invalid. The message
            names the setting but never includes its value.
    """

    load_dotenv(ENV_FILE, override=False)

    missing = [key for key in REQUIRED_KEYS if key not in os.environ]
    if missing:
        raise RuntimeError(
            "Missing required setting(s): "
            + ", ".join(missing)
            + ". Copy .env.example to .env in the repository root and fill it in."
        )

    mariadb_port_raw = os.environ["MARIADB_PORT"]
    try:
        mariadb_port = int(mariadb_port_raw)
    except ValueError:
        raise RuntimeError("MARIADB_PORT must be a whole number.") from None
    if not 1 <= mariadb_port <= 65535:
        raise RuntimeError("MARIADB_PORT must be between 1 and 65535.")

    mariadb_database = os.environ["MARIADB_DATABASE"]
    if mariadb_database != MARIADB_DATABASE_NAME:
        raise RuntimeError(f"MARIADB_DATABASE must be {MARIADB_DATABASE_NAME}.")

    mongodb_db_name = os.environ["MONGODB_DB_NAME"]
    if mongodb_db_name != MONGODB_DATABASE_NAME:
        raise RuntimeError(f"MONGODB_DB_NAME must be {MONGODB_DATABASE_NAME}.")

    return Settings(
        mariadb_host=os.environ["MARIADB_HOST"],
        mariadb_port=mariadb_port,
        mariadb_user=os.environ["MARIADB_USER"],
        # An empty password is allowed only when the variable is present.
        mariadb_password=os.environ["MARIADB_PASSWORD"],
        mariadb_database=mariadb_database,
        mongodb_uri=os.environ["MONGODB_URI"],
        mongodb_db_name=mongodb_db_name,
    )
