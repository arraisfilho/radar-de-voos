"""Administrator second factor: enrollment, two-step login, recovery codes, limits and audit.
Temporary data and no external requests; the second-factor clock is fixed per test."""
import test_isolation  # noqa: F401 - first: temporary data, no seed, idle workers
import base64
import hashlib
import hmac
import importlib
import json
import os
import stat
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit
from fastapi import Response
from fastapi.testclient import TestClient
from backend import store,mail,accounts,recovery,two_factor

PASSWORD='fixture-password-only'


class TwoFactorTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.folder=Path(self.temp.name)
        # Whole seconds: Retry-After values are exact.
        self.now=float(int(time.time()))
        self.patches=[patch.object(store,'DATA_DIR',self.folder),patch.object(mail,'DATA_DIR',self.folder),patch.object(mail,'SETTINGS_FILE',self.folder/'smtp-private.json'),
                      patch.object(two_factor,'time',SimpleNamespace(time=lambda:self.now))]
        for item in self.patches:item.start()
        store.setup(seed=False);self.module=importlib.import_module('backend.app');self.headers={'x-radar-token':self.module.TOKEN}
        self.clients=[]
        self.admin=accounts.register(accounts.Registration(name='Admin fixture',country='US',phone='6502530000',password=PASSWORD),Response(),admin=True)
        self.user=accounts.register(accounts.Registration(name='User fixture',country='US',phone='2025550123',password=PASSWORD),Response())
        # register() opens sessions nobody holds.
        with store.db() as c:c.execute('DELETE FROM sessions')
    def tearDown(self):
        for client in self.clients:client.close()
        for item in reversed(self.patches):item.stop()
        self.temp.cleanup()
    def client(self,address='127.0.0.1'):
        client=TestClient(self.module.app,base_url='http://127.0.0.1:8765',client=(address,5000));self.clients.append(client);return client
    def login(self,client,phone='6502530000',password=PASSWORD):
        return client.post('/api/auth/login',json={'country':'US','phone':phone,'password':password},headers=self.headers)
    def second(self,client,**body):
        return client.post('/api/auth/login/2fa',json=body,headers=self.headers)
    def setup_2fa(self,client,password=PASSWORD):
        return client.post('/api/auth/2fa/setup',json={'password':password},headers=self.headers)
    def code(self,secret,offset=0):
        return two_factor.totp(secret,int(self.now//two_factor.PERIOD)+offset)
    def wrong(self,secret):
        valid={self.code(secret,offset) for offset in range(-3,4)}
        return next(code for code in ('000000','111111','222222','333333','444444','555555','666666','777777') if code not in valid)
    def enable(self,client=None):
        """Signs the administrator in and turns the second factor on: client, secret and recovery codes."""
        client=client or self.client()
        self.assertEqual(self.login(client).status_code,200)
        started=self.setup_2fa(client);self.assertEqual(started.status_code,200,started.text)
        secret=base64.b32decode(started.json()['secret'])
        confirmed=client.post('/api/auth/2fa/confirm',json={'code':self.code(secret)},headers=self.headers)
        self.assertEqual(confirmed.status_code,200,confirmed.text)
        return client,secret,confirmed.json()['recovery_codes']
    def attempts(self):
        with store.db() as c:return c.execute('SELECT COUNT(*) FROM login_attempts WHERE account=?',(accounts.limit_key('+16502530000'),)).fetchone()[0]
    def count(self,table):
        with store.db() as c:return c.execute('SELECT COUNT(*) FROM '+table).fetchone()[0]
    def events(self):
        with store.db() as c:return [dict(r) for r in c.execute('SELECT event,user_id,actor_id,ip,count,details FROM access_audit ORDER BY id')]
    def last(self,event):
        return [e for e in self.events() if e['event']==event]

    def test_codes_follow_the_rfc_6238_sha1_vectors(self):
        secret=b'12345678901234567890'
        for moment,expected in [(59,'94287082'),(1111111109,'07081804'),(1111111111,'14050471'),(1234567890,'89005924'),(2000000000,'69279037'),(20000000000,'65353130')]:
            self.assertEqual(two_factor.totp(secret,moment//30,8),expected)
            # Six digits are the same value modulo 10^6.
            self.assertEqual(two_factor.totp(secret,moment//30),expected[2:])

    def test_enrollment_derives_the_secret_and_stores_only_a_salt(self):
        client=self.client();self.assertEqual(self.login(client).status_code,200)
        started=self.setup_2fa(client).json()
        self.assertRegex(started['secret'],r'^[A-Z2-7]{32}$');self.assertEqual(started['expires_in'],600)
        uri=urlsplit(started['uri']);query=parse_qs(uri.query)
        self.assertEqual((uri.scheme,uri.netloc,uri.path),('otpauth','totp','/Radar%20de%20Voos:%2B16502530000'))
        self.assertEqual(query,{'secret':[started['secret']],'issuer':['Radar de Voos'],'algorithm':['SHA1'],'digits':['6'],'period':['30']})
        path=self.folder/two_factor.KEY_FILE;self.assertEqual(stat.S_IMODE(path.stat().st_mode),0o600)
        key=bytes.fromhex(json.loads(path.read_text())['secret']);self.assertEqual(len(key),32)
        with store.db() as c:
            salt=c.execute('SELECT salt FROM two_factor WHERE user_id=?',(self.admin['id'],)).fetchone()[0]
            dump='\n'.join(c.iterdump())
        secret=base64.b32decode(started['secret'])
        self.assertEqual(secret,hmac.new(key,('totp:'+self.admin['id']+':'+salt).encode(),hashlib.sha256).digest()[:20])
        for value in (started['secret'],secret.hex(),key.hex()):self.assertNotIn(value,dump)
        # Until a code confirms it, the password alone signs in; a new start replaces the secret.
        self.assertEqual(self.login(self.client()).json()['id'],self.admin['id'])
        self.assertNotEqual(self.setup_2fa(client).json()['secret'],started['secret'])
        self.assertEqual(client.get('/api/auth/2fa').json(),{'enabled':False,'enabled_at':None,'recovery_codes_remaining':0})

    def test_enrollment_requires_the_password_under_the_login_limits(self):
        client=self.client();self.login(client)
        self.assertEqual(client.post('/api/auth/2fa/setup',json={},headers=self.headers).status_code,422)
        refused=self.setup_2fa(client,'wrong-password-fixture')
        self.assertEqual((refused.status_code,refused.json()['detail']),(403,two_factor.WRONG_PASSWORD))
        # A session alone binds no authenticator: nothing is started, and the wrong password counts.
        self.assertEqual(self.count('two_factor'),0);self.assertEqual(self.attempts(),1)
        self.assertEqual(self.events()[-1]['event'],'login_failed')
        self.assertEqual(self.setup_2fa(client).status_code,200);self.assertEqual(self.attempts(),1)
        slots=threading.BoundedSemaphore(1);slots.acquire()
        with patch.object(accounts,'PASSWORD_SLOTS',slots),patch.object(accounts,'PASSWORD_WAIT',.05):
            self.assertEqual(self.setup_2fa(client).status_code,503)
        # No verification happened: the busy answer is not a failure.
        self.assertEqual(self.attempts(),1)

    def test_confirmation_issues_recovery_codes_and_ends_the_other_sessions(self):
        other=self.client('127.0.0.2');self.assertEqual(self.login(other).status_code,200)
        client=self.client();self.assertEqual(self.login(client).status_code,200)
        with store.db() as c:c.execute("INSERT INTO sessions(digest,user_id,expires) VALUES('expired-fixture',?,?)",(self.admin['id'],self.now-1))
        secret=base64.b32decode(self.setup_2fa(client).json()['secret'])
        refused=client.post('/api/auth/2fa/confirm',json={'code':self.wrong(secret)},headers=self.headers)
        self.assertEqual((refused.status_code,refused.json()['detail']),(422,two_factor.SETUP_WRONG_CODE))
        confirmed=client.post('/api/auth/2fa/confirm',json={'code':self.code(secret)},headers=self.headers)
        self.assertEqual(confirmed.status_code,200,confirmed.text);body=confirmed.json()
        self.assertEqual((body['enabled'],body['enabled_at'],body['recovery_codes_remaining']),(True,self.now,10))
        codes=body['recovery_codes'];self.assertEqual(len(set(codes)),10)
        for code in codes:self.assertRegex(code,r'^[2-9a-hjkmnp-z]{4}(-[2-9a-hjkmnp-z]{4}){3}$')
        # Sessions opened with the password alone end; the one that confirmed stays.
        self.assertEqual(other.get('/api/auth/2fa').status_code,401)
        self.assertEqual(client.get('/api/auth/2fa').json(),{'enabled':True,'enabled_at':self.now,'recovery_codes_remaining':10})
        with store.db() as c:
            stored={r[0] for r in c.execute('SELECT digest FROM two_factor_recovery WHERE user_id=?',(self.admin['id'],))}
            self.assertEqual(c.execute('SELECT COUNT(*) FROM sessions').fetchone()[0],1)
            dump='\n'.join(c.iterdump())
        self.assertEqual(stored,{hashlib.sha256(('recovery:'+self.admin['id']+':'+code.replace('-','')).encode()).hexdigest() for code in codes})
        for code in codes:self.assertNotIn(code.replace('-',''),dump)
        # The count covers open sessions only, not the expired one that went with them.
        self.assertEqual([(e['actor_id'],e['details']) for e in self.last('admin_2fa_enabled')],[(self.admin['id'],'{"sessions_revoked":1}')])
        # Once on, neither a new start nor another confirmation is accepted.
        self.assertEqual(self.setup_2fa(client).status_code,409)
        self.assertEqual(client.post('/api/auth/2fa/confirm',json={'code':self.code(secret)},headers=self.headers).status_code,409)

    def test_an_unconfirmed_enrollment_expires_after_ten_minutes_or_five_wrong_codes(self):
        client=self.client();self.login(client)
        secret=base64.b32decode(self.setup_2fa(client).json()['secret'])
        for _ in range(two_factor.SETUP_ATTEMPTS):
            self.assertEqual(client.post('/api/auth/2fa/confirm',json={'code':self.wrong(secret)},headers=self.headers).status_code,422)
        spent=client.post('/api/auth/2fa/confirm',json={'code':self.code(secret)},headers=self.headers)
        self.assertEqual((spent.status_code,spent.json()['detail']),(410,two_factor.SETUP_EXPIRED))
        secret=base64.b32decode(self.setup_2fa(client).json()['secret'])
        self.now+=two_factor.SETUP_SECONDS
        self.assertEqual(client.post('/api/auth/2fa/confirm',json={'code':self.code(secret)},headers=self.headers).status_code,410)
        self.assertEqual(self.count('two_factor'),0)
        self.assertEqual(client.post('/api/auth/2fa/confirm',json={'code':'123456'},headers=self.headers).status_code,410)
        # Wrong enrollment codes stay out of the login limits.
        self.assertEqual(self.attempts(),0);self.assertEqual(self.login(self.client()).status_code,200)

    def test_confirmation_needs_an_open_session(self):
        client=self.client();self.login(client)
        secret=base64.b32decode(self.setup_2fa(client).json()['secret'])
        # The session ends between the start and the code (a password reset, for example).
        with patch.object(two_factor,'current_session',return_value=False):
            ended=client.post('/api/auth/2fa/confirm',json={'code':self.code(secret)},headers=self.headers)
        self.assertEqual((ended.status_code,ended.json()['detail']),(401,two_factor.SIGNED_OUT))
        self.assertEqual(client.get('/api/auth/2fa').json()['enabled'],False)

    def test_login_asks_for_the_code_in_a_second_step(self):
        _,secret,_=self.enable()
        client=self.client('127.0.0.5');first=self.login(client)
        self.assertEqual(first.json(),{'two_factor_required':True,'expires_in':300})
        cookies=first.headers.get_list('set-cookie');self.assertEqual(len(cookies),1)
        self.assertRegex(cookies[0],r'^radar_2fa=[A-Za-z0-9_-]+; HttpOnly; Max-Age=300; Path=/api/auth/login; SameSite=strict$')
        # The correct password is recorded at once; no session before the second step.
        self.assertEqual([(e['ip'],e['count']) for e in self.last('login_2fa_started')],[('127.0.0.5',1)])
        self.assertEqual(client.get('/api/state').status_code,401)
        with store.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM sessions').fetchone()[0],1)
        # The code that confirmed the enrollment is spent.
        self.assertEqual(self.second(client,code=self.code(secret)).status_code,401)
        self.now+=two_factor.PERIOD;code=self.code(secret)
        signed=self.second(client,code=code)
        self.assertEqual(signed.status_code,200,signed.text);self.assertEqual(signed.json()['id'],self.admin['id'])
        self.assertTrue(any(value.startswith('radar_2fa=""') and 'Max-Age=0' in value for value in signed.headers.get_list('set-cookie')))
        self.assertEqual(client.get('/api/auth/2fa').status_code,200)
        self.assertEqual([(e['event'],e['count']) for e in self.events()[-2:]],[('login_2fa_failed',1),('login_success',1)])
        # The step closed with the session, and the same code does not open another one.
        self.assertEqual(self.second(client,code=code).status_code,410)
        again=self.client('127.0.0.6');self.assertTrue(self.login(again).json()['two_factor_required'])
        reused=self.second(again,code=code)
        self.assertEqual((reused.status_code,reused.json()['detail']),(401,two_factor.WRONG_CODE))

    def test_the_challenge_cookie_is_secure_in_public_mode(self):
        response=Response()
        with patch.object(two_factor,'public_mode',return_value=True):two_factor.set_challenge_cookie(response,'fixture-token')
        self.assertRegex(response.headers['set-cookie'],r'; Path=/api/auth/login; SameSite=strict; Secure$')

    def test_codes_one_step_away_are_accepted_and_spent_steps_refused(self):
        _,secret,_=self.enable();self.now+=4*two_factor.PERIOD
        for offset,status in [(-2,401),(2,401),(-1,200),(1,200),(0,401)]:
            client=self.client();self.assertTrue(self.login(client).json()['two_factor_required'])
            # The current code comes after the accepted +1 step: refused.
            self.assertEqual(self.second(client,code=self.code(secret,offset)).status_code,status,offset)

    def test_a_recovery_code_signs_in_once(self):
        _,_,codes=self.enable()
        client=self.client();self.login(client)
        used=self.second(client,recovery_code=' '+codes[3].upper().replace('-',' ')+' ')
        self.assertEqual(used.status_code,200,used.text)
        self.assertEqual(client.get('/api/auth/2fa').json()['recovery_codes_remaining'],9)
        self.assertEqual([(e['actor_id'],e['count'],e['details']) for e in self.last('recovery_code_used')],[(None,1,'{"remaining":9}')])
        client=self.client();self.login(client)
        self.assertEqual(self.second(client,recovery_code=codes[3]).status_code,401)
        # A wrong recovery code counts in the login limits, not in the authenticator code budget.
        self.assertEqual(self.attempts(),1);self.assertEqual(self.count('two_factor_failures'),0)

    def test_wrong_codes_count_in_the_login_limits_and_a_correct_password_keeps_them(self):
        _,secret,_=self.enable();self.now+=two_factor.PERIOD
        client=self.client('127.0.0.7');self.login(client)
        for _ in range(4):self.assertEqual(self.second(client,code=self.wrong(secret)).status_code,401)
        self.assertTrue(self.login(client).json()['two_factor_required']);self.assertEqual(self.attempts(),4)
        self.assertEqual(self.second(client,code=self.wrong(secret)).status_code,401)
        self.assertEqual(self.count('two_factor_failures'),5)
        # Fifth failure: the account waits, for the right code and for the password from another address.
        locked=self.second(client,code=self.code(secret))
        self.assertEqual((locked.status_code,locked.json()['detail']),(429,accounts.THROTTLED));self.assertIn('retry-after',locked.headers)
        self.assertEqual(self.login(self.client('127.0.0.8')).status_code,429)
        self.assertEqual([(e['count'],e['details']) for e in self.last('login_2fa_failed')],[(5,None)])
        self.assertIn('login_throttled',[e['event'] for e in self.events()])

    def test_wrong_codes_count_in_the_address_limit(self):
        _,secret,_=self.enable();self.now+=two_factor.PERIOD
        client=self.client('127.0.0.9');self.login(client)
        for _ in range(4):self.assertEqual(self.second(client,code=self.wrong(secret)).status_code,401)
        for index in range(5):self.assertEqual(self.login(client,'20255501%02d'%(60+index)).status_code,401)
        # The correct password, four wrong codes and five refused logins: ten from this address
        # in 15 minutes, so even the right code waits.
        self.assertEqual(self.second(client,code=self.code(secret)).status_code,429)
        other=self.client('127.0.0.10');self.login(other)
        self.assertEqual(self.second(other,code=self.code(secret)).status_code,200)

    def test_correct_passwords_count_in_the_address_limit_only(self):
        self.enable()
        client=self.client('127.0.0.16')
        for _ in range(accounts.ADDRESS_LIMIT):self.assertTrue(self.login(client).json()['two_factor_required'])
        # Second steps opened from one address are bounded like attempts, and so are their audit rows.
        self.assertEqual(self.login(client).status_code,429)
        self.assertEqual([e['count'] for e in self.last('login_2fa_started')],[accounts.ADDRESS_LIMIT])
        # They never lock the account: another address signs in at once.
        self.assertEqual(self.attempts(),0);self.assertTrue(self.login(self.client('127.0.0.17')).json()['two_factor_required'])

    def test_the_code_budget_lasts_24_hours_whoever_signs_in(self):
        _,secret,codes=self.enable();self.now+=two_factor.PERIOD
        with store.db() as c:
            c.executemany('INSERT INTO two_factor_failures(user_id,created) VALUES(?,?)',
                          [(self.admin['id'],self.now-two_factor.CODE_WINDOW+600+index) for index in range(two_factor.CODE_LIMIT)])
            c.execute('INSERT INTO two_factor_failures(user_id,created) VALUES(?,?)',(self.admin['id'],self.now-two_factor.CODE_WINDOW))
        client=self.client();self.login(client)
        blocked=self.second(client,code=self.code(secret))
        self.assertEqual((blocked.status_code,blocked.json()['detail']),(429,two_factor.CODES_EXHAUSTED))
        self.assertEqual(blocked.headers['retry-after'],'600')
        # No code was checked, so the attempt is not a failure; the expired budget row is gone.
        self.assertEqual(self.attempts(),0);self.assertEqual(self.count('two_factor_failures'),two_factor.CODE_LIMIT)
        self.assertEqual(self.second(client,recovery_code=codes[0]).status_code,200)
        # Signing in does not renew the budget: the next code still waits for the oldest failure.
        self.assertEqual(self.count('two_factor_failures'),two_factor.CODE_LIMIT)
        again=self.client();self.login(again)
        self.assertEqual(self.second(again,code=self.code(secret)).status_code,429)
        self.now+=600
        later=self.client();self.login(later)
        self.assertEqual(self.second(later,code=self.code(secret)).status_code,200)

    def test_the_second_step_expires_and_logins_from_elsewhere_do_not_close_it(self):
        _,secret,_=self.enable();self.now+=two_factor.PERIOD
        missing=self.second(self.client(),code=self.code(secret))
        self.assertEqual((missing.status_code,missing.json()['detail']),(410,two_factor.EXPIRED));self.assertEqual(self.attempts(),0)
        late=self.client();self.login(late)
        self.now+=two_factor.CHALLENGE_SECONDS
        self.assertEqual(self.second(late,code=self.code(secret)).status_code,410)
        owner=self.client('127.0.0.20');self.login(owner)
        # Someone with the password elsewhere: each step is recorded, none closes the owner's.
        intruder=self.client('127.0.0.30')
        for _ in range(two_factor.CHALLENGE_LIMIT+1):self.assertTrue(self.login(intruder).json()['two_factor_required'])
        self.assertEqual([(e['ip'],e['count']) for e in self.last('login_2fa_started')][-2:],[('127.0.0.20',1),('127.0.0.30',two_factor.CHALLENGE_LIMIT+1)])
        with store.db() as c:self.assertEqual(c.execute("SELECT COUNT(*) FROM two_factor_challenges WHERE address='127.0.0.30'").fetchone()[0],two_factor.CHALLENGE_LIMIT)
        self.assertEqual(self.second(owner,code=self.code(secret)).status_code,200)
        # From one address, only the newest steps stay open.
        first=self.client('127.0.0.21');self.login(first)
        later=self.client('127.0.0.21')
        for _ in range(two_factor.CHALLENGE_LIMIT):self.login(later)
        self.assertEqual(self.second(first,code=self.code(secret,1)).status_code,410)

    def test_a_password_reset_closes_open_second_steps_and_keeps_the_code_budget(self):
        _,secret,_=self.enable();self.now+=two_factor.PERIOD
        pending=self.client('127.0.0.9');self.login(pending)
        with store.db() as c:
            c.execute('INSERT INTO two_factor_failures(user_id,created) VALUES(?,?)',(self.admin['id'],self.now))
            c.execute("INSERT INTO password_resets(digest,user_id,created,expires,used,outbox_id,channel) VALUES(?,?,?,?,0,'fixture','email')",
                      (recovery.digest(self.admin['id'],'fixture','123456'),self.admin['id'],time.time(),time.time()+900))
        reset=self.client().post('/api/auth/recovery/confirm',json={'country':'US','phone':'6502530000','code':'123456','password':'recovered-fixture-password'},headers=self.headers)
        self.assertEqual(reset.status_code,200,reset.text)
        self.assertEqual(self.second(pending,code=self.code(secret)).status_code,410)
        self.assertEqual(self.count('two_factor_failures'),1)
        # The second factor stays on with the new password.
        client=self.client();self.assertTrue(self.login(client,password='recovered-fixture-password').json()['two_factor_required'])
        self.assertEqual(self.second(client,code=self.code(secret)).status_code,200)
        # A reset by the administrator closes open steps too.
        pending=self.client('127.0.0.11');self.login(pending,password='recovered-fixture-password')
        self.assertEqual(client.put('/api/admin/users/'+self.admin['id']+'/password',json={'password':'admin-set-fixture-password'},headers=self.headers).status_code,200)
        self.now+=two_factor.PERIOD
        self.assertEqual(self.second(pending,code=self.code(secret)).status_code,410)
        self.assertEqual(self.count('two_factor_failures'),1)

    def test_a_password_reset_during_the_password_check_signs_nothing_in(self):
        self.enable()
        def reset_meanwhile(password_hash,password):
            with store.db() as c:c.execute("UPDATE accounts SET password_hash='replaced' WHERE password_hash=?",(password_hash,))
            return True
        with patch.object(accounts,'verify_password',side_effect=reset_meanwhile):
            refused=self.login(self.client('127.0.0.12'))
            # Without the second factor too: the former password opens no session.
            user=self.login(self.client('127.0.0.18'),'2025550123')
        for response in (refused,user):
            self.assertEqual(response.status_code,401);self.assertNotIn('set-cookie',response.headers)
        self.assertEqual(self.count('two_factor_challenges'),0);self.assertEqual(self.attempts(),1)
        with store.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM sessions WHERE user_id=?',(self.user['id'],)).fetchone()[0],0)

    def test_disabling_requires_the_password(self):
        client,_,_=self.enable()
        refused=client.post('/api/auth/2fa/disable',json={'password':'wrong-password-fixture'},headers=self.headers)
        self.assertEqual((refused.status_code,refused.json()['detail']),(403,two_factor.WRONG_PASSWORD))
        self.assertEqual(self.attempts(),1);self.assertEqual(self.events()[-1]['event'],'login_failed')
        done=client.post('/api/auth/2fa/disable',json={'password':PASSWORD},headers=self.headers)
        self.assertEqual(done.status_code,200,done.text);self.assertEqual(done.json(),{'enabled':False,'enabled_at':None,'recovery_codes_remaining':0})
        for table in ('two_factor','two_factor_recovery','two_factor_challenges','two_factor_failures'):self.assertEqual(self.count(table),0,table)
        self.assertEqual([(e['user_id'],e['actor_id'],e['details']) for e in self.last('admin_2fa_disabled')],[(self.admin['id'],self.admin['id'],None)])
        self.assertEqual(client.post('/api/auth/2fa/disable',json={'password':PASSWORD},headers=self.headers).status_code,409)
        # The password alone signs in again.
        self.assertEqual(self.login(self.client()).json()['id'],self.admin['id'])

    def test_disabling_shares_the_account_lock(self):
        client,_,_=self.enable()
        for _ in range(5):self.assertEqual(client.post('/api/auth/2fa/disable',json={'password':'wrong-password-fixture'},headers=self.headers).status_code,403)
        locked=client.post('/api/auth/2fa/disable',json={'password':PASSWORD},headers=self.headers)
        self.assertEqual(locked.status_code,429);self.assertIn('retry-after',locked.headers)
        self.assertEqual(self.login(self.client('127.0.0.3')).status_code,429)
        self.assertEqual(client.get('/api/auth/2fa').json()['enabled'],True)

    def test_disabling_fails_when_a_password_reset_ends_the_session_during_the_check(self):
        client,_,_=self.enable()
        def reset_meanwhile(password_hash,password):
            with store.db() as c:
                c.execute("UPDATE accounts SET password_hash='replaced' WHERE id=?",(self.admin['id'],))
                c.execute('DELETE FROM sessions WHERE user_id=?',(self.admin['id'],))
            return True
        with patch.object(accounts,'verify_password',side_effect=reset_meanwhile):
            raced=client.post('/api/auth/2fa/disable',json={'password':PASSWORD},headers=self.headers)
        self.assertEqual(raced.status_code,401)
        self.assertEqual(self.count('two_factor'),1);self.assertEqual(self.attempts(),0)
        self.assertEqual(self.last('admin_2fa_disabled'),[])

    def test_only_the_administrator_manages_it_and_other_accounts_sign_in_as_before(self):
        self.enable()
        user=self.client('127.0.0.4');signed=self.login(user,'2025550123')
        self.assertEqual(signed.status_code,200);self.assertEqual(signed.json()['id'],self.user['id'])
        self.assertTrue(signed.headers['set-cookie'].startswith('radar_session='))
        self.assertEqual([e['event'] for e in self.events() if e['user_id']==self.user['id']],['login_success'])
        for path,body in [('/api/auth/2fa',None),('/api/auth/2fa/setup',{'password':PASSWORD}),('/api/auth/2fa/confirm',{'code':'123456'}),('/api/auth/2fa/disable',{'password':PASSWORD})]:
            response=user.get(path) if body is None else user.post(path,json=body,headers=self.headers)
            self.assertEqual(response.status_code,403,path)
        self.assertEqual(self.client().get('/api/auth/2fa').status_code,401)

    def test_second_step_input_is_validated_before_any_attempt(self):
        _,secret,_=self.enable();self.now+=two_factor.PERIOD
        client=self.client();self.login(client)
        for body in ({},{'code':'12345'},{'code':'12a456'},{'code':'١٢٣٤٥٦'},{'code':'123456','recovery_code':'abcd-efgh-jkmn-pqrs'},{'recovery_code':'short'}):
            self.assertEqual(self.second(client,**body).status_code,422,body)
        self.assertEqual(self.attempts(),0)
        code=self.code(secret)
        self.assertEqual(self.second(client,code=code[:3]+' '+code[3:]).status_code,200)

    def test_audit_holds_no_secret_or_code(self):
        client,secret,codes=self.enable();self.now+=two_factor.PERIOD
        attempt=self.client();self.login(attempt);self.second(attempt,code=self.wrong(secret));self.second(attempt,recovery_code=codes[0])
        client.post('/api/auth/2fa/disable',json={'password':PASSWORD},headers=self.headers)
        with store.db() as c:rows=json.dumps([dict(r) for r in c.execute('SELECT * FROM access_audit')])
        for value in (base64.b32encode(secret).decode(),secret.hex(),*codes,*(code.replace('-','') for code in codes)):self.assertNotIn(value,rows)
        details={e['event']:e['details'] for e in self.events() if e['event'] in ('admin_2fa_enabled','admin_2fa_disabled','login_2fa_started','login_2fa_failed','recovery_code_used')}
        self.assertEqual(details,{'admin_2fa_enabled':'{"sessions_revoked":0}','login_2fa_started':None,'login_2fa_failed':None,
                                  'recovery_code_used':'{"remaining":9}','admin_2fa_disabled':None})

    def test_events_join_the_transaction_they_record(self):
        client=self.client();self.login(client)
        secret=base64.b32decode(self.setup_2fa(client).json()['secret'])
        # The record fails: the second factor is not turned on and no recovery code is issued.
        with patch.object(two_factor.audit,'record',side_effect=RuntimeError('audit unavailable')),self.assertRaises(RuntimeError):
            client.post('/api/auth/2fa/confirm',json={'code':self.code(secret)},headers=self.headers)
        self.assertEqual(self.count('two_factor_recovery'),0);self.assertEqual(client.get('/api/auth/2fa').json()['enabled'],False)
        self.assertEqual(client.post('/api/auth/2fa/confirm',json={'code':self.code(secret)},headers=self.headers).status_code,200)

    def test_a_missing_or_unreadable_key_fails_closed_without_replacing_the_file(self):
        _,secret,codes=self.enable();self.now+=two_factor.PERIOD
        path=self.folder/two_factor.KEY_FILE
        for content in ('{"secret":"00ff"}','not json',None):
            if content is None:path.unlink()
            else:path.write_text(content)
            client=self.client();self.login(client)
            with self.assertLogs('radar.two_factor','ERROR'):
                unavailable=self.second(client,code=self.code(secret))
            self.assertEqual((unavailable.status_code,unavailable.json()['detail']),(503,two_factor.KEY_UNAVAILABLE))
            # Nothing was checked or replaced: no failure, and the file waits to be restored.
            self.assertEqual(self.attempts(),0);self.assertEqual(self.count('two_factor_failures'),0)
            self.assertEqual(path.read_text() if path.exists() else None,content)
        self.assertEqual(self.second(client,recovery_code=codes[0]).status_code,200)
        self.assertEqual(client.post('/api/auth/2fa/disable',json={'password':PASSWORD},headers=self.headers).status_code,200)
        # Present but not readable at all (a folder in its place): no new key over it, and the
        # correct password of the refused start is no failure.
        path.mkdir()
        with self.assertLogs('radar.two_factor','ERROR'):
            self.assertEqual(self.setup_2fa(client).status_code,503)
        self.assertTrue(path.is_dir());self.assertEqual(self.attempts(),0)
        # Restored, the next start creates a new key.
        path.rmdir()
        self.assertEqual(self.setup_2fa(client).status_code,200);self.assertEqual(stat.S_IMODE(path.stat().st_mode),0o600)

    def test_a_correct_password_is_no_failure_when_the_change_itself_fails(self):
        client,_,_=self.enable()
        with patch.object(two_factor.audit,'record',side_effect=RuntimeError('audit unavailable')),self.assertRaises(RuntimeError):
            client.post('/api/auth/2fa/disable',json={'password':PASSWORD},headers=self.headers)
        self.assertEqual(client.get('/api/auth/2fa').json()['enabled'],True);self.assertEqual(self.attempts(),0)

    def test_the_server_script_turns_the_second_factor_off(self):
        from scripts import disable_2fa
        previous=os.umask(0o022);os.umask(previous)
        try:
            with patch('builtins.input',return_value='SIM'),self.assertRaises(SystemExit):disable_2fa.main()
            _,secret,_=self.enable();self.now+=two_factor.PERIOD
            with patch('builtins.input',return_value='não'),self.assertRaises(SystemExit):disable_2fa.main()
            with patch('builtins.input',side_effect=EOFError),self.assertRaises(SystemExit):disable_2fa.main()
            self.assertEqual(self.count('two_factor'),1)
            # Wrong codes locked the password login; the script lifts that lock and ends the sessions.
            client=self.client('127.0.0.13');self.login(client)
            for _ in range(5):self.second(client,code=self.wrong(secret))
            self.assertEqual(self.login(self.client('127.0.0.14')).status_code,429)
            with patch('builtins.input',return_value='SIM'),patch('builtins.print'):disable_2fa.main()
        finally:os.umask(previous)
        for table in ('two_factor','two_factor_recovery','sessions'):self.assertEqual(self.count(table),0,table)
        self.assertEqual(self.attempts(),0)
        # No session and no address: the event has no author.
        self.assertEqual([(e['actor_id'],e['ip']) for e in self.last('admin_2fa_disabled')],[(None,'unknown')])
        self.assertEqual(self.login(self.client('127.0.0.15')).json()['id'],self.admin['id'])


if __name__=='__main__':unittest.main()
