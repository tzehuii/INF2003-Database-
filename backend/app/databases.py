"""Database client lifecycle and read-only connectivity checks.

Two database operations are performed here.

- MariaDB: one direct connection running ``SELECT 1``.
- MongoDB: the ``ping`` command against the selected application database.

``connect_mariadb`` also opens a plain connection for the Business Activities
routes. No schema setup, migration, import, collection query, or data write
happens in this module.
"""

from __future__ import annotations

import logging

import mariadb
from pymongo import MongoClient

from .config import Settings

logger = logging.getLogger(__name__)

# Fixed timeout so an unavailable local database cannot hang the health request.
CONNECTION_TIMEOUT_SECONDS = 5
CONNECTION_TIMEOUT_MS = CONNECTION_TIMEOUT_SECONDS * 1000

REACHABLE = "reachable"
UNREACHABLE = "unreachable"


def create_mongodb_client(settings: Settings) -> MongoClient:
    """Create the one long-lived synchronous MongoDB client for the application.

    PyMongo connects lazily, so the client is created without contacting the
    server. A missing database is reported by the health route instead.
    """

    return MongoClient(
        settings.mongodb_uri,
        serverSelectionTimeoutMS=CONNECTION_TIMEOUT_MS,
        connectTimeoutMS=CONNECTION_TIMEOUT_MS,
    )


def connect_mariadb(settings: Settings):
    """Open one MariaDB connection using the configured values.

    The caller closes it. Autocommit stays at the connector default so a caller
    that needs a transaction turns it off explicitly.
    """

    return mariadb.connect(
        host=settings.mariadb_host,
        port=settings.mariadb_port,
        user=settings.mariadb_user,
        password=settings.mariadb_password,
        database=settings.mariadb_database,
        connect_timeout=CONNECTION_TIMEOUT_SECONDS,
    )


def check_mariadb(settings: Settings) -> str:
    """Report whether MariaDB answers ``SELECT 1`` using the configured values."""

    connection = None
    cursor = None
    try:
        connection = mariadb.connect(
            host=settings.mariadb_host,
            port=settings.mariadb_port,
            user=settings.mariadb_user,
            password=settings.mariadb_password,
            database=settings.mariadb_database,
            connect_timeout=CONNECTION_TIMEOUT_SECONDS,
        )
        cursor = connection.cursor()
        cursor.execute("SELECT 1")
        cursor.fetchone()
        return REACHABLE
    except Exception as error:
        # Log the database label and exception type only. Messages, arguments,
        # connection strings, and credentials must never reach the log.
        logger.warning("mariadb connectivity check failed (%s)", type(error).__name__)
        return UNREACHABLE
    finally:
        if cursor is not None:
            try:
                cursor.close()
            except Exception:
                pass
        if connection is not None:
            try:
                connection.close()
            except Exception:
                pass


def check_mongodb(client: MongoClient, settings: Settings) -> str:
    """Report whether MongoDB answers ``ping`` on the selected database."""

    try:
        client[settings.mongodb_db_name].command("ping")
        return REACHABLE
    except Exception as error:
        logger.warning("mongodb connectivity check failed (%s)", type(error).__name__)
        return UNREACHABLE


def close_mongodb_client(client: MongoClient | None) -> None:
    """Close the application MongoDB client during shutdown."""

    if client is not None:
        client.close()
