"""OAuth/Gmail tests are simulated: no Google sign-in and no external messages."""
import hashlib
import importlib
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit,parse_qs
from urllib.error import HTTPError
from fastapi.testclient import TestClient
from backend import store,mail,google_mail


class GoogleMailTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();folder=Path(self.temp.name)
        self.patches=[patch.object(store,'DATA_DIR',folder),patch.object(mail,'DATA_DIR',folder),patch.object(mail,'SETTINGS_FILE',folder/'smtp-private.json'),patch.object(google_mail,'APPLICATION_CLIENT_FILE',folder/'public-client.json')]
        for p in self.patches:p.start()
        store.setup(seed=False);self.app=importlib.import_module('backend.app')
        self.client=TestClient(self.app.app,base_url='http://127.0.0.1:8765',client=('127.0.0.1',5555))
        self.headers={'x-radar-token':self.app.TOKEN}
        r=self.client.post('/api/auth/bootstrap',json={'name':'Admin fixture','country':'US','phone':'6502530000','password':'fixture-password-only'},headers=self.headers)
        self.assertEqual(r.status_code,200,r.text)
        self.client_config={'client_id':'fixture.apps.googleusercontent.com','client_secret':'fixture-secret-not-real'}

    def tearDown(self):
        self.client.close()
        for p in self.patches:p.stop()
        self.temp.cleanup()

    def start(self):
        self.assertEqual(self.client.put('/api/google/client',json=self.client_config,headers=self.headers).status_code,200)
        r=self.client.post('/api/google/start',json={},headers=self.headers)
        self.assertEqual(r.status_code,200,r.text)
        return parse_qs(urlsplit(r.json()['url']).query)

    def connect(self):
        query=self.start()
        token={'scope':google_mail.SCOPES,'access_token':'fixture-access','refresh_token':'fixture-refresh','expires_in':3600}
        with patch.object(google_mail,'remote',side_effect=[token,{'email':'sender@example.org','email_verified':True}]) as remote:
            r=self.client.get('/api/google/callback',params={'state':query['state'][0],'code':'fixture-code'})
            self.assertIn('Conta conectada',r.text)
            self.assertEqual(remote.call_args_list[0].args[1]['grant_type'],'authorization_code')
        return query

    def test_callback_uses_the_account_language(self):
        self.client.put('/api/profile/language',json={'language':'es'},headers=self.headers)
        query=self.start()
        with patch.object(google_mail,'remote') as remote:
            response=self.client.get('/api/google/callback',params={'state':query['state'][0],'error':'access_denied'})
        self.assertIn('lang="es"',response.text)
        self.assertIn('Conexión no completada',response.text)
        self.assertIn('no fue autorizada',response.text)
        remote.assert_not_called()

    def test_authorization_has_pkce_state_offline_and_send_only_scope(self):
        query=self.start()
        self.assertEqual(query['access_type'],['offline'])
        self.assertEqual(query['code_challenge_method'],['S256'])
        self.assertIn(google_mail.SEND_SCOPE,query['scope'][0].split())
        self.assertNotIn('https://mail.google.com/',query['scope'][0])
        self.assertEqual(query['redirect_uri'],[google_mail.REDIRECT_URI])
        with store.db() as c:
            row=c.execute('SELECT * FROM oauth_requests').fetchone()
            self.assertNotEqual(row['digest'],query['state'][0])
            self.assertEqual(row['digest'],hashlib.sha256(query['state'][0].encode()).hexdigest())
            self.assertNotIn(row['verifier'],json.dumps(query))

    def test_callback_connects_once_and_never_exposes_tokens(self):
        query=self.connect();status=google_mail.public_settings()
        self.assertTrue(status['connected']);self.assertEqual(status['email'],'sender@example.org')
        self.assertEqual(google_mail.path().stat().st_mode&0o777,0o600)
        for key in ('client_secret','access_token','refresh_token'):
            self.assertNotIn(key,status)
        with patch.object(google_mail,'remote') as remote:
            response=self.client.get('/api/google/callback',params={'state':query['state'][0],'code':'replay'})
            self.assertIn('expirou',response.text);remote.assert_not_called()
        self.assertIn('Content-Security-Policy',response.headers)

    def test_cancelled_or_expired_flow_cannot_connect(self):
        query=self.start()
        with store.db() as c:c.execute('UPDATE oauth_requests SET created=?',(time.time()-601,))
        with patch.object(google_mail,'remote') as remote:
            result=self.client.get('/api/google/callback',params={'state':query['state'][0],'code':'fixture-code'})
            self.assertIn('expirou',result.text);remote.assert_not_called()
        query=self.start()
        with patch.object(google_mail,'remote') as remote:
            result=self.client.get('/api/google/callback',params={'state':query['state'][0],'error':'access_denied'})
            self.assertIn('não foi autorizada',result.text);remote.assert_not_called()

    def test_logout_invalidates_pending_connection(self):
        query=self.start();self.client.post('/api/auth/logout',json={},headers=self.headers)
        with patch.object(google_mail,'remote') as remote:
            result=self.client.get('/api/google/callback',params={'state':query['state'][0],'code':'fixture-code'})
            self.assertIn('expirou',result.text);remote.assert_not_called()

    def test_missing_send_permission_does_not_connect(self):
        query=self.start()
        with patch.object(google_mail,'remote',return_value={'scope':'openid email','access_token':'fixture-access','refresh_token':'fixture-refresh'}):
            result=self.client.get('/api/google/callback',params={'state':query['state'][0],'code':'fixture-code'})
            self.assertIn('Autorize o envio',result.text)
        self.assertFalse(google_mail.public_settings()['connected'])

    def test_failed_token_exchange_is_visible_in_parent_and_admin_status(self):
        import io
        query=self.start()
        response=io.BytesIO(json.dumps({'error':'invalid_grant','error_description':'private-code-and-token-never-reflect'}).encode())
        failure=HTTPError(google_mail.TOKEN_URL,400,'fixture',{},response)
        with patch.object(google_mail,'remote',side_effect=failure):
            result=self.client.get('/api/google/callback',params={'state':query['state'][0],'code':'fixture-code'})
        self.assertIn('expirou ou já foi usada',result.text)
        self.assertIn('"message":',result.text)
        self.assertNotIn('private-code-and-token',result.text)
        self.assertNotIn('fixture-code',result.text)
        self.assertEqual(result.headers['cache-control'],'no-store')
        self.assertIn('style-src',result.headers['content-security-policy'])
        self.assertIn('Voltar ao radar',result.text)
        self.assertIn('expirou ou já foi usada',google_mail.public_settings()['error'])
        self.assertFalse(google_mail.public_settings()['connected'])

    def test_invalid_state_does_not_overwrite_existing_connection_error(self):
        self.start();google_mail.remember_connection_error('Preserved diagnostic')
        self.client.get('/api/google/callback',params={'state':'invalid','error':'access_denied'})
        self.assertEqual(google_mail.public_settings()['error'],'Preserved diagnostic')

    def test_network_failure_is_reported_without_internal_details(self):
        from urllib.error import URLError
        query=self.start()
        with patch.object(google_mail,'remote',side_effect=URLError('private-internal-detail')):
            result=self.client.get('/api/google/callback',params={'state':query['state'][0],'code':'fixture-code'})
        self.assertIn('conexão de internet',result.text)
        self.assertNotIn('private-internal-detail',result.text)

    def test_provider_credential_requirement_is_translated_without_raw_description(self):
        import io
        failure=HTTPError(google_mail.TOKEN_URL,400,'fixture',{},io.BytesIO(b'{"error":"invalid_request","error_description":"client_secret is missing; never expose this raw detail"}'))
        message=google_mail.authorization_error(failure)
        self.assertIn('credencial adicional',message)
        self.assertNotIn('never expose',message)

    def test_malformed_provider_error_has_safe_fallback(self):
        import io
        failure=HTTPError(google_mail.TOKEN_URL,500,'fixture',{},io.BytesIO(b'<html>private fixture</html>'))
        self.assertNotIn('private fixture',google_mail.authorization_error(failure))

    def test_refresh_token_is_renewed_without_new_popup(self):
        self.connect();data=google_mail.settings();google_mail.write({**data,'expires':0})
        with patch.object(google_mail,'remote',return_value={'access_token':'fixture-renewed','expires_in':3600}) as remote:
            self.assertEqual(google_mail.access_token(),'fixture-renewed')
            self.assertEqual(remote.call_args.args[1]['grant_type'],'refresh_token')
        self.assertEqual(google_mail.settings()['refresh_token'],'fixture-refresh')

    def test_revoked_token_requires_reconnection_without_smtp_fallback(self):
        self.connect();data=google_mail.settings();google_mail.write({**data,'expires':0})
        with patch.object(google_mail,'remote',side_effect=HTTPError(google_mail.TOKEN_URL,400,'fixture',{},None)):
            with self.assertRaises(google_mail.GoogleMailError):google_mail.access_token()
        self.assertFalse(google_mail.public_settings()['connected'])
        mail.save_settings(mail.SMTPSettings(enabled=True,host='smtp.example.org',sender='old@example.org',recipient='test@example.org'))
        self.assertFalse(mail.available());self.assertEqual(mail.delivery_settings()['provider'],'google')

    def test_gmail_transport_uses_connected_sender_and_all_recipients(self):
        self.connect()
        with patch.object(google_mail,'remote',return_value={'id':'provider-fixture'}) as remote:
            mail.transmit({**mail.delivery_settings(),'recipient':['one@example.org','two@example.org']},'fixture','Subject','Test message')
        self.assertEqual(remote.call_args.args[0],google_mail.SEND_URL)
        import base64
        from email import message_from_bytes
        message=message_from_bytes(base64.urlsafe_b64decode(remote.call_args.args[1]['raw']))
        self.assertEqual(message['From'],'sender@example.org')
        self.assertIn('one@example.org',message['To']);self.assertIn('two@example.org',message['To'])

    def test_gmail_test_is_queued_to_connected_account_not_old_smtp_recipient(self):
        self.connect()
        result=self.client.post('/api/smtp/test',json={},headers=self.headers)
        self.assertEqual(result.status_code,200,result.text)
        with store.db() as c:self.assertEqual(json.loads(c.execute('SELECT recipients FROM outbox').fetchone()[0]),['sender@example.org'])

    def test_custom_test_recipient_is_saved_and_reused_without_changing_contacts(self):
        self.connect()
        profile_before=self.client.get('/api/state').json()['user']['emails']
        response=self.client.post('/api/smtp/test',json={'recipient':'test-recipient@example.org'},headers=self.headers)
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['recipient'],'test-recipient@example.org')
        with store.db() as c:
            self.assertEqual(json.loads(c.execute('SELECT recipients FROM outbox').fetchone()[0]),['test-recipient@example.org'])
            c.execute('UPDATE outbox SET created=?',(time.time()-61,))
        response=self.client.post('/api/smtp/test',json={},headers=self.headers)
        self.assertEqual(response.json()['recipient'],'test-recipient@example.org')
        state=self.client.get('/api/state').json()
        self.assertEqual(state['mail_test_recipient'],'test-recipient@example.org')
        self.assertEqual(state['deliveries'][0]['recipients'],['test-recipient@example.org'])
        self.assertEqual(state['user']['emails'],profile_before)
        self.assertEqual(google_mail.public_settings()['email'],'sender@example.org')

    def test_invalid_test_address_does_not_enqueue_or_save(self):
        self.connect()
        for recipient in ('invalid-address','a@example.org\r\nBcc: other@example.org'):
            response=self.client.post('/api/smtp/test',json={'recipient':recipient},headers=self.headers)
            self.assertEqual(response.status_code,422,response.text)
        with store.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM outbox').fetchone()[0],0)
        self.assertEqual(mail.test_recipient(),'')

    def test_google_configuration_is_administrator_only(self):
        other=TestClient(self.app.app)
        try:
            other.post('/api/auth/register',json={'name':'User fixture','country':'GB','phone':'02079460018','password':'fixture-password-only'},headers=self.headers)
            self.assertEqual(other.put('/api/google/client',json=self.client_config,headers=self.headers).status_code,403)
            self.assertEqual(other.post('/api/google/start',json={},headers=self.headers).status_code,403)
            self.assertEqual(other.post('/api/mail/connect',json={'email':'someone@gmail.com'},headers=self.headers).status_code,403)
            self.assertEqual(other.post('/api/google/disconnect',json={},headers=self.headers).status_code,403)
            self.assertIsNone(other.get('/api/state').json()['google_mail'])
        finally:other.close()

    def test_disconnect_removes_tokens_but_keeps_project_config(self):
        self.connect();self.client.post('/api/google/disconnect',json={},headers=self.headers)
        data=google_mail.settings()
        self.assertNotIn('refresh_token',data);self.assertNotIn('access_token',data)
        self.assertTrue(google_mail.public_settings()['configured'])
        self.assertFalse(google_mail.public_settings()['connected'])

    def test_email_first_gmail_opens_authorization_with_login_hint(self):
        self.start()
        with patch('backend.mail_discovery.dns.resolver.resolve') as resolve:
            result=self.client.post('/api/mail/connect',json={'email':'someone@gmail.com'},headers=self.headers)
            resolve.assert_not_called()
        self.assertEqual(result.status_code,200,result.text)
        self.assertTrue(result.json()['ready'])
        query=parse_qs(urlsplit(result.json()['url']).query)
        self.assertEqual(query['login_hint'],['someone@gmail.com'])
        self.assertEqual(urlsplit(result.json()['url']).hostname,'accounts.google.com')

    def test_email_first_google_without_app_credentials_has_no_fake_login(self):
        result=self.client.post('/api/mail/connect',json={'email':'someone@gmail.com'},headers=self.headers)
        self.assertEqual(result.status_code,200,result.text)
        self.assertTrue(result.json()['setup_required'])
        self.assertFalse(result.json()['ready'])
        self.assertNotIn('url',result.json())

    def test_workspace_email_is_discovered_and_forwarded_to_google(self):
        from types import SimpleNamespace
        self.start()
        with patch('backend.mail_discovery.dns.resolver.resolve',return_value=[SimpleNamespace(exchange='ASPMX.L.GOOGLE.COM.')]):
            result=self.client.post('/api/mail/connect',json={'email':'person@example.org'},headers=self.headers)
        self.assertEqual(result.json()['provider'],'google')
        self.assertEqual(parse_qs(urlsplit(result.json()['url']).query)['login_hint'],['person@example.org'])

    def bundled_desktop(self,client_id='official-fixture.apps.googleusercontent.com'):
        google_mail.APPLICATION_CLIENT_FILE.write_text(json.dumps({'client_id':client_id,'client_type':'desktop'}))

    def test_desktop_loopback_protocol_with_simulated_provider(self):
        self.bundled_desktop()
        self.assertTrue(google_mail.public_settings()['configured'])
        self.assertFalse(google_mail.public_settings()['client_secret_set'])
        result=self.client.post('/api/mail/connect',json={'email':'someone@gmail.com'},headers=self.headers)
        self.assertTrue(result.json()['ready'])
        query=parse_qs(urlsplit(result.json()['url']).query)
        self.assertEqual(query['redirect_uri'],['http://127.0.0.1:8765/'])
        self.assertEqual(query['client_id'],['official-fixture.apps.googleusercontent.com'])
        with patch.object(google_mail,'remote',side_effect=[{'access_token':'fixture-access','refresh_token':'fixture-refresh','scope':google_mail.SCOPES,'expires_in':3600},{'email':'someone@gmail.com','email_verified':True}]) as remote:
            callback=self.client.get('/',params={'state':query['state'][0],'code':'fixture-code'})
            self.assertIn('Conta conectada',callback.text)
            self.assertNotIn('client_secret',remote.call_args_list[0].args[1])
            self.assertIn('code_verifier',remote.call_args_list[0].args[1])
            self.assertEqual(remote.call_args_list[0].args[1]['redirect_uri'],'http://127.0.0.1:8765/')
        data=google_mail.settings();google_mail.write({**data,'expires':0})
        with patch.object(google_mail,'remote',return_value={'access_token':'renewed','expires_in':3600}) as remote:
            google_mail.access_token()
            self.assertNotIn('client_secret',remote.call_args.args[1])

    def test_matching_desktop_credential_is_used_for_exchange_and_refresh(self):
        self.bundled_desktop()
        google_mail.write({**google_mail.application_client(),'client_secret':'fixture-desktop-key'})
        self.assertEqual(google_mail.client_parameters(google_mail.settings())['client_secret'],'fixture-desktop-key')
        self.assertTrue(google_mail.public_settings()['client_secret_set'])
        self.assertNotIn('client_secret',google_mail.public_settings())
        result=self.client.post('/api/mail/connect',json={'email':'someone@gmail.com'},headers=self.headers)
        query=parse_qs(urlsplit(result.json()['url']).query)
        self.assertNotIn('fixture-desktop-key',result.json()['url'])
        tokens={'access_token':'fixture-access','refresh_token':'fixture-refresh','scope':google_mail.SCOPES,'expires_in':3600}
        with patch.object(google_mail,'remote',side_effect=[tokens,{'email':'someone@gmail.com','email_verified':True}]) as remote:
            response=self.client.get('/',params={'state':query['state'][0],'code':'fixture-code'})
            self.assertIn('Conta conectada',response.text)
            self.assertEqual(remote.call_args_list[0].args[1]['client_secret'],'fixture-desktop-key')
        google_mail.write({**google_mail.settings(),'expires':0})
        with patch.object(google_mail,'remote',return_value={'access_token':'renewed','expires_in':3600}) as remote:
            google_mail.access_token()
            self.assertEqual(remote.call_args.args[1]['client_secret'],'fixture-desktop-key')

    def test_public_client_manifest_rejects_secrets_or_web_clients(self):
        for data in ({'client_id':'fixture.apps.googleusercontent.com','client_type':'desktop','client_secret':'never-publish'}, {'client_id':'fixture.apps.googleusercontent.com','client_type':'web'}):
            google_mail.APPLICATION_CLIENT_FILE.write_text(json.dumps(data))
            with self.assertRaises(google_mail.GoogleMailError):google_mail.application_client()

    def test_changing_distribution_client_does_not_reuse_another_client_token(self):
        self.connect();self.bundled_desktop()
        effective=google_mail.settings()
        self.assertNotIn('refresh_token',effective)
        self.assertNotIn('client_secret',effective)
        self.assertTrue(effective['needs_reconnect'])
        mail.save_settings(mail.SMTPSettings(enabled=True,host='smtp.example.org',sender='old@example.org',recipient='test@example.org'))
        self.assertFalse(mail.available())
        self.assertEqual(mail.delivery_settings()['provider'],'google')


