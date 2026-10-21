"""Read-only integration tests for active-only company map results."""
import json
import unittest
from urllib.request import urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError

class CompanyMapApiTests(unittest.TestCase):
    def read(self,database,path='',**query):
        with urlopen('http://127.0.0.1:8000/api/company-map'+path+'?'+urlencode({'database':database,**query}),timeout=60) as response:
            return json.load(response)
    def test_active_industry_results_both_databases(self):
        for database in ('mariadb','mongodb'):
            with self.subTest(database=database):
                result=self.read(database,industry_code='C',limit=5)
                rows=result['data']['items']; self.assertEqual(len(rows),5)
                for row in rows:
                    self.assertIn(row['status'],result['data']['active_statuses'])
                    self.assertTrue(row['primary_activity']['code'])
                    self.assertIn('addresses',row)
                next_rows=self.read(database,industry_code='C',limit=5,offset=5)['data']['items']
                self.assertFalse({r['uen'] for r in rows}&{r['uen'] for r in next_rows})
    def test_inactive_company_cannot_get_overview_pin(self):
        for database in ('mariadb','mongodb'):
            with self.assertRaises(HTTPError) as error:self.read(database,'/location/00001300E')
            self.assertEqual(error.exception.code,422)
    def test_invalid_industry_rejected(self):
        for database in ('mariadb','mongodb'):
            with self.assertRaises(HTTPError) as error:self.read(database,industry_code='INVALID')
            self.assertEqual(error.exception.code,422)
