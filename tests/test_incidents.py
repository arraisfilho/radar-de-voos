"""Health incidents: hysteresis, notices to the administrators, reminders, acknowledgement and the endpoints."""
import test_isolation  # noqa: F401 - first: temporary data, no seed, idle workers
import importlib
import json
import tempfile
import threading
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from fastapi import Response
from fastapi.testclient import TestClient
from backend import store, mail, accounts, incidents, health, engine
from backend.engine import Monitor

# 2026-10-19 12:00 UTC, 09:00 in São Paulo.
NOON = datetime(2026, 10, 19, 12, tzinfo=timezone.utc).timestamp()
WORKERS = {'collector': {'alive': True, 'age_s': 1.0, 'limit_s': 120, 'late': False}, 'email_sender': {'alive': True, 'age_s': 2.0, 'limit_s': 300, 'late': False},
           'whatsapp_sender': {'alive': True, 'age_s': 3.0, 'limit_s': 300, 'late': False}}


def metrics(now, *reasons, **changes):
    """The parts of health.collect() that check() and the notices read, with the given reason codes."""
    base = {'generated_at': now, 'status': {'level': 'ok', 'reasons': list(reasons)},
            'source': {'status': 'paused', 'kind': 'blocked', 'paused_since': now-1320, 'retry_at': now+300},
            'workers': {**WORKERS, 'collector': {'alive': True, 'age_s': 300.0, 'limit_s': 120, 'late': True}},
            'queries': {'hour': {'total': 20, 'ok': 12, 'empty': 0, 'error': 5, 'blocked': 3}},
            'queue': {'due': 2, 'max_delay_s': 1500.0},
            'freshness': {'active': 1, 'fresh': 0, 'stalest': {'id': 'trip', 'title': 'Lisboa', 'route': 'GRU → LIS', 'owner_id': None, 'age_s': 7200}},
            'channels': {'whatsapp': {'available': True, 'failed_streak': 3, 'last_failure_at': now-60}, 'email': {'available': True, 'failed_streak': 4, 'last_failure_at': now-60}},
            'canary': {'enabled': True, 'origin': 'GRU', 'destination': 'REC', 'failed_streak': 3, 'last': {'at': now-60, 'status': 'error', 'kind': 'timeout', 'duration_ms': 35000}}}
    return base | changes


class Isolated(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); folder = Path(self.temp.name)
        self.patches = [patch.object(store, 'DATA_DIR', folder), patch.object(mail, 'DATA_DIR', folder), patch.object(mail, 'SETTINGS_FILE', folder/'smtp.json'),
                        patch.object(incidents, 'channels_available', side_effect=lambda: dict(self.available))]
        for item in self.patches: item.start()
        store.setup(seed=False)
        self.available = {'whatsapp': True, 'email': True}
        self.admin = accounts.register(accounts.Registration(name='Ana Admin', country='BR', phone='11987654321', password='fixture-password-only'), Response(), admin=True)['id']
        self.profile(emails=json.dumps(['ana@example.org']), timezone='America/Sao_Paulo')

    def tearDown(self):
        for item in reversed(self.patches): item.stop()
        self.temp.cleanup()

    def profile(self, **changes):
        with store.db() as c: c.execute('UPDATE accounts SET '+','.join(k+'=?' for k in changes)+' WHERE id=?', (*changes.values(), self.admin))

    def run_checks(self, start, *steps):
        """One check per step, CHECK_SECONDS apart: each step is the reason codes present then."""
        for index, reasons in enumerate(steps):
            incidents.check(metrics(start+index*incidents.CHECK_SECONDS, *reasons))
        return start+(len(steps)-1)*incidents.CHECK_SECONDS

    def deliver(self, at, status='sent'):
        """The senders' part: every pending notice due by `at` goes out then (or fails)."""
        with store.db() as c:
            for row in c.execute("SELECT id FROM outbox WHERE status='pending' AND next_due<=?", (at,)).fetchall():
                c.execute('UPDATE outbox SET status=?,sent=? WHERE id=?', (status, at if status == 'sent' else None, row['id']))
                if status == 'sent': incidents.mark_sent(c, row['id'], at)

    def incidents(self):
        with store.db() as c: return [incidents.public(r) for r in c.execute('SELECT * FROM health_incidents ORDER BY id')]

    def notices(self):
        with store.db() as c:
            return [dict(r) for r in c.execute('SELECT o.*,n.event,n.incident_id FROM outbox o JOIN health_notices n ON n.outbox_id=o.id ORDER BY o.created,n.event,o.channel')]


