"""Bound raw-response growth while preserving price, alert and fallback history."""
import logging
import os
import sqlite3
import time
from . import result_cache, store
from .store import db

logger = logging.getLogger('radar.retention')
# Per hourly run, in write transactions of at most BATCH rows each. At ~6 k responses a day,
# DELETE_LIMIT drains a cut from 30 to 7 days (~140 k rows) in about 14 runs, and
# COMPRESS_LIMIT rewrites ~50 k legacy text rows in about 10 runs.
DELETE_LIMIT = 10000
COMPRESS_LIMIT = 5000
BATCH = 500
# Between write transactions, so requests and the collector waiting for the lock get it.
PAUSE = 0.05
CURSOR = 'raw_compression_cursor'
# Expired raw responses. Kept: the latest attempt AND latest valid response of every
# route/version, and responses a newer filter version reuses (filter_result_refs).
EXPIRED = '''SELECT id FROM results WHERE collected<?
  AND id NOT IN (SELECT MAX(id) FROM results GROUP BY search_id,version,route_key)
  AND id NOT IN (SELECT MAX(id) FROM results WHERE status!='error' GROUP BY search_id,version,route_key)
  AND NOT EXISTS(SELECT 1 FROM filter_result_refs f WHERE f.result_id=results.id)'''


def days():
    value=int(os.environ.get('RADAR_RAW_RETENTION_DAYS','30'))
    if not 7<=value<=3650:raise ValueError('RADAR_RAW_RETENTION_DAYS deve estar entre 7 e 3650')
    return value


def delete_batches(c,ids,statement,batch,stop=None):
    removed=0
    for start in range(0,len(ids),batch):
        if stop and stop():break
        chunk=ids[start:start+batch]
        c.execute('BEGIN IMMEDIATE')
        removed+=c.execute(statement.format(','.join('?'*len(chunk))),chunk).rowcount
        c.commit()
        time.sleep(PAUSE)
    return removed


def compress_legacy(c,limit=COMPRESS_LIMIT,batch=BATCH,stop=None):
    """Rewrite rows stored as JSON text before compression, newest first: rows about to expire
    come last. The cursor in metadata holds the lowest id examined; 0 once the oldest row is done."""
    row=c.execute('SELECT value FROM metadata WHERE key=?',(CURSOR,)).fetchone()
    # Rows written after the first run are compressed already.
    below=int(row[0]) if row else c.execute('SELECT COALESCE(MAX(id),0)+1 FROM results').fetchone()[0]
    done=0
    while below and done<limit and not (stop and stop()):
        size=min(batch,limit-done)
        rows=c.execute("SELECT id,data FROM results WHERE id<? AND typeof(data)='text' ORDER BY id DESC LIMIT ?",(below,size)).fetchall()
        # Compressed before taking the write lock.
        packed=[(result_cache.encode(r['data']),r['id']) for r in rows]
        below=rows[-1]['id'] if len(rows)==size else 0
        c.execute('BEGIN IMMEDIATE')
        c.executemany("UPDATE results SET data=? WHERE id=? AND typeof(data)='text'",packed)
        c.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)',(CURSOR,str(below)))
        c.commit()
        done+=len(rows)
        time.sleep(PAUSE)
    return done


def cleanup(now=None,limit=DELETE_LIMIT,compress=COMPRESS_LIMIT,batch=BATCH,stop=None):
    """stop: checked before each write transaction (the collector's shutdown); the rest waits for the next run."""
    now=time.time() if now is None else now
    cutoff=now-days()*86400
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        last=c.execute("SELECT value FROM metadata WHERE key='raw_retention_last_run'").fetchone()
        if last and now-float(last[0])<3600:return {'results':0,'cycles':0,'compressed':0}
        # Claimed before the batches, which commit one by one.
        c.execute("INSERT OR REPLACE INTO metadata VALUES('raw_retention_last_run',?)",(str(now),))
        c.execute('DELETE FROM offer_links WHERE token IN (SELECT token FROM offer_links WHERE expires<? LIMIT ?)',(now,limit))
        c.commit()
        # Selected outside the write lock: a row that is not the latest stays so, since newer rows
        # only add up. A reference added meanwhile is checked again under the lock.
        ids=[r[0] for r in c.execute(EXPIRED+' ORDER BY id LIMIT ?',(cutoff,limit))]
        removed=delete_batches(c,ids,'''DELETE FROM results WHERE id IN ({})
          AND NOT EXISTS(SELECT 1 FROM filter_result_refs f WHERE f.result_id=results.id)''',batch,stop)
        ids=[r[0] for r in c.execute('''SELECT c.id FROM cycles c WHERE c.started<? AND c.status!='running'
          AND NOT EXISTS(SELECT 1 FROM results r WHERE r.cycle_id=c.id)
          AND NOT EXISTS(SELECT 1 FROM snapshots s WHERE s.cycle_id=c.id)
          AND NOT EXISTS(SELECT 1 FROM alerts a WHERE a.cycle_id=c.id)
          AND c.id NOT IN (SELECT id FROM cycles kept WHERE kept.search_id=c.search_id ORDER BY id DESC LIMIT 30)
          ORDER BY c.id LIMIT ?''',(cutoff,limit))]
        # References are checked again under the lock.
        cycles=delete_batches(c,ids,'''DELETE FROM cycles WHERE id IN ({})
          AND NOT EXISTS(SELECT 1 FROM results r WHERE r.cycle_id=cycles.id)
          AND NOT EXISTS(SELECT 1 FROM snapshots s WHERE s.cycle_id=cycles.id)
          AND NOT EXISTS(SELECT 1 FROM alerts a WHERE a.cycle_id=cycles.id)''',batch,stop)
        compressed=compress_legacy(c,compress,batch,stop)
    summary={'results':removed,'cycles':cycles,'compressed':compressed}
    if any(summary.values()):logger.info('Retenção de respostas brutas aplicada',extra=summary)
    return summary


def progress(now=None):
    """What the hourly cleanup still has to do, read-only: 0, 0 and cursor 0 once drained."""
    now=time.time() if now is None else now
    connection=sqlite3.connect((store.DATA_DIR/'radar.sqlite3').as_uri()+'?mode=ro',uri=True)
    try:
        cursor=connection.execute('SELECT value FROM metadata WHERE key=?',(CURSOR,)).fetchone()
        return {'expired':connection.execute('SELECT COUNT(*) FROM ('+EXPIRED+')',(now-days()*86400,)).fetchone()[0],
                'text':connection.execute("SELECT COUNT(*) FROM results WHERE typeof(data)='text'").fetchone()[0],
                'cursor':int(cursor[0]) if cursor else None}
    finally:
        connection.close()
