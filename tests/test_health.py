"""Source query records, health metrics, assess() thresholds and the administrator endpoint; no source requests."""
import test_isolation  # noqa: F401 - first: temporary data, no seed, idle workers
import importlib
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend import store, mail, source, health, engine, accounts
from backend.domain import Search, Leg
from backend.engine import Monitor
from backend.query_gate import QueryGate

JOB = ('outbound', 'THE', 'GRU', '2090-11-05')
WORKERS = {'collector': {'alive': True, 'age': 1.0, 'limit': 120}, 'email_sender': {'alive': True, 'age': 2.0, 'limit': 300},
           'whatsapp_sender': {'alive': True, 'age': 3.0, 'limit': 300}}


class Isolated(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); folder = Path(self.temp.name)
        self.patches = [patch.object(store, 'DATA_DIR', folder), patch.object(mail, 'DATA_DIR', folder), patch.object(mail, 'SETTINGS_FILE', folder/'smtp.json')]
        for item in self.patches: item.start()
        store.setup(seed=False)
        from fastapi import Response
        self.owner = accounts.register(accounts.Registration(name='Health fixture', country='US', phone='6502530000', password='fixture-password-only'), Response())['id']
        self.search = Search(name='Health trip', origins=['THE'], destinations=['GRU', 'CGH'], outbound=Leg(start='2090-11-05T00:00', end='2090-11-05T23:59'))
        self.sid = self.add()
        self.monitor = Monitor(); self.monitor.query_gate = QueryGate(min_gap=0)

    def tearDown(self):
        for item in reversed(self.patches): item.stop()
        self.temp.cleanup()

    def add(self, **changes):
        with store.db() as c:
            sid = store.add_search(c, self.search, self.owner)
            if changes: c.execute('UPDATE searches SET '+','.join(k+'=?' for k in changes)+' WHERE id=?', (*changes.values(), sid))
        return sid

    def row(self, sid=None):
        with store.db() as c: return dict(c.execute('SELECT * FROM searches WHERE id=?', (sid or self.sid,)).fetchone())

    def queries(self):
        with store.db() as c: return [dict(r) for r in c.execute('SELECT * FROM source_queries ORDER BY route_key')]

    def answer(self, statuses):
        def result(search, job):
            status, kind = statuses[job[2]]
            data = {'status': status, 'flights': [], 'direction': job[0], 'origin': job[1], 'destination': job[2], 'date': job[3], 'collected_at': time.time()}
            if status == 'error': data.update(error='fixture failure', kind=kind)
            return data
        return result

    def put(self, at, status='ok', kind=None, duration=1000, sid=None, key='|'.join(JOB)):
        with store.db() as c:
            c.execute('INSERT INTO source_queries(at,search_id,route_key,status,kind,duration_ms) VALUES(?,?,?,?,?,?)',
                      (at, sid or self.sid, key, status, kind, duration))


