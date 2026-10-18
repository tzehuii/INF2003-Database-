"""Background jobs for the System diagnostics pages.

The full consistency check and the performance benchmark both run for minutes,
far longer than one HTTP request should wait. Each runs in a background thread
instead, and the page polls its progress.

Only one job runs at a time across both pages. A benchmark timed while a
consistency check reads 2.1 million documents would measure the check, not the
databases, so a second start is refused until the first finishes.

Jobs live in memory only. The latest job of each kind stays readable until the
backend restarts, which is all the pages need.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

logger = logging.getLogger(__name__)

RUNNING = "running"
COMPLETED = "completed"
FAILED = "failed"
CANCELLED = "cancelled"

FAILURE_MESSAGE = "The job stopped because a database request failed. Check that both databases are running."


class Cancelled(Exception):
    """Raised inside a job when the user asked it to stop."""


class Job:
    """One background job and what the page can show about it."""

    def __init__(self, kind: str, params: dict[str, Any]):
        self.id = uuid.uuid4().hex
        self.kind = kind
        self.params = params
        self.status = RUNNING
        self.started_at = datetime.now(timezone.utc)
        self.finished_at: datetime | None = None
        self.step = "Starting"
        self.done = 0
        self.total = 0
        self.result: Any = None
        self.error: str | None = None
        self._cancel = threading.Event()
        self._started = time.perf_counter()

    def progress(self, step: str, done: int = 0, total: int = 0) -> None:
        """Record progress, and stop here if a cancel was requested."""

        self.step, self.done, self.total = step, done, total
        self.check_cancelled()

    def check_cancelled(self) -> None:
        if self._cancel.is_set():
            raise Cancelled()

    @property
    def cancel_requested(self) -> bool:
        return self._cancel.is_set()

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "status": self.status,
            "params": self.params,
            "started_at": self.started_at.isoformat(),
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "elapsed_seconds": round(time.perf_counter() - self._started, 1)
            if self.finished_at is None else round((self.finished_at - self.started_at).total_seconds(), 1),
            "progress": {"step": self.step, "done": self.done, "total": self.total},
            "cancel_requested": self._cancel.is_set(),
            "result": self.result,
            "error": self.error,
        }


class JobBusy(Exception):
    """Raised when a job is already running."""

    def __init__(self, job: Job):
        super().__init__(job.kind)
        self.job = job


class JobRunner:
    """Starts jobs one at a time and remembers the latest job of each kind."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._current: Job | None = None
        self._latest: dict[str, Job] = {}

    def start(self, kind: str, params: dict[str, Any], target: Callable[[Job], Any]) -> Job:
        with self._lock:
            if self._current is not None and self._current.status == RUNNING:
                raise JobBusy(self._current)
            job = Job(kind, params)
            self._current = job
            self._latest[kind] = job

        threading.Thread(target=self._run, args=(job, target), name=f"{kind}-job", daemon=True).start()
        return job

    def latest(self, kind: str) -> Job | None:
        return self._latest.get(kind)

    def cancel(self, kind: str) -> Job | None:
        job = self._latest.get(kind)
        if job is not None and job.status == RUNNING:
            job._cancel.set()
        return job

    def _run(self, job: Job, target: Callable[[Job], Any]) -> None:
        # A target may also fill job.result as it goes, so a cancelled job keeps
        # whatever it finished before the cancel.
        try:
            result = target(job)
            if result is not None:
                job.result = result
            job.status = COMPLETED
        except Cancelled:
            job.status = CANCELLED
        except Exception as error:
            # Log the type only: connector messages can carry hosts and query text.
            logger.warning("%s job failed (%s)", job.kind, type(error).__name__)
            job.error = FAILURE_MESSAGE
            job.status = FAILED
        finally:
            job.finished_at = datetime.now(timezone.utc)
            job.step = {COMPLETED: "Finished", CANCELLED: "Cancelled", FAILED: "Failed"}.get(job.status, job.step)


# One runner for the whole backend process.
runner = JobRunner()
