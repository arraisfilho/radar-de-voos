"""Refinement regressions: no provider requests or messages leave these fixtures."""
import test_isolation  # noqa: F401 - first: temporary data, no seed, idle workers
import importlib
import json
import tempfile
import threading
import time
import unittest
from datetime import datetime,timezone
from email.message import Message
from pathlib import Path
from unittest.mock import patch,MagicMock
from fastapi.testclient import TestClient
from backend import store,mail,accounts,logos
from backend.domain import Search,Leg
from backend.engine import Monitor
from backend.query_gate import QueryGate

class RefinementTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.folder=Path(self.temp.name)
        self.patches=[patch.object(store,'DATA_DIR',self.folder),patch.object(mail,'DATA_DIR',self.folder),patch.object(mail,'SETTINGS_FILE',self.folder/'smtp.json'),patch.dict('os.environ',{'RADAR_PUBLIC_URL':'http://127.0.0.1:8765'})]
        for p in self.patches:p.start()
        store.setup(seed=False);self.module=importlib.import_module('backend.app');self.client=TestClient(self.module.app);self.headers={'x-radar-token':self.module.TOKEN}
        r=self.client.post('/api/auth/register',json={'name':'Fixture','country':'US','phone':'6502530000','password':'old-fixture-password','emails':['first@example.org','second@example.org']},headers=self.headers)
        self.assertEqual(r.status_code,200,r.text);self.user=r.json()
    def tearDown(self):
        self.client.close()
        for p in reversed(self.patches):p.stop()
        self.temp.cleanup()
    def search(self):
        config=Search(origins=['THE'],destinations=['GRU'],outbound=Leg(start='2090-11-05T00:00',end='2090-11-05T23:59')).model_dump()
        r=self.client.post('/api/searches',json=config,headers=self.headers);self.assertEqual(r.status_code,200,r.text)
        return r.json()['id'],config
    def test_fixed_interval_refresh_blocked_and_pause_resume_no_flood(self):
        sid,config=self.search();config['interval']=60
        self.assertEqual(self.client.put('/api/searches/'+sid,json=config,headers=self.headers).status_code,422)
        now=time.time()
        with store.db() as c:c.execute('UPDATE searches SET last_started=? WHERE id=?',(now,sid))
        for action in ('pause','resume'):
            self.assertEqual(self.client.post('/api/searches/'+sid+'/action',json={'action':action},headers=self.headers).status_code,200)
        self.assertGreaterEqual(self.client.get('/api/state').json()['selected']['next_due'],now+300)
    def test_manual_refresh_is_spaced_per_trip_and_capped_per_account(self):
        sid,_=self.search()
        refresh=lambda target=sid:self.client.post('/api/searches/'+target+'/action',json={'action':'refresh'},headers=self.headers)
        with store.db() as c:c.execute("UPDATE searches SET last_started=?,state='done',next_due=? WHERE id=?",(time.time()-120,time.time()+300,sid))
        self.assertEqual(refresh().status_code,200)
        with store.db() as c:self.assertEqual(c.execute('SELECT next_due FROM searches WHERE id=?',(sid,)).fetchone()[0],0,'A manual refresh goes to the front of the queue')
        again=refresh();self.assertEqual(again.status_code,429,'One refresh per trip every 60 s');self.assertIn('Retry-After',again.headers)
        self.assertGreater(self.client.get('/api/state').json()['selected']['refresh_after'],time.time()+50,'The page gets when the button frees again')
        with store.db() as c:c.execute("UPDATE searches SET state='collecting' WHERE id=?",(sid,));c.execute('UPDATE manual_refreshes SET at=at-120')
        self.assertEqual(refresh().status_code,409,'Not while the trip is collecting')
        with store.db() as c:
            c.execute("UPDATE searches SET state='done',last_started=? WHERE id=?",(time.time()-120,sid))
            owner=c.execute('SELECT owner_id FROM searches WHERE id=?',(sid,)).fetchone()[0]
            for n in range(10):c.execute('INSERT INTO manual_refreshes(owner_id,search_id,at) VALUES(?,?,?)',(owner,'other-'+str(n),time.time()-600))
        self.assertEqual(refresh().status_code,429,'At most ten manual refreshes per hour per account')
        with store.db() as c:c.execute("UPDATE searches SET active=0 WHERE id=?",(sid,))
        self.assertEqual(refresh().status_code,422,'A paused trip is resumed first')
        with store.db() as c:c.execute("UPDATE searches SET active=1 WHERE id=?",(sid,));c.execute('DELETE FROM manual_refreshes')
        with patch.object(self.module.source,'gate',return_value='paused'):self.assertEqual(refresh().status_code,503,'Not while the fare source is paused')
    def test_new_trip_goes_first(self):
        sid,_=self.search()
        with store.db() as c:self.assertEqual(c.execute('SELECT next_due FROM searches WHERE id=?',(sid,)).fetchone()[0],0)
    def test_preview_pool_is_owner_scoped_and_preserves_saved_filter_counts(self):
        sid,config=self.search();config['outbound']['max_duration']=60;config['outbound']['stops']=[0]
        self.assertEqual(self.client.put('/api/searches/'+sid,json=config,headers=self.headers).status_code,200)
        flights=[{'id':str(n),'direction':'outbound','origin':'THE','destination':'GRU','departure':'2090-11-05T12:00','arrival':'2090-11-05T18:00','duration_minutes':duration,'stops':stops,'price_cents':10000+n,'airlines':['LATAM'],'currency':'BRL'} for n,(duration,stops) in enumerate([(60,0),(120,1),(400,2)])]
        data={'status':'ok','origin':'THE','destination':'GRU','date':'2090-11-05','flights':flights}
        with store.db() as c:
            cid=c.execute("INSERT INTO cycles(search_id,version,started,status,total) VALUES(?,2,1,'done',1)",(sid,)).lastrowid
            c.execute("INSERT INTO results(cycle_id,search_id,version,direction,route_key,collected,status,data) VALUES(?,?,2,'outbound','fixture',1,'ok',?)",(cid,sid,json.dumps(data)))
            c.execute("INSERT INTO snapshots(search_id,version,cycle_id,direction,collected,complete,price,count) VALUES(?,2,?,'outbound',1,1,10000,1)",(sid,cid))
        saved=self.client.get('/api/state').json();self.assertEqual(len(saved['flights']),1);self.assertEqual(len(saved['history']),1)
        preview=self.client.get('/api/state',params={'preview_pool':True,'detail':False}).json()
        self.assertEqual(len(preview['flights']),3);self.assertEqual(preview['routes'][0]['count'],1)
        self.assertEqual(preview['history'],[]);self.assertEqual(preview['cycles'],[])
        self.assertEqual(preview['selected']['version'],saved['selected']['version'])
        other=TestClient(self.module.app)
        try:
            other.post('/api/auth/register',json={'name':'Other fixture','country':'GB','phone':'02079460018','password':'other-fixture-password'},headers=self.headers)
            response=other.get('/api/state',params={'search_id':sid,'preview_pool':True});self.assertEqual(response.status_code,404);self.assertNotIn('flights',response.json())
        finally:other.close()
        self.assertEqual(self.client.get('/api/state').json()['selected']['config']['outbound']['max_duration'],60)

    def cached_response(self,sid,version=1,status='ok',flights=None):
        flights=flights if flights is not None else [
            {'id':str(n),'direction':'outbound','origin':'THE','destination':'GRU',
             'departure':'2090-11-05T12:00','arrival':'2090-11-05T18:00',
             'duration_minutes':duration,'stops':stops,'price_cents':10000+n,
             'airlines':['LATAM'],'currency':'BRL','collected_at':123}
            for n,(duration,stops) in enumerate([(60,0),(120,1),(400,2)])]
        payload={'status':status,'origin':'THE','destination':'GRU','date':'2090-11-05',
                 'flights':flights,'error':'fixture failure' if status=='error' else None}
        with store.db() as c:
            cid=c.execute("INSERT INTO cycles(search_id,version,started,status,total) VALUES(?,?,123,'done',1)",(sid,version)).lastrowid
            return c.execute("INSERT INTO results(cycle_id,search_id,version,direction,route_key,collected,status,data) VALUES(?,?,?,'outbound','fixture',123,?,?)",(cid,sid,version,status,json.dumps(payload))).lastrowid

    def test_saved_filters_keep_raw_responses_and_apply_current_criteria(self):
        sid,config=self.search();rid=self.cached_response(sid)
        with patch('backend.engine.fetch') as fetch:
            for limit,expected in [(120,2),(60,1),(None,3)]:
                config['outbound']['max_duration']=limit
                saved=self.client.put('/api/searches/'+sid,json=config,headers=self.headers)
                self.assertTrue(saved.json()['results_reused'])
                result=self.client.get('/api/state').json()
                self.assertEqual(len(result['flights']),expected)
                self.assertEqual(result['routes'][0]['last_valid'],123)
                self.assertEqual(result['routes'][0]['raw_count'],3)
                home=self.client.get('/api/state',params={'scope':'home'}).json()
                self.assertEqual(home['searches'][0]['summary']['outbound'],{'price':10000,'collected':123})
                self.assertEqual(len(self.client.get('/api/state',params={'preview_pool':True}).json()['flights']),3)
            fetch.assert_not_called()
        with store.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM results WHERE search_id=?',(sid,)).fetchone()[0],1)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM filter_result_refs WHERE search_id=?',(sid,)).fetchone()[0],1)
            self.assertEqual(c.execute('SELECT result_id FROM filter_result_refs WHERE search_id=?',(sid,)).fetchone()[0],rid)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM snapshots WHERE search_id=?',(sid,)).fetchone()[0],0)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM alerts WHERE search_id=?',(sid,)).fetchone()[0],0)

    def test_filter_cache_zero_matches_can_be_relaxed_without_new_collection(self):
        sid,config=self.search();self.cached_response(sid)
        config['outbound']['start']='2090-11-05T18:00'
        self.client.put('/api/searches/'+sid,json=config,headers=self.headers)
        self.assertEqual(self.client.get('/api/state').json()['flights'],[])
        config['outbound']['start']='2090-11-05T00:00'
        self.client.put('/api/searches/'+sid,json=config,headers=self.headers)
        self.assertEqual(len(self.client.get('/api/state').json()['flights']),3)

    def test_new_source_results_replace_cache_and_errors_keep_stale_fallback(self):
        sid,config=self.search();self.cached_response(sid)
        self.client.put('/api/searches/'+sid,json=config,headers=self.headers)
        self.cached_response(sid,version=2,status='error',flights=[])
        response=self.client.get('/api/state').json()
        self.assertEqual(len(response['flights']),3)
        self.assertTrue(all(f['stale'] for f in response['flights']))
        self.assertTrue(response['routes'][0]['stale'])
        self.cached_response(sid,version=2,flights=[])
        self.assertEqual(self.client.get('/api/state').json()['flights'],[])
        self.client.put('/api/searches/'+sid,json=config,headers=self.headers)
        self.assertEqual(self.client.get('/api/state').json()['flights'],[])

    def test_source_changes_invalidate_cache_instead_of_relabeling_prices(self):
        changes=[{'destinations':['CGH']},{'currency':'USD'},{'adults':2},{'children':1},
                 {'checked_bags':1},{'cabin':'business'},
                 {'outbound':{'start':'2090-11-06T00:00','end':'2090-11-06T23:59'}}]
        for changed in changes:
            with self.subTest(changed=changed):
                sid,config=self.search();self.cached_response(sid)
                self.client.put('/api/searches/'+sid,json=config,headers=self.headers)
                next_config=config|changed
                if 'outbound' in changed:next_config['outbound']=config['outbound']|changed['outbound']
                result=self.client.put('/api/searches/'+sid,json=next_config,headers=self.headers)
                self.assertEqual(result.status_code,200,result.text)
                self.assertFalse(result.json()['results_reused'])
                self.assertEqual(self.client.get('/api/state',params={'search_id':sid}).json()['flights'],[])
                with store.db() as c:
                    self.assertEqual(c.execute('SELECT COUNT(*) FROM filter_result_refs WHERE search_id=?',(sid,)).fetchone()[0],0)
                    # Release the pilot's five-monitor quota without deleting fixture evidence.
                    c.execute('UPDATE searches SET archived=1,active=0 WHERE id=?',(sid,))

    def test_filter_references_are_removed_with_results(self):
        sid,config=self.search();rid=self.cached_response(sid)
        self.client.put('/api/searches/'+sid,json=config,headers=self.headers)
        with store.db() as c:
            c.execute('DELETE FROM results WHERE id=?',(rid,))
            self.assertEqual(c.execute('SELECT COUNT(*) FROM filter_result_refs').fetchone()[0],0)
            self.assertEqual(c.execute('PRAGMA foreign_key_check').fetchall(),[])

    def test_history_only_variations_all_collections_remain_exported(self):
        sid,_=self.search()
        with store.db() as c:
            cid=c.execute("INSERT INTO cycles(search_id,version,started,status,total) VALUES(?,1,1,'done',1)",(sid,)).lastrowid
            for i,price in enumerate([100,100,90,90,120]):
                c.execute("INSERT INTO snapshots(search_id,version,cycle_id,direction,collected,complete,price,count) VALUES(?,1,?,'outbound',?,1,?,1)",(sid,cid,i+1,price))
            c.execute("INSERT INTO snapshots(search_id,version,cycle_id,direction,collected,complete,price,count) VALUES(?,2,?,'outbound',6,1,120,1)",(sid,cid))
        history=self.client.get('/api/state').json()['history']
        self.assertEqual([(r['price'],r['previous_price']) for r in reversed(history)],[(100,None),(90,100),(120,90),(120,None)])
        self.assertEqual(len(self.client.get('/api/export/'+sid).json()['history']),6)
    def test_legacy_interval_migration_and_paused_query_no_network(self):
        sid,_=self.search()
        with store.db() as c:c.execute("UPDATE searches SET config=json_set(config,'$.interval',420),active=0 WHERE id=?",(sid,))
        store.setup(seed=False)
        with store.db() as c:row=dict(c.execute('SELECT * FROM searches WHERE id=?',(sid,)).fetchone())
        search=Search.model_validate_json(row['config']);self.assertEqual(search.interval,300)
        with patch('backend.engine.fetch') as fetch:
            # A paused search is skipped: never queried, no result row and no failure kind.
            self.assertEqual(Monitor().gated_fetch(search,('outbound','THE','GRU','2090-11-05'),row)['status'],'skipped');fetch.assert_not_called()
    def test_quiet_profile_and_queued_price_suppression(self):
        sid,_=self.search()
        r=self.client.put('/api/profile',json={**self.user,'quiet_hours':True,'timezone':'America/Sao_Paulo','quiet_start':'22:00','quiet_end':'07:00'},headers=self.headers)
        self.assertEqual(r.status_code,200,r.text);self.assertTrue(r.json()['quiet_hours'])
        # Queued at 23:50 in São Paulo (02:50 UTC), inside 22:00-07:00: held, still pending, until 07:00 there.
        night=datetime(2026,10,17,2,50,tzinfo=timezone.utc).timestamp();morning=datetime(2026,10,17,10,tzinfo=timezone.utc).timestamp()
        def send_at(moment):
            with patch.object(mail,'delivery_settings',return_value={'enabled':True}),patch('backend.engine.time.time',return_value=moment),patch('backend.accounts.time.time',return_value=moment),patch.object(mail,'transmit') as send:
                Monitor().send_one();return send.call_count
        with store.db() as c:c.execute("INSERT INTO outbox(id,search_id,version,created,alert_ids,subject,body,status,next_due,recipients) VALUES('q',?,1,?,'[]','test','test','pending',?,?)",(sid,night,night,json.dumps(['first@example.org'])))
        self.assertEqual((send_at(night),send_at(night+60)),(0,0))
        with store.db() as c:row=c.execute("SELECT status,next_due FROM outbox WHERE id='q'").fetchone()
        self.assertEqual((row['status'],row['next_due']),('pending',morning),'Held, nothing marks it silenced')
        # At 07:00 the 30 minutes start: sent, though created more than 7 hours before.
        self.assertEqual(send_at(morning),1)
        with store.db() as c:self.assertEqual(c.execute("SELECT status FROM outbox WHERE id='q'").fetchone()[0],'sent')
        # Not sent within 30 minutes of the end of the quiet hours (the sender was down): expired.
        with store.db() as c:c.execute("UPDATE outbox SET status='pending',next_due=?,completed=NULL,sent=NULL WHERE id='q'",(morning,))
        self.assertEqual(send_at(morning+1801),0)
        with store.db() as c:self.assertEqual(c.execute("SELECT status FROM outbox WHERE id='q'").fetchone()[0],'expired')
    def test_shorter_quiet_hours_bring_held_messages_forward(self):
        from backend import accounts
        sid,_=self.search()
        self.client.put('/api/profile',json={**self.user,'quiet_hours':True,'timezone':'America/Sao_Paulo','quiet_start':'22:00','quiet_end':'07:00'},headers=self.headers)
        night=datetime(2026,10,17,2,50,tzinfo=timezone.utc).timestamp()
        with store.db() as c:
            c.execute("INSERT INTO outbox(id,search_id,version,created,alert_ids,subject,body,status,next_due,recipients) VALUES('q',?,1,?,'[]','t','t','pending',?,'[]')",(sid,night,datetime(2026,10,17,10,tzinfo=timezone.utc).timestamp()))
            uid=c.execute('SELECT owner_id FROM searches WHERE id=?',(sid,)).fetchone()[0]
            c.execute("UPDATE accounts SET quiet_end='05:00' WHERE id=?",(uid,))
            accounts.release_held(c,uid,night)
            self.assertEqual(c.execute("SELECT next_due FROM outbox WHERE id='q'").fetchone()[0],datetime(2026,10,17,8,tzinfo=timezone.utc).timestamp(),'Due at the new end, 05:00 there')
            c.execute("UPDATE accounts SET quiet_start='23:55' WHERE id=?",(uid,))
            accounts.release_held(c,uid,night)
            self.assertEqual(c.execute("SELECT next_due FROM outbox WHERE id='q'").fetchone()[0],night,'Outside the new hours: due now')
    def test_logos_validation_cache_and_authenticated_endpoint(self):
        with patch.object(logos,'urlopen') as remote:
            self.assertIsNone(logos.airline_logo('../bad'));remote.assert_not_called()
            response=MagicMock();response.read.return_value=b'\x89PNG\r\n\x1a\nfixture';headers=Message();headers['content-type']='image/png';response.headers=headers;remote.return_value.__enter__.return_value=response
            path=logos.airline_logo('LA');self.assertTrue(path.exists());self.assertEqual(logos.airline_logo('LA'),path);self.assertEqual(remote.call_count,1)
        response=self.client.get('/api/airline-logo/LA');self.assertEqual(response.status_code,200);self.assertEqual(response.headers['cache-control'],'private,max-age=86400')
        self.client.post('/api/auth/logout',json={},headers=self.headers)
        self.assertEqual(self.client.get('/api/airline-logo/LA').status_code,401)
    def test_logo_failure_negative_cache(self):
        with patch.object(logos,'urlopen',side_effect=OSError('fixture')) as remote:
            self.assertIsNone(logos.airline_logo('ZZ'));self.assertIsNone(logos.airline_logo('ZZ'));self.assertEqual(remote.call_count,1)

