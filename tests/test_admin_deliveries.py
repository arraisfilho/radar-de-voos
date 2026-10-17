"""Admin log and retention tests: temporary databases, no external sends."""
import test_isolation  # noqa: F401 - first: temporary data, no seed, idle workers
import importlib
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from fastapi import HTTPException
from backend import store,mail,deliveries
from backend.domain import Search,Leg
from backend.engine import Monitor


class AdminDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();folder=Path(self.temp.name)
        self.patches=[patch.object(store,'DATA_DIR',folder),patch.object(mail,'DATA_DIR',folder),patch.object(mail,'SETTINGS_FILE',folder/'smtp.json'),patch.dict('os.environ',{'RADAR_DELIVERY_RETENTION_DAYS':'90'})]
        for p in self.patches:p.start()
        store.setup(seed=False);self.module=importlib.import_module('backend.app')
        self.admin=TestClient(self.module.app);self.user=TestClient(self.module.app);self.anon=TestClient(self.module.app)
        self.headers={'x-radar-token':self.module.TOKEN}
        payload={'name':'Admin fixture','country':'US','phone':'6502530000','password':'fixture-password-only','emails':['admin@example.org']}
        self.aid=self.admin.post('/api/auth/bootstrap',json=payload,headers=self.headers).json()['id']
        payload.update(name='Other fixture',country='GB',phone='02079460018',emails=['user@example.org'])
        self.uid=self.user.post('/api/auth/register',json=payload,headers=self.headers).json()['id']
        config=Search(name='User trip',origins=['THE'],destinations=['GRU'],outbound=Leg(start='2090-11-05T00:00',end='2090-11-05T23:59')).model_dump()
        self.sid=self.user.post('/api/searches',json=config,headers=self.headers).json()['id']
    def tearDown(self):
        self.admin.close();self.user.close();self.anon.close()
        for p in reversed(self.patches):p.stop()
        self.temp.cleanup()
    def insert(self,oid,status='sent',age=0,channel='email',owner=None,body='Fixture message',kind='test',search=None):
        created=time.time()-age*86400
        with store.db() as c:
            c.execute('INSERT INTO outbox(id,search_id,version,created,alert_ids,subject,body,status,next_due,recipients,owner_id,channel,kind) VALUES(?,?,1,?,?,?,?,?,?,?,?,?,?)',(oid,search,created,'[]','Fixture '+oid,body,status,created,json.dumps(['recipient@example.org']),owner,channel,kind))
    def test_all_routes_require_admin_and_mutations_require_csrf(self):
        for client,expected in [(self.user,403),(self.anon,401)]:
            for route in ['/api/admin/deliveries','/api/admin/deliveries/anything','/api/admin/delivery-retention']:
                self.assertEqual(client.get(route).status_code,expected,route)
            for action in ['preview','confirm']:
                self.assertEqual(client.post('/api/admin/delivery-cleanup/'+action,json={'before':time.time()},headers=self.headers).status_code,expected)
        self.assertEqual(self.admin.post('/api/admin/delivery-cleanup/preview',json={'before':time.time()}).status_code,403)
    def test_admin_sees_other_users_with_pagination_and_filters(self):
        for i in range(17):self.insert(str(i),owner=self.uid,status='failed' if i==0 else 'sent')
        self.insert('admin',owner=self.aid,channel='telegram');self.insert('other-channel',owner=self.uid,channel='whatsapp')
        page=self.admin.get('/api/admin/deliveries').json();self.assertEqual(page['total'],19);self.assertEqual(len(page['items']),15)
        second=self.admin.get('/api/admin/deliveries',params={'page':1}).json();self.assertEqual(len(second['items']),4)
        self.assertFalse({i['id'] for i in page['items']}&{i['id'] for i in second['items']})
        filtered=self.admin.get('/api/admin/deliveries',params={'user':'Other fixture','channel':'email','status':'failed'}).json()
        self.assertEqual([i['id'] for i in filtered['items']],['0']);self.assertEqual(filtered['items'][0]['login'],'+442079460018')
        self.assertEqual(self.admin.get('/api/admin/deliveries',params={'q':'recipient@example.org'}).json()['total'],19)
        self.assertEqual(self.admin.get('/api/admin/deliveries',params={'q':'%'}).json()['total'],0)
        self.assertEqual(self.admin.get('/api/admin/deliveries',params={'start':time.time()+2}).json()['total'],0)
        self.assertEqual(self.admin.get('/api/admin/deliveries',params={'channel':'invalid'}).status_code,422)
    def test_detail_includes_plain_content_but_lists_do_not(self):
        self.insert('content',owner=self.uid,body='<script>fixture</script>\nFare fell')
        listing=self.admin.get('/api/admin/deliveries').json();self.assertNotIn('body',listing['items'][0]);self.assertNotIn('error',listing['items'][0])
        detail=self.admin.get('/api/admin/deliveries/content').json();self.assertEqual(detail['body'],'<script>fixture</script>\nFare fell');self.assertFalse(detail['content_protected']);self.assertEqual(detail['account_name'],'Other fixture')
        self.assertEqual(self.admin.get('/api/admin/deliveries/missing').status_code,404)
    def test_recovery_contents_are_protected_even_for_legacy_records(self):
        for oid,kind,body in [('recovery','recovery','Secret recovery link'),('legacy','legacy','https://example.org/#reset=fixture-secret')]:
            self.insert(oid,kind=kind,body=body)
            detail=self.admin.get('/api/admin/deliveries/'+oid).json();self.assertTrue(detail['content_protected']);self.assertIsNone(detail['body']);self.assertNotIn('fixture-secret',json.dumps(detail))
    def test_search_ownership_is_recorded_on_enqueue(self):
        self.insert('owned',search=self.sid,owner=None,kind='legacy',status='pending')
        detail=self.admin.get('/api/admin/deliveries/owned').json();self.assertEqual(detail['owner_id'],self.uid);self.assertEqual(detail['kind'],'alert')
        self.assertIsNone(detail['provider'])
    def test_sender_records_actual_provider_and_ignores_future_channels(self):
        self.insert('future',status='pending',age=.001,channel='telegram');self.insert('email',status='pending',owner=self.aid)
        with patch.object(mail,'delivery_settings',return_value={'enabled':True,'provider':'google','recipient':'fixture@example.org'}),patch.object(mail,'transmit') as transmit:
            Monitor().send_one();transmit.assert_called_once();self.assertEqual(transmit.call_args.args[1],'email')
        with store.db() as c:
            email=dict(c.execute("SELECT * FROM outbox WHERE id='email'").fetchone());future=c.execute("SELECT status FROM outbox WHERE id='future'").fetchone()[0]
        self.assertEqual(email['provider'],'google');self.assertIsNotNone(email['completed']);self.assertEqual(future,'pending')
    def test_retention_deletes_only_old_finished_logs_and_is_hourly(self):
        for status in deliveries.TERMINAL:self.insert(status,status,age=91)
        self.insert('recent',age=89);self.insert('pending',status='pending',age=200);self.insert('sending',status='sending',age=200)
        self.assertEqual(deliveries.cleanup(),len(deliveries.TERMINAL));self.assertEqual(deliveries.cleanup(),0)
        with store.db() as c:self.assertEqual({r[0] for r in c.execute('SELECT id FROM outbox')},{'recent','pending','sending'})
        info=self.admin.get('/api/admin/delivery-retention').json();self.assertEqual(info['days'],90);self.assertEqual(info['protected'],2)
    def test_newly_finished_old_pending_message_gets_completion_time_now(self):
        self.insert('old',status='pending',age=200)
        with store.db() as c:c.execute("UPDATE outbox SET status='expired' WHERE id='old'")
        self.assertEqual(deliveries.cleanup(),0)
        detail=deliveries.detail('old');self.assertGreater(detail['completed'],time.time()-3)
    def test_preview_confirmation_is_bound_to_actor_and_exact_records(self):
        self.insert('old',age=100);self.insert('protected',status='pending',age=200)
        before=time.time()-90*86400
        preview=self.admin.post('/api/admin/delivery-cleanup/preview',json={'before':before},headers=self.headers).json();self.assertEqual(preview['count'],1)
        with self.assertRaises(HTTPException):deliveries.confirm(before,preview['expires'],preview['proof'],self.uid,self.module.TOKEN)
        self.insert('newly-matching',age=100)
        body={k:preview[k] for k in ['before','expires','proof']}
        self.assertEqual(self.admin.post('/api/admin/delivery-cleanup/confirm',json=body,headers=self.headers).status_code,409)
        preview=self.admin.post('/api/admin/delivery-cleanup/preview',json={'before':before},headers=self.headers).json()
        body={k:preview[k] for k in ['before','expires','proof']}
        result=self.admin.post('/api/admin/delivery-cleanup/confirm',json=body,headers=self.headers).json();self.assertEqual(result['removed'],2)
        self.assertEqual(deliveries.detail('protected')['status'],'pending')
    def test_preview_expiry_future_dates_and_bounded_batches(self):
        self.assertEqual(self.admin.post('/api/admin/delivery-cleanup/preview',json={'before':time.time()+60},headers=self.headers).status_code,422)
        for i in range(4):self.insert(str(i),age=100)
        with patch.object(deliveries,'BATCH_SIZE',2):
            plan=deliveries.preview(time.time(),self.aid,'fixture-secret');self.assertEqual(plan['count'],2);self.assertEqual(plan['total'],4);self.assertTrue(plan['has_more'])
            with patch.object(deliveries.time,'time',return_value=time.time()+400):
                with self.assertRaises(HTTPException):deliveries.confirm(plan['before'],plan['expires'],plan['proof'],self.aid,'fixture-secret')
            result=deliveries.confirm(plan['before'],plan['expires'],plan['proof'],self.aid,'fixture-secret');self.assertEqual(result['removed'],2);self.assertTrue(result['has_more'])
    def test_cleanup_preserves_opportunity_history(self):
        self.insert('old',age=100,search=self.sid)
        with store.db() as c:
            cid=c.execute("INSERT INTO cycles(search_id,version,started,status,total) VALUES(?,1,?,'done',1)",(self.sid,time.time())).lastrowid
            c.execute("INSERT INTO snapshots(search_id,version,cycle_id,direction,collected,complete,price,count) VALUES(?,1,?,'outbound',?,1,10000,1)",(self.sid,cid,time.time()))
        deliveries.cleanup()
        with store.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM snapshots').fetchone()[0],1)
    def test_upgrade_backfills_ownership_and_protects_legacy_recovery(self):
        self.insert('legacy-search',search=self.sid);self.insert('legacy-reset',kind='legacy',body='https://example.org/#reset=protected')
        with store.db() as c:
            c.execute("DELETE FROM metadata WHERE key='delivery_log_v1'")
            c.execute("UPDATE outbox SET owner_id=NULL,kind='legacy',completed=NULL")
            deliveries.setup(c)
        self.assertEqual(deliveries.detail('legacy-search')['owner_id'],self.uid)
        self.assertTrue(deliveries.detail('legacy-reset')['content_protected']);self.assertIsNotNone(deliveries.detail('legacy-search')['completed'])

    def test_configuration_blocks_are_not_transport_failures_or_retried(self):
        from backend import notifications
        for oid in ['no-contact','no-service','attempted']:
            self.insert(oid,status='failed',search=self.sid)
        with store.db() as c:
            c.execute("UPDATE outbox SET recipients='[]',error='E-mail sem destinatários ou serviço indisponível' WHERE id='no-contact'")
            c.execute("UPDATE outbox SET error='E-mail sem destinatários ou serviço indisponível' WHERE id='no-service'")
            c.execute("UPDATE outbox SET attempts=1,error='E-mail sem destinatários ou serviço indisponível' WHERE id='attempted'")
            c.execute("DELETE FROM metadata WHERE key='delivery_blocked_v1'")
            notifications.setup(c)
        self.assertEqual(deliveries.detail('no-contact')['status'],'waiting_contact')
        self.assertEqual(deliveries.detail('no-service')['status'],'waiting_service')
        self.assertEqual(deliveries.detail('attempted')['status'],'failed')
        self.assertEqual(deliveries.detail('no-contact')['body'],'Fixture message')
        blocked=self.admin.get('/api/admin/deliveries',params={'status':'blocked'}).json()
        self.assertEqual({row['id'] for row in blocked['items']},{'no-contact','no-service'})
        with patch.object(mail,'delivery_settings',return_value={'enabled':True,'provider':'smtp'}),patch.object(mail,'transmit') as transmit:
            Monitor().send_one();transmit.assert_not_called()

    def test_paged_audit_filters_ownership_and_actual_retention(self):
        from backend import audit
        now=time.time()
        with store.db() as c:
            c.executemany('INSERT INTO access_audit(user_id,event,created,ip,user_agent,browser,system) VALUES(?,?,?,?,?,?,?)',[(self.uid,'login_failed',now-i,'127.0.0.1','fixture agent','Fixture browser','Fixture OS') for i in range(31)])
            c.execute('INSERT INTO access_audit(user_id,event,created,ip,user_agent,browser,system) VALUES(?,?,?,?,?,?,?)',(self.aid,'login_failed',now,'127.0.0.1','admin fixture','Fixture browser','Fixture OS'))
        deliveries.configure_days('access',45)
        page=self.admin.get('/api/admin/audit',params={'page':0,'event':'login_failed','q':'Other fixture'}).json()
        self.assertEqual(page['total'],31);self.assertEqual(len(page['items']),25);self.assertEqual(page['days'],45)
        second=self.admin.get('/api/admin/audit',params={'page':1,'event':'login_failed','q':'Other fixture'}).json()
        self.assertEqual(len(second['items']),6)
        self.assertFalse({r['id'] for r in page['items']}&{r['id'] for r in second['items']})
        own=self.user.get('/api/audit',params={'page':0,'event':'login_failed'}).json()
        self.assertEqual(own['total'],31);self.assertTrue(all(r['user_id']==self.uid for r in own['items']))
        self.assertEqual(self.user.get('/api/audit',params={'page':0,'q':'Admin fixture'}).json()['total'],0)
        self.assertEqual(self.admin.get('/api/admin/audit',params={'page':0,'q':'%'}).json()['total'],0)
        self.assertEqual(self.admin.get('/api/admin/audit',params={'page':0,'start':now+1,'end':now}).status_code,422)
        self.assertEqual(self.user.get('/api/admin/audit',params={'page':0}).status_code,403)
        self.assertEqual(self.anon.get('/api/audit',params={'page':0}).status_code,401)
        self.assertIsInstance(self.admin.get('/api/admin/audit').json(),list)

    def test_disabled_sender_blocks_queued_message_before_any_attempt(self):
        self.insert('queued-before-disable',status='pending',owner=self.aid)
        with patch.object(mail,'delivery_settings',return_value={'enabled':False,'provider':'smtp'}),patch.object(mail,'transmit') as transmit:
            Monitor().send_one();transmit.assert_not_called()
        entry=deliveries.detail('queued-before-disable')
        self.assertEqual(entry['status'],'waiting_service');self.assertEqual(entry['attempts'],0)
        self.assertIsNotNone(entry['completed'])
        with patch.object(mail,'delivery_settings',return_value={'enabled':True,'provider':'smtp'}),patch.object(mail,'transmit') as transmit:
            Monitor().send_one();transmit.assert_not_called()
