"""Account home, conditional state, activity and conservative raw-data retention."""
import test_isolation  # noqa: F401 - first: temporary data, no seed, idle workers
import importlib
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend import store,mail,retention
from backend.domain import Search,Leg

class EvolutionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();folder=Path(self.temp.name)
        self.patches=[patch.object(store,'DATA_DIR',folder),patch.object(mail,'DATA_DIR',folder),patch.object(mail,'SETTINGS_FILE',folder/'smtp.json'),patch.dict('os.environ',{'RADAR_RAW_RETENTION_DAYS':'30'})]
        for item in self.patches:item.start()
        store.setup(seed=False);self.module=importlib.import_module('backend.app');self.client=TestClient(self.module.app);self.other=TestClient(self.module.app)
        self.headers={'x-radar-token':self.module.TOKEN}
        self.client.post('/api/auth/register',json={'name':'First fixture','country':'US','phone':'6502530000','password':'fixture-password-only'},headers=self.headers)
        self.other.post('/api/auth/register',json={'name':'Other fixture','country':'GB','phone':'02079460018','password':'fixture-password-only'},headers=self.headers)
    def tearDown(self):
        self.client.close();self.other.close()
        for item in reversed(self.patches):item.stop()
        self.temp.cleanup()
    def search(self,client=None,name='Fixture trip'):
        config=Search(name=name,origins=['THE'],destinations=['GRU'],outbound=Leg(start='2090-11-05T00:00',end='2090-11-05T23:59')).model_dump()
        response=(client or self.client).post('/api/searches',json=config,headers=self.headers)
        self.assertEqual(response.status_code,200,response.text)
        return response.json()['id']
    def test_explicit_unknown_or_foreign_monitor_does_not_fall_back_to_another_search(self):
        own=self.search();foreign=self.search(self.other)
        for scope in ('searches','history','legacy'):
            for sid in ('missing',foreign):
                self.assertEqual(self.client.get('/api/state',params={'scope':scope,'search_id':sid}).status_code,404)
            self.assertEqual(self.client.get('/api/state',params={'scope':scope,'search_id':own}).json()['selected']['id'],own)

    def cycle(self,c,sid,started=None):
        return c.execute("INSERT INTO cycles(search_id,version,started,status,total) VALUES(?,1,?,'done',1)",(sid,time.time() if started is None else started)).lastrowid
    def alert(self,c,sid,cid,aid,status='sent',created=None):
        flight={'origin':'THE','destination':'GRU','departure':'2090-11-05T12:00','arrival':'2090-11-05T14:00','currency':'BRL','airlines':['LATAM'],'price_cents':90000,'adults':1,'stops':0,'duration_minutes':120,'search_url':'https://example.org/fixture'}
        payload={'title':'Nova menor tarifa','kind':'lower_price','flight':flight,'previous':100000,'saving_cents':10000,'saving_percent':10}
        c.execute("INSERT INTO alerts(id,search_id,version,cycle_id,direction,created,kind,price,previous,payload,status) VALUES(?,?,1,?,'outbound',?,'lower_price',90000,100000,?,?)",(aid,sid,cid,time.time() if created is None else created,json.dumps(payload),status))
    def test_empty_home_and_multi_search_summaries_skip_flight_parsing(self):
        empty=self.client.get('/api/state',params={'scope':'home'}).json();self.assertEqual(empty['searches'],[]);self.assertIsNone(empty['selected'])
        a=self.search(name='One way');b=self.search(name='Second trip');self.search(self.other,name='Private trip')
        with store.db() as c:
            cid=self.cycle(c,a)
            c.execute("INSERT INTO snapshots(search_id,version,cycle_id,direction,collected,complete,price,count) VALUES(?,1,?,'outbound',?,1,123400,1)",(a,cid,time.time()))
        with patch.object(self.module,'recent_results',side_effect=AssertionError('Home must not parse raw flights')):
            home=self.client.get('/api/state',params={'scope':'home'}).json()
        self.assertEqual({s['id'] for s in home['searches']},{a,b});self.assertIsNone(home['selected']);self.assertEqual(home['flights'],[])
        first=next(s for s in home['searches'] if s['id']==a);self.assertEqual(first['summary']['outbound']['price'],123400);self.assertNotIn('inbound',first['summary'])
        self.assertIsNone(home['smtp']);self.assertIsNone(home['google_mail'])
    def test_conditional_state_is_cheap_and_not_invalidated_by_other_account(self):
        sid=self.search();params={'scope':'searches','search_id':sid,'detail':False}
        before=self.client.get('/api/state',params=params).json();self.assertIn('revision',before)
        self.search(self.other)
        with patch.object(self.module,'recent_results',side_effect=AssertionError('Unchanged must skip raw parsing')):
            same=self.client.get('/api/state',params={**params,'since':before['revision']}).json()
        self.assertTrue(same['unchanged']);self.assertEqual(set(same),{'unchanged','revision','server_time'})
        self.client.post('/api/searches/'+sid+'/action',json={'action':'pause'},headers=self.headers)
        changed=self.client.get('/api/state',params={**params,'since':before['revision']}).json()
        self.assertNotIn('unchanged',changed);self.assertNotEqual(changed['revision'],before['revision']);self.assertFalse(changed['selected']['active'])
        self.assertNotIn('unchanged',self.client.get('/api/state',params={'scope':'home','since':changed['revision']}).json())
    def test_revision_changes_for_prices_status_contacts_and_deletion(self):
        sid=self.search();params={'scope':'home'}
        revision=self.client.get('/api/state',params=params).json()['revision']
        with store.db() as c:
            cid=self.cycle(c,sid);self.alert(c,sid,cid,'a','queued')
        response=self.client.get('/api/state',params={**params,'since':revision}).json();self.assertEqual(response['alert_total'],1);revision=response['revision']
        with store.db() as c:c.execute("UPDATE alerts SET status='sent' WHERE id='a'")
        response=self.client.get('/api/state',params={**params,'since':revision}).json();self.assertNotIn('unchanged',response);revision=response['revision']
        self.client.put('/api/profile',json={'name':'Updated fixture','emails':['fixture@example.org']},headers=self.headers)
        response=self.client.get('/api/state',params={**params,'since':revision}).json();self.assertEqual(response['user']['name'],'Updated fixture');revision=response['revision']
        self.client.delete('/api/searches/'+sid,headers=self.headers)
        response=self.client.get('/api/state',params={**params,'since':revision}).json();self.assertEqual(response['searches'],[]);self.assertEqual(response['alert_total'],0)
    def test_history_defaults_to_ended_trip_when_no_live_search_exists(self):
        sid=self.search();self.client.post('/api/searches/'+sid+'/action',json={'action':'archive'},headers=self.headers)
        state=self.client.get('/api/state',params={'scope':'history'}).json();self.assertEqual(state['selected']['id'],sid);self.assertEqual(state['searches'],[])
    def test_notifications_include_all_owned_trips_and_archives_and_filters(self):
        a=self.search(name='One');b=self.search(name='Two');other=self.search(self.other,name='Private')
        with store.db() as c:
            ca=self.cycle(c,a);cb=self.cycle(c,b);co=self.cycle(c,other)
            for i in range(31):self.alert(c,a,self.cycle(c,a),str(i),'sent',time.time()+i)
            self.alert(c,b,cb,'pending','queued');self.alert(c,b,self.cycle(c,b),'missing','waiting_contact');self.alert(c,other,co,'private','sent')
        self.client.post('/api/searches/'+b+'/action',json={'action':'archive'},headers=self.headers)
        response=self.client.get('/api/activity').json();self.assertEqual(len(response['items']),30);self.assertTrue(response['has_more']);self.assertEqual(response['totals']['sent'],31)
        self.assertTrue(all(item['search_name']!='Private' for item in response['items']))
        page=self.client.get('/api/activity',params={'page':1}).json();self.assertEqual(len(page['items']),3)
        self.assertFalse(set(item['id'] for item in response['items'])&set(item['id'] for item in page['items']))
        filtered=self.client.get('/api/activity',params={'status':'pending','search_id':b}).json();self.assertEqual([item['id'] for item in filtered['items']],['pending']);self.assertTrue(filtered['items'][0]['archived'])
        failed=self.client.get('/api/activity',params={'status':'failed','search_id':b}).json();self.assertEqual([item['id'] for item in failed['items']],['missing'])
        self.assertEqual(self.client.get('/api/activity',params={'search_id':other}).json()['items'],[])
    def test_channel_summaries_are_grouped_private_and_shared_with_monitor(self):
        from backend.notifications import link
        sid=self.search();private=self.search(self.other)
        with store.db() as c:
            self.alert(c,sid,self.cycle(c,sid),'own-channel','partial')
            self.alert(c,private,self.cycle(c,private),'private-channel','sent')
            for oid,search,aid,channel,status in [
                ('mail',sid,'own-channel','email','failed'),
                ('whatsapp-ok',sid,'own-channel','whatsapp','sent'),
                ('whatsapp-error',sid,'own-channel','whatsapp','uncertain'),
                ('private',private,'private-channel','email','sent')]:
                c.execute("INSERT INTO outbox(id,search_id,created,alert_ids,subject,body,status,next_due,recipients,channel,error) VALUES(?,?,?,?,'fixture','PRIVATE BODY',?,0,'[\"PRIVATE CONTACT\"]',?,'PRIVATE ERROR')",(oid,search,time.time(),json.dumps([aid]),status,channel))
                link(c,oid,[aid])
        response=self.client.get('/api/activity').json()
        item=response['items'][0];self.assertEqual(item['id'],'own-channel')
        self.assertEqual(item['channels'],[{'channel':'email','counts':{'failed':1}},{'channel':'whatsapp','counts':{'sent':1,'uncertain':1}}])
        raw=json.dumps(response)
        for text in ('PRIVATE BODY','PRIVATE CONTACT','PRIVATE ERROR','private-channel'):self.assertNotIn(text,raw)
        state=self.client.get('/api/state',params={'scope':'searches','search_id':sid}).json()
        self.assertEqual(state['alerts'][0]['channels'],item['channels'])
        other=self.other.get('/api/activity').json()['items'][0]
        self.assertEqual(other['channels'],[{'channel':'email','counts':{'sent':1}}])
        with store.db() as c:c.execute('DELETE FROM outbox WHERE search_id=?',(sid,))
        self.assertEqual(self.client.get('/api/activity').json()['items'][0]['channels'],[])

    def test_price_changes_are_separate_from_sent_notifications(self):
        sid=self.search()
        with store.db() as c:
            cid=self.cycle(c,sid)
            for i,price in enumerate([10000,10000,9000,12000,12000]):
                c.execute("INSERT INTO snapshots(search_id,version,cycle_id,direction,collected,complete,price,count) VALUES(?,1,?,'outbound',?,1,?,1)",(sid,cid,i+1,price))
            c.execute("INSERT INTO snapshots(search_id,version,cycle_id,direction,collected,complete,price,count) VALUES(?,2,?,'outbound',6,1,12000,1)",(sid,cid))
        changes=self.client.get('/api/activity',params={'mode':'changes'}).json();self.assertEqual([(r['previous'],r['price']) for r in changes['items']],[(9000,12000),(10000,9000)])
        self.assertEqual(changes['totals'],{});self.assertEqual(self.client.get('/api/activity').json()['items'],[])
        self.assertEqual(self.client.get('/api/activity',params={'mode':'bad'}).status_code,422)
    def test_retention_preserves_fallbacks_prices_alerts_and_foreign_keys(self):
        sid=self.search();now=time.time();old=now-40*86400
        with store.db() as c:
            cycles=[self.cycle(c,sid,old) for _ in range(45)]
            ids=[]
            for index,status in enumerate(['ok','ok','ok','error','error']):
                ids.append(c.execute("INSERT INTO results(cycle_id,search_id,version,direction,route_key,collected,status,data) VALUES(?,?,1,'outbound','same-route',?,?,?)",(cycles[index],sid,old+index,status,'{}')).lastrowid)
            c.execute("INSERT INTO snapshots(search_id,version,cycle_id,direction,collected,complete,price,count) VALUES(?,1,?,'outbound',?,1,50000,1)",(sid,cycles[0],old))
            self.alert(c,sid,cycles[1],'historical','sent',old)
        summary=retention.cleanup(now=now);self.assertEqual(summary['results'],3)
        with store.db() as c:
            self.assertEqual([r[0] for r in c.execute('SELECT id FROM results ORDER BY id')],[ids[2],ids[4]])
            self.assertEqual(c.execute('SELECT COUNT(*) FROM snapshots').fetchone()[0],1);self.assertEqual(c.execute('SELECT COUNT(*) FROM alerts').fetchone()[0],1)
            self.assertTrue(c.execute('SELECT 1 FROM cycles WHERE id=?',(cycles[0],)).fetchone());self.assertTrue(c.execute('SELECT 1 FROM cycles WHERE id=?',(cycles[1],)).fetchone())
            self.assertFalse(c.execute('PRAGMA foreign_key_check').fetchall())
        self.assertEqual(retention.cleanup(now=now+10),{'results':0,'cycles':0})
        with patch.dict('os.environ',{'RADAR_RAW_RETENTION_DAYS':'1'}):
            with self.assertRaises(ValueError):retention.days()
    def test_legacy_deliveries_stay_owner_scoped_and_overview_omits_them(self):
        own=self.search();other=self.search(self.other)
        with store.db() as c:
            for oid,sid in [('own-mail',own),('other-mail',other)]:
                c.execute("INSERT INTO outbox(id,search_id,created,alert_ids,subject,body,status,next_due,recipients) VALUES(?,?,?,'[]','fixture','fixture','sent',0,'[]')",(oid,sid,time.time()))
        legacy=self.client.get('/api/state').json()
        self.assertEqual([r['id'] for r in legacy['deliveries']],['own-mail'])
        self.assertEqual(self.client.get('/api/state',params={'scope':'home'}).json()['deliveries'],[])

    def test_authentication_precedes_conditional_reply_and_activity(self):
        state=self.client.get('/api/state',params={'scope':'home'}).json();self.client.post('/api/auth/logout',json={},headers=self.headers)
        self.assertEqual(self.client.get('/api/state',params={'scope':'home','since':state['revision']}).status_code,401)
        self.assertEqual(self.client.get('/api/activity').status_code,401)
