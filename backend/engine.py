"""Persistent scheduling, versioned comparisons and a bounded SMTP outbox."""
import json
import math
import subprocess
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from .domain import Search, jobs, eligible, local_instant, monitoring_deadline, ADAPTER_VERSION as SOURCE_VERSION
from .store import db
from . import mail,whatsapp
from .notifications import sync_alerts,link
from .query_gate import QueryGate
from .alert_messages import money

ROOT = Path(__file__).resolve().parents[1]


def make_event(search, flight, previous, last_floor=None, last_alerted=None, now=None):
    now = now or time.time()
    price = flight["price_cents"]
    target = search.target_cents is not None and price <= search.target_cents
    drop = previous is not None and previous-price >= search.min_drop_cents
    if not target and not drop:
        return None
    # Avoid resending an equal/worse opportunity during the quiet interval.
    if last_floor is not None and price >= last_floor and now-(last_alerted or 0) < 7200:
        return None
    if last_alerted and now-last_alerted < 600:
        return None
    kind = "target" if target else "lower_price"
    return {"kind": kind, "title": "Meta atingida" if target else "Nova menor tarifa",
            "flight": flight, "previous": previous, "price_cents": price,
            "saving_cents": max(0, previous-price) if previous else None,
            "saving_percent": round(100*(previous-price)/previous) if previous and previous>price else None,
            "comparison": "Menor tarifa elegível da mesma janela e versão de filtros",
            "collected_at": flight["collected_at"], "source_version": SOURCE_VERSION}


def event_text(name, direction, event, language='pt'):
    from .alert_messages import render
    return render([(direction,event)],language)[0]


def fetch(search, job):
    direction, origin, destination, date = job
    options = {"origin": origin, "destination": destination, "date": date,
               "adults": search.adults, "children": search.children, "infants_in_seat": search.infants_in_seat, "infants_on_lap": search.infants_on_lap, "cabin": search.cabin, "checked_bags": search.checked_bags, "currency": search.currency,"language":search.language}
    started = time.monotonic()
    try:
        process = subprocess.run([sys.executable, "-m", "backend.collector"], cwd=ROOT,
                                 input=json.dumps(options), capture_output=True, text=True, timeout=35)
        result = json.loads(process.stdout)
        if process.returncode and result.get("status") != "error":
            raise ValueError("Consulta não concluída")
    except subprocess.TimeoutExpired:
        result = {"status": "error", "error": "A consulta excedeu 35 segundos", "flights": []}
    except Exception:
        result = {"status": "error", "error": "Não foi possível processar a resposta da fonte", "flights": []}
    result.update({"origin": origin, "destination": destination, "date": date,
                   "direction": direction, "collected_at": time.time(),
                   "elapsed_seconds": round(time.monotonic()-started, 2)})
    for flight in result.get("flights", []):
        flight["collected_at"] = result["collected_at"]
        flight["direction"] = direction
    return result