class HysteresisTests(Isolated):
    def test_opens_after_two_checks_in_a_row_and_resolves_after_three_without(self):
        # One check alone, then a gap: no incident.
        self.run_checks(NOON, ['source_paused'], [], ['source_paused'], [])
        self.assertEqual(self.incidents(), [])
        start = NOON+600
        self.run_checks(start, ['source_paused'], ['source_paused'])
        [incident] = self.incidents()
        self.assertEqual((incident['code'], incident['level'], incident['opened_at'], incident['resolved_at']), ('source_paused', 'critical', start, None))
        self.assertEqual(incident['details'], {'paused_since': start+60-1320, 'paused_s': 1320, 'kind': 'blocked', 'retry_at': start+360})
        self.assertEqual([(n['event'], n['channel']) for n in self.notices()], [('opened', 'email'), ('opened', 'whatsapp')])
        self.deliver(start+60)
        # Two checks without it, then it is back: still the same open incident.
        self.run_checks(start+120, [], [], ['source_paused'], ['source_paused'], ['source_paused'])
        self.assertEqual([i['resolved_at'] for i in self.incidents()], [None])
        # Three checks in a row without it: resolved at the first of them, and told it was (it lasted 7 min).
        self.run_checks(start+420, [], [], [])
        [incident] = self.incidents()
        self.assertEqual((incident['resolved_at'], incident['notified_count'], incident['reopened']), (start+420, 2, 0))
        resolved = [n for n in self.notices() if n['event'].startswith('resolved')]
        self.assertEqual([n['channel'] for n in resolved], ['email', 'whatsapp'])
        self.assertTrue(resolved[1]['body'].startswith('*Radar de Voos · Resolvido em 7 min*\nFonte de tarifas pausada · Desde 09:10\n'))
        # Back after more than 30 min: a new incident with its own notice.
        self.run_checks(start+420+incidents.REOPEN_SECONDS+60, ['source_paused'], ['source_paused'])
        self.assertEqual([i['resolved_at'] is None for i in self.incidents()], [False, True])
        self.assertEqual([n['event'] for n in self.notices()].count('opened'), 4)

    def test_flapping_reopens_the_incident_without_new_notices(self):
        t = self.run_checks(NOON, ['queue_delay'], ['queue_delay'])
        self.deliver(t)
        # Clears for 3 checks and is back for 2, three times in a row.
        for _ in range(3):
            t = self.run_checks(t+60, [], [], [], ['queue_delay'], ['queue_delay'])
            self.deliver(t)
        [incident] = self.incidents()
        self.assertEqual((incident['resolved_at'], incident['reopened'], incident['opened_at']), (None, 3, NOON))
        # The first resolution was too short to tell, so it came back silently; after the "Resolvido" of the second,
        # it came back with "Voltou"; then one more "Resolvido" and, within 2 h of that "Voltou", silence. Never a second opening.
        events = [n['event'] for n in self.notices()]
        self.assertEqual(events, ['opened', 'opened', 'resolved-1', 'resolved-1', 'reopened-2', 'reopened-2', 'resolved-3', 'resolved-3'])
        # Resolved at NOON+420 the second time: 7 min since it opened.
        self.assertTrue(self.notices()[3]['body'].startswith('*Radar de Voos · Resolvido em 7 min*'))
        for _ in range(3):
            t = self.run_checks(t+60, [], [], [], ['queue_delay'], ['queue_delay'])
            self.deliver(t)
        self.assertEqual(len(self.notices()), 8, 'Flapping stays silent until the next 2 h')

    def test_back_after_a_resolution_was_sent_says_so(self):
        t = self.run_checks(NOON, ['source_paused'], ['source_paused'], ['source_paused'], ['source_paused'], ['source_paused'], ['source_paused'])
        self.deliver(t)
        t = self.run_checks(t+60, [], [], [])
        self.deliver(t)
        self.assertEqual([n['event'] for n in self.notices()][-2:], ['resolved-1', 'resolved-1'])
        back = t+600
        self.run_checks(back, ['source_paused'], ['source_paused'])
        [incident] = self.incidents()
        self.assertEqual((incident['resolved_at'], incident['reopened']), (None, 1))
        voltou = [n for n in self.notices() if n['event'].startswith('reopened')]
        self.assertEqual([n['channel'] for n in voltou], ['email', 'whatsapp'])
        self.assertEqual(voltou[0]['subject'], 'Radar de Voos · Voltou: Fonte de tarifas pausada')
        self.assertEqual(voltou[1]['body'], '*Radar de Voos · Voltou: Fonte de tarifas pausada*\nFonte de tarifas pausada há 22 min.\nDesde 09:18.\nVer em http://127.0.0.1:8765/admin/saude')
        with store.db() as c: admin = dict(c.execute('SELECT * FROM accounts WHERE id=?', (self.admin,)).fetchone())
        item = {'id': incident['id'], 'code': 'source_paused', 'level': 'critical', 'opened_at': NOON, 'details': {'paused_s': 1320}, 'back_at': back}
        self.assertEqual(incidents.message(item, 'reopened-2', {**admin, 'language': 'en'}, back+60, '')[1], '*Radar de Voos · Back: Fare source paused*\nFare source paused for 22 min.\nSince 09:18.')
        self.assertEqual(incidents.message(item, 'reopened-2', {**admin, 'language': 'es'}, back+60, '')[1], '*Radar de Voos · Volvió: Fuente de tarifas en pausa*\nFuente de tarifas en pausa desde hace 22 min.\nDesde las 09:18.')

    def test_streaks_restart_after_the_watcher_was_away(self):
        incidents.check(metrics(NOON, 'queue_delay'))
        incidents.check(metrics(NOON+incidents.STALE_STATE+1, 'queue_delay'))
        self.assertEqual(self.incidents(), [])


