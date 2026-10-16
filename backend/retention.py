"""Bound raw-response growth while preserving price, alert and fallback history."""
import os
import time
from .store import db


def days():
    value=int(os.environ.get('RADAR_RAW_RETENTION_DAYS','30'))
    if not 7<=value<=3650:raise ValueError('RADAR_RAW_RETENTION_DAYS deve estar entre 7 e 3650')
    return value


def cleanup(now=None,limit=2000):
    now=time.time() if now is None else now
    cutoff=now-days()*86400
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        last=c.execute("SELECT value FROM metadata WHERE key='raw_retention_last_run'").fetchone()
        if last and now-float(last[0])<3600:return {'results':0,'cycles':0}
        c.execute('DELETE FROM offer_links WHERE token IN (SELECT token FROM offer_links WHERE expires<? LIMIT ?)',(now,limit))
        # Keep the latest attempt AND latest valid response of every route/version.
        removed=c.execute('''DELETE FROM results WHERE id IN (
          SELECT id FROM results WHERE collected<?
          AND id NOT IN (SELECT MAX(id) FROM results GROUP BY search_id,version,route_key)
          AND id NOT IN (SELECT MAX(id) FROM results WHERE status!='error' GROUP BY search_id,version,route_key)
          ORDER BY id LIMIT ?)''',(cutoff,limit)).rowcount
        cycles=c.execute('''DELETE FROM cycles WHERE id IN (
          SELECT c.id FROM cycles c WHERE c.started<? AND c.status!='running'
          AND NOT EXISTS(SELECT 1 FROM results r WHERE r.cycle_id=c.id)
          AND NOT EXISTS(SELECT 1 FROM snapshots s WHERE s.cycle_id=c.id)
          AND NOT EXISTS(SELECT 1 FROM alerts a WHERE a.cycle_id=c.id)
          AND c.id NOT IN (SELECT id FROM cycles kept WHERE kept.search_id=c.search_id ORDER BY id DESC LIMIT 30)
          ORDER BY c.id LIMIT ?)''',(cutoff,limit)).rowcount
        c.execute("INSERT OR REPLACE INTO metadata VALUES('raw_retention_last_run',?)",(str(now),))
    return {'results':removed,'cycles':cycles}
