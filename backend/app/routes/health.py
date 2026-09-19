"""The health route, ``GET /health``."""

from __future__ import annotations

from fastapi import APIRouter, Request, Response, status

from ..databases import check_mariadb, check_mongodb

router = APIRouter()


@router.get("/health")
def read_health(request: Request, response: Response) -> dict:
    """Report whether each database is reachable.

    A regular ``def`` route is used because MariaDB Connector/Python and PyMongo
    are synchronous drivers. FastAPI runs this route in its worker thread.

    Both checks run independently so one failed database does not hide the
    other's result. Either database unreachable means HTTP 503.
    """

    settings = request.app.state.settings
    mariadb_result = check_mariadb(settings)
    mongodb_result = check_mongodb(request.app.state.mongodb_client, settings)

    databases = {"mariadb": mariadb_result, "mongodb": mongodb_result}
    if "unreachable" in databases.values():
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "degraded", "databases": databases}

    return {"status": "ok", "databases": databases}
