# Integration tests for /api/system/suppliers against the real data.

# How to run (backend must already be running, both databases reachable):
#   .\.venv\Scripts\python.exe -m unittest backend.tests.test_suppliers_api -v
# Set SUPPLIERS_API_URL to test a backend on another port (default http://127.0.0.1:8000).

# Every test runs once per database. Test suppliers use names that do not exist in the GeBIZ data
# and are deleted afterwards, together with the one test tender, so imported records are never changed.

# Import libraries.
import json
import os
import unittest
import urllib.error
import urllib.parse
import urllib.request

from backend.tests.admin_auth import sign_in

ROOT = os.environ.get("SUPPLIERS_API_URL", "http://127.0.0.1:8000") + "/api/system"
DATABASES = ["mariadb", "mongodb"]

# Fixture names. NEW normalizes to a name no company has; the other two normalize to existing
# company names: ALPHA ZETTA matches one company, CRIMSONLOGIC matches two.
NEW = "ZZ Claude Test Supplier Pte. Ltd."
RENAMED = "ZZ Claude Test Supplier Renamed LLP"
ONE_MATCH = "Alpha Zetta Pte Limited"
TWO_MATCHES = "Crimsonlogic Limited"
TEST_NAMES = [NEW, RENAMED, ONE_MATCH, TWO_MATCHES]
TEST_TENDER = "ZZTEST0ETT99000002"

# Existing records present in both databases.
EXISTING = "ALPHA ZETTA PTE. LTD."
EXISTING_UEN = "201628078H"
SLASH_NAME = "DDI-ASIA/PACIFIC INTERNATIONAL, LTD."
AGENCY = "Accounting And Corporate Regulatory Authority"


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