class RecordingTests(Isolated):
    def test_every_answered_query_is_recorded_with_status_kind_and_route(self):
        with patch('backend.engine.fetch', side_effect=self.answer({'GRU': ('ok', None), 'CGH': ('empty', None)})):
            self.monitor.run_cycle(self.row())
        with patch('backend.engine.fetch', side_effect=self.answer({'GRU': ('error', 'timeout'), 'CGH': ('error', 'blocked')})):
            self.monitor.run_cycle(self.row())
        rows = self.queries()
        self.assertEqual(sorted((r['route_key'], r['status'], r['kind']) for r in rows), [
            ('outbound|THE|CGH|2090-11-05', 'blocked', 'blocked'), ('outbound|THE|CGH|2090-11-05', 'empty', None),
            ('outbound|THE|GRU|2090-11-05', 'error', 'timeout'), ('outbound|THE|GRU|2090-11-05', 'ok', None)])
        # The search only: no personal identifier is kept.
        self.assertEqual({r['search_id'] for r in rows}, {self.sid}); self.assertNotIn('owner_id', rows[0])
        self.assertTrue(all(isinstance(r['duration_ms'], int) and r['duration_ms'] >= 0 for r in rows))
        # A rate limit is a block as well; any other failure kind is a plain error.
        self.assertEqual([health.query_status({'status': 'error', 'kind': kind}) for kind in ('rate_limited', 'format', 'no_results', None)],
                         ['blocked', 'error', 'error', 'error'])

    def test_duration_is_measured_around_the_real_fetch(self):
        clock = NS(time=time.time, monotonic=iter([100.0, 100.25]).__next__)
        with patch('backend.engine.fetch', side_effect=self.answer({'GRU': ('ok', None)})), patch.object(engine, 'time', clock):
            self.assertEqual(self.monitor.gated_fetch(self.search, JOB, self.row())['status'], 'ok')
        self.assertEqual([r['duration_ms'] for r in self.queries()], [250])

    def test_skipped_queries_are_not_recorded(self):
        # Source paused: nothing is queried.
        with store.db() as c: source.save(c, {**source.load(c), 'state': 'open', 'retry_at': time.time()+300, 'trip_kind': 'blocked'})
        with patch('backend.engine.fetch') as remote:
            self.monitor.run_cycle(self.row()); remote.assert_not_called()
        with store.db() as c: source.save(c, source.initial())
        # Ended by a shutdown: no answer.
        with patch('backend.engine.fetch', side_effect=engine.QueryInterrupted):
            self.monitor.run_cycle(self.row())
        self.assertEqual(self.queries(), [])
        # Paused during the first query: the second route is skipped, only the first one is recorded.
        def pause_during_first(search, job):
            with store.db() as c: c.execute("UPDATE searches SET active=0,state='paused',next_due=NULL WHERE id=?", (self.sid,))
            return self.answer({'GRU': ('ok', None), 'CGH': ('ok', None)})(search, job)
        with patch('backend.engine.fetch', side_effect=pause_during_first) as remote:
            self.monitor.run_cycle(self.row())
        self.assertEqual((remote.call_count, len(self.queries())), (1, 1))

    def test_a_failed_record_never_stops_the_collection(self):
        with patch.object(health, 'db', side_effect=RuntimeError('fixture database failure')), \
             patch('backend.engine.fetch', side_effect=self.answer({'GRU': ('ok', None), 'CGH': ('ok', None)})), \
             self.assertLogs('radar.health', 'WARNING') as captured:
            self.monitor.run_cycle(self.row())
        self.assertEqual([r.getMessage() for r in captured.records], ['Falha ao registrar consulta à fonte']*2)
        self.assertEqual(captured.records[0].search_id, self.sid)
        row = self.row(); self.assertEqual((row['state'], row['error']), ('scheduled', None))
        with store.db() as c: self.assertEqual(c.execute('SELECT COUNT(*) FROM results').fetchone()[0], 2)

    def test_seven_days_are_kept_by_the_hourly_maintenance(self):
        now = time.time()
        for days in (8, 7.01, 6.99, 0): self.put(now-days*86400)
        self.assertEqual(health.cleanup(now), 2)
        with store.db() as c: self.assertEqual(c.execute('SELECT COUNT(*) FROM source_queries').fetchone()[0], 2)
        # The collector's maintenance runs it with the other retention cleanups; no trip is due meanwhile.
        with store.db() as c: c.execute('UPDATE searches SET next_due=?', (now+3600,))
        with patch.object(health, 'cleanup') as cleanup, patch('backend.engine.fetch', side_effect=AssertionError('no source query')):
            worker = threading.Thread(target=self.monitor.loop); worker.start()
            deadline = time.time()+5
            while time.time() < deadline and not cleanup.called: time.sleep(.02)
            self.monitor.stop(); worker.join(5)
        cleanup.assert_called_once_with()

    def test_deleting_a_trip_removes_its_queries(self):
        client = TestClient(importlib.import_module('backend.app').app)
        try:
            app = importlib.import_module('backend.app')
            response = client.post('/api/auth/register', json={'name': 'Owner fixture', 'country': 'GB', 'phone': '02079460018', 'password': 'fixture-password-only'}, headers={'x-radar-token': app.TOKEN})
            owner = response.json()['id']
            with store.db() as c: sid = store.add_search(c, self.search, owner)
            self.put(time.time(), sid=sid); self.put(time.time())
            self.assertEqual(client.delete('/api/searches/'+sid, headers={'x-radar-token': app.TOKEN}).status_code, 200)
        finally: client.close()
        self.assertEqual([r['search_id'] for r in self.queries()], [self.sid])

    def test_the_breaker_keeps_when_the_pause_began(self):
        failure = {'status': 'error', 'kind': 'blocked'}
        for at, route in ((1000.0, 'THE-GRU'), (1001.0, 'THE-CGH'), (1002.0, 'THE-GRU')):
            data = source.observe(failure, source.Admission('closed', 0), now=at, rng=NS(uniform=lambda low, high: 1.0), route=route)
        self.assertEqual((data['state'], data['opened_at']), ('open', 1002.0))
        probe = source.admit(now=data['retry_at']+1)
        data = source.observe(failure, probe, now=data['retry_at']+2, rng=NS(uniform=lambda low, high: 1.0))
        self.assertEqual((data['state'], data['level'], data['opened_at']), ('open', 1, 1002.0))
        probe = source.admit(now=data['retry_at']+1)
        data = source.observe({'status': 'ok'}, probe, now=data['retry_at']+2)
        self.assertEqual((data['state'], data['opened_at']), ('closed', None))


