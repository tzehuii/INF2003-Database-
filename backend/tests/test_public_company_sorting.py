"""Read-only sorting regressions for Public Companies in both databases."""
import json
import unittest
from urllib.parse import urlencode
from urllib.request import urlopen
from urllib.error import HTTPError

class PublicCompanySortingTests(unittest.TestCase):
    # A narrow real-data filter keeps tests fast without modifying imported records.
    def read(self, database, **changes):
        params = dict(database=database, industry_code='86202', limit=10, sort_by='uen', sort_direction='asc')
        params.update(changes)
        with urlopen('http://127.0.0.1:8000/api/companies?' + urlencode(params), timeout=90) as response:
            return json.load(response)

    def test_ascending_descending_and_filters(self):
        for database in ('mariadb', 'mongodb'):
            for key in ('uen', 'name', 'status', 'registration_date', 'primary_activity'):
                for direction in ('asc', 'desc'):
                    with self.subTest(database=database, key=key, direction=direction):
                        result = self.read(database, sort_by=key, sort_direction=direction, status='Live')
                        rows = result['data']['items']
                        self.assertTrue(rows)
                        self.assertTrue(all(row['status'] == 'Live' and row['primary_activity']['code'] == '86202' for row in rows))
                        values = [row['incorporation_date'] if key == 'registration_date' else row['primary_activity']['code'] if key == 'primary_activity' else row[key] for row in rows]
                        values = [value for value in values if value is not None]
                        # Text comparison is case-insensitive, matching the registry's uppercase names.
                        values = [value.casefold() if isinstance(value, str) else value for value in values]
                        self.assertEqual(values, sorted(values, reverse=direction == 'desc'))

    def test_sort_is_global_and_pages_do_not_overlap(self):
        for database in ('mariadb', 'mongodb'):
            for direction in ('asc', 'desc'):
                with self.subTest(database=database, direction=direction):
                    first = self.read(database, sort_by='registration_date', sort_direction=direction, limit=5)['data']['items']
                    second = self.read(database, sort_by='registration_date', sort_direction=direction, limit=5, offset=5)['data']['items']
                    combined = self.read(database, sort_by='registration_date', sort_direction=direction, limit=10)['data']['items']
                    self.assertEqual(first + second, combined)
                    self.assertFalse({row['uen'] for row in first} & {row['uen'] for row in second})
                    self.assertEqual(first, self.read(database, sort_by='registration_date', sort_direction=direction, limit=5)['data']['items'])

    def test_invalid_sort_parameters_are_rejected(self):
        for database in ('mariadb', 'mongodb'):
            for params in ({'sort_by': 'not_a_column'}, {'sort_direction': 'sideways'}):
                with self.subTest(database=database, params=params):
                    with self.assertRaises(HTTPError) as error:
                        self.read(database, **params)
                    self.assertEqual(error.exception.code, 422)
