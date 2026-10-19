"""Daily health summary: 08:00 on the administrator's clock, once a day, off by default, its text in three languages."""
import test_isolation  # noqa: F401 - first: temporary data, no seed, idle workers
import json
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch
from fastapi import Response
from backend import store, mail, accounts, digest, incidents

# 2026-10-19 11:00 UTC is 08:00 in São Paulo.
EIGHT = datetime(2026, 10, 19, 11, tzinfo=timezone.utc).timestamp()
DATA = {'queries': 1234, 'success_rate': .973, 'p95_ms': 8200, 'active_trips': 12,
        'alerts': {'whatsapp': {'sent': 10, 'delivered': 9}, 'email': {'sent': 1, 'delivered': 0}},
        'incidents': 2, 'longest': {'code': 'source_paused', 'duration_s': 2520},
        'canary': {'enabled': True, 'origin': 'GRU', 'destination': 'REC', 'total': 48, 'answered': 47, 'mean_ms': 3900}}


class Isolated(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); folder = Path(self.temp.name)
        self.patches = [patch.object(store, 'DATA_DIR', folder), patch.object(mail, 'DATA_DIR', folder), patch.object(mail, 'SETTINGS_FILE', folder/'smtp.json'),
                        patch.object(incidents, 'channels_available', return_value={'whatsapp': True, 'email': True})]
        for item in self.patches: item.start()
        store.setup(seed=False)
        self.admin = accounts.register(accounts.Registration(name='Ana Admin', country='BR', phone='11987654321', password='fixture-password-only'), Response(), admin=True)['id']
        with store.db() as c: c.execute("UPDATE accounts SET emails=?,timezone='America/Sao_Paulo' WHERE id=?", (json.dumps(['ana@example.org']), self.admin))

    def tearDown(self):
        for item in reversed(self.patches): item.stop()
        self.temp.cleanup()

    def outbox(self):
        with store.db() as c: return [dict(r) for r in c.execute("SELECT * FROM outbox WHERE kind='health_digest' ORDER BY created,channel")]


class ScheduleTests(Isolated):
    def test_off_by_default_sends_nothing(self):
        self.assertEqual(digest.send_due(EIGHT+3600), [])
        self.assertEqual(self.outbox(), [])

    def test_from_eight_on_the_administrators_clock_once_a_day(self):
        self.assertFalse(digest.set_enabled(True))
        self.assertEqual(digest.send_due(EIGHT-60), [])
        self.assertEqual(len(digest.send_due(EIGHT)), 2)
        rows = self.outbox()
        self.assertEqual([(r['channel'], r['status'], r['owner_id'], r['next_due']) for r in rows], [('email', 'pending', self.admin, EIGHT), ('whatsapp', 'pending', self.admin, EIGHT)])
        self.assertEqual(rows[0]['subject'], 'Radar de Voos · Resumo diário de 18/10')
        # Again that day, or after a restart: nothing; the date is kept.
        self.assertEqual(digest.send_due(EIGHT+3600), [])
        with store.db() as c: self.assertEqual(c.execute('SELECT value FROM metadata WHERE key=?', (digest.SENT+self.admin,)).fetchone()[0], '2026-10-19')
        # 07:59 the next day is still before it; 08:00 sends the next one.
        self.assertEqual(digest.send_due(EIGHT+86400-60), [])
        self.assertEqual(len(digest.send_due(EIGHT+86400)), 2)
        # In another time zone, 08:00 is another instant.
        with store.db() as c: c.execute("UPDATE accounts SET timezone='Europe/Lisbon' WHERE id=?", (self.admin,))
        self.assertEqual(digest.send_due(EIGHT+2*86400-4*3600-60), [])
        self.assertEqual(len(digest.send_due(EIGHT+2*86400-4*3600)), 2)

    def test_quiet_hours_hold_it_and_turning_them_off_releases_it(self):
        digest.set_enabled(True)
        with store.db() as c: c.execute("UPDATE accounts SET quiet_hours=1,quiet_start='22:00',quiet_end='09:30' WHERE id=?", (self.admin,))
        digest.send_due(EIGHT)
        self.assertEqual({r['next_due'] for r in self.outbox()}, {EIGHT+5400})
        with store.db() as c:
            c.execute('UPDATE accounts SET quiet_hours=0 WHERE id=?', (self.admin,))
            accounts.release_held(c, self.admin, now=EIGHT+60)
        self.assertEqual({r['next_due'] for r in self.outbox()}, {EIGHT+60})

    def test_off_it_never_waits_for_the_write_lock(self):
        import sqlite3, time
        holder = sqlite3.connect(store.DATA_DIR/'radar.sqlite3', timeout=1)
        try:
            holder.execute('BEGIN IMMEDIATE')
            started = time.monotonic()
            self.assertEqual(digest.send_due(EIGHT), [])
            self.assertLess(time.monotonic()-started, 1)
        finally:
            holder.rollback(); holder.close()

    def test_the_previous_local_day(self):
        start, end, day = digest.window(EIGHT, digest.zone('America/Sao_Paulo'))
        self.assertEqual((day, start, end), (date(2026, 10, 18), datetime(2026, 10, 18, 3, tzinfo=timezone.utc).timestamp(), datetime(2026, 10, 19, 3, tzinfo=timezone.utc).timestamp()))
        with store.db() as c:
            for at, status, sid, ms in ((start+10, 'ok', 'trip', 1000), (start+20, 'error', 'trip', 9000), (start+30, 'ok', 'canary', 3000), (end+10, 'ok', 'trip', 1), (start-10, 'ok', 'trip', 1)):
                c.execute('INSERT INTO source_queries(at,search_id,route_key,status,duration_ms) VALUES(?,?,?,?,?)', (at, sid, 'k', status, ms))
            for oid, channel, status, receipt in (('a', 'whatsapp', 'sent', 'read'), ('b', 'whatsapp', 'sent', None), ('c', 'email', 'sent', None), ('d', 'email', 'failed', None)):
                c.execute("INSERT INTO outbox(id,created,alert_ids,subject,body,status,next_due,channel,kind,receipt_status) VALUES(?,?,'[]','s','b',?,?,?,'alert',?)", (oid, start+60, status, start+60, channel, receipt))
            c.execute("INSERT INTO health_incidents(code,level,opened_at,updated_at,resolved_at) VALUES('queue_delay','warning',?,?,?)", (start-600, start, start+600))
            c.execute("INSERT INTO health_incidents(code,level,opened_at,updated_at,resolved_at) VALUES('source_paused','critical',?,?,?)", (start+3600, start, start+3600+2520))
            c.execute("INSERT INTO health_incidents(code,level,opened_at,updated_at,resolved_at) VALUES('stale_trip','warning',?,?,?)", (start-9000, start, start-60))
            data = digest.summary(c, start, end, EIGHT)
        self.assertEqual({k: data[k] for k in ('queries', 'success_rate', 'p95_ms', 'incidents', 'longest')},
                         {'queries': 3, 'success_rate': .6667, 'p95_ms': 9000, 'incidents': 2, 'longest': {'code': 'source_paused', 'duration_s': 2520}})
        self.assertEqual(data['alerts'], {'whatsapp': {'sent': 2, 'delivered': 1}, 'email': {'sent': 1, 'delivered': 0}})
        self.assertEqual({k: data['canary'][k] for k in ('total', 'answered', 'mean_ms', 'enabled')}, {'total': 1, 'answered': 1, 'mean_ms': 3000, 'enabled': True})