class NoticeTests(Isolated):
    def test_reminder_every_two_hours_while_open_never_before(self):
        opened = self.run_checks(NOON, ['collector_late'], ['collector_late'])
        self.assertEqual(len(self.notices()), 2)
        # Nothing new while the notice is still to go out; the 2 h count from when it really went.
        self.run_checks(opened+incidents.REMIND_SECONDS, ['collector_late'])
        self.assertEqual(len(self.notices()), 2)
        self.deliver(opened+600)
        self.run_checks(opened+600+incidents.REMIND_SECONDS-60, ['collector_late'])
        self.assertEqual(len(self.notices()), 2)
        self.run_checks(opened+600+incidents.REMIND_SECONDS, ['collector_late'], ['collector_late'])
        notices = self.notices()
        self.assertEqual([n['event'] for n in notices], ['opened', 'opened', 'reminder-1', 'reminder-1'])
        self.assertTrue(notices[3]['body'].startswith('*Radar de Voos · Crítico (lembrete)*\nColetor de tarifas sem sinal há 5 min (limite: 2 min).\nDesde 09:00.'))
        [incident] = self.incidents()
        self.assertEqual((incident['notified_count'], incident['last_notified_at'], incident['notice']), (2, opened+600, 'sent'))
        self.deliver(opened+600+incidents.REMIND_SECONDS+90)
        self.assertEqual(self.incidents()[0]['last_notified_at'], opened+600+incidents.REMIND_SECONDS+90)

    def test_a_failed_notice_is_retried_at_the_next_reminder_not_every_check(self):
        opened = self.run_checks(NOON, ['collector_late'], ['collector_late'])
        self.deliver(opened, 'failed')
        self.run_checks(opened+60, ['collector_late'], ['collector_late'])
        [incident] = self.incidents()
        self.assertEqual((len(self.notices()), incident['notified_count'], incident['last_notified_at']), (2, 0, None))
        self.run_checks(opened+incidents.REMIND_SECONDS, ['collector_late'])
        self.assertEqual([n['event'] for n in self.notices()], ['opened', 'opened', 'reminder-1', 'reminder-1'])

    def test_a_changed_contact_cancels_pending_notices_and_the_next_check_rebuilds_them(self):
        opened = self.run_checks(NOON, ['collector_late'], ['collector_late'])
        with store.db() as c:
            before = c.execute('SELECT * FROM accounts WHERE id=?', (self.admin,)).fetchone()
            c.execute('UPDATE accounts SET emails=? WHERE id=?', (json.dumps(['new@example.org']), self.admin))
            accounts.contacts_changed(c, self.admin, before)
        self.assertEqual({(n['status'], n['error']) for n in self.notices()}, {('cancelled', 'Contato alterado; o aviso será refeito')})
        self.run_checks(opened+60, ['collector_late'])
        rebuilt = [n for n in self.notices() if n['status'] == 'pending']
        self.assertEqual({(n['channel'], n['recipients']) for n in rebuilt}, {('email', '["new@example.org"]'), ('whatsapp', '["+5511987654321"]')})

    def test_acknowledging_silences_reminders_and_withdraws_held_notices(self):
        # A warning during the administrator's quiet hours is held until they end.
        self.profile(quiet_hours=1, quiet_start='08:00', quiet_end='10:00')
        opened = self.run_checks(NOON, ['queue_delay'], ['queue_delay'])
        held = self.notices()
        self.assertEqual({(n['status'], n['next_due']) for n in held}, {('pending', NOON+3600)})
        incident, changed = incidents.acknowledge(self.incidents()[0]['id'], self.admin, now=opened+30)
        self.assertTrue(changed)
        self.assertEqual((incident['acknowledged_at'], incident['acknowledged_by'], incident['acknowledged_name'], incident['notified_count']), (opened+30, self.admin, 'Ana Admin', 0))
        self.assertEqual({(n['status'], n['error']) for n in self.notices()}, {('cancelled', 'Incidente reconhecido antes do envio')})
        self.run_checks(opened+3*incidents.REMIND_SECONDS, ['queue_delay'])
        self.assertEqual(len(self.notices()), 2)
        # A second acknowledgement changes nothing.
        self.assertFalse(incidents.acknowledge(incident['id'], self.admin, now=opened+90)[1])

    def test_a_channel_never_carries_the_notice_about_itself(self):
        cases = [('whatsapp_failing', ['email']), ('whatsapp_late', ['email']), ('email_failing', ['whatsapp']), ('email_late', ['whatsapp']), ('stale_trip', ['email', 'whatsapp'])]
        for index, (code, channels) in enumerate(cases):
            with self.subTest(code=code):
                start = NOON+index*1000
                self.run_checks(start, [code], [code])
                self.assertEqual([n['channel'] for n in self.notices() if n['created'] == start+60], channels)
        # A channel down in this check is not used for the other incidents either.
        self.run_checks(NOON+9000, ['whatsapp_failing', 'source_paused'], ['whatsapp_failing', 'source_paused'])
        self.assertEqual({n['channel'] for n in self.notices() if n['created'] == NOON+9060}, {'email'})

    def test_no_channel_left_is_recorded_as_not_notified(self):
        self.profile(emails='[]')
        self.run_checks(NOON, ['whatsapp_late'], ['whatsapp_late'])
        [incident] = self.incidents()
        self.assertEqual((incident['notice'], incident['notified_count'], incident['last_notified_at']), ('not_notified', 0, None))
        self.assertEqual(self.notices(), [])
        # Without the WhatsApp integration, an incident about the source goes by e-mail only; with no e-mail either, nowhere.
        self.available = {'whatsapp': False, 'email': True}
        self.profile(emails=json.dumps(['ana@example.org', 'ops@example.org']))
        self.run_checks(NOON+600, ['queue_delay'], ['queue_delay'])
        [notice] = self.notices()
        self.assertEqual((notice['channel'], json.loads(notice['recipients'])), ('email', ['ana@example.org', 'ops@example.org']))
        self.deliver(NOON+660)
        # Both resolve; only the one the administrator was told about sends its resolution.
        self.run_checks(NOON+720, ['queue_delay'], ['queue_delay'], ['queue_delay'], ['queue_delay'], [], [], [])
        silent, told = self.incidents()
        self.assertEqual([(n['incident_id'], n['event']) for n in self.notices()], [(told['id'], 'opened'), (told['id'], 'resolved-1')])
        self.assertIsNotNone(silent['resolved_at'])

    def test_quiet_hours_hold_warnings_but_not_critical_incidents(self):
        self.profile(quiet_hours=1, quiet_start='08:00', quiet_end='10:00')
        self.run_checks(NOON, ['collector_late', 'queue_delay'], ['collector_late', 'queue_delay'])
        dues = {(n['incident_id'], n['next_due']) for n in self.notices()}
        critical, warning = self.incidents()
        self.assertEqual((critical['code'], warning['code']), ('collector_late', 'queue_delay'))
        self.assertEqual(dues, {(critical['id'], NOON+60), (warning['id'], NOON+3600)})
        self.assertEqual((critical['notice'], warning['notice'], warning['last_notified_at']), ('sent', 'held', None))
        # Resolved while still held: the held notice is withdrawn and no resolution is sent.
        self.run_checks(NOON+120, ['collector_late'], ['collector_late'], ['collector_late'])
        self.assertIsNotNone(self.incidents()[1]['resolved_at'])
        warned = [n for n in self.notices() if n['incident_id'] == warning['id']]
        self.assertEqual({(n['event'], n['status'], n['error']) for n in warned}, {('opened', 'cancelled', 'Incidente resolvido antes do envio')})
        # Turning the quiet hours off releases held notices at once.
        self.run_checks(NOON+600, ['stale_trip'], ['stale_trip'])
        with store.db() as c:
            c.execute('UPDATE accounts SET quiet_hours=0 WHERE id=?', (self.admin,))
            accounts.release_held(c, self.admin, now=NOON+700)
        self.assertEqual({n['next_due'] for n in self.notices() if n['created'] == NOON+660}, {NOON+700})

    def test_each_administrator_reads_the_notice_in_their_language(self):
        texts = {}
        for language in ('pt', 'en', 'es'):
            self.profile(language=language)
            incident = {'id': 1, 'code': 'error_rate', 'level': 'warning', 'opened_at': NOON-600, 'details': {'total': 20, 'failed': 8, 'rate': .4}}
            with store.db() as c: admin = c.execute('SELECT * FROM accounts WHERE id=?', (self.admin,)).fetchone()
            texts[language] = incidents.message(incident, 'opened', admin, NOON, 'https://radar.example/admin/saude')
        self.assertEqual(texts['pt'], ('Radar de Voos · Atenção: Falhas nas consultas à fonte',
                                       '*Radar de Voos · Atenção*\n40% das consultas da última hora falharam (8 de 20).\nDesde 08:50.\nVer em https://radar.example/admin/saude',
                                       'Radar de Voos · Atenção\n40% das consultas da última hora falharam (8 de 20).\nDesde 08:50.\nVer em https://radar.example/admin/saude'))
        self.assertEqual(texts['en'][1], "*Radar de Voos · Attention*\n40% of the last hour's queries failed (8 of 20).\nSince 08:50.\nSee https://radar.example/admin/saude")
        self.assertEqual(texts['es'][1], '*Radar de Voos · Atención*\nFallaron el 40% de las consultas de la última hora (8 de 20).\nDesde las 08:50.\nVer en https://radar.example/admin/saude')
        # The queued notice follows the administrator's language and clock; a trip name cannot inject formatting.
        self.profile(language='en', timezone='UTC')
        self.run_checks(NOON, ['stale_trip'], ['stale_trip'])
        body = self.notices()[0]['body']
        # The route, never the trip's free-text name.
        self.assertIn('The trip GRU → LIS has not been collected for 2 h.\nSince 12:00.', body); self.assertNotIn('Lisboa', body)
        for language in ('pt', 'en', 'es'):
            for code in health.LEVELS:
                with self.subTest(language=language, code=code):
                    self.assertNotIn('{', incidents.describe(code, health.details(code, metrics(NOON, code)), language))
                    self.assertIn(code, incidents.TEXTS[language]['labels'])

    def test_one_administrators_failure_never_undoes_the_check(self):
        with patch.object(incidents, 'contacts', side_effect=ValueError('broken profile')), self.assertLogs('radar.health', 'WARNING') as captured:
            self.run_checks(NOON, ['collector_late'], ['collector_late'])
        [incident] = self.incidents()
        self.assertEqual((incident['code'], incident['notice'], self.notices()), ('collector_late', 'not_notified', []))
        self.assertIn('Falha ao preparar aviso de saúde', [r.getMessage() for r in captured.records])

    def test_old_incidents_and_orphan_links_are_cleaned(self):
        now = time.time()
        with store.db() as c:
            for days in (91, 89):
                c.execute("INSERT INTO health_incidents(code,level,opened_at,updated_at,resolved_at) VALUES('queue_delay','warning',?,?,?)", (now-days*86400-60, now, now-days*86400))
            c.execute("INSERT INTO health_notices VALUES('gone',2,'opened')")
        health.cleanup(now)
        self.assertEqual([round((time.time()-i['resolved_at'])/86400) for i in self.incidents()], [89])
        with store.db() as c: self.assertEqual(c.execute('SELECT COUNT(*) FROM health_notices').fetchone()[0], 0)

    def test_turned_off_records_incidents_without_notices(self):
        self.assertTrue(incidents.set_notices(False))
        opened = self.run_checks(NOON, ['source_paused'], ['source_paused'])
        [incident] = self.incidents()
        self.assertEqual((incident['notice'], incident['notified_count']), ('disabled', 0))
        self.run_checks(opened+incidents.REMIND_SECONDS, ['source_paused'])
        self.assertEqual(self.notices(), [])
        # Turned on while it is open: the first notice goes at the next check.
        self.assertFalse(incidents.set_notices(True))
        self.run_checks(opened+incidents.REMIND_SECONDS+60, ['source_paused'])
        self.assertEqual([n['event'] for n in self.notices()], ['opened', 'opened'])
        self.assertEqual(self.incidents()[0]['notice'], 'sent')

    def test_notices_go_through_the_existing_e_mail_sender(self):
        now = time.time()
        incidents.check(metrics(now-61, 'collector_late')); incidents.check(metrics(now-1, 'collector_late'))
        sent = []
        with patch.object(engine.mail, 'delivery_settings', return_value={'enabled': True, 'provider': 'smtp'}), \
             patch.object(engine.mail, 'transmit', side_effect=lambda config, oid, subject, body: sent.append((config['recipient'], subject, body))):
            Monitor().send_one()
        self.assertEqual(sent, [(['ana@example.org'], 'Radar de Voos · Crítico: Coletor de tarifas sem sinal', sent[0][2])])
        email = next(n for n in self.notices() if n['channel'] == 'email')
        self.assertEqual((email['status'], email['kind'], email['owner_id'], email['search_id']), ('sent', 'health', self.admin, None))
        whatsapp = next(n for n in self.notices() if n['channel'] == 'whatsapp')
        self.assertEqual((json.loads(whatsapp['recipients']), whatsapp['provider'], whatsapp['kind']), (['+5511987654321'], 'openwa', 'health'))


