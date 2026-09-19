"""FastAPI application entry point.

Start it from the repository root with:

    .\\.venv\\Scripts\\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from .config import load_settings
from .databases import close_mongodb_client, create_mongodb_client
from .routes.api import router as api_router
from .routes.health import router as health_router


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
