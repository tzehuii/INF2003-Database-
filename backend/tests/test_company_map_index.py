# Complete map coverage must not depend on a list page or browser scroll.
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from backend.app.system import company_map_index as index


class MapIndexTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = patch.object(index,'INDEX_PATH',Path(self.temp.name)/'index.sqlite3')
        self.path.start()
        with index.connection() as conn:
            conn.execute("INSERT INTO jobs(id,db,industry,state,updated) VALUES('test','mariadb','A','preparing',?)",(time.time(),))
    def tearDown(self):
        self.path.stop();self.temp.cleanup()
    def build(self,count=76, resolver=None):
        class Source:
            database='mariadb'
            def __call__(self):
                for n in range(count):
                    yield {'uen':f'{n:08}A','name':f'Company {n}','status':'Live', 'addresses':[{'type':'LOCAL','block':str(n),'street_name':'TEST ROAD','postal_code':'123456'}]}
        def location(address):
            n=int(address['block'])
            return {'status':'matched','latitude':1.3+n*.0001,'longitude':103.8,'source':'test fixture'}
        with patch.object(index,'resolve_address',resolver or location):
            index.build('test',Source(),threading.Event())
    def test_complete_index_covers_companies_beyond_the_first_page(self):
        self.build()
        page=index.results('test',limit=25)
        self.assertEqual(page['total'],76);self.assertEqual(len(page['items']),25)
        markers=index.markers('test',11,None)
        self.assertEqual(sum(marker['count'] for marker in markers),76)
        self.assertEqual(index.status('test','mariadb')['state'],'complete')
    def test_full_name_and_uen_search_reaches_the_last_company(self):
        self.build()
        self.assertEqual(index.results('test',q='00000075A')['total'],1)
        self.assertEqual(index.results('test',q='Company 75')['items'][0]['company']['uen'],'00000075A')
    def test_list_pages_are_disjoint_and_do_not_change_marker_counts(self):
        self.build()
        a=index.results('test',offset=0);b=index.results('test',offset=25)
        self.assertFalse({x['company']['uen'] for x in a['items']} & {x['company']['uen'] for x in b['items']})
        self.assertEqual(sum(m['count'] for m in index.markers('test',11,None)),76)
    def test_area_filter_and_cluster_totals_use_the_same_full_index(self):
        self.build()
        bounds=(1.3074,1.308,103.7,103.9)
        page=index.results('test',bounds=bounds)
        self.assertEqual(page['total'],2)
        self.assertEqual(sum(m['count'] for m in index.markers('test',17,bounds)),2)
    def test_unconfirmed_addresses_stay_in_the_full_list_without_pins(self):
        self.build(7,lambda address:{'status':'not_found','reason':'Historical address could not be confirmed.'})
        self.assertEqual(index.results('test')['total'],7)
        self.assertEqual(index.results('test',mode='unmapped')['total'],7)
        self.assertEqual(index.markers('test',11,None),[])
        self.assertEqual(index.status('test','mariadb')['unavailable'],7)
    def test_service_failure_never_claims_index_is_complete(self):
        self.build(7,lambda address:{'status':'service_unavailable','reason':'OneMap is unavailable.'})
        info=index.status('test','mariadb')
        self.assertEqual(info['state'],'paused');self.assertEqual(info['matched'],0)
    def test_index_status_is_isolated_by_database(self):
        self.build(1)
        self.assertIsNone(index.status('test','mongodb'))
    def test_pending_source_companies_are_visible_before_geocoding(self):
        with index.connection() as conn:
            conn.execute('INSERT INTO companies(job,uen,name,payload) VALUES(?,?,?,?)',('test','123','Pending Co',json.dumps({'uen':'123','name':'Pending Co'})))
        page=index.results('test')
        self.assertEqual(page['total'],1);self.assertEqual(page['items'][0]['location']['status'],'pending')
        self.assertEqual(index.results('test',mode='unmapped')['total'],0)
    def test_search_special_characters_are_literal(self):
        self.build(2)
        self.assertEqual(index.results('test',q='%')['total'],0)
        self.assertEqual(index.results('test',q="' OR 1=1 --")['total'],0)

    def test_mapped_tab_and_counts_are_independent_of_pagination(self):
        self.build()
        page=index.results('test',mode='mapped',limit=1)
        self.assertEqual(page['total'],76)
        self.assertEqual(page['counts'],{'all':76,'mapped':76,'unmapped':0})
        self.assertEqual(len(page['items']),1)
    def test_retryable_addresses_are_pending_not_unmapped(self):
        self.build(3)
        with index.connection() as conn:
            conn.execute("UPDATE companies SET status='pending',location=NULL WHERE uen='00000000A'")
            conn.execute("UPDATE companies SET status='service_unavailable' WHERE uen='00000001A'")
        self.assertEqual(index.results('test',mode='mapped')['total'],1)
        self.assertEqual(index.results('test',mode='unmapped')['total'],0)
    def test_progress_and_estimate_use_checked_addresses(self):
        index.update('test',state='locating',total=500,checked=100,matched=90,unavailable=10,rate=2)
        info=index.status('test','mariadb')
        self.assertEqual(info['pending'],400)
        self.assertEqual(info['progress_percent'],20)
        self.assertEqual(info['eta_seconds'],200)
        index.update('test',state='paused')
        self.assertIsNone(index.status('test','mariadb')['eta_seconds'])
    def test_completed_unmapped_addresses_still_count_as_finished(self):
        self.build(7,lambda address:{'status':'not_found','reason':'Historical address.'})
        info=index.status('test','mariadb')
        self.assertEqual(info['progress_percent'],100)
        self.assertEqual(info['pending'],0)
    def test_subcategory_reuses_prepared_parent_without_geocoding(self):
        self.build(3)
        with index.connection() as conn:
            for row in conn.execute('SELECT uen,payload FROM companies').fetchall():
                company=json.loads(row['payload']);company['primary_activity']={'code':'01111','title':'Test activity'}
                conn.execute('UPDATE companies SET payload=? WHERE uen=?',(json.dumps(company),row['uen']))
        class Source:
            nodes={'A':{'code':'A','parent':None},'01111':{'code':'01111','parent':'A'}}
            codes=['01111']
            def __call__(self):raise AssertionError('Prepared data should be reused')
        with patch.object(index,'resolve_address',side_effect=AssertionError('No new OneMap lookup needed')):
            job=index.start('mariadb','01111',Source())
        self.assertEqual(index.status(job,'mariadb')['state'],'complete')
        self.assertEqual(index.results(job)['total'],3)

if __name__=='__main__':unittest.main()
