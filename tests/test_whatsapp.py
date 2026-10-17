"""WhatsApp fixtures: private temp files and mocked transports; never real sends."""
import test_isolation  # noqa: F401 - first: temporary data, no seed, idle workers
import importlib
import io
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch,MagicMock
from urllib.error import HTTPError,URLError
from fastapi.testclient import TestClient
from backend import store,mail,whatsapp
from backend.domain import Search,Leg
from backend.engine import Monitor,persist_snapshots
from backend.integrations import WHATSAPP_PROVIDERS
from backend.integrations import openwa
from backend.integrations.base import IntegrationError


class WhatsAppTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();folder=Path(self.temp.name)
        self.patches=[patch.object(store,'DATA_DIR',folder),patch.object(mail,'DATA_DIR',folder),patch.object(mail,'SETTINGS_FILE',folder/'smtp.json')]
        for p in self.patches:p.start()
        store.setup(seed=False);self.module=importlib.import_module('backend.app');self.admin=TestClient(self.module.app);self.user=TestClient(self.module.app);self.anon=TestClient(self.module.app);self.headers={'x-radar-token':self.module.TOKEN}
        payload={'name':'Admin fixture','country':'US','phone':'6502530000','password':'fixture-password-only','emails':['fixture@example.org']}
        self.admin.post('/api/auth/bootstrap',json=payload,headers=self.headers)
        payload.update(name='User fixture',country='GB',phone='02079460018');self.uid=self.user.post('/api/auth/register',json=payload,headers=self.headers).json()['id']
        self.config={'provider':'openwa','enabled':True,'values':{'base_url':'https://fixture.example.org','session_id':'fixture-session','token':'fixture-private-token'}}
        self.provider=WHATSAPP_PROVIDERS['openwa']
    def tearDown(self):
        self.admin.close();self.user.close();self.anon.close()
        for p in reversed(self.patches):p.stop()
        self.temp.cleanup()
    def configure(self):
        response=self.admin.put('/api/admin/whatsapp',json=self.config,headers=self.headers);self.assertEqual(response.status_code,200,response.text);return response
    def queue(self,email=False,extra=False):
        self.configure()
        if extra:
            profile=self.user.get('/api/auth/session').json()['user'];profile['additional_phones']=[{'country':'GB','phone':'+442079460018'},{'country':'US','phone':'+12025550123'}];self.user.put('/api/profile',json=profile,headers=self.headers)
        search=Search(origins=['LHR'],destinations=['JFK'],outbound=Leg(start='2090-11-05T00:00',end='2090-11-05T23:59'),notify_email=email,notify_whatsapp=True,target_cents=200000)
        sid=self.user.post('/api/searches',json=search.model_dump(),headers=self.headers).json()['id']
        flight={'id':'fixture-flight','origin':'LHR','destination':'JFK','departure':'2090-11-05T12:00','arrival':'2090-11-05T15:00','duration_minutes':480,'stops':0,'layovers':[],'airlines':['British Airways'],'price_cents':100000,'adults':1,'currency':'GBP','collected_at':time.time(),'search_url':'https://example.org/flight'}
        with store.db() as c,patch.object(mail,'available',return_value=email):
            cid=c.execute("INSERT INTO cycles(search_id,version,started,status,total) VALUES(?,1,?,'done',1)",(sid,time.time())).lastrowid
            persist_snapshots(c,sid,1,cid,search,[{'direction':'outbound','status':'ok','flights':[flight]}])
        return sid
    def rows(self):
        with store.db() as c:return [dict(r) for r in c.execute('SELECT * FROM outbox ORDER BY channel,id')]
    def status(self):
        with store.db() as c:return c.execute('SELECT status FROM alerts LIMIT 1').fetchone()[0]
    def test_admin_acl_csrf_and_secret_never_returned(self):
        for client,code in [(self.user,403),(self.anon,401)]:
            self.assertEqual(client.get('/api/admin/whatsapp').status_code,code)
            self.assertEqual(client.put('/api/admin/whatsapp',json=self.config,headers=self.headers).status_code,code)
            self.assertEqual(client.post('/api/admin/whatsapp/check',json={},headers=self.headers).status_code,code)
            self.assertEqual(client.post('/api/admin/whatsapp/test',json={'country':'US','phone':'2025550123'},headers=self.headers).status_code,code)
        self.assertEqual(self.admin.put('/api/admin/whatsapp',json=self.config).status_code,403)
        response=self.configure();self.assertNotIn('fixture-private-token',response.text);self.assertTrue(response.json()['secrets_set']['token'])
        self.assertNotIn('fixture-private-token',self.admin.get('/api/admin/whatsapp').text);self.assertNotIn('fixture-private-token',self.user.get('/api/state').text)
        self.assertEqual(os.stat(store.DATA_DIR/'whatsapp-private.json').st_mode&0o777,0o600)
        self.assertTrue(self.user.get('/api/state').json()['whatsapp_available'])
    def test_token_preservation_and_identity_change_require_reentry(self):
        self.configure();same={**self.config,'values':{**self.config['values'],'token':''}}
        self.assertEqual(self.admin.put('/api/admin/whatsapp',json=same,headers=self.headers).status_code,200);self.assertEqual(whatsapp.settings()['values']['token'],'fixture-private-token')
        changed={**same,'values':{**same['values'],'base_url':'https://other.example.org'}}
        self.assertEqual(self.admin.put('/api/admin/whatsapp',json=changed,headers=self.headers).status_code,422)
        self.assertEqual(whatsapp.settings()['values']['base_url'],self.config['values']['base_url'])
    def test_registry_accepts_additional_provider_without_router_changes(self):
        fake=NS(id='fixture-provider',name='Fixture integrator',fields=[{'key':'account','secret':False,'default':'','label':'Account','type':'text'},{'key':'api_key','secret':True,'default':'','label':'API key','type':'password'}],normalize=lambda v:v)
        with patch.dict(WHATSAPP_PROVIDERS,{fake.id:fake}):
            r=self.admin.put('/api/admin/whatsapp',json={'provider':fake.id,'enabled':True,'values':{'account':'fixture','api_key':'another-private-fixture'}},headers=self.headers)
            self.assertEqual(r.status_code,200,r.text);self.assertNotIn('another-private-fixture',r.text);self.assertTrue(r.json()['available']);self.assertEqual(r.json()['values'],{'account':'fixture'});self.assertIn(fake.id,[p['id'] for p in r.json()['providers']])
    def test_invalid_config_is_rejected_without_secret_echo(self):
        for values in [{'base_url':'http://public.example.org'},{'base_url':'https://name:secret@example.org'},{'base_url':'https://example.org/?secret=1'},{'base_url':'https://example.org/api/docs'},{'token':'private\r\nheader'},{'session_id':'x'*201}]:
            r=self.admin.put('/api/admin/whatsapp',json={**self.config,'values':{**self.config['values'],**values}},headers=self.headers);self.assertEqual(r.status_code,422,values);self.assertNotIn('fixture-private-token',r.text)
        self.assertEqual(self.admin.put('/api/admin/whatsapp',json={**self.config,'provider':'unknown'},headers=self.headers).status_code,422)
    def test_check_uses_saved_settings_and_has_a_rate_limit(self):
        self.configure()
        with patch.object(self.provider,'check',return_value={'ready':True,'status':'ready'}) as check:
            result=self.admin.post('/api/admin/whatsapp/check',json={},headers=self.headers);self.assertTrue(result.json()['ready']);self.assertEqual(check.call_args.args[0]['session_id'],'fixture-session')
            self.assertEqual(self.admin.post('/api/admin/whatsapp/check',json={},headers=self.headers).status_code,429);self.assertEqual(check.call_count,1)
    def test_test_message_is_queued_and_throttled_without_transmission(self):
        self.configure()
        with patch.object(self.provider,'send') as send:
            r=self.admin.post('/api/admin/whatsapp/test',json={'country':'US','phone':'2025550123'},headers=self.headers);self.assertEqual(r.status_code,200,r.text);self.assertEqual(self.rows()[0]['status'],'pending');self.assertEqual(self.rows()[0]['kind'],'test');self.assertEqual(self.rows()[0]['channel'],'whatsapp');send.assert_not_called()
            self.assertEqual(self.admin.post('/api/admin/whatsapp/test',json={'country':'US','phone':'2025550123'},headers=self.headers).status_code,429)
    def test_contacts_are_deduplicated_and_independent_rows_record_acceptance(self):
        self.queue(extra=True);rows=self.rows();self.assertEqual(len(rows),2);self.assertEqual({json.loads(r['recipients'])[0] for r in rows},{'+442079460018','+12025550123'})
        with patch.object(self.provider,'send',return_value='provider-fixture-id') as send:
            whatsapp.send_one();self.assertEqual(self.status(),'queued');whatsapp.send_one();self.assertEqual(self.status(),'sent');whatsapp.send_one();self.assertEqual(send.call_count,2)
        self.assertTrue(all(r['provider_message_id']=='provider-fixture-id' and r['attempts']==1 for r in self.rows()))
        logs=self.admin.get('/api/admin/deliveries',params={'channel':'whatsapp'}).json();self.assertEqual(logs['total'],2)
    def test_email_failure_does_not_overwrite_successful_whatsapp(self):
        self.queue(email=True)
        with patch.object(self.provider,'send',return_value='fixture-id'):whatsapp.send_one()
        self.assertEqual(self.status(),'queued')
        with patch.object(mail,'delivery_settings',return_value={'enabled':True,'provider':'smtp'}),patch.object(mail,'transmit',side_effect=RuntimeError('private server details')):Monitor().send_one()
        self.assertEqual(self.status(),'partial');self.assertEqual({r['status'] for r in self.rows()},{'sent','failed'})
        data=self.user.get('/api/activity',params={'status':'failed'}).json();self.assertEqual(data['items'][0]['status'],'partial')
    def test_uncertain_send_is_never_automatically_retried(self):
        self.queue()
        with patch.object(self.provider,'send',side_effect=IntegrationError('Não foi possível confirmar a operação no WhatsApp',True)) as send:
            whatsapp.send_one();whatsapp.send_one();self.assertEqual(send.call_count,1)
        self.assertEqual(self.rows()[0]['status'],'uncertain');self.assertEqual(self.status(),'uncertain')
    def test_stop_requested_while_waiting_for_the_locks_claims_nothing(self):
        # Monitor.stop comes while send_one waits for the write lock, already past whatsapp.LOCK: the message stays queued.
        self.queue();stop,reached,read=threading.Event(),threading.Event(),whatsapp.settings
        def settings():
            reached.set();return read()
        worker=threading.Thread(target=whatsapp.send_one,args=(stop,))
        with patch.object(whatsapp,'settings',side_effect=settings),patch.object(self.provider,'send',return_value='fixture-id') as send:
            try:
                with store.db() as blocker:
                    # Another writer holds the lock: send_one takes whatsapp.LOCK, reads settings, then waits in BEGIN IMMEDIATE.
                    blocker.execute('BEGIN IMMEDIATE');worker.start()
                    self.assertTrue(reached.wait(5));worker.join(.2);self.assertTrue(worker.is_alive());stop.set()
            finally:
                stop.set()
                if worker.is_alive():worker.join(5)
            self.assertFalse(worker.is_alive());send.assert_not_called();self.assertEqual(self.rows()[0]['status'],'pending')
            # Not stopping: the same message is claimed and sent.
            whatsapp.send_one(threading.Event());self.assertEqual(send.call_count,1);self.assertEqual(self.rows()[0]['status'],'sent')
    def test_partial_recipient_failure_does_not_resend_accepted_messages(self):
        self.queue(extra=True)
        with patch.object(self.provider,'send',side_effect=['accepted-fixture',IntegrationError('Sessão WhatsApp inativa ou requisição recusada')]) as send:
            whatsapp.send_one();whatsapp.send_one();whatsapp.send_one();self.assertEqual(send.call_count,2)
        self.assertEqual(self.status(),'partial');self.assertEqual({r['status'] for r in self.rows()},{'sent','failed'})
    def test_session_switch_cancels_old_queue_instead_of_redirecting_it(self):
        self.queue();updated={**self.config,'values':{**self.config['values'],'session_id':'different-session'}}
        response=self.admin.put('/api/admin/whatsapp',json=updated,headers=self.headers);self.assertEqual(response.status_code,200,response.text)
        with patch.object(self.provider,'send') as send:whatsapp.send_one();send.assert_not_called()
        self.assertEqual(self.rows()[0]['status'],'cancelled')

    def test_disabling_integration_cancels_pending_messages(self):
        self.queue();data={**self.config,'enabled':False};self.admin.put('/api/admin/whatsapp',json=data,headers=self.headers)
        with patch.object(self.provider,'send') as send:whatsapp.send_one();send.assert_not_called()
        self.assertEqual(self.rows()[0]['status'],'cancelled')
    def test_paused_and_changed_recipient_never_receive_queued_alerts(self):
        sid=self.queue();self.user.post('/api/searches/'+sid+'/action',json={'action':'pause'},headers=self.headers)
        with patch.object(self.provider,'send') as send:whatsapp.send_one();send.assert_not_called()
        self.assertEqual(self.rows()[0]['status'],'cancelled')
        self.user.post('/api/searches/'+sid+'/action',json={'action':'resume'},headers=self.headers)
        with store.db() as c:c.execute("UPDATE outbox SET status='pending',completed=NULL")
        profile=self.user.get('/api/auth/session').json()['user'];profile.update(whatsapp_use_login=False,whatsapp_country='US',whatsapp_phone='2025550123');self.user.put('/api/profile',json=profile,headers=self.headers)
        with patch.object(self.provider,'send') as send:whatsapp.send_one();send.assert_not_called()
        self.assertEqual(self.rows()[0]['status'],'cancelled')
    def test_expiry_silence_and_restart_hold(self):
        self.queue()
        with store.db() as c:c.execute('UPDATE outbox SET created=?,next_due=?',(time.time()-1900,time.time()-1900))
        with patch.object(self.provider,'send') as send:whatsapp.send_one();send.assert_not_called()
        self.assertEqual(self.rows()[0]['status'],'expired')
        with store.db() as c:c.execute("UPDATE outbox SET status='pending',created=?,completed=NULL",(time.time(),))
        with patch.object(accounts_fixture(),'search_is_quiet',return_value=True),patch.object(self.provider,'send') as send:whatsapp.send_one();send.assert_not_called()
        # Held, not silenced: still pending, due when the quiet hours end.
        self.assertEqual(self.rows()[0]['status'],'pending');self.assertGreater(self.rows()[0]['next_due'],time.time())
        with patch.object(self.provider,'send') as send:whatsapp.send_one();send.assert_not_called()
        with store.db() as c:c.execute('UPDATE outbox SET next_due=?',(time.time(),))
        with patch.object(self.provider,'send',return_value='fixture-id') as send:whatsapp.send_one();send.assert_called_once()
        self.assertEqual(self.rows()[0]['status'],'sent')
        with store.db() as c:c.execute("UPDATE outbox SET status='pending',created=?,next_due=?,completed=NULL,sent=NULL",(time.time(),time.time()))
        with store.db() as c:c.execute("UPDATE outbox SET status='sending',completed=NULL")
        store.setup(seed=False)
        with patch.object(self.provider,'send') as send:whatsapp.send_one();send.assert_not_called()
        self.assertEqual(self.rows()[0]['status'],'uncertain')


