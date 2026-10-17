"""Persistent scheduling, versioned comparisons and a bounded SMTP outbox."""
import hashlib
import json
import logging
import math
import random
import signal
import subprocess
import sys
import threading
import time
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from .domain import Search, jobs, eligible, local_instant, monitoring_deadline, ADAPTER_VERSION as SOURCE_VERSION
from .store import db
from . import mail,whatsapp,source
from .notifications import sync_alerts,link
from .query_gate import QueryGate,Stopped
from .alert_messages import money

ROOT = Path(__file__).resolve().parents[1]
logger = logging.getLogger("radar.engine")
# Seconds without a loop iteration before /api/health reports the worker as stale.
HEARTBEAT_LIMITS = {"collector": 120, "email_sender": 300, "whatsapp_sender": 300}
COLLECTOR = (sys.executable, "-m", "backend.collector")
# Monitor.stop waits this long; with uvicorn's 10 s HTTP drain it fits compose's stop_grace_period (45 s).
STOP_TIMEOUT = 30
# End of that wait reserved for cycles to close after their queries are ended (at most half of it).
STOP_MARGIN = 5
# Signals a shutdown sends to the whole process group (terminal Ctrl+C, a supervisor's SIGTERM).
INTERRUPT_SIGNALS = (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)
# Collector subprocesses in flight (one Monitor per process), mapped to True once Monitor.stop ended them.
CHILDREN = {}
CHILDREN_LOCK = threading.Lock()
# A target still met, with no new low and no new crossing, is reminded at most once per this many seconds.
REMINDER_INTERVAL = 86400
# Seconds between two alerts of one direction.
MIN_GAP = 600


def recent(last_alerted, now):
    """Within MIN_GAP of the last alert; a clock set back never blocks."""
    return last_alerted is not None and 0 <= now-last_alerted < MIN_GAP


def make_event(search, flight, previous, last_floor=None, last_alerted=None, now=None, peak=None, gate=True):
    """Alert for this price, or None. last_floor and last_alerted are the price and time of the last alert.

    After a first alert, a new one needs a new low (last alert minus the minimum drop, also across
    several small drops) or a new crossing of the target: the previous price was above it, the price
    left it by the minimum drop or 2% of the target, whichever is larger (peak is the highest price
    since the last alert), and differs from the last alert. Otherwise a target still met is reminded once
    REMINDER_INTERVAL has passed. gate=False leaves the MIN_GAP check to the caller.
    """
    now = now or time.time()
    price = flight["price_cents"]
    goal, step = search.target_cents, search.min_drop_cents
    target = goal is not None and price <= goal
    drop = previous is not None and previous-price >= step
    low = last_floor is not None and last_floor-price >= step
    if not (target or drop or low):
        return None
    if gate and recent(last_alerted, now):
        return None
    margin = max(step, round(goal*0.02)) if goal is not None else 0
    if last_floor is None:
        reason = "first"
    elif low:
        reason = "new_low"
    elif target and previous is not None and previous > goal and price != last_floor and peak is not None and peak-goal >= margin:
        reason = "rearmed"
    elif target and now-(last_alerted or 0) >= REMINDER_INTERVAL:
        reason = "reminder"
    else:
        return None
    kind = "target" if target else "lower_price"
    title = "Ainda dentro da meta" if reason == "reminder" else "Meta atingida" if target else "Nova menor tarifa"
    return {"kind": kind, "reason": reason, "title": title, "target_cents": goal,
            "flight": flight, "previous": previous, "price_cents": price,
            "saving_cents": max(0, previous-price) if previous else None,
            "saving_percent": round(100*(previous-price)/previous) if previous and previous>price else None,
            "comparison": "Menor tarifa elegível da mesma janela e versão de filtros",
            "collected_at": flight["collected_at"], "source_version": SOURCE_VERSION}


def event_text(name, direction, event, language='pt'):
    from .alert_messages import render
    return render([(direction,event)],language,name=name)[0]


class QueryInterrupted(Exception):
    """The collector subprocess was ended by a shutdown signal or by Monitor.stop: the source never answered."""


