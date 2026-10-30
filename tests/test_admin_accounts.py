"""Manual administration uses temporary accounts without external notifications."""
import test_isolation  # noqa: F401 - first: temporary data, no seed, idle workers
import importlib
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend import store,mail,accounts,deliveries,audit


class ManualAccountTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();folder=Path(self.temp.name)
        self.patches=[patch.object(store,'DATA_DIR',folder),patch.object(mail,'DATA_DIR',folder),patch.object(mail,'SETTINGS_FILE',folder/'smtp.json')]
        for p in self.patches:p.start()
        store.setup(seed=False);self.module=importlib.import_module('backend.app');self.admin=TestClient(self.module.app);self.user=TestClient(self.module.app);self.anon=TestClient(self.module.app);self.headers={'x-radar-token':self.module.TOKEN}
        self.base={'name':'Managed fixture','country':'US','phone':'6502530000','password':'fixture-password-only','emails':['fixture@example.org']}
        self.aid=self.admin.post('/api/auth/bootstrap',json=self.base,headers=self.headers).json()['id']
        self.base.update(name='Managed other',country='GB',phone='02079460018')
        self.uid=self.user.post('/api/auth/register',json=self.base,headers=self.headers).json()['id']
    def tearDown(self):
        self.admin.close();self.user.close();self.anon.close()
        for p in reversed(self.patches):p.stop()
        self.temp.cleanup()
    def detail(self,uid=None):
        return next(u for u in self.admin.get('/api/admin/users').json()['items'] if u['id']==(uid or self.uid))
    def test_search_limit_is_admin_managed_and_enforced_for_create_and_restore(self):
        from backend.domain import Search,Leg
        config=Search(origins=['THE'],destinations=['GRU'],outbound=Leg(start='2090-11-05T00:00',end='2090-11-05T23:59')).model_dump()
        self.assertEqual(self.detail()['search_limit'],5)
        contacts=self.detail();contacts['search_limit']=1
        self.assertEqual(self.admin.put('/api/admin/users/'+self.uid,json=contacts,headers=self.headers).status_code,200)
        sid=self.user.post('/api/searches',json=config,headers=self.headers).json()['id']
        self.user.post('/api/searches/'+sid+'/action',json={'action':'pause'},headers=self.headers)
        self.assertEqual(self.user.post('/api/searches',json=config,headers=self.headers).status_code,422)
        # A profile payload must never elevate its own quota.
        self.assertEqual(self.user.put('/api/profile',json=contacts|{'search_limit':100},headers=self.headers).status_code,200)
        self.assertEqual(self.detail()['search_limit'],1)
        self.user.post('/api/searches/'+sid+'/action',json={'action':'archive'},headers=self.headers)
        second=self.user.post('/api/searches',json=config,headers=self.headers).json()['id']
        self.assertEqual(self.user.post('/api/searches/'+sid+'/restore',json={},headers=self.headers).status_code,422)
        contacts=self.detail();contacts['search_limit']=2
        self.assertEqual(self.admin.put('/api/admin/users/'+self.uid,json=contacts,headers=self.headers).status_code,200)
        self.assertEqual(self.user.post('/api/searches/'+sid+'/restore',json={},headers=self.headers).status_code,200)
        contacts['search_limit']=1
        self.assertEqual(self.admin.put('/api/admin/users/'+self.uid,json=contacts,headers=self.headers).status_code,200)
        state=self.user.get('/api/state').json()
        self.assertEqual(len(state['searches']),2)
        self.assertEqual(state['user']['search_limit'],1)
        self.assertEqual(self.user.post('/api/searches',json=config,headers=self.headers).status_code,422)
        # Older admin clients that omit the field preserve the customized quota.
        contacts.pop('search_limit')
        self.admin.put('/api/admin/users/'+self.uid,json=contacts,headers=self.headers)
        self.assertEqual(self.detail()['search_limit'],1)

    def test_manual_creation_accepts_custom_quota_but_public_registration_does_not(self):
        custom=self.base|{'country':'CO','phone':'3001234567','search_limit':12}
        created=self.admin.post('/api/admin/users',json=custom,headers=self.headers)
        self.assertEqual(created.status_code,200,created.text)
        self.assertEqual(created.json()['search_limit'],12)
        with TestClient(self.module.app) as client:
            registered=client.post('/api/auth/register',json=self.base|{'country':'US','phone':'2025550123','search_limit':100},headers=self.headers)
            self.assertEqual(registered.status_code,200,registered.text)
            self.assertEqual(registered.json()['search_limit'],5)
        for limit in (0,101,-1):
            response=self.admin.put('/api/admin/users/'+self.uid,json=self.detail()|{'search_limit':limit},headers=self.headers)
            self.assertEqual(response.status_code,422)
        self.assertEqual(self.user.put('/api/admin/users/'+self.uid,json=self.detail()|{'search_limit':20},headers=self.headers).status_code,403)

    def test_regular_user_and_anonymous_cannot_manage_accounts(self):
        for client,code in [(self.user,403),(self.anon,401)]:
            self.assertEqual(client.get('/api/admin/users').status_code,code)
            self.assertEqual(client.post('/api/admin/users',json=self.base,headers=self.headers).status_code,code)
            self.assertEqual(client.put('/api/admin/users/'+self.uid,json=self.detail(),headers=self.headers).status_code,code)
            self.assertEqual(client.put('/api/admin/users/'+self.uid+'/password',json={'password':'new-test-password'},headers=self.headers).status_code,code)
        self.assertEqual(self.admin.post('/api/admin/users',json=self.base).status_code,403)
    def test_create_preserves_admin_session_and_persists_all_preferences(self):
        payload={**self.base,'name':'Manual customer','country':'CO','phone':'3001234567','language':'es','timezone':'America/Bogota','quiet_hours':True,'quiet_start':'23:00','quiet_end':'07:00','telegram_username':'@fixture_telegram','whatsapp_use_login':False,'whatsapp_country':'US','whatsapp_phone':'2025550123','additional_phones':[{'country':'BR','phone':'11987654321'},{'country':'US','phone':'2025550144'}],'role':'admin'}
        response=self.admin.post('/api/admin/users',json=payload,headers=self.headers);self.assertEqual(response.status_code,200,response.text);user=response.json()
        self.assertEqual(user['role'],'user');self.assertEqual(user['phone'],'+573001234567');self.assertEqual(user['whatsapp_phone'],'+12025550123');self.assertEqual(user['additional_phones'][0]['phone'],'+5511987654321');self.assertEqual(user['language'],'es');self.assertTrue(user['quiet_hours']);self.assertEqual(user['telegram_username'],'fixture_telegram')
        self.assertNotIn('password',response.text);self.assertNotIn('password_hash',response.text)
        self.assertEqual(self.admin.get('/api/auth/session').json()['user']['id'],self.aid)
        login=self.anon.post('/api/auth/login',json={'country':'CO','phone':'3001234567','password':payload['password']},headers=self.headers);self.assertEqual(login.status_code,200,login.text)
        entries=self.admin.get('/api/admin/audit').json();entry=next(e for e in entries if e['event']=='admin_account_created');self.assertEqual(entry['user_id'],user['id']);self.assertEqual(entry['actor_id'],self.aid);self.assertNotIn(payload['password'],json.dumps(entries))
    def test_duplicate_phone_rolls_back_contact_changes(self):
        user=self.detail();user.update(name='Should not persist',country='US',phone='6502530000')
        r=self.admin.put('/api/admin/users/'+self.uid,json=user,headers=self.headers);self.assertEqual(r.status_code,409);self.assertEqual(self.detail()['name'],'Managed other')
        self.assertEqual(self.admin.post('/api/admin/users',json=self.base,headers=self.headers).status_code,409)
    def test_update_phones_emails_language_and_revoke_only_target_login(self):
        target=self.detail();target.update(country='US',phone='2025550123',language='en',emails=['a@example.org','b@example.org'],whatsapp_use_login=True,additional_phones=[{'country':'GB','phone':'02079460018'}])
        r=self.admin.put('/api/admin/users/'+self.uid,json=target,headers=self.headers);self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(r.json()['phone'],'+12025550123');self.assertEqual(r.json()['whatsapp_phone'],'+12025550123');self.assertEqual(len(r.json()['emails']),2)
        self.assertIsNone(self.user.get('/api/auth/session').json()['user']);self.assertEqual(self.admin.get('/api/auth/session').json()['user']['id'],self.aid)
        self.assertEqual(self.anon.post('/api/auth/login',json={'country':'US','phone':'2025550123','password':self.base['password']},headers=self.headers).status_code,200)
    def test_password_reset_revokes_sessions_and_recovery_and_never_returns_password(self):
        with store.db() as c:
            c.execute("INSERT INTO outbox(id,created,alert_ids,subject,body,status,next_due,owner_id,kind) VALUES('recovery',?,'[]','Reset','protected','pending',?,?,'recovery')",(time.time(),time.time(),self.uid))
            c.execute("INSERT INTO password_resets(digest,user_id,created,expires,used,outbox_id) VALUES('fixture',?,?,?,0,'recovery')",(self.uid,time.time(),time.time()+900))
        secret='new-fixture-password'
        r=self.admin.put('/api/admin/users/'+self.uid+'/password',json={'password':secret},headers=self.headers);self.assertEqual(r.status_code,200);self.assertNotIn(secret,r.text)
        self.assertIsNone(self.user.get('/api/auth/session').json()['user']);self.assertIsNotNone(self.admin.get('/api/auth/session').json()['user'])
        with store.db() as c:
            self.assertEqual(c.execute("SELECT used FROM password_resets WHERE digest='fixture'").fetchone()[0],1);self.assertEqual(c.execute("SELECT status FROM outbox WHERE id='recovery'").fetchone()[0],'cancelled')
        self.assertEqual(self.user.post('/api/auth/login',json={'country':'GB','phone':'02079460018','password':self.base['password']},headers=self.headers).status_code,401)
        self.assertEqual(self.user.post('/api/auth/login',json={'country':'GB','phone':'02079460018','password':secret},headers=self.headers).status_code,200)
    def test_validation_and_missing_accounts(self):
        for change in [{'emails':['bad']},{'additional_phones':[{'country':'BR','phone':'12'}]},{'additional_phones':[{'country':'US','phone':'2025550123'}]*5},{'language':'xx'},{'phone':'invalid'},{'timezone':'invalid'}]:
            r=self.admin.put('/api/admin/users/'+self.uid,json={**self.detail(),**change},headers=self.headers);self.assertEqual(r.status_code,422,change)
        self.assertEqual(self.admin.put('/api/admin/users/missing',json=self.detail(),headers=self.headers).status_code,404)
        r=self.admin.put('/api/admin/users/'+self.uid+'/password',json={'password':'short'},headers=self.headers);self.assertEqual(r.status_code,422);self.assertNotIn('"input"',r.text)
    def test_self_password_change_requires_login_again(self):
        r=self.admin.put('/api/admin/users/'+self.aid+'/password',json={'password':'replacement-fixture-password'},headers=self.headers);self.assertEqual(r.status_code,200)
        self.assertIsNone(self.admin.get('/api/auth/session').json()['user'])
        self.assertEqual(self.admin.get('/api/admin/users').status_code,401)
    def test_user_profile_can_manage_additional_numbers_and_normalizes_duplicates(self):
        target=self.detail();target['additional_phones']=[{'country':'US','phone':'2025550123'},{'country':'US','phone':'+12025550123'}]
        r=self.user.put('/api/profile',json=target,headers=self.headers);self.assertEqual(r.status_code,200,r.text);self.assertEqual(len(r.json()['additional_phones']),1)
    def test_users_search_and_pagination_do_not_leak_passwords(self):
        self.assertEqual(self.admin.get('/api/admin/users',params={'q':'Managed other'}).json()['total'],1)
        self.assertEqual(self.admin.get('/api/admin/users',params={'q':'%'}).json()['total'],0)
        self.assertEqual(self.admin.get('/api/admin/users',params={'q':'fixture@example.org'}).json()['total'],2)
        self.assertEqual(self.admin.get('/api/admin/users',params={'page':1}).json()['items'],[])
        self.assertNotIn('password',self.admin.get('/api/admin/users').text)
    def test_access_log_cleanup_scope_and_retention_policy(self):
        r=self.admin.put('/api/admin/delivery-retention',json={'scope':'access','days':15},headers=self.headers);self.assertEqual(r.status_code,200);self.assertEqual(r.json()['days'],15)
        self.assertEqual(self.admin.get('/api/admin/delivery-retention').json()['days'],90)
        self.assertEqual(self.user.put('/api/admin/delivery-retention',json={'scope':'access','days':15},headers=self.headers).status_code,403)
        with store.db() as c:c.execute('UPDATE access_audit SET created=?',(time.time()-16*86400,))
        audit.cleanup();self.assertEqual(self.admin.get('/api/admin/audit').json(),[])
        with store.db() as c:c.execute("INSERT INTO access_audit(user_id,event,created,ip,user_agent,browser,system) VALUES(?,'fixture',?,'local','','','')",(self.uid,time.time()-100))
        before=time.time();plan=self.admin.post('/api/admin/delivery-cleanup/preview',json={'scope':'access','before':before},headers=self.headers).json();self.assertEqual(plan['count'],1)
        body={k:plan[k] for k in ['before','expires','proof']};body['scope']='deliveries'
        self.assertEqual(self.admin.post('/api/admin/delivery-cleanup/confirm',json=body,headers=self.headers).status_code,409)
        body['scope']='access';r=self.admin.post('/api/admin/delivery-cleanup/confirm',json=body,headers=self.headers);self.assertEqual(r.json()['removed'],1)
        with store.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM accounts').fetchone()[0],2)
