"""Public deployment boundaries and private backup; no source queries or email."""
import test_isolation  # noqa: F401 - first: temporary data, no seed, idle workers
import importlib
import json
import os
from pathlib import Path
import sqlite3
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from fastapi import Response
from fastapi.testclient import TestClient
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
from backend import store,mail,accounts
from backend.network import public_origin,public_mode
from scripts.backup import backup


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.folder=Path(self.temp.name)
        self.patches=[patch.object(store,'DATA_DIR',self.folder),patch.object(mail,'DATA_DIR',self.folder),patch.object(mail,'SETTINGS_FILE',self.folder/'smtp.json'),patch.dict(os.environ,{'RADAR_DEPLOYMENT':'local'})]
        for item in self.patches:item.start()
        store.setup(seed=False)
        self.module=importlib.import_module('backend.app')
        self.registration={'name':'Cloud admin fixture','country':'US','phone':'2025550123','password':'fixture-password-strong','emails':['fixture@example.org']}
        self.admin=accounts.register(accounts.Registration(**self.registration),Response(),admin=True)
        self.env=patch.dict(os.environ,{'RADAR_DEPLOYMENT':'public','RADAR_PUBLIC_URL':'https://radar.example.com'})
        self.env.start()
        self.client=TestClient(self.module.app,base_url='https://radar.example.com',client=('203.0.113.5',5000))
    def tearDown(self):
        self.client.close();self.env.stop()
        for item in reversed(self.patches):item.stop()
        self.temp.cleanup()
    def test_public_session_and_secure_cookie(self):
        response=self.client.get('/api/auth/session')
        self.assertEqual(response.status_code,200)
        self.assertFalse(response.json()['can_bootstrap']);self.assertFalse(response.json()['registration_open'])
        self.assertIn('max-age',response.headers['strict-transport-security'])
        token=response.json()['token']
        response=self.client.post('/api/auth/login',json=self.registration,headers={'x-radar-token':token,'origin':'https://radar.example.com'})
        self.assertEqual(response.status_code,200,response.text)
        self.assertIn('Secure',response.headers['set-cookie']);self.assertIn('HttpOnly',response.headers['set-cookie'])
    def test_public_host_tls_origin_and_signup_restrictions(self):
        token=self.module.TOKEN;headers={'x-radar-token':token}
        for url in ('http://radar.example.com','https://evil.example.com'):
            client=TestClient(self.module.app,base_url=url,client=('203.0.113.5',5000))
            self.addCleanup(client.close)
            self.assertEqual(client.get('/api/auth/session').status_code,403)
        self.assertEqual(self.client.post('/api/auth/login',json=self.registration,headers=headers|{'origin':'http://radar.example.com'}).status_code,403)
        self.assertEqual(self.client.post('/api/auth/register',json=self.registration,headers=headers).status_code,403)
        self.assertEqual(self.client.post('/api/auth/bootstrap',json=self.registration,headers=headers).status_code,403)
        client=TestClient(self.module.app,base_url='http://127.0.0.1',client=('127.0.0.1',5000))
        self.addCleanup(client.close)
        with patch.object(self.module,'monitor',test_isolation.IdleMonitor(healthy=True)):
            self.assertEqual(client.get('/api/health').status_code,200)
        self.assertEqual(client.get('/api/auth/session').status_code,403)
    def test_health_body_for_the_container_check_and_the_administrator_only(self):
        local=TestClient(self.module.app,base_url='http://127.0.0.1:8765',client=('127.0.0.1',5000))
        self.addCleanup(local.close)
        with patch.object(self.module,'monitor',test_isolation.IdleMonitor(healthy=True)):
            # The image HEALTHCHECK: plaintext from the loopback, reading ok, collector_alive and whatsapp_sender_alive.
            body=local.get('/api/health').json()
            self.assertTrue(body['ok'] and body['collector_alive'] and body['whatsapp_sender_alive']);self.assertIn('source',body)
            # Through the public origin, without an administrator session: ok only.
            self.assertEqual(self.client.get('/api/health').json(),{'ok':True})
            token=self.client.get('/api/auth/session').json()['token']
            login=self.client.post('/api/auth/login',json=self.registration,headers={'x-radar-token':token,'origin':'https://radar.example.com'})
            self.assertEqual(login.status_code,200,login.text)
            self.assertEqual(self.client.get('/api/health').json()['source']['status'],'ok')
    def test_only_exact_proxy_can_assert_https(self):
        proxy=ProxyHeadersMiddleware(self.module.app,trusted_hosts=['172.30.88.1'])
        for address,expected in [('172.30.88.1',200),('172.30.88.9',403)]:
            client=TestClient(proxy,base_url='http://radar.example.com',client=(address,5000))
            self.addCleanup(client.close)
            response=client.get('/api/auth/session',headers={'x-forwarded-proto':'https','x-forwarded-for':'203.0.113.10'})
            self.assertEqual(response.status_code,expected)
    def test_invalid_public_configuration_is_rejected(self):
        for value in ('http://radar.example.com','https://127.0.0.1','https://user:pass@radar.example.com','https://radar.example.com/path','https://radar.example.com?x=1'):
            with patch.dict(os.environ,{'RADAR_PUBLIC_URL':value}):
                with self.assertRaises(ValueError):public_origin()
        with patch.dict(os.environ,{'RADAR_DEPLOYMENT':'typo'}):
            with self.assertRaises(ValueError):public_mode()
    def test_backup_contains_consistent_database_and_private_settings(self):
        (self.folder/'smtp-private.json').write_text(json.dumps({'password':'fixture-only'}))
        with patch('scripts.backup.DATA_DIR',self.folder):archive=backup(self.folder/'backups')
        self.assertEqual(archive.stat().st_mode&0o777,0o600)
        with tarfile.open(archive) as content:
            self.assertEqual(set(content.getnames()),{'radar.sqlite3','smtp-private.json'})
            content.extractall(self.folder/'restore',filter='data')
        with sqlite3.connect(self.folder/'restore'/'radar.sqlite3') as c:
            self.assertEqual(c.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            self.assertEqual(c.execute('SELECT COUNT(*) FROM accounts').fetchone()[0],1)

    def test_restore_validates_then_replaces_database_and_settings(self):
        from scripts.restore import restore
        (self.folder/'smtp-private.json').write_text('{"password":"fixture-old"}')
        with patch('scripts.backup.DATA_DIR',self.folder):archive=backup(self.folder/'backups')
        (self.folder/'whatsapp-private.json').write_text('{"token":"fixture-new"}')
        with store.db() as c:c.execute("UPDATE accounts SET name='Changed fixture'")
        with patch('scripts.restore.DATA_DIR',self.folder),archive.open('rb') as stream:
            self.assertEqual(restore(stream),2)
        self.assertFalse((self.folder/'whatsapp-private.json').exists())
        with store.db() as c:self.assertEqual(c.execute('SELECT name FROM accounts').fetchone()[0],'Cloud admin fixture')
