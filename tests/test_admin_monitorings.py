"""Admin read-only inspection, stable numeric references and existing account ACLs."""
import importlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend import store,mail
from backend.domain import Search,Leg

class AdminMonitoringTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();folder=Path(self.temp.name)
        self.patches=[patch.object(store,'DATA_DIR',folder),patch.object(mail,'DATA_DIR',folder),patch.object(mail,'SETTINGS_FILE',folder/'smtp.json')]
        for p in self.patches:p.start()
        store.setup(seed=False);self.app=importlib.import_module('backend.app')
        self.admin=TestClient(self.app.app);self.user=TestClient(self.app.app);self.anon=TestClient(self.app.app)
        self.headers={'x-radar-token':self.app.TOKEN}
        data={'name':'Admin fixture','country':'US','phone':'6502530000','password':'fixture-password-only'}
        self.aid=self.admin.post('/api/auth/bootstrap',json=data,headers=self.headers).json()['id']
        self.uid=self.user.post('/api/auth/register',json=data|{'name':'Customer fixture','country':'GB','phone':'02079460018'},headers=self.headers).json()['id']
        self.config=Search(name='Read-only fixture',origins=['THE'],destinations=['GRU'],outbound=Leg(start='2090-11-05T00:00',end='2090-11-05T23:59'))
    def tearDown(self):
        for client in (self.admin,self.user,self.anon):client.close()
        for p in reversed(self.patches):p.stop()
        self.temp.cleanup()
    def add(self,uid=None):
        with store.db() as c:return store.add_search(c,self.config,uid or self.uid)
    def accounts(self):return self.admin.get('/api/admin/users').json()['items']
    def list(self,uid=None,**params):return self.admin.get('/api/admin/users/'+(uid or self.uid)+'/monitorings',params=params)
    def test_direct_admin_user_page_is_authorized_and_contains_only_public_account_fields(self):
        response=self.admin.get('/api/admin/users/'+self.uid)
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['id'],self.uid)
        self.assertIsInstance(response.json()['client_number'],int)
        for field in ('password_hash','password','token','sessions'):
            self.assertNotIn(field,response.json())
        self.assertEqual(self.user.get('/api/admin/users/'+self.uid).status_code,403)
        self.assertEqual(self.anon.get('/api/admin/users/'+self.uid).status_code,401)
        self.assertEqual(self.admin.get('/api/admin/users/missing').status_code,404)

    def test_client_pages_support_direct_navigation_without_an_api_catchall(self):
        frontend=Path(self.temp.name)/'frontend'
        frontend.mkdir()
        shell='<!doctype html><title>Radar de Voos</title><div id="root"></div>'
        (frontend/'index.html').write_text(shell)
        with patch.object(self.app,'DIST',frontend):
            for path in ('/viagens','/viagens/nova?etapa=1&trecho=volta','/viagens/fixture/editar','/viagens/fixture/historico','/perfil','/historico','/alertas','/admin/usuarios/fixture/editar','/admin/envios/fixture'):
                response=self.anon.get(path)
                self.assertEqual(response.status_code,200,path)
                self.assertEqual(response.text,shell)
                self.assertIn('text/html',response.headers['content-type'])
                self.assertEqual(response.headers['cache-control'],'no-cache')
            self.assertEqual(self.anon.get('/api/nonexistent').status_code,404)
            self.assertEqual(self.anon.get('/assets/nonexistent.js').status_code,404)

    def test_client_page_without_frontend_build_returns_service_unavailable(self):
        with patch.object(self.app,'DIST',Path(self.temp.name)/'unbuilt'):
            self.assertEqual(self.anon.get('/viagens').status_code,503)

    def test_customer_numbers_counts_and_id_search(self):
        one,two,three=[self.add() for _ in range(3)];self.add(self.aid)
        self.user.post('/api/searches/'+two+'/action',json={'action':'pause'},headers=self.headers)
        self.user.post('/api/searches/'+three+'/action',json={'action':'archive'},headers=self.headers)
        account=next(a for a in self.accounts() if a['id']==self.uid)
        self.assertEqual(account['monitoring_counts'],{'active':1,'paused':1,'ended':1,'total':3})
        self.assertIsInstance(account['client_number'],int)
        found=self.admin.get('/api/admin/users',params={'q':'#'+str(account['client_number'])}).json()['items']
        self.assertEqual([a['id'] for a in found],[self.uid])
        self.assertEqual([m['id'] for m in self.list(status='paused').json()['items']],[two])
        self.assertEqual([m['id'] for m in self.list(status='ended').json()['items']],[three])
        self.assertEqual([m['id'] for m in self.list(status='active').json()['items']],[one])
    def test_numbers_are_global_stable_and_never_reused_after_delete(self):
        own=self.add();other=self.add(self.aid)
        before=self.list().json()['items'][0]['monitoring_number']
        different=self.list(self.aid).json()['items'][0]['monitoring_number']
        self.assertNotEqual(before,different)
        store.setup(seed=False)
        self.assertEqual(self.list().json()['items'][0]['monitoring_number'],before)
        with store.db() as c:c.execute('DELETE FROM searches WHERE id=?',(own,))
        new=self.add()
        self.assertGreater(self.list().json()['items'][0]['monitoring_number'],max(before,different))
        self.assertNotEqual(new,own)
    def test_existing_records_backfill_without_changing_ids_or_configuration(self):
        sid=self.add();users={u['id'] for u in self.accounts()}
        with store.db() as c:
            for entity,table in [('accounts','client_refs'),('searches','monitor_refs')]:
                c.execute('DROP TRIGGER number_'+entity+'_insert');c.execute('DROP TABLE '+table)
        store.setup(seed=False)
        self.assertEqual({u['id'] for u in self.accounts()},users)
        row=self.list().json()['items'][0]
        self.assertEqual(row['id'],sid);self.assertEqual(row['config'],self.config.model_dump())
        with store.db() as c:self.assertFalse(c.execute('PRAGMA foreign_key_check').fetchall())
    def test_readonly_view_keeps_admin_session_audits_access_and_never_collects(self):
        sid=self.add()
        with store.db() as c:before=dict(c.execute('SELECT * FROM searches WHERE id=?',(sid,)).fetchone())
        with patch('backend.engine.fetch',side_effect=AssertionError('Admin read must not collect')):
            response=self.admin.get('/api/admin/users/'+self.uid+'/monitorings/'+sid)
        self.assertEqual(response.status_code,200,response.text);data=response.json()
        self.assertTrue(data['readonly']);self.assertEqual(data['search']['id'],sid)
        self.assertEqual(data['search']['config'],self.config.model_dump())
        self.assertNotIn('password_hash',response.text);self.assertNotIn('sessions',data)
        self.assertEqual(self.admin.get('/api/auth/session').json()['user']['id'],self.aid)
        with store.db() as c:
            self.assertEqual(dict(c.execute('SELECT * FROM searches WHERE id=?',(sid,)).fetchone()),before)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM cycles').fetchone()[0],0)
            audit=c.execute("SELECT * FROM access_audit WHERE event='admin_monitoring_viewed'").fetchone()
            self.assertEqual(audit['user_id'],self.uid);self.assertEqual(audit['actor_id'],self.aid)
    def test_inspection_is_admin_only_and_target_must_match_owner(self):
        sid=self.add();path='/api/admin/users/'+self.uid+'/monitorings'
        for client,status in [(self.user,403),(self.anon,401)]:
            self.assertEqual(client.get(path).status_code,status)
            self.assertEqual(client.get(path+'/'+sid).status_code,status)
        self.assertEqual(self.admin.get('/api/admin/users/'+self.aid+'/monitorings/'+sid).status_code,404)
        self.assertEqual(self.list('unknown').status_code,404)
        self.assertEqual(self.list(status='invalid').status_code,422)
        self.assertEqual(self.list(page=-1).status_code,422)
        self.assertEqual(self.admin.put(path+'/'+sid,json={'active':False},headers=self.headers).status_code,405)
        self.assertEqual(self.user.get('/api/state',params={'search_id':sid}).json()['selected']['id'],sid)
    def test_list_and_results_are_paginated(self):
        for _ in range(18):self.add()
        first=self.list().json();second=self.list(page=1).json()
        self.assertEqual(first['total'],18);self.assertEqual(len(first['items']),15);self.assertEqual(len(second['items']),3)
        self.assertFalse({r['id'] for r in first['items']}&{r['id'] for r in second['items']})
        sid=first['items'][0]['id'];flights=[{'id':str(i)} for i in range(45)]
        with patch.object(self.app,'recent_results',return_value=(flights,[])):
            response=self.admin.get('/api/admin/users/'+self.uid+'/monitorings/'+sid,params={'page':1}).json()
        self.assertEqual(response['total'],45);self.assertEqual(len(response['flights']),5)
        self.assertEqual(response['flights'][0]['id'],'40')
