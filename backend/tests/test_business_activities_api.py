"""live activity CRUD and search checks using an unused disposable Section.
Run with the local backend and both databases available. Existing catalogue entries are never edited.
"""
import json
import unittest
import urllib.error
import urllib.request
from uuid import uuid4
from backend.tests.admin_auth import sign_in

ROOT = 'http://127.0.0.1:8000'
BASE = '/api/system/business-activities'

def call(method, path, database, body=None):
    request = urllib.request.Request(ROOT + BASE + path + ('&' if '?' in path else '?') + 'database=' + database,
        data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read() or b'null')
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())

class BusinessActivitiesApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sign_in(ROOT)

    def test_catalogue_search_and_section_filter_in_both_databases(self):
        for database in ('mariadb', 'mongodb'):
            with self.subTest(database=database):
                status, body = call('GET', '/children?section=C', database)
                self.assertEqual(status, 200)
                self.assertEqual([item['code'] for item in body['data']['items']], ['C'])
                status, body = call('GET', '/search?q=clinic&section=R', database)
                self.assertEqual(status, 200)
                self.assertTrue(body['data']['items'])
                self.assertTrue(all('clinic' in item['title'].lower() for item in body['data']['items']))
                self.assertEqual(call('GET', '/search?q=%20', database)[0], 422)

    def test_disposable_section_create_read_update_delete_and_write_isolation(self):
        databases = ('mariadb', 'mongodb')
        # Pick a code absent from both databases; never take over an existing Section.
        code = next((code for code in 'ZYXW' if all(call('GET', '/' + code, db)[0] == 404 for db in databases)), None)
        self.assertIsNotNone(code, 'No spare test Section; do not overwrite existing data.')
        for database in databases:
            with self.subTest(database=database):
                created = False
                try:
                    title = 'BTA disposable regression ' + uuid4().hex
                    status, body = call('POST', '', database, {'code': code, 'title': title, 'parent_code': None})
                    self.assertEqual(status, 201)
                    created = True
                    self.assertEqual(body['data']['title'], title)
                    self.assertEqual(call('GET', '/' + code, database)[0], 200)
                    other = 'mongodb' if database == 'mariadb' else 'mariadb'
                    self.assertEqual(call('GET', '/' + code, other)[0], 404)
                    self.assertEqual(call('POST', '', database, {'code': code, 'title': title})[0], 409)
                    status, body = call('PATCH', '/' + code, database, {'title': title + ' edited'})
                    self.assertEqual(status, 200)
                    self.assertEqual(body['data']['title'], title + ' edited')
                    self.assertEqual(call('PATCH', '/' + code, database, {'title': ' '})[0], 422)
                finally:
                    if created:
                        self.assertEqual(call('DELETE', '/' + code, database)[0], 204)
                self.assertEqual(call('GET', '/' + code, database)[0], 404)

if __name__ == '__main__':
    unittest.main()
