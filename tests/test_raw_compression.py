"""Compressed raw responses: codec, legacy text rows, gradual backfill, batched retention and VACUUM script."""
import test_isolation  # noqa: F401 - first: temporary data, no seed, idle workers
import importlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import zlib
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend import store, mail, retention, result_cache
from backend.domain import Search, Leg

ROOT = Path(__file__).resolve().parents[1]


def response(status='ok', price=10000, destination='GRU'):
    flights = [] if status != 'ok' else [{
        'id': str(price), 'direction': 'outbound', 'origin': 'THE', 'destination': destination,
        'departure': '2090-11-05T12:00', 'arrival': '2090-11-05T18:00', 'duration_minutes': 60, 'stops': 0,
        'price_cents': price, 'airlines': ['LATAM'], 'currency': 'BRL', 'collected_at': 123}]
    return {'status': status, 'direction': 'outbound', 'origin': 'THE', 'destination': destination, 'date': '2090-11-05',
            'flights': flights, 'error': 'Falha de teste' if status == 'error' else None,
            'kind': 'timeout' if status == 'error' else None, 'elapsed_seconds': 1.5}


def transactions(statements):
    """Statements traced by SQLite grouped by write transaction. Trigger programs repeat the
    statement that fired them in the trace: consecutive repeats count once."""
    groups, current = [], None
    for statement in statements:
        if statement.startswith('BEGIN'): current = []
        elif statement == 'COMMIT' and current is not None: groups.append(current); current = None
        elif current is not None and current[-1:] != [statement]: current.append(statement)
    return groups


class CodecTests(unittest.TestCase):
    def test_blob_and_legacy_text_decode_to_the_same_response(self):
        payload = dict(response(), note='São Paulo')
        text = json.dumps(payload)
        blob = result_cache.encode(payload)
        self.assertIsInstance(blob, bytes)
        self.assertEqual(json.loads(zlib.decompress(blob)), payload)
        self.assertEqual(result_cache.decode(blob), payload)
        self.assertEqual(result_cache.decode(text), payload)
        self.assertEqual(result_cache.decode(result_cache.encode(text)), payload)
        # As SQLite returns them from a TEXT-affinity column: str for legacy rows, bytes for BLOBs.
        with sqlite3.connect(':memory:') as c:
            c.execute('CREATE TABLE results(data TEXT NOT NULL)')
            c.executemany('INSERT INTO results VALUES(?)', [(text,), (blob,)])
            self.assertEqual([r[0] for r in c.execute('SELECT typeof(data) FROM results')], ['text', 'blob'])
            self.assertEqual([result_cache.decode(r[0]) for r in c.execute('SELECT data FROM results')], [payload, payload])
        many = dict(payload, flights=payload['flights']*50)
        self.assertLess(len(result_cache.encode(many))*4, len(json.dumps(many)))


class StoredResultsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.folder = Path(self.temp.name)
        self.patches = [patch.object(store, 'DATA_DIR', self.folder), patch.object(mail, 'DATA_DIR', self.folder),
                        patch.object(mail, 'SETTINGS_FILE', self.folder/'smtp.json'), patch.object(retention, 'PAUSE', 0),
                        patch.dict('os.environ', {'RADAR_RAW_RETENTION_DAYS': '7'})]
        for item in self.patches: item.start()
        store.setup(seed=False); self.module = importlib.import_module('backend.app')
        self.client = TestClient(self.module.app); self.headers = {'x-radar-token': self.module.TOKEN}
        r = self.client.post('/api/auth/register', json={'name': 'Fixture', 'country': 'US', 'phone': '6502530000', 'password': 'fixture-password-only'}, headers=self.headers)
        self.assertEqual(r.status_code, 200, r.text)
        config = Search(origins=['THE'], destinations=['GRU'], outbound=Leg(start='2090-11-05T00:00', end='2090-11-05T23:59')).model_dump()
        r = self.client.post('/api/searches', json=config, headers=self.headers); self.assertEqual(r.status_code, 200, r.text)
        self.sid = r.json()['id']

    def tearDown(self):
        self.client.close()
        for item in reversed(self.patches): item.stop()
        self.temp.cleanup()

    def insert(self, c, route, collected, payload, compressed, version=1):
        cid = c.execute("INSERT INTO cycles(search_id,version,started,status,total) VALUES(?,?,?,'done',1)", (self.sid, version, collected)).lastrowid
        data = result_cache.encode(payload) if compressed else json.dumps(payload)
        return c.execute("INSERT INTO results(cycle_id,search_id,version,direction,route_key,collected,status,data) VALUES(?,?,?,'outbound',?,?,?,?)",
                         (cid, self.sid, version, route, collected, payload['status'], data)).lastrowid

    def revision(self, c):
        return c.execute('SELECT MAX(revision) FROM account_revisions').fetchone()[0]

    @contextmanager
    def traced(self, statements):
        real = retention.db
        @contextmanager
        def db():
            with real() as c:
                c.set_trace_callback(statements.append); yield c
        with patch.object(retention, 'db', db): yield

    def test_state_reads_legacy_text_and_compressed_rows_together(self):
        now = time.time()
        with store.db() as c:
            # Legacy valid response, then a compressed failure on the same route: stale fallback.
            self.insert(c, 'legacy', now-600, response(price=9000), compressed=False)
            self.insert(c, 'legacy', now-60, response('error'), compressed=True)
            self.insert(c, 'compressed', now-30, response(price=12000, destination='CGH'), compressed=True)
        state = self.client.get('/api/state').json()
        self.assertEqual([f['price_cents'] for f in state['flights']], [9000, 12000])
        self.assertEqual([f['stale'] for f in state['flights']], [True, False])
        routes = {r['key']: r for r in state['routes']}
        self.assertEqual((routes['legacy']['status'], routes['legacy']['stale'], routes['legacy']['error'], routes['legacy']['error_kind']),
                         ('error', True, 'Falha de teste', 'timeout'))
        self.assertEqual(round(routes['legacy']['last_valid']), round(now-600))
        self.assertEqual((routes['compressed']['destination'], routes['compressed']['count'], routes['compressed']['latency']), ('CGH', 1, 1.5))

    def test_backfill_compresses_newest_first_in_batches_and_is_idempotent(self):
        now = time.time()
        with store.db() as c:
            legacy = [self.insert(c, 'route-'+str(n), now-1000+n, response(price=10000+n), compressed=False) for n in range(5)]
            newer = self.insert(c, 'route-new', now, response(price=20000), compressed=True)
            before = self.revision(c)
        statements = []
        with store.db() as c:
            c.set_trace_callback(statements.append)
            self.assertEqual(retention.compress_legacy(c, limit=3, batch=2), 3)
            c.set_trace_callback(None)
            kinds = dict(c.execute('SELECT id,typeof(data) FROM results'))
            self.assertEqual([kinds[i] for i in legacy], ['text', 'text', 'blob', 'blob', 'blob'])
            self.assertEqual(kinds[newer], 'blob')
            self.assertEqual(c.execute("SELECT value FROM metadata WHERE key='raw_compression_cursor'").fetchone()[0], str(legacy[2]))
        # One write transaction per batch, at most two rows each, with the cursor saved in it.
        writes = transactions(statements)
        self.assertEqual([sum(s.startswith('UPDATE results') for s in w) for w in writes], [2, 1])
        self.assertTrue(all(any('raw_compression_cursor' in s for s in w) for w in writes))
        with store.db() as c:
            self.assertEqual(retention.compress_legacy(c, limit=10, batch=2), 2)
            self.assertEqual(c.execute("SELECT value FROM metadata WHERE key='raw_compression_cursor'").fetchone()[0], '0')
            statements.clear(); c.set_trace_callback(statements.append)
            self.assertEqual(retention.compress_legacy(c, limit=10, batch=2), 0)
            c.set_trace_callback(None)
            self.assertFalse([s for s in statements if not s.startswith('SELECT')], 'Finished: no write at all')
            rows = c.execute('SELECT id,typeof(data),data FROM results ORDER BY id').fetchall()
            self.assertEqual({r[1] for r in rows}, {'blob'})
            self.assertEqual([result_cache.decode(r[2])['flights'][0]['price_cents'] for r in rows], [10000, 10001, 10002, 10003, 10004, 20000])
            # Same responses: the account's state token does not change.
            self.assertEqual(self.revision(c), before)
        self.assertEqual([f['price_cents'] for f in self.client.get('/api/state').json()['flights']], [10000, 10001, 10002, 10003, 10004, 20000])

    def test_batched_retention_keeps_latest_attempt_and_valid_response_per_route(self):
        now = time.time(); old = now-10*86400
        with store.db() as c:
            ids = {}
            for route in ('first', 'second'):
                ids[route] = [self.insert(c, route, old+n, response(status), compressed=n % 2 == 0)
                              for n, status in enumerate(['ok', 'ok', 'ok', 'error', 'error'])]
            recent = self.insert(c, 'first', now-60, response('error'), compressed=False)
            # Newer cycles: the old ones leave the 30 kept per search.
            for _ in range(40): c.execute("INSERT INTO cycles(search_id,version,started,status,total) VALUES(?,1,?,'done',1)", (self.sid, now))
        self.assertEqual(retention.progress(now=now), {'expired': 7, 'text': 5, 'cursor': None})
        statements = []
        with self.traced(statements), self.assertLogs('radar.retention', 'INFO') as logged:
            summary = retention.cleanup(now=now, batch=2)
        self.assertEqual([(r.getMessage(), r.results, r.cycles, r.compressed) for r in logged.records],
                         [('Retenção de respostas brutas aplicada', 7, 7, 1)])
        self.assertEqual(retention.progress(now=now), {'expired': 0, 'text': 0, 'cursor': 0})
        # Per route: the latest valid response (third) and the latest attempt stay; "first" has a newer attempt.
        self.assertEqual((summary['results'], summary['cycles'], summary['compressed']), (7, 7, 1))
        with store.db() as c:
            kept = [r[0] for r in c.execute('SELECT id FROM results ORDER BY id')]
            self.assertEqual(kept, [ids['first'][2], ids['second'][2], ids['second'][4], recent])
            self.assertEqual({r[0] for r in c.execute('SELECT typeof(data) FROM results')}, {'blob'})
            self.assertFalse(c.execute('PRAGMA foreign_key_check').fetchall())
            self.assertEqual({r[0] for r in c.execute('SELECT id FROM cycles WHERE started<?', (now-7*86400,))},
                             {r[0] for r in c.execute('SELECT cycle_id FROM results WHERE collected<?', (now-7*86400,))})
        writes = transactions(statements)
        for table in ('results', 'cycles'):
            sizes = [len(re.search(r'IN \(([^)]*)\)', s).group(1).split(',')) for w in writes for s in w if s.startswith('DELETE FROM '+table)]
            self.assertEqual(sizes, [2, 2, 2, 1], table)
            self.assertTrue(all(sum(s.startswith('DELETE FROM '+table) for s in w) <= 1 for w in writes))
        with self.assertNoLogs('radar.retention', 'INFO'):
            self.assertEqual(retention.cleanup(now=now+10), {'results': 0, 'cycles': 0, 'compressed': 0})

    def test_responses_reused_by_a_newer_filter_version_are_kept(self):
        now = time.time(); old = now-10*86400
        with store.db() as c:
            ids = [self.insert(c, 'route', old+n, response(), compressed=True) for n in range(5)]
            c.execute('INSERT INTO filter_result_refs(search_id,version,result_id) VALUES(?,2,?)', (self.sid, ids[0]))
        real = retention.delete_batches
        def referenced_meanwhile(c, chosen, statement, *args):
            # A reference added after the selection, before the write lock.
            if statement.startswith('DELETE FROM results'):
                self.assertEqual(chosen, ids[1:4])
                c.execute('INSERT INTO filter_result_refs(search_id,version,result_id) VALUES(?,2,?)', (self.sid, ids[2])); c.commit()
            return real(c, chosen, statement, *args)
        with patch.object(retention, 'delete_batches', side_effect=referenced_meanwhile):
            self.assertEqual(retention.cleanup(now=now)['results'], 2)
        with store.db() as c:
            self.assertEqual([r[0] for r in c.execute('SELECT id FROM results ORDER BY id')], [ids[0], ids[2], ids[4]])

    def test_shutdown_stops_between_batches(self):
        now = time.time(); old = now-10*86400
        with store.db() as c:
            for n in range(6): self.insert(c, 'route', old+n, response(), compressed=False)
        checks = iter([False])
        summary = retention.cleanup(now=now, batch=2, stop=lambda: next(checks, True))
        self.assertEqual(summary, {'results': 2, 'cycles': 0, 'compressed': 0})
        self.assertEqual(retention.progress(now=now), {'expired': 3, 'text': 4, 'cursor': None})

    def test_compose_passes_the_raw_retention_to_the_container(self):
        compose = (ROOT/'compose.cloud.yaml').read_text()
        environment = compose.split('    environment:\n', 1)[1].split('    ports:', 1)[0]
        self.assertIn('      RADAR_RAW_RETENTION_DAYS: ${RADAR_RAW_RETENTION_DAYS:-30}\n', environment)
        self.assertIn('\n# RADAR_RAW_RETENTION_DAYS=7\n', (ROOT/'deploy'/'cloud.env.example').read_text())

    def test_cleanup_leaves_compressed_rows_untouched(self):
        with store.db() as c:
            rid = self.insert(c, 'route', time.time(), response(), compressed=True)
            stored = c.execute('SELECT data FROM results WHERE id=?', (rid,)).fetchone()[0]
        self.assertEqual(retention.cleanup()['compressed'], 0)
        with store.db() as c:
            self.assertEqual(c.execute('SELECT data FROM results WHERE id=?', (rid,)).fetchone()[0], stored)


class CompactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.folder = Path(self.temp.name); self.path = self.folder/'radar.sqlite3'
        c = sqlite3.connect(self.path)
        try:
            c.execute('PRAGMA journal_mode=WAL')
            c.execute('CREATE TABLE results(id INTEGER PRIMARY KEY, data TEXT NOT NULL)')
            c.executemany('INSERT INTO results(data) VALUES(?)', [(os.urandom(4000).hex(),) for _ in range(300)])
            c.commit()
            # Freed pages stay in the file until VACUUM.
            c.execute('DELETE FROM results WHERE id>10'); c.commit()
        finally:
            c.close()

    def tearDown(self):
        self.temp.cleanup()

    def run_script(self, **env):
        env = {k: v for k, v in dict(os.environ, RADAR_DATA_DIR=str(self.folder), **env).items() if k != 'SQLITE_TMPDIR'}
        return subprocess.run([sys.executable, str(ROOT/'scripts'/'compact.py')], capture_output=True, text=True, timeout=60, env=env)

    def test_temporary_copy_goes_to_the_data_folder_not_tmp(self):
        # Several MB in use: VACUUM's temporary database spills to a file.
        c = sqlite3.connect(self.path)
        try:
            c.executemany('INSERT INTO results(data) VALUES(?)', [(os.urandom(2000).hex(),) for _ in range(2000)]); c.commit()
        finally:
            c.close()
        other = self.folder/'tmp'; other.mkdir()
        env = {k: v for k, v in dict(os.environ, TMPDIR=str(other)).items() if k != 'SQLITE_TMPDIR'}
        # Control: a plain VACUUM creates (and removes) its file in TMPDIR, which changes the folder's mtime.
        before = other.stat().st_mtime_ns
        subprocess.run([sys.executable, '-c', 'import sqlite3,sys; sqlite3.connect(sys.argv[1]).execute("VACUUM")', str(self.path)], check=True, env=env, timeout=60)
        self.assertNotEqual(other.stat().st_mtime_ns, before)
        before = other.stat().st_mtime_ns
        finished = self.run_script(TMPDIR=str(other))
        self.assertEqual(finished.returncode, 0, finished.stderr)
        self.assertEqual(other.stat().st_mtime_ns, before)

    def test_refuses_without_twice_the_data_in_free_space(self):
        from scripts.compact import compact
        size = self.path.stat().st_size
        with patch('scripts.compact.shutil.disk_usage', return_value=SimpleNamespace(free=50*1024)) as usage:
            with self.assertRaisesRegex(ValueError, 'Espaço livre insuficiente .* Nada foi alterado'): compact(self.path)
        usage.assert_called_once_with(self.path.parent)
        self.assertEqual(self.path.stat().st_size, size)

    def test_refuses_while_another_connection_holds_the_database(self):
        from scripts.compact import compact
        holder = sqlite3.connect(self.path)
        try:
            holder.execute('SELECT COUNT(*) FROM results').fetchone()
            with self.assertRaisesRegex(ValueError, 'Banco em uso: pare a aplicação'): compact(self.path, timeout=.1)
            finished = self.run_script()
            self.assertEqual(finished.returncode, 1); self.assertIn('Banco em uso', finished.stderr); self.assertEqual(finished.stdout, '')
        finally:
            holder.close()
        finished = self.run_script()
        self.assertEqual(finished.returncode, 0, finished.stderr)
        self.assertIn('só detecta a aplicação enquanto ela mantém o banco aberto', finished.stderr)
        before, after = (float(re.search(label+r': ([\d,]+) MB', finished.stdout).group(1).replace(',', '.')) for label in ('Antes', 'Depois'))
        self.assertLess(after, before/10)
        with sqlite3.connect(self.path) as c:
            self.assertEqual(c.execute('PRAGMA journal_mode').fetchone()[0], 'wal')
            self.assertEqual(c.execute('SELECT COUNT(*) FROM results').fetchone()[0], 10)

    def test_missing_database_is_reported(self):
        from scripts.compact import compact
        with self.assertRaisesRegex(ValueError, 'Banco não encontrado'): compact(self.folder/'missing.sqlite3')


if __name__ == '__main__':
    unittest.main()
