"""Source failure classification, breaker, backoff, health and logs; no source requests."""
import test_isolation  # noqa: F401 - first: temporary data, no seed, idle workers
import importlib
import io
import json
import logging
import os
import signal
import smtplib
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch, MagicMock, call
import primp
from fastapi.testclient import TestClient
from backend import store, mail, source, collector, logs, engine
from backend.domain import Search, Leg
from backend.engine import Monitor, fetch, next_collection_due
from backend.query_gate import QueryGate

ROOT = Path(__file__).resolve().parents[1]
FIXED = NS(uniform=lambda low, high: 1.0)
LOW = NS(uniform=lambda low, high: low)
HIGH = NS(uniform=lambda low, high: high)
# The source's error answer for one query: a results page whose flights block is an error status.
ERROR_PAGE = ('<html><body><script class="ds:1" nonce="fixture">AF_initDataCallback({key: \'ds:1\', hash: \'2\', '
              'data:[null,null], errorHasStatus: true, sideChannel: {}});</script></body></html>')
OPTIONS = {'origin': 'LHR', 'destination': 'JFK', 'date': '2090-11-05', 'cabin': 'economy', 'adults': 1}
AIRLINES = [None, [[], [['BA', 'British Airways']]]]


def segment(departure, arrival, origin='LHR', destination='JFK'):
    """One segment at the positions fast-flights' parse_js reads; times are [hour, minute]."""
    value = [None]*22
    value[3], value[4], value[5], value[6] = origin, origin+' fixture', destination+' fixture', destination
    value[8], value[10], value[11], value[17] = departure, arrival, 480, 'A320'
    value[20] = value[21] = [2090, 11, 5]
    return value


def itinerary(price, departure=(10, 0), arrival=(13, 0)):
    flight = [None]*23
    flight[0], flight[1], flight[2], flight[22] = 'BA', ['British Airways'], [segment(list(departure), list(arrival))], [None]*9
    return [flight, [[None, price]]]


def script(best=(), other=(), block7=AIRLINES):
    """The embedded flights script: groups 2 and 3 and block 7 (alliances, airlines)."""
    data = [None]*8
    data[2], data[3], data[7] = [list(best)], [list(other)], block7
    return "AF_initDataCallback({key: 'ds:1', hash: '2', data:"+json.dumps(data)+", sideChannel: {}});"


def collect_script(text):
    element = NS(text=lambda: text)
    with patch.object(collector, 'fetch_flights_html', return_value='html'), \
         patch.object(collector, 'LexborHTMLParser', return_value=NS(css_first=lambda selector: element)):
        return collector.collect(OPTIONS)


def stand_in(seconds, answer=None):
    """Command of a collector stand-in: reads the query, sleeps, then prints `answer` if any. No source requests."""
    code = 'import sys,time;sys.stdin.read();time.sleep(%s)' % seconds
    return (sys.executable, '-c', code if answer is None else code+';print(%r)' % json.dumps(answer))


def running_child(other_than=None):
    """The first collector subprocess in flight other than `other_than`, waiting up to five seconds."""
    deadline = time.time()+5
    while time.time() < deadline:
        with engine.CHILDREN_LOCK: found = [process for process in engine.CHILDREN if process is not other_than]
        if found: return found[0]
        time.sleep(.02)
    raise AssertionError('No collector subprocess started')