class WatcherTests(Isolated):
    def test_the_watcher_thread_has_a_heartbeat_and_runs_the_checks(self):
        monitor = Monitor()
        self.assertIn('health_watcher', monitor.status())
        self.assertEqual(monitor.status()['health_watcher']['limit'], engine.HEARTBEAT_LIMITS['health_watcher'])
        with patch.object(incidents, 'watch') as watch:
            worker = threading.Thread(target=monitor.watch_loop); worker.start()
            deadline = time.time()+5
            while time.time() < deadline and not watch.called: time.sleep(.02)
            monitor.stop_event.set(); worker.join(5)
        self.assertFalse(worker.is_alive()); self.assertIn('health_watcher', watch.call_args[0][0])
        self.assertLess(monitor.status()['health_watcher']['age'], 5)

    def test_watch_reads_the_real_metrics(self):
        stuck = {'collector': {'alive': True, 'age': 500.0, 'limit': 120}, 'email_sender': {'alive': True, 'age': 1.0, 'limit': 300},
                 'whatsapp_sender': {'alive': True, 'age': 1.0, 'limit': 300}, 'health_watcher': {'alive': True, 'age': 0.0, 'limit': 180}}
        now = time.time()
        incidents.watch(stuck, now); incidents.watch(stuck, now+60)
        [incident] = self.incidents()
        self.assertEqual((incident['code'], incident['details']), ('collector_late', {'alive': True, 'age_s': 500.0, 'limit_s': 120}))