class TextTests(unittest.TestCase):
    def test_portuguese_english_and_spanish(self):
        link = 'https://radar.example/admin/saude'
        subject, chat, text = digest.message(DATA, date(2026, 10, 18), 'pt', link)
        self.assertEqual(subject, 'Radar de Voos · Resumo diário de 18/10')
        self.assertEqual(chat, '\n'.join(['*Radar de Voos · Resumo de 18/10*', 'Consultas: 1.234 · 97,3% com sucesso · p95 8,2 s', 'Viagens ativas: 12',
                                          'Alertas: WhatsApp 10 enviados, 9 entregues · E-mail 1 enviado', 'Incidentes: 2 · o mais longo: Fonte de tarifas pausada, 42 min',
                                          'Rota de controle GRU → REC: 47 de 48 com resposta · média 3,9 s', 'Ver em '+link]))
        self.assertEqual(text, chat.replace('*Radar de Voos · Resumo de 18/10*', 'Radar de Voos · Resumo de 18/10'))
        self.assertEqual(digest.message(DATA, date(2026, 10, 18), 'en', link)[1], '\n'.join([
            '*Radar de Voos · Summary of 10/18*', 'Queries: 1,234 · 97.3% successful · p95 8.2 s', 'Active trips: 12',
            'Alerts: WhatsApp 10 sent, 9 delivered · E-mail 1 sent', 'Incidents: 2 · longest: Fare source paused, 42 min',
            'Control route GRU → REC: 47 of 48 answered · mean 3.9 s', 'See '+link]))
        self.assertEqual(digest.message(DATA, date(2026, 10, 18), 'es', link)[1], '\n'.join([
            '*Radar de Voos · Resumen del 18/10*', 'Consultas: 1.234 · 97,3% con éxito · p95 8,2 s', 'Viajes activos: 12',
            'Alertas: WhatsApp 10 enviadas, 9 entregadas · Correo 1 enviada', 'Incidentes: 2 · el más largo: Fuente de tarifas en pausa, 42 min',
            'Ruta de control GRU → REC: 47 de 48 con respuesta · media 3,9 s', 'Ver en '+link]))

    def test_a_quiet_day(self):
        quiet = {**DATA, 'queries': 0, 'success_rate': None, 'p95_ms': None, 'alerts': {}, 'incidents': 0, 'longest': None,
                 'canary': {**DATA['canary'], 'enabled': False}}
        lines = digest.message(quiet, date(2026, 10, 18), 'pt', '')[1].split('\n')
        self.assertEqual(lines[1:], ['Consultas: nenhuma', 'Viagens ativas: 12', 'Alertas: nenhum enviado', 'Incidentes: nenhum', 'Rota de controle: desligada'])


if __name__ == '__main__':
    unittest.main()