class SuppliersApiTest(unittest.TestCase):

    # Stop early with a clear message if the backend is not running or a fixture already exists.
    @classmethod
    def setUpClass(cls):
        try:
            urllib.request.urlopen(ROOT.rsplit("/api", 1)[0] + "/health", timeout=10)
        except OSError:
            raise unittest.SkipTest(f"Backend not reachable at {ROOT}. Start it first.")
        sign_in(ROOT.rsplit("/api", 1)[0])
        for database in DATABASES:
            status, _ = call("GET", "/suppliers", database)
            if status == 404:
                raise unittest.SkipTest(f"The backend at {ROOT} has no supplier routes. Restart it to load them.")
            for name in TEST_NAMES:
                status, _ = call("GET", "/suppliers/item", database, name=name)
                if status != 404:
                    raise unittest.SkipTest(f"{name} already exists in {database}; remove it before testing.")

    # Remove the test tender and test suppliers after every test, whatever the test left behind.
    def tearDown(self):
        for database in DATABASES:
            call("DELETE", f"/tenders/{TEST_TENDER}", database)
            for name in TEST_NAMES:
                call("DELETE", "/suppliers/item", database, name=name)

    def create(self, database, name):
        status, body = call("POST", "/suppliers", database, {"name": name})
        self.assertEqual(status, 201, body)
        return body["data"]

    # ---------- CRUD ----------

    def test_create_read_rename_delete(self):
        for database in DATABASES:
            with self.subTest(database=database):
                data = self.create(database, "  ZZ Claude   Test Supplier Pte. Ltd.  ")
                self.assertEqual(data["name"], NEW)  # extra spaces collapsed
                self.assertEqual(data["normalized_name"], "ZZ CLAUDE TEST SUPPLIER")
                self.assertEqual(data["link"]["status"], "unmatched")
                self.assertEqual((data["award_count"], data["total_amount"], data["awards"]), (0, "0.00", []))

                # Lookups ignore letter case, like the tender forms.
                status, body = call("GET", "/suppliers/item", database, name=NEW.upper())
                self.assertEqual((status, body["data"]["name"]), (200, NEW))

                status, body = call("PATCH", "/suppliers/item", database, {"name": RENAMED}, name=NEW)
                self.assertEqual(status, 200, body)
                self.assertEqual((body["data"]["name"], body["data"]["normalized_name"]), (RENAMED, "ZZ CLAUDE TEST SUPPLIER RENAMED"))
                status, body = call("GET", "/suppliers/item", database, name=NEW)
                self.assertEqual((status, error_code(body)), (404, "supplier_not_found"))

                status, _ = call("DELETE", "/suppliers/item", database, name=RENAMED)
                self.assertEqual(status, 204)
                status, body = call("GET", "/suppliers/item", database, name=RENAMED)
                self.assertEqual((status, error_code(body)), (404, "supplier_not_found"))

    def test_rejected_names(self):
        for database in DATABASES:
            with self.subTest(database=database):
                # Same name in a different letter case is a duplicate.
                status, body = call("POST", "/suppliers", database, {"name": EXISTING.lower()})
                self.assertEqual((status, error_code(body)), (409, "supplier_exists"))
                # A name that is only a legal form or punctuation cannot be matched to anything.
                for name in ("PTE. LTD.", "---", ""):
                    status, body = call("POST", "/suppliers", database, {"name": name})
                    self.assertEqual(status, 422, (name, body))
                # Renaming onto another supplier's name is refused.
                self.create(database, NEW)
                status, body = call("PATCH", "/suppliers/item", database, {"name": EXISTING}, name=NEW)
                self.assertEqual((status, error_code(body)), (409, "supplier_exists"))

    def test_names_with_slashes_and_missing_supplier(self):
        for database in DATABASES:
            with self.subTest(database=database):
                status, body = call("GET", "/suppliers/item", database, name=SLASH_NAME)
                self.assertEqual((status, body["data"]["name"]), (200, SLASH_NAME))
                self.assertGreater(body["data"]["award_count"], 0)
                status, body = call("GET", "/suppliers/item", database, name="ZZ NO SUCH SUPPLIER")
                self.assertEqual((status, error_code(body)), (404, "supplier_not_found"))

    # ---------- Company links ----------

    def test_new_suppliers_are_matched_by_normalized_name(self):
        for database in DATABASES:
            with self.subTest(database=database):
                one = self.create(database, ONE_MATCH)
                self.assertEqual(one["normalized_name"], "ALPHA ZETTA")
                self.assertEqual((one["link"]["status"], one["link"]["method"]), ("accepted", "name"))
                self.assertEqual(one["link"]["company"]["uen"], EXISTING_UEN)

                two = self.create(database, TWO_MATCHES)
                self.assertEqual((two["link"]["status"], two["link"]["candidate_count"], two["link"]["company"]), ("ambiguous", 2, None))
                status, body = call("GET", "/suppliers/item/candidates", database, name=TWO_MATCHES)
                self.assertEqual(status, 200, body)
                self.assertEqual([c["uen"] for c in body["data"]["items"]], ["198800784N", "52950822B"])

    def test_link_unlink_and_match_again(self):
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database, TWO_MATCHES)
                status, body = call("PATCH", "/suppliers/item/link", database, {"mode": "company", "uen": "198800784n"}, name=TWO_MATCHES)
                self.assertEqual(status, 200, body)
                link = body["data"]["link"]
                self.assertEqual((link["status"], link["method"], link["company"]["uen"]), ("accepted", "manual", "198800784N"))

                status, body = call("PATCH", "/suppliers/item/link", database, {"mode": "none"}, name=TWO_MATCHES)
                self.assertEqual((status, body["data"]["link"]["status"], body["data"]["link"]["candidate_count"]), (200, "unmatched", 0))

                status, body = call("PATCH", "/suppliers/item/link", database, {"mode": "match"}, name=TWO_MATCHES)
                self.assertEqual((status, body["data"]["link"]["status"]), (200, "ambiguous"))

                status, body = call("PATCH", "/suppliers/item/link", database, {"mode": "company", "uen": "000000000Z"}, name=TWO_MATCHES)
                self.assertEqual((status, error_code(body)), (422, "company_not_found"))
                status, body = call("PATCH", "/suppliers/item/link", database, {"mode": "company"}, name=TWO_MATCHES)
                self.assertEqual((status, error_code(body)), (422, "uen_required"))

                # A linked supplier shows up under the accepted filter with its company.
                call("PATCH", "/suppliers/item/link", database, {"mode": "company", "uen": EXISTING_UEN}, name=TWO_MATCHES)
                status, body = call("GET", "/suppliers", database, q="crimsonlogic limited", link="accepted")
                self.assertEqual([(i["name"], i["link"]["company_uen"]) for i in body["data"]["items"]], [(TWO_MATCHES, EXISTING_UEN)])

    # ---------- Awards ----------

    def test_awards_follow_a_rename_and_block_delete(self):
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database, NEW)
                status, body = call("POST", "/tenders", database, {
                    "tender_no": TEST_TENDER, "description": "Claude supplier test tender", "agency": AGENCY,
                    "status": "Awarded to Suppliers", "award_date": "2024-06-01",
                    "awards": [{"supplier": NEW, "amount": "1234.50"}]})
                self.assertEqual(status, 201, body)

                status, body = call("DELETE", "/suppliers/item", database, name=NEW)
                self.assertEqual((status, error_code(body)), (409, "supplier_has_awards"))

                status, body = call("PATCH", "/suppliers/item", database, {"name": RENAMED}, name=NEW)
                self.assertEqual(status, 200, body)
                self.assertEqual([(a["tender_no"], a["amount"]) for a in body["data"]["awards"]], [(TEST_TENDER, "1234.50")])
                status, body = call("GET", f"/tenders/{TEST_TENDER}", database)
                self.assertEqual([a["supplier"] for a in body["data"]["awards"]], [RENAMED])

                call("DELETE", f"/tenders/{TEST_TENDER}", database)
                status, _ = call("DELETE", "/suppliers/item", database, name=RENAMED)
                self.assertEqual(status, 204)

    def test_existing_supplier_with_awards_cannot_be_deleted(self):
        for database in DATABASES:
            with self.subTest(database=database):
                status, body = call("DELETE", "/suppliers/item", database, name=EXISTING)
                self.assertEqual((status, error_code(body)), (409, "supplier_has_awards"))

    # ---------- Search and filters ----------

    def test_search_filters_and_sorting(self):
        for database in DATABASES:
            with self.subTest(database=database):
                def found(**query):
                    status, body = call("GET", "/suppliers", database, limit=100, **query)
                    self.assertEqual(status, 200, body)
                    return body["data"]

                page = found(q="alpha zetta")
                self.assertIn(EXISTING, [i["name"] for i in page["items"]])
                self.assertTrue(all("alpha zetta" in i["name"].lower() for i in page["items"]))

                for status_filter in ("accepted", "ambiguous", "unmatched"):
                    items = found(link=status_filter)["items"]
                    self.assertTrue(items and all(i["link"]["status"] == status_filter for i in items), status_filter)

                totals = [float(i["total_amount"]) for i in found(sort="total_desc")["items"]]
                self.assertEqual(totals, sorted(totals, reverse=True))
                counts = [i["award_count"] for i in found(sort="awards_desc", agency=AGENCY)["items"]]
                self.assertEqual(counts, sorted(counts, reverse=True))

                ranged = found(min_total="1000000", max_total="2000000")["items"]
                self.assertTrue(ranged and all(1000000 <= float(i["total_amount"]) <= 2000000 for i in ranged))

                # Imported suppliers all have awards, so "without" lists only suppliers created here.
                self.create(database, NEW)
                self.assertEqual([i["name"] for i in found(awards="without")["items"]], [NEW])

                status, body = call("GET", "/suppliers", database, min_total="5", max_total="1")
                self.assertEqual((status, error_code(body)), (422, "invalid_amounts"))

    def test_summary_counts_match_the_filters(self):
        for database in DATABASES:
            with self.subTest(database=database):
                status, body = call("GET", "/suppliers/summary", database)
                self.assertEqual(status, 200, body)
                summary = body["data"]
                self.assertEqual(summary["total"], summary["accepted"] + summary["ambiguous"] + summary["unmatched"])
                for link in ("accepted", "ambiguous", "unmatched"):
                    _, listed = call("GET", "/suppliers", database, link=link, limit=1)
                    self.assertEqual(listed["data"]["total"], summary[link], link)

    def test_both_databases_list_the_same_page(self):
        pages = {database: call("GET", "/suppliers", database, sort="total_desc", limit=20)[1]["data"] for database in DATABASES}
        self.assertEqual(pages["mariadb"]["total"], pages["mongodb"]["total"])
        self.assertEqual(pages["mariadb"]["items"], pages["mongodb"]["items"])


if __name__ == "__main__":
    unittest.main()
