# Read-only performance benchmark comparing MariaDB and MongoDB.

# Routes:
#   GET  /api/system/performance/workloads    the workloads and allowed settings
#   POST /api/system/performance/runs         start a benchmark run in the background
#   GET  /api/system/performance/runs/latest  progress or result of the latest run
#   POST /api/system/performance/runs/cancel  stop the running benchmark

# A run always uses both databases, so these routes take no `database` parameter.
# Results stay in memory until the backend restarts; the page downloads them as CSV.

from fastapi import APIRouter, Request
from pydantic import Field, field_validator

from ..system import benchmark
from ..system.jobs import JobBusy, runner
from .companies import CleanModel, invalid
from .consistency import busy

router = APIRouter(prefix="/api/system/performance", tags=["system-performance"])

JOB_KIND = "performance"


# The settings form. Limits keep a single run to a few minutes at most.
class RunSettings(CleanModel):
    workloads: list[str] = Field(min_length=1, max_length=len(benchmark.WORKLOADS))
    iterations: int = Field(ge=10, le=1000)
    concurrency: list[int] = Field(min_length=1, max_length=len(benchmark.CONCURRENCY_CHOICES))
    duration_seconds: int = Field(ge=1, le=30)

    @field_validator("workloads")
    @classmethod
    def known_workloads(cls, value):
        if any(item not in benchmark.WORKLOADS for item in value) or len(set(value)) != len(value):
            invalid("invalid_workloads", "Choose each workload at most once, from the listed workloads.")
        # Run in the listed order, whatever order the form sent.
        return [item for item in benchmark.WORKLOADS if item in value]

    @field_validator("concurrency")
    @classmethod
    def known_levels(cls, value):
        if any(item not in benchmark.CONCURRENCY_CHOICES for item in value) or len(set(value)) != len(value):
            invalid("invalid_concurrency", "Concurrency levels must be distinct values from 1, 2, 4, 8, 16 and 32.")
        return sorted(value)


@router.get("/workloads")
def workloads():
    return {"data": {
        "items": [workload.describe() for workload in benchmark.WORKLOADS.values()],
        "concurrency_choices": list(benchmark.CONCURRENCY_CHOICES),
        "warmup_calls": benchmark.WARMUP_CALLS,
        "latency_time_cap_seconds": benchmark.LATENCY_TIME_CAP_SECONDS,
    }}


@router.post("/runs", status_code=202)
def start_run(request: Request, body: RunSettings):
    state = request.app.state
    settings, client = state.settings, state.mongodb_client
    params = body.model_dump()
    try:
        job = runner.start(JOB_KIND, params, lambda job: benchmark.run(job, settings, client, **params))
    except JobBusy as error:
        busy(error)
    return {"data": job.to_dict()}


@router.get("/runs/latest")
def latest_run():
    job = runner.latest(JOB_KIND)
    return {"data": job.to_dict() if job else None}


@router.post("/runs/cancel")
def cancel_run():
    job = runner.cancel(JOB_KIND)
    return {"data": job.to_dict() if job else None}
