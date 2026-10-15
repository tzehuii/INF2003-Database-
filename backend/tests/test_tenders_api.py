# Integration tests for /api/system/tenders and /api/system/tender-awards against the real data.

# How to run (backend must already be running, both databases reachable):
#   .\.venv\Scripts\python.exe -m unittest backend.tests.test_tenders_api -v
# Set TENDERS_API_URL to test a backend on another port (default http://127.0.0.1:8000).

# Every test runs once per database. The test tender uses a number that does not exist in the
# GeBIZ data and is deleted afterwards, so imported records are never changed.

# Import libraries.
from datetime import date, timedelta
import json
import os
import unittest
import urllib.error
import urllib.parse
import urllib.request

from pymongo import MongoClient

from backend.app.config import load_settings

ROOT = os.environ.get("TENDERS_API_URL", "http://127.0.0.1:8000") + "/api/system"
DATABASES = ["mariadb", "mongodb"]

# Letters and digits like real tender numbers, but with a prefix GeBIZ does not use.
TEST_TENDER = "ZZTEST0ETT99000001"

# Existing agency, status and suppliers that are present in both databases.
AGENCY = "Accounting And Corporate Regulatory Authority"
STATUS = "Awarded to Suppliers"
NO_SUPPLIERS = "Awarded to No Suppliers"
SUPPLIER_A = "ALPHA ZETTA PTE. LTD."
SUPPLIER_B = "01 COMPUTER SYSTEM PTE LTD"


# Send one HTTP request and return (status code, parsed JSON body or None).
def call(method, path, database, body=None, **query):
    url = ROOT + path + "?" + urllib.parse.urlencode({"database": database, **query}, doseq=True)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            text = res.read()
            return res.status, json.loads(text) if text else None

    # Error responses still carry a JSON body with the message shown to users.
    except urllib.error.HTTPError as error:
        text = error.read()
        return error.code, json.loads(text) if text else None


# Read the error code from either a domain error or a FastAPI validation error.
def error_code(body):
    detail = body["detail"]
    return detail["code"] if isinstance(detail, dict) else detail[0]["type"]


# A complete create-tender form, with optional overrides for one test.
def tender(**changes):
    return {"tender_no": TEST_TENDER, "description": "Claude test tender for automated checks", "agency": AGENCY,
            "status": STATUS, "award_date": "2024-06-01",
            "awards": [{"supplier": SUPPLIER_A, "amount": "1000.50"}], **changes}