def persist_snapshots(c, sid, version, cid, search, results):
    from .accounts import alert_recipients,search_is_quiet
    recipients = alert_recipients(c,sid)
    quiet=search_is_quiet(c,sid)
    generated = []
    for direction, leg in (("outbound", search.outbound), ("inbound", search.inbound)):
        if leg is None:
            continue
        part = [r for r in results if r["direction"] == direction]
        complete = bool(part) and all(r["status"] != "error" for r in part)
        options = [f for r in part if r["status"] != "error" for f in r.get("flights", []) if eligible(f, leg) and local_instant(f["departure"],f["origin"]).timestamp()>time.time()]
        best = min(options, key=lambda f:f["price_cents"], default=None)
        c.execute("INSERT INTO snapshots(search_id,version,cycle_id,direction,collected,complete,price,flight,count) VALUES(?,?,?,?,?,?,?,?,?)",
                  (sid, version, cid, direction, time.time(), int(complete), best["price_cents"] if best else None,
                   json.dumps(best) if best else None, len(options)))
        if not complete or best is None:
            continue
        previous = c.execute("SELECT * FROM baselines WHERE search_id=? AND version=? AND direction=?", (sid,version,direction)).fetchone()
        event = make_event(search, best, previous["price"] if previous else None,
                           previous["alert_floor"] if previous else None, previous["alerted"] if previous else None)
        floor = previous["alert_floor"] if previous else None
        alerted = previous["alerted"] if previous else None
        if event:
            aid = uuid.uuid4().hex
            status = ("quiet" if quiet else "queued") if search.notify_whatsapp else "in_app" if not search.notify_email else "waiting_contact" if not recipients else "quiet" if quiet else "queued" if mail.available() else "waiting_smtp"
            cursor = c.execute("INSERT OR IGNORE INTO alerts(id,search_id,version,cycle_id,direction,created,kind,price,previous,payload,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                               (aid,sid,version,cid,direction,time.time(),event["kind"],event["price_cents"],event["previous"],json.dumps(event),status))
            if cursor.rowcount:
                generated.append((aid, direction, event, status))
                floor, alerted = best["price_cents"], time.time()
        c.execute("INSERT OR REPLACE INTO baselines VALUES(?,?,?,?,?,?,?)",
                  (sid,version,direction,best["price_cents"],json.dumps(best),floor,alerted))
    queue = [(a,d,e) for a,d,e,s in generated if s not in ('in_app','quiet')]
    if queue:
        language_row=c.execute("SELECT a.language FROM accounts a JOIN searches s ON s.owner_id=a.id WHERE s.id=?",(sid,)).fetchone()
        language=language_row[0] if language_row else "pt"
        from . import offer_links, alert_messages
        events=[(d,e) for a,d,e in queue]
        links={i:offer_links.create(c,a,e['flight'].get('search_url','')) for i,(a,d,e) in enumerate(queue)}
        body,body_html=alert_messages.render(events,language,links=links)
        ids=[a for a,d,e in queue];subject=f"Radar de Voos · {search.name}"
        if search.notify_email:
            ready=bool(recipients and mail.available())
            if ready or search.notify_whatsapp:
                oid=uuid.uuid4().hex
                c.execute("INSERT INTO outbox(id,search_id,version,created,alert_ids,subject,body,status,next_due,recipients,error) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (oid,sid,version,time.time(),json.dumps(ids),subject,body,'pending' if ready else 'failed',time.time(),json.dumps(recipients),None if ready else 'E-mail sem destinatários ou serviço indisponível'))
                link(c,oid,ids)
                c.execute('UPDATE outbox SET body_html=? WHERE id=?',(body_html,oid))
        if search.notify_whatsapp:
            whatsapp_body,_=alert_messages.render(events,language,channel='whatsapp',links=links)
            whatsapp.enqueue(c,sid,version,ids,subject,whatsapp_body)
        sync_alerts(c,ids)


def next_collection_due(start, end, interval):
    """Keep the saved cadence, without exponential delays after route failures."""
    return start + (math.floor((end-start)/interval)+1)*interval


class Monitor:
    def __init__(self):
        self.stop_event = threading.Event()
        self.query_gate=QueryGate()
        self.worker = threading.Thread(target=self.loop, daemon=True, name="radar-collector")
        self.sender = threading.Thread(target=self.send_loop, daemon=True, name="radar-smtp")
        self.whatsapp_sender=threading.Thread(target=self.whatsapp_loop,daemon=True,name="radar-whatsapp")

    def start(self):
        self.worker.start()
        self.sender.start()
        self.whatsapp_sender.start()

    def stop(self):
        self.stop_event.set()

    def cycle_error(self,row):
        with db() as c:
            c.execute("UPDATE searches SET state='error',error='Falha interna de coleta; nova tentativa agendada',next_due=? WHERE id=? AND version=? AND active=1",(time.time()+300,row['id'],row['version']))
            c.execute("UPDATE cycles SET status='error',finished=? WHERE search_id=? AND status='running'",(time.time(),row['id']))

    def loop(self):
        running={}
        maintenance_due=0
        with ThreadPoolExecutor(max_workers=2,thread_name_prefix='radar-cycle') as pool:
            while not self.stop_event.is_set():
                if time.monotonic()>=maintenance_due:
                    try:
                        from .retention import cleanup
                        cleanup()
                        from .deliveries import cleanup as delivery_cleanup
                        delivery_cleanup()
                        from .audit import cleanup as audit_cleanup
                        audit_cleanup()
                    except Exception as exc:print('Retenção: '+type(exc).__name__,flush=True)
                    maintenance_due=time.monotonic()+3600
                for future,row in list(running.items()):
                    if future.done():
                        del running[future]
                        try:future.result()
                        except Exception:
                            if not self.stop_event.is_set():self.cycle_error(row)
                owners={row['owner_id'] or row['id'] for row in running.values()}
                if len(running)<2:
                    try:
                        with db() as c:due=c.execute("SELECT * FROM searches WHERE active=1 AND archived=0 AND next_due<=? ORDER BY next_due,id",(time.time(),)).fetchall()
                        for source in due:
                            row=dict(source);owner=row['owner_id'] or row['id']
                            if owner in owners:continue
                            running[pool.submit(self.run_cycle,row)]=row;owners.add(owner)
                            if len(running)>=2:break
                    except Exception as exc:print('Scheduler: '+type(exc).__name__,flush=True)
                self.stop_event.wait(.25)

    def gated_fetch(self,search,job,row):
        with self.query_gate.slot(row.get('owner_id') or row['id'],self.stop_event):
            with db() as c:current=c.execute('SELECT active,archived,version FROM searches WHERE id=?',(row['id'],)).fetchone()
            if not current or not current['active'] or current['archived'] or current['version']!=row['version']:
                return {'status':'error','error':'Consulta cancelada','flights':[],'direction':job[0],'origin':job[1],'destination':job[2],'date':job[3],'collected_at':time.time()}
            return fetch(search,job)

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
            cid = c.execute("INSERT INTO cycles(search_id,version,started,status,total) VALUES(?,?,?,?,?)", (sid,version,start,"running",len(tasks))).lastrowid
            c.execute("UPDATE searches SET state='collecting',last_started=?,progress=0,total=?,error=NULL WHERE id=?", (start,len(tasks),sid))
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
                    c.execute("INSERT INTO results(cycle_id,search_id,version,direction,route_key,collected,status,data) VALUES(?,?,?,?,?,?,?,?)",
                              (cid,sid,version,result["direction"],key,result["collected_at"],result["status"],json.dumps(result)))
                    c.execute("UPDATE searches SET progress=? WHERE id=? AND version=?", (len(results),sid,version))
        successes = sum(r["status"] != "error" for r in results)
        failures = len(results)-successes
        state = "scheduled" if not failures else "partial" if successes else "error"
        end = time.time()
        with db() as c:
            c.execute("UPDATE cycles SET finished=?,status=?,successes=?,failures=? WHERE id=?", (end,state,successes,failures,cid))
            current = c.execute("SELECT * FROM searches WHERE id=?", (sid,)).fetchone()
            if not current or current["version"] != version:
                return
            if not current["active"] or current["archived"]:
                c.execute("UPDATE searches SET state=CASE WHEN archived=1 THEN state ELSE 'paused' END,last_finished=? WHERE id=?", (end,sid))
                return
            failed_count = current["failures"]+1 if failures else 0
            due = min(next_collection_due(start, end, search.interval), monitoring_deadline(search))
            c.execute("UPDATE searches SET state=?,last_finished=?,last_success=CASE WHEN ?=0 THEN ? ELSE last_success END,next_due=?,failures=?,error=? WHERE id=?",
                      (state,end,failures,end,due,failed_count,f"{failures} consulta(s) falharam" if failures else None,sid))
            persist_snapshots(c,sid,version,cid,search,results)
        print(f"Coleta {cid}: {successes}/{len(results)} consultas válidas; próxima em {max(0,int(due-end))}s", flush=True)

    def send_loop(self):
        while not self.stop_event.is_set():
            try:
                self.send_one()
            except Exception as exc:
                print(f"Fila de e-mail: {type(exc).__name__}", flush=True)
            self.stop_event.wait(2)

    def whatsapp_loop(self):
        while not self.stop_event.is_set():
            try:whatsapp.send_one()
            except Exception as exc:print('Fila WhatsApp: '+type(exc).__name__,flush=True)
            self.stop_event.wait(2)

    def send_one(self):
        config = mail.delivery_settings()
        if not config["enabled"]:
            return
        with db() as c:
            # Claim atomically so deletion cannot race with an unclaimed send.
            c.execute("BEGIN IMMEDIATE")
            row = c.execute("SELECT * FROM outbox WHERE channel='email' AND status='pending' AND next_due<=? ORDER BY created LIMIT 1", (time.time(),)).fetchone()
            if not row:
                return
            row = dict(row)
            if row["search_id"]:
                from .accounts import search_is_quiet
                if search_is_quiet(c,row['search_id']):
                    c.execute("UPDATE outbox SET status='quiet' WHERE id=?",(row['id'],))
                    sync_alerts(c,json.loads(row['alert_ids']))
                    return
                search = c.execute("SELECT active,archived,version FROM searches WHERE id=?", (row["search_id"],)).fetchone()
                if not search["active"] or search["archived"] or search["version"] != row["version"]:
                    c.execute("UPDATE outbox SET status='cancelled' WHERE id=?", (row["id"],))
                    sync_alerts(c,json.loads(row['alert_ids']))
                    return
            # A delayed old fare should not be sent as a current opportunity.
            if time.time()-row["created"] > 1800:
                c.execute("UPDATE outbox SET status='expired' WHERE id=?", (row["id"],))
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
        with db() as c:
            # No blind SMTP retries after an ambiguous transport failure.
            c.execute("UPDATE outbox SET status=?,error=?,sent=? WHERE id=?", (status,error,time.time() if status=="sent" else None,row["id"]))
            sync_alerts(c,json.loads(row['alert_ids']))
