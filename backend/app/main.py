"""FastAPI application entry point.

Start it from the repository root with:

    .\\.venv\\Scripts\\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI

from .config import load_settings
from .databases import close_mongodb_client, create_mongodb_client
from .routes.api import router as api_router
from .routes.auth import require_admin, router as auth_router
from .routes.company_map import router as company_map_router
from .routes.business_activities import router as business_activities_router
from .routes.health import router as health_router
from .routes.companies import router as companies_router
from .routes.tenders import router as tenders_router
from .routes.suppliers import router as suppliers_router
from .routes.schema import router as schema_router
from .routes.consistency import router as consistency_router
from .routes.performance import router as performance_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load settings and manage the MongoDB client for the application lifetime.

    Configuration problems stop startup with a short error. A database being
    unavailable does not, so the failure stays visible through ``GET /health``.
    """

    settings = load_settings()
    app.state.settings = settings
    app.state.mongodb_client = create_mongodb_client(settings)
    try:
        yield
    finally:
        close_mongodb_client(app.state.mongodb_client)


app = FastAPI(title="INF2003 Business and Tender Analytics API", lifespan=lifespan)

app.include_router(health_router)
app.include_router(api_router)
app.include_router(auth_router)

# Every System view route requires a signed-in administrator.
admin_only = [Depends(require_admin)]
app.include_router(business_activities_router, dependencies=admin_only)

# Company and address maintenance for the System view.
app.include_router(companies_router, dependencies=admin_only)

# Tender and award maintenance for the System view.
app.include_router(tenders_router, dependencies=admin_only)

# Supplier maintenance and company links for the System view.
app.include_router(suppliers_router, dependencies=admin_only)

# MariaDB and MongoDB side by side: schema, data consistency and performance.
app.include_router(schema_router, dependencies=admin_only)
app.include_router(consistency_router, dependencies=admin_only)
app.include_router(performance_router, dependencies=admin_only)

# Read-only active-company map and authoritative address resolution.
app.include_router(company_map_router)
