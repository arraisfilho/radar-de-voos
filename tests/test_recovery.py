"""Password recovery by code, by WhatsApp or e-mail: temporary data and mocked transports, never real sends."""
import test_isolation  # noqa: F401 - first: temporary data, no seed, idle workers
import hashlib
import hmac
import importlib
import json
import re
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import HTTPException
from fastapi.testclient import TestClient
from backend import store,mail,accounts,whatsapp,recovery,deliveries
from backend.engine import Monitor
from backend.integrations import WHATSAPP_PROVIDERS

LOGIN={'country':'US','phone':'6502530000'}
PASSWORD='old-fixture-password'


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.folder=Path(self.temp.name)
        self.patches=[patch.object(store,'DATA_DIR',self.folder),patch.object(mail,'DATA_DIR',self.folder),patch.object(mail,'SETTINGS_FILE',self.folder/'smtp-private.json'),
                      patch.object(mail,'available',return_value=True)]
        for p in self.patches:p.start()
        store.setup(seed=False);self.module=importlib.import_module('backend.app');self.headers={'x-radar-token':self.module.TOKEN};self.clients=[]
        self.client=self.open()
        r=self.client.post('/api/auth/register',json={**LOGIN,'name':'Fixture','password':PASSWORD,'emails':['first@example.org','second@example.org']},headers=self.headers)
        self.assertEqual(r.status_code,200,r.text);self.user=r.json()
        whatsapp.save(whatsapp.Settings(provider='openwa',enabled=True,values={'base_url':'https://fixture.example.org','session_id':'fixture-session','token':'fixture-private-token'}))
        self.provider=WHATSAPP_PROVIDERS['openwa']
    def tearDown(self):
        for client in self.clients:client.close()
        for p in reversed(self.patches):p.stop()
        self.temp.cleanup()
    def open(self,address='127.0.0.1'):
        client=TestClient(self.module.app,base_url='http://127.0.0.1:8765',client=(address,5000));self.clients.append(client);return client
    def request(self,channel='whatsapp',client=None,language=None,**login):
        r=(client or self.open('127.0.0.2')).post('/api/auth/recovery',json={**LOGIN,**login,'channel':channel},headers={**self.headers,**({'x-radar-language':language} if language else {})})
        self.assertEqual((r.status_code,r.json()),(200,{'ok':True}),r.text)
    def rows(self,sql='SELECT * FROM outbox ORDER BY created,rowid',*args):
        with store.db() as c:return [dict(r) for r in c.execute(sql,args)]
    def code(self,row=None):
        return re.search(r'\b(\d{6})\b',(row or self.rows()[-1])['body']).group(1)
    def confirm(self,code,password='new-fixture-password',address='127.0.0.3',**login):
        return self.open(address).post('/api/auth/recovery/confirm',json={**LOGIN,**login,'code':code,'password':password},headers=self.headers)
    def wrong(self,code):
        return next(value for value in ('000000','111111','222222','333333') if value!=code)
    def age(self,seconds):
        """Moves every code and its message back in time."""
        with store.db() as c:
            c.execute('UPDATE password_resets SET created=created-?,expires=expires-?',(seconds,seconds))
            c.execute("UPDATE outbox SET created=created-?,next_due=next_due-? WHERE kind='recovery'",(seconds,seconds))

    def test_same_answer_for_unknown_phones_unavailable_channels_and_missing_contacts(self):
        self.request(phone='2025550123');self.request(phone='invalid')
        with patch.object(mail,'available',return_value=False):self.request('email')
        with patch.object(whatsapp,'available',return_value=False):self.request('whatsapp')
        profile=self.client.get('/api/auth/session').json()['user']
        self.assertEqual(self.client.put('/api/profile',json={**profile,'emails':[]},headers=self.headers).status_code,200)
        self.request('email',client=self.open('127.0.0.4'))
        self.assertEqual(self.rows(),[]);self.assertEqual(self.rows('SELECT * FROM password_resets'),[])
        r=self.client.post('/api/auth/recovery',json={**LOGIN,'channel':'sms'},headers=self.headers);self.assertEqual(r.status_code,422)
        # A confirmation for an unknown phone gets the same refusal as a wrong code.
        self.assertEqual(self.confirm('123456',phone='2025550123').json()['detail'],recovery.WRONG_CODE)

    def test_code_goes_by_the_chosen_channel_in_the_language_of_the_request(self):
        self.request('whatsapp',language='en')
        row=self.rows()[-1];code=self.code(row)
        self.assertEqual((row['channel'],row['kind'],row['status'],row['owner_id'],json.loads(row['recipients'])),('whatsapp','recovery','pending',self.user['id'],['+16502530000']))
        self.assertEqual(row['body'],recovery.TEXT['en'].format(code=code));self.assertEqual(row['subject'],recovery.SUBJECT['en']);self.assertIsNone(row['search_id'])
        saved=self.rows('SELECT * FROM password_resets')[-1]
        self.assertEqual((saved['channel'],saved['attempts'],saved['used'],saved['outbox_id']),('whatsapp',0,0,row['id']))
        self.assertAlmostEqual(saved['expires']-saved['created'],600)
        # A keyed hash bound to the account and the request; the secret stays in a private file.
        secret=bytes.fromhex(json.loads((self.folder/recovery.SECRET_FILE).read_text())['secret'])
        self.assertEqual(saved['digest'],hmac.new(secret,('recovery:'+self.user['id']+':'+row['id']+':'+code).encode(),hashlib.sha256).hexdigest())
        self.assertNotIn(code,json.dumps(saved));self.assertEqual((self.folder/recovery.SECRET_FILE).stat().st_mode&0o777,0o600)
        self.age(61);self.request('email')
        row=self.rows()[-1];self.assertEqual((row['channel'],row['kind'],json.loads(row['recipients'])),('email','recovery',['first@example.org']))
        self.assertEqual(row['body'],recovery.TEXT['pt'].format(code=self.code(row)))
        # The WhatsApp number of the profile, not the login, when they differ; never an additional number.
        profile=self.client.get('/api/auth/session').json()['user']
        changed={**profile,'whatsapp_use_login':False,'whatsapp_country':'US','whatsapp_phone':'2025550144','additional_phones':[{'country':'US','phone':'2025550155'}]}
        self.assertEqual(self.client.put('/api/profile',json=changed,headers=self.headers).status_code,200)
        self.age(61);self.request('whatsapp',client=self.open('127.0.0.5'))
        self.assertEqual(json.loads(self.rows()[-1]['recipients']),['+12025550144'])
        events=self.rows("SELECT details FROM access_audit WHERE event='recovery_requested' ORDER BY id")
        self.assertEqual([json.loads(e['details'])['channel'] for e in events],['whatsapp','email','whatsapp'],'One audit row per channel')

    def test_recovery_messages_are_sent_at_once_even_in_quiet_hours_and_stay_hidden(self):
        profile=self.client.get('/api/auth/session').json()['user']
        self.client.put('/api/profile',json={**profile,'quiet_hours':True},headers=self.headers)
        with patch('backend.accounts.search_is_quiet',return_value=True),patch('backend.accounts.is_quiet',return_value=True):
            self.request('whatsapp');chat=self.rows()[-1]['body']
            with patch.object(self.provider,'send',return_value='fixture-id') as send:whatsapp.send_one()
            self.age(61);self.request('email');mailed=self.rows()[-1]['body']
            with patch.object(mail,'delivery_settings',return_value={'enabled':True}),patch.object(mail,'transmit') as transmit:Monitor().send_one()
        send.assert_called_once();transmit.assert_called_once()
        rows=self.rows();self.assertEqual([r['status'] for r in rows],['sent','sent'])
        self.assertEqual(send.call_args.args[1:],('+16502530000',chat));self.assertEqual(transmit.call_args.args[0]['recipient'],['first@example.org']);self.assertEqual(transmit.call_args.args[3],mailed)
        # Once sent, the code is gone from the queue; the logs still show the deliveries.
        self.assertEqual([r['body'] for r in rows],['',''])
        for row in rows:
            detail=deliveries.detail(row['id']);self.assertTrue(detail['content_protected']);self.assertIsNone(detail['body']);self.assertEqual(detail['status'],'sent')
        listing=deliveries.list_items({});self.assertEqual(listing['total'],2);self.assertNotIn(self.code({'body':mailed}),json.dumps(listing))

    def test_recovery_messages_expire_with_the_code(self):
        self.request('whatsapp');self.age(61);self.request('email');self.age(601)
        with store.db() as c:c.execute("UPDATE outbox SET status='pending'")
        with patch.object(self.provider,'send') as send,patch.object(mail,'delivery_settings',return_value={'enabled':True}),patch.object(mail,'transmit') as transmit:
            whatsapp.send_one();Monitor().send_one()
        send.assert_not_called();transmit.assert_not_called()
        self.assertEqual([r['status'] for r in self.rows()],['expired','expired'])

    def test_the_code_leaves_the_queue_with_the_message(self):
        self.request('whatsapp');first=self.rows()[-1]
        self.age(61);self.request('email');second=self.rows()[-1]
        self.assertEqual(self.rows('SELECT status,body FROM outbox WHERE id=?',first['id']),[{'status':'cancelled','body':''}],'Replaced')
        with patch.object(mail,'delivery_settings',return_value={'enabled':True}),patch.object(mail,'transmit',side_effect=RuntimeError('fixture failure')):Monitor().send_one()
        self.assertEqual(self.rows('SELECT status,body FROM outbox WHERE id=?',second['id']),[{'status':'failed','body':''}],'Failed')
        self.age(61);self.request('whatsapp',client=self.open('127.0.0.10'));self.age(601)
        with patch.object(self.provider,'send') as send:whatsapp.send_one()
        send.assert_not_called();self.assertEqual([r['body'] for r in self.rows()],['','',''],'Expired')
        self.age(61);self.request('whatsapp',client=self.open('127.0.0.11'));third=self.rows()[-1];self.assertNotEqual(third['body'],'')
        with patch.object(self.provider,'send',side_effect=RuntimeError('fixture timeout')):whatsapp.send_one()
        self.assertEqual(self.rows('SELECT status,body FROM outbox WHERE id=?',third['id']),[{'status':'uncertain','body':''}],'Unconfirmed')
        detail=deliveries.detail(third['id']);self.assertEqual((detail['body'],detail['content_protected'],detail['channel']),(None,True,'whatsapp'))
        # Rows that ended before the upgrade are emptied when it runs; pending ones keep the code to be sent.
        with store.db() as c:
            c.execute("UPDATE outbox SET body='Seu código é 123456' WHERE id=?",(first['id'],))
            c.execute("INSERT INTO outbox(id,created,alert_ids,subject,body,status,next_due,owner_id,kind) VALUES('queued',?,'[]','Reset','Seu código é 654321','pending',?,?,'recovery')",(time.time(),time.time(),self.user['id']))
            deliveries.setup(c)
        self.assertEqual(self.rows('SELECT id,body FROM outbox WHERE id IN (?,?) ORDER BY id',first['id'],'queued'),sorted([{'id':first['id'],'body':''},{'id':'queued','body':'Seu código é 654321'}],key=lambda r:r['id']))

    def test_recovery_messages_go_ahead_of_the_queue(self):
        now=time.time();config=whatsapp.settings()
        with store.db() as c:
            for channel in ('email','whatsapp'):
                c.execute("INSERT INTO outbox(id,created,alert_ids,subject,body,status,next_due,recipients,owner_id,channel,provider,transport_ref,kind) VALUES(?,?,'[]','Teste','Older fixture','pending',?,?,?,?,?,?,'test')",
                          ('older-'+channel,now-120,now-120,json.dumps(['+16502530000' if channel=='whatsapp' else 'first@example.org']),self.user['id'],channel,config['provider'],whatsapp.reference(config)))
        self.request('email');oid=self.rows("SELECT id FROM outbox WHERE kind='recovery'")[-1]['id']
        with patch.object(mail,'delivery_settings',return_value={'enabled':True}),patch.object(mail,'transmit') as transmit:Monitor().send_one()
        self.assertEqual(transmit.call_args.args[1],oid)
        self.age(61);self.request('whatsapp');body=self.rows("SELECT body FROM outbox WHERE kind='recovery' AND status='pending'")[-1]['body']
        with patch.object(self.provider,'send',return_value='fixture-id') as send:whatsapp.send_one()
        self.assertEqual(send.call_args.args[2],body)
        self.assertEqual(self.rows("SELECT status FROM outbox WHERE id LIKE 'older-%' ORDER BY id"),[{'status':'pending'},{'status':'pending'}])

    def test_a_busy_server_gives_the_try_back(self):
        self.request('email');code=self.code()
        with patch.object(accounts,'hash_password',side_effect=HTTPException(503,accounts.BUSY,headers={'Retry-After':'5'})):
            r=self.confirm(code);self.assertEqual(r.status_code,503)
        self.assertEqual(self.rows('SELECT attempts,used FROM password_resets'),[{'attempts':0,'used':0}])
        _,key=accounts.login_key(accounts.Login(**LOGIN,password='x'))
        self.assertEqual(self.rows('SELECT * FROM login_attempts WHERE account=?',key),[],'Not a failed login either')
        self.assertEqual(self.confirm(code).status_code,200)

    def test_ipv6_requests_count_by_their_64_prefix(self):
        # Called directly: the local server only accepts loopback clients.
        def ask(host,phone=LOGIN['phone']):
            request=SimpleNamespace(client=SimpleNamespace(host=host),headers={})
            self.assertEqual(recovery.request_reset(request,recovery.RecoveryRequest(country='US',phone=phone,channel='email')),{'ok':True})
        for index in range(5):ask('2001:db8:1:2::%x'%(index+1),'2025550123')
        ask('2001:db8:1:2:ffff::9')
        self.assertEqual(self.rows(),[],'The sixth address of the /64 is limited')
        self.assertEqual({r['ip'] for r in self.rows('SELECT ip FROM recovery_attempts')},{'2001:db8:1:2::/64'})
        ask('2001:db8:1:3::1');self.assertEqual(len(self.rows()),1,'Another /64 is not')

    def test_confirmation_sets_the_password_ends_sessions_and_lifts_the_lock(self):
        self.request('whatsapp');code=self.code();self.assertIsNotNone(self.client.get('/api/auth/session').json()['user'])
        other=self.open('127.0.0.9')
        for _ in range(4):self.assertEqual(other.post('/api/auth/login',json={**LOGIN,'password':'wrong-fixture-password'},headers=self.headers).status_code,401)
        r=self.confirm(' '+code[:3]+' '+code[3:]+' ');self.assertEqual((r.status_code,r.json()),(200,{'ok':True}),r.text)
        self.assertIsNone(self.client.get('/api/auth/session').json()['user'],'Every session ends')
        _,key=accounts.login_key(accounts.Login(**LOGIN,password='x'))
        self.assertEqual(self.rows('SELECT * FROM login_attempts WHERE account=?',key),[],'The login failures of the account are gone')
        self.assertEqual(self.rows('SELECT used FROM password_resets'),[{'used':1}]);self.assertEqual(self.rows()[-1]['status'],'cancelled','The unsent message goes too')
        self.assertEqual(self.confirm(code).status_code,422,'A code works once')
        self.assertEqual(self.open().post('/api/auth/login',json={**LOGIN,'password':PASSWORD},headers=self.headers).status_code,401)
        self.assertEqual(self.open().post('/api/auth/login',json={**LOGIN,'password':'new-fixture-password'},headers=self.headers).status_code,200)
        events=[r['event'] for r in self.rows('SELECT event FROM access_audit ORDER BY id')];self.assertIn('password_reset',events)
        # Malformed codes and short passwords never reach the account.
        self.age(61);self.request('whatsapp',client=self.open('127.0.0.6'))
        for body in ({'code':'12345'},{'code':'abcdef'},{'code':self.code(),'password':'short'}):
            self.assertEqual(self.open().post('/api/auth/recovery/confirm',json={**LOGIN,'code':'123456','password':'new-fixture-password',**body},headers=self.headers).status_code,422)
        self.assertEqual(self.rows('SELECT attempts FROM password_resets WHERE used=0'),[{'attempts':0}])

    def test_a_new_request_replaces_the_code_after_a_minute(self):
        self.request('whatsapp');first=self.code()
        self.request('email');self.assertEqual(len(self.rows()),1,'Within a minute nothing new is sent')
        self.age(61);self.request('email');second=self.code()
        self.assertEqual([r['status'] for r in self.rows()],['cancelled','pending'])
        if first!=second:self.assertEqual(self.confirm(first).status_code,422)
        self.assertEqual(self.confirm(second).status_code,200)

    def test_five_requests_an_hour_per_account_and_per_address(self):
        client=self.open('127.0.0.7')
        for _ in range(5):self.request('email',client=client,phone='2025550123')
        self.request('email',client=client);self.assertEqual(self.rows(),[],'Five an hour from one address, whatever the phone')
        for index in range(6):self.request('email',client=self.open('127.0.1.%d'%index));self.age(61)
        self.assertEqual(len(self.rows('SELECT * FROM password_resets')),5,'Five an hour for the account, from any address')
        self.age(3600-6*61+1);self.request('email',client=self.open('127.0.2.1'))
        self.assertEqual(len(self.rows('SELECT * FROM password_resets')),6,'The hour counts from each request')

    def test_five_tries_end_a_code_and_wrong_codes_feed_the_login_lock(self):
        self.request('email');code=self.code();wrong=self.wrong(code)
        for index in range(5):
            r=self.confirm(wrong,address='127.0.0.%d'%(20+index));self.assertEqual((r.status_code,r.json()['detail']),(422,recovery.WRONG_CODE))
        self.assertEqual(self.rows('SELECT attempts FROM password_resets'),[{'attempts':5}])
        # The account is locked like after five wrong passwords: no try is counted meanwhile.
        r=self.confirm(code,address='127.0.0.30');self.assertEqual(r.status_code,429);self.assertIn('Retry-After',r.headers)
        self.assertEqual(self.open('127.0.0.31').post('/api/auth/login',json={**LOGIN,'password':PASSWORD},headers=self.headers).status_code,429)
        # Once the lock is over, the right code no longer works: it took its five tries.
        with store.db() as c:c.execute('UPDATE login_attempts SET created=created-3600')
        self.assertEqual(self.confirm(code,address='127.0.0.32').status_code,422)
        # A wrong code spends a try before the comparison, so a right one still works within the five.
        self.age(61);self.request('email',client=self.open('127.0.0.8'));code=self.code()
        with store.db() as c:c.execute('DELETE FROM login_attempts')
        for index in range(4):self.assertEqual(self.confirm(self.wrong(code),address='127.0.0.%d'%(40+index)).status_code,422)
        self.assertEqual(self.confirm(code,address='127.0.0.45').status_code,200)

    def test_expired_codes_and_contact_changes_end_the_code(self):
        self.request('email');code=self.code();self.age(601)
        self.assertEqual(self.confirm(code).status_code,422)
        for change in ({'emails':['new@example.org']},{'whatsapp_use_login':False,'whatsapp_country':'US','whatsapp_phone':'2025550144'}):
            self.age(61);self.request('email',client=self.open('127.0.0.%d'%(50+len(change))));row=self.rows()[-1];code=self.code(row)
            profile=self.client.get('/api/auth/session').json()['user']
            self.assertEqual(self.client.put('/api/profile',json={**profile,**change},headers=self.headers).status_code,200)
            self.assertEqual(self.confirm(code,address='127.0.0.%d'%(60+len(change))).status_code,422,change)
            self.assertEqual(self.rows('SELECT status FROM outbox WHERE id=?',row['id']),[{'status':'cancelled'}])

    def test_upgrade_ends_the_links_of_the_former_recovery(self):
        now=time.time()
        with store.db() as c:
            c.execute("INSERT INTO outbox(id,created,alert_ids,subject,body,status,next_due,recipients,owner_id,kind) VALUES('link',?,'[]','Reset','http://127.0.0.1:8765/#reset=fixture','pending',?,'[]',?,'recovery')",(now,now,self.user['id']))
            c.execute("INSERT INTO password_resets(digest,user_id,created,expires,used,outbox_id) VALUES('legacy-digest',?,?,?,0,'link')",(self.user['id'],now,now+1200))
            c.execute("DELETE FROM metadata WHERE key='recovery_codes_v1'")
        store.setup(seed=False);store.setup(seed=False)
        self.assertEqual(self.rows('SELECT used,channel,attempts FROM password_resets'),[{'used':1,'channel':'email','attempts':0}])
        self.assertEqual(self.rows("SELECT status FROM outbox WHERE id='link'"),[{'status':'cancelled'}])


if __name__ == '__main__':
    unittest.main()
