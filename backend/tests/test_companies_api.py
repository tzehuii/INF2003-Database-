# Tests for Company and Address Management (System view)
# Integration tests for /api/system/companies against the real MariaDB and MongoDB data.

# How to run (backend must already be running, both databases reachable):
#   .\.venv\Scripts\python.exe -m unittest backend.tests.test_companies_api -v
# Set COMPANIES_API_URL to test a backend on another port (default http://127.0.0.1:8000).

# Every test runs once per database. Test companies use UENs that do not exist in the
# ACRA data and are deleted afterwards, so imported records are never changed.

# Import libraries.
from datetime import date, datetime, timedelta
import json
import os
import unittest
import urllib.error
import urllib.parse
import urllib.request

import mariadb
from bson import ObjectId
from pymongo import MongoClient

from backend.app.config import load_settings
from backend.app.databases import connect_mariadb
from backend.tests.admin_auth import sign_in

BASE = os.environ.get("COMPANIES_API_URL", "http://127.0.0.1:8000") + "/api/system/companies"
DATABASES = ["mariadb", "mongodb"]

# Valid "other entity" UENs (T + year + type + digits + letter) that are not in the ACRA data.
TEST_UEN = "T99ZZ0001A"
OTHER_UEN = "T99ZZ0002B"

# A valid local address used by most tests.
LOCAL_ADDRESS = {"type": "LOCAL", "block": "1", "street_name": "Test Street", "postal_code": "123456"}


# Send one HTTP request and return (status code, parsed JSON body or None).
def call(method, path, database, body=None, **query):
    url = BASE + path + "?" + urllib.parse.urlencode({"database": database, **query}, doseq=True)
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


# A complete create-company form, with optional overrides for one test.
def company(**changes):
    return {"uen": TEST_UEN, "name": "Claude Test Pte. Ltd.", "status": "Live Company",
            "registration_date": "2020-05-01", "address": dict(LOCAL_ADDRESS), **changes}


# Read the public endpoint while the same disposable records are managed by System.
def public_call(path, database, **query):
    url = BASE.replace("/api/system/companies", "/api/companies") + path + "?" + urllib.parse.urlencode({"database": database, **query}, doseq=True)
    try:
        with urllib.request.urlopen(url, timeout=60) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


