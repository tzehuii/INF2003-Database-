"""Read-only regression checks for Public Companies primary-industry filtering."""
import json
import unittest
from urllib.parse import urlencode
from urllib.request import urlopen
from urllib.error import HTTPError

class IndustryFilterTest(unittest.TestCase):
    # Compare both data stores without creating or changing any company records.
    def test_industry_filter_in_both_databases(self):
        for database in ('mariadb', 'mongodb'):
            with self.subTest(database=database):
                def read(path, **params):
                    with urlopen('http://127.0.0.1:8000/api/' + path + '?' + urlencode({'database': database, **params}), timeout=90) as response:
                        return json.load(response)['data']
                options = read('industries', include_all='true')['items']
                self.assertTrue(any(item['code'] == '86202' for item in options))
                rows = read('companies', industry_code='86202', limit=5)['items']
                self.assertTrue(rows)
                self.assertTrue(all(row['primary_activity']['code'] == '86202' for row in rows))
                # Broad Manufacturing includes specific activities and combines with status.
                rows = read('companies', industry_code='C', limit=5, status='Live')['items']
                self.assertTrue(rows)
                self.assertTrue(all(row['status'] == 'Live' and row['primary_activity'] for row in rows))
                self.assertEqual(len(read('companies', q='00001300E', industry_code='86202')['items']), 1)
                self.assertEqual(read('companies', q='00001300E', industry_code='C')['items'], [])
                with self.assertRaises(HTTPError) as error:
                    read('companies', industry_code='NOT-A-CODE')
                self.assertEqual(error.exception.code, 422)
