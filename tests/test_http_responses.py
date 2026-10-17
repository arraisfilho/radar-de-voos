"""Display fields, compression and cache headers; temporary data and simulated receipts."""
import test_isolation  # noqa: F401 - first: temporary data, no seed, idle workers
import gzip
import hashlib
import hmac
import importlib
import json
import os
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit
from fastapi.staticfiles import StaticFiles
from fastapi.testclient import TestClient
from starlette.routing import Mount
from backend import store, mail, offer_links, whatsapp, whatsapp_receipts
from backend.airports import BR_CITIES, CATALOG, airport_record, normalize, search_airports, short_label
from backend.domain import Search, Leg

URL = 'https://www.google.com/travel/flights/search?tfs=fixture&hl=pt-BR&curr=BRL'


class ResponseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.folder = Path(self.temp.name)
        self.patches = [patch.object(store, 'DATA_DIR', self.folder), patch.object(mail, 'DATA_DIR', self.folder), patch.object(mail, 'SETTINGS_FILE', self.folder/'smtp.json'),
                        patch.dict(os.environ, {'RADAR_DEPLOYMENT': 'local', 'RADAR_PUBLIC_URL': 'http://127.0.0.1:8765'})]
        for item in self.patches: item.start()
        store.setup(seed=False); self.module = importlib.import_module('backend.app'); self.headers = {'x-radar-token': self.module.TOKEN}
        self.admin = TestClient(self.module.app); self.user = TestClient(self.module.app)
        self.aid = self.admin.post('/api/auth/bootstrap', json={'name': 'Display admin', 'country': 'BR', 'phone': '11987654321', 'password': 'fixture-password-only'}, headers=self.headers).json()['id']
        self.uid = self.user.post('/api/auth/register', json={'name': 'Display user', 'country': 'US', 'phone': '6502530000', 'password': 'fixture-password-only'}, headers=self.headers).json()['id']

    def tearDown(self):
        self.admin.close(); self.user.close()
        for item in reversed(self.patches): item.stop()
        self.temp.cleanup()

    def search(self):
        config = Search(name='Display trip', origins=['THE'], destinations=['CGH'], outbound=Leg(start='2090-11-05T00:00', end='2090-11-05T23:59')).model_dump()
        return self.user.post('/api/searches', json=config, headers=self.headers).json()['id']

    def test_phone_display_in_session_state_and_admin_listings(self):
        self.assertEqual(self.user.get('/api/auth/session').json()['user']['phone_display'], '+1 650-253-0000')
        state = self.admin.get('/api/state').json()['user']
        self.assertEqual((state['phone'], state['phone_display']), ('+5511987654321', '+55 11 98765-4321'))
        listing = {item['id']: item['phone_display'] for item in self.admin.get('/api/admin/users').json()['items']}
        self.assertEqual(listing, {self.aid: '+55 11 98765-4321', self.uid: '+1 650-253-0000'})
        self.assertEqual(self.admin.get('/api/admin/users/'+self.uid).json()['phone_display'], '+1 650-253-0000')

    def test_airport_label_drops_common_english_suffixes_only(self):
        self.assertEqual(airport_record('CGH')['label'], 'Congonhas')
        self.assertEqual(airport_record('MIA')['label'], 'Miami')
        self.assertEqual(airport_record('CGH')['name'], 'Congonhas Airport')
        for name, label in [('Penglai Intl Airport', 'Penglai'), ('Rio Airfield', 'Rio Airfield'), ('Airport', 'Airport'), ('Main Air Base', 'Main Air Base')]:
            self.assertEqual(short_label(name), label)
        found = self.user.get('/api/airports', params={'q': 'CGH'}).json()[0]
        self.assertEqual((found['code'], found['label']), ('CGH', 'Congonhas'))
        self.search()
        airports = {item['code']: item['label'] for item in self.user.get('/api/state').json()['airports']}
        self.assertEqual(airports['CGH'], 'Congonhas')

    def test_brazilian_cities_are_displayed_in_portuguese_and_search_ignores_accents(self):
        for code, city in [('CGH', 'São Paulo'), ('GRU', 'São Paulo'), ('BSB', 'Brasília'), ('BEL', 'Belém'), ('FLN', 'Florianópolis'),
                           ('VIX', 'Vitória'), ('VDC', 'Vitória da Conquista'), ('IGU', 'Foz do Iguaçu'), ('SJP', 'São José do Rio Preto'),
                           ('GIG', 'Rio de Janeiro'), ('CKS', 'Carajás'), ('THE', 'Teresina')]:
            self.assertEqual(airport_record(code)['city'], city)
        # Display only: other countries, airport names and the catalog keep their text.
        self.assertEqual(airport_record('LIS')['city'], 'Lisbon'); self.assertEqual(airport_record('CGH')['name'], 'Congonhas Airport')
        self.assertEqual(CATALOG['CGH']['city'], 'Sao Paulo')
        for query in ('São Paulo', 'sao paulo', 'SAO PAULO'):
            found = {item['code']: item['city'] for item in search_airports(query)}
            self.assertEqual((found['CGH'], found['GRU']), ('São Paulo', 'São Paulo'))
        for query in ('Brasília', 'brasilia', 'BRASILIA'):
            self.assertEqual(search_airports(query)[0]['code'], 'BSB')
        self.assertEqual(search_airports('foz do iguaçu')[0]['code'], 'IGU'); self.assertEqual(search_airports('foz do iguacu')[0]['code'], 'IGU')
        self.assertEqual(self.user.get('/api/airports', params={'q': 'Belém'}).json()[0]['city'], 'Belém')
        self.search()
        cities = {item['code']: item['city'] for item in self.user.get('/api/state').json()['airports']}
        self.assertEqual(cities, {'THE': 'Teresina', 'CGH': 'São Paulo'})
        # Each entry is a Brazilian catalog city; only accents, letter case and hyphens change,
        # except one name the catalog misspells.
        for raw, display in BR_CITIES.items():
            self.assertTrue(any(a['country'] == 'BR' and a['city'] == raw for a in CATALOG.values()), raw)
            if raw != 'Cachoeiro Do Itapemirim':
                self.assertEqual(normalize(display).replace('-', ' '), normalize(raw).replace('-', ' '), raw)

    def test_large_responses_are_compressed_and_keep_security_headers(self):
        large = self.user.get('/api/airports', params={'q': 'sa'})
        self.assertEqual(large.headers['content-encoding'], 'gzip'); self.assertIn('Accept-Encoding', large.headers['vary'])
        self.assertEqual(large.headers['cache-control'], 'no-store'); self.assertEqual(large.headers['x-frame-options'], 'DENY')
        self.assertGreater(len(large.json()), 5)
        small = self.user.get('/api/auth/session')
        self.assertNotIn('content-encoding', small.headers)
        plain = self.user.get('/api/airports', params={'q': 'sa'}, headers={'accept-encoding': 'identity'})
        self.assertNotIn('content-encoding', plain.headers); self.assertEqual(plain.json(), large.json())

    def test_export_is_compressed_but_still_a_json_attachment(self):
        sid = self.search()
        with store.db() as c:
            cid = c.execute("INSERT INTO cycles(search_id,version,started,status,total) VALUES(?,1,?,'scheduled',1)", (sid, time.time())).lastrowid
            for index in range(40):
                c.execute("INSERT INTO snapshots(search_id,version,cycle_id,direction,collected,complete,price,count) VALUES(?,1,?,'outbound',?,1,?,1)", (sid, cid, time.time()-index, 100000+index))
        response = self.user.get('/api/export/'+sid)
        self.assertEqual(response.headers['content-encoding'], 'gzip')
        self.assertEqual(response.headers['content-disposition'], 'attachment; filename="radar-voos.json"')
        self.assertEqual(len(response.json()['history']), 40)

    def test_signed_webhook_and_offer_redirect_are_unaffected(self):
        config = {'provider': 'openwa', 'enabled': True, 'values': {'base_url': 'https://openwa.example.org', 'session_id': 'gzip-session', 'token': 'fixture-api-key'}}
        whatsapp.save(whatsapp.Settings(**config)); secret = 'gzip-fixture-secret-with-32-characters'; whatsapp_receipts.save(True, secret)
        with store.db() as c:
            c.execute('''INSERT INTO outbox(id,created,alert_ids,subject,body,status,next_due,recipients,channel,provider,transport_ref,provider_message_id,owner_id,attempts)
              VALUES('gzip-delivery',?,'[]','Fixture','Fixture','sent',?,'[]','whatsapp','openwa',?,'gzip-message',?,1)''', (time.time(), time.time(), whatsapp.reference(config), self.aid))
        payload = {'event': 'message.ack', 'sessionId': 'gzip-session', 'timestamp': datetime.now(timezone.utc).isoformat(), 'data': {'id': 'gzip-message', 'messageId': 'gzip-message', 'status': 'read', 'padding': 'x'*2000}}
        body = json.dumps(payload, indent=2).encode()
        signature = 'sha256='+hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        response = self.user.post(whatsapp_receipts.PATH, content=body, headers={'content-type': 'application/json', 'x-openwa-signature': signature, 'accept-encoding': 'gzip'})
        self.assertEqual(response.status_code, 200, response.text)
        with store.db() as c: self.assertEqual(c.execute("SELECT receipt_status FROM outbox WHERE id='gzip-delivery'").fetchone()[0], 'read')
        # A compressed request body is not decoded by the server: the signature covers raw bytes only.
        packed = gzip.compress(body)
        refused = self.user.post(whatsapp_receipts.PATH, content=packed, headers={'content-type': 'application/json', 'content-encoding': 'gzip', 'x-openwa-signature': signature})
        self.assertEqual(refused.status_code, 403)
        sid = self.search()
        with store.db() as c:
            cid = c.execute("INSERT INTO cycles(search_id,version,started,status,total) VALUES(?,1,?,'done',1)", (sid, time.time())).lastrowid
            c.execute("INSERT INTO alerts(id,search_id,version,cycle_id,direction,created,kind,price,payload,status) VALUES('gzip-alert',?,1,?,'outbound',?,'target',1000,'{}','sent')", (sid, cid, time.time()))
            link = offer_links.create(c, 'gzip-alert', URL)
        redirect = self.user.get(urlsplit(link).path, follow_redirects=False, headers={'accept-encoding': 'gzip'})
        self.assertEqual((redirect.status_code, redirect.headers['location'], redirect.headers['cache-control']), (302, URL, 'no-store'))
        self.assertNotIn('content-encoding', redirect.headers)

    def test_hashed_assets_are_immutable_and_the_shell_is_revalidated(self):
        build = self.folder/'dist'; (build/'assets').mkdir(parents=True)
        (build/'assets'/'index-3f9a1c.js').write_text('console.log("radar");'*200)
        (build/'index.html').write_text('<!doctype html><title>Radar de Voos</title><div id="root"></div>')
        mount = Mount('/assets', app=StaticFiles(directory=build/'assets'), name='fixture-assets')
        self.module.app.router.routes.insert(0, mount); self.addCleanup(self.module.app.router.routes.remove, mount)
        asset = self.user.get('/assets/index-3f9a1c.js')
        self.assertEqual(asset.status_code, 200); self.assertEqual(asset.headers['cache-control'], 'public, max-age=31536000, immutable')
        self.assertEqual(asset.headers['content-encoding'], 'gzip'); self.assertIn('console.log', asset.text)
        cached = self.user.get('/assets/index-3f9a1c.js', headers={'if-none-match': asset.headers['etag']})
        self.assertEqual(cached.status_code, 304); self.assertEqual(cached.headers['cache-control'], 'public, max-age=31536000, immutable')
        missing = self.user.get('/assets/missing-000000.js')
        self.assertEqual(missing.status_code, 404); self.assertNotIn('immutable', missing.headers.get('cache-control', ''))
        with patch.object(self.module, 'DIST', build):
            shell = self.user.get('/viagens')
        self.assertEqual(shell.headers['cache-control'], 'no-cache')
        self.assertEqual(self.user.get('/api/state').headers['cache-control'], 'no-store')


if __name__ == '__main__':
    unittest.main()