class CompaniesApiTest(unittest.TestCase):

    # Stop early with a clear message if the backend is not running.
    @classmethod
    def setUpClass(cls):
        try:
            urllib.request.urlopen(BASE.rsplit("/api", 1)[0] + "/health", timeout=10)
        except OSError:
            raise unittest.SkipTest(f"Backend not reachable at {BASE}. Start it first.")
        sign_in(BASE.rsplit("/api", 1)[0])

        # Refuse to delete pre-existing records: fixture UENs must be unused before a run.
        for database in DATABASES:
            for uen in (TEST_UEN, OTHER_UEN):
                status, _ = call("GET", f"/{uen}", database)
                if status != 404:
                    raise RuntimeError(f"Test UEN {uen} is already present or unavailable in {database}; inspect it before running tests.")

    # Make sure leftovers from an interrupted run do not affect this test.
    def setUp(self):
        self.cleanup()

    def tearDown(self):
        self.cleanup()

    # Delete the test companies from both databases; 404 means they are already gone.
    def cleanup(self):
        for database in DATABASES:
            for uen in (TEST_UEN, OTHER_UEN):
                status, _ = call("DELETE", f"/{uen}", database)
                self.assertIn(status, (204, 404))

    # Create the standard test company and return the API data.
    def create(self, database, **changes):
        status, body = call("POST", "", database, company(**changes))
        self.assertEqual(status, 201, body)
        return body["data"]

    # ---------- Create / read ----------

    def test_create_and_read_company(self):
        for database in DATABASES:
            with self.subTest(database=database):
                data = self.create(database)
                self.assertEqual(data["uen"], TEST_UEN)
                self.assertEqual(data["registration_date"], "2020-05-01")
                self.assertEqual(len(data["addresses"]), 1)
                # Address text is stored in uppercase like the ACRA records.
                self.assertEqual(data["addresses"][0]["street_name"], "TEST STREET")

                status, body = call("GET", f"/{TEST_UEN}", database)
                self.assertEqual(status, 200)
                self.assertEqual(body["data"]["name"], "Claude Test Pte. Ltd.")
                self.assertEqual(body["meta"]["database"], database)

    def test_lowercase_uen_is_found_in_both_databases(self):
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database)
                status, body = call("GET", f"/{TEST_UEN.lower()}", database)
                self.assertEqual(status, 200, body)

    def test_create_uppercases_uen(self):
        for database in DATABASES:
            with self.subTest(database=database):
                data = self.create(database, uen=TEST_UEN.lower())
                self.assertEqual(data["uen"], TEST_UEN)

    def test_create_without_address(self):
        for database in DATABASES:
            with self.subTest(database=database):
                data = self.create(database, address=None)
                self.assertEqual(data["addresses"], [])

    def test_duplicate_uen_is_rejected(self):
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database)
                status, body = call("POST", "", database, company())
                self.assertEqual(status, 409)
                self.assertEqual(error_code(body), "uen_exists")

    def test_existing_acra_uen_is_rejected(self):
        for database in DATABASES:
            with self.subTest(database=database):
                status, body = call("POST", "", database, company(uen="196800306E"))
                self.assertEqual(status, 409)

    def test_missing_company_returns_404(self):
        for database in DATABASES:
            with self.subTest(database=database):
                status, body = call("GET", f"/{TEST_UEN}", database)
                self.assertEqual(status, 404)
                self.assertEqual(error_code(body), "company_not_found")

    # ---------- Company validation ----------

    def test_invalid_company_forms_are_rejected(self):
        future = (date.today() + timedelta(days=1)).isoformat()
        cases = {
            "UEN with symbol": company(uen="ZZ-1"),
            "UEN too short": company(uen="12345"),
            "UEN wrong format": company(uen="ABCDEFGHIJ"),
            "empty name": company(name="   "),
            "symbol-only name": company(name="!!!"),
            "name too long": company(name="A" * 501),
            "future date": company(registration_date=future),
            "date before 1800": company(registration_date="1700-01-01"),
            "invalid date": company(registration_date="2024-02-30"),
            "missing status": company(status=""),
            "unexpected field": company(owner="someone"),
        }
        for database in DATABASES:
            for name, form in cases.items():
                with self.subTest(database=database, case=name):
                    status, body = call("POST", "", database, form)
                    self.assertEqual(status, 422, body)

    def test_unknown_status_is_rejected(self):
        for database in DATABASES:
            with self.subTest(database=database):
                status, body = call("POST", "", database, company(status="Made Up Status"))
                self.assertEqual(status, 422)
                self.assertEqual(error_code(body), "invalid_status")

    # ---------- Update / delete company ----------

    def test_update_company(self):
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database)
                form = {"name": "Renamed Test Co", "status": "Struck Off", "registration_date": None}
                status, body = call("PATCH", f"/{TEST_UEN}", database, form)
                self.assertEqual(status, 200, body)
                self.assertEqual(body["data"]["name"], "Renamed Test Co")
                self.assertEqual(body["data"]["status"], "Struck Off")
                self.assertIsNone(body["data"]["registration_date"])
                # The address is not touched by a company edit.
                self.assertEqual(len(body["data"]["addresses"]), 1)

    def test_update_cannot_change_uen(self):
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database)
                form = {"uen": OTHER_UEN, "name": "X", "status": "Live Company"}
                status, _ = call("PATCH", f"/{TEST_UEN}", database, form)
                self.assertEqual(status, 422)

    def test_update_missing_company_returns_404(self):
        for database in DATABASES:
            with self.subTest(database=database):
                status, _ = call("PATCH", f"/{TEST_UEN}", database, {"name": "X", "status": "Live Company"})
                self.assertEqual(status, 404)

    def test_delete_company_removes_it_and_its_addresses(self):
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database)
                status, _ = call("DELETE", f"/{TEST_UEN}", database)
                self.assertEqual(status, 204)
                status, _ = call("GET", f"/{TEST_UEN}", database)
                self.assertEqual(status, 404)

    def test_delete_blocked_by_saved_list_entry(self):
        settings = load_settings()
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database)
                undo = self.add_saved_list_entry(settings, database)
                try:
                    status, body = call("DELETE", f"/{TEST_UEN}", database)
                    self.assertEqual(status, 409)
                    self.assertEqual(error_code(body), "delete_blocked")
                    # The company must still exist after the blocked delete.
                    status, _ = call("GET", f"/{TEST_UEN}", database)
                    self.assertEqual(status, 200)

                finally:
                    undo()

    # Insert a temporary watchlist entry for the test company and return a function that removes it.
    def add_saved_list_entry(self, settings, database):
        if database == "mongodb":
            client = MongoClient(settings.mongodb_uri)
            entries = client[settings.mongodb_db_name].saved_list_entries
            now = datetime.now()
            entry_id = entries.insert_one({"_id": ObjectId(), "list_id": ObjectId(), "company_uen": TEST_UEN,
                                           "review_status": "to_check", "created_at": now, "updated_at": now}).inserted_id

            def undo():
                entries.delete_one({"_id": entry_id})
                client.close()
            return undo

        db = connect_mariadb(settings)
        cur = db.cursor()
        cur.execute("INSERT INTO SavedList (list_name) VALUES (?)", ("__claude_test_list__",))
        list_id = cur.lastrowid
        cur.execute("INSERT INTO SavedListEntry (company_id, list_id) SELECT company_id, ? FROM Company WHERE uen=?",
                    (list_id, TEST_UEN))
        db.commit()

        # Deleting the list cascades to its entry.
        def undo():
            cur.execute("DELETE FROM SavedList WHERE list_id=?", (list_id,))
            db.commit()
            cur.close()
            db.close()
        return undo

    # ---------- Address CRUD ----------

    def test_add_edit_delete_address(self):
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database, address=None)
                status, body = call("POST", f"/{TEST_UEN}/addresses", database, LOCAL_ADDRESS)
                self.assertEqual(status, 201, body)
                address_id = body["data"]["addresses"][0]["id"]

                edited = {**LOCAL_ADDRESS, "level_no": "05", "unit_no": "12a", "postal_code": "654321"}
                status, body = call("PATCH", f"/{TEST_UEN}/addresses/{address_id}", database, edited)
                self.assertEqual(status, 200, body)
                self.assertEqual(body["data"]["addresses"][0]["postal_code"], "654321")
                self.assertEqual(body["data"]["addresses"][0]["unit_no"], "12A")

                status, _ = call("DELETE", f"/{TEST_UEN}/addresses/{address_id}", database)
                self.assertEqual(status, 204)
                status, body = call("GET", f"/{TEST_UEN}", database)
                self.assertEqual(body["data"]["addresses"], [])

    def test_foreign_address(self):
        foreign = {"type": "foreign", "other_address_line1": "1 Infinite Loop, Cupertino", "postal_code": "CA 95014"}
        for database in DATABASES:
            with self.subTest(database=database):
                data = self.create(database, address=foreign)
                self.assertEqual(data["addresses"][0]["type"], "FOREIGN")

    def test_mariadb_allows_several_addresses_but_not_duplicates(self):
        self.create("mariadb")
        second = {**LOCAL_ADDRESS, "street_name": "Second Street"}
        status, body = call("POST", f"/{TEST_UEN}/addresses", "mariadb", second)
        self.assertEqual(status, 201, body)
        self.assertEqual(len(body["data"]["addresses"]), 2)

        # Same address again (different letter case) is a duplicate.
        status, body = call("POST", f"/{TEST_UEN}/addresses", "mariadb", {**second, "street_name": "second street"})
        self.assertEqual(status, 409)
        self.assertEqual(error_code(body), "duplicate_address")

        # Editing the first address into a copy of the second is also blocked.
        first_id = call("GET", f"/{TEST_UEN}", "mariadb")[1]["data"]["addresses"][0]["id"]
        status, body = call("PATCH", f"/{TEST_UEN}/addresses/{first_id}", "mariadb", second)
        self.assertEqual(status, 409)

    def test_mongodb_allows_one_embedded_address(self):
        self.create("mongodb")
        status, body = call("POST", f"/{TEST_UEN}/addresses", "mongodb", LOCAL_ADDRESS)
        self.assertEqual(status, 409)
        self.assertEqual(error_code(body), "address_exists")

    def test_address_of_another_company_is_not_found(self):
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database)
                self.create(database, uen=OTHER_UEN, address=None)
                address_id = call("GET", f"/{TEST_UEN}", database)[1]["data"]["addresses"][0]["id"]
                status, _ = call("PATCH", f"/{OTHER_UEN}/addresses/{address_id}", database, LOCAL_ADDRESS)
                self.assertEqual(status, 404)
                status, _ = call("DELETE", f"/{OTHER_UEN}/addresses/{address_id}", database)
                self.assertEqual(status, 404)
                status, _ = call("DELETE", f"/{TEST_UEN}/addresses/99999999", database)
                self.assertEqual(status, 404)

    def test_invalid_address_forms_are_rejected(self):
        cases = {
            "missing type": {"street_name": "X", "postal_code": "123456"},
            "unknown type": {**LOCAL_ADDRESS, "type": "MARS"},
            "local without street": {**LOCAL_ADDRESS, "street_name": " "},
            "local 5-digit postal": {**LOCAL_ADDRESS, "postal_code": "12345"},
            "local letters in postal": {**LOCAL_ADDRESS, "postal_code": "12A456"},
            "foreign without lines": {"type": "FOREIGN", "postal_code": "999"},
            "unit with symbols": {**LOCAL_ADDRESS, "unit_no": "#12"},
            "street too long": {**LOCAL_ADDRESS, "street_name": "S" * 256},
            "unexpected field": {**LOCAL_ADDRESS, "country": "SG"},
        }
        for database in DATABASES:
            self.create(database, address=None)
            for name, form in cases.items():
                with self.subTest(database=database, case=name):
                    status, body = call("POST", f"/{TEST_UEN}/addresses", database, form)
                    self.assertEqual(status, 422, body)

    # ---------- Search and filters ----------

    def test_search_by_exact_uen_and_name(self):
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database)
                for text in (TEST_UEN, TEST_UEN.lower()):
                    status, body = call("GET", "", database, q=text)
                    self.assertEqual([c["uen"] for c in body["data"]["items"]], [TEST_UEN])

                status, body = call("GET", "", database, q="claude test pte")
                self.assertIn(TEST_UEN, [c["uen"] for c in body["data"]["items"]])

    def test_combined_filters(self):
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database)
                match = {"q": "Claude Test", "status": "Live Company", "postal_code": "123456",
                         "street": "test str", "registered_from": "2020-01-01", "registered_to": "2020-12-31"}
                status, body = call("GET", "", database, **match)
                self.assertEqual(status, 200)
                self.assertEqual([c["uen"] for c in body["data"]["items"]], [TEST_UEN])

                # Changing any one filter so it no longer matches removes the company.
                for key, value in [("status", "Struck Off"), ("postal_code", "999999"),
                                   ("street", "nowhere"), ("registered_from", "2020-06-01")]:
                    status, body = call("GET", "", database, **{**match, key: value})
                    self.assertEqual(body["data"]["items"], [], key)

    def test_search_text_is_literal(self):
        # % and _ would be wildcards in SQL; .* would be a regex in MongoDB.
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database, name="Claude 100% Test_Co")
                for text, expected in [("100%", True), ("Test_Co", True), ("1%0", False), ("Claude.*Co", False)]:
                    status, body = call("GET", "", database, q=text, limit=100)
                    found = TEST_UEN in [c["uen"] for c in body["data"]["items"]]
                    self.assertEqual(found, expected, text)

    def test_viewing_history_filter(self):
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database)
                status, body = call("GET", "", database, viewed="only", viewed_uens=[TEST_UEN])
                self.assertEqual([c["uen"] for c in body["data"]["items"]], [TEST_UEN])
                status, body = call("GET", "", database, viewed="only")
                self.assertEqual(body["data"]["items"], [])

    def test_pagination_pages_do_not_overlap(self):
        for database in DATABASES:
            with self.subTest(database=database):
                first = call("GET", "", database, page=1, limit=5)[1]["data"]
                second = call("GET", "", database, page=2, limit=5)[1]["data"]
                self.assertTrue(first["has_more"])
                self.assertEqual(len(first["items"]), 5)
                self.assertFalse({c["uen"] for c in first["items"]} & {c["uen"] for c in second["items"]})
                # Results are sorted by UEN, so page 2 starts after page 1.
                self.assertLess(first["items"][-1]["uen"], second["items"][0]["uen"])

    def test_both_databases_return_the_same_first_page(self):
        mariadb_page = call("GET", "", "mariadb", status="Live Company", limit=10)[1]["data"]["items"]
        mongodb_page = call("GET", "", "mongodb", status="Live Company", limit=10)[1]["data"]["items"]
        self.assertEqual([c["uen"] for c in mariadb_page], [c["uen"] for c in mongodb_page])

    def test_invalid_search_requests_are_rejected(self):
        cases = {
            "reversed dates": {"registered_from": "2024-02-01", "registered_to": "2024-01-01"},
            "page zero": {"page": 0},
            "limit too large": {"limit": 101},
            "page and cursor": {"page": 2, "after": "1"},
            "bad date": {"registered_from": "yesterday"},
            "query too long": {"q": "A" * 501},
        }
        for database in DATABASES:
            for name, query in cases.items():
                with self.subTest(database=database, case=name):
                    status, _ = call("GET", "", database, **query)
                    self.assertEqual(status, 422)

    # Writes must affect only the database selected in the request.
    def test_writes_are_isolated_between_databases(self):
        for database, other in [("mariadb", "mongodb"), ("mongodb", "mariadb")]:
            with self.subTest(database=database):
                self.create(database)
                self.assertEqual(call("GET", f"/{TEST_UEN}", other)[0], 404)
                self.assertEqual(call("DELETE", f"/{TEST_UEN}", database)[0], 204)

    # Hide-history must exclude remembered records, including when other filters match.
    def test_hide_viewed_company(self):
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database)
                status, body = call("GET", "", database, q=TEST_UEN, viewed="hide", viewed_uens=[TEST_UEN])
                self.assertEqual(status, 200, body)
                self.assertEqual(body["data"]["items"], [])

    # Every write route should normalize lowercase UENs just like the read route.
    def test_lowercase_company_write_routes(self):
        for database in DATABASES:
            with self.subTest(database=database):
                data = self.create(database)
                address_id = data["addresses"][0]["id"]
                path = f"/{TEST_UEN.lower()}"
                status, body = call("PATCH", path, database, {"name": "Lowercase Route Test", "status": "Live Company"})
                self.assertEqual(status, 200, body)
                status, body = call("PATCH", path + f"/addresses/{address_id}", database, {**LOCAL_ADDRESS, "postal_code": "654321"})
                self.assertEqual(status, 200, body)
                self.assertEqual(call("DELETE", path + f"/addresses/{address_id}", database)[0], 204)
                self.assertEqual(call("DELETE", path, database)[0], 204)

    # A rejected edit must leave previously saved data intact.
    def test_invalid_edits_leave_data_unchanged(self):
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database)
                before = call("GET", f"/{TEST_UEN}", database)[1]["data"]
                status, _ = call("PATCH", f"/{TEST_UEN}", database, {"name": "Changed", "status": "Made Up Status"})
                self.assertEqual(status, 422)
                address_id = before["addresses"][0]["id"]
                status, _ = call("PATCH", f"/{TEST_UEN}/addresses/{address_id}", database, {**LOCAL_ADDRESS, "postal_code": "123"})
                self.assertEqual(status, 422)
                status, after = call("GET", f"/{TEST_UEN}", database)
                self.assertEqual(status, 200)
                self.assertEqual(after["data"], before)

    # Invalid nested address data must not leave a partially created company behind.
    def test_invalid_initial_address_creates_no_company(self):
        for database in DATABASES:
            with self.subTest(database=database):
                status, _ = call("POST", "", database, company(address={**LOCAL_ADDRESS, "postal_code": "123"}))
                self.assertEqual(status, 422)
                self.assertEqual(call("GET", f"/{TEST_UEN}", database)[0], 404)

    # Public details must expose all System addresses, not just the first SQL row.
    def test_public_details_include_all_system_addresses(self):
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database)
                if database == "mariadb":
                    self.assertEqual(call("POST", f"/{TEST_UEN}/addresses", database, {**LOCAL_ADDRESS, "street_name": "SECOND STREET"})[0], 201)
                system = call("GET", f"/{TEST_UEN}", database)[1]["data"]
                status, public = public_call(f"/{TEST_UEN}", database)
                self.assertEqual(status, 200, public)
                expected = [{k: v for k, v in address.items() if k != "id"} for address in system["addresses"]]
                self.assertEqual(public["data"]["addresses"], expected)

    # Unicode names must survive creation, editing, normalization and public retrieval.
    def test_non_latin_company_names(self):
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database, name="\u516c\u53f8")
                status, public = public_call(f"/{TEST_UEN}", database)
                self.assertEqual(status, 200)
                self.assertEqual(public["data"]["name"], "\u516c\u53f8")
                status, body = call("PATCH", f"/{TEST_UEN}", database, {"name": "\u4f01\u696d", "status": "Live Company"})
                self.assertEqual(status, 200, body)
                self.assertEqual(body["data"]["name"], "\u4f01\u696d")

    # Simulate an imported legacy code on our disposable record, never on ACRA records.
    def test_unchanged_historical_postal_code_can_be_edited(self):
        settings = load_settings()
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database)
                if database == "mongodb":
                    with MongoClient(settings.mongodb_uri) as client:
                        client[settings.mongodb_db_name].companies.update_one({"_id": TEST_UEN}, {"$set": {"address.postal_code": "0105"}})
                else:
                    db = connect_mariadb(settings)
                    try:
                        cur = db.cursor()
                        cur.execute("UPDATE Address a JOIN Company c ON a.company_id=c.company_id SET a.postal_code='0105' WHERE c.uen=?", (TEST_UEN,))
                        db.commit(); cur.close()
                    finally:
                        db.close()
                address = call("GET", f"/{TEST_UEN}", database)[1]["data"]["addresses"][0]
                path = f"/{TEST_UEN}/addresses/{address['id']}"
                edited = {**LOCAL_ADDRESS, "postal_code": "0105", "building_name": "Updated building"}
                status, body = call("PATCH", path, database, edited)
                self.assertEqual(status, 200, body)
                self.assertEqual(body["data"]["addresses"][0]["postal_code"], "0105")
                self.assertEqual(call("PATCH", path, database, {**edited, "postal_code": "0106"})[0], 422)
                self.assertEqual(call("POST", "", database, company(uen=OTHER_UEN, address=edited))[0], 422)
                self.assertEqual(call("PATCH", path, database, {**edited, "postal_code": "654321"})[0], 200)

    # A full UEN is an identifier lookup, even when another company has it in its name.
    def test_public_full_uen_search_is_exact(self):
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database)
                self.create(database, uen=OTHER_UEN, name=TEST_UEN)
                status, result = public_call("", database, q=TEST_UEN.lower())
                self.assertEqual(status, 200, result)
                self.assertEqual([row["uen"] for row in result["data"]["items"]], [TEST_UEN])

    # The linked-award filter must not replace an exact UEN condition in MongoDB.
    def test_public_full_uen_with_linked_filter(self):
        for database in DATABASES:
            with self.subTest(database=database):
                self.create(database)
                status, result = public_call("", database, q=TEST_UEN, require_linked_award=True)
                self.assertEqual(status, 200, result)
                self.assertEqual(result["data"]["items"], [])

    def test_unknown_database_is_rejected(self):
        status, _ = call("GET", "", "oracle")
        self.assertEqual(status, 422)

    def test_statuses_list(self):
        for database in DATABASES:
            with self.subTest(database=database):
                status, body = call("GET", "/statuses", database)
                items = body["data"]["items"]
                self.assertIn("Live Company", items)
                self.assertEqual(items, sorted(items))


if __name__ == "__main__":
    unittest.main()
