"""Fare-source health: a global breaker persisted in metadata and per-search backoff.

Rate limits, blocks and format changes affect every query, so N consecutive ones, coming
from at least two routes (origin-destination), pause all queries until retry_at; one test
query is then admitted (half-open). Its success, or a no_results answer (the source
responded), closes the breaker; any other failure reopens it one step up. Network, timeout,
server, no_results and unknown failures stay with their search as a longer cadence.

Every admission carries the breaker generation, which changes when the breaker opens and
when a test query is admitted. While the breaker is not closed, only the current test
query changes it: late results admitted earlier neither close nor reopen it.
"""
import json
import logging
import random
import sqlite3
import threading
import time
from collections import namedtuple
from .store import db

KEY = 'source_state'
GLOBAL_KINDS = ('rate_limited', 'blocked', 'format')
ROUTE_KINDS = ('network', 'timeout', 'server', 'no_results', 'unknown')
KINDS = GLOBAL_KINDS+ROUTE_KINDS
TRIP_AFTER = 3
# Distinct routes (origin-destination) among the failures that open the breaker: one route
# alone never pauses the others, even when several searches (e.g. other dates) query it.
TRIP_ROUTES = 2
STEPS = (300, 600, 1200, 2400, 3600)
JITTER = .2
PROBE_LEASE = 120
DEGRADED_SECONDS = 1800
BACKOFF_CAP = 12
LOCK = threading.Lock()
logger = logging.getLogger('radar.source')
# kind is 'closed' (normal query) or 'probe' (the single half-open test).
Admission = namedtuple('Admission', 'kind generation')


def initial():
    return {'state': 'closed', 'streak': 0, 'streak_routes': [], 'level': 0, 'consecutive_failures': 0, 'kind': None,
            'trip_kind': None, 'last_success_at': None, 'last_failure_at': None,
            'retry_at': None, 'probe_at': None, 'generation': 0}


def load(c):
    data = initial()
    row = c.execute('SELECT value FROM metadata WHERE key=?', (KEY,)).fetchone()
    try:
        saved = json.loads(row[0]) if row else {}
    except ValueError:
        saved = {}
    if isinstance(saved, dict):
        data.update({key: saved[key] for key in data if key in saved})
    return data


def save(c, data):
    c.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)', (KEY, json.dumps(data, sort_keys=True)))


def gate_of(data, now):
    """'closed' (normal), 'paused' (until retry_at), 'testing' (a probe is running) or 'probe' (one may start)."""
    if data['state'] == 'closed':
        return 'closed'
    if data['state'] == 'open' and now < (data['retry_at'] or 0):
        return 'paused'
    if data['probe_at'] and now-data['probe_at'] < PROBE_LEASE:
        return 'testing'
    return 'probe'


def gate(now=None):
    now = time.time() if now is None else now
    with db() as c:
        return gate_of(load(c), now)


def admit(now=None):
    """Admission of one query, 'closed' or 'probe' with the breaker generation, or None."""
    now = time.time() if now is None else now
    with LOCK, db() as c:
        c.execute('BEGIN IMMEDIATE')
        data = load(c)
        state = gate_of(data, now)
        if state != 'probe':
            return Admission('closed', data['generation']) if state == 'closed' else None
        data.update(state='half_open', probe_at=now, generation=data['generation']+1)
        save(c, data)
    logger.info('Consulta de teste liberada para a fonte de tarifas')
    return Admission('probe', data['generation'])


def current_probe(data, admission):
    return admission.kind == 'probe' and admission.generation == data['generation'] and data['state'] == 'half_open'


def release(admission):
    """Free a probe whose query never completed, so another one can test the source."""
    if not admission or admission.kind != 'probe':
        return
    with LOCK, db() as c:
        c.execute('BEGIN IMMEDIATE')
        data = load(c)
        # A probe admitted after this one's lease expired keeps its slot.
        if current_probe(data, admission):
            data['probe_at'] = None
            save(c, data)


def wait_seconds(level, rng=random):
    return STEPS[min(level, len(STEPS)-1)]*rng.uniform(1-JITTER, 1+JITTER)


def failure_kind(result):
    kind = result.get('kind')
    return kind if kind in KINDS else 'unknown'


def observe(result, admission, now=None, rng=random, route=None):
    """Record a completed source query of one route ("ORIGIN-DESTINATION") and return the updated state."""
    now = time.time() if now is None else now
    failed = result.get('status') == 'error'
    with LOCK, db() as c:
        c.execute('BEGIN IMMEDIATE')
        data = load(c)
        previous = data['state']
        probe = current_probe(data, admission)
        if not failed:
            # Only the current test query closes an open breaker; earlier admissions are stale.
            if data['state'] != 'closed' and not probe:
                return data
            data.update(state='closed', streak=0, streak_routes=[], level=0, consecutive_failures=0, kind=None, trip_kind=None,
                        last_success_at=now, retry_at=None, probe_at=None)
        else:
            kind = failure_kind(result)
            data.update(consecutive_failures=data['consecutive_failures']+1, kind=kind, last_failure_at=now)
            if probe and kind == 'no_results':
                # The source answered the test query; only this query had nothing usable.
                data.update(state='closed', streak=0, streak_routes=[], level=0, trip_kind=None, retry_at=None, probe_at=None)
            elif probe:
                level = min(data['level']+1, len(STEPS)-1)
                data.update(state='open', level=level, trip_kind=kind, retry_at=now+wait_seconds(level, rng), probe_at=None)
            elif data['state'] == 'closed' and kind in GLOBAL_KINDS:
                data['streak'] += 1
                if route is not None and route not in data['streak_routes'] and len(data['streak_routes']) < TRIP_ROUTES:
                    data['streak_routes'] = data['streak_routes']+[route]
                if data['streak'] >= TRIP_AFTER and len(data['streak_routes']) >= TRIP_ROUTES:
                    data.update(state='open', level=0, trip_kind=kind, retry_at=now+wait_seconds(0, rng), probe_at=None,
                                generation=data['generation']+1)
        save(c, data)
    if previous != 'open' and data['state'] == 'open':
        logger.warning('Consultas pausadas pela proteção da fonte', extra={'kind': data['trip_kind'], 'retry_at': round(data['retry_at'], 1)})
    elif previous != 'closed' and data['state'] == 'closed':
        logger.info('Consultas à fonte retomadas')
    return data


def describe(data, now=None):
    now = time.time() if now is None else now
    if data['state'] != 'closed':
        status = 'paused'
    elif data['consecutive_failures'] and data['last_failure_at'] and now-data['last_failure_at'] <= DEGRADED_SECONDS:
        status = 'degraded'
    else:
        status = 'ok'
    return {'status': status,
            'kind': (data['trip_kind'] or data['kind']) if status == 'paused' else data['kind'] if status == 'degraded' else None,
            'consecutive_failures': data['consecutive_failures'],
            'last_success_at': data['last_success_at'], 'last_failure_at': data['last_failure_at'],
            'retry_at': data['retry_at'] if status == 'paused' else None}


def public(timeout=15):
    """Source object for /api/state and /api/health; holds no account or query data."""
    try:
        with db(timeout) as c:
            data = load(c)
    except sqlite3.Error:
        return None
    return describe(data)


def backoff_factor(failures):
    """Cadence multiplier after consecutive route failures: 1, 2, 4, 8, then 12."""
    return min(2**(failures-1), BACKOFF_CAP) if failures > 0 else 1