class GateAndQuietTests(unittest.TestCase):
    def test_gate_concurrency_owner_spacing_and_cancellation(self):
        gate=QueryGate(concurrency=2,min_gap=.02);stop=threading.Event();entered=[];active=set();lock=threading.Lock();errors=[]
        def task(owner):
            try:
                with gate.slot(owner,stop):
                    with lock:
                        if owner in active or len(active)>=2:errors.append('concurrency')
                        active.add(owner);entered.append(time.monotonic())
                    time.sleep(.04)
                    with lock:active.remove(owner)
            except Exception as e:errors.append(str(e))
        threads=[threading.Thread(target=task,args=(owner,)) for owner in ['a','a','b','c']]
        for thread in threads:thread.start()
        for thread in threads:thread.join(2);self.assertFalse(thread.is_alive())
        self.assertFalse(errors);self.assertEqual(len(entered),4);self.assertTrue(all(b-a>=.019 for a,b in zip(entered,entered[1:])))
        stop.set()
        with self.assertRaises(RuntimeError):
            with gate.slot('x',stop):pass
        self.assertEqual(gate.waiting,[])
    def test_quiet_overnight_timezone_and_daytime(self):
        cfg={'quiet_hours':True,'timezone':'America/Sao_Paulo','quiet_start':'22:00','quiet_end':'08:00'}
        for hour,expected in [(1,True),(9,True),(11,False),(20,False)]:
            self.assertEqual(accounts.is_quiet(cfg,datetime(2026,10,16,hour,tzinfo=timezone.utc).timestamp()),expected)
        cfg.update(quiet_start='12:00',quiet_end='14:00')
        self.assertTrue(accounts.is_quiet(cfg,datetime(2026,10,16,16,tzinfo=timezone.utc).timestamp()))
        cfg['quiet_hours']=False;self.assertFalse(accounts.is_quiet(cfg))
