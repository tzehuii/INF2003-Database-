# Data consistency between the MariaDB and MongoDB copies of the project data.

# Routes:
#   GET  /api/system/consistency/summary        record counts in both databases (a few seconds)
#   POST /api/system/consistency/checks         start the full field-by-field check in the background
#   GET  /api/system/consistency/checks/latest  progress or result of the latest full check
#   POST /api/system/consistency/checks/cancel  stop the running full check

# Unlike the other System pages these routes always read both databases, so they
# take no `database` parameter. Nothing here writes to either database.

import logging

import mariadb
from fastapi import APIRouter, Request
from pymongo.errors import PyMongoError

from ..system import consistency
from ..system.jobs import JobBusy, runner
from .companies import fail

router = APIRouter(prefix="/api/system/consistency", tags=["system-consistency"])
logger = logging.getLogger(__name__)

JOB_KIND = "consistency"


def busy(error: JobBusy):
    what = "a full consistency check" if error.job.kind == JOB_KIND else "a performance benchmark"
    fail(409, "job_running", f"Wait for {what} to finish, or cancel it, before starting another.")


# Count top-level records on both sides. Both databases are counted in parallel.
@router.get("/summary")
def summary(request: Request):
    state = request.app.state
    try:
        return {"data": consistency.summary(state.settings, state.mongodb_client[state.settings.mongodb_db_name])}
    except (mariadb.Error, PyMongoError) as error:
        logger.warning("Consistency summary failed (%s)", type(error).__name__)
        fail(503, "database_unavailable", "Both databases must be running to compare them.")


# Start the full check. Only one background job runs at a time.
@router.post("/checks", status_code=202)
def start_check(request: Request):
    state = request.app.state
    settings, mongo_db = state.settings, state.mongodb_client[state.settings.mongodb_db_name]
    try:
        job = runner.start(JOB_KIND, {}, lambda job: consistency.full_check(job, settings, mongo_db))
    except JobBusy as error:
        busy(error)
    return {"data": job.to_dict()}


# The latest full check, or null if none has run since the backend started.
@router.get("/checks/latest")
def latest_check():
    job = runner.latest(JOB_KIND)
    return {"data": job.to_dict() if job else None}


@router.post("/checks/cancel")
def cancel_check():
    job = runner.cancel(JOB_KIND)
    return {"data": job.to_dict() if job else None}