class TendersApiTest(unittest.TestCase):

    # Stop early with a clear message if the backend is not running.
    @classmethod
    def setUpClass(cls):
        try:
            urllib.request.urlopen(ROOT.rsplit("/api", 1)[0] + "/health", timeout=10)
        except OSError:
            raise unittest.SkipTest(f"Backend not reachable at {ROOT}. Start it first.")

        # Refuse to delete pre-existing records: the fixture tender number must be unused before a run.
        for database in DATABASES:
            status, _ = call("GET", f"/tenders/{TEST_TENDER}", database)
            if status != 404:
                raise unittest.SkipTest(f"{TEST_TENDER} already exists in {database}; remove it before testing.")

    # Remove the test tender after every test, whatever the test left behind.
    def tearDown(self):
        for database in DATABASES:
            call("DELETE", f"/tenders/{TEST_TENDER}", database)

    # Create the test tender and return its response data.
    def create(self, database, **changes):
        status, body = call("POST", "/tenders", database, tender(**changes))
        self.assertEqual(status, 201, body)
        return body["data"]

    # ---------- Tender CRUD ----------

    def test_create_read_edit_delete_tender(self):
        for database in DATABASES:
            with self.subTest(database=database):
                data = self.create(database, tender_no=TEST_TENDER.lower(),
                                   awards=[{"supplier": SUPPLIER_A, "amount": "1000.5"}, {"supplier": SUPPLIER_B, "amount": 250}])
                self.assertEqual(data["tender_no"], TEST_TENDER)
                self.assertEqual(data["award_count"], 2)
                self.assertEqual(data["total_amount"], "1250.50")
                self.assertEqual([a["amount"] for a in data["awards"]], ["1000.50", "250.00"])

                edited = {"description": "Edited description", "agency": AGENCY.upper(), "status": "Awarded by Items",
                          "award_date": "2023-01-15"}
                status, body = call("PATCH", f"/tenders/{TEST_TENDER}", database, edited)
                self.assertEqual(status, 200, body)
                self.assertEqual(body["data"]["description"], "Edited description")
                self.assertEqual(body["data"]["agency"], AGENCY)  # stored with the agency's own spelling
                self.assertEqual(body["data"]["award_date"], "2023-01-15")
                self.assertEqual(body["data"]["award_count"], 2)  # editing the tender keeps its awards

                status, _ = call("DELETE", f"/tenders/{TEST_TENDER}", database)
                self.assertEqual(status, 204)
                status, body = call("GET", f"/tenders/{TEST_TENDER}", database)
                self.assertEqual((status, error_code(body)), (404, "tender_not_found"))

    def test_create_without_awards(self):
        for database in DATABASES:
            with self.subTest(database=database):
                data = self.create(database, status=NO_SUPPLIERS, awards=[])
                self.assertEqual((data["award_count"], data["total_amount"]), (0, "0.00"))

    def test_duplicate_tender_number(self):
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database)
                status, body = call("POST", "/tenders", database, tender())
                self.assertEqual((status, error_code(body)), (409, "tender_exists"))

    def test_rejected_tender_forms(self):
        tomorrow = (date.today() + timedelta(days=1)).isoformat()
        cases = {
            "invalid_tender_no": tender(tender_no="ZZ-TEST/1"),
            "invalid_award_date": tender(award_date=tomorrow),
            "invalid_amount": tender(awards=[{"supplier": SUPPLIER_A, "amount": "-1"}]),
            "duplicate_supplier": tender(awards=[{"supplier": SUPPLIER_A, "amount": 1}, {"supplier": SUPPLIER_A.lower(), "amount": 2}]),
            "awards_not_allowed": tender(status=NO_SUPPLIERS),
            "unknown_supplier": tender(awards=[{"supplier": "No Such Supplier Pte Ltd 12345", "amount": 1}]),
            "unknown_agency": tender(agency="Ministry of Imaginary Affairs"),
            "invalid_status": tender(status="Made up status"),
            "extra_forbidden": tender(currency="USD"),
        }
        for database in DATABASES:
            for code, form in cases.items():
                with self.subTest(database=database, case=code):
                    status, body = call("POST", "/tenders", database, form)
                    self.assertEqual((status, error_code(body)), (422, code), body)
                    # A rejected form must not leave a half-created tender behind.
                    self.assertEqual(call("GET", f"/tenders/{TEST_TENDER}", database)[0], 404)

    def test_three_decimal_amount_rejected(self):
        for database in DATABASES:
            with self.subTest(database=database):
                status, body = call("POST", "/tenders", database, tender(awards=[{"supplier": SUPPLIER_A, "amount": "1.005"}]))
                self.assertEqual((status, error_code(body)), (422, "invalid_amount"))

    def test_no_supplier_status_blocked_while_awards_exist(self):
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database)
                edited = {"description": "x", "agency": AGENCY, "status": NO_SUPPLIERS, "award_date": "2024-06-01"}
                status, body = call("PATCH", f"/tenders/{TEST_TENDER}", database, edited)
                self.assertEqual((status, error_code(body)), (409, "awards_exist"))

    def test_missing_tender(self):
        for database in DATABASES:
            with self.subTest(database=database):
                for method, path, body in [("GET", f"/tenders/{TEST_TENDER}", None),
                                           ("DELETE", f"/tenders/{TEST_TENDER}", None),
                                           ("POST", f"/tenders/{TEST_TENDER}/awards", {"supplier": SUPPLIER_A, "amount": 1})]:
                    status, response = call(method, path, database, body)
                    self.assertEqual((status, error_code(response)), (404, "tender_not_found"))

    # ---------- Award CRUD ----------

    def test_add_edit_delete_awards(self):
        settings = load_settings()
        client = MongoClient(settings.mongodb_uri)
        self.addCleanup(client.close)
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database)
                status, body = call("POST", f"/tenders/{TEST_TENDER}/awards", database, {"supplier": SUPPLIER_B.lower(), "amount": "99.9"})
                self.assertEqual(status, 201, body)
                self.assertEqual(body["data"]["total_amount"], "1100.40")
                added = body["data"]["awards"][-1]
                self.assertEqual(added["supplier"], SUPPLIER_B)  # matched case-insensitively, stored as recorded

                status, body = call("PATCH", f"/tenders/{TEST_TENDER}/awards/{added['id']}", database, {"supplier": SUPPLIER_B, "amount": "500"})
                self.assertEqual(status, 200, body)
                self.assertEqual(body["data"]["total_amount"], "1500.50")

                # The same supplier cannot be awarded twice on one tender.
                status, body = call("PATCH", f"/tenders/{TEST_TENDER}/awards/{added['id']}", database, {"supplier": SUPPLIER_A, "amount": "1"})
                self.assertEqual((status, error_code(body)), (409, "duplicate_supplier"))
                status, body = call("POST", f"/tenders/{TEST_TENDER}/awards", database, {"supplier": SUPPLIER_A, "amount": "1"})
                self.assertEqual((status, error_code(body)), (409, "duplicate_supplier"))

                # Delete both awards; the last delete leaves a valid award-less tender.
                for award in call("GET", f"/tenders/{TEST_TENDER}", database)[1]["data"]["awards"]:
                    status, _ = call("DELETE", f"/tenders/{TEST_TENDER}/awards/{award['id']}", database)
                    self.assertEqual(status, 204)
                status, body = call("GET", f"/tenders/{TEST_TENDER}", database)
                self.assertEqual((body["data"]["award_count"], body["data"]["total_amount"]), (0, "0.00"))
                status, body = call("DELETE", f"/tenders/{TEST_TENDER}/awards/{added['id']}", database)
                self.assertEqual((status, error_code(body)), (404, "award_not_found"))

                # MongoDB must now carry the no-award marker its validator requires.
                if database == "mongodb":
                    doc = client[settings.mongodb_db_name].tenders.find_one({"_id": TEST_TENDER})
                    self.assertEqual(doc["awards"], [])
                    self.assertIsNotNone(doc["no_award_record"])

                # Once award-less, the tender can be marked as having no suppliers; awards are then blocked.
                edited = {"description": "x", "agency": AGENCY, "status": NO_SUPPLIERS, "award_date": "2024-06-01"}
                self.assertEqual(call("PATCH", f"/tenders/{TEST_TENDER}", database, edited)[0], 200)
                status, body = call("POST", f"/tenders/{TEST_TENDER}/awards", database, {"supplier": SUPPLIER_A, "amount": "1"})
                self.assertEqual((status, error_code(body)), (409, "awards_not_allowed"))

    def test_first_award_clears_mongodb_no_award_marker(self):
        settings = load_settings()
        client = MongoClient(settings.mongodb_uri)
        self.addCleanup(client.close)
        self.create("mongodb", awards=[])
        status, body = call("POST", f"/tenders/{TEST_TENDER}/awards", "mongodb", {"supplier": SUPPLIER_A, "amount": "10"})
        self.assertEqual(status, 201, body)
        doc = client[settings.mongodb_db_name].tenders.find_one({"_id": TEST_TENDER})
        self.assertIsNone(doc["no_award_record"])
        self.assertEqual(len(doc["awards"]), 1)

    # ---------- Search and filters ----------

    def test_tender_search_and_filters(self):
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database, awards=[{"supplier": SUPPLIER_A, "amount": "1000.50"}, {"supplier": SUPPLIER_B, "amount": "250"}])

                def found(**query):
                    status, body = call("GET", "/tenders", database, limit=100, **query)
                    self.assertEqual(status, 200, body)
                    return TEST_TENDER in [t["tender_no"] for t in body["data"]["items"]]

                self.assertTrue(found(q="zztest0ett99"))
                self.assertTrue(found(q="automated checks"))
                self.assertTrue(found(q="ZZTEST", agency=AGENCY, status=STATUS, supplier="01 computer",
                                      award_from="2024-06-01", award_to="2024-06-01", min_amount="1250.50", max_amount="1250.50"))
                self.assertFalse(found(q="ZZTEST", min_amount="1250.51"))
                self.assertFalse(found(q="ZZTEST", award_to="2024-05-31"))
                self.assertFalse(found(q="ZZTEST", supplier="no such supplier"))
                self.assertFalse(found(q="ZZTEST", status=NO_SUPPLIERS))
                # Wildcard characters in search text are matched literally.
                self.assertFalse(found(q="ZZTEST%"))

    def test_award_search_and_filters(self):
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database, awards=[{"supplier": SUPPLIER_A, "amount": "1000.50"}, {"supplier": SUPPLIER_B, "amount": "250"}])

                def suppliers(**query):
                    status, body = call("GET", "/tender-awards", database, limit=100, **query)
                    self.assertEqual(status, 200, body)
                    return sorted(a["supplier"] for a in body["data"]["items"] if a["tender_no"] == TEST_TENDER)

                self.assertEqual(suppliers(q="ZZTEST0ETT"), [SUPPLIER_B, SUPPLIER_A])
                self.assertEqual(suppliers(q="ZZTEST0ETT", max_amount="500"), [SUPPLIER_B])
                self.assertEqual(suppliers(q="ZZTEST0ETT", min_amount="500", agency=AGENCY, status=STATUS,
                                           award_from="2024-01-01", award_to="2024-12-31"), [SUPPLIER_A])
                self.assertEqual(suppliers(q="alpha zetta", award_from="2024-06-01", award_to="2024-06-01"), [SUPPLIER_A])

    def test_reversed_ranges_rejected(self):
        for database in DATABASES:
            for path in ("/tenders", "/tender-awards"):
                with self.subTest(database=database, path=path):
                    status, body = call("GET", path, database, award_from="2024-02-01", award_to="2024-01-01")
                    self.assertEqual((status, error_code(body)), (422, "invalid_dates"))
                    status, body = call("GET", path, database, min_amount="10", max_amount="1")
                    self.assertEqual((status, error_code(body)), (422, "invalid_amounts"))

    def test_pagination_and_sorting(self):
        for database in DATABASES:
            for path, sort in (("/tenders", "amount_desc"), ("/tender-awards", "amount_desc"), ("/tender-awards", "supplier")):
                with self.subTest(database=database, path=path, sort=sort):
                    _, first = call("GET", path, database, sort=sort, limit=5, page=1)
                    _, second = call("GET", path, database, sort=sort, limit=5, page=2)
                    self.assertTrue(first["data"]["has_more"])
                    self.assertEqual(first["data"]["total"], second["data"]["total"])
                    key = "total_amount" if path == "/tenders" else "amount"
                    rows = first["data"]["items"] + second["data"]["items"]
                    if sort == "amount_desc":
                        amounts = [float(r[key]) for r in rows]
                        self.assertEqual(amounts, sorted(amounts, reverse=True))
                    else:
                        names = [r["supplier"].casefold() for r in rows]
                        self.assertEqual(names, sorted(names))

    def test_databases_return_the_same_counts(self):
        queries = [("/tenders", {}), ("/tenders", {"status": NO_SUPPLIERS}), ("/tenders", {"q": "cleaning", "min_amount": "100000"}),
                   ("/tenders", {"supplier": "pte", "award_from": "2023-01-01", "award_to": "2023-12-31"}),
                   ("/tender-awards", {}), ("/tender-awards", {"agency": AGENCY}), ("/tender-awards", {"q": "engineering", "max_amount": "50000"})]
        for path, query in queries:
            with self.subTest(path=path, query=query):
                totals = [call("GET", path, database, limit=1, **query)[1]["data"]["total"] for database in DATABASES]
                self.assertEqual(totals[0], totals[1])

    def test_options_and_supplier_lookup(self):
        for database in DATABASES:
            with self.subTest(database=database):
                status, body = call("GET", "/tenders/options", database)
                self.assertEqual(status, 200)
                self.assertIn(AGENCY, body["data"]["agencies"])
                self.assertIn(NO_SUPPLIERS, body["data"]["statuses"])
                status, body = call("GET", "/tenders/suppliers", database, q="alpha zet")
                self.assertEqual(body["data"]["items"], [SUPPLIER_A])
                status, _ = call("GET", "/tenders/suppliers", database, q="a")
                self.assertEqual(status, 422)


if __name__ == "__main__":
    unittest.main()
