"""Rota de controle (canary) and the measured pace (ritmo): interval, breaker, records, assess; no source requests."""
import test_isolation  # noqa: F401 - first: temporary data, no seed, idle workers
import tempfile
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from fastapi import Response
from backend import store, mail, source, health, canary, accounts
from backend.domain import Search, Leg
from backend.engine import Monitor
from backend.query_gate import QueryGate

WORKERS = {'collector': {'alive': True, 'age': 1.0, 'limit': 120}, 'email_sender': {'alive': True, 'age': 1.0, 'limit': 300},
           'whatsapp_sender': {'alive': True, 'age': 1.0, 'limit': 300}}


class Isolated(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); folder = Path(self.temp.name)
        self.patches = [patch.object(store, 'DATA_DIR', folder), patch.object(mail, 'DATA_DIR', folder), patch.object(mail, 'SETTINGS_FILE', folder/'smtp.json')]
        for item in self.patches: item.start()
        store.setup(seed=False)
        self.monitor = Monitor(); self.monitor.query_gate = QueryGate(min_gap=0)

    def tearDown(self):
        for item in reversed(self.patches): item.stop()
        self.temp.cleanup()

    def put(self, at, status='ok', sid=canary.ID, route='outbound|GRU|REC|2090-01-01', kind=None, duration=4000):
        with store.db() as c:
            c.execute('INSERT INTO source_queries(at,search_id,route_key,status,kind,duration_ms) VALUES(?,?,?,?,?,?)', (at, sid, route, status, kind, duration))

    def rows(self):
        with store.db() as c: return [dict(r) for r in c.execute('SELECT * FROM source_queries ORDER BY at')]

    @staticmethod
    def answer(status, kind=None):
        def result(search, job):
            data = {'status': status, 'flights': [], 'direction': job[0], 'origin': job[1], 'destination': job[2], 'date': job[3], 'collected_at': time.time()}
            if status == 'error': data.update(error='fixture failure', kind=kind)
            return data
        return result


