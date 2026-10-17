"""Bookmark regression: save, reload, repeat and remove in both databases."""
import json
import unittest
import urllib.request
from uuid import uuid4
from bson import ObjectId
from pymongo import MongoClient
from backend.app.config import load_settings
from backend.app.databases import connect_mariadb

class BookmarkTest(unittest.TestCase):
    # Use a new disposable list; never modify existing bookmarks or company data.
    def test_bookmark_lifecycle(self):
        settings = load_settings()
        for database in ('mariadb', 'mongodb'):
            with self.subTest(database=database):
                def call(method, path, payload=None):
                    request = urllib.request.Request('http://127.0.0.1:8000/api' + path + '?database=' + database,
                        data=json.dumps(payload).encode() if payload is not None else None,
                        headers={'Content-Type': 'application/json'}, method=method)
                    with urllib.request.urlopen(request, timeout=60) as response:
                        raw = response.read()
                        return json.loads(raw) if raw else None
                key = call('POST', '/saved-lists', {'name': 'Bookmark regression ' + uuid4().hex})['data']['id']
                path = '/saved-lists/' + key
                try:
                    entry = call('POST', path + '/companies', {'company_uen': '00001300E'})['data']
                    self.assertEqual(entry['company_uen'], '00001300E')
                    call('POST', path + '/companies', {'company_uen': '00001300E'})
                    loaded = call('GET', path)['data']
                    self.assertEqual(loaded['entry_count'], 1)
                    self.assertEqual(len(loaded['entries']), 1)
                    self.assertEqual(loaded['entries'][0]['company_uen'], '00001300E')
                    call('DELETE', path + '/companies/00001300E')
                    self.assertEqual(call('GET', path)['data']['entries'], [])
                finally:
                    # Clean only the list created by this test, including entries on failure.
                    if database == 'mariadb':
                        db = connect_mariadb(settings)
                        cur = db.cursor()
                        cur.execute('DELETE FROM SavedListEntry WHERE list_id=?', (int(key),))
                        cur.execute('DELETE FROM SavedList WHERE list_id=?', (int(key),))
                        db.commit(); db.close()
                    else:
                        client = MongoClient(settings.mongodb_uri)
                        db = client[settings.mongodb_db_name]
                        db.saved_list_entries.delete_many({'list_id': ObjectId(key)})
                        db.saved_lists.delete_one({'_id': ObjectId(key)})
                        client.close()

if __name__ == '__main__':
    unittest.main()
