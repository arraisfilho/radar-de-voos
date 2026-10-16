"""Bundled airline reference lookup; never performs external search or collects fares."""
import importlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend import airlines,store

class CatalogTests(unittest.TestCase):
    def test_name_code_and_accent_aliases(self):
        for query,code in [('LATAM','LA'),('gol','G3'),('azul','AD'),('British Airways','BA'),('American Airlines','AA'),('aereos','G3'),('Singapore Airlines','SQ')]:
            with self.subTest(query=query):self.assertIn(code,[r['code'] for r in airlines.search_airlines(query)])
        self.assertEqual(airlines.search_airlines('la')[0]['code'],'LA')
        self.assertEqual(airlines.airline_record(' g3 ')['name'],'GOL')
    def test_bounded_unique_reference_results(self):
        self.assertGreater(len(airlines.CATALOG),1000)
        found=airlines.search_airlines('air');self.assertLessEqual(len(found),12)
        self.assertEqual(len({r['code'] for r in found}),len(found))
        for record in found:self.assertEqual(set(record),{'code','name','custom'})
    def test_empty_partial_invalid_and_unknown_codes(self):
        self.assertEqual(airlines.search_airlines(''),[]);self.assertEqual(airlines.search_airlines('a'),[])
        self.assertIsNone(airlines.airline_record('../x'));self.assertEqual(airlines.search_airlines('unknown-airline-fixture'),[])
        code=next(f'{n:02d}' for n in range(100) if f'{n:02d}' not in airlines.CATALOG)
        self.assertEqual(airlines.search_airlines(code)[0],{'code':code,'name':code,'custom':True})

class CatalogAPITests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.patch=patch.object(store,'DATA_DIR',Path(self.temp.name));self.patch.start();store.setup(seed=False)
        self.module=importlib.import_module('backend.app');self.client=TestClient(self.module.app);self.headers={'x-radar-token':self.module.TOKEN}
    def tearDown(self):self.client.close();self.patch.stop();self.temp.cleanup()
    def login(self):
        r=self.client.post('/api/auth/register',json={'name':'Catalog fixture','country':'US','phone':'6502530000','password':'fixture-password-only'},headers=self.headers);self.assertEqual(r.status_code,200,r.text)
    def test_catalog_requires_account(self):
        self.assertEqual(self.client.get('/api/airlines',params={'q':'LATAM'}).status_code,401)
    def test_autocomplete_and_initial_selection_batch(self):
        self.login();result=self.client.get('/api/airlines',params={'q':'British Airways'});self.assertEqual(result.status_code,200,result.text)
        self.assertIn('BA',[r['code'] for r in result.json()])
        result=self.client.get('/api/airlines',params={'codes':'la, LA,AD,invalid,G3'}).json();self.assertEqual([r['code'] for r in result],['LA','AD','G3']);self.assertEqual(result[0]['name'],'LATAM')
    def test_query_limit_and_no_fare_requests(self):
        self.login()
        with patch('backend.engine.fetch',side_effect=AssertionError('Catalog must not collect fares')):
            self.assertEqual(self.client.get('/api/airlines',params={'q':'Azul'}).status_code,200)
            self.assertEqual(self.client.get('/api/airlines',params={'q':'x'*121}).status_code,422)
