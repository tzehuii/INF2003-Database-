# Integration tests for /api/system/schema against the real databases.

# How to run (backend must already be running, both databases reachable):
#   .\.venv\Scripts\python.exe -m unittest backend.tests.test_schema_api -v
# Set SCHEMA_API_URL to test a backend on another port (default http://127.0.0.1:8000).

# The route only reads metadata and counts, so these tests change nothing.

# Import libraries.
import json
import os
import unittest
import urllib.error
import urllib.request

from backend.tests.admin_auth import sign_in

ROOT = os.environ.get("SCHEMA_API_URL", "http://127.0.0.1:8000")

# The project schema as created by sql/INF2003_Grp1_database_schema_mariadb.sql and the MongoDB archive.
TABLES = {"address", "businessactivity", "company", "companyactivity", "formerentityname", "governmentagency",
          "savedlist", "savedlistentry", "supplier", "supplierentitymatch", "tender", "tenderaward"}
COLLECTIONS = {"companies", "dataset_metadata", "industries", "saved_list_entries", "saved_lists", "suppliers", "tenders"}


class SchemaApiTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        try:
            sign_in(ROOT)
            with urllib.request.urlopen(ROOT + "/api/system/schema", timeout=60) as res:
                cls.data = json.load(res)["data"]
        except urllib.error.HTTPError as error:
            raise unittest.SkipTest(f"/api/system/schema answered {error.code}. Restart the backend to load the route.")
        except OSError:
            raise unittest.SkipTest(f"Backend not reachable at {ROOT}. Start it first.")
        cls.tables = {t["name"].lower(): t for t in cls.data["mariadb"]["tables"]}
        cls.collections = {c["name"]: c for c in cls.data["mongodb"]["collections"]}

    def test_every_table_and_collection_is_listed(self):
        self.assertEqual(set(self.tables), TABLES)
        self.assertEqual(set(self.collections), COLLECTIONS)

    def test_foreign_keys_and_delete_rules(self):
        fks = {(name, fk["column"]): (fk["table"].lower(), fk["column_referenced"], fk["on_delete"])
               for name, t in self.tables.items() for fk in t["foreign_keys"]}
        self.assertEqual(len(fks), 12)
        self.assertEqual(fks[("address", "company_id")], ("company", "company_id", "CASCADE"))
        self.assertEqual(fks[("tenderaward", "supplier_id")], ("supplier", "supplier_id", "RESTRICT"))
        self.assertEqual(fks[("businessactivity", "parent_activity_id")], ("businessactivity", "activity_id", "SET NULL"))

    def test_columns_keys_and_row_counts(self):
        company = self.tables["company"]
        self.assertEqual([c["name"] for c in company["columns"] if c["primary_key"]], ["company_id"])
        self.assertIn({"name": "uq_company_uen", "columns": ["uen"], "unique": True}, company["indexes"])
        # Exact counts, the same as the MongoDB collection that holds the same records.
        self.assertEqual(company["rows"], self.collections["companies"]["documents"])
        self.assertEqual(self.tables["tender"]["rows"], self.collections["tenders"]["documents"])

    def test_document_structure_includes_embedded_data(self):
        fields = {f["name"]: f for f in self.collections["companies"]["fields"]}
        self.assertIn("object", fields["address"]["types"])
        self.assertIn("postal_code", [f["name"] for f in fields["address"]["fields"]])
        self.assertIn("array", fields["former_names"]["types"])
        self.assertEqual([f["name"] for f in fields["former_names"]["fields"]], ["source_slot", "name", "search_name"])
        awards = next(f for f in self.collections["tenders"]["fields"] if f["name"] == "awards")
        self.assertIn("supplier_id", [f["name"] for f in awards["fields"]])
        status = next(f for f in next(f for f in self.collections["suppliers"]["fields"] if f["name"] == "match")["fields"] if f["name"] == "status")
        self.assertIn("accepted", status["enum"])


if __name__ == "__main__":
    unittest.main()