class CanaryTests(Isolated):
    def test_every_thirty_minutes_while_on(self):
        now = time.time()
        self.assertTrue(canary.due(now))
        self.put(now-canary.INTERVAL+1)
        self.assertFalse(canary.due(now))
        self.assertTrue(canary.due(now+1))
        canary.save(enabled=False)
        self.assertFalse(canary.due(now+1))

    def test_the_fixed_query_goes_through_the_gate_and_the_breaker_and_is_recorded(self):
        with patch('backend.engine.fetch', side_effect=self.answer('error', 'timeout')) as remote:
            result = self.monitor.run_canary()
        search, job = remote.call_args[0]
        date = (datetime.now(timezone.utc)+timedelta(days=30)).date().isoformat()
        self.assertEqual((job, search.adults, search.cabin, search.children), (('outbound', 'GRU', 'REC', date), 1, 'economy', 0))
        self.assertEqual(result['status'], 'error')
        [row] = self.rows()
        self.assertEqual((row['search_id'], row['route_key'], row['status'], row['kind']), ('canary', 'outbound|GRU|REC|'+date, 'error', 'timeout'))
        # A failure of the source like any other: the breaker counts it.
        with store.db() as c: self.assertEqual(source.load(c)['consecutive_failures'], 1)

    def test_not_right_after_the_collector_starts(self):
        started = []
        with patch.object(Monitor, 'run_canary', lambda monitor: started.append(1)), patch('backend.engine.fetch', side_effect=AssertionError('no query')):
            worker = threading.Thread(target=self.monitor.loop); worker.start()
            time.sleep(.8)
            self.monitor.stop(); worker.join(5)
        self.assertEqual(started, [])

    def test_never_while_the_source_is_paused(self):
        with store.db() as c: source.save(c, {**source.load(c), 'state': 'open', 'retry_at': time.time()+600, 'trip_kind': 'blocked'})
        with patch('backend.engine.fetch') as remote:
            self.assertEqual(self.monitor.run_canary()['status'], 'skipped'); remote.assert_not_called()
        self.assertEqual(self.rows(), [])
        # The scheduler does not even start it then; with the source closed it does, once.
        started = []
        with patch.object(Monitor, 'run_canary', lambda monitor: started.append(1)), patch('backend.engine.fetch', side_effect=AssertionError('no query')), \
             patch('backend.engine.CANARY_DELAY', 0):
            worker = threading.Thread(target=self.monitor.loop); worker.start()
            time.sleep(.6)
            self.assertEqual(started, [])
            with store.db() as c: source.save(c, source.initial())
            deadline = time.time()+5
            while time.time() < deadline and not started: time.sleep(.05)
            time.sleep(.5)
            self.monitor.stop(); worker.join(5)
        self.assertEqual(started, [1])

    def test_the_breaker_test_query_is_given_back_to_the_trips(self):
        with store.db() as c: source.save(c, {**source.load(c), 'state': 'open', 'retry_at': time.time()-1, 'trip_kind': 'blocked'})
        with patch('backend.engine.fetch') as remote:
            self.assertEqual(self.monitor.run_canary()['status'], 'skipped'); remote.assert_not_called()
        # Released unused: a trip can take the test query now.
        with store.db() as c: data = source.load(c)
        self.assertEqual((source.gate(), data['state'], data['probe_at']), ('probe', 'half_open', None))

    def test_three_failures_in_a_row_warn_and_the_card_reads_the_configured_route(self):
        now = time.time()
        for index, status in enumerate(['ok', 'empty', 'error', 'blocked']):
            self.put(now-4000+index*600, status, kind=None if status in ('ok', 'empty') else 'timeout', duration=1000*(index+1))
        metrics = health.collect(WORKERS, now)
        self.assertEqual((metrics['canary']['failed_streak'], 'source_canary' in metrics['status']['reasons']), (2, False))
        self.put(now-100, 'error', kind='server', duration=5000)
        metrics = health.collect(WORKERS, now)
        probe = metrics['canary']
        self.assertEqual((probe['failed_streak'], probe['last']['status'], probe['last']['kind']), (3, 'error', 'server'))
        self.assertEqual(probe['day'], {'total': 5, 'success_rate': .4, 'mean_ms': 3000})
        self.assertEqual([h['status'] for h in probe['history']], ['ok', 'empty', 'error', 'blocked', 'error'])
        self.assertEqual(metrics['status'], {'level': 'warning', 'reasons': ['source_canary']})
        self.assertEqual(health.details('source_canary', metrics), {'failed_streak': 3, 'origin': 'GRU', 'destination': 'REC', 'kind': 'server', 'last_at': now-100})
        # Off, it warns of nothing; another route starts its own history.
        canary.save(enabled=False)
        self.assertNotIn('source_canary', health.collect(WORKERS, now+1)['status']['reasons'])
        canary.save(enabled=True, origin='gig', destination='ssa')
        probe = health.collect(WORKERS, now+2)['canary']
        self.assertEqual((probe['origin'], probe['destination'], probe['history'], probe['failed_streak']), ('GIG', 'SSA', [], 0))
        for _ in range(14): self.put(now, 'ok', route='outbound|GIG|SSA|2090-01-01')
        self.assertEqual(len(health.collect(WORKERS, now+3)['canary']['history']), canary.HISTORY)

    def test_counted_with_the_source_but_kept_out_of_the_trip_lists(self):
        now = time.time()
        for _ in range(3): self.put(now-60, 'error', kind='timeout', duration=90000)
        self.put(now-50, 'ok', sid='trip', route='outbound|THE|GRU|2090-11-05', duration=1000)
        metrics = health.collect(WORKERS, now)
        self.assertEqual(metrics['queries']['hour']['total'], 4)
        self.assertEqual([r['route_key'] for r in metrics['slow_routes']], ['outbound|THE|GRU|2090-11-05'])
        self.assertEqual((metrics['failing_routes'], metrics['empty_trips']), ([], []))

    def test_invalid_routes_are_refused(self):
        from fastapi import HTTPException
        for origin, destination in (('ZZZ', 'REC'), ('GRU', 'GRU')):
            with self.subTest(origin=origin), self.assertRaises(HTTPException):
                canary.save(origin=origin, destination=destination)
        self.assertEqual(canary.settings(), {'enabled': True, 'origin': 'GRU', 'destination': 'REC'})


