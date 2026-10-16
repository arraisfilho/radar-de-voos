"""Synthetic alerts and redirects; no provider calls or real notification sends."""
import copy
import importlib
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch, MagicMock
from urllib.parse import urlsplit
from fastapi.testclient import TestClient
from backend import alert_messages, offer_links, store, mail, google_mail
from backend.domain import Search, Leg
from backend.engine import persist_snapshots

URL='https://www.google.com/travel/flights/search?tfs=fixture&hl=pt-BR&curr=BRL'

def event():
    return dict(kind='target',price_cents=110800,previous=None,flight=dict(origin='THE',destination='CGH',departure='2090-11-05T23:40',arrival='2090-11-06T07:30',airlines=['LATAM'],duration_minutes=470,stops=1,adults=1,price_cents=110800,currency='BRL',search_url=URL,collected_at=time.time()))

class MessageTests(unittest.TestCase):
    def test_grouped_whatsapp_no_duplicate_title_and_correct_singular(self):
        outbound=event();inbound=copy.deepcopy(outbound);inbound['flight'].update(origin='GRU',destination='THE',stops=0,duration_minutes=600)
        text,_=alert_messages.render([('outbound',outbound),('inbound',inbound)],channel='whatsapp',links={0:'https://radar.example.com/go/fixture',1:'https://radar.example.com/go/return'})
        self.assertEqual(text.count('*Meta atingida*'),1)
        self.assertIn('*IDA · THE → CGH*',text);self.assertIn('*VOLTA · GRU → THE*',text)
        self.assertIn('1 escala · 7h50',text);self.assertIn('Direto · 10h',text)
        self.assertEqual(text.count('1 adulto · preços por trecho'),1)
        self.assertNotIn('(s)',text);self.assertNotIn('Economia',text)
        self.assertNotIn('tfs=',text);self.assertIn('*R$ 1.108,00*',text)
        self.assertIn('05/11/2090 · 23:40 → 06/11/2090 · 07:30',text)

    def test_comparison_only_for_genuine_savings_and_localized(self):
        e=event();e.update(previous=135000)
        for language,word in [('pt','Economia'),('en','Save'),('es','Ahorro')]:
            text,html=alert_messages.render([('outbound',e)],language)
            self.assertIn(word,text);self.assertIn('18%',text);self.assertIn('<del',html)
            self.assertNotIn('*R$',text)
        e['previous']=90000
        text,html=alert_messages.render([('outbound',e)])
        self.assertNotIn('Economia',text);self.assertNotIn('<del',html)

    def test_mixed_reasons_are_not_presented_as_two_targets(self):
        a=event();b=copy.deepcopy(a);b['kind']='lower_price';b['previous']=135000
        text,_=alert_messages.render([('outbound',a),('inbound',b)],channel='whatsapp')
        self.assertIn('*Novas oportunidades*',text)
        self.assertIn('CGH · Meta atingida*',text);self.assertIn('CGH · Preço caiu*',text)

    def test_html_escapes_provider_content_and_has_action(self):
        e=event();e['flight']['airlines']=['<img src=x onerror=alert(1)>*_']
        text,html=alert_messages.render([('outbound',e)],channel='whatsapp')
        self.assertNotIn('<img',html);self.assertIn('&lt;img',html)
        self.assertIn('href="https://www.google.com/',html)
        self.assertNotIn('alert(1)>*_',text)

    def test_smtp_multipart_and_plain_recovery_preserved(self):
        config={'provider':'smtp','host':'smtp.example.com','port':465,'security':'ssl','username':'','password':'','sender':'sender@example.org','recipient':['target@example.org'],'body_html':'<p>Safe fixture</p>'}
        smtp=MagicMock();smtp.send_message.return_value={}
        with patch.object(mail.smtplib,'SMTP_SSL',return_value=smtp):
            mail.transmit(config,'fixture','Subject','Plain fixture')
        message=smtp.send_message.call_args.args[0]
        self.assertEqual(message.get_content_type(),'multipart/alternative')
        self.assertEqual(message.get_body(preferencelist=('plain',)).get_content().strip(),'Plain fixture')
        config.pop('body_html')
        with patch.object(mail.smtplib,'SMTP_SSL',return_value=smtp):
            mail.transmit(config,'recovery','Recovery','Reset fixture')
        self.assertEqual(smtp.send_message.call_args.args[0].get_content_type(),'text/plain')

class LinkTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.folder=Path(self.temp.name)
        self.patches=[patch.object(store,'DATA_DIR',self.folder),patch.object(mail,'DATA_DIR',self.folder),patch.dict(os.environ,{'RADAR_DEPLOYMENT':'local','RADAR_PUBLIC_URL':'http://127.0.0.1:8765'})]
        for item in self.patches:item.start()
        store.setup(seed=False)
        self.search=Search(origins=['THE'],destinations=['CGH'],outbound=Leg(start='2090-11-05T00:00',end='2090-11-06T23:59'),target_cents=120000,notify_email=True)
        with store.db() as c:
            self.sid=store.add_search(c,self.search)
            cid=c.execute("INSERT INTO cycles(search_id,version,started,status,total) VALUES(?,1,?,'done',1)",(self.sid,time.time())).lastrowid
            persist_snapshots(c,self.sid,1,cid,self.search,[{'direction':'outbound','status':'ok','flights':[event()['flight']]}])
            self.aid=c.execute('SELECT id FROM alerts').fetchone()[0]
        self.client=TestClient(importlib.import_module('backend.app').app,base_url='http://127.0.0.1:8765',client=('127.0.0.1',5555))
    def tearDown(self):
        self.client.close()
        for item in reversed(self.patches):item.stop()
        self.temp.cleanup()
    def test_opaque_redirect_no_auth_and_no_open_redirect_parameter(self):
        with store.db() as c:link=offer_links.create(c,self.aid,URL)
        path=urlsplit(link).path
        response=self.client.get(path+'?url=https://evil.example',follow_redirects=False)
        self.assertEqual(response.status_code,302);self.assertEqual(response.headers['location'],URL)
        self.assertEqual(response.headers['cache-control'],'no-store')
        self.assertEqual(response.headers['referrer-policy'],'no-referrer')
        self.assertNotIn('THE',path);self.assertNotIn(self.aid,path)
        with store.db() as c:c.execute('UPDATE offer_links SET expires=0')
        self.assertEqual(self.client.get(path,follow_redirects=False).status_code,404)
        self.assertEqual(self.client.get('/go/invalid',follow_redirects=False).status_code,404)
    def test_destinations_are_strictly_allowlisted(self):
        for bad in ('https://evil.example/travel/flights/search','https://www.google.com.evil.example/travel/flights/search','https://user@www.google.com/travel/flights/search','http://www.google.com/travel/flights/search','https://www.google.com/url?q=https://evil.example','javascript:alert(1)','https://www.google.com:444/travel/flights/search'):
            with store.db() as c:self.assertEqual(offer_links.create(c,self.aid,bad),'')
    def test_links_cascade_with_alert_and_schema_is_repeatable(self):
        with store.db() as c:
            link=offer_links.create(c,self.aid,URL)
            c.execute('DELETE FROM alerts WHERE id=?',(self.aid,))
            self.assertEqual(c.execute('SELECT COUNT(*) FROM offer_links').fetchone()[0],0)
        store.setup(seed=False)
        with store.db() as c:self.assertIn('body_html',[r[1] for r in c.execute('PRAGMA table_info(outbox)')])
    def test_public_origin_uses_configuration(self):
        with patch.dict(os.environ,{'RADAR_DEPLOYMENT':'public','RADAR_PUBLIC_URL':'https://radar.example.com'}),store.db() as c:
            self.assertTrue(offer_links.create(c,self.aid,URL).startswith('https://radar.example.com/go/'))
    def test_gmail_multipart_and_expired_link_cleanup(self):
        import base64
        from email import message_from_bytes
        with patch.object(google_mail,'settings',return_value={'email':'sender@example.org'}),patch.object(google_mail,'access_token',return_value='fixture'),patch.object(google_mail,'remote',return_value={'id':'accepted'}) as remote:
            google_mail.transmit({'recipient':['target@example.org'],'body_html':'<p>Safe fixture</p>'},'fixture','Subject','Plain fixture')
        message=message_from_bytes(base64.urlsafe_b64decode(remote.call_args.args[1]['raw']))
        self.assertEqual(message.get_content_type(),'multipart/alternative')
        with store.db() as c:
            offer_links.create(c,self.aid,URL)
            c.execute('UPDATE offer_links SET expires=0')
        from backend.retention import cleanup
        cleanup()
        with store.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM offer_links').fetchone()[0],0)

    def test_grouped_queue_renders_channel_specific_content(self):
        # New account is unnecessary: fixtures inject recipients and the provider.
        with store.db() as c,patch('backend.accounts.alert_recipients',return_value=['target@example.org']),patch.object(mail,'available',return_value=True),patch('backend.whatsapp.enqueue') as enqueue:
            c.execute('DELETE FROM baselines')
            cid=c.execute("INSERT INTO cycles(search_id,version,started,status,total) VALUES(?,1,?,'done',1)",(self.sid,time.time())).lastrowid
            config=self.search.model_copy(update={'notify_whatsapp':True})
            persist_snapshots(c,self.sid,1,cid,config,[{'direction':'outbound','status':'ok','flights':[event()['flight']]}])
            row=c.execute("SELECT * FROM outbox WHERE channel='email' ORDER BY created DESC LIMIT 1").fetchone()
            self.assertIn('<!doctype html>',row['body_html']);self.assertIn('/go/',row['body'])
            self.assertNotIn('*Meta atingida*',row['body']);self.assertIn('*Meta atingida*',enqueue.call_args.args[-1])
            self.assertNotIn('tfs=',enqueue.call_args.args[-1])