class PercentileTests(unittest.TestCase):
    def test_nearest_rank(self):
        self.assertIsNone(health.percentile([], .5))
        self.assertEqual((health.percentile([7], .5), health.percentile([7], .95)), (7, 7))
        values = list(range(100, 0, -1))
        self.assertEqual((health.percentile(values, .5), health.percentile(values, .95), health.percentile(values, 1)), (50, 95, 100))
        self.assertEqual((health.percentile([4, 1, 3, 2], .5), health.percentile([4, 1, 3, 2], .95)), (2, 4))

    def test_summary_and_hourly_series(self):
        self.assertEqual(health.summarize({'ok': 2, 'empty': 1, 'error': 1, 'blocked': 1}, 300, 35000),
                         {'total': 5, 'ok': 2, 'empty': 1, 'error': 1, 'blocked': 1, 'success_rate': .6, 'p50_ms': 300, 'p95_ms': 35000})
        self.assertEqual(health.summarize({}), {'total': 0, 'ok': 0, 'empty': 0, 'error': 0, 'blocked': 0, 'success_rate': None, 'p50_ms': None, 'p95_ms': None})
        now = 1800000000+1800
        start = health.first_hour(now)
        self.assertEqual(start, 1800000000-23*3600)
        rows = [(now-60, 100), (now-50, 300), (now-23*3600, 50), (now-23*3600+10, 70), (start-1, 1)]
        timed = health.percentiles([r for r in rows if r[0] >= start], start, now)
        self.assertEqual((timed['hour'], timed['day']), ((100, 300), (70, 300)))
        self.assertEqual(timed['buckets'], {23: 100, 0: 50})
        buckets = health.series({(23, 'ok'): 1, (23, 'error'): 1, (0, 'blocked'): 2}, timed['buckets'], start)
        self.assertEqual([b['hour_start'] for b in buckets], [1800000000-3600*(23-i) for i in range(24)])
        self.assertEqual(buckets[-1], {'hour_start': 1800000000, 'ok': 1, 'empty': 0, 'error': 1, 'blocked': 0, 'p50_ms': 100})
        self.assertEqual((buckets[0]['blocked'], buckets[0]['p50_ms']), (2, 50))
        self.assertTrue(all(b['p50_ms'] is None and not b['ok'] for b in buckets[1:-1]))


