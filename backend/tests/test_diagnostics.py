"""Database-free tests for the Data Consistency and Performance building blocks."""
import threading
import time
import unittest

from pydantic import ValidationError

from backend.app.routes.performance import RunSettings
from backend.app.system import benchmark, consistency
from backend.app.system.jobs import CANCELLED, COMPLETED, FAILED, FAILURE_MESSAGE, JobBusy, JobRunner


def wait_until_finished(job, seconds=5):
    deadline = time.time() + seconds
    while job.status == "running" and time.time() < deadline:
        time.sleep(0.01)
    return job


class JobRunnerTests(unittest.TestCase):
    def test_only_one_job_runs_at_a_time(self):
        runner, release = JobRunner(), threading.Event()
        first = runner.start("consistency", {}, lambda job: release.wait(5))
        # A benchmark would be skewed by a running check, so any second job is refused.
        with self.assertRaises(JobBusy) as refused:
            runner.start("performance", {}, lambda job: None)
        self.assertIs(refused.exception.job, first)
        release.set()
        self.assertEqual(wait_until_finished(first).status, COMPLETED)
        self.assertEqual(wait_until_finished(runner.start("performance", {}, lambda job: "done")).result, "done")

    def test_cancel_stops_at_the_next_progress_report_and_keeps_partial_result(self):
        runner = JobRunner()

        def target(job):
            job.result = {"finished": 1}
            while True:
                job.progress("Working")
                time.sleep(0.01)

        job = runner.start("performance", {}, target)
        runner.cancel("performance")
        self.assertEqual(wait_until_finished(job).status, CANCELLED)
        self.assertEqual(job.result, {"finished": 1})

    def test_failure_message_never_contains_the_driver_error(self):
        def target(job):
            raise RuntimeError("Access denied for user 'root'@'localhost' (password: YES)")

        job = wait_until_finished(JobRunner().start("consistency", {}, target))
        self.assertEqual(job.status, FAILED)
        self.assertEqual(job.error, FAILURE_MESSAGE)
        self.assertNotIn("root", str(job.to_dict()))


class ConsistencyHelperTests(unittest.TestCase):
    def test_classify_names_the_kind_of_difference(self):
        self.assertEqual(consistency.classify(None, "A"), "missing in MariaDB")
        self.assertEqual(consistency.classify("A", None), "missing in MongoDB")
        self.assertEqual(consistency.classify("ALBERT STREET", "albert street"), "letter case only")
        self.assertEqual(consistency.classify("A ", "A"), "whitespace only")
        self.assertEqual(consistency.classify("01410", "1410"), "different value")

    def test_ordered_rows_takes_one_key_at_a_time(self):
        rows = consistency.OrderedRows([("A", 1), ("A", 2), ("C", 3)])
        self.assertEqual(rows.take("A"), [("A", 1), ("A", 2)])
        self.assertEqual(rows.take("B"), [])
        self.assertEqual(rows.take("C"), [("C", 3)])
        self.assertIsNone(rows.key)

    def test_ordered_rows_refuses_out_of_order_streams(self):
        # Mismatched sort orders would pair the wrong records, so the check stops instead.
        rows = consistency.OrderedRows([("B", 1), ("A", 2)], name="test stream")
        with self.assertRaisesRegex(RuntimeError, "test stream is not in UEN order"):
            rows.pop()

    def test_area_counts_and_keeps_limited_examples(self):
        area = consistency.Area("companies", "Companies", "companies")
        for index in range(consistency.EXAMPLE_LIMIT + 3):
            area.compare(f"U{index}", {"name": "A"}, {"name": "B"})
        area.only_in("mongodb", "X1", "No name")
        result = area.to_dict()
        self.assertEqual(result["difference_count"], consistency.EXAMPLE_LIMIT + 4)
        self.assertEqual(len(result["differences"][0]["examples"]), consistency.EXAMPLE_LIMIT)
        self.assertEqual(result["only_in_mongodb"]["count"], 1)


class BenchmarkHelperTests(unittest.TestCase):
    def test_stats_use_nearest_rank_percentiles(self):
        result = benchmark.stats([float(value) for value in range(1, 101)])
        self.assertEqual(result["p95_ms"], 95.0)
        self.assertNotIn("p50_ms", result)
        self.assertEqual((result["min_ms"], result["max_ms"], result["avg_ms"]), (1.0, 100.0, 50.5))

    def test_mongodb_plan_summary(self):
        scan = {"queryPlanner": {"winningPlan": {"stage": "COLLSCAN"}}}
        point = {"queryPlanner": {"winningPlan": {"stage": "EXPRESS_IXSCAN", "indexName": "_id_"}}}
        filtered = {"queryPlanner": {"winningPlan": {"stage": "FETCH", "filter": {"name": 1},
                                                     "inputStage": {"stage": "IXSCAN", "indexName": "_id_"}}}}
        self.assertEqual(benchmark.mongodb_plan("tenders", scan), "tenders: full collection scan")
        self.assertEqual(benchmark.mongodb_plan("companies", point), "companies: index _id_")
        self.assertIn("checks every document", benchmark.mongodb_plan("companies", filtered))

    def test_run_settings_validation(self):
        settings = RunSettings(workloads=["industry_totals", "company_lookup"], iterations=30,
                               concurrency=[8, 1], duration_seconds=2)
        # Workloads run in the listed order and levels in increasing order.
        self.assertEqual(settings.workloads, ["company_lookup", "industry_totals"])
        self.assertEqual(settings.concurrency, [1, 8])
        for bad in ({"workloads": ["unknown"]}, {"workloads": []}, {"iterations": 5},
                    {"concurrency": [3]}, {"concurrency": [1, 1]}, {"duration_seconds": 60}):
            with self.subTest(bad=bad), self.assertRaises(ValidationError):
                RunSettings(**{"workloads": ["company_lookup"], "iterations": 30, "concurrency": [1],
                               "duration_seconds": 2, **bad})


if __name__ == "__main__":
    unittest.main()
