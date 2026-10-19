"""Rota de controle: one fixed query every INTERVAL seconds that measures the fare source even with no trips.

It goes through Monitor.gated_fetch like any route (query gate, source.admit and observe), so it waits
for the breaker, counts towards it and never runs while the source is paused. Its source_queries rows
carry search_id ID: they count in the source totals and stay out of the per-trip lists.
"""
import json
import time
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException
from .airports import AIRPORTS
from .domain import Search, Leg
from .store import db

ID = 'canary'
INTERVAL = 1800
DAYS_AHEAD = 30
HISTORY = 12
KEY = 'health_canary'
DEFAULT = {'enabled': True, 'origin': 'GRU', 'destination': 'REC'}


def settings(c=None):
    if c is None:
        with db() as c:
            return settings(c)
    row = c.execute('SELECT value FROM metadata WHERE key=?', (KEY,)).fetchone()
    try:
        saved = json.loads(row[0]) if row else {}
    except ValueError:
        saved = {}
    return {**DEFAULT, **({key: saved[key] for key in DEFAULT if key in saved} if isinstance(saved, dict) else {})}


def save(enabled=None, origin=None, destination=None):
    """Validated changes; returns the settings before and after."""
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        before = settings(c)
        after = {'enabled': before['enabled'] if enabled is None else bool(enabled),
                 'origin': (origin or before['origin']).strip().upper(), 'destination': (destination or before['destination']).strip().upper()}
        if after['origin'] not in AIRPORTS or after['destination'] not in AIRPORTS:
            raise HTTPException(422, 'Escolha aeroportos com código IATA válido para a rota de controle')
        if after['origin'] == after['destination']:
            raise HTTPException(422, 'A rota de controle precisa de origem e destino diferentes')
        c.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)', (KEY, json.dumps(after, sort_keys=True)))
    return before, after


def query(config, now=None):
    """The canary as a search and its single job: one adult, economy, DAYS_AHEAD days after today (UTC)."""
    now = time.time() if now is None else now
    date = (datetime.fromtimestamp(now, timezone.utc)+timedelta(days=DAYS_AHEAD)).date().isoformat()
    search = Search(name='Rota de controle', origins=[config['origin']], destinations=[config['destination']],
                    outbound=Leg(start=date+'T00:00', end=date+'T23:59'))
    return search, ('outbound', config['origin'], config['destination'], date)


def due(now=None):
    """On, and INTERVAL seconds since the last canary that reached the source (skipped ones leave no row)."""
    now = time.time() if now is None else now
    with db() as c:
        if not settings(c)['enabled']:
            return False
        last = c.execute('SELECT MAX(at) FROM source_queries WHERE search_id=?', (ID,)).fetchone()[0]
    return last is None or now-last >= INTERVAL


def metrics(c, now):
    """The card's numbers for the configured route: last HISTORY results (oldest first), 24 h rate and mean latency."""
    config = settings(c)
    route = 'outbound|%s|%s|%%' % (config['origin'], config['destination'])
    rows = c.execute('SELECT at,status,kind,duration_ms FROM source_queries WHERE search_id=? AND route_key LIKE ? ORDER BY at DESC LIMIT ?',
                     (ID, route, HISTORY)).fetchall()
    day = c.execute("SELECT COUNT(*),SUM(status IN ('ok','empty')),AVG(duration_ms) FROM source_queries WHERE search_id=? AND route_key LIKE ? AND at>=?",
                    (ID, route, now-86400)).fetchone()
    history = [dict(r) for r in reversed(rows)]
    return {**config, 'last': history[-1] if history else None, 'history': history,
            'failed_streak': next((i for i, r in enumerate(rows) if r['status'] in ('ok', 'empty')), len(rows)),
            'day': {'total': day[0], 'success_rate': round(day[1]/day[0], 4) if day[0] else None, 'mean_ms': None if day[2] is None else round(day[2])},
            'next_at': rows[0]['at']+INTERVAL if rows and config['enabled'] else None}