class AssessTests(unittest.TestCase):
    def metrics(self, **changes):
        now = 1800000000
        base = {'generated_at': now, 'source': {'status': 'ok', 'paused_since': None},
                'workers': health.workers(WORKERS),
                'queries': {'hour': {'total': 20, 'ok': 20, 'empty': 0, 'error': 0, 'blocked': 0}},
                'queue': {'due': 0, 'max_delay_s': None},
                'freshness': {'active': 1, 'fresh': 1, 'stalest': {'id': 'trip', 'age_s': 120}}}
        return base | changes

    def test_healthy(self):
        self.assertEqual(health.assess(self.metrics()), {'level': 'ok', 'reasons': []})

    def test_each_threshold(self):
        now = 1800000000
        hour = lambda total, error, blocked=0: {'queries': {'hour': {'total': total, 'ok': total-error-blocked, 'empty': 0, 'error': error, 'blocked': blocked}}}
        late = {**WORKERS, 'collector': {'alive': True, 'age': 121.0, 'limit': 120}}
        cases = [
            ({'source': {'status': 'paused', 'paused_since': now-901}}, 'critical', ['source_paused']),
            ({'source': {'status': 'paused', 'paused_since': now-900}}, 'ok', []),
            ({'source': {'status': 'degraded', 'paused_since': None}}, 'ok', []),
            ({'source': None}, 'ok', []),
            ({'workers': health.workers(late)}, 'critical', ['collector_late']),
            ({'workers': health.workers({**WORKERS, 'collector': {'alive': False, 'age': 1.0, 'limit': 120}})}, 'critical', ['collector_late']),
            ({'workers': health.workers({**WORKERS, 'collector': {'alive': True, 'age': None, 'limit': 120}})}, 'critical', ['collector_late']),
            ({'workers': health.workers({**WORKERS, 'email_sender': {'alive': False, 'age': None, 'limit': 300}})}, 'critical', ['email_late']),
            ({'workers': health.workers({**WORKERS, 'whatsapp_sender': {'alive': True, 'age': 301.0, 'limit': 300}})}, 'critical', ['whatsapp_late']),
            ({'workers': health.workers({**WORKERS, 'whatsapp_sender': {'alive': True, 'age': 300.0, 'limit': 300}})}, 'ok', []),
            ({'channels': {'whatsapp': {'available': True, 'failed_streak': 3, 'last_failure_at': now}, 'email': {'available': True, 'failed_streak': 2, 'last_failure_at': now}}}, 'warning', ['whatsapp_failing']),
            ({'channels': {'whatsapp': {'available': False, 'failed_streak': 5, 'last_failure_at': now}, 'email': {'available': True, 'failed_streak': 3, 'last_failure_at': now}}}, 'warning', ['email_failing']),
            (hour(10, 3, 1), 'warning', ['error_rate']),
            (hour(10, 3), 'ok', []),
            (hour(9, 9), 'ok', []),
            (hour(10, 0, 4), 'warning', ['error_rate']),
            ({'queue': {'due': 3, 'max_delay_s': 901}}, 'warning', ['queue_delay']),
            ({'queue': {'due': 3, 'max_delay_s': 900}}, 'ok', []),
            ({'freshness': {'active': 1, 'fresh': 0, 'stalest': {'id': 'trip', 'age_s': 3601}}}, 'warning', ['stale_trip']),
            ({'freshness': {'active': 1, 'fresh': 0, 'stalest': {'id': 'trip', 'age_s': 3600}}}, 'ok', []),
            ({'freshness': {'active': 0, 'fresh': 0, 'stalest': None}}, 'ok', []),
        ]
        for changes, level, reasons in cases:
            with self.subTest(changes=changes):
                self.assertEqual(health.assess(self.metrics(**changes)), {'level': level, 'reasons': reasons})

    def test_critical_reasons_come_first(self):
        metrics = self.metrics(queue={'due': 1, 'max_delay_s': 4000}, source={'status': 'paused', 'paused_since': 1800000000-3600})
        self.assertEqual(health.assess(metrics), {'level': 'critical', 'reasons': ['source_paused', 'queue_delay']})


