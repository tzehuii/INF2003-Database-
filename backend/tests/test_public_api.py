"""Public analytics must preserve exact money and count each award only once."""
from contextlib import nullcontext
from datetime import date
from decimal import Decimal
from fastapi import HTTPException
from unittest import TestCase
from unittest.mock import patch
from backend.app.routes import api
from backend.app.api_models import AgencyAwardsResponse, IndustryAwardsResponse

class PublicAnalyticsTests(TestCase):
    def facts(self):
        return [
            {'tender_no':'T1','supplier_name':'Supplier A','amount':Decimal('0.10'),'uen':'U1','company_name':'One','primary_code':'101'},
            {'tender_no':'T1','supplier_name':'Supplier A','amount':Decimal('0.20'),'uen':'U1','company_name':'One','primary_code':'101'},
            {'tender_no':'T2','supplier_name':'Supplier B','amount':Decimal('0.60'),'uen':None,'company_name':None,'primary_code':None},
            {'tender_no':'T3','supplier_name':'Supplier C','amount':Decimal('0.10'),'uen':'U2','company_name':'Two','primary_code':'missing'},
        ]

    def test_agency_totals_are_before_filtering_and_pagination(self):
        with patch.object(api,'store',return_value=nullcontext(object())), patch.object(api,'sqlrows',return_value=[{'exists':1}]), patch.object(api,'award_data',return_value=(self.facts(),{'T4'})):
            result=api.agency_awards(None,'mariadb','Agency',above_average_only=True,limit=1,offset=0)
        AgencyAwardsResponse.model_validate(result)
        summary=result['data']['summary']
        self.assertEqual(summary['total_award_amount'],'1.00')
        self.assertEqual(summary['supplier_count'],3)
        self.assertEqual(summary['tender_count'],3)
        self.assertEqual(summary['award_row_count'],4)
        self.assertEqual(summary['excluded_no_supplier_tender_count'],1)
        self.assertEqual([x['supplier_name'] for x in result['data']['items']],['Supplier B'])
        self.assertEqual(result['data']['items'][0]['company_link']['status'],'not_accepted')
        self.assertEqual(result['data']['items'][0]['share_percent'],'60.00')

    def test_industry_branch_rollup_and_coverage(self):
        nodes={'A':{'code':'A','parent':None,'title':'Section','level':'Section'}, '10':{'code':'10','parent':'A','title':'Division','level':'Division'}, '101':{'code':'101','parent':'10','title':'Group','level':'Group'}}
        with patch.object(api,'store',return_value=nullcontext(object())), patch.object(api,'catalogue',return_value=nodes), patch.object(api,'award_data',return_value=(self.facts(),set())):
            result=api.industry_awards(None,'mariadb',parent_code='A')
        IndustryAwardsResponse.model_validate(result)
        self.assertEqual(result['data']['summary']['total_award_amount'],'0.30')
        self.assertEqual(result['data']['summary']['company_count'],1)
        self.assertEqual(result['data']['summary']['award_row_count'],2)
        self.assertEqual(result['data']['summary']['coverage'],{'excluded_no_accepted_link_award_row_count':1,'excluded_unresolved_primary_ssic_award_row_count':1})
        self.assertEqual(result['data']['items'][0]['code'],'10')

    def test_reversed_dates_are_rejected(self):
        with self.assertRaises(HTTPException) as error:
            api.date_range(date(2026,2,1),date(2026,1,1))
        self.assertEqual(error.exception.status_code,422)
