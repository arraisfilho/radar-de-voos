"""Local API lifecycle and privacy, with temporary SQLite and no collector threads."""
import importlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend import store, mail
from backend.domain import Search, Leg


class APITests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        folder=Path(self.temp.name)
        self.patches=[patch.object(store,"DATA_DIR",folder),patch.object(mail,"DATA_DIR",folder),patch.object(mail,"SETTINGS_FILE",folder/"smtp-private.json")]
        for p in self.patches:p.start()
        store.setup(seed=False)
        self.module=importlib.import_module('backend.app')
        self.client=TestClient(self.module.app)
        self.headers={'x-radar-token':self.module.TOKEN}
        result=self.client.post('/api/auth/bootstrap',json={'name':'Test admin','country':'US','phone':'6502530000','password':'fixture-password-only','emails':['to@example.org']},headers=self.headers)
        self.assertEqual(result.status_code,200,result.text)

    def tearDown(self):
        self.client.close()
        for p in self.patches:p.stop()
        self.temp.cleanup()

    def payload(self):
        return Search(name='API fixture',origins=['THE'],destinations=['GRU','CGH'],outbound=Leg(start='2090-11-05T22:00',end='2090-11-06T06:00')).model_dump()

    def test_create_edit_pause_archive_restore_and_export(self):
        created=self.client.post('/api/searches',json=self.payload(),headers=self.headers)
        self.assertEqual(created.status_code,200,created.text)
        sid=created.json()['id']
        state=self.client.get('/api/state').json()
        self.assertEqual(state['selected']['version'],1)
        updated=self.payload();updated['outbound']['max_duration']=360
        self.assertEqual(self.client.put('/api/searches/'+sid,json=updated,headers=self.headers).status_code,200)
        self.assertEqual(self.client.get('/api/state').json()['selected']['version'],2)
        self.client.post('/api/searches/'+sid+'/action',json={'action':'pause'},headers=self.headers)
        self.assertFalse(self.client.get('/api/state').json()['selected']['active'])
        exported=self.client.get('/api/export/'+sid).json()
        self.assertNotIn('token',exported)
        self.assertNotIn('smtp',exported)
        self.client.post('/api/searches/'+sid+'/action',json={'action':'archive'},headers=self.headers)
        state=self.client.get('/api/state').json()
        self.assertEqual(len(state['searches']),0)
        self.assertEqual(len(state['archived']),1)
        self.assertEqual(self.client.post('/api/searches/'+sid+'/restore',json={},headers=self.headers).status_code,200)
        restored=self.client.get('/api/state').json()['selected']
        self.assertEqual(restored['state'],'scheduled')
        self.assertTrue(restored['active'])

    def test_cross_origin_and_missing_token_are_rejected(self):
        self.assertEqual(self.client.post('/api/searches',json=self.payload()).status_code,403)
        self.assertEqual(self.client.post('/api/searches',json=self.payload(),headers={**self.headers,'origin':'https://unrelated.example'}).status_code,403)
        self.assertEqual(self.client.get('/api/state',headers={'host':'unrelated.example'}).status_code,403)

    def test_validation_errors_do_not_echo_smtp_password(self):
        payload={'enabled':True,'host':'smtp.example.org','password':'DO_NOT_ECHO_THIS_TEST_SECRET','sender':'invalid','recipient':'a@example.org'}
        response=self.client.put('/api/smtp',json=payload,headers=self.headers)
        self.assertEqual(response.status_code,422)
        self.assertNotIn(payload['password'],response.text)

    def test_saved_password_does_not_leave_the_server(self):
        payload={'enabled':True,'host':'smtp.example.org','password':'TEST_ONLY','sender':'a@example.org','recipient':'b@example.org'}
        self.assertEqual(self.client.put('/api/smtp',json=payload,headers=self.headers).status_code,200)
        response=self.client.get('/api/state')
        self.assertNotIn('TEST_ONLY',response.text)
        self.assertTrue(response.json()['smtp']['password_set'])


if __name__=='__main__':unittest.main()
