"""Audit aggregation, category quotas and administrative records; simulated providers only."""
import test_isolation  # noqa: F401 - first: temporary data, no seed, idle workers
import importlib
import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit
from fastapi.testclient import TestClient
from backend import store,mail,audit,google_mail,whatsapp,whatsapp_receipts

SECRETS=('smtp-secret-fixture','whatsapp-token-fixture','receipt-secret-fixture-with-32-chars','google-secret-fixture','fixture-access-token','fixture-refresh-token')


class AuditTrailTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.folder=Path(self.temp.name)
        self.patches=[patch.object(store,'DATA_DIR',self.folder),patch.object(mail,'DATA_DIR',self.folder),patch.object(mail,'SETTINGS_FILE',self.folder/'smtp-private.json'),
                      patch.object(google_mail,'APPLICATION_CLIENT_FILE',self.folder/'public-client.json')]
        for item in self.patches:item.start()
        store.setup(seed=False);self.module=importlib.import_module('backend.app');self.headers={'x-radar-token':self.module.TOKEN}
        self.admin=TestClient(self.module.app,base_url='http://127.0.0.1:8765',client=('127.0.0.1',5555))
        self.user=TestClient(self.module.app)
        response=self.admin.post('/api/auth/bootstrap',json={'name':'Audit admin','country':'US','phone':'6502530000','password':'fixture-password-only'},headers=self.headers)
        self.assertEqual(response.status_code,200,response.text);self.aid=response.json()['id']
        self.uid=self.user.post('/api/auth/register',json={'name':'Audit user','country':'GB','phone':'02079460018','password':'fixture-password-only'},headers=self.headers).json()['id']
    def tearDown(self):
        self.admin.close();self.user.close()
        for item in reversed(self.patches):item.stop()
        self.temp.cleanup()
    def request(self,address='203.0.113.7',agent='Firefox/130.0'):
        return SimpleNamespace(client=SimpleNamespace(host=address),headers={'user-agent':agent})
    def events(self,name):
        with store.db() as c:return [audit.public(r) for r in c.execute('SELECT * FROM access_audit WHERE event=? ORDER BY id',(name,))]
    def latest(self,name):
        rows=self.events(name);self.assertTrue(rows,name);return rows[-1]
    def table(self):
        with store.db() as c:return json.dumps([dict(r) for r in c.execute('SELECT * FROM access_audit')])

    def categories(self):
        with store.db() as c:return dict(c.execute('SELECT '+audit.CATEGORY+',COUNT(*) FROM access_audit GROUP BY 1').fetchall())
    def administrative(self):
        with store.db() as c:return {r[0] for r in c.execute("SELECT id FROM access_audit WHERE event LIKE 'admin%' OR event='bootstrap_success'")}

    def test_repeated_events_are_aggregated_by_event_address_account_and_window(self):
        for _ in range(3):audit.record(self.request(),'login_failed')
        rows=self.events('login_failed');self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['count'],3);self.assertGreaterEqual(rows[0]['last_seen'],rows[0]['created'])
        audit.record(self.request('203.0.113.8'),'login_failed')
        audit.record(self.request(),'login_failed',self.uid)
        audit.record(self.request(),'login_throttled')
        self.assertEqual(len(self.events('login_failed')),3);self.assertEqual(len(self.events('login_throttled')),1)
        with store.db() as c:c.execute("UPDATE access_audit SET created=created-700,last_seen=last_seen-700 WHERE event='login_failed' AND user_id IS NULL AND ip='203.0.113.7'")
        audit.record(self.request(),'login_failed')
        self.assertEqual([r['count'] for r in self.events('login_failed') if r['ip']=='203.0.113.7' and r['user_id'] is None],[3,1])
        # Sessions merge per account and address within the window, like the anonymous events.
        for _ in range(2):audit.record(self.request(),'logout',self.uid)
        audit.record(self.request('203.0.113.8'),'logout',self.uid);audit.record(self.request(),'logout',self.aid)
        self.assertEqual(sorted(r['count'] for r in self.events('logout')),[1,1,2])
        # Other authenticated events are never merged.
        for _ in range(2):
            audit.record(self.request(),'password_reset',self.uid);audit.record(self.request(),'admin_monitoring_viewed',self.uid,self.aid)
        self.assertEqual(len(self.events('password_reset')),2);self.assertEqual(len(self.events('admin_monitoring_viewed')),2)

    def test_another_device_behind_the_same_address_keeps_its_own_session_rows(self):
        # E.g. CGNAT: the account holder on Chrome/macOS and someone else on Firefox/Windows share one IP.
        chrome='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
        firefox='Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0'
        for agent in (chrome,firefox,chrome,firefox,chrome):audit.record(self.request(agent=agent),'login_success',self.uid)
        rows=self.events('login_success')
        self.assertEqual(sorted((r['browser'],r['system'],r['count']) for r in rows),[('Chrome','macOS',3),('Firefox','Windows',2)])
        for agent in (firefox,chrome,firefox):audit.record(self.request(agent=agent),'logout',self.uid)
        self.assertEqual(sorted((r['browser'],r['count']) for r in self.events('logout')),[('Chrome',1),('Firefox',2)])
        # Anonymous repeats stay aggregated by address and account only: a varying agent does not split them.
        for agent in (chrome,firefox,'fixture-agent'):audit.record(self.request(agent=agent),'login_failed')
        self.assertEqual([r['count'] for r in self.events('login_failed')],[3])

    def test_each_category_is_capped_apart_so_floods_cannot_evict_administration_records(self):
        self.assertEqual(self.admin.put('/api/admin/delivery-retention',json={'scope':'access','days':30},headers=self.headers).status_code,200)
        self.assertEqual(self.admin.put('/api/smtp',json={'enabled':False,'host':'smtp.example.org'},headers=self.headers).status_code,200)
        protected=self.administrative();self.assertEqual(len(protected),3)
        for index in range(60):audit.record(self.request('198.51.100.%d'%index),'login_failed')
        audit.record(self.request(),'recovery_requested')
        for index in range(30):audit.record(self.request('192.0.2.%d'%index),'logout',self.uid)
        with patch.object(audit,'NOISY_LIMIT',5),patch.object(audit,'RECORD_LIMIT',4):
            audit.cleanup()
        with store.db() as c:
            kept={r[0] for r in c.execute('SELECT id FROM access_audit')}
            noisy=[r[0] for r in c.execute("SELECT event FROM access_audit WHERE event IN ('login_failed','login_throttled','recovery_requested')")]
        self.assertTrue(protected<=kept);self.assertIn('recovery_requested',noisy)
        self.assertEqual(self.categories(),{'noisy':5,'account':4,'admin':3})
        # Administration has a quota of its own, applied the same way.
        with patch.object(audit,'ADMIN_LIMIT',2):audit.cleanup()
        self.assertEqual(self.categories(),{'noisy':5,'account':4,'admin':2})

    def test_successful_login_flood_cannot_evict_administration_records(self):
        self.assertEqual(self.admin.put('/api/smtp',json={'enabled':False,'host':'smtp.example.org'},headers=self.headers).status_code,200)
        protected=self.administrative()
        login={'country':'GB','phone':'02079460018','password':'fixture-password-only'}
        for _ in range(3):self.assertEqual(self.user.post('/api/auth/login',json=login,headers=self.headers).status_code,200)
        # A login loop from one address is one record.
        self.assertEqual([r['count'] for r in self.events('login_success')],[3])
        for index in range(40):audit.record(self.request('198.51.100.%d'%index),'login_success',self.uid)
        with patch.object(audit,'RECORD_LIMIT',len(protected)):audit.cleanup()
        self.assertTrue(protected<=self.administrative())
        self.assertEqual(self.categories()['account'],len(protected))

    def test_recording_does_not_prune_and_retention_uses_last_occurrence(self):
        audit.record(self.request(),'login_failed')
        with store.db() as c:c.execute("UPDATE access_audit SET created=? WHERE event='login_failed'",(time.time()-100*86400,))
        with store.db() as c:c.execute("UPDATE access_audit SET last_seen=? WHERE event='login_failed'",(time.time()-60,))
        audit.record(self.request('192.0.2.50'),'login_failed')
        self.assertEqual(len(self.events('login_failed')),2)
        audit.cleanup()
        # Still repeating a minute ago: kept although first seen 100 days ago.
        self.assertEqual(len(self.events('login_failed')),2)

    def test_channel_changes_are_audited_with_actor_and_without_secret_values(self):
        smtp={'enabled':True,'host':'smtp.example.org','port':587,'username':'sender','password':SECRETS[0],'sender':'from@example.org','recipient':'to@example.org'}
        self.assertEqual(self.admin.put('/api/smtp',json=smtp,headers=self.headers).status_code,200)
        entry=self.latest('admin_smtp_saved');self.assertEqual(entry['actor_id'],self.aid);self.assertIsNone(entry['user_id'])
        self.assertTrue(entry['details']['enabled']);self.assertIn('password',entry['details']['changed']);self.assertIn('host',entry['details']['changed'])
        self.assertEqual(self.admin.put('/api/smtp',json=smtp|{'password':'','port':465,'security':'ssl'},headers=self.headers).status_code,200)
        self.assertEqual(self.latest('admin_smtp_saved')['details']['changed'],['port','security'])
        response=self.admin.delete('/api/smtp',headers=self.headers);self.assertEqual(response.status_code,200)
        self.assertFalse(response.json()['enabled']);self.assertFalse(mail.SETTINGS_FILE.exists())
        self.assertEqual(self.latest('admin_smtp_removed')['details'],{'existed':True})

        config={'provider':'openwa','enabled':True,'values':{'base_url':'https://openwa.example.org','session_id':'audit-session','token':SECRETS[1]}}
        self.assertEqual(self.admin.put('/api/admin/whatsapp',json=config,headers=self.headers).status_code,200)
        entry=self.latest('admin_whatsapp_saved');self.assertEqual(entry['actor_id'],self.aid)
        self.assertEqual(entry['details']['provider'],'openwa');self.assertIn('token',entry['details']['changed'])
        self.assertEqual(self.admin.put('/api/admin/whatsapp/receipts',json={'enabled':True,'secret':SECRETS[2]},headers=self.headers).status_code,200)
        self.assertIn('secret',self.latest('admin_whatsapp_receipts_saved')['details']['changed'])
        rotated='another-receipt-secret-with-32-characters'
        self.assertEqual(self.admin.put('/api/admin/whatsapp/receipts',json={'enabled':True,'secret':rotated},headers=self.headers).status_code,200)
        self.assertEqual(self.latest('admin_whatsapp_receipts_saved')['details'],{'enabled':True,'changed':['secret']})
        response=self.admin.delete('/api/admin/whatsapp',headers=self.headers);self.assertEqual(response.status_code,200);self.assertFalse(response.json()['available'])
        self.assertEqual(self.latest('admin_whatsapp_removed')['details'],{'provider':'openwa','existed':True,'receipts_removed':True,'cancelled':0})
        self.assertFalse((self.folder/'whatsapp-private.json').exists());self.assertFalse((self.folder/'whatsapp-receipts-private.json').exists())

        client={'client_id':'audit.apps.googleusercontent.com','client_secret':SECRETS[3]}
        self.assertEqual(self.admin.put('/api/google/client',json=client,headers=self.headers).status_code,200)
        entry=self.latest('admin_google_client_saved');self.assertEqual(entry['details']['client_type'],'web');self.assertIn('client_secret',entry['details']['changed'])
        start=self.admin.post('/api/google/start',json={},headers=self.headers);self.assertEqual(start.status_code,200,start.text)
        state=parse_qs(urlsplit(start.json()['url']).query)['state'][0]
        tokens={'scope':google_mail.SCOPES,'access_token':SECRETS[4],'refresh_token':SECRETS[5],'expires_in':3600}
        with patch.object(google_mail,'remote',side_effect=[tokens,{'email':'sender@example.org','email_verified':True}]):
            self.assertIn('Conta conectada',self.admin.get('/api/google/callback',params={'state':state,'code':'fixture-code'}).text)
        self.assertEqual(self.latest('admin_google_connected')['actor_id'],self.aid)
        self.assertEqual(self.admin.post('/api/google/disconnect',json={},headers=self.headers).status_code,200)
        self.assertEqual(self.latest('admin_google_disconnected')['details'],{'was_connected':True})
        response=self.admin.delete('/api/google/client',headers=self.headers);self.assertEqual(response.status_code,200)
        self.assertFalse(response.json()['configured']);self.assertFalse(google_mail.path().exists())
        self.assertEqual(self.latest('admin_google_client_removed')['details'],{'existed':True,'was_connected':False})
        stored=self.table()
        for secret in SECRETS+(rotated,):self.assertNotIn(secret,stored)
        self.assertNotIn(SECRETS[0],self.admin.get('/api/admin/audit',params={'page':0}).text)

    def test_removal_routes_are_admin_only_and_require_the_page_token(self):
        for path in ('/api/smtp','/api/admin/whatsapp','/api/google/client'):
            self.assertEqual(self.user.delete(path,headers=self.headers).status_code,403,path)
            self.assertEqual(self.admin.delete(path).status_code,403,path)
            anonymous=TestClient(self.module.app)
            try:self.assertEqual(anonymous.delete(path,headers=self.headers).status_code,401,path)
            finally:anonymous.close()
        for name in ('admin_smtp_removed','admin_whatsapp_removed','admin_google_client_removed'):self.assertEqual(self.events(name),[])

    def test_retention_change_and_manual_cleanup_record_survive_the_cleanup(self):
        response=self.admin.put('/api/admin/delivery-retention',json={'scope':'access','days':15},headers=self.headers);self.assertEqual(response.status_code,200)
        self.assertEqual(self.latest('admin_retention_changed')['details'],{'scope':'access','before':90,'after':15})
        with store.db() as c:c.execute("INSERT INTO access_audit(user_id,event,created,ip,user_agent,browser,system) VALUES(?,'login_success',?,'local','','','')",(self.uid,time.time()-20*86400))
        before=time.time()
        plan=self.admin.post('/api/admin/delivery-cleanup/preview',json={'scope':'access','before':before},headers=self.headers).json()
        body={k:plan[k] for k in ('before','expires','proof')}|{'scope':'access'}
        result=self.admin.post('/api/admin/delivery-cleanup/confirm',json=body,headers=self.headers).json()
        self.assertEqual(result['removed'],plan['count']);self.assertGreater(result['removed'],1)
        self.assertEqual(self.events('admin_retention_changed'),[])
        entry=self.latest('admin_logs_cleaned');self.assertEqual(entry['actor_id'],self.aid)
        self.assertEqual(entry['details'],{'scope':'access','before':before,'removed':result['removed'],'has_more':False})

    def test_listing_returns_count_last_seen_details_and_event_codes(self):
        for _ in range(2):audit.record(self.request(),'login_failed',self.uid)
        self.admin.put('/api/admin/delivery-retention',json={'scope':'deliveries','days':45},headers=self.headers)
        page=self.admin.get('/api/admin/audit',params={'page':0}).json()
        for item in page['items']:self.assertTrue({'count','last_seen','details'}<=set(item))
        failed=next(i for i in page['items'] if i['event']=='login_failed');self.assertEqual(failed['count'],2);self.assertIsNotNone(failed['last_seen'])
        changed=next(i for i in page['items'] if i['event']=='admin_retention_changed');self.assertEqual(changed['details']['after'],45)
        self.assertEqual(changed['actor_name'],'Audit admin')
        self.assertTrue({'admin_smtp_saved','admin_logs_cleaned','admin_google_connected','login_throttled'}<=set(page['events']))
        self.assertEqual((page['max_records'],page['noisy_max_records'],page['admin_max_records']),(20000,5000,20000))
        self.assertEqual(self.admin.get('/api/admin/audit',params={'page':0,'q':'Audit admin','event':'admin_retention_changed'}).json()['total'],1)
        own=self.user.get('/api/audit').json();self.assertEqual(own[0]['count'],2);self.assertEqual(own[0]['event'],'login_failed')
        # An aggregated row matches a time filter while its repeats overlap it.
        with store.db() as c:c.execute("UPDATE access_audit SET created=? WHERE event='login_failed'",(time.time()-3600,))
        found=self.admin.get('/api/admin/audit',params={'page':0,'event':'login_failed','start':time.time()-60}).json()
        self.assertEqual(found['total'],1)


if __name__=='__main__':unittest.main()
