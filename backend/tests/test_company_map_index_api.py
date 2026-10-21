# OWNER: Tzehui - Read-only live checks for complete industry maps in both databases.
import json
import time
import unittest
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

def request(path, database, method='GET', **query):
    url='http://127.0.0.1:8000/api/company-map'+path+'?'+urlencode({'database':database,**query})
    with urlopen(Request(url,method=method),timeout=30) as response:return json.load(response)['data']

class CompleteMapApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.jobs={}
        for database in ('mariadb','mongodb'):
            info=request('/index',database,'POST',industry_code='A')
            deadline=time.monotonic()+60
            while info['state'] in ('preparing','locating') and time.monotonic()<deadline:
                time.sleep(.2);info=request('/index/'+info['id'],database)
            if info['state']!='complete':
                raise unittest.SkipTest('Complete location checks require a running backend, configured OneMap and a warmed agriculture index.')
            cls.jobs[database]=info
    def test_database_totals_and_confirmed_locations_agree(self):
        a,b=self.jobs.values()
        for key in ('total','checked','matched','unavailable'):self.assertEqual(a[key],b[key])
        self.assertEqual(a['total'],a['checked'])
    def test_markers_cover_the_full_selection_not_the_list_page(self):
        for db,info in self.jobs.items():
            with self.subTest(database=db):
                root='/index/'+info['id']
                page=request(root+'/results',db,limit=25)
                self.assertEqual(page['total'],info['total'])
                self.assertLessEqual(len(page['items']),25)
                points=request(root+'/markers',db,zoom=11)['items']
                self.assertEqual(sum(point['count'] for point in points),info['matched'])
    def test_search_reaches_last_company_and_area_does_not_change_full_total(self):
        for db,info in self.jobs.items():
            with self.subTest(database=db):
                root='/index/'+info['id']
                tail=request(root+'/results',db,offset=max(0,info['total']-1))['items'][0]
                uen=tail['company']['uen']
                self.assertEqual(request(root+'/results',db,q=uen)['items'][0]['company']['uen'],uen)
                request(root+'/results',db,bounds='1.3,1.31,103.8,103.81')
                self.assertEqual(request(root+'/results',db)['total'],info['total'])
    def test_invalid_area_and_cross_database_job_are_rejected(self):
        root='/index/'+self.jobs['mariadb']['id']
        with self.assertRaises(HTTPError) as error:request(root+'/results','mariadb',bounds='nan,2,100,104')
        self.assertEqual(error.exception.code,422)
        with self.assertRaises(HTTPError) as error:request(root,'mongodb')
        self.assertEqual(error.exception.code,404)

if __name__=='__main__':unittest.main()