class MailDiscoveryTests(unittest.TestCase):
    def test_gmail_and_googlemail_do_not_need_dns(self):
        from backend.mail_discovery import identify
        with patch('backend.mail_discovery.dns.resolver.resolve') as resolve:
            self.assertEqual(identify('someone@gmail.com'),'google')
            self.assertEqual(identify('someone@googlemail.com'),'google')
            resolve.assert_not_called()

    def test_workspace_legacy_mx(self):
        from backend.mail_discovery import identify
        from types import SimpleNamespace
        with patch('backend.mail_discovery.dns.resolver.resolve',return_value=[SimpleNamespace(exchange='ALT1.ASPMX.L.GOOGLE.COM.')]) as resolve:
            self.assertEqual(identify('person@example.org'),'google')
            resolve.assert_called_once_with('example.org','MX',lifetime=4)

    def test_workspace_current_mx(self):
        from backend.mail_discovery import identify
        from types import SimpleNamespace
        with patch('backend.mail_discovery.dns.resolver.resolve',return_value=[SimpleNamespace(exchange='smtp.google.com.')]):
            self.assertEqual(identify('person@example.org'),'google')

    def test_google_lookalike_host_is_not_google(self):
        from backend.mail_discovery import identify
        from types import SimpleNamespace
        with patch('backend.mail_discovery.dns.resolver.resolve',return_value=[SimpleNamespace(exchange='aspmx.l.google.com.evil.example.')]):
            self.assertEqual(identify('person@example.org'),'other')

    def test_dns_failure_keeps_provider_unknown(self):
        from backend.mail_discovery import identify
        import dns.exception
        with patch('backend.mail_discovery.dns.resolver.resolve',side_effect=dns.exception.Timeout):
            self.assertEqual(identify('person@example.org'),'unknown')


class ReleasePreparationTests(unittest.TestCase):
    def test_only_public_desktop_identity_is_packaged(self):
        from scripts.prepare_google_release import public_client
        result=public_client({'installed':{'client_id':'fixture.apps.googleusercontent.com','client_secret':'private-fixture','refresh_token':'private-token','redirect_uris':['http://localhost']}})
        self.assertEqual(result,{'client_id':'fixture.apps.googleusercontent.com','client_type':'desktop'})

    def test_web_credential_is_not_packaged(self):
        from scripts.prepare_google_release import public_client
        with self.assertRaises(ValueError):
            public_client({'web':{'client_id':'fixture.apps.googleusercontent.com','client_secret':'private-fixture'}})