class EndpointTests(Isolated):
    def setUp(self):
        super().setUp()
        self.app = importlib.import_module('backend.app')
        self.headers = {'x-radar-token': self.app.TOKEN}
        self.client, self.user, self.anon = TestClient(self.app.app), TestClient(self.app.app), TestClient(self.app.app)
        self.assertEqual(self.client.post('/api/auth/login', json={'country': 'BR', 'phone': '11987654321', 'password': 'fixture-password-only'}, headers=self.headers).status_code, 200)
        self.user.post('/api/auth/register', json={'name': 'Customer fixture', 'country': 'GB', 'phone': '02079460018', 'password': 'fixture-password-only'}, headers=self.headers)

    def tearDown(self):
        for client in (self.client, self.user, self.anon): client.close()
        super().tearDown()

    def audit(self, event):
        with store.db() as c: return [json.loads(r[0]) for r in c.execute('SELECT details FROM access_audit WHERE event=? ORDER BY id', (event,))]

    def test_acknowledge_is_for_administrators_and_audited(self):
        self.run_checks(time.time(), ['queue_delay'], ['queue_delay'])
        incident = self.incidents()[0]['id']
        path = '/api/admin/health/incidents/%d/ack' % incident
        self.assertEqual(self.user.post(path, headers=self.headers).status_code, 403)
        self.assertEqual(self.anon.post(path, headers=self.headers).status_code, 401)
        self.assertEqual(self.client.post(path).status_code, 403, 'The page token is required')
        response = self.client.post(path, headers=self.headers)
        self.assertEqual(response.status_code, 200); self.assertEqual(response.json()['acknowledged_by'], self.admin)
        self.assertEqual(self.client.post(path, headers=self.headers).status_code, 200)
        self.assertEqual(self.audit('admin_health_incident_acknowledged'), [{'code': 'queue_delay'}])
        self.assertEqual(self.client.post('/api/admin/health/incidents/999/ack', headers=self.headers).status_code, 404)
        self.run_checks(time.time()+60, [], [], [])
        self.assertEqual(self.client.post(path, headers=self.headers).status_code, 409)

    def test_listing_and_the_notice_switch(self):
        gap = incidents.REOPEN_SECONDS+600
        start = time.time()-23*gap
        for index in range(22):
            self.run_checks(start+index*gap, ['stale_trip'], ['stale_trip'], [], [], [])
        self.run_checks(start+22*gap, ['queue_delay'], ['queue_delay'])
        with patch.object(self.app, 'monitor', test_isolation.IdleMonitor(healthy=True)):
            body = self.client.get('/api/admin/health').json()
        listed = body['incidents']
        self.assertEqual((len(listed), listed[0]['code'], listed[0]['resolved_at']), (21, 'queue_delay', None))
        self.assertEqual([i['resolved_at'] for i in listed[1:]], sorted((i['resolved_at'] for i in listed[1:]), reverse=True))
        self.assertEqual(set(listed[0]), {'id', 'code', 'level', 'opened_at', 'updated_at', 'resolved_at', 'acknowledged_at', 'acknowledged_by', 'acknowledged_name',
                                          'last_notified_at', 'details', 'notified_count', 'notice', 'reopened', 'held_until'})
        self.assertEqual(body['settings'], {'notices': True, 'digest': False, 'canary': {'enabled': True, 'origin': 'GRU', 'destination': 'REC'}})
        self.assertEqual(self.user.put('/api/admin/health/settings', json={'notices': False}, headers=self.headers).status_code, 403)
        settings = self.client.put('/api/admin/health/settings', json={'notices': False}, headers=self.headers).json()
        self.assertEqual((settings['notices'], settings['digest']), (False, False))
        with store.db() as c: self.assertFalse(incidents.notices_enabled(c))
        # The summary and the canary in the same settings; a refused route changes nothing.
        settings = self.client.put('/api/admin/health/settings', json={'digest': True, 'canary': {'origin': 'gig', 'destination': 'SSA'}}, headers=self.headers).json()
        self.assertEqual((settings['digest'], settings['canary']), (True, {'enabled': True, 'origin': 'GIG', 'destination': 'SSA'}))
        for route in ({'origin': 'ZZZ'}, {'origin': 'SSA'}):
            response = self.client.put('/api/admin/health/settings', json={'digest': False, 'canary': route}, headers=self.headers)
            self.assertEqual(response.status_code, 422)
        self.assertEqual(self.client.get('/api/admin/health').json()['settings']['digest'], True)
        self.assertEqual(self.audit('admin_health_notices_changed'), [{'changed': ['notices']}, {'changed': ['canary_origin', 'canary_destination', 'digest']}])


if __name__ == '__main__':
    unittest.main()
