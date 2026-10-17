"""Accounts and access boundaries use temporary data, without messages or collectors."""
import test_isolation  # noqa: F401 - first: temporary data, no seed, idle workers
import importlib
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend import store,mail,accounts
from backend.domain import Search,Leg
from backend.engine import persist_snapshots,Monitor


class AccountTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.folder=Path(self.temp.name)
        self.patches=[patch.object(store,'DATA_DIR',self.folder),patch.object(mail,'DATA_DIR',self.folder),patch.object(mail,'SETTINGS_FILE',self.folder/'smtp-private.json')]
        for item in self.patches:item.start()
        store.setup(seed=False);self.module=importlib.import_module('backend.app')
        self.a=TestClient(self.module.app);self.b=TestClient(self.module.app)
        self.headers={'x-radar-token':self.module.TOKEN}

    def tearDown(self):
        self.a.close();self.b.close()
        for item in self.patches:item.stop()
        self.temp.cleanup()

    def register(self,client=None,phone='6502530000',country='US',admin=False,**extra):
        payload={'name':'Conta Teste','country':country,'phone':phone,'password':'a-test-password-only','emails':['first@example.org']}|extra
        return (client or self.a).post('/api/auth/bootstrap' if admin else '/api/auth/register',json=payload,headers=self.headers)

    def config(self):
        return Search(name='Minha busca privada',origins=['LHR'],destinations=['JFK'],outbound=Leg(start='2090-11-05T00:00',end='2090-11-05T23:59'),target_cents=120000).model_dump()

    def test_access_audit_records_login_metadata_and_scopes_users(self):
        self.register();self.register(self.b,phone='02079460018',country='GB')
        headers={**self.headers,'user-agent':'Mozilla/5.0 (Macintosh) Chrome/130.0 Safari/537.36','x-forwarded-for':'198.51.100.9'}
        result=self.a.post('/api/auth/login',json={'phone':'6502530000','country':'US','password':'a-test-password-only'},headers=headers)
        self.assertEqual(result.status_code,200,result.text)
        entries=self.a.get('/api/audit').json();latest=entries[0]
        self.assertEqual(latest['event'],'login_success');self.assertEqual(latest['browser'],'Chrome');self.assertEqual(latest['system'],'macOS')
        self.assertEqual(latest['ip'],'testclient');self.assertNotIn('a-test-password-only',json.dumps(entries));self.assertNotIn('radar_session',json.dumps(entries))
        own_id=result.json()['id'];self.assertTrue(all(e['user_id']==own_id for e in entries))
        self.assertEqual(self.a.get('/api/admin/audit').status_code,403)
        self.assertTrue(all(e['user_id']!=own_id for e in self.b.get('/api/audit').json()))
        self.a.post('/api/auth/login',json={'phone':'6502530000','country':'US','password':'wrong-password'},headers=headers)
        self.assertEqual(self.a.get('/api/audit').json()[0]['event'],'login_failed')
        self.a.post('/api/auth/logout',json={},headers=self.headers)
        with store.db() as c:self.assertEqual(c.execute('SELECT event FROM access_audit ORDER BY id DESC LIMIT 1').fetchone()[0],'logout')

    def test_archived_history_and_full_export_remain_owner_only(self):
        self.register();self.register(self.b,phone='02079460018',country='GB')
        sid=self.a.post('/api/searches',json=self.config(),headers=self.headers).json()['id']
        with store.db() as c:
            cid=c.execute("INSERT INTO cycles(search_id,version,started,status,total) VALUES(?,1,?,'scheduled',1)",(sid,time.time())).lastrowid
            for i in range(180):
                c.execute("INSERT INTO snapshots(search_id,version,cycle_id,direction,collected,complete,price,count) VALUES(?,1,?,'outbound',?,1,?,1)",(sid,cid,time.time()-18000+i*100,100000-i))
        self.a.post('/api/searches/'+sid+'/action',json={'action':'archive'},headers=self.headers)
        state=self.a.get('/api/state',params={'search_id':sid}).json()
        self.assertEqual(state['selected']['id'],sid);self.assertEqual(state['selected']['state'],'ended');self.assertEqual(len(state['searches']),0)
        self.assertEqual(len(self.a.get('/api/export/'+sid).json()['history']),180)
        trend=self.a.get('/api/searches/'+sid+'/trend').json();self.assertEqual(trend['versions'],[1]);self.assertEqual(trend['points'][0]['price'],100000)
        self.assertEqual(self.b.get('/api/searches/'+sid+'/trend').status_code,404);self.assertEqual(self.b.get('/api/export/'+sid).status_code,404)
        self.assertEqual(self.a.post('/api/searches/'+sid+'/restore',json={},headers=self.headers).status_code,200)
        self.assertTrue(self.a.get('/api/state').json()['selected']['active'])

    def test_admin_can_read_access_audit_and_unknown_failures(self):
        admin=TestClient(self.module.app,base_url='http://127.0.0.1:8765',client=('127.0.0.1',4444))
        try:
            response=self.register(admin,admin=True)
            self.assertEqual(response.status_code,200,response.text)
            self.b.post('/api/auth/login',json={'country':'US','phone':'6502530000','password':'wrong-password'},headers=self.headers)
            response=admin.get('/api/admin/audit')
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(response.json()[0]['event'],'login_failed')
            self.assertNotIn('wrong-password',response.text)
        finally:admin.close()

    def test_trend_preserves_the_timestamp_of_each_bucket_minimum(self):
        self.register();sid=self.a.post('/api/searches',json=self.config(),headers=self.headers).json()['id']
        with store.db() as c:
            cid=c.execute("INSERT INTO cycles(search_id,version,started,status,total) VALUES(?,1,?,'scheduled',1)",(sid,time.time())).lastrowid
            for index in range(1000):
                c.execute("INSERT INTO snapshots(search_id,version,cycle_id,direction,collected,complete,price,count) VALUES(?,1,?,'outbound',?,1,?,1)",(sid,cid,2000000000+index,100000-index))
        data=self.a.get('/api/searches/'+sid+'/trend').json()
        self.assertLessEqual(len(data['points']),241)
        for point in data['points']:
            self.assertEqual(point['price'],100000-(point['collected']-2000000000))
        self.assertEqual(data['points'][-1]['price'],99001)

    def test_alert_schema_allows_a_new_cycle_with_the_same_price(self):
        self.register();sid=self.a.post('/api/searches',json=self.config(),headers=self.headers).json()['id']
        with store.db() as c:
            for index in (1,2):
                cid=c.execute("INSERT INTO cycles(search_id,version,started,status,total) VALUES(?,1,?,'scheduled',1)",(sid,time.time())).lastrowid
                c.execute("INSERT INTO alerts(id,search_id,version,cycle_id,direction,created,kind,price,payload,status) VALUES(?,?,1,?,'outbound',?,'lower_price',100000,'{}','in_app')",(str(index),sid,cid,time.time()))
            self.assertEqual(c.execute('SELECT COUNT(*) FROM alerts').fetchone()[0],2)

    def test_legacy_alert_migration_preserves_existing_events(self):
        self.register();sid=self.a.post('/api/searches',json=self.config(),headers=self.headers).json()['id']
        with store.db() as c:
            schema=c.execute("SELECT sql FROM sqlite_master WHERE name='alerts'").fetchone()[0]
            c.execute(schema.replace('CREATE TABLE alerts','CREATE TABLE alerts_legacy').replace('direction,kind,cycle_id','direction,kind,price'))
            c.execute('DROP TABLE alerts');c.execute('ALTER TABLE alerts_legacy RENAME TO alerts')
            cid=c.execute("INSERT INTO cycles(search_id,version,started,status,total) VALUES(?,1,?,'scheduled',1)",(sid,time.time())).lastrowid
            c.execute("INSERT INTO alerts(id,search_id,version,cycle_id,direction,created,kind,price,payload,status) VALUES('preserved',?,1,?,'outbound',?,'lower_price',100000,'{}','in_app')",(sid,cid,time.time()))
        store.setup(seed=False)
        with store.db() as c:
            self.assertEqual(c.execute('SELECT id FROM alerts').fetchone()[0],'preserved')
            self.assertIn('direction,kind,cycle_id',c.execute("SELECT sql FROM sqlite_master WHERE name='alerts'").fetchone()[0])
            self.assertEqual(c.execute('PRAGMA foreign_key_check').fetchall(),[])

    def test_access_audit_prunes_old_events_in_maintenance_without_recording_credentials(self):
        from backend import audit
        from types import SimpleNamespace
        request=SimpleNamespace(client=SimpleNamespace(host='192.168.3.10'),headers={'user-agent':'Firefox/130.0'})
        audit.record(request,'login_failed')
        with store.db() as c:c.execute('UPDATE access_audit SET created=?',(time.time()-91*86400,))
        audit.record(request,'login_failed')
        # Recording never prunes; the hourly maintenance applies the 90-day retention.
        with store.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM access_audit').fetchone()[0],2)
        audit.cleanup()
        with store.db() as c:
            rows=[dict(r) for r in c.execute('SELECT * FROM access_audit')]
        self.assertEqual(len(rows),1);self.assertNotIn('password',json.dumps(rows))

    def test_language_preference_is_validated_and_owned(self):
        self.register();self.register(self.b,phone='02079460018',country='GB')
        self.assertEqual(self.a.put('/api/profile/language',json={'language':'es'},headers=self.headers).status_code,200)
        self.assertEqual(self.a.get('/api/auth/session').json()['user']['language'],'es')
        self.assertEqual(self.b.get('/api/auth/session').json()['user']['language'],'pt')
        self.assertEqual(self.a.put('/api/profile/language',json={'language':'fr'},headers=self.headers).status_code,422)

    def test_telegram_contact_is_validated_saved_and_private(self):
        user=self.register(telegram_username='@travel_person').json()
        self.assertEqual(user['telegram_username'],'travel_person')
        response=self.a.put('/api/profile',json={'name':'Updated name','emails':['one@example.org'],'telegram_username':'@other_person'},headers=self.headers)
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['telegram_username'],'other_person')
        response=self.a.put('/api/profile',json={'name':'Updated name','telegram_username':'https://evil.example/'},headers=self.headers)
        self.assertEqual(response.status_code,422)
        self.assertEqual(self.a.get('/api/state').json()['user']['telegram_username'],'other_person')

    def test_regular_user_state_does_not_expose_administration(self):
        self.register()
        state=self.a.get('/api/state').json()
        self.assertIsNone(state['smtp']);self.assertIsNone(state['google_mail']);self.assertIsNone(state['mail_test_recipient'])
        for path in ('/api/mail/connect','/api/google/disconnect','/api/smtp/test'):
            self.assertEqual(self.a.post(path,json={'email':'someone@gmail.com'},headers=self.headers).status_code,403)
        self.assertEqual(self.a.post('/api/smtp/test',json={},headers=self.headers).status_code,403)

    def test_owner_can_delete_monitoring_and_other_account_cannot(self):
        self.register();self.register(self.b,phone='02079460018',country='GB')
        sid=self.a.post('/api/searches',json=self.config(),headers=self.headers).json()['id']
        self.assertEqual(self.b.delete('/api/searches/'+sid,headers=self.headers).status_code,404)
        self.assertEqual(self.a.delete('/api/searches/'+sid,headers=self.headers).status_code,200)
        with store.db() as c:self.assertIsNone(c.execute('SELECT id FROM searches WHERE id=?',(sid,)).fetchone())
        self.assertEqual(self.a.get('/api/state').json()['searches'],[])

    def test_deletion_removes_related_history_and_blocks_during_send(self):
        self.register();sid=self.a.post('/api/searches',json=self.config(),headers=self.headers).json()['id']
        with store.db() as c:
            cid=c.execute("INSERT INTO cycles(search_id,version,started,status,total) VALUES(?,1,?,'running',0)",(sid,time.time())).lastrowid
            c.execute("INSERT INTO results(cycle_id,search_id,version,direction,route_key,collected,status,data) VALUES(?,?,1,'outbound','fixture',?,'empty','{}')",(cid,sid,time.time()))
            c.execute("INSERT INTO outbox(id,search_id,version,created,alert_ids,subject,body,status,next_due,recipients) VALUES('delete-fixture',?,1,?,'[]','fixture','fixture','sending',?,'[]')",(sid,time.time(),time.time()))
        self.assertEqual(self.a.delete('/api/searches/'+sid,headers=self.headers).status_code,409)
        with store.db() as c:c.execute("UPDATE outbox SET status='failed'")
        self.assertEqual(self.a.delete('/api/searches/'+sid,headers=self.headers).status_code,200)
        with store.db() as c:
            for table in ('searches','cycles','results','outbox'):
                self.assertEqual(c.execute('SELECT COUNT(*) FROM '+table).fetchone()[0],0)

    def test_expired_monitoring_stops_without_queries(self):
        from backend.domain import monitoring_deadline
        self.register();sid=self.a.post('/api/searches',json=self.config(),headers=self.headers).json()['id']
        with store.db() as c:row=dict(c.execute('SELECT * FROM searches WHERE id=?',(sid,)).fetchone())
        deadline=monitoring_deadline(Search.model_validate_json(row['config']))
        with patch('backend.engine.time.time',return_value=deadline),patch('backend.engine.fetch') as fetch:
            Monitor().run_cycle(row);fetch.assert_not_called()
        with store.db() as c:
            ended=c.execute('SELECT * FROM searches WHERE id=?',(sid,)).fetchone()
            self.assertEqual(ended['state'],'expired');self.assertEqual(ended['active'],0);self.assertIsNone(ended['next_due'])

    def test_return_keeps_monitoring_after_outbound_and_skips_old_dates(self):
        from backend.domain import local_instant
        self.register();config=self.config();config['inbound']=Leg(start='2090-11-09T00:00',end='2090-11-10T23:59').model_dump()
        sid=self.a.post('/api/searches',json=config,headers=self.headers).json()['id']
        with store.db() as c:row=dict(c.execute('SELECT * FROM searches WHERE id=?',(sid,)).fetchone())
        now=local_instant('2090-11-10T12:00','JFK').timestamp()
        def empty(search,job):
            direction,origin,destination,date=job
            return dict(status='empty',flights=[],direction=direction,origin=origin,destination=destination,date=date,collected_at=now)
        with patch('backend.engine.time.time',return_value=now),patch('backend.engine.fetch',side_effect=empty) as fetch:
            Monitor().run_cycle(row)
            self.assertEqual(fetch.call_count,1)
            self.assertEqual(fetch.call_args.args[1],('inbound','JFK','LHR','2090-11-10'))
        with store.db() as c:self.assertEqual(c.execute('SELECT active FROM searches WHERE id=?',(sid,)).fetchone()[0],1)

    def test_deletion_while_collecting_does_not_recreate_history(self):
        self.register();sid=self.a.post('/api/searches',json=self.config(),headers=self.headers).json()['id']
        with store.db() as c:row=dict(c.execute('SELECT * FROM searches WHERE id=?',(sid,)).fetchone())
        def remove(search,job):
            response=self.a.delete('/api/searches/'+sid,headers=self.headers)
            self.assertEqual(response.status_code,200,response.text)
            return {'status':'empty','flights':[],'direction':job[0],'origin':job[1],'destination':job[2],'date':job[3],'collected_at':time.time()}
        with patch('backend.engine.fetch',side_effect=remove):Monitor().run_cycle(row)
        with store.db() as c:
            for table in ('cycles','results','snapshots'):
                self.assertEqual(c.execute('SELECT COUNT(*) FROM '+table).fetchone()[0],0)

    def test_currency_change_creates_new_reference_version(self):
        self.register();config=self.config()
        sid=self.a.post('/api/searches',json=config,headers=self.headers).json()['id']
        response=self.a.put('/api/searches/'+sid,json=config|{'currency':'USD'},headers=self.headers)
        self.assertEqual(response.status_code,200,response.text)
        state=self.a.get('/api/state').json()['selected']
        self.assertEqual(state['version'],2);self.assertEqual(state['config']['currency'],'USD')
        self.assertGreater(state['ends_at'],time.time())

    def test_international_phone_normalization_and_duplicate_login(self):
        result=self.register(phone='(650) 253-0000')
        self.assertEqual(result.status_code,200,result.text)
        user=result.json();self.assertEqual(user['phone'],'+16502530000');self.assertFalse(user['phone_verified'])
        self.assertEqual(user['whatsapp_phone'],user['phone'])
        self.assertEqual(self.register(self.b,phone='+1 650 253 0000').status_code,409)
        cookie=result.headers['set-cookie'];self.assertIn('HttpOnly',cookie);self.assertIn('SameSite=strict',cookie)
        with store.db() as c:
            row=c.execute('SELECT password_hash FROM accounts').fetchone()
            self.assertTrue(row[0].startswith('$argon2id$'));self.assertNotIn('a-test-password-only',row[0])
        self.assertNotIn('password',json.dumps(user))

    def test_brazil_uk_and_invalid_phone(self):
        self.assertEqual(accounts.phone_e164('(11) 98765-4321','BR'),'+5511987654321')
        self.assertEqual(accounts.phone_e164('020 7946 0018','GB'),'+442079460018')
        self.assertEqual(self.register(phone='1234').status_code,422)
        self.assertEqual(self.register(country='XX').status_code,422)

    def test_email_limits_validation_and_normalization(self):
        emails=['first@example.org','second@example.org','third@example.org','fourth@example.org']
        result=self.register(emails=emails);self.assertEqual(result.status_code,200,result.text)
        profile={k:result.json()[k] for k in ['name','emails','whatsapp_use_login','whatsapp_country','whatsapp_phone']}
        profile['emails']=emails+['fifth@example.org']
        self.assertEqual(self.a.put('/api/profile',json=profile,headers=self.headers).status_code,422)
        profile['emails']=['bad\naddress@example.org']
        self.assertEqual(self.a.put('/api/profile',json=profile,headers=self.headers).status_code,422)
        profile['emails']=[' FIRST@EXAMPLE.ORG ','first@example.org']
        normalized=self.a.put('/api/profile',json=profile,headers=self.headers)
        self.assertEqual(normalized.status_code,200,normalized.text)
        self.assertEqual(len(normalized.json()['emails']),1)

    def test_whatsapp_can_reuse_login_or_another_international_number(self):
        user=self.register().json()
        profile={'name':user['name'],'emails':[],'whatsapp_use_login':False,'whatsapp_country':'GB','whatsapp_phone':'02079460018'}
        result=self.a.put('/api/profile',json=profile,headers=self.headers)
        self.assertEqual(result.status_code,200,result.text);self.assertEqual(result.json()['whatsapp_phone'],'+442079460018')
        profile['whatsapp_use_login']=True
        result=self.a.put('/api/profile',json=profile,headers=self.headers)
        self.assertEqual(result.json()['whatsapp_phone'],user['phone'])

    def test_session_login_logout_and_password_are_private(self):
        self.assertEqual(self.a.get('/api/state').status_code,401)
        self.register()
        self.a.post('/api/auth/logout',json={},headers=self.headers)
        self.assertEqual(self.a.get('/api/state').status_code,401)
        result=self.a.post('/api/auth/login',json={'country':'US','phone':'6502530000','password':'a-test-password-only'},headers=self.headers)
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(self.a.get('/api/state').status_code,200)
        self.assertNotIn('password_hash',self.a.get('/api/state').text)

    def test_regular_user_cannot_read_or_change_smtp_even_with_forged_role(self):
        self.register(role='admin')
        state=self.a.get('/api/state').json()
        self.assertEqual(state['user']['role'],'user');self.assertIsNone(state['smtp'])
        payload=mail.SMTPSettings(enabled=True,host='smtp.example.org',sender='from@example.org',recipient='test@example.org').model_dump()
        self.assertEqual(self.a.put('/api/smtp',json=payload,headers=self.headers).status_code,403)
        self.assertEqual(self.a.post('/api/smtp/test',json={},headers=self.headers).status_code,403)

    def test_searches_exports_and_archive_are_isolated_per_account(self):
        self.register();self.register(self.b,phone='02079460018',country='GB')
        sid=self.a.post('/api/searches',json=self.config(),headers=self.headers).json()['id']
        self.assertEqual(len(self.b.get('/api/state').json()['searches']),0)
        self.assertEqual(self.b.get('/api/export/'+sid).status_code,404)
        self.assertEqual(self.b.put('/api/searches/'+sid,json=self.config(),headers=self.headers).status_code,404)
        self.assertEqual(self.b.post('/api/searches/'+sid+'/action',json={'action':'archive'},headers=self.headers).status_code,404)
        self.a.post('/api/searches/'+sid+'/action',json={'action':'archive'},headers=self.headers)
        self.assertEqual(self.b.post('/api/searches/'+sid+'/restore',json={},headers=self.headers).status_code,404)

    def test_first_admin_claims_legacy_searches_once(self):
        with store.db() as c:legacy=store.add_search(c,Search.model_validate(self.config()))
        self.register(self.b,phone='02079460018',country='GB')
        self.assertEqual(self.b.get('/api/state').json()['searches'],[])
        result=self.register(admin=True);self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(result.json()['role'],'admin')
        state=self.a.get('/api/state').json();self.assertEqual(state['searches'][0]['id'],legacy);self.assertIsNotNone(state['smtp'])
        self.assertEqual(self.register(admin=True,phone='11987654321',country='BR').status_code,403)

    def test_lan_cannot_create_the_first_admin(self):
        with patch.dict('os.environ',{'RADAR_LAN_CIDR':'192.168.3.0/24'}):
            client=TestClient(self.module.app,base_url='http://192.168.3.42:8765',client=('192.168.3.10',1234))
            try:
                self.assertFalse(client.get('/api/auth/session').json()['can_bootstrap'])
                self.assertEqual(self.register(client,admin=True).status_code,403)
            finally:client.close()

    def test_login_failures_are_rate_limited(self):
        with patch.object(accounts,'HASHER') as hasher:
            hasher.verify.return_value=False
            for _ in range(5):
                self.assertEqual(self.a.post('/api/auth/login',json={'country':'US','phone':'6502530000','password':'wrong'},headers=self.headers).status_code,401)
            # The fifth failure in 15 minutes locks the account for one minute.
            limited=self.a.post('/api/auth/login',json={'country':'US','phone':'6502530000','password':'wrong'},headers=self.headers)
            self.assertEqual(limited.status_code,429);self.assertEqual(limited.json()['detail'],accounts.THROTTLED)
            self.assertTrue(55<=int(limited.headers['retry-after'])<=60)
            self.assertEqual(hasher.verify.call_count,5)

    def test_queue_uses_account_emails_and_never_global_test_recipient(self):
        emails=['one@example.org','two@example.org','three@example.org','four@example.org']
        self.register(emails=emails)
        sid=self.a.post('/api/searches',json=self.config(),headers=self.headers).json()['id']
        mail.save_settings(mail.SMTPSettings(enabled=True,host='smtp.example.org',sender='from@example.org',recipient='admin-test@example.org'))
        flight={'id':'fixture','origin':'LHR','destination':'JFK','departure':'2090-11-05T12:00','arrival':'2090-11-05T15:00','duration_minutes':480,'stops':0,'layovers':[],'airlines':['British Airways'],'price_cents':50000,'adults':1,'collected_at':time.time(),'search_url':'https://www.google.com/travel/flights'}
        with store.db() as c:
            cid=c.execute('INSERT INTO cycles(search_id,version,started,status,total) VALUES(?,?,?,?,?)',(sid,1,time.time(),'running',1)).lastrowid
            persist_snapshots(c,sid,1,cid,Search.model_validate(self.config()),[{'direction':'outbound','status':'ok','flights':[flight]}])
            self.assertEqual(json.loads(c.execute('SELECT recipients FROM outbox').fetchone()[0]),emails)
        with patch.object(mail,'transmit') as transmit:
            Monitor().send_one()
            self.assertEqual(transmit.call_args.args[0]['recipient'],emails)
            self.assertNotIn('admin-test@example.org',transmit.call_args.args[0]['recipient'])

    def test_existing_local_account_can_become_first_admin_with_its_password(self):
        self.register()
        self.assertEqual(self.register(admin=True,password='different-password').status_code,409)
        result=self.register(admin=True)
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(result.json()['role'],'admin')
        with store.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM accounts').fetchone()[0],1)

    def test_changing_emails_cancels_pending_mail_to_old_contacts(self):
        user=self.register().json()
        sid=self.a.post('/api/searches',json=self.config(),headers=self.headers).json()['id']
        with store.db() as c:
            c.execute("INSERT INTO outbox(id,search_id,version,created,alert_ids,subject,body,status,next_due,recipients) VALUES(?,?,1,?,'[]','fixture','fixture','pending',?,?)",('queued-fixture',sid,time.time(),time.time(),json.dumps(user['emails'])))
        result=self.a.put('/api/profile',json={'name':user['name'],'emails':['new@example.org'],'whatsapp_use_login':True},headers=self.headers)
        self.assertEqual(result.status_code,200,result.text)
        with store.db() as c:self.assertEqual(c.execute("SELECT status FROM outbox WHERE id='queued-fixture'").fetchone()[0],'cancelled')

    def test_smtp_transport_addresses_all_selected_recipients(self):
        from unittest.mock import MagicMock
        client=MagicMock();client.send_message.return_value={}
        config=mail.SMTPSettings(host='smtp.example.org',sender='sender@example.org',recipient='admin-test@example.org').model_dump()
        config['recipient']=['one@example.org','two@example.org','three@example.org','four@example.org']
        with patch.object(mail.smtplib,'SMTP',return_value=client):
            mail.transmit(config,'fixture','Test','No external message')
        message=client.send_message.call_args.args[0]
        self.assertEqual(len(message['To'].addresses),4)
        self.assertNotIn('admin-test@example.org',str(message['To']))