class PaceTests(Isolated):
    def trip(self, owner, active=True):
        search = Search(origins=['THE'], destinations=['GRU'], outbound=Leg(start='2090-11-05T00:00', end='2090-11-05T23:59'))
        with store.db() as c:
            sid = store.add_search(c, search, owner)
            if not active: c.execute('UPDATE searches SET active=0 WHERE id=?', (sid,))
        return sid

    def cycles(self, sid, *starts):
        with store.db() as c:
            for started in starts:
                c.execute("INSERT INTO cycles(search_id,version,started,finished,status,total) VALUES(?,1,?,?,'scheduled',1)", (sid, started, started+30))

    def test_without_data_every_measure_is_null(self):
        self.assertEqual(health.collect(WORKERS)['pace'], {'per_min': None, 'limit_per_min': 12.0, 'p50_ms': None, 'p95_ms': None, 'interval_s': None, 'target_s': 300})

    def test_queries_per_minute_and_response_times_of_the_last_fifteen_minutes(self):
        now = time.time()
        # 177 queries in 15 min, the canary among them, and one just outside the window.
        for index in range(177):
            self.put(now-10-index*5, 'ok', sid='trip' if index % 3 else canary.ID, duration=1000+index*10)
        self.put(now-901, 'ok', sid='trip', duration=99999)
        pace = health.collect(WORKERS, now)['pace']
        self.assertEqual({k: pace[k] for k in ('per_min', 'limit_per_min', 'p50_ms', 'p95_ms')}, {'per_min': 11.8, 'limit_per_min': 12.0, 'p50_ms': 1880, 'p95_ms': 2680})

    def test_the_median_gap_between_consecutive_cycles_of_each_active_trip(self):
        owner = accounts.register(accounts.Registration(name='Pace fixture', country='US', phone='6502530000', password='fixture-password-only'), Response())['id']
        now = time.time()
        first, second, single, paused = self.trip(owner), self.trip(owner), self.trip(owner), self.trip(owner, active=False)
        # The cycle before the last hour does not count; a trip with one cycle has no gap; a paused trip is left out.
        self.cycles(first, now-3700, now-3000, now-2700, now-2340)
        self.cycles(second, now-1800, now-1440, now-1080, now-660)
        self.cycles(single, now-100)
        self.cycles(paused, now-200, now-170, now-140)
        self.assertEqual(health.collect(WORKERS, now)['pace']['interval_s'], 360)
        self.assertEqual(health.gaps([('a', 0), ('a', 300), ('b', 10), ('a', 660)]), [300, 360])
        self.assertEqual(health.gaps([('a', 0)]), [])

    def test_no_capacity_estimate_and_no_alert_for_it(self):
        metrics = health.collect(WORKERS)
        self.assertNotIn('capacity', metrics); self.assertNotIn('capacity_high', health.LEVELS)
        self.assertFalse(hasattr(health, 'capacity'))
        # An old estimate in the metrics warns of nothing.
        self.assertEqual(health.assess({**metrics, 'capacity': {'used': 1.25}})['reasons'], [])
        # An incident of the removed code goes at the next start, with its pending notice and without a "Resolvido".
        with store.db() as c:
            iid = c.execute("INSERT INTO health_incidents(code,level,opened_at,updated_at) VALUES('capacity_high','warning',?,?)", (time.time(), time.time())).lastrowid
            c.execute("INSERT INTO outbox(id,created,alert_ids,subject,body,status,next_due,channel,kind) VALUES('held',?,'[]','s','b','pending',?,'email','health')", (time.time(), time.time()+3600))
            c.execute("INSERT INTO health_notices VALUES('held',?,'opened')", (iid,))
        store.setup(seed=False)
        with store.db() as c:
            self.assertEqual(c.execute("SELECT COUNT(*) FROM health_incidents WHERE code='capacity_high'").fetchone()[0], 0)
            self.assertEqual(c.execute("SELECT status FROM outbox WHERE id='held'").fetchone()[0], 'cancelled')
            self.assertEqual(c.execute('SELECT COUNT(*) FROM health_notices').fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()


class PaceGapTests(unittest.TestCase):
    def test_a_pause_and_resume_is_not_the_collection_pace(self):
        self.assertEqual(health.gaps([('a',0),('a',300),('a',2400),('b',100),('b',460)]),[300,360],'A gap above 30 min is a pause of the trip')

