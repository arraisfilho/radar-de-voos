"""Login limits by address and by account; temporary data and no external requests."""
import test_isolation  # noqa: F401 - first: temporary data, no seed, idle workers
import hashlib
import hmac
import importlib
import json
import stat
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import HTTPException, Response
from fastapi.testclient import TestClient
from backend import store,mail,accounts


class LoginLimitTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();folder=Path(self.temp.name)
        self.patches=[patch.object(store,'DATA_DIR',folder),patch.object(mail,'DATA_DIR',folder),patch.object(mail,'SETTINGS_FILE',folder/'smtp.json')]
        for item in self.patches:item.start()
        store.setup(seed=False);self.module=importlib.import_module('backend.app');self.headers={'x-radar-token':self.module.TOKEN}
        self.clients=[]
        for name,phone in [('Owner fixture','6502530000'),('Target fixture','2025550123'),('Third fixture','2025550144')]:
            accounts.register(accounts.Registration(name=name,country='US',phone=phone,password='fixture-password-only'),Response())
    def tearDown(self):
        for client in self.clients:client.close()
        for item in reversed(self.patches):item.stop()
        self.temp.cleanup()
    def client(self,address='127.0.0.1'):
        client=TestClient(self.module.app,base_url='http://127.0.0.1:8765',client=(address,5000));self.clients.append(client);return client
    def login(self,client,phone,password='wrong-password-fixture'):
        return client.post('/api/auth/login',json={'country':'US','phone':phone,'password':password},headers=self.headers)
    def rows(self,phone):
        _,key=accounts.login_key(accounts.Login(country='US',phone=phone,password='x'))
        with store.db() as c:return c.execute('SELECT COUNT(*) FROM login_attempts WHERE account=?',(key,)).fetchone()[0]

    def test_success_on_one_account_keeps_failures_of_other_accounts_from_the_same_address(self):
        client=self.client()
        for _ in range(4):self.assertEqual(self.login(client,'2025550123').status_code,401)
        for _ in range(4):self.assertEqual(self.login(client,'2025550144').status_code,401)
        self.assertEqual(self.login(client,'6502530000','fixture-password-only').status_code,200)
        # The owner's success only clears the owner's counters.
        self.assertEqual(self.rows('2025550123'),4);self.assertEqual(self.rows('2025550144'),4)
        self.assertEqual(self.login(client,'2025550999').status_code,401)
        self.assertEqual(self.login(client,'2025550998').status_code,401)
        # 10 failures from this address in 15 minutes: even the correct password waits.
        limited=self.login(client,'6502530000','fixture-password-only')
        self.assertEqual(limited.status_code,429);self.assertEqual(limited.json()['detail'],accounts.THROTTLED)
        self.assertIn('retry-after',limited.headers)
        self.assertEqual(self.login(self.client('127.0.0.2'),'6502530000','fixture-password-only').status_code,200)

    def test_account_lock_counts_failures_from_any_address(self):
        for index in range(5):
            self.assertEqual(self.login(self.client('127.0.0.%d'%(10+index)),'2025550123').status_code,401)
        fresh=self.client('127.0.0.99')
        # The correct password is not even checked while the account is locked.
        with patch.object(accounts,'verify_password',wraps=accounts.verify_password) as verify:
            locked=self.login(fresh,'2025550123','fixture-password-only')
            verify.assert_not_called()
        self.assertEqual(locked.status_code,429);self.assertTrue(55<=int(locked.headers['retry-after'])<=60)
        self.assertEqual(self.login(fresh,'6502530000','fixture-password-only').status_code,200)
        with store.db() as c:
            event=c.execute("SELECT * FROM access_audit WHERE event='login_throttled'").fetchone()
        self.assertIsNotNone(event['user_id'])

    def test_success_resets_only_the_own_account_series(self):
        client=self.client()
        for _ in range(4):self.assertEqual(self.login(client,'6502530000').status_code,401)
        self.assertEqual(self.login(client,'6502530000','fixture-password-only').status_code,200)
        self.assertEqual(self.rows('6502530000'),0)
        for _ in range(4):self.assertEqual(self.login(client,'6502530000').status_code,401)
        self.assertEqual(self.login(client,'6502530000','fixture-password-only').status_code,200)

    def test_unknown_phone_receives_the_same_answers_and_counting(self):
        def run(phone,address):
            client=self.client(address);answers=[]
            for _ in range(6):
                response=self.login(client,phone)
                answers.append((response.status_code,response.json(),{k:v for k,v in response.headers.items() if k!='retry-after'},response.headers.get('retry-after')))
            return answers
        known,unknown=run('2025550123','127.0.0.20'),run('2025550177','127.0.0.21')
        self.assertEqual([a[:3] for a in known],[a[:3] for a in unknown])
        self.assertEqual([a[0] for a in known],[401]*5+[429])
        self.assertLessEqual(abs(int(known[-1][3])-int(unknown[-1][3])),1)
        invalid=self.login(self.client('127.0.0.22'),'1234')
        self.assertEqual((invalid.status_code,invalid.json()),(known[0][0],known[0][1]))

    def test_reservation_is_atomic_and_bounds_unfinished_attempts(self):
        _,key=accounts.login_key(accounts.Login(country='US',phone='2025550123',password='x'));now=time.time()
        decisions=[]
        for index in range(7):
            with store.db() as c:
                c.execute('BEGIN IMMEDIATE');decisions.append(accounts.reserve_login(c,'127.0.0.%d'%index,key,now))
        # Reservations without a completed hash count as failures: never more than five.
        self.assertTrue(all(rowid for rowid,_ in decisions[:5]))
        self.assertEqual([rowid for rowid,_ in decisions[5:]],[None,None])
        decisions=[]
        for index in range(11):
            with store.db() as c:
                c.execute('BEGIN IMMEDIATE');decisions.append(accounts.reserve_login(c,'192.0.2.1','account-%d'%index,now))
        self.assertEqual(sum(1 for rowid,_ in decisions if rowid),10);self.assertIsNone(decisions[-1][0])

    def test_concurrent_attempts_cannot_pass_the_account_limit(self):
        release=threading.Event();entered=[];answers=[];lock=threading.Lock()
        def slow(password_hash,password):
            with lock:entered.append(1)
            release.wait(5);return False
        def attempt(index):
            request=SimpleNamespace(client=SimpleNamespace(host='198.51.100.%d'%index),headers={})
            try:accounts.authenticate(accounts.Login(country='US',phone='2025550123',password='wrong'),request,Response())
            except HTTPException as exc:
                with lock:answers.append(exc.status_code)
        with patch.object(accounts,'verify_password',side_effect=slow):
            threads=[threading.Thread(target=attempt,args=(index,)) for index in range(8)]
            for thread in threads:thread.start()
            deadline=time.time()+5
            while time.time()<deadline and len(entered)+len(answers)<8:time.sleep(.01)
            self.assertEqual(len(entered),5);self.assertEqual(sorted(answers),[429,429,429])
            release.set()
            for thread in threads:thread.join(5)
        self.assertEqual(sorted(answers),[401]*5+[429]*3)

    def lock(self,phone,first_address):
        for index in range(5):self.assertEqual(self.login(self.client('127.0.0.%d'%(first_address+index)),phone).status_code,401)
        self.assertEqual(self.login(self.client('127.0.0.%d'%(first_address+5)),phone,'fixture-password-only').status_code,429)

    def test_recovery_and_admin_password_reset_lift_the_account_lock(self):
        accounts.register(accounts.Registration(name='Admin fixture',country='GB',phone='02079460018',password='fixture-password-only'),Response(),admin=True)
        with store.db() as c:uid=c.execute("SELECT id FROM accounts WHERE phone='+12025550123'").fetchone()[0]
        # Recovery link: proven ownership of the e-mail lifts the lock at once.
        self.lock('2025550123',30)
        token='fixture-recovery-token-'+'x'*20
        with store.db() as c:c.execute("INSERT INTO password_resets(digest,user_id,created,expires,used,outbox_id) VALUES(?,?,?,?,0,'fixture')",(hashlib.sha256(token.encode()).hexdigest(),uid,time.time(),time.time()+1200))
        confirmed=self.client('127.0.0.40').post('/api/auth/recovery/confirm',json={'token':token,'password':'recovered-fixture-password'},headers=self.headers)
        self.assertEqual(confirmed.status_code,200,confirmed.text);self.assertEqual(self.rows('2025550123'),0)
        self.assertEqual(self.login(self.client('127.0.0.41'),'2025550123','recovered-fixture-password').status_code,200)
        # Administrator reset: same effect, and only for that account.
        self.lock('2025550123',50);self.lock('2025550144',60)
        administrator=self.client('127.0.0.70')
        self.assertEqual(administrator.post('/api/auth/login',json={'country':'GB','phone':'02079460018','password':'fixture-password-only'},headers=self.headers).status_code,200)
        reset=administrator.put('/api/admin/users/'+uid+'/password',json={'password':'admin-set-fixture-password'},headers=self.headers)
        self.assertEqual(reset.status_code,200,reset.text);self.assertEqual(self.rows('2025550123'),0);self.assertEqual(self.rows('2025550144'),5)
        self.assertEqual(self.login(self.client('127.0.0.71'),'2025550123','admin-set-fixture-password').status_code,200)
        self.assertEqual(self.login(self.client('127.0.0.72'),'2025550144','fixture-password-only').status_code,429)

    def test_account_key_is_an_hmac_with_a_private_server_secret(self):
        phone,key=accounts.login_key(accounts.Login(country='US',phone='(202) 555-0123',password='x'))
        path=store.DATA_DIR/accounts.LIMIT_SECRET_FILE
        self.assertEqual(stat.S_IMODE(path.stat().st_mode),0o600)
        secret=bytes.fromhex(json.loads(path.read_text())['secret']);self.assertEqual(len(secret),32)
        self.assertEqual(key,hmac.new(secret,phone.encode(),hashlib.sha256).hexdigest())
        self.assertNotEqual(key,hashlib.sha256(phone.encode()).hexdigest())
        self.assertEqual(accounts.login_key(accounts.Login(country='US',phone='2025550123',password='y'))[1],key)
        # Stored attempts hold neither the typed phone nor its unsalted digest.
        self.assertEqual(self.login(self.client(),'2025550123').status_code,401)
        self.assertEqual(self.login(self.client(),'1234').status_code,401)
        with store.db() as c:stored=[tuple(r) for r in c.execute('SELECT address,account FROM login_attempts')]
        self.assertEqual({account for _,account in stored},{key,accounts.limit_key('invalid:US:1234')})
        for value in (phone,phone[1:],'2025550123',hashlib.sha256(phone.encode()).hexdigest()):self.assertNotIn(value,json.dumps(stored))
        # Another server secret gives other keys; an unreadable secret file is replaced.
        with tempfile.TemporaryDirectory() as other,patch.object(store,'DATA_DIR',Path(other)):
            self.assertNotEqual(accounts.login_key(accounts.Login(country='US',phone='2025550123',password='x'))[1],key)
            (Path(other)/accounts.LIMIT_SECRET_FILE).write_text('not json')
            replaced=accounts.login_key(accounts.Login(country='US',phone='2025550123',password='x'))[1]
            self.assertEqual(replaced,accounts.login_key(accounts.Login(country='US',phone='2025550123',password='x'))[1])
            self.assertEqual(stat.S_IMODE((Path(other)/accounts.LIMIT_SECRET_FILE).stat().st_mode),0o600)

    def test_counters_under_the_former_unsalted_digest_no_longer_count_and_expire(self):
        legacy=hashlib.sha256(b'+12025550123').hexdigest();now=time.time()
        with store.db() as c:
            c.executemany('INSERT INTO login_attempts(address,created,account) VALUES(?,?,?)',[('198.51.100.%d'%index,now-index,legacy) for index in range(6)])
            c.execute('INSERT INTO login_attempts(address,created,account) VALUES(?,?,?)',('198.51.100.9',now-accounts.LOGIN_HISTORY-1,legacy))
        self.assertEqual(self.login(self.client(),'2025550123','fixture-password-only').status_code,200)
        with store.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM login_attempts WHERE account=?',(legacy,)).fetchone()[0],6)

    def test_progressive_lock_steps_cap_and_series_reset(self):
        lock=accounts.account_lock_until
        self.assertEqual(lock([0,1,2,3]),0)
        self.assertEqual(lock([0,1,2,3,4]),4+60)
        times=[0,1,2,3,4];expected=[]
        for _ in range(6):
            times.append(lock(times));expected.append(lock(times)-times[-1])
        self.assertEqual(expected,[120,240,480,900,900,900])
        # Five failures spread beyond 15 minutes do not lock.
        self.assertEqual(lock([0,400,800,1200,1600]),0)
        # One hour without failures starts a new series.
        self.assertEqual(lock([0,1,2,3,4,5000]),0)

    def test_password_work_is_bounded_and_busy_attempts_are_not_failures(self):
        slots=threading.BoundedSemaphore(1);slots.acquire()
        with patch.object(accounts,'PASSWORD_SLOTS',slots),patch.object(accounts,'PASSWORD_WAIT',.05):
            busy=self.login(self.client(),'6502530000','fixture-password-only')
            self.assertEqual(busy.status_code,503);self.assertEqual(busy.json()['detail'],accounts.BUSY);self.assertIn('retry-after',busy.headers)
            registration=self.client().post('/api/auth/register',json={'name':'Busy fixture','country':'GB','phone':'02079460018','password':'fixture-password-only'},headers=self.headers)
            self.assertEqual(registration.status_code,503)
            with self.assertRaises(HTTPException) as caught:accounts.hash_password('fixture-password-only')
            self.assertEqual(caught.exception.status_code,503)
        self.assertEqual(self.rows('6502530000'),0)
        self.assertEqual(self.login(self.client(),'6502530000','fixture-password-only').status_code,200)

    def test_at_most_four_password_checks_run_together(self):
        active=[0];peak=[0];lock=threading.Lock()
        def slow(*args):
            with lock:active[0]+=1;peak[0]=max(peak[0],active[0])
            time.sleep(.15)
            with lock:active[0]-=1
            return True
        # A longer wait than production: all eight checks run, never more than four at once.
        with patch.object(accounts,'HASHER') as hasher,patch.object(accounts,'PASSWORD_WAIT',2.0):
            hasher.verify.side_effect=slow
            threads=[threading.Thread(target=accounts.verify_password,args=('hash','password')) for _ in range(8)]
            for thread in threads:thread.start()
            for thread in threads:thread.join(5)
        self.assertEqual(peak[0],4)

    def test_waiting_for_a_password_slot_is_short(self):
        # Waiting requests hold threads of the pool shared by every synchronous route.
        self.assertLessEqual(accounts.PASSWORD_WAIT,.3)
        slots=threading.BoundedSemaphore(1);slots.acquire()
        with patch.object(accounts,'PASSWORD_SLOTS',slots):
            started=time.monotonic()
            with self.assertRaises(HTTPException):accounts.verify_password(accounts.DUMMY_HASH,'fixture-password-only')
        self.assertLess(time.monotonic()-started,1)

    def test_ipv6_addresses_share_the_address_limit_of_their_64_prefix(self):
        self.assertEqual(accounts.limit_address('2001:db8:1:2:aaaa:bbbb:cccc:dddd'),'2001:db8:1:2::/64')
        self.assertEqual(accounts.limit_address('::ffff:198.51.100.7'),'198.51.100.7')
        self.assertEqual(accounts.limit_address('198.51.100.7'),'198.51.100.7')
        self.assertEqual(accounts.limit_address('testclient'),'testclient')
        def attempt(host,phone):
            request=SimpleNamespace(client=SimpleNamespace(host=host),headers={})
            try:accounts.authenticate(accounts.Login(country='US',phone=phone,password='wrong-password-fixture'),request,Response())
            except HTTPException as exc:return exc.status_code
        # Ten failures from ten addresses of one /64, each against another phone (no account lock).
        self.assertEqual([attempt('2001:db8:1:2::%x'%(index+1),'20255501%02d'%(50+index)) for index in range(10)],[401]*10)
        self.assertEqual(attempt('2001:db8:1:2:ffff::9','2025550170'),429)
        # Another /64 and IPv4 keep their own counters; IPv4-mapped addresses count as IPv4.
        self.assertEqual(attempt('2001:db8:1:3::1','2025550171'),401)
        self.assertEqual(attempt('::ffff:198.51.100.7','2025550172'),401)
        with store.db() as c:stored={r[0] for r in c.execute('SELECT DISTINCT address FROM login_attempts')}
        self.assertEqual(stored,{'2001:db8:1:2::/64','2001:db8:1:3::/64','198.51.100.7'})


if __name__=='__main__':unittest.main()
