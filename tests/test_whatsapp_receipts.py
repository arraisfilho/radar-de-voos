"""Signed receipt fixtures; isolated databases and no network transports."""
import hashlib
import hmac
import importlib
import json
import os
import tempfile
import time
import unittest
from datetime import datetime,timezone
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend import store,mail,whatsapp,whatsapp_receipts as receipts,notifications,revisions,deliveries
from backend.domain import Search,Leg


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.folder=Path(self.temp.name)
        self.patches=[patch.object(store,'DATA_DIR',self.folder),patch.object(mail,'DATA_DIR',self.folder),patch.object(mail,'SETTINGS_FILE',self.folder/'smtp.json'),patch.dict(os.environ,{'RADAR_DEPLOYMENT':'local'})]
        for item in self.patches:item.start()
        store.setup(seed=False);self.app=importlib.import_module('backend.app');self.client=TestClient(self.app.app);self.admin=TestClient(self.app.app)
        self.headers={'x-radar-token':self.app.TOKEN}
        self.uid=self.admin.post('/api/auth/bootstrap',json={'name':'Receipt fixture','country':'US','phone':'2025550123','password':'fixture-password-only'},headers=self.headers).json()['id']
        self.config={'provider':'openwa','enabled':True,'values':{'base_url':'https://fixture.example.org','session_id':'receipt-session','token':'fixture-api-key'}}
        whatsapp.save(whatsapp.Settings(**self.config));self.secret='fixture-webhook-secret-32-characters'
        receipts.save(True,self.secret)
    def tearDown(self):
        self.client.close();self.admin.close()
        for item in reversed(self.patches):item.stop()
        self.temp.cleanup()
    def row(self,oid='delivery',mid='fixture-message',status='sent',channel='whatsapp',binding=None,search_id=None,owner=None):
        with store.db() as c:
            c.execute('''INSERT INTO outbox(id,search_id,version,created,alert_ids,subject,body,status,next_due,recipients,channel,provider,transport_ref,provider_message_id,owner_id,attempts)
              VALUES(?,?,1,?,'[]','Receipt fixture','Fixture content',?,?,?,?,'openwa',?,?,?,1)''',(oid,search_id,time.time(),status,time.time(),json.dumps(['+12025550123']),channel,binding or whatsapp.reference(self.config),mid,owner or self.uid))
    def record(self,oid='delivery'):
        with store.db() as c:return dict(c.execute('SELECT * FROM outbox WHERE id=?',(oid,)).fetchone())
    def event(self,state='read',mid='fixture-message',**overrides):
        p={'event':'message.ack','sessionId':'receipt-session','timestamp':datetime.now(timezone.utc).isoformat(),'data':{'id':mid,'messageId':mid,'status':state}}
        p.update(overrides);return p
    def post(self,payload,secret=None,raw=None):
        body=raw if raw is not None else json.dumps(payload,separators=(',',':')).encode()
        signature='sha256='+hmac.new((secret or self.secret).encode(),body,hashlib.sha256).hexdigest()
        return self.client.post(receipts.PATH,content=body,headers={'content-type':'application/json','x-openwa-signature':signature})
    def test_signature_and_csrf_are_separate_and_secrets_stay_private(self):
        self.row();self.assertEqual(self.post(self.event(),secret='wrong-key').status_code,403)
        self.assertEqual(self.client.post(receipts.PATH,json=self.event(),headers=self.headers).status_code,403)
        self.assertIsNone(self.record()['receipt_status'])
        self.assertEqual(self.client.put('/api/admin/whatsapp/receipts',json={'enabled':False}).status_code,403)
        self.assertEqual(self.client.get('/api/admin/whatsapp/receipts').status_code,401)
        info=self.admin.get('/api/admin/whatsapp/receipts');self.assertEqual(info.status_code,200);self.assertNotIn(self.secret,info.text)
        self.assertTrue(info.json()['active']);self.assertEqual((self.folder/'whatsapp-receipts-private.json').stat().st_mode&0o777,0o600)
        self.assertEqual(self.post(self.event(),raw=json.dumps(self.event(),indent=2).encode()).status_code,200)
    def test_receipts_advance_without_retries_or_regressions(self):
        self.row()
        for state in ['sent','delivered','read','read','sent','delivered','failed']:
            self.assertEqual(self.post(self.event(state)).status_code,200)
        row=self.record();self.assertEqual(row['receipt_status'],'read');self.assertTrue(row['delivered_at']);self.assertTrue(row['read_at']);self.assertIsNone(row['receipt_failed_at'])
        self.assertEqual(row['status'],'sent');self.assertEqual(row['attempts'],1)
        before=row['read_at'];self.post(self.event());self.assertEqual(self.record()['read_at'],before)
    def test_read_first_does_not_invent_delivery_time_and_failure_is_distinct(self):
        self.row();self.post(self.event());row=self.record();self.assertIsNone(row['delivered_at']);self.assertTrue(row['read_at'])
        self.row('failed','failed-message');self.post(self.event('failed','failed-message',event='message.failed'))
        row=self.record('failed');self.assertEqual(row['receipt_status'],'failed');self.assertEqual(row['status'],'sent')
        self.post(self.event('sent','failed-message'));self.assertEqual(self.record('failed')['receipt_status'],'failed')
        self.post(self.event('delivered','failed-message'));self.assertEqual(self.record('failed')['receipt_status'],'delivered')
    def test_unknown_messages_sessions_and_changed_identity_never_match(self):
        self.row();self.row('email','same-email',channel='email');self.row('old','old-message',binding='previous-integration')
        self.assertEqual(self.post(self.event(sessionId='another-session')).status_code,422)
        for mid in ['unknown-message','same-email','old-message']:self.assertEqual(self.post(self.event(mid=mid)).status_code,200)
        for oid in ['delivery','email','old']:self.assertIsNone(self.record(oid)['receipt_status'])
        with store.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM whatsapp_receipt_inbox').fetchone()[0],0)
        self.config['values']['session_id']='new-session';whatsapp.save(whatsapp.Settings(**self.config))
        self.assertFalse(receipts.public_settings()['active']);self.assertEqual(self.post(self.event()).status_code,403)
        self.assertEqual(self.admin.put('/api/admin/whatsapp/receipts',json={'enabled':True},headers=self.headers).status_code,422)
    def test_early_receipt_is_durable_and_reconciles_after_send_response(self):
        self.row(mid=None,status='pending');provider=whatsapp.WHATSAPP_PROVIDERS['openwa']
        def send(*args):
            self.assertEqual(self.post(self.event()).status_code,200)
            with store.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM whatsapp_receipt_inbox').fetchone()[0],1)
            return 'fixture-message'
        with patch.object(provider,'send',side_effect=send) as transport:
            whatsapp.send_one();whatsapp.send_one();self.assertEqual(transport.call_count,1)
        row=self.record();self.assertEqual(row['status'],'sent');self.assertEqual(row['receipt_status'],'read')
        with store.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM whatsapp_receipt_inbox').fetchone()[0],0)
    def test_payload_limits_invalid_states_and_legacy_ack(self):
        self.row()
        for data in [{'id':'fixture-message','status':'invented'},{'id':'a','messageId':'b','status':'read'},{'id':'fixture-message','ack':True}]:
            self.assertEqual(self.post(self.event(data=data)).status_code,422)
        self.assertEqual(self.post(self.event('read',event='message.failed')).status_code,422)
        self.assertEqual(self.post(self.event(timestamp='tomorrow')).status_code,422)
        self.assertEqual(self.post(self.event(),raw=b'x'*(receipts.MAX_BODY+1)).status_code,413)
        self.assertEqual(self.post(self.event(data={'messageId':'fixture-message','ack':3})).status_code,200)
        self.assertEqual(self.record()['receipt_status'],'read')
    def test_disabled_receiver_and_secret_rotation(self):
        self.row();receipts.save(False,'');self.assertEqual(self.post(self.event()).status_code,403)
        receipts.save(True,'');self.assertEqual(self.post(self.event('sent')).status_code,200)
        new='another-fixture-secret-with-32-chars';receipts.save(True,new)
        self.assertEqual(self.post(self.event()).status_code,403);self.assertEqual(self.post(self.event(),secret=new).status_code,200)
    def test_inbox_is_bounded_expired_and_deleted_messages_stay_deleted(self):
        self.row(mid=None,status='sending')
        with patch.object(receipts,'INBOX_LIMIT',1):
            self.assertEqual(self.post(self.event(mid='one')).status_code,200)
            self.assertEqual(self.post(self.event(mid='two')).status_code,503)
            with store.db() as c:c.execute('UPDATE whatsapp_receipt_inbox SET received=?',(time.time()-receipts.INBOX_TTL-1,))
            self.assertEqual(self.post(self.event(mid='two')).status_code,200)
        with store.db() as c:c.execute("DELETE FROM outbox WHERE id='delivery'")
        self.assertEqual(self.post(self.event()).status_code,200)
        with store.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM outbox').fetchone()[0],0)
    def test_owner_scoped_counts_revisions_and_admin_filters(self):
        with store.db() as c:
            sid=store.add_search(c,Search(origins=['LHR'],destinations=['JFK'],outbound=Leg(start='2090-11-05T00:00',end='2090-11-05T23:59')),self.uid)
            cid=c.execute("INSERT INTO cycles(search_id,version,started,status,total) VALUES(?,1,?,'done',1)",(sid,time.time())).lastrowid
            c.execute("INSERT INTO alerts(id,search_id,version,cycle_id,direction,created,kind,price,payload,status) VALUES('alert',?,1,?,'outbound',?,'target',10000,'{}','sent')",(sid,cid,time.time()))
        self.row(search_id=sid)
        with store.db() as c:
            notifications.link(c,'delivery',['alert']);before=revisions.token(c,self.uid,'fixture',{})
        self.post(self.event())
        with store.db() as c:
            self.assertNotEqual(before,revisions.token(c,self.uid,'fixture',{}))
            self.assertEqual(notifications.channel_summaries(c,self.uid,['alert'])['alert'][0]['receipts'],{'read':1})
            self.assertEqual(notifications.channel_summaries(c,'other-user',['alert']),{})
        self.assertEqual(deliveries.list_items({'status':'read'})['total'],1)
        self.assertEqual(deliveries.list_items({'status':'delivered'})['total'],1)
        self.assertEqual(deliveries.list_items({'status':'delivery_failed'})['total'],0)

    def test_public_receiver_requires_the_configured_https_origin(self):
        self.row()
        with patch.dict(os.environ,{'RADAR_DEPLOYMENT':'public','RADAR_PUBLIC_URL':'https://radar.example.org'}):
            body=json.dumps(self.event()).encode();signature='sha256='+hmac.new(self.secret.encode(),body,hashlib.sha256).hexdigest()
            for origin,expected in [('https://radar.example.org',200),('http://radar.example.org',403),('https://other.example.org',403)]:
                client=TestClient(self.app.app,base_url=origin)
                try:self.assertEqual(client.post(receipts.PATH,content=body,headers={'x-openwa-signature':signature}).status_code,expected)
                finally:client.close()

    def test_migration_preserves_receipts_and_non_admin_cannot_configure(self):
        self.row();self.post(self.event());store.setup(seed=False);self.assertEqual(self.record()['receipt_status'],'read')
        payload={'name':'Regular fixture','country':'GB','phone':'02079460018','password':'fixture-password-only'}
        self.client.post('/api/auth/register',json=payload,headers=self.headers)
        self.assertEqual(self.client.get('/api/admin/whatsapp/receipts').status_code,403)
        self.assertEqual(self.client.put('/api/admin/whatsapp/receipts',json={'enabled':False},headers=self.headers).status_code,403)

    def test_ambiguous_provider_id_cannot_confirm_an_arbitrary_recipient(self):
        self.row();self.row('duplicate')
        self.assertEqual(self.post(self.event()).status_code,200)
        self.assertIsNone(self.record()['receipt_status'])
        self.assertIsNone(self.record('duplicate')['receipt_status'])