class Isolated(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.folder = Path(self.temp.name)
        self.patches = [patch.object(store, 'DATA_DIR', self.folder), patch.object(mail, 'DATA_DIR', self.folder), patch.object(mail, 'SETTINGS_FILE', self.folder/'smtp.json')]
        for item in self.patches: item.start()
        store.setup(seed=False)

    def tearDown(self):
        for item in reversed(self.patches): item.stop()
        self.temp.cleanup()

    def state(self):
        with store.db() as c: return source.load(c)

    def put(self, **changes):
        with store.db() as c: source.save(c, {**source.load(c), **changes})


class ClassificationTests(Isolated):
    def response(self, status, url='https://www.google.com/travel/flights?hl=pt', text='<html></html>'):
        return NS(status_code=status, url=url, text=text)

    def query(self):
        return collector.create_query(flights=[collector.FlightQuery(date='2090-11-05', from_airport='LHR', to_airport='JFK')], seat='economy', trip='one-way', passengers=collector.Passengers(adults=1), language='en-US', currency='USD')

    def test_http_status_and_redirect_pages(self):
        for status, kind in [(429, 'rate_limited'), (403, 'blocked'), (500, 'server'), (503, 'server'), (404, 'unknown')]:
            with self.subTest(status=status), patch.object(collector.primp, 'Client') as client:
                client.return_value.get.return_value = self.response(status)
                with self.assertRaises(collector.SourceError) as caught: collector.CheckedFetch().fetch_html(self.query())
                self.assertEqual(caught.exception.kind, kind)
        for url in ('https://consent.google.com/ml?continue=x', 'https://www.google.com/sorry/index?continue=x'):
            with self.subTest(url=url), patch.object(collector.primp, 'Client') as client:
                client.return_value.get.return_value = self.response(200, url)
                with self.assertRaises(collector.SourceError) as caught: collector.CheckedFetch().fetch_html(self.query())
                self.assertEqual(caught.exception.kind, 'blocked')
        with patch.object(collector.primp, 'Client') as client:
            client.return_value.get.return_value = self.response(200, text='<html>results</html>')
            self.assertEqual(collector.CheckedFetch().fetch_html(self.query()), '<html>results</html>')
            self.assertEqual(client.return_value.get.call_args.kwargs['params'], self.query().params())

    def test_page_markers_query_errors_and_format_errors(self):
        options = {'origin': 'LHR', 'destination': 'JFK', 'date': '2090-11-05', 'cabin': 'economy', 'adults': 1}
        for html, kind in [('<p>Our systems have detected unusual traffic from your computer network</p>', 'blocked'),
                           ('<div class="g-recaptcha"></div>', 'blocked'), ('<form action="https://consent.google.com/save">', 'blocked'),
                           # Without a flights block or with the source's error status, only this query failed.
                           ('<html><body>changed layout</body></html>', 'no_results'), (ERROR_PAGE, 'no_results'),
                           (ERROR_PAGE.replace(', sideChannel: {}', ''), 'no_results')]:
            with self.subTest(html=html), patch.object(collector, 'fetch_flights_html', return_value=html):
                with self.assertRaises(collector.SourceError) as caught: collector.collect(options)
                self.assertEqual(caught.exception.kind, kind); self.assertEqual(str(caught.exception), collector.MESSAGES[kind])
        # Structural failures stay "format": no data marker, broken JSON, missing groups.
        for text in ('no data marker', 'data:{broken json,', 'data:[null,null],'):
            script = NS(text=lambda value=text: value)
            with self.subTest(text=text), patch.object(collector, 'fetch_flights_html', return_value='html'), \
                 patch.object(collector, 'LexborHTMLParser', return_value=NS(css_first=lambda selector: script)):
                with self.assertRaises(collector.SourceError) as caught: collector.collect(options)
                self.assertEqual(caught.exception.kind, 'format')

    def test_exceptions_map_to_kinds_with_fixed_messages(self):
        # "format" is source-wide: only the explicit top-level checks raise it, never a stray error.
        cases = [(primp.TimeoutError('private-detail'), 'timeout'), (primp.ConnectError('private-detail'), 'network'),
                 (OSError('private-detail'), 'network'), (KeyError('private-detail'), 'unknown'), (IndexError('private-detail'), 'unknown'),
                 (TypeError('private-detail'), 'unknown'), (json.JSONDecodeError('private-detail', 'doc', 0), 'unknown'),
                 (RuntimeError('private-detail'), 'unknown'), (collector.SourceError('rate_limited'), 'rate_limited'),
                 (collector.SourceError('format'), 'format')]
        for exc, kind in cases:
            with self.subTest(exc=type(exc).__name__, kind=kind):
                found, message = collector.classify(exc)
                self.assertEqual(found, kind); self.assertNotIn('private-detail', message); self.assertEqual(message, collector.MESSAGES[kind])

    def test_malformed_itinerary_among_valid_ones_is_skipped(self):
        no_price = itinerary(400); no_price[1] = None               # k[1] = None
        no_extras = itinerary(450, (16, 0), (19, 0)); no_extras[0][22] = [None]*7   # flight[22][7] absent
        result = collect_script(script(best=[itinerary(520), no_price, itinerary(480, (18, 0), (21, 30))], other=[no_extras]))
        self.assertEqual(result['status'], 'ok'); self.assertEqual(result['skipped'], {'malformed_itinerary': 2})
        self.assertEqual([f['price_cents'] for f in result['flights']], [48000, 52000])
        self.assertEqual(result['flights'][0]['airline_codes'], ['BA']); self.assertEqual(result['provider_groups'], {'2': 3, '3': 1})

    def test_only_malformed_itineraries_are_no_results(self):
        no_price = itinerary(400); no_price[1] = None
        for best, other in [([no_price], []), ([None, 7], [{'x': 1}]), ([[None]], [])]:
            with self.subTest(best=best, other=other), self.assertRaises(collector.SourceError) as caught:
                collect_script(script(best=best, other=other))
            self.assertEqual(caught.exception.kind, 'no_results')
            self.assertEqual(str(caught.exception), 'As ofertas retornadas não puderam ser validadas; nova tentativa será feita')

    def test_format_is_reserved_for_the_top_level_structure(self):
        good = [itinerary(520)]
        for label, text in [('block 7 missing', script(best=good, block7=None)), ('airlines malformed', script(best=good, block7=[None, [[], [['BA']]]])),
                            ('alliances malformed', script(best=good, block7=[None, [5, []]])), ('group not a list', 'data:[null, null, {"x": 1}, [[]]],'),
                            ('items not a list', 'data:[null, null, [7], [[]]],'), ('data not a list', 'data:{"a": 1, "b": 2, "c": 3, "d": 4},')]:
            with self.subTest(label=label), self.assertRaises(collector.SourceError) as caught:
                collect_script(text)
            self.assertEqual(caught.exception.kind, 'format')
        # Without itineraries block 7 is not read: an empty answer stays "empty".
        self.assertEqual(collect_script(script(block7=None))['status'], 'empty')

    def test_engine_keeps_the_subprocess_kind_and_safe_message(self):
        search = Search(origins=['LHR'], destinations=['JFK'], outbound=Leg(start='2090-11-05T00:00', end='2090-11-05T23:59'))
        job = ('outbound', 'LHR', 'JFK', '2090-11-05')
        for stdout, kind in [(json.dumps({'status': 'error', 'error': collector.MESSAGES['blocked'], 'kind': 'blocked', 'flights': []}), 'blocked'),
                             (json.dumps({'status': 'error', 'error': collector.MESSAGES['no_results'], 'kind': 'no_results', 'flights': []}), 'no_results'),
                             (json.dumps({'status': 'error', 'error': 'old adapter', 'flights': []}), 'unknown'),
                             (json.dumps({'status': 'error', 'error': 'x', 'kind': 'invented', 'flights': []}), 'unknown'),
                             ('not json', 'unknown')]:
            with self.subTest(stdout=stdout), patch('backend.engine.subprocess.Popen') as popen:
                popen.return_value.returncode = 1; popen.return_value.communicate.return_value = (stdout, '')
                result = fetch(search, job)
                self.assertEqual((result['status'], result['kind']), ('error', kind))
        with patch('backend.engine.subprocess.Popen') as popen:
            # Past 35 s the subprocess is killed, then a second communicate() drains its pipes and reaps it.
            popen.return_value.returncode = -signal.SIGKILL
            popen.return_value.communicate.side_effect = [subprocess.TimeoutExpired('collector', 35), ('', '')]
            self.assertEqual(fetch(search, job)['kind'], 'timeout'); popen.return_value.kill.assert_called_once()
            self.assertEqual(popen.return_value.communicate.call_args_list[1], call())
        with patch('backend.engine.subprocess.Popen') as popen:
            popen.return_value.returncode = 0; popen.return_value.communicate.return_value = (json.dumps({'status': 'empty', 'flights': []}), '')
            self.assertNotIn('kind', fetch(search, job))
        self.assertEqual(engine.CHILDREN, {})

    def test_engine_skips_queries_ended_by_a_shutdown(self):
        search = Search(origins=['LHR'], destinations=['JFK'], outbound=Leg(start='2090-11-05T00:00', end='2090-11-05T23:59'))
        job = ('outbound', 'LHR', 'JFK', '2090-11-05')
        # The signals a shutdown sends to the whole process group: the subprocess never answered.
        for returncode in (-signal.SIGTERM, -signal.SIGINT, -signal.SIGHUP):
            with self.subTest(returncode=returncode), patch('backend.engine.subprocess.Popen') as popen:
                popen.return_value.returncode = returncode; popen.return_value.communicate.return_value = ('', '')
                with self.assertRaises(engine.QueryInterrupted): fetch(search, job)
        # Any other end (a crash, an external SIGKILL, an unreadable answer) is still a failed query.
        for stdout, returncode in (('', -signal.SIGSEGV), ('', -signal.SIGKILL), ('not json', 1)):
            with self.subTest(returncode=returncode), patch('backend.engine.subprocess.Popen') as popen:
                popen.return_value.returncode = returncode; popen.return_value.communicate.return_value = (stdout, '')
                result = fetch(search, job)
                self.assertEqual((result['status'], result['kind']), ('error', 'unknown'))
        # Ended by Monitor.stop (end_children) while running: skipped, whatever its exit status.
        ended = []
        def stopped(*args, **kwargs):
            ended.append(engine.end_children()); return '', ''
        with patch('backend.engine.subprocess.Popen') as popen:
            process = popen.return_value; process.poll.return_value = None; process.returncode = -signal.SIGKILL
            process.communicate.side_effect = stopped
            with self.assertRaises(engine.QueryInterrupted): fetch(search, job)
        self.assertEqual(ended, [1]); process.kill.assert_called_once(); self.assertEqual(engine.CHILDREN, {})

    def test_collector_subprocess_ended_by_sigterm_is_interrupted(self):
        search = Search(origins=['LHR'], destinations=['JFK'], outbound=Leg(start='2090-11-05T00:00', end='2090-11-05T23:59'))
        outcome = []
        def query():
            try: outcome.append(fetch(search, ('outbound', 'LHR', 'JFK', '2090-11-05')))
            except engine.QueryInterrupted as exc: outcome.append(exc)
        # A real subprocess (a stand-in, not the collector), as a supervisor's SIGTERM finds it.
        with patch.object(engine, 'COLLECTOR', stand_in(30)):
            thread = threading.Thread(target=query); thread.start()
            try:
                os.kill(running_child().pid, signal.SIGTERM); thread.join(5)
            finally:
                engine.end_children(); thread.join(5)
        self.assertEqual(len(outcome), 1); self.assertIsInstance(outcome[0], engine.QueryInterrupted)
        self.assertEqual(outcome[0].args, (-signal.SIGTERM,)); self.assertEqual(engine.CHILDREN, {})


class BreakerTests(Isolated):
    def fail(self, kind, admission=None, now=1000.0, rng=FIXED, route='THE-GRU'):
        admission = admission or source.Admission('closed', self.state()['generation'])
        return source.observe({'status': 'error', 'kind': kind}, admission, now, rng, route=route)

    def trip(self, kind='blocked', rng=FIXED):
        for route in ('THE-GRU', 'THE-CGH', 'THE-GRU'): data = self.fail(kind, rng=rng, route=route)
        return data

    def test_closed_open_half_open_and_closed_again(self):
        self.fail('network'); self.fail('blocked'); self.fail('format', route='THE-CGH')
        self.assertEqual(self.state()['state'], 'closed')
        self.assertEqual(source.describe(self.state(), 1000)['status'], 'degraded')
        data = self.fail('rate_limited')
        self.assertEqual((data['state'], data['retry_at'], data['trip_kind']), ('open', 1300.0, 'rate_limited'))
        self.assertEqual(source.gate(1100), 'paused'); self.assertIsNone(source.admit(1100))
        self.assertEqual(source.describe(self.state(), 1100), {'status': 'paused', 'kind': 'rate_limited', 'consecutive_failures': 4,
                         'last_success_at': None, 'last_failure_at': 1000.0, 'retry_at': 1300.0})
        self.assertEqual(source.gate(1301), 'probe'); probe = source.admit(1301); self.assertEqual(probe.kind, 'probe')
        # Only one test query while half-open.
        self.assertIsNone(source.admit(1302)); self.assertEqual(source.gate(1302), 'testing')
        data = source.observe({'status': 'ok'}, probe, 1310, FIXED)
        self.assertEqual((data['state'], data['streak'], data['streak_routes'], data['level'], data['consecutive_failures']), ('closed', 0, [], 0, 0))
        self.assertEqual(source.describe(data, 1310)['status'], 'ok'); self.assertEqual(source.admit(1311).kind, 'closed')

    def test_one_route_alone_never_opens_the_breaker(self):
        for _ in range(10): data = self.fail('blocked')
        self.assertEqual((data['state'], data['streak'], data['streak_routes']), ('closed', 10, ['THE-GRU']))
        data = self.fail('format', route='THE-CGH')
        self.assertEqual((data['state'], data['trip_kind'], data['retry_at']), ('open', 'format', 1300.0))
        # The reverse direction is another route.
        self.put(**source.initial())
        for route in ('THE-GRU', 'GRU-THE', 'THE-GRU'): data = self.fail('blocked', route=route)
        self.assertEqual(data['state'], 'open')
        # Query errors (no_results) of many routes stay with each search: no streak, no pause.
        self.put(**source.initial())
        for index in range(6): data = self.fail('no_results', route='THE-%d' % index)
        self.assertEqual((data['state'], data['streak'], data['consecutive_failures']), ('closed', 0, 6))
        self.assertEqual(source.describe(data, 1000)['status'], 'degraded'); self.assertEqual(source.describe(data, 1000)['kind'], 'no_results')

    def test_probe_answered_with_no_results_closes_the_breaker(self):
        self.trip()
        probe = source.admit(1301); self.assertEqual(probe.kind, 'probe')
        # The source responded; only this query had nothing usable: no step up.
        data = self.fail('no_results', probe, 1310)
        self.assertEqual((data['state'], data['level'], data['retry_at'], data['probe_at'], data['trip_kind'], data['streak'], data['streak_routes']),
                         ('closed', 0, None, None, None, 0, []))
        self.assertEqual((data['consecutive_failures'], data['last_failure_at'], data['last_success_at']), (4, 1310, None))
        self.assertEqual(source.describe(data, 1310), {'status': 'degraded', 'kind': 'no_results', 'consecutive_failures': 4,
                         'last_success_at': None, 'last_failure_at': 1310, 'retry_at': None})
        self.assertEqual(source.admit(1311).kind, 'closed')
        # A late no_results of a stale admission does not close a breaker that is not closed.
        early = source.admit(1312); self.trip(); self.assertEqual(self.fail('no_results', early, 1320)['state'], 'open')

    def test_failed_probe_reopens_on_the_next_step_up_to_one_hour(self):
        self.trip()
        now, waits = 1000.0, []
        for _ in range(6):
            now = self.state()['retry_at']+1
            probe = source.admit(now); self.assertEqual(probe.kind, 'probe')
            data = self.fail('timeout', probe, now)
            waits.append(data['retry_at']-now)
        self.assertEqual(waits, [600, 1200, 2400, 3600, 3600, 3600])
        self.assertEqual(self.state()['trip_kind'], 'timeout')

    def test_jitter_route_failures_lease_and_release(self):
        with store.db() as c: source.save(c, source.initial())
        data = self.trip('format', LOW)
        self.assertEqual(data['retry_at'], 1000+240)
        self.put(**source.initial())
        data = self.trip('blocked', HIGH)
        self.assertEqual(data['retry_at'], 1000+360)
        self.put(**source.initial())
        for index in range(10):
            for kind in ('network', 'server', 'unknown', 'no_results', 'timeout'): self.fail(kind, route='THE-%d' % index)
        self.assertEqual(self.state()['state'], 'closed')
        self.put(state='open', retry_at=900.0)
        self.assertEqual(source.admit(1000).kind, 'probe'); self.assertIsNone(source.admit(1000+source.PROBE_LEASE-1))
        # An abandoned probe (e.g. restart mid-query) expires; a released one is free at once.
        probe = source.admit(1000+source.PROBE_LEASE); self.assertEqual(probe.kind, 'probe')
        source.release(probe); self.assertEqual(source.gate(1000+source.PROBE_LEASE+1), 'probe')
        self.assertEqual(source.describe(self.state(), 1000+source.DEGRADED_SECONDS+10**6)['status'], 'paused')
        self.put(**(source.initial() | {'consecutive_failures': 2, 'last_failure_at': 1000.0, 'kind': 'network'}))
        self.assertEqual(source.describe(self.state(), 1000+source.DEGRADED_SECONDS+1)['status'], 'ok')

    def test_only_the_current_probe_changes_a_breaker_that_is_not_closed(self):
        early = source.admit(900); self.assertEqual(early, ('closed', 0))
        data = self.trip()
        self.assertEqual((data['state'], data['retry_at']), ('open', 1300.0))
        # A query admitted before the trip succeeds late: the pause stays.
        data = source.observe({'status': 'ok'}, early, 1010, FIXED)
        self.assertEqual((data['state'], data['retry_at'], data['last_success_at']), ('open', 1300.0, None))
        probe = source.admit(1301)
        self.assertEqual(source.observe({'status': 'ok'}, early, 1302, FIXED)['state'], 'half_open')
        # The probe's lease expires (e.g. restart mid-query) and a second probe starts.
        second = source.admit(1301+source.PROBE_LEASE)
        self.assertEqual(second.kind, 'probe'); self.assertGreater(second.generation, probe.generation)
        # The stale probe neither frees the new slot, nor reopens, nor closes the breaker.
        source.release(probe); self.assertEqual(source.gate(1302+source.PROBE_LEASE), 'testing')
        data = self.fail('blocked', probe, 1303+source.PROBE_LEASE)
        self.assertEqual((data['state'], data['level'], data['retry_at']), ('half_open', 0, 1300.0))
        self.assertEqual(source.observe({'status': 'ok'}, probe, 1304+source.PROBE_LEASE, FIXED)['state'], 'half_open')
        data = source.observe({'status': 'ok'}, second, 1305+source.PROBE_LEASE, FIXED)
        self.assertEqual((data['state'], data['last_success_at']), ('closed', 1305+source.PROBE_LEASE))
        # Closed again: results of any admission count as usual.
        self.fail('blocked')
        self.assertEqual(source.observe({'status': 'ok'}, early, 2000, FIXED)['streak'], 0)

    def test_backoff_multiplies_the_cadence_after_route_failures(self):
        steps = [next_collection_due(1000, 1001, 300, failures, FIXED)-1000 for failures in range(7)]
        self.assertEqual(steps, [300, 300, 600, 1200, 2400, 3600, 3600])
        self.assertEqual(next_collection_due(1000, 1001, 300, 1, LOW)-1000, 300)
        self.assertEqual(next_collection_due(1000, 1001, 300, 3, LOW)-1000, 960)
        self.assertEqual(next_collection_due(1000, 1001, 300, 3, HIGH)-1000, 1440)
        self.assertEqual(next_collection_due(1000, 1700, 300, 2, FIXED)-1000, 1200)


class CycleFixture(Isolated):
    """One account with a two-route search, and a monitor whose gate does not space queries."""

    def setUp(self):
        super().setUp()
        from backend import accounts
        from fastapi import Response
        self.owner = accounts.register(accounts.Registration(name='Cycle fixture', country='US', phone='6502530000', password='fixture-password-only'), Response())['id']
        self.search = Search(origins=['THE'], destinations=['GRU', 'CGH'], outbound=Leg(start='2090-11-05T00:00', end='2090-11-05T23:59'))
        with store.db() as c: self.sid = store.add_search(c, self.search, self.owner)
        self.monitor = Monitor(); self.monitor.query_gate = QueryGate(min_gap=0)

    def row(self, sid=None):
        with store.db() as c: return dict(c.execute('SELECT * FROM searches WHERE id=?', (sid or self.sid,)).fetchone())

    def answer(self, status='error', kind=None, ok_destinations=()):
        def result(search, job):
            current = 'empty' if job[2] in ok_destinations else status
            data = {'status': current, 'flights': [], 'direction': job[0], 'origin': job[1], 'destination': job[2], 'date': job[3], 'collected_at': time.time()}
            if current == 'error': data.update(error='fixture failure', kind=kind)
            return data
        return result


class CycleTests(CycleFixture):
    def test_open_breaker_skips_queries_without_marking_the_search_failed(self):
        self.put(state='open', retry_at=time.time()+300, trip_kind='blocked')
        with patch('backend.engine.fetch') as remote:
            self.monitor.run_cycle(self.row()); remote.assert_not_called()
        row = self.row()
        self.assertEqual((row['state'], row['error'], row['failures'], row['last_success'], row['progress']), ('scheduled', None, 0, None, 2))
        with store.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM results').fetchone()[0], 0)
            self.assertEqual(c.execute('SELECT status FROM cycles').fetchone()[0], 'interrupted')
            self.assertEqual(c.execute('SELECT complete FROM snapshots').fetchone()[0], 0)

    def test_half_open_probe_success_resumes_and_failure_skips_the_rest(self):
        self.put(state='open', retry_at=time.time()-1, trip_kind='blocked')
        with patch('backend.engine.fetch', side_effect=self.answer('empty')) as remote:
            self.monitor.run_cycle(self.row())
        self.assertEqual(remote.call_count, 2); self.assertEqual(self.state()['state'], 'closed')
        self.put(state='open', retry_at=time.time()-1, trip_kind='blocked')
        with patch('backend.engine.fetch', side_effect=self.answer('error', 'blocked')) as remote:
            self.monitor.run_cycle(self.row())
        self.assertEqual(remote.call_count, 1)
        data = self.state(); self.assertEqual((data['state'], data['level']), ('open', 1))
        with store.db() as c: self.assertEqual(c.execute("SELECT status FROM cycles ORDER BY id DESC").fetchone()[0], 'interrupted')

    def test_failed_cycles_back_off_unless_the_breaker_pauses_the_source(self):
        with patch('backend.engine.random.uniform', return_value=1.0):
            for expected in (1, 2):
                with patch('backend.engine.fetch', side_effect=self.answer('error', 'network')):
                    self.monitor.run_cycle(self.row())
                row = self.row()
                self.assertEqual((row['failures'], row['error_kind'], row['state']), (expected, 'network', 'error'))
                self.assertAlmostEqual(row['next_due']-row['last_started'], 300*2**(expected-1), delta=1)
            # Source-wide failures below the threshold leave the breaker closed: the search backs off.
            with patch('backend.engine.fetch', side_effect=self.answer('error', 'blocked')):
                self.monitor.run_cycle(self.row())
            row = self.row(); self.assertEqual((row['failures'], row['error_kind']), (3, 'blocked'))
            self.assertAlmostEqual(row['next_due']-row['last_started'], 1200, delta=1)
            data = self.state(); self.assertEqual((data['state'], data['streak'], sorted(data['streak_routes'])), ('closed', 2, ['THE-CGH', 'THE-GRU']))
            # The third one, with two routes already failing, opens the breaker: the pause covers it, no extra step.
            with patch('backend.engine.fetch', side_effect=self.answer('error', 'blocked')) as remote:
                self.monitor.run_cycle(self.row())
            self.assertEqual(remote.call_count, 1); self.assertEqual(self.state()['state'], 'open')
            self.assertEqual(self.row()['failures'], 3)
            with store.db() as c: self.assertEqual(c.execute("SELECT status FROM cycles ORDER BY id DESC").fetchone()[0], 'interrupted')
            self.put(**source.initial())
            with patch('backend.engine.fetch', side_effect=self.answer('empty')):
                self.monitor.run_cycle(self.row())
            row = self.row()
            self.assertEqual((row['failures'], row['error'], row['error_kind'], row['state']), (0, None, None, 'scheduled'))
            self.assertAlmostEqual(row['next_due']-row['last_started'], 300, delta=1)
        with store.db() as c:
            kinds = {json.loads(r[0]).get('kind') for r in c.execute("SELECT data FROM results WHERE status='error'")}
        self.assertEqual(kinds, {'network', 'blocked'})

    def test_partial_success_keeps_the_normal_cadence(self):
        # One route always answers, the other always times out.
        with store.db() as c: c.execute('UPDATE searches SET failures=3 WHERE id=?', (self.sid,))
        with patch('backend.engine.random.uniform', return_value=1.0), \
             patch('backend.engine.fetch', side_effect=self.answer('error', 'timeout', ok_destinations=('GRU',))) as remote:
            for _ in range(4):
                self.monitor.run_cycle(self.row())
                row = self.row()
                self.assertEqual((row['failures'], row['state'], row['error_kind']), (0, 'partial', 'timeout'))
                self.assertAlmostEqual(row['next_due']-row['last_started'], 300, delta=1)
        self.assertEqual(remote.call_count, 8)
        self.assertEqual(self.state()['state'], 'closed')

    def test_error_pages_back_off_their_search_and_never_pause_the_source(self):
        def collect(search, job):
            # The collector subprocess in-process: same classification and fixed messages.
            try: data = collector.collect({'origin': job[1], 'destination': job[2], 'date': job[3], 'cabin': 'economy', 'adults': 1})
            except Exception as exc:
                kind, message = collector.classify(exc)
                data = {'status': 'error', 'error': message, 'kind': kind, 'flights': []}
            return data | {'direction': job[0], 'origin': job[1], 'destination': job[2], 'date': job[3], 'collected_at': time.time()}
        with store.db() as c: other = store.add_search(c, self.search, self.owner)
        with patch.object(collector, 'fetch_flights_html', return_value=ERROR_PAGE), patch('backend.engine.fetch', side_effect=collect), \
             patch('backend.engine.random.uniform', return_value=1.0):
            for expected in (1, 2, 3):
                for sid in (self.sid, other):
                    self.monitor.run_cycle(self.row(sid))
                    row = self.row(sid)
                    self.assertEqual((row['failures'], row['error_kind'], row['state']), (expected, 'no_results', 'error'))
            self.assertAlmostEqual(row['next_due']-row['last_started'], 1200, delta=1)
        data = self.state()
        self.assertEqual((data['state'], data['streak'], data['consecutive_failures'], data['kind']), ('closed', 0, 12, 'no_results'))
        with store.db() as c:
            errors = {json.loads(r[0])['error'] for r in c.execute("SELECT data FROM results WHERE status='error'")}
        self.assertEqual(errors, {collector.MESSAGES['no_results']})

    def test_scheduler_starts_nothing_while_paused_or_testing(self):
        with store.db() as c: c.execute('UPDATE searches SET next_due=0')
        self.put(state='open', retry_at=time.time()+300)
        def turns(after):
            # One gate read per loop turn: two reads after `after` prove a whole turn saw the state.
            deadline = time.time()+5
            while time.time() < deadline and gate.call_count < after+2: time.sleep(.02)
            self.assertGreaterEqual(gate.call_count, after+2)
        with patch.object(self.monitor, 'run_cycle') as cycle, patch.object(source, 'gate', wraps=source.gate) as gate:
            worker = threading.Thread(target=self.monitor.loop); worker.start()
            try:
                turns(0); cycle.assert_not_called()
                self.put(state='half_open', retry_at=time.time()-1, probe_at=time.time())
                turns(gate.call_count); cycle.assert_not_called()
                self.put(state='closed', retry_at=None)
                deadline = time.time()+5
                while time.time() < deadline and not cycle.called: time.sleep(.05)
            finally:
                self.monitor.stop(); worker.join(5)
        self.assertGreaterEqual(cycle.call_count, 1)
        self.assertLess(self.monitor.status()['collector']['age'], 5)

    def test_scheduler_in_probe_state_starts_exactly_one_query(self):
        # Two due searches of two accounts, two routes each: up to four queries could start.
        from backend import accounts
        from fastapi import Response
        other = accounts.register(accounts.Registration(name='Probe fixture', country='GB', phone='02079460018', password='fixture-password-only'), Response())['id']
        with store.db() as c:
            store.add_search(c, self.search, other); c.execute('UPDATE searches SET next_due=0')
        self.put(state='open', retry_at=time.time()-1, trip_kind='blocked')
        self.assertEqual(source.gate(), 'probe')
        started, release = [], threading.Event()
        def probe(search, job):
            started.append(job); release.wait(5)
            return self.answer('error', 'blocked')(search, job)
        with patch('backend.engine.fetch', side_effect=probe), patch.object(self.monitor, 'run_cycle', wraps=self.monitor.run_cycle) as cycle, \
             patch.object(source, 'gate', wraps=source.gate) as gate:
            worker = threading.Thread(target=self.monitor.loop); worker.start()
            try:
                deadline = time.time()+5
                while time.time() < deadline and not started: time.sleep(.02)
                # Scheduler turns while the test query is still running start nothing else.
                after = gate.call_count; deadline = time.time()+5
                while time.time() < deadline and gate.call_count < after+3: time.sleep(.02)
                self.assertGreaterEqual(gate.call_count, after+3)
                self.assertEqual((len(started), cycle.call_count, source.gate()), (1, 1, 'testing'))
            finally:
                release.set(); self.monitor.stop(); worker.join(5)
        # The test query failed: the breaker reopened and the rest of that cycle was skipped.
        self.assertFalse(worker.is_alive()); self.assertEqual(len(started), 1)
        data = self.state(); self.assertEqual((data['state'], data['level']), ('open', 1))

    def test_same_route_in_two_searches_never_opens_the_breaker(self):
        def route(destination, day):
            config = Search(origins=['THE'], destinations=[destination], outbound=Leg(start='2090-11-%02dT00:00' % day, end='2090-11-%02dT23:59' % day))
            with store.db() as c: return store.add_search(c, config, self.owner)
        same = [route('GRU', 5), route('GRU', 6)]
        with patch('backend.engine.fetch', side_effect=self.answer('error', 'blocked')) as remote, patch('backend.engine.random.uniform', return_value=1.0):
            for _ in range(3):
                for sid in same: self.monitor.run_cycle(self.row(sid))
            self.assertEqual(remote.call_count, 6)
            data = self.state()
            self.assertEqual((data['state'], data['streak'], data['streak_routes']), ('closed', 6, ['THE-GRU']))
            # Each search backs off on its own instead of pausing everyone.
            self.assertEqual([self.row(sid)['failures'] for sid in same], [3, 3])
            # The same failure on a second route opens the breaker for every search.
            self.monitor.run_cycle(self.row(route('CGH', 5)))
        data = self.state(); self.assertEqual((data['state'], data['streak_routes']), ('open', ['THE-GRU', 'THE-CGH']))

    def test_query_cancelled_by_a_change_is_skipped_without_result_or_kind(self):
        def pause_during_first(search, job):
            with store.db() as c: c.execute("UPDATE searches SET active=0,state='paused',next_due=NULL WHERE id=?", (self.sid,))
            return self.answer('error', 'timeout')(search, job)
        with patch('backend.engine.fetch', side_effect=pause_during_first) as remote:
            self.monitor.run_cycle(self.row())
        # The second route was never queried: no result row, no "cancelled" kind anywhere.
        self.assertEqual(remote.call_count, 1)
        with store.db() as c:
            rows = [json.loads(r[0]) for r in c.execute('SELECT data FROM results')]
            cycle = dict(c.execute('SELECT * FROM cycles').fetchone())
        self.assertEqual([r['kind'] for r in rows], ['timeout']); self.assertNotIn('cancelled', json.dumps(rows))
        self.assertEqual((cycle['status'], cycle['successes'], cycle['failures']), ('interrupted', 0, 1))
        row = self.row(); self.assertEqual((row['state'], row['error_kind']), ('paused', None))
        # A row stored by the former code with kind "cancelled" is reported without a kind.
        from backend.app import recent_results
        with store.db() as c:
            c.execute("INSERT INTO results(cycle_id,search_id,version,direction,route_key,collected,status,data) VALUES(?,?,?,?,?,?,?,?)",
                      (cycle['id'], self.sid, row['version'], 'outbound', 'outbound|THE|CGH|2090-11-05|legacy', time.time(), 'error',
                       json.dumps({'status': 'error', 'error': 'Consulta cancelada', 'kind': 'cancelled', 'flights': [], 'direction': 'outbound',
                                   'origin': 'THE', 'destination': 'CGH', 'date': '2090-11-05'})))
            _, routes = recent_results(c, c.execute('SELECT * FROM searches WHERE id=?', (self.sid,)).fetchone())
        self.assertEqual(len(routes), 2); self.assertEqual({(r['status'], r['error_kind']) for r in routes}, {('error', None), ('error', 'timeout')})

    def test_cycle_start_clears_the_previous_error_kind(self):
        with store.db() as c: c.execute("UPDATE searches SET error='2 consulta(s) falharam',error_kind='blocked' WHERE id=?", (self.sid,))
        seen = []
        def answer(search, job):
            seen.append(tuple(self.row()[k] for k in ('state', 'error', 'error_kind')))
            return self.answer('empty')(search, job)
        with patch('backend.engine.fetch', side_effect=answer):
            self.monitor.run_cycle(self.row())
        self.assertEqual(set(seen), {('collecting', None, None)})

    def test_unexpected_cycle_errors_are_logged_with_the_search(self):
        with store.db() as c: c.execute('UPDATE searches SET next_due=0')
        with patch.object(self.monitor, 'run_cycle', side_effect=RuntimeError('fixture failure')), self.assertLogs('radar.engine', 'ERROR') as captured:
            worker = threading.Thread(target=self.monitor.loop); worker.start()
            deadline = time.time()+5
            while time.time() < deadline and not (captured.records and self.row()['state'] == 'error'): time.sleep(.05)
            self.monitor.stop(); worker.join(5)
        record = captured.records[0]
        self.assertEqual(record.search_id, self.sid); self.assertIsNotNone(record.exc_info)
        self.assertEqual(self.row()['state'], 'error')

    def test_query_ended_by_a_shutdown_is_skipped_without_failure_or_backoff(self):
        # The process group's signal ended the collector subprocess, maybe before Monitor.stop ran.
        with store.db() as c: c.execute('UPDATE searches SET failures=2 WHERE id=?', (self.sid,))
        with patch('backend.engine.fetch', side_effect=engine.QueryInterrupted) as remote, self.assertLogs('radar', 'INFO') as captured:
            self.monitor.run_cycle(self.row())
        self.assertEqual(remote.call_count, 2)
        messages = [record.getMessage() for record in captured.records]
        self.assertEqual(messages.count('Consulta à fonte interrompida'), 2); self.assertNotIn('Consulta à fonte falhou', messages)
        with store.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM results').fetchone()[0], 0)
            self.assertEqual(tuple(c.execute('SELECT status,successes,failures FROM cycles').fetchone()), ('interrupted', 0, 0))
        row = self.row()
        self.assertEqual((row['state'], row['error'], row['error_kind'], row['failures']), ('scheduled', None, None, 2))
        self.assertEqual((self.state()['state'], self.state()['consecutive_failures']), ('closed', 0))
        # The breaker's test query: its admission is released, so another query can test the source.
        self.put(state='open', retry_at=time.time()-1, trip_kind='blocked')
        with patch('backend.engine.fetch', side_effect=engine.QueryInterrupted):
            self.monitor.run_cycle(self.row())
        data = self.state()
        self.assertEqual((source.gate(), data['state'], data['level'], data['consecutive_failures']), ('probe', 'half_open', 0, 0))

    def test_nothing_starts_once_the_monitor_is_stopping(self):
        job = ('outbound', 'THE', 'GRU', '2090-11-05'); row = self.row()
        self.monitor.stop_event.set()
        with patch('backend.engine.fetch') as remote, patch.object(source, 'admit') as admit, patch.object(source, 'gate') as gate:
            self.monitor.run_cycle(row)
            self.assertEqual(self.monitor.gated_fetch(self.search, job, row)['status'], 'skipped')
            remote.assert_not_called(); admit.assert_not_called(); gate.assert_not_called()
        # No cycle row and no start time: the next start runs this cycle at its usual time.
        with store.db() as c: self.assertEqual(c.execute('SELECT COUNT(*) FROM cycles').fetchone()[0], 0)
        self.assertEqual((self.row()['state'], self.row()['last_started']), ('scheduled', None))
        # A query waiting for its account's gate slot when the stop comes is skipped, not an aborted cycle.
        self.monitor.stop_event.clear(); results = []
        with patch('backend.engine.fetch') as remote, self.monitor.query_gate.slot(self.owner, threading.Event()):
            waiting = threading.Thread(target=lambda: results.append(self.monitor.gated_fetch(self.search, job, row))); waiting.start()
            deadline = time.time()+5
            while time.time() < deadline and not self.monitor.query_gate.waiting: time.sleep(.02)
            self.monitor.stop_event.set(); waiting.join(5)
        remote.assert_not_called(); self.assertEqual([result['status'] for result in results], ['skipped'])

    def test_stop_during_admission_frees_it_unused(self):
        # admit() can wait for the breaker's locks; the stop arrives meanwhile, during the breaker's test query.
        self.put(state='open', retry_at=time.time()-1, trip_kind='blocked')
        admit, admissions = source.admit, []
        def admit_then_stop(*args, **kwargs):
            admissions.append(admit(*args, **kwargs)); self.monitor.stop_event.set(); return admissions[-1]
        with patch.object(source, 'admit', side_effect=admit_then_stop), patch('backend.engine.fetch') as remote:
            result = self.monitor.gated_fetch(self.search, ('outbound', 'THE', 'GRU', '2090-11-05'), self.row())
        self.assertEqual(result['status'], 'skipped'); remote.assert_not_called()
        self.assertEqual([admission.kind for admission in admissions], ['probe'])
        # Released unused: another query can test the source at the next start.
        data = self.state(); self.assertEqual((source.gate(), data['state'], data['probe_at']), ('probe', 'half_open', None))


class ShutdownTests(CycleFixture):
    """A started monitor stopped during a collection; stand-in subprocesses, never the collector."""

    def setUp(self):
        super().setUp()
        self.release = threading.Event()
        # Every query here runs a stand-in, also when a test ends early; tests pick its behavior.
        self.collector(stand_in(0, {'status': 'empty', 'flights': []}))

    def tearDown(self):
        # Before the temporary folder goes: no worker thread or subprocess outlives the test. The stop
        # comes first, so the route after an ended query is skipped instead of starting a new stand-in.
        self.monitor.stop_event.set(); self.release.set(); engine.end_children()
        try: self.assertTrue(self.monitor.stop(timeout=10))
        finally:
            engine.end_children(); super().tearDown()

    def collector(self, command):
        item = patch.object(engine, 'COLLECTOR', command); item.start(); self.patches.append(item)

    def collecting(self, command):
        self.collector(command)
        with store.db() as c: c.execute('UPDATE searches SET next_due=0')
        self.monitor.start()
        return running_child()

    def results(self):
        with store.db() as c:
            return [r[0] for r in c.execute('SELECT status FROM results')], tuple(c.execute('SELECT status,successes,failures FROM cycles').fetchone())

    def test_stop_ends_queries_in_flight_at_the_margin_and_skips_them(self):
        self.collecting(stand_in(30))
        started = time.monotonic(); stopped = self.monitor.stop(timeout=1.0); elapsed = time.monotonic()-started
        # The deadline holds: the subprocess was ended at the margin and the cycle closed.
        self.assertTrue(stopped); self.assertLess(elapsed, 2.5)
        self.assertEqual([thread.name for thread in threading.enumerate() if thread.name.startswith('radar-')], [])
        self.assertEqual(engine.CHILDREN, {})
        self.assertEqual(self.results(), ([], ('interrupted', 0, 0)))
        row = self.row()
        self.assertEqual((row['state'], row['error'], row['error_kind'], row['failures']), ('scheduled', None, None, 0))
        self.assertEqual((self.state()['state'], self.state()['consecutive_failures']), ('closed', 0))
        # The next start keeps the usual cadence: no backoff for a stopped cycle.
        store.setup(seed=False)
        row = self.row(); self.assertLessEqual(row['next_due'], row['last_started']+300+1)

    def test_stop_waits_for_a_query_that_answers_in_time(self):
        self.collecting(stand_in(.3, {'status': 'empty', 'flights': []}))
        self.assertTrue(self.monitor.stop(timeout=5))
        # The query in flight is recorded; the route that had not started is skipped (no row).
        self.assertEqual(self.results(), (['empty'], ('interrupted', 1, 0)))
        row = self.row(); self.assertEqual((row['state'], row['error'], row['failures']), ('scheduled', None, 0))

    def test_query_ended_by_a_signal_before_stop_is_not_a_failure(self):
        # Ctrl+C or a supervisor's SIGTERM reaches the process group before Monitor.stop runs.
        with self.assertLogs('radar', 'INFO') as captured:
            first = self.collecting(stand_in(30))
            os.kill(first.pid, signal.SIGTERM)
            # The other route starts only after the ended query was handled.
            running_child(other_than=first)
            self.assertTrue(self.monitor.stop(timeout=2))
        messages = [record.getMessage() for record in captured.records]
        self.assertEqual(messages.count('Consulta à fonte interrompida'), 2); self.assertNotIn('Consulta à fonte falhou', messages)
        self.assertEqual(self.results(), ([], ('interrupted', 0, 0)))
        row = self.row(); self.assertEqual((row['error'], row['error_kind'], row['failures']), (None, None, 0))
        self.assertEqual((self.state()['state'], self.state()['consecutive_failures']), ('closed', 0))

    def outbox(self):
        with store.db() as c:
            c.execute("INSERT INTO outbox(id,created,alert_ids,subject,body,status,next_due,recipients,kind) VALUES('stop-fixture',?,'[]','Subject','Body','pending',?,?,'test')", (time.time(), time.time(), json.dumps(['fixture@example.org'])))

    def sending(self, transmit):
        """Start the monitor with one e-mail being sent through `transmit`; no search is due."""
        with store.db() as c: c.execute('UPDATE searches SET next_due=?', (time.time()+3600,))
        self.outbox(); started = threading.Event()
        def send(*args):
            started.set(); transmit()
        for item in (patch.object(mail, 'delivery_settings', return_value={'enabled': True, 'provider': 'smtp'}), patch.object(mail, 'transmit', side_effect=send)):
            item.start(); self.patches.append(item)
        self.monitor.start(); self.assertTrue(started.wait(5))

    def delivery(self):
        with store.db() as c: return c.execute("SELECT status FROM outbox WHERE id='stop-fixture'").fetchone()[0]

    def test_send_in_progress_finishes_within_the_wait(self):
        # The SMTP exchange ends right after the stop request.
        self.sending(lambda: self.monitor.stop_event.wait(5))
        self.assertTrue(self.monitor.stop(timeout=5))
        self.assertEqual(self.delivery(), 'sent')

    def test_send_past_the_deadline_is_held_as_uncertain(self):
        self.sending(lambda: self.release.wait(10))
        try:
            started = time.monotonic()
            with self.assertLogs('radar.engine', 'WARNING') as captured: stopped = self.monitor.stop(timeout=.5)
            self.assertFalse(stopped); self.assertLess(time.monotonic()-started, 1.5)
            self.assertEqual([(record.getMessage(), record.workers) for record in captured.records], [('Prazo de encerramento esgotado', ['email_sender'])])
            self.assertEqual(self.delivery(), 'sending')
            # The next start holds it for review instead of sending it again.
            store.setup(seed=False); self.assertEqual(self.delivery(), 'uncertain')
        finally:
            self.release.set(); self.monitor.sender.join(5)
        self.assertFalse(self.monitor.sender.is_alive())

    def test_stop_requested_while_waiting_for_the_write_lock_claims_no_email(self):
        # The loop sees the stop only between turns, and send_one can wait up to 15 s for BEGIN IMMEDIATE.
        self.outbox(); reached = threading.Event()
        def settings():
            reached.set(); return {'enabled': True, 'provider': 'smtp'}
        worker = threading.Thread(target=self.monitor.send_one)
        with patch.object(mail, 'delivery_settings', side_effect=settings), patch.object(mail, 'transmit') as transmit:
            try:
                with store.db() as blocker:
                    # Another writer holds the lock: send_one gets past delivery_settings, then waits in BEGIN IMMEDIATE.
                    blocker.execute('BEGIN IMMEDIATE'); worker.start()
                    self.assertTrue(reached.wait(5)); worker.join(.2); self.assertTrue(worker.is_alive())
                    self.monitor.stop_event.set()
                # Leaving the block released the lock (commit, or rollback after a failure).
            finally:
                self.monitor.stop_event.set()
                if worker.is_alive(): worker.join(5)
            self.assertFalse(worker.is_alive())
            transmit.assert_not_called(); self.assertEqual(self.delivery(), 'pending')
            # Not stopping: the same item is claimed and sent.
            Monitor().send_one()
            transmit.assert_called_once(); self.assertEqual(self.delivery(), 'sent')


class HealthTests(Isolated):
    class Workers:
        def __init__(self, **override):
            self.values = {'collector': (True, 0.5), 'email_sender': (True, 1.0), 'whatsapp_sender': (True, 1.5)} | override
        def start(self): pass
        def stop(self): pass
        def status(self, now=None):
            from backend.engine import HEARTBEAT_LIMITS
            return {name: {'alive': alive, 'age': age, 'limit': HEARTBEAT_LIMITS[name]} for name, (alive, age) in self.values.items()}

    def setUp(self):
        super().setUp()
        # Loopback peer and Host, like the container HEALTHCHECK: the full body.
        self.module = importlib.import_module('backend.app')
        self.client = TestClient(self.module.app, base_url='http://127.0.0.1:8765', client=('127.0.0.1', 5000))
        self.clients = [self.client]

    def tearDown(self):
        for client in self.clients: client.close()
        super().tearDown()

    def health(self, workers, client=None):
        with patch.object(self.module, 'monitor', workers): return (client or self.client).get('/api/health')

    def remote(self):
        # TestClient's symbolic peer is not a loopback address.
        client = TestClient(self.module.app); self.clients.append(client); return client

    def test_full_body_only_for_the_loopback_and_administrator_sessions(self):
        token = {'x-radar-token': self.module.TOKEN}
        anonymous, user, admin = self.remote(), self.remote(), self.remote()
        self.assertEqual(admin.post('/api/auth/bootstrap', json={'name': 'Health admin', 'country': 'US', 'phone': '6502530000', 'password': 'fixture-password-only'}, headers=token).status_code, 200)
        self.assertEqual(user.post('/api/auth/register', json={'name': 'Health user', 'country': 'GB', 'phone': '02079460018', 'password': 'fixture-password-only'}, headers=token).status_code, 200)
        full = {'ok', 'version', 'db_ok', 'collector_alive', 'whatsapp_sender_alive', 'email_sender_alive', 'heartbeats', 'source'}
        for workers, status in ((self.Workers(), 200), (self.Workers(collector=(False, 0.5)), 503)):
            with self.subTest(status=status):
                # Anonymous or signed in without the administrator role, away from the loopback: ok only.
                for client in (anonymous, user):
                    response = self.health(workers, client)
                    self.assertEqual((response.status_code, response.json()), (status, {'ok': status == 200}))
                    self.assertEqual(response.headers['cache-control'], 'no-store')
                for client in (admin, self.client):
                    response = self.health(workers, client)
                    self.assertEqual((response.status_code, set(response.json())), (status, full))
        # Without a readable database the session is not looked up.
        with patch.object(self.module, 'ping', return_value=False), patch.object(self.module.accounts, 'current_user') as lookup:
            response = self.health(self.Workers(), admin)
        self.assertEqual((response.status_code, response.json()), (503, {'ok': False})); lookup.assert_not_called()

    def test_contract_and_ok_rules(self):
        response = self.health(self.Workers())
        self.assertEqual(response.status_code, 200); body = response.json()
        self.assertEqual(set(body), {'ok', 'version', 'db_ok', 'collector_alive', 'whatsapp_sender_alive', 'email_sender_alive', 'heartbeats', 'source'})
        self.assertTrue(body['ok'] and body['db_ok'] and body['collector_alive'] and body['whatsapp_sender_alive'] and body['email_sender_alive'])
        self.assertEqual(body['heartbeats'], {'collector': 0.5, 'email_sender': 1.0, 'whatsapp_sender': 1.5})
        self.assertEqual(body['source']['status'], 'ok'); self.assertEqual(response.headers['cache-control'], 'no-store')
        for override in ({'collector': (True, 121.0)}, {'email_sender': (False, 1.0)}, {'whatsapp_sender': (True, None)}):
            with self.subTest(override=override):
                response = self.health(self.Workers(**override))
                self.assertEqual(response.status_code, 503); self.assertFalse(response.json()['ok'])

    def test_paused_source_is_reported_but_does_not_fail_health(self):
        self.put(state='open', retry_at=time.time()+600, trip_kind='blocked', consecutive_failures=3, kind='blocked')
        body = self.health(self.Workers()).json()
        self.assertTrue(body['ok']); self.assertEqual(body['source']['status'], 'paused'); self.assertEqual(body['source']['kind'], 'blocked')

    def test_database_failure(self):
        with patch.object(self.module, 'ping', return_value=False):
            response = self.health(self.Workers())
        self.assertEqual(response.status_code, 503); body = response.json()
        self.assertFalse(body['db_ok']); self.assertIsNone(body['source'])
        self.assertTrue(store.ping())

    def test_any_signed_in_user_receives_the_source_state(self):
        token = {'x-radar-token': self.module.TOKEN}
        self.client.post('/api/auth/register', json={'name': 'Source fixture', 'country': 'US', 'phone': '6502530000', 'password': 'fixture-password-only'}, headers=token)
        self.put(state='open', retry_at=time.time()+600, trip_kind='rate_limited')
        state = self.client.get('/api/state', params={'scope': 'home'}).json()
        self.assertEqual(state['user']['role'], 'user'); self.assertEqual(state['source']['status'], 'paused')
        self.assertEqual(set(state['source']), {'status', 'kind', 'consecutive_failures', 'last_success_at', 'last_failure_at', 'retry_at'})
        revision = state['revision']
        self.assertTrue(self.client.get('/api/state', params={'scope': 'home', 'since': revision}).json().get('unchanged'))
        self.put(state='closed', retry_at=None)
        self.assertNotIn('unchanged', self.client.get('/api/state', params={'scope': 'home', 'since': revision}).json())

    def test_missing_database_is_not_created_by_the_probe(self):
        empty = self.folder/'empty'
        with patch.object(store, 'DATA_DIR', empty):
            self.assertFalse(store.ping()); self.assertFalse((empty/'radar.sqlite3').exists())

    def test_probe_opens_the_right_file_when_the_folder_name_has_uri_characters(self):
        before = {item.name for item in self.folder.iterdir()}
        folder = self.folder/'radar ?#%25 data'
        with patch.object(store, 'DATA_DIR', folder):
            # Missing database: read-only refusal, nothing created next to the folder either.
            folder.mkdir(); self.assertFalse(store.ping())
            self.assertEqual({item.name for item in self.folder.iterdir()}, before | {folder.name})
            self.assertEqual(list(folder.iterdir()), [])
            store.setup(seed=False); self.assertTrue(store.ping())
        self.assertEqual({item.name for item in self.folder.iterdir()}, before | {folder.name})

    def test_adapter_change_resets_the_breaker_and_a_restart_does_not(self):
        self.put(state='open', retry_at=time.time()+600, trip_kind='format', streak=3, level=2, consecutive_failures=3, generation=4)
        store.setup(seed=False)
        self.assertEqual((self.state()['state'], self.state()['level']), ('open', 2))
        with store.db() as c: c.execute("UPDATE metadata SET value='fixture-previous-adapter' WHERE key='adapter_version'")
        store.setup(seed=False)
        self.assertEqual(self.state(), source.initial())
        self.assertEqual(source.public()['status'], 'ok')

    def test_real_monitor_reports_heartbeats(self):
        monitor = Monitor()
        self.assertEqual({name: value['age'] for name, value in monitor.status().items()}, dict.fromkeys(('collector', 'email_sender', 'whatsapp_sender')))
        monitor.beat('collector')
        status = monitor.status(); self.assertLess(status['collector']['age'], 1); self.assertFalse(status['collector']['alive'])


class PersistenceTests(Isolated):
    def add(self):
        config = Search(origins=['THE'], destinations=['GRU'], outbound=Leg(start='2090-11-05T00:00', end='2090-11-05T23:59'))
        with store.db() as c: return store.add_search(c, config)

    def row(self, sid):
        with store.db() as c: return dict(c.execute('SELECT * FROM searches WHERE id=?', (sid,)).fetchone())

    def test_legacy_failure_counts_are_reset_once(self):
        sid = self.add()
        # Before error_kind existed, failures grew on any cycle with a failing route.
        with store.db() as c:
            c.execute('ALTER TABLE searches DROP COLUMN error_kind')
            c.execute("DELETE FROM metadata WHERE key='search_failures_reset_v1'")
            c.execute('UPDATE searches SET failures=9 WHERE id=?', (sid,))
        store.setup(seed=False)
        self.assertEqual((self.row(sid)['failures'], self.row(sid)['error_kind']), (0, None))
        # The first cycle without a success after the update keeps the normal cadence (not +3600 s).
        monitor = Monitor(); monitor.query_gate = QueryGate(min_gap=0)
        failure = {'status': 'error', 'error': 'fixture failure', 'kind': 'network', 'flights': []}
        with patch('backend.engine.fetch', side_effect=lambda search, job: failure | {'direction': job[0], 'origin': job[1], 'destination': job[2], 'date': job[3], 'collected_at': time.time()}), \
             patch('backend.engine.random.uniform', return_value=1.0):
            monitor.run_cycle(self.row(sid))
        row = self.row(sid); self.assertEqual(row['failures'], 1)
        self.assertAlmostEqual(row['next_due']-row['last_started'], 300, delta=1)
        # Only once: later starts keep counts of the current rule.
        with store.db() as c: c.execute('UPDATE searches SET failures=2 WHERE id=?', (sid,))
        store.setup(seed=False)
        self.assertEqual(self.row(sid)['failures'], 2)

    def test_restart_keeps_a_later_next_due(self):
        sid = self.add(); now = time.time()
        with store.db() as c: c.execute('UPDATE searches SET last_started=?,next_due=? WHERE id=?', (now-60, now+3000, sid))
        store.setup(seed=False)
        self.assertAlmostEqual(self.row(sid)['next_due'], now+3000, delta=1)
        # Without a backoff the restart still waits five minutes after the last start.
        with store.db() as c: c.execute('UPDATE searches SET next_due=? WHERE id=?', (now-10, sid))
        store.setup(seed=False)
        self.assertAlmostEqual(self.row(sid)['next_due'], now-60+300, delta=1)
        with store.db() as c: c.execute('UPDATE searches SET last_started=NULL,next_due=NULL WHERE id=?', (sid,))
        store.setup(seed=False)
        self.assertAlmostEqual(self.row(sid)['next_due'], time.time(), delta=5)

    def test_trip_edit_and_adapter_change_clear_error_and_kind(self):
        module = importlib.import_module('backend.app'); client = TestClient(module.app); token = {'x-radar-token': module.TOKEN}
        try:
            self.assertEqual(client.post('/api/auth/register', json={'name': 'Edit fixture', 'country': 'US', 'phone': '6502530000', 'password': 'fixture-password-only'}, headers=token).status_code, 200)
            config = Search(origins=['THE'], destinations=['GRU'], outbound=Leg(start='2090-11-05T00:00', end='2090-11-05T23:59')).model_dump()
            sid = client.post('/api/searches', json=config, headers=token).json()['id']
            with store.db() as c: c.execute("UPDATE searches SET state='error',error='1 consulta(s) falharam',error_kind='blocked' WHERE id=?", (sid,))
            config['outbound']['max_duration'] = 600
            self.assertEqual(client.put('/api/searches/'+sid, json=config, headers=token).status_code, 200)
            selected = client.get('/api/state', params={'search_id': sid}).json()['selected']
            self.assertEqual((selected['version'], selected['error'], selected['error_kind']), (2, None, None))
        finally:
            client.close()
        with store.db() as c:
            c.execute("UPDATE searches SET error='1 consulta(s) falharam',error_kind='format' WHERE id=?", (sid,))
            c.execute("UPDATE metadata SET value='fixture-previous-adapter' WHERE key='adapter_version'")
        store.setup(seed=False)
        self.assertEqual((self.row(sid)['error'], self.row(sid)['error_kind']), (None, None))


class LogTests(Isolated):
    def test_json_lines_with_identifier_fields(self):
        stream = io.StringIO(); handler = logging.StreamHandler(stream); handler.setFormatter(logs.JSONFormatter())
        logger = logging.getLogger('radar.test'); logger.addHandler(handler); logger.setLevel(logging.INFO)
        try:
            logger.warning('Consulta à fonte falhou', extra={'search_id': 'fixture-search', 'kind': 'blocked'})
            try: raise RuntimeError('fixture')
            except RuntimeError: logger.exception('Falha inesperada', extra={'outbox_id': 'fixture-outbox'})
        finally: logger.removeHandler(handler)
        first, second = [json.loads(line) for line in stream.getvalue().splitlines()]
        self.assertEqual((first['level'], first['logger'], first['search_id'], first['kind']), ('WARNING', 'radar.test', 'fixture-search', 'blocked'))
        self.assertEqual(first['message'], 'Consulta à fonte falhou'); self.assertIn('time', first)
        self.assertEqual(second['outbox_id'], 'fixture-outbox'); self.assertIn('RuntimeError', second['exception'])

    def test_errors_reach_stderr_once_with_or_without_configured_logging(self):
        # A fresh process (no test isolation), e.g. `uvicorn backend.app:app` without scripts/run.py:
        # collector errors fall through to Python's last-resort handler instead of vanishing.
        # After logs.configure() (run.py, serve.py) the same error is one JSON line, not two.
        code = ('from backend import engine, logs\n'
                "engine.logger.error('fixture before configuration')\n"
                'logs.configure()\n'
                "engine.logger.error('fixture after configuration')\n")
        done = subprocess.run([sys.executable, '-c', code], cwd=ROOT, capture_output=True, text=True, timeout=120)
        self.assertEqual(done.returncode, 0, done.stderr)
        lines = done.stderr.splitlines()
        self.assertIn('fixture before configuration', lines)
        after = [line for line in lines if 'fixture after configuration' in line]
        self.assertEqual(len(after), 1); self.assertEqual(json.loads(after[0])['logger'], 'radar.engine')

    def test_uvicorn_color_message_is_not_emitted(self):
        # uvicorn logs with extra={'color_message': ...}: the same text with ANSI escapes.
        record = logging.LogRecord('uvicorn.error', logging.INFO, __file__, 1, 'Started server process [%d]', (42,), None)
        record.color_message = 'Started server process [\x1b[36m%d\x1b[0m]'
        text = logs.JSONFormatter().format(record); entry = json.loads(text)
        self.assertEqual(entry['message'], 'Started server process [42]')
        self.assertNotIn('color_message', entry); self.assertNotIn('\\u001b', text); self.assertNotIn('\x1b', text)

    def test_level_from_environment(self):
        root = logging.getLogger(); saved = (root.handlers[:], root.level)
        try:
            with patch.dict(os.environ, {'RADAR_LOG_LEVEL': 'warning'}):
                logs.configure(io.StringIO()); self.assertEqual(root.level, logging.WARNING)
            with patch.dict(os.environ, {}, clear=False):
                os.environ.pop('RADAR_LOG_LEVEL', None); logs.configure(io.StringIO()); self.assertEqual(root.level, logging.INFO)
            with patch.dict(os.environ, {'RADAR_LOG_LEVEL': 'verbose'}), self.assertRaises(ValueError): logs.configure(io.StringIO())
        finally:
            root.handlers[:], level = saved; root.setLevel(level)

    def test_delivery_failures_never_log_addresses_or_bodies(self):
        with store.db() as c:
            c.execute("INSERT INTO outbox(id,created,alert_ids,subject,body,status,next_due,recipients,kind) VALUES('log-fixture',?,'[]','Subject','private body text','pending',?,?,'test')", (time.time(), time.time(), json.dumps(['private-person@example.org'])))
        refused = smtplib.SMTPRecipientsRefused({'private-person@example.org': (550, b'private-person@example.org rejected')})
        with patch.object(mail, 'delivery_settings', return_value={'enabled': True, 'provider': 'smtp'}), patch.object(mail, 'transmit', side_effect=refused), \
             self.assertLogs('radar', 'WARNING') as captured:
            Monitor().send_one()
        text = '\n'.join(logs.JSONFormatter().format(record) for record in captured.records)
        self.assertIn('log-fixture', text); self.assertNotIn('private-person', text); self.assertNotIn('private body', text)


if __name__ == '__main__':
    unittest.main()
