"""Rota de controle (canary) and source capacity: interval, breaker, records, assess and the estimate; no source requests."""
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

    def test_a_trip_the_rules_no_longer_read_is_left_out_of_the_estimate(self):
        from backend import accounts
        owner = accounts.register(accounts.Registration(name='Capacity fixture', country='US', phone='6502530000', password='fixture-password-only'), Response())['id']
        with store.db() as c: store.add_search(c, Search(origins=['THE'], destinations=['GRU'], outbound=Leg(start='2090-11-05T00:00', end='2090-11-05T23:59')), owner)
        with patch.object(health, 'pending_jobs', side_effect=KeyError('XXX')):
            result = health.collect(WORKERS)['capacity']
        self.assertEqual((result['trips'], result['queries_per_cycle']), (0, 0))

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


class CapacityTests(unittest.TestCase):
    def test_load_over_throughput_bound_by_the_gate_or_the_latency(self):
        # 21 queries per 5 min; 2 at a time at 4 s would serve 150, but the gate starts one every 5 s: 60.
        result = health.capacity([7, 14], 4000)
        self.assertEqual({k: result[k] for k in ('queries_per_cycle', 'throughput_per_cycle', 'used', 'more_trips', 'limit')},
                         {'queries_per_cycle': 21, 'throughput_per_cycle': 60.0, 'used': .35, 'more_trips': 3, 'limit': 'gap'})
        # At 20 s per query, the latency binds: 2/20 × 300 = 30 per cycle.
        result = health.capacity([7, 14], 20000)
        self.assertEqual((result['throughput_per_cycle'], result['used'], result['more_trips'], result['limit']), (30.0, .7, 0, 'latency'))
        self.assertEqual(health.capacity([60], 4000)['more_trips'], 0)
        self.assertEqual(health.capacity([90], 4000)['used'], 1.5)

    def test_no_trips_and_unknown_latency(self):
        empty = health.capacity([], 4000)
        self.assertEqual((empty['used'], empty['more_trips']), (0, 60//health.TYPICAL_QUERIES))
        unknown = health.capacity([7], None)
        self.assertEqual((unknown['used'], unknown['more_trips'], unknown['throughput_per_cycle'], unknown['queries_per_cycle']), (None, None, None, 7))

    def test_warning_above_eighty_percent(self):
        base = {'generated_at': 0, 'source': None, 'workers': {}, 'queries': {'hour': {'total': 0, 'error': 0, 'blocked': 0}},
                'queue': {'max_delay_s': None}, 'freshness': {'stalest': None}}
        for used, reasons in ((.8, []), (.8001, ['capacity_high']), (None, [])):
            with self.subTest(used=used):
                self.assertEqual(health.assess({**base, 'capacity': {'used': used}})['reasons'], reasons)

    def test_collect_counts_the_queries_each_active_trip_still_makes(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(store, 'DATA_DIR', Path(folder)):
            store.setup(seed=False)
            owner = accounts.register(accounts.Registration(name='Capacity fixture', country='US', phone='6502530000', password='fixture-password-only'), Response())['id']
            search = Search(origins=['THE'], destinations=['GRU', 'CGH'], outbound=Leg(start='2090-11-05T00:00', end='2090-11-07T23:59'))
            with store.db() as c:
                store.add_search(c, search, owner)
                paused = store.add_search(c, search, owner); c.execute('UPDATE searches SET active=0 WHERE id=?', (paused,))
                c.execute("INSERT INTO source_queries(at,search_id,route_key,status,duration_ms) VALUES(?,?,?,?,?)", (time.time()-60, 'x', 'k', 'ok', 8000))
            result = health.collect(WORKERS)['capacity']
        self.assertEqual({k: result[k] for k in ('trips', 'queries_per_cycle', 'parallel', 'min_gap_s', 'interval_s', 'p50_ms')},
                         {'trips': 1, 'queries_per_cycle': 6, 'parallel': 2, 'min_gap_s': 5.0, 'interval_s': 300, 'p50_ms': 8000})
        self.assertEqual((result['throughput_per_cycle'], result['used'], result['more_trips']), (60.0, .1, 9))


if __name__ == '__main__':
    unittest.main()