def end_children():
    """End the collector subprocesses still running; their queries are skipped, not failed. Returns how many."""
    with CHILDREN_LOCK:
        running = [process for process in CHILDREN if process.poll() is None]
        for process in running:
            CHILDREN[process] = True
            process.kill()
    return len(running)


def run_collector(options):
    """Exit status and stdout of one collector subprocess; QueryInterrupted when a shutdown ended it."""
    # Started and registered at once: end_children never misses a running subprocess.
    with CHILDREN_LOCK:
        process = subprocess.Popen(list(COLLECTOR), cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True)
        CHILDREN[process] = False
    try:
        try:
            stdout, _ = process.communicate(json.dumps(options), timeout=35)
        except BaseException:
            process.kill(); process.communicate(); raise
    finally:
        with CHILDREN_LOCK:
            ended = CHILDREN.pop(process)
    # The group's signal can reach the subprocess before Monitor.stop runs: empty stdout, not an answer.
    if ended or -process.returncode in INTERRUPT_SIGNALS:
        raise QueryInterrupted(process.returncode)
    return process.returncode, stdout


def fetch(search, job):
    direction, origin, destination, date = job
    options = {"origin": origin, "destination": destination, "date": date,
               "adults": search.adults, "children": search.children, "infants_in_seat": search.infants_in_seat, "infants_on_lap": search.infants_on_lap, "cabin": search.cabin, "checked_bags": search.checked_bags, "currency": search.currency,"language":search.language}
    started = time.monotonic()
    try:
        returncode, stdout = run_collector(options)
        result = json.loads(stdout)
        if returncode and result.get("status") != "error":
            raise ValueError("Consulta não concluída")
    except QueryInterrupted:
        raise
    except subprocess.TimeoutExpired:
        result = {"status": "error", "error": "A consulta excedeu 35 segundos", "kind": "timeout", "flights": []}
    except Exception:
        result = {"status": "error", "error": "Não foi possível processar a resposta da fonte", "kind": "unknown", "flights": []}
    if result.get("status") == "error":
        result["kind"] = source.failure_kind(result)
    result.update({"origin": origin, "destination": destination, "date": date,
                   "direction": direction, "collected_at": time.time(),
                   "elapsed_seconds": round(time.monotonic()-started, 2)})
    for flight in result.get("flights", []):
        flight["collected_at"] = result["collected_at"]
        flight["direction"] = direction
    return result


# The fields that change what one direction compares, named one by one: a field added later
# (display, channels) never starts every trip's alerts over.
RULE_FIELDS = ("origins", "destinations", "adults", "children", "infants_in_seat", "infants_on_lap", "cabin", "currency",
               "checked_bags", "target_cents", "min_drop_cents")
LEG_FIELDS = ("start", "end", "arrival_before", "stops", "max_duration", "max_layover", "airlines")


def alert_rule(search, direction):
    """Fingerprint of what one direction's alerts compare: the source version, RULE_FIELDS and the
    direction's LEG_FIELDS, lists in sorted order. An edit outside them (name, language, channels)
    keeps the alert state; any other one, or a new source version, starts it over."""
    fields = lambda source, names: {name: sorted(value) if isinstance(value, list) else value
                                    for name in names for value in [getattr(source, name)]}
    key = {**fields(search, RULE_FIELDS), "leg": fields(getattr(search, direction), LEG_FIELDS)}
    return hashlib.sha256(json.dumps([SOURCE_VERSION, direction, key], sort_keys=True).encode()).hexdigest()


