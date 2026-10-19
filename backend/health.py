"""Operational health for the administration: source queries, trips, queue, workers and one overall level.

Every query that reached the fare source leaves a source_queries row (engine.Monitor.gated_fetch);
skipped queries leave none. collect() reads the database once; the other functions are pure.
"""
import json
import logging
import math
import time
from collections import Counter, defaultdict
from . import canary, source, store
from .domain import Search, pending_jobs
from .store import db

logger = logging.getLogger('radar.health')
QUERY_DAYS = 7
STATUSES = ('ok', 'empty', 'error', 'blocked')
# Failure kinds recorded as 'blocked': the source refused the query instead of failing on it.
BLOCK_KINDS = ('rate_limited', 'blocked')
# A trip answered by the source within this many seconds is up to date (two collection cycles).
FRESH_SECONDS = 600
TOP = 5
# assess() thresholds.
PAUSE_CRITICAL = 900  # seconds the source has been paused
ERROR_RATE_WARNING = .3  # share of errors and blocks among the last hour's queries...
ERROR_RATE_MIN_QUERIES = 10  # ...once that hour has this many
QUEUE_DELAY_WARNING = 900  # seconds the most overdue trip has been waiting
STALE_TRIP_WARNING = 3600  # seconds an active trip has gone without a source answer
CHANNEL_FAILURES = 3  # latest sends of a configured channel, all failed within the last hour
CANARY_FAILURES = 3  # latest canary queries, all failed
CAPACITY_WARNING = .8  # share of the source throughput the active trips need
# Capacity: seconds of a collection cycle (Search.interval) and the queries per cycle of a trip like the
# common one-way one (one route, a seven-date window), used to count the trips that fit when there is none.
CYCLE_SECONDS = 300
TYPICAL_QUERIES = 7
# Every reason code of assess() with its level, in reading order.
LEVELS = {'source_paused': 'critical', 'collector_late': 'critical', 'whatsapp_late': 'critical', 'email_late': 'critical',
          'error_rate': 'warning', 'queue_delay': 'warning', 'stale_trip': 'warning', 'whatsapp_failing': 'warning', 'email_failing': 'warning',
          'source_canary': 'warning', 'capacity_high': 'warning'}
# The worker behind each heartbeat code.
WORKERS = {'collector_late': 'collector', 'whatsapp_late': 'whatsapp_sender', 'email_late': 'email_sender'}


def query_status(result):
    if result.get('status') in ('ok', 'empty'):
        return result['status']
    return 'blocked' if source.failure_kind(result) in BLOCK_KINDS else 'error'


def record(row, job, result, duration_ms, now=None):
    """Store one completed source query of a search row; a failure is logged, never raised."""
    try:
        status = query_status(result)
        with db(timeout=5) as c:
            c.execute('INSERT INTO source_queries(at,search_id,route_key,status,kind,duration_ms) VALUES(?,?,?,?,?,?)',
                      (time.time() if now is None else now, row['id'], '|'.join(job), status,
                       None if status in ('ok', 'empty') else source.failure_kind(result), max(0, round(duration_ms))))
    except Exception:
        logger.warning('Falha ao registrar consulta à fonte', exc_info=True, extra={'search_id': row.get('id')})


def cleanup(now=None):
    """Source queries past QUERY_DAYS, incidents resolved 90 days ago and orphaned notice links; returns the queries removed."""
    from . import incidents
    now = time.time() if now is None else now
    with db() as c:
        removed = c.execute('DELETE FROM source_queries WHERE at<?', (now-QUERY_DAYS*86400,)).rowcount
        incidents.cleanup(c, now)
    return removed


def percentile(values, fraction):
    """Nearest rank: the smallest value with at least `fraction` of the values at or below it; None when empty."""
    ordered = sorted(values)
    return ordered[max(0, math.ceil(fraction*len(ordered))-1)] if ordered else None


