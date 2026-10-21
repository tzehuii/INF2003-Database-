"""Map resolution must never guess from a historical postal code or an ambiguous hit."""
import unittest
from unittest.mock import patch
from backend.app.system import address_geocoding as geo

class AddressGeocodingTests(unittest.TestCase):
    def address(self, **changes):
        return {'type':'LOCAL','block':'259','street_name':'VICTORIA STREET','postal_code':'0718',**changes}
    def candidate(self, **changes):
        return {'BLK_NO':'259','ROAD_NAME':'VICTORIA STREET','POSTAL':'188034','LATITUDE':'1.3','LONGITUDE':'103.85','ADDRESS':'259 VICTORIA STREET SINGAPORE 188034',**changes}

    def test_four_digit_postal_alone_is_unavailable(self):
        result=geo.resolve_address(self.address(block=None,street_name=None))
        self.assertEqual(result['status'],'unavailable')
        self.assertIn('four-digit',result['reason'])
    def test_same_old_code_does_not_mean_same_cache_location(self):
        self.assertNotEqual(geo.cache_key(self.address()),geo.cache_key(self.address(block='128',street_name='ALBERT STREET')))
    def test_exact_address_can_resolve_without_changing_old_code(self):
        address=self.address(); result=geo.select_candidate(address,[self.candidate()])
        self.assertEqual(result['status'],'matched'); self.assertEqual(address['postal_code'],'0718')
        self.assertEqual(result['resolved_postal_code'],'188034')
    def test_wrong_street_or_block_is_not_a_match(self):
        for fields in ({'BLK_NO':'258'},{'ROAD_NAME':'ALBERT STREET'}):
            self.assertEqual(geo.select_candidate(self.address(),[self.candidate(**fields)])['status'],'not_found')
    def test_multiple_locations_are_not_guessed(self):
        self.assertEqual(geo.select_candidate(self.address(),[self.candidate(),self.candidate(LATITUDE='1.31',POSTAL='188035')])['status'],'ambiguous')
    def test_duplicates_at_same_location_are_one_match(self):
        self.assertEqual(geo.select_candidate(self.address(),[self.candidate(),self.candidate()])['status'],'matched')
    def test_invalid_coordinates_are_not_mapped(self):
        for lat in ('broken','51.5'):
            self.assertEqual(geo.select_candidate(self.address(),[self.candidate(LATITUDE=lat)])['status'],'not_found')
    def test_postal_only_requires_exact_six_digit_match(self):
        address=self.address(block=None,street_name=None,postal_code='018971')
        self.assertEqual(geo.select_candidate(address,[self.candidate(POSTAL='018971')])['status'],'matched')
        self.assertEqual(geo.select_candidate(address,[self.candidate(POSTAL='188034')])['status'],'not_found')
    def test_foreign_address_is_not_on_singapore_overview(self):
        self.assertEqual(geo.resolve_address(self.address(type='FOREIGN'))['status'],'unavailable')
    def test_missing_config_gives_reason_not_fake_pin(self):
        with patch.object(geo,'cached',return_value=None),patch.object(geo,'configured',return_value=False):
            result=geo.resolve_address(self.address())
        self.assertEqual(result['status'],'not_configured'); self.assertNotIn('latitude',result)

    def test_modern_postal_code_disambiguates_same_street_number(self):
        result=geo.select_candidate(self.address(postal_code='188035'),[self.candidate(),self.candidate(POSTAL='188035',LATITUDE='1.31')])
        self.assertEqual(result['status'],'matched')
        self.assertEqual(result['resolved_postal_code'],'188035')
    def test_source_building_name_disambiguates_points(self):
        result=geo.select_candidate(self.address(building_name='VICTORIA CENTRE'),[self.candidate(BUILDING='VICTORIA CENTRE'),self.candidate(BUILDING='OTHER BUILDING',LATITUDE='1.31')])
        self.assertEqual(result['status'],'matched')
        self.assertEqual(result['latitude'],1.3)
    def test_nearby_points_for_same_full_address_get_approximate_pin(self):
        address=self.address(block='21',street_name='SENOKO SOUTH ROAD',postal_code='758079')
        points=[self.candidate(BLK_NO='21',ROAD_NAME='SENOKO SOUTH ROAD',POSTAL='758079',BUILDING='NIL',LATITUDE='1.455981054049007',LONGITUDE='103.8048794455859'),self.candidate(BLK_NO='21',ROAD_NAME='SENOKO SOUTH ROAD',POSTAL='758079',BUILDING='SENOKO INDUSTRIAL ESTATE',LATITUDE='1.456309162117472',LONGITUDE='103.8045470832349')]
        result=geo.select_candidate(address,points)
        self.assertEqual(result['status'],'matched')
        self.assertTrue(result['approximate'])
        self.assertIn('Approximate',result['reason'])
    def test_far_apart_points_are_still_unconfirmed(self):
        result=geo.select_candidate(self.address(),[self.candidate(),self.candidate(LATITUDE='1.34')])
        self.assertEqual(result['status'],'ambiguous')
    def test_same_address_match_is_independent_of_candidate_order(self):
        points=[self.candidate(),self.candidate(BUILDING='CENTRAL ESTATE',LATITUDE='1.3002')]
        a=geo.select_candidate(self.address(),points);b=geo.select_candidate(self.address(),list(reversed(points)))
        self.assertEqual((a['latitude'],a['longitude']),(b['latitude'],b['longitude']))