class MetricsTests(Isolated):
    def test_trips_queue_freshness_cycles_and_empty_trips(self):
        now = time.time()
        paused = self.add(active=0, state='paused', next_due=None)
        self.add(active=0, archived=1, state='ended', next_due=None)
        late = self.add(next_due=now-1000, created=now-7200)
        running = self.add(next_due=now-5000, state='collecting')
        self.add(next_due=now+300)
        with store.db() as c: c.execute('UPDATE searches SET next_due=0 WHERE id=?', (self.sid,))
        # The first trip answered a minute ago; the late one never did.
        self.put(now-60); self.put(now-30, 'error', 'timeout', 30000)
        with store.db() as c:
            for sid, started, finished in ((self.sid, now-600, now-480), (late, now-500, now-440), (late, now-90000, now-89000), (running, now-30, None)):
                c.execute("INSERT INTO cycles(search_id,version,started,finished,status,total) VALUES(?,1,?,?,'scheduled',2)", (sid, started, finished))
            cycle, other = (c.execute('SELECT id FROM cycles WHERE search_id=? ORDER BY id', (sid,)).fetchone()[0] for sid in (self.sid, late))
            # Answered, but no complete snapshot with a price: an empty trip. The one with a price is not.
            c.execute("INSERT INTO results(cycle_id,search_id,version,direction,route_key,collected,status,data) VALUES(?,?,1,'outbound','k',?,'empty','{}')", (cycle, self.sid, now-60))
            c.execute("INSERT INTO snapshots(search_id,version,cycle_id,direction,collected,complete,price,count) VALUES(?,1,?,'outbound',?,1,NULL,0)", (self.sid, cycle, now-60))
            c.execute("INSERT INTO results(cycle_id,search_id,version,direction,route_key,collected,status,data) VALUES(?,?,1,'outbound','k',?,'ok','{}')", (other, late, now-60))
            c.execute("INSERT INTO snapshots(search_id,version,cycle_id,direction,collected,complete,price,count) VALUES(?,1,?,'outbound',?,1,90000,1)", (late, other, now-60))
        metrics = health.collect(WORKERS, now)
        self.assertEqual(metrics['trips'], {'active': 4, 'paused': 1, 'ended': 1, 'accounts': 1})
        self.assertEqual(metrics['queue'], {'due': 2, 'max_delay_s': 1000.0})
        self.assertEqual(metrics['cycles'], {'count': 2, 'avg_s': 90.0})
        self.assertEqual((metrics['freshness']['active'], metrics['freshness']['fresh']), (4, 1))
        self.assertEqual({k: metrics['freshness']['stalest'][k] for k in ('id', 'title', 'route', 'owner_id', 'age_s', 'last_at')},
                         {'id': late, 'title': 'Health trip', 'route': 'THE → GRU/CGH', 'owner_id': self.owner, 'age_s': 7200, 'last_at': None})
        self.assertEqual([(t['id'], t['cycles']) for t in metrics['empty_trips']], [(self.sid, 1)])
        self.assertEqual(metrics['queries']['hour'], {'total': 2, 'ok': 1, 'empty': 0, 'error': 1, 'blocked': 0, 'success_rate': .5, 'p50_ms': 1000, 'p95_ms': 30000})
        self.assertEqual([(r['origin'], r['destination'], r['failures'], r['kind'], r['trip']['id']) for r in metrics['failing_routes']], [('THE', 'GRU', 1, 'timeout', self.sid)])
        self.assertEqual(metrics['workers']['collector'], {'alive': True, 'age_s': 1.0, 'limit_s': 120, 'late': False})
        self.assertEqual(metrics['status'], {'level': 'warning', 'reasons': ['queue_delay', 'stale_trip']})
        self.assertNotIn(paused, [t['id'] for t in metrics['empty_trips']])

    def test_routes_rank_slow_and_failing_ones_and_keep_deleted_trips_unlinked(self):
        now = time.time()
        for index in range(7):
            key = 'outbound|THE|GRU|2090-11-0%d' % (index+1)
            for ms in (1000*(index+1), 1000*(index+1)+500): self.put(now-100, duration=ms, key=key)
            for _ in range(index % 3): self.put(now-90, *(('blocked', 'blocked') if index == 2 else ('error', 'timeout')), 1000*(index+1), key=key)
        self.put(now-80, 'error', 'server', 50000, sid='deleted-trip', key='inbound|GRU|THE|2090-11-09')
        metrics = health.collect(WORKERS, now)
        self.assertEqual([r['date'] for r in metrics['slow_routes']], ['2090-11-09', '2090-11-07', '2090-11-06', '2090-11-05', '2090-11-04'])
        self.assertIsNone(metrics['slow_routes'][0]['trip']); self.assertEqual(metrics['slow_routes'][1]['trip']['id'], self.sid)
        failing = metrics['failing_routes']
        self.assertEqual(len(failing), 5); self.assertEqual([(r['date'], r['failures']) for r in failing[:2]], [('2090-11-03', 2), ('2090-11-06', 2)])
        self.assertEqual((failing[0]['blocked'], failing[0]['kind']), (2, 'blocked'))

    def test_a_long_pause_is_critical(self):
        now = time.time()
        with store.db() as c: source.save(c, {**source.load(c), 'state': 'open', 'retry_at': now+300, 'trip_kind': 'blocked', 'opened_at': now-1200})
        metrics = health.collect(WORKERS, now)
        self.assertEqual((metrics['source']['status'], metrics['source']['paused_since']), ('paused', now-1200))
        self.assertEqual(metrics['status']['reasons'][:1], ['source_paused'])
        # A pause saved before opened_at existed counts from its last failure.
        with store.db() as c: source.save(c, {**source.load(c), 'opened_at': None, 'last_failure_at': now-100})
        self.assertEqual(health.collect(WORKERS, now)['source']['paused_since'], now-100)


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); folder = Path(self.temp.name)
        self.patches = [patch.object(store, 'DATA_DIR', folder), patch.object(mail, 'DATA_DIR', folder), patch.object(mail, 'SETTINGS_FILE', folder/'smtp.json')]
        for item in self.patches: item.start()
        store.setup(seed=False); self.app = importlib.import_module('backend.app')
        self.admin, self.user, self.anon = TestClient(self.app.app), TestClient(self.app.app), TestClient(self.app.app)
        headers = {'x-radar-token': self.app.TOKEN}
        data = {'name': 'Admin fixture', 'country': 'US', 'phone': '6502530000', 'password': 'fixture-password-only'}
        self.admin.post('/api/auth/bootstrap', json=data, headers=headers)
        self.user.post('/api/auth/register', json=data | {'name': 'Customer fixture', 'country': 'GB', 'phone': '02079460018'}, headers=headers)

    def tearDown(self):
        for client in (self.admin, self.user, self.anon): client.close()
        for item in reversed(self.patches): item.stop()
        self.temp.cleanup()

    def test_only_the_administrator_reads_the_health(self):
        self.assertEqual(self.user.get('/api/admin/health').status_code, 403)
        self.assertEqual(self.anon.get('/api/admin/health').status_code, 401)
        with patch.object(self.app, 'monitor', test_isolation.IdleMonitor(healthy=True)):
            response = self.admin.get('/api/admin/health')
        self.assertEqual(response.status_code, 200); self.assertEqual(response.headers['cache-control'], 'no-store')
        body = response.json()
        self.assertEqual(set(body), {'generated_at', 'trips', 'queries', 'series', 'cycles', 'freshness', 'queue', 'source', 'workers', 'channels', 'canary', 'capacity',
                                     'slow_routes', 'failing_routes', 'empty_trips', 'status', 'incidents', 'settings'})
        self.assertEqual((body['incidents'], body['settings']['notices']), ([], True))
        self.assertEqual(set(body['queries']), {'hour', 'day'}); self.assertEqual(len(body['series']), 24)
        self.assertEqual(set(body['series'][0]), {'hour_start', 'ok', 'empty', 'error', 'blocked', 'p50_ms'})
        self.assertEqual(set(body['workers']), {'collector', 'email_sender', 'whatsapp_sender', 'health_watcher'})
        self.assertEqual(body['status'], {'level': 'ok', 'reasons': []})
        # The idle monitor of the suite reports no heartbeat: the collector is late.
        self.assertEqual(self.admin.get('/api/admin/health').json()['status'], {'level': 'critical', 'reasons': ['collector_late', 'whatsapp_late', 'email_late']})


if __name__ == '__main__':
    unittest.main()