def first_hour(now, hours=24):
    """Start of the oldest of `hours` clock-hour buckets; the last bucket is the current, partial hour."""
    return (int(now)//3600-hours+1)*3600


def summarize(counts, p50=None, p95=None):
    total = sum(counts.get(status, 0) for status in STATUSES)
    return {'total': total, **{status: counts.get(status, 0) for status in STATUSES},
            'success_rate': round((counts.get('ok', 0)+counts.get('empty', 0))/total, 4) if total else None, 'p50_ms': p50, 'p95_ms': p95}


def series(counts, medians, start, hours=24):
    """Hourly buckets from start, oldest first, from counts[(index, status)] and medians[index]."""
    return [{'hour_start': start+index*3600, **{status: counts.get((index, status), 0) for status in STATUSES},
             'p50_ms': medians.get(index)} for index in range(hours)]


def percentiles(rows, start, now, hours=24):
    """Median and p95 of the last hour and of the window, and each hour's median, from (at, duration_ms) pairs."""
    hour, day, buckets = [], [], defaultdict(list)
    for at, duration in rows:
        day.append(duration)
        if at >= now-3600:
            hour.append(duration)
        buckets[int((at-start)//3600)].append(duration)
    return {'hour': (percentile(hour, .5), percentile(hour, .95)), 'day': (percentile(day, .5), percentile(day, .95)),
            'buckets': {index: percentile(values, .5) for index, values in buckets.items() if 0 <= index < hours}}


def trip(row):
    """Name, route and owner of a search row (the owner leads the administration to it)."""
    config = json.loads(row['config'])
    origins, destinations = '/'.join(config.get('origins') or []), '/'.join(config.get('destinations') or [])
    return {'id': row['id'], 'title': config.get('name') or None, 'owner_id': row['owner_id'],
            'route': origins+(' ↔ ' if config.get('inbound') else ' → ')+destinations}


def routes(rows, top=TOP):
    """Slowest (median) and most failing routes, a route being one search's direction, origin, destination and date.

    rows are (at, search_id, route_key, status, kind, duration_ms); each item names its search_id."""
    groups = defaultdict(list)
    for row in rows:
        # The canary is not a trip's route.
        if row[1] != canary.ID:
            groups[(row[1], row[2])].append(row)
    items = []
    for (sid, key), part in groups.items():
        direction, origin, destination, date = (key.split('|')+['']*4)[:4]
        durations = [row[5] for row in part]
        failed = [row for row in part if row[3] in ('error', 'blocked')]
        items.append({'search_id': sid, 'route_key': key, 'direction': direction, 'origin': origin, 'destination': destination, 'date': date,
                      'queries': len(part), 'p50_ms': percentile(durations, .5), 'p95_ms': percentile(durations, .95),
                      'failures': len(failed), 'blocked': sum(row[3] == 'blocked' for row in failed),
                      'kind': Counter(row[4] for row in failed).most_common(1)[0][0] if failed else None,
                      'last_failure_at': max((row[0] for row in failed), default=None)})
    slow = sorted(items, key=lambda i: (-i['p50_ms'], -i['p95_ms'], -i['queries'], i['route_key']))[:top]
    failing = sorted((i for i in items if i['failures']), key=lambda i: (-i['failures'], -i['failures']/i['queries'], i['route_key']))[:top]
    return slow, failing


# Percentiles and routes need every duration of the window: computed at most once per CACHE_SECONDS
# for a database and window, whoever asks (the page polling, the watcher). Counts are not cached.
CACHE_SECONDS = 15
CACHE = {}


def durations(c, start, now):
    global CACHE
    key, cached = (str(store.DATA_DIR), start), CACHE
    if cached.get('key') == key and 0 <= now-cached['at'] < CACHE_SECONDS:
        return cached
    cursor = c.cursor()
    cursor.row_factory = None
    rows = cursor.execute('SELECT at,search_id,route_key,status,kind,duration_ms FROM source_queries WHERE at>=?', (start,)).fetchall()
    slow, failing = routes(rows)
    # A new dict swapped in whole: a reader on another thread never sees one half updated.
    CACHE = {'key': key, 'at': now, 'percentiles': percentiles([(row[0], row[5]) for row in rows], start, now), 'slow': slow, 'failing': failing}
    return CACHE


def workers(status):
    """Monitor.status() as /api/health reads it: alive, seconds since the last loop and the limit past which it is late."""
    return {name: {'alive': w['alive'], 'age_s': None if w['age'] is None else round(w['age'], 1), 'limit_s': w['limit'],
                   'late': not w['alive'] or w['age'] is None or w['age'] > w['limit']} for name, w in status.items()}


def assess(metrics):
    """Overall level and reason codes (LEVELS), critical ones first; the page and the notices word each code."""
    now, found = metrics['generated_at'], set()
    current = metrics.get('source') or {}
    if current.get('status') == 'paused' and current.get('paused_since') is not None and now-current['paused_since'] > PAUSE_CRITICAL:
        found.add('source_paused')
    for code, name in WORKERS.items():
        worker = (metrics.get('workers') or {}).get(name)
        if worker and worker['late']:
            found.add(code)
    hour = metrics['queries']['hour']
    if hour['total'] >= ERROR_RATE_MIN_QUERIES and (hour['error']+hour['blocked'])/hour['total'] > ERROR_RATE_WARNING:
        found.add('error_rate')
    if (metrics['queue']['max_delay_s'] or 0) > QUEUE_DELAY_WARNING:
        found.add('queue_delay')
    stalest = metrics['freshness']['stalest']
    if stalest and stalest['age_s'] > STALE_TRIP_WARNING:
        found.add('stale_trip')
    for name, channel in (metrics.get('channels') or {}).items():
        if channel['available'] and channel['failed_streak'] >= CHANNEL_FAILURES:
            found.add(name+'_failing')
    probe = metrics.get('canary')
    if probe and probe['enabled'] and probe['failed_streak'] >= CANARY_FAILURES:
        found.add('source_canary')
    used = (metrics.get('capacity') or {}).get('used')
    if used is not None and used > CAPACITY_WARNING:
        found.add('capacity_high')
    reasons = sorted(found, key=lambda code: (LEVELS[code] != 'critical', list(LEVELS).index(code)))
    return {'level': 'critical' if any(LEVELS[c] == 'critical' for c in reasons) else 'warning' if reasons else 'ok', 'reasons': reasons}


def details(code, metrics):
    """The numbers behind one reason code, for its incident and the notices."""
    now = metrics['generated_at']
    if code == 'source_paused':
        current = metrics['source']
        return {'paused_since': current['paused_since'], 'paused_s': round(now-current['paused_since']), 'kind': current['kind'], 'retry_at': current['retry_at']}
    if code in WORKERS:
        worker = metrics['workers'][WORKERS[code]]
        return {'alive': worker['alive'], 'age_s': worker['age_s'], 'limit_s': worker['limit_s']}
    if code == 'error_rate':
        hour = metrics['queries']['hour']
        return {'total': hour['total'], 'failed': hour['error']+hour['blocked'], 'rate': round((hour['error']+hour['blocked'])/hour['total'], 4)}
    if code == 'queue_delay':
        return dict(metrics['queue'])
    if code == 'stale_trip':
        stalest = metrics['freshness']['stalest']
        return {key: stalest[key] for key in ('id', 'title', 'route', 'owner_id', 'age_s')}
    if code == 'source_canary':
        probe = metrics['canary']
        return {'failed_streak': probe['failed_streak'], 'origin': probe['origin'], 'destination': probe['destination'],
                'kind': (probe['last'] or {}).get('kind'), 'last_at': (probe['last'] or {}).get('at')}
    if code == 'capacity_high':
        return {key: metrics['capacity'][key] for key in ('used', 'more_trips', 'trips', 'queries_per_cycle', 'throughput_per_cycle')}
    channel = metrics['channels'][code.split('_')[0]]
    return {'failed_streak': channel['failed_streak'], 'last_failure_at': channel['last_failure_at']}


def capacity(queries, p50_ms, interval=CYCLE_SECONDS, parallel=2, min_gap=5.0, typical=TYPICAL_QUERIES):
    """How much of the source throughput the active trips need, and about how many more trips fit.

    queries holds the queries per cycle of each active trip (domain.pending_jobs). Per cycle of `interval`
    seconds the trips need Σ queries; the source answers `parallel` queries at once at the median latency,
    and the query gate starts at most one query every `min_gap` seconds, so it serves
    min(parallel / p50, 1 / min_gap) × interval queries per cycle. used is the first over the second;
    more_trips counts trips like the average active one (or `typical` queries with none) in what is left.
    Both are None with no latency measured."""
    need = sum(queries)
    item = {'trips': len(queries), 'queries_per_cycle': need, 'interval_s': interval, 'parallel': parallel, 'min_gap_s': min_gap, 'p50_ms': p50_ms}
    if not p50_ms:
        return {**item, 'throughput_per_cycle': None, 'used': None, 'more_trips': None, 'limit': None}
    by_latency, by_gap = parallel/(p50_ms/1000)*interval, interval/min_gap
    served = min(by_latency, by_gap)
    per_trip = need/len(queries) if queries else typical
    return {**item, 'throughput_per_cycle': round(served, 1), 'used': round(need/served, 4),
            'more_trips': max(0, math.floor((served-need)/per_trip+1e-9)) if per_trip else None, 'limit': 'gap' if by_gap <= by_latency else 'latency'}


def channel_health(c, channel, available, now):
    """Consecutive failed sends among the channel's latest attempts of the last hour (newest first)."""
    rows = c.execute("SELECT status,completed FROM outbox WHERE channel=? AND status IN ('sent','failed','uncertain') AND completed>=? ORDER BY completed DESC,id DESC LIMIT 10",
                     (channel, now-3600)).fetchall()
    streak = next((index for index, row in enumerate(rows) if row['status'] == 'sent'), len(rows))
    return {'available': available, 'failed_streak': streak, 'last_failure_at': rows[0]['completed'] if streak else None}


def collect(worker_status, now=None):
    """Every metric of /api/admin/health from one read of the database, with its status.

    The 24 h window is the chart's: the clock hour 23 hours back up to now (first_hour)."""
    now = time.time() if now is None else now
    start, week = first_hour(now), now-7*86400
    with db() as c:
        c.execute('BEGIN')
        counts = c.execute('''SELECT SUM(active=1 AND archived=0),SUM(active=0 AND archived=0),SUM(archived=1),
          COUNT(DISTINCT CASE WHEN active=1 AND archived=0 THEN owner_id END) FROM searches''').fetchone()
        day = dict(c.execute('SELECT status,COUNT(*) FROM source_queries WHERE at>=? GROUP BY status', (start,)).fetchall())
        hour = dict(c.execute('SELECT status,COUNT(*) FROM source_queries WHERE at>=? GROUP BY status', (now-3600,)).fetchall())
        hourly = {(r[0], r[1]): r[2] for r in c.execute('SELECT CAST((at-?)/3600 AS INTEGER),status,COUNT(*) FROM source_queries WHERE at>=? GROUP BY 1,2', (start, start))}
        timing = durations(c, start, now)
        cycles = c.execute('SELECT COUNT(*),AVG(finished-started) FROM cycles WHERE started>=? AND finished IS NOT NULL', (now-86400,)).fetchone()
        # The last answer (ok or empty) of each active trip, on the source_queries_search index. Results
        # and snapshots are read for the last 7 days only: an old version may hold many of them.
        active = c.execute('''SELECT s.id,s.config,s.owner_id,s.version,s.created,s.last_success,
          MAX(COALESCE((SELECT MAX(at) FROM source_queries WHERE search_id=s.id AND status='ok'),0),
              COALESCE((SELECT MAX(at) FROM source_queries WHERE search_id=s.id AND status='empty'),0)) answered,
          EXISTS(SELECT 1 FROM results r WHERE r.search_id=s.id AND r.version=s.version AND r.collected>=? AND r.status!='error') collected,
          EXISTS(SELECT 1 FROM snapshots p WHERE p.search_id=s.id AND p.version=s.version AND p.collected>=? AND p.complete=1 AND p.price IS NOT NULL) priced
          FROM searches s WHERE s.active=1 AND s.archived=0''', (week, week)).fetchall()
        # A running cycle keeps its old next_due until it ends: it is not waiting. next_due 0 means "now".
        queue = c.execute('''SELECT COUNT(*),MAX(CASE WHEN next_due>0 THEN ?-next_due END) FROM searches
          WHERE active=1 AND archived=0 AND state!='collecting' AND next_due IS NOT NULL AND next_due<=?''', (now, now)).fetchone()
        missing = sorted({item['search_id'] for item in timing['slow']+timing['failing']} - {r['id'] for r in active} - {None})
        others = c.execute('SELECT id,config,owner_id FROM searches WHERE id IN (%s)' % ','.join('?'*len(missing)), missing).fetchall() if missing else []
        empty = [(r, c.execute('SELECT COUNT(DISTINCT cycle_id),MIN(collected) FROM snapshots WHERE search_id=? AND version=? AND collected>=?', (r['id'], r['version'], week)).fetchone())
                 for r in active if r['collected'] and not r['priced']]
        state = source.load(c)
        probe = canary.metrics(c, now)
        from . import mail, whatsapp
        channels = {'whatsapp': channel_health(c, 'whatsapp', whatsapp.available(), now), 'email': channel_health(c, 'email', mail.available(), now)}
    trips = {r['id']: trip(r) for r in list(active)+list(others)}
    stale = []
    for r in active:
        last = max(r['answered'] or 0, r['last_success'] or 0) or None
        stale.append((now-(last or r['created']), last, r['id']))
    oldest = max(stale, key=lambda item: item[0], default=None)
    current = source.describe(state, now)
    current['paused_since'] = (state['opened_at'] or state['last_failure_at']) if current['status'] == 'paused' else None
    queries = []
    for r in active:
        try:
            queries.append(len(pending_jobs(Search.model_validate_json(r['config']), now)))
        except (ValueError, KeyError):
            # A saved trip the current rules no longer read (an airport left the catalog): outside the estimate.
            continue
    from .engine import CYCLE_LIMIT
    from .query_gate import CONCURRENCY, MIN_GAP
    linked = lambda items: [{**{k: v for k, v in item.items() if k != 'search_id'}, 'trip': trips.get(item['search_id'])} for item in items]
    timed = timing['percentiles']
    metrics = {
        'generated_at': now,
        'trips': {'active': counts[0] or 0, 'paused': counts[1] or 0, 'ended': counts[2] or 0, 'accounts': counts[3]},
        'queries': {'hour': summarize(hour, *timed['hour']), 'day': summarize(day, *timed['day'])},
        'series': series(hourly, timed['buckets'], start),
        'cycles': {'count': cycles[0], 'avg_s': None if cycles[1] is None else round(cycles[1], 1)},
        'freshness': {'active': len(active), 'fresh': sum(last is not None and age <= FRESH_SECONDS for age, last, _ in stale),
                      'stalest': {**trips[oldest[2]], 'age_s': round(oldest[0]), 'last_at': oldest[1]} if oldest else None},
        'queue': {'due': queue[0], 'max_delay_s': None if queue[1] is None else round(queue[1], 1)},
        'source': current,
        'workers': workers(worker_status),
        'channels': channels,
        'canary': probe,
        'capacity': capacity(queries, timed['day'][0], parallel=min(CYCLE_LIMIT, CONCURRENCY), min_gap=MIN_GAP),
        'slow_routes': linked(timing['slow']),
        'failing_routes': linked(timing['failing']),
        'empty_trips': sorted(({**trips[r['id']], 'cycles': info[0], 'since': info[1]} for r, info in empty),
                              key=lambda item: (-item['cycles'], item['title'] or '', item['id'])),
    }
    metrics['status'] = assess(metrics)
    return metrics