def persist_snapshots(c, sid, version, cid, search, results):
    from .accounts import alert_recipients,search_is_quiet
    recipients = alert_recipients(c,sid)
    quiet=search_is_quiet(c,sid)
    generated = []
    for direction, leg in (("outbound", search.outbound), ("inbound", search.inbound)):
        if leg is None:
            continue
        part = [r for r in results if r["direction"] == direction]
        # A skipped route (source paused, or search changed meanwhile) leaves the direction incomplete.
        complete = bool(part) and all(r["status"] not in ("error", "skipped") for r in part)
        options = [f for r in part if r["status"] not in ("error", "skipped") for f in r.get("flights", []) if eligible(f, leg) and local_instant(f["departure"],f["origin"]).timestamp()>time.time()]
        best = min(options, key=lambda f:f["price_cents"], default=None)
        rule = alert_rule(search, direction)
        c.execute("INSERT INTO snapshots(search_id,version,cycle_id,direction,collected,complete,price,flight,count) VALUES(?,?,?,?,?,?,?,?,?)",
                  (sid, version, cid, direction, time.time(), int(complete), best["price_cents"] if best else None,
                   json.dumps(best) if best else None, len(options)))
        if not complete or best is None:
            continue
        base = c.execute("SELECT * FROM baselines WHERE search_id=? AND version=? AND direction=?", (sid,version,direction)).fetchone()
        floor, alerted = (base["alert_floor"], base["alerted"]) if base else (None, None)
        if base is None:
            # A new name or channel (new version, same rule) keeps the alert state; any other edit or a
            # new source version starts it over. The price is never carried over.
            older = c.execute("SELECT alert_floor,alerted,rule FROM baselines WHERE search_id=? AND direction=? AND version<? ORDER BY version DESC LIMIT 1",
                              (sid,direction,version)).fetchone()
            if older and older["rule"] == rule:
                floor, alerted = older["alert_floor"], older["alerted"]
        now = time.time()
        # Highest price of this version since the last alert, on the whole snapshots_search_time index.
        peak = c.execute("SELECT MAX(price) FROM snapshots WHERE search_id=? AND version=? AND direction=? AND collected>? AND complete=1",
                         (sid,version,direction,alerted)).fetchone()[0] if alerted is not None and search.target_cents is not None else None
        candidate = make_event(search, best, base["price"] if base else None, floor, alerted, now, peak, gate=False)
        held = candidate is not None and recent(alerted, now)
        event = None if held else candidate
        status = None
        if event:
            status = ("quiet" if quiet else "queued") if search.notify_whatsapp else "in_app" if not search.notify_email else "waiting_contact" if not recipients else "quiet" if quiet else "queued" if mail.available() else "waiting_smtp"
            # Quiet hours hold any alert, unrecorded and with its reference price kept: the rule runs
            # again in the first cycle after them, so a price that went back up sends nothing.
            if status == "quiet":
                event, held = None, True
        if event:
            aid = uuid.uuid4().hex
            cursor = c.execute("INSERT OR IGNORE INTO alerts(id,search_id,version,cycle_id,direction,created,kind,price,previous,payload,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                               (aid,sid,version,cid,direction,time.time(),event["kind"],event["price_cents"],event["previous"],json.dumps(event),status))
            if cursor.rowcount:
                generated.append((aid, direction, event, status))
                floor, alerted = best["price_cents"], time.time()
        # A held alert keeps the price it compares with, so its drop or crossing still counts next cycle.
        price, flight = (base["price"], base["flight"]) if held and base else (best["price_cents"], json.dumps(best))
        c.execute("INSERT OR REPLACE INTO baselines(search_id,version,direction,price,flight,alert_floor,alerted,rule) VALUES(?,?,?,?,?,?,?,?)",
                  (sid,version,direction,price,flight,floor,alerted,rule))
    queue = [(a,d,e) for a,d,e,s in generated if s not in ('in_app','quiet')]
    if queue:
        owner=c.execute("SELECT a.language,a.timezone FROM accounts a JOIN searches s ON s.owner_id=a.id WHERE s.id=?",(sid,)).fetchone()
        language,zone=(owner["language"],owner["timezone"]) if owner else ("pt","UTC")
        from . import offer_links, alert_messages
        events=[(d,e) for a,d,e in queue]
        links={i:offer_links.create(c,a,e['flight'].get('search_url','')) for i,(a,d,e) in enumerate(queue)}
        trip=dict(name=search.name,page=offer_links.trip_page(sid),zone=zone)
        body,body_html=alert_messages.render(events,language,links=links,**trip)
        ids=[a for a,d,e in queue];subject=f"Radar de Voos · {search.name}"
        if search.notify_email:
            ready=bool(recipients and mail.available())
            if search.notify_email:
                oid=uuid.uuid4().hex
                c.execute("INSERT INTO outbox(id,search_id,version,created,alert_ids,subject,body,status,next_due,recipients,error) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (oid,sid,version,time.time(),json.dumps(ids),subject,body,'pending' if ready else 'waiting_contact' if not recipients else 'waiting_service',time.time(),json.dumps(recipients),None if ready else 'Sem destinatário cadastrado' if not recipients else 'Serviço de envio indisponível'))
                link(c,oid,ids)
                c.execute('UPDATE outbox SET body_html=? WHERE id=?',(body_html,oid))
        if search.notify_whatsapp:
            whatsapp_body,_=alert_messages.render(events,language,channel='whatsapp',links=links,**trip)
            whatsapp.enqueue(c,sid,version,ids,subject,whatsapp_body)
        sync_alerts(c,ids)


def next_collection_due(start, end, interval, failures=0, rng=random):
    """Next start on the saved cadence, stretched after repeated failed cycles.

    With n consecutive cycles without any successful query (see Monitor.run_cycle), the
    step is interval*min(2**(n-1), 12) with +/-20% jitter, never below the interval.
    Without such cycles (n=0, reset by any successful query) the cadence is kept.
    """
    step = interval
    if failures > 0:
        step = max(interval, interval*source.backoff_factor(failures)*rng.uniform(1-source.JITTER, 1+source.JITTER))
    return start + (math.floor((end-start)/step)+1)*step


def dominant_kind(kinds):
    """Most frequent failure kind of a cycle; ties follow source.KINDS order."""
    counts = Counter(kinds)
    return min(counts, key=lambda kind: (-counts[kind], source.KINDS.index(kind) if kind in source.KINDS else len(source.KINDS))) if counts else None


class Monitor:
    def __init__(self):
        self.stop_event = threading.Event()
        self.query_gate=QueryGate()
        self.worker = threading.Thread(target=self.loop, daemon=True, name="radar-collector")
        self.sender = threading.Thread(target=self.send_loop, daemon=True, name="radar-smtp")
        self.whatsapp_sender=threading.Thread(target=self.whatsapp_loop,daemon=True,name="radar-whatsapp")
        self.threads = {"collector": self.worker, "email_sender": self.sender, "whatsapp_sender": self.whatsapp_sender}
        self.heartbeats = {}

    def start(self):
        now = time.monotonic()
        for name in self.threads:
            self.heartbeats[name] = now
        self.worker.start()
        self.sender.start()
        self.whatsapp_sender.start()

    def stop(self, timeout=STOP_TIMEOUT):
        """Stop the workers, waiting up to timeout seconds; True when all of them ended in time.

        Queries not yet sent are skipped. Those in flight may answer until STOP_MARGIN seconds
        (at most half the wait) before the deadline; then their subprocesses are ended and they
        are skipped as well, not failed, so their cycles close. A send in progress finishes or,
        past the deadline, stays 'sending' and becomes 'uncertain' at the next start.
        """
        self.stop_event.set()
        deadline = time.monotonic()+timeout
        if self.worker.is_alive():
            self.worker.join(max(0, deadline-min(STOP_MARGIN, timeout/2)-time.monotonic()))
            if self.worker.is_alive():
                ended = end_children()
                if ended:
                    logger.info("Consultas em andamento encerradas", extra={"queries": ended})
        for thread in self.threads.values():
            if thread.is_alive():
                thread.join(max(0, deadline-time.monotonic()))
        pending = [name for name, thread in self.threads.items() if thread.is_alive()]
        if pending:
            logger.warning("Prazo de encerramento esgotado", extra={"workers": pending})
        return not pending

    def beat(self, name):
        self.heartbeats[name] = time.monotonic()

    def status(self, now=None):
        """Liveness and seconds since the last loop iteration of each worker."""
        now = time.monotonic() if now is None else now
        return {name: {"alive": thread.is_alive(), "age": max(0.0, now-self.heartbeats[name]) if name in self.heartbeats else None,
                       "limit": HEARTBEAT_LIMITS[name]} for name, thread in self.threads.items()}

    def cycle_error(self,row):
        with db() as c:
            c.execute("UPDATE searches SET state='error',error='Falha interna de coleta; nova tentativa agendada',next_due=? WHERE id=? AND version=? AND active=1",(time.time()+300,row['id'],row['version']))
            c.execute("UPDATE cycles SET status='error',finished=? WHERE search_id=? AND status='running'",(time.time(),row['id']))

    def loop(self):
        running={}
        maintenance_due=0
        with ThreadPoolExecutor(max_workers=2,thread_name_prefix='radar-cycle') as pool:
            while not self.stop_event.is_set():
                self.beat("collector")
                if time.monotonic()>=maintenance_due:
                    try:
                        from .retention import cleanup
                        cleanup()
                        from .deliveries import cleanup as delivery_cleanup
                        delivery_cleanup()
                        from .audit import cleanup as audit_cleanup
                        audit_cleanup()
                    except Exception:logger.exception('Falha na manutenção de retenção')
                    maintenance_due=time.monotonic()+3600
                for future,row in list(running.items()):
                    if future.done():
                        del running[future]
                        try:future.result()
                        except Exception:
                            logger.exception('Falha inesperada na coleta',extra={'search_id':row['id']})
                            if not self.stop_event.is_set():self.cycle_error(row)
                owners={row['owner_id'] or row['id'] for row in running.values()}
                try:
                    # While the source breaker is open nothing starts; when it may be tested, one cycle at a time.
                    limit={'closed':2,'probe':1}.get(source.gate(),0)
                    if len(running)<limit:
                        with db() as c:due=c.execute("SELECT * FROM searches WHERE active=1 AND archived=0 AND next_due<=? ORDER BY next_due,id",(time.time(),)).fetchall()
                        for item in due:
                            row=dict(item);owner=row['owner_id'] or row['id']
                            if owner in owners:continue
                            running[pool.submit(self.run_cycle,row)]=row;owners.add(owner)
                            if len(running)>=limit:break
                except Exception:logger.exception('Falha no agendador de coletas')
                self.stop_event.wait(.25)
        # Cycles that ended while stopping: log failures only, the next start recovers their state.
        for future,row in running.items():
            try:future.result()
            except Exception:logger.exception('Falha inesperada na coleta',extra={'search_id':row['id']})

    def skipped(self,job):
        return {'status':'skipped','flights':[],'direction':job[0],'origin':job[1],'destination':job[2],'date':job[3],'collected_at':time.time()}

    def gated_fetch(self,search,job,row):
        # Nothing starts while stopping. Do not wait for a gate slot while the source is paused; during a probe, wait for its result.
        if self.stop_event.is_set() or source.gate()=='paused':return self.skipped(job)
        try:
            with self.query_gate.slot(row.get('owner_id') or row['id'],self.stop_event):
                with db() as c:current=c.execute('SELECT active,archived,version FROM searches WHERE id=?',(row['id'],)).fetchone()
                # Paused, archived or edited meanwhile: the route was not queried, so it is skipped (no result row).
                if not current or not current['active'] or current['archived'] or current['version']!=row['version']:
                    return self.skipped(job)
                # Stopping: skipped before admission, so no breaker test query is taken.
                if self.stop_event.is_set():return self.skipped(job)
                admission=source.admit()
                if admission is None:return self.skipped(job)
                # admit() can wait for the breaker's locks: a stop requested meanwhile frees the admission unused.
                if self.stop_event.is_set():
                    source.release(admission);return self.skipped(job)
                try:result=fetch(search,job)
                except QueryInterrupted:
                    # Ended by a shutdown, maybe before Monitor.stop: no answer, so neither a failure nor a backoff.
                    source.release(admission);logger.info('Consulta à fonte interrompida',extra={'search_id':row['id']})
                    return self.skipped(job)
                except BaseException:
                    source.release(admission);raise
                source.observe(result,admission,route=job[1]+'-'+job[2])
                if result.get('status')=='error':
                    logger.warning('Consulta à fonte falhou',extra={'search_id':row['id'],'kind':result.get('kind')})
                return result
        except Stopped:return self.skipped(job)

    def run_cycle(self, row):
        search = Search.model_validate_json(row["config"])
        sid, version = row["id"], row["version"]
        if monitoring_deadline(search) <= time.time():
            with db() as c:
                c.execute("UPDATE searches SET active=0,archived=1,state='expired',next_due=NULL WHERE id=? AND version=?", (sid,version))
            return
        start = time.time()
        tasks = [j for j in jobs(search) if local_instant(min((search.outbound if j[0]=='outbound' else search.inbound).end,j[3]+"T23:59:59"),j[1]).timestamp() > start]
        if not tasks:
            return
        with db() as c:
            current = c.execute("SELECT version,active,archived FROM searches WHERE id=?", (sid,)).fetchone()
            if not current or current["version"] != version or not current["active"] or current["archived"]:
                return
            # Stopping before any query: nothing is recorded, the next start runs this cycle on time.
            if self.stop_event.is_set():
                return
            cid = c.execute("INSERT INTO cycles(search_id,version,started,status,total) VALUES(?,?,?,?,?)", (sid,version,start,"running",len(tasks))).lastrowid
            c.execute("UPDATE searches SET state='collecting',last_started=?,progress=0,total=?,error=NULL,error_kind=NULL WHERE id=?", (start,len(tasks),sid))
        results = []
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(self.gated_fetch,search,job,row) for job in tasks]
            for future in as_completed(futures):
                result = future.result()
                results.append(result)
                key = "|".join([result[k] for k in ("direction","origin","destination","date")])
                with db() as c:
                    if not c.execute("SELECT 1 FROM searches WHERE id=?",(sid,)).fetchone():
                        return
                    # Skipped routes were never queried: no result row, the previous one stays current.
                    if result["status"] != "skipped":
                        c.execute("INSERT INTO results(cycle_id,search_id,version,direction,route_key,collected,status,data) VALUES(?,?,?,?,?,?,?,?)",
                                  (cid,sid,version,result["direction"],key,result["collected_at"],result["status"],json.dumps(result)))
                    c.execute("UPDATE searches SET progress=? WHERE id=? AND version=?", (len(results),sid,version))
        performed = [r for r in results if r["status"] != "skipped"]
        skipped = len(results)-len(performed)
        successes = sum(r["status"] != "error" for r in performed)
        failures = len(performed)-successes
        kinds = [r.get("kind") or "unknown" for r in performed if r["status"] == "error"]
        # Route kinds always count for this search; source-wide kinds only while the breaker
        # stays closed (a single route never opens it), otherwise the pause covers them.
        breaker_closed = source.gate() == "closed"
        counted = sum(kind in source.ROUTE_KINDS or (breaker_closed and kind in source.GLOBAL_KINDS) for kind in kinds)
        state = "scheduled" if not failures else "partial" if successes else "error"
        end = time.time()
        with db() as c:
            c.execute("UPDATE cycles SET finished=?,status=?,successes=?,failures=? WHERE id=?", (end,"interrupted" if skipped else state,successes,failures,cid))
            current = c.execute("SELECT * FROM searches WHERE id=?", (sid,)).fetchone()
            if not current or current["version"] != version:
                return
            if not current["active"] or current["archived"]:
                c.execute("UPDATE searches SET state=CASE WHEN archived=1 THEN state ELSE 'paused' END,last_finished=? WHERE id=?", (end,sid))
                return
            # Any successful query keeps the normal cadence; only cycles without one back off.
            failed_count = 0 if successes else current["failures"]+1 if counted else current["failures"]
            due = min(next_collection_due(start, end, search.interval, failed_count), monitoring_deadline(search))
            c.execute("UPDATE searches SET state=?,last_finished=?,last_success=CASE WHEN ?=0 THEN ? ELSE last_success END,next_due=?,failures=?,error=?,error_kind=? WHERE id=?",
                      (state,end,int(bool(failures or skipped)),end,due,failed_count,f"{failures} consulta(s) falharam" if failures else None,dominant_kind(kinds),sid))
            persist_snapshots(c,sid,version,cid,search,results)
        logger.info("Coleta concluída",extra={"search_id":sid,"cycle_id":cid,"successes":successes,"failures":failures,"skipped":skipped,"kind":dominant_kind(kinds),"next_in":max(0,int(due-end))})

    def send_loop(self):
        while not self.stop_event.is_set():
            self.beat("email_sender")
            try:
                self.send_one()
            except Exception:
                logger.exception("Falha inesperada na fila de e-mail")
            self.stop_event.wait(2)

    def whatsapp_loop(self):
        while not self.stop_event.is_set():
            self.beat("whatsapp_sender")
            try:whatsapp.send_one(self.stop_event)
            except Exception:logger.exception('Falha inesperada na fila WhatsApp')
            self.stop_event.wait(2)

    def send_one(self):
        config = mail.delivery_settings()
        with db() as c:
            # Claim atomically so deletion cannot race with an unclaimed send.
            c.execute("BEGIN IMMEDIATE")
            # Stop requested while waiting for the write lock: nothing new is claimed.
            if self.stop_event.is_set():
                return
            row = c.execute("SELECT * FROM outbox WHERE channel='email' AND status='pending' AND next_due<=? ORDER BY created LIMIT 1", (time.time(),)).fetchone()
            if not row:
                return
            row = dict(row)
            if row["search_id"]:
                search = c.execute("SELECT active,archived,version FROM searches WHERE id=?", (row["search_id"],)).fetchone()
                if not search["active"] or search["archived"] or search["version"] != row["version"]:
                    c.execute("UPDATE outbox SET status='cancelled' WHERE id=?", (row["id"],))
                    sync_alerts(c,json.loads(row['alert_ids']))
                    return
            # A delayed old fare should not be sent as a current opportunity. A message held by quiet
            # hours counts from their end (next_due); its text says when the price was seen.
            if time.time()-max(row["created"], row["next_due"] or 0) > 1800:
                c.execute("UPDATE outbox SET status='expired' WHERE id=?", (row["id"],))
                sync_alerts(c,json.loads(row['alert_ids']))
                return
            if row["search_id"]:
                from .accounts import search_quiet_until
                # Quiet hours hold the message, still pending, until they end; the expiry above still applies then.
                until = search_quiet_until(c,row['search_id'])
                if until:
                    c.execute("UPDATE outbox SET next_due=? WHERE id=?",(until,row['id']))
                    return
            # Configuration problems are terminal blocks, not transport attempts.
            blocked = 'waiting_service' if not config['enabled'] else 'waiting_contact' if row['search_id'] and not json.loads(row['recipients'] or '[]') else None
            if blocked:
                c.execute('UPDATE outbox SET status=?,error=? WHERE id=?',(blocked,'Serviço de envio indisponível' if blocked=='waiting_service' else 'Sem destinatário cadastrado',row['id']))
                sync_alerts(c,json.loads(row['alert_ids']))
                return
            c.execute("UPDATE outbox SET status='sending',attempts=attempts+1,provider=? WHERE id=?", (config.get('provider','smtp'),row["id"]))
        try:
            if row["search_id"]:
                recipients = json.loads(row["recipients"] or "[]")
                if not recipients:
                    raise ValueError("Busca sem destinatários cadastrados")
                config = {**config, "recipient": recipients}
            elif row.get("recipients"):
                config = {**config,"recipient":json.loads(row["recipients"])}
            mail.transmit({**config,"body_html":row.get("body_html")},row["id"],row["subject"],row["body"])
            status,error = "sent",None
        except Exception as exc:
            status,error = "failed",mail.safe_error(exc)
            # Transport errors can echo addresses: log only identifiers and the error type.
            logger.warning("Envio de e-mail não confirmado",extra={"outbox_id":row["id"],"search_id":row["search_id"],"kind":type(exc).__name__})
        with db() as c:
            # No blind SMTP retries after an ambiguous transport failure.
            c.execute("UPDATE outbox SET status=?,error=?,sent=? WHERE id=?", (status,error,time.time() if status=="sent" else None,row["id"]))
            sync_alerts(c,json.loads(row['alert_ids']))