def accounts_fixture():
    from backend import accounts
    return accounts


class OpenWAHTTPTests(unittest.TestCase):
    def setUp(self):self.provider=openwa.OpenWA();self.values={'base_url':'https://example.org','session_id':'fixture/session','token':'private-fixture-token'}
    def response(self,status,data):
        response=MagicMock();response.status=status;response.read.return_value=json.dumps(data).encode();response.__enter__.return_value=response;return response
    def test_text_endpoint_headers_payload_and_acceptance_id(self):
        opener=MagicMock();opener.open.return_value=self.response(201,{'messageId':'fixture-message','timestamp':1})
        with patch.object(openwa,'build_opener',return_value=opener):self.assertEqual(self.provider.send(self.values,'+12025550123','Fixture text'),'fixture-message')
        request=opener.open.call_args.args[0];self.assertEqual(request.full_url,'https://example.org/api/sessions/fixture%2Fsession/messages/send-text');self.assertEqual(json.loads(request.data),{'chatId':'12025550123@c.us','text':'Fixture text'});self.assertEqual(request.get_header('X-api-key'),'private-fixture-token');self.assertEqual(opener.open.call_args.kwargs['timeout'],12)
    def test_errors_never_expose_server_response_and_timeouts_are_uncertain(self):
        for exc,uncertain in [(HTTPError('https://example.org',401,'token private-fixture-token',{},io.BytesIO(b'private-fixture-token')),False),(HTTPError('https://example.org',500,'private-fixture-token',{},io.BytesIO()),True),(URLError('private-fixture-token'),True)]:
            with patch.object(openwa,'build_opener') as build:
                build.return_value.open.side_effect=exc
                with self.assertRaises(IntegrationError) as caught:self.provider.send(self.values,'+12025550123','Fixture')
                self.assertEqual(caught.exception.uncertain,uncertain);self.assertNotIn('private-fixture-token',str(caught.exception))
    def test_invalid_success_is_uncertain_and_redirects_are_not_followed(self):
        with patch.object(openwa,'build_opener') as build:
            build.return_value.open.return_value=self.response(201,{'unexpected':'ok'})
            with self.assertRaises(IntegrationError) as caught:self.provider.send(self.values,'+12025550123','Fixture')
            self.assertTrue(caught.exception.uncertain)
        self.assertIsNone(openwa.NoRedirect().redirect_request(None,None,None,None,None,None))
    def test_session_check_validates_identity_and_state(self):
        with patch.object(self.provider,'_request',return_value=(200,{'id':'fixture/session','status':'ready'})):self.assertTrue(self.provider.check(self.values)['ready'])
        with patch.object(self.provider,'_request',return_value=(200,{'id':'other-session','status':'ready'})):
            with self.assertRaises(IntegrationError):self.provider.check(self.values)
