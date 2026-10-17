"""HTTP API for flight monitoring and price alerts."""
import json
import os
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit
from typing import Literal
from fastapi import FastAPI, HTTPException, Request, Response, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from .airports import airport_record, search_airports
from .domain import Search, eligible, jobs, validate_future, monitoring_deadline, local_instant
from .store import db, setup, decode_search, add_search
from .engine import Monitor
from . import mail, accounts, google_mail, mail_discovery, audit, logos, recovery, revisions, retention, activity, airlines, deliveries, admin_accounts, whatsapp
from .network import allowed_client, allowed_host, public_mode, public_origin, public_request_allowed

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "frontend" / "dist"
TOKEN = secrets.token_urlsafe(32)
monitor = Monitor()


@asynccontextmanager
async def lifespan(app):
    if public_mode():public_origin()
    setup(seed=os.environ.get("RADAR_NO_SEED") != "1")
    retention.days()
    deliveries.days()
    monitor.start()
    yield
    monitor.stop()


app = FastAPI(title="Radar de Voos", version="0.24.1", lifespan=lifespan,
              docs_url=None, redoc_url=None)


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    # Pydantic normally echoes invalid inputs, including a whole SMTP object.
    return JSONResponse({"detail":[{"loc":e["loc"],"msg":e["msg"],"type":e["type"]} for e in exc.errors()]},status_code=422)


@app.middleware("http")
async def access_guard(request: Request, call_next):
    host = request.headers.get("host", "")
    try:hostname = urlsplit("http://"+host).hostname
    except ValueError:return JSONResponse({"detail":"Host inválido"},status_code=403)
    # TestClient has a symbolic peer; a real TCP connection always has an IP.
    test_client = hostname == "testserver" and request.client and request.client.host == "testclient"
    accepted = public_request_allowed(request) if public_mode() else bool(test_client or (allowed_host(hostname) and request.client and allowed_client(request.client.host)))
    if not accepted:
        return JSONResponse({"detail": "Acesso não autorizado."}, status_code=403)
    origin = request.headers.get("origin")
    origins = (public_origin(),) if public_mode() else ("http://"+host, "https://"+host)
    if origin and origin not in origins:
        return JSONResponse({"detail": "Origem não autorizada"}, status_code=403)
    if request.method in ("POST", "PUT", "DELETE", "PATCH"):
        if not secrets.compare_digest(request.headers.get("x-radar-token", ""), TOKEN):
            return JSONResponse({"detail": "Atualize a página e tente novamente."}, status_code=403)
        if int(request.headers.get("content-length", "0")) > 50000:
            return JSONResponse({"detail": "Requisição muito grande"}, status_code=413)
    response = await call_next(request)
    if public_mode() and request.url.scheme=="https":response.headers["Strict-Transport-Security"]="max-age=31536000"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    if request.url.path.startswith("/api/") and not (request.method == "GET" and request.url.path.startswith("/api/airline-logo/") and response.status_code == 200):
        response.headers["Cache-Control"] = "no-store"
    return response


def require_search(c, sid, owner_id, include_archived=False):
    row = c.execute("SELECT * FROM searches WHERE id=? AND owner_id=?"+("" if include_archived else " AND archived=0"), (sid,owner_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Busca não encontrada")
    return row


from . import result_cache


def recent_results(c, row, preview_pool=False):
    sid, version = row["id"], row["version"]
    config = Search.model_validate_json(row["config"])
    latest = result_cache.latest(c, row)
    valid = result_cache.latest(c, row, valid_only=True)
    fallback = {r["route_key"]:r for r in valid}
    flights, routes = [], []
    for result in latest:
        stale = result["status"] == "error"
        chosen = fallback.get(result["route_key"]) if stale else result
        data = json.loads(chosen["data"]) if chosen else json.loads(result["data"])
        error = json.loads(result["data"]).get("error") if stale else None
        leg = config.outbound if result["direction"] == "outbound" else config.inbound
        available = [dict(f, stale=stale, collected_at=f.get("collected_at",chosen["collected"] if chosen else result["collected"])) for f in data.get("flights", []) if leg and local_instant(f["departure"],f["origin"]).timestamp()>time.time()]
        filtered = [f for f in available if eligible(f,leg)]
        flights += available if preview_pool else filtered
        routes.append({"key": result["route_key"], "origin": data["origin"], "destination": data["destination"],
                       "date": data["date"], "direction": result["direction"], "status": result["status"],
                       "last_attempt": result["collected"], "last_valid": chosen["collected"] if chosen else None,
                       "count": len(filtered), "raw_count": len(data.get("flights", [])),
                       "stale": stale, "error": error, "latency": data.get("elapsed_seconds")})
    return sorted(flights,key=lambda f:f["price_cents"]), routes


@app.get("/api/airline-logo/{code}")
def airline_logo(request:Request,code:str):
    accounts.current_user(request)
    path=logos.airline_logo(code.upper())
    if not path:raise HTTPException(404,'Logo indisponível')
    return FileResponse(path,media_type='image/png',headers={'Cache-Control':'private,max-age=86400'})


@app.get('/go/{token}')
def open_offer(request: Request, token: str):
    from . import offer_links
    with db() as c:target=offer_links.resolve(c,token)
    if not target:
        import html
        from .i18n import translate
        language=request.headers.get('accept-language','pt').split(',')[0].split('-')[0]
        if language not in ('pt','en','es'):language='en'
        title=html.escape(translate('Link indisponível',language))
        message=html.escape(translate('Este link expirou ou não está mais disponível.',language))
        back=html.escape(translate('Voltar ao radar',language))
        document=f'<!doctype html><html lang="{language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title></head><body style="background:#f3f6f9;color:#243044;font:18px/1.6 system-ui;padding:24px"><main style="max-width:520px;margin:40px auto"><h1>{title}</h1><p>{message}</p><a style="color:#315a82" href="/">{back}</a></main></body></html>'
        return HTMLResponse(document,status_code=404,headers={'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"})
    return RedirectResponse(target,status_code=302,headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'})


@app.get("/api/health")
def health():
    return {"ok": True, "version": app.version, "collector_alive": monitor.worker.is_alive(),"whatsapp_sender_alive":monitor.whatsapp_sender.is_alive()}


@app.get("/api/airports")
def airports(q: str = ""):
    return search_airports(q[:120])


@app.get('/api/airlines')
def airline_catalog(request:Request,q:str=Query(default='',max_length=120),codes:str=Query(default='',max_length=100)):
    accounts.current_user(request)
    if codes:
        values=list(dict.fromkeys(code.strip().upper() for code in codes.split(',')))[:20]
        return [record for code in values if (record:=airlines.airline_record(code))]
    return airlines.search_airlines(q)


@app.get("/api/state")
def state(request: Request, search_id: str | None = None, preview_pool: bool = False, detail: bool = True,
          scope: Literal['legacy','home','searches','history','alerts','settings','admin']='legacy', since: str | None = None):
    user = accounts.current_user(request)
    administrative=user['role']=='admin' and scope in ('legacy','admin')
    smtp=mail.public_settings() if administrative else None
    google=google_mail.public_settings() if administrative else None
    recipient=mail.test_recipient() if administrative else None
    available=mail.available()
    whatsapp_available=whatsapp.available()
    with db() as c:
        revision=revisions.token(c,user['id'],TOKEN,[search_id,preview_pool,detail,scope,available,whatsapp_available,smtp,google,recipient])
        if since==revision:return {'unchanged':True,'revision':revision,'server_time':time.time()}
        searches = [decode_search(r) for r in c.execute("SELECT * FROM searches WHERE archived=0 AND owner_id=? ORDER BY created",(user["id"],)).fetchall()]
        archived = [decode_search(r) for r in c.execute("SELECT * FROM searches WHERE archived=1 AND owner_id=? ORDER BY created DESC",(user["id"],)).fetchall()]
        if search_id and scope in ('legacy','searches','history') and not any(r['id']==search_id for r in searches+archived):
            raise HTTPException(404,'Monitoramento não encontrado.')
        chosen = next((r for r in searches+archived if r["id"] == search_id), next(iter(searches+archived if scope=="history" else searches), None)) if scope in ('legacy','searches','history') else None
        if scope=='home':
            for item in searches:
                quotes=c.execute("SELECT direction,price,collected FROM snapshots WHERE id IN (SELECT MAX(id) FROM snapshots WHERE search_id=? AND version=? AND complete=1 AND price IS NOT NULL GROUP BY direction)",(item['id'],item['version'])).fetchall()
                item['summary']={r['direction']:{'price':r['price'],'collected':r['collected']} for r in quotes}
                if not quotes and c.execute('SELECT 1 FROM filter_result_refs WHERE search_id=? AND version=? LIMIT 1',(item['id'],item['version'])).fetchone():
                    row=c.execute('SELECT * FROM searches WHERE id=?',(item['id'],)).fetchone()
                    options,_=recent_results(c,row)
                    for flight in options:
                        direction=flight['direction']
                        if direction not in item['summary']:
                            item['summary'][direction]={'price':flight['price_cents'],'collected':flight['collected_at']}
        alert_total=c.execute('SELECT COUNT(*) FROM alerts WHERE search_id IN (SELECT id FROM searches WHERE owner_id=?)',(user['id'],)).fetchone()[0]
        flights,routes,history,alerts,cycles = [],[],[],[],[]
        if chosen:
            row = c.execute("SELECT * FROM searches WHERE id=?", (chosen["id"],)).fetchone()
            flights,routes = recent_results(c,row,preview_pool)
            if detail:
                history = [dict(r) for r in c.execute("WITH valid AS (SELECT id,version,cycle_id,direction,collected,complete,price,count,COALESCE(json_extract(flight,'$.currency'),'BRL') AS currency,LAG(price) OVER(PARTITION BY version,direction ORDER BY collected,id) AS previous_price FROM snapshots WHERE search_id=? AND complete=1 AND price IS NOT NULL) SELECT * FROM valid WHERE previous_price IS NULL OR previous_price<>price ORDER BY collected DESC,id DESC LIMIT 160", (chosen["id"],))]
            alerts = [dict(r) for r in c.execute("SELECT * FROM alerts WHERE search_id=? ORDER BY created DESC LIMIT 100", (chosen["id"],))]
            from .notifications import channel_summaries
            channels=channel_summaries(c,user['id'],[event['id'] for event in alerts])
            for event in alerts:
                event['channels']=channels.get(event['id'],[])
                event["payload"] = json.loads(event["payload"])
            if detail:cycles = [dict(r) for r in c.execute("SELECT * FROM cycles WHERE search_id=? ORDER BY id DESC LIMIT 30", (chosen["id"],))]
        deliveries = [dict(r) for r in c.execute("SELECT id,created,status,attempts,error,sent,subject,recipients FROM outbox WHERE search_id IN (SELECT id FROM searches WHERE owner_id=?) OR (search_id IS NULL AND ?='admin') ORDER BY created DESC LIMIT 30",(user["id"],user["role"]))] if scope=="legacy" else []
    for item in searches+archived:
        item["ends_at"] = monitoring_deadline(Search.model_validate(item["config"]))
    for delivery in deliveries:
        delivery["recipients"] = json.loads(delivery["recipients"] or "[]")
    return {"quote_expires":min((local_instant(f["departure"],f["origin"]).timestamp() for f in flights),default=None),"revision":revision,"alert_total":alert_total,"raw_retention_days":retention.days(),"mail_provider":mail.delivery_settings()["provider"] if user["role"]=="admin" else None,"token": TOKEN, "server_time": time.time(), "searches": searches, "archived": archived, "selected": chosen,
            "flights": flights, "routes": routes, "history": history, "alerts": alerts, "cycles": cycles,
            "user": user, "smtp": smtp, "email_available": available, "whatsapp_available":whatsapp_available, "google_mail": google, "mail_test_recipient": recipient, "deliveries": deliveries,
            "airports": [airport_record(code) for code in sorted({code for item in searches + archived for key in ("origins", "destinations") for code in item["config"][key]})]}


@app.get('/api/activity')
def activity_history(request:Request,mode:Literal['notifications','changes']='notifications',search_id:str|None=None,
                     page:int=Query(default=0,ge=0,le=100000),status:Literal['all','sent','pending','failed']='all'):
    user=accounts.current_user(request)
    return activity.feed(user['id'],mode,search_id,page,status)


@app.post("/api/searches")
def create_search(request: Request, config: Search):
    user = accounts.current_user(request)
    try:
        validate_future(config)
    except ValueError as exc:
        raise HTTPException(422,str(exc))
    with db() as c:
        c.execute("BEGIN IMMEDIATE")
        accounts.ensure_search_capacity(c,user["id"])
        sid = add_search(c,config,user["id"])
    return {"id":sid}


@app.put("/api/searches/{sid}")
def update_search(request: Request, sid: str, config: Search):
    user = accounts.current_user(request)
    try:
        validate_future(config)
    except ValueError as exc:
        raise HTTPException(422,str(exc))
    with db() as c:
        c.execute("BEGIN IMMEDIATE")
        row = require_search(c,sid,user["id"])
        reused = result_cache.carry_forward(c,row,config)
        c.execute("UPDATE searches SET config=?,version=version+1,state=?,next_due=?,progress=0,total=0,error=NULL WHERE id=?",
                  (config.model_dump_json(),"scheduled" if row["active"] else "paused",max(time.time(),(row["last_started"] or 0)+300) if row["active"] else None,sid))
    return {"ok":True,"reference_reset":True,"results_reused":bool(reused)}


class Action(BaseModel):
    action: str


@app.post("/api/searches/{sid}/action")
def search_action(request: Request, sid: str, data: Action):
    user = accounts.current_user(request)
    with db() as c:
        row = require_search(c,sid,user["id"])
        if data.action == "pause":
            c.execute("UPDATE searches SET active=0,state='paused',next_due=NULL WHERE id=?", (sid,))
        elif data.action == "resume":
            if monitoring_deadline(Search.model_validate_json(row["config"])) <= time.time():
                raise HTTPException(422,"A janela de viagem já terminou; revise as datas para retomar")
            c.execute("UPDATE searches SET active=1,state='scheduled',next_due=? WHERE id=?", (max(time.time(),(row["last_started"] or 0)+300),sid))
        elif data.action == "refresh":
            raise HTTPException(422,"As consultas são automáticas a cada cinco minutos")
        elif data.action == "archive":
            c.execute("UPDATE searches SET active=0,archived=1,state='ended',next_due=NULL WHERE id=?", (sid,))
        else:
            raise HTTPException(422,"Ação não reconhecida")
    return {"ok":True}


@app.delete("/api/searches/{sid}")
def delete_search(request: Request, sid: str):
    user=accounts.current_user(request)
    with db() as c:
        c.execute("BEGIN IMMEDIATE")
        if not c.execute("SELECT 1 FROM searches WHERE id=? AND owner_id=?",(sid,user['id'])).fetchone():
            raise HTTPException(404,"Busca não encontrada")
        if c.execute("SELECT 1 FROM outbox WHERE search_id=? AND status='sending'",(sid,)).fetchone():
            raise HTTPException(409,"Aguarde o envio em andamento antes de excluir esta busca")
        for table in ('outbox','alerts','baselines','snapshots','results','cycles'):
            c.execute(f"DELETE FROM {table} WHERE search_id=?",(sid,))
        c.execute("DELETE FROM searches WHERE id=?",(sid,))
    return {"ok":True}


@app.post("/api/searches/{sid}/restore")
def restore_search(request: Request, sid: str):
    user = accounts.current_user(request)
    with db() as c:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute("SELECT * FROM searches WHERE id=? AND archived=1 AND owner_id=?", (sid,user["id"],)).fetchone()
        if not row:
            raise HTTPException(404,"Busca arquivada não encontrada")
        accounts.ensure_search_capacity(c,user["id"])
        if monitoring_deadline(Search.model_validate_json(row['config']))<=time.time():
            raise HTTPException(422,"A janela de viagem já terminou; crie uma nova busca com datas futuras")
        c.execute("UPDATE searches SET archived=0,active=1,state='scheduled',next_due=? WHERE id=?", (max(time.time(),(row["last_started"] or 0)+300),sid))
    return {"ok":True}


@app.get("/api/searches/{sid}/trend")
def search_trend(request:Request,sid:str,version:int|None=None):
    user=accounts.current_user(request)
    with db() as c:
        row=require_search(c,sid,user['id'],include_archived=True)
        version=version or row['version']
        bounds=c.execute('SELECT MIN(collected),MAX(collected),COUNT(*) FROM snapshots WHERE search_id=? AND version=?',(sid,version)).fetchone()
        bucket=max(1,int(((bounds[1] or 0)-(bounds[0] or 0))/240)+1)
        rows=c.execute("SELECT id,version,direction,collected,complete,price,count,currency FROM (SELECT id,version,direction,collected,complete,price,count,COALESCE(json_extract(flight,'$.currency'),'BRL') AS currency,ROW_NUMBER() OVER(PARTITION BY direction,CAST(collected/? AS INTEGER) ORDER BY price,collected) AS position FROM snapshots WHERE search_id=? AND version=? AND complete=1 AND price IS NOT NULL) WHERE position=1 ORDER BY collected",(bucket,sid,version)).fetchall()
        versions=[r[0] for r in c.execute('SELECT DISTINCT version FROM snapshots WHERE search_id=? ORDER BY version DESC',(sid,))]
    return {'points':[dict(r) for r in rows],'versions':sorted(set(versions+[row['version']]),reverse=True),'bucket_seconds':bucket,'aggregation':'minimum','version':version}


@app.get("/api/export/{sid}")
def export(request: Request, sid: str):
    user = accounts.current_user(request)
    with db() as c:
        require_search(c,sid,user["id"],include_archived=True)
    data = state(request,sid)
    with db() as c:
        data['history']=[dict(r) for r in c.execute("SELECT id,version,cycle_id,direction,collected,complete,price,count,COALESCE(json_extract(flight,'$.currency'),'BRL') AS currency FROM snapshots WHERE search_id=? ORDER BY collected",(sid,))]
    # Exports contain search data only, never CSRF tokens or SMTP configuration.
    return JSONResponse({k:data[k] for k in ("selected","flights","routes","history","alerts","cycles")},
                        headers={"Content-Disposition":'attachment; filename="radar-voos.json"'})


@app.put("/api/smtp")
def configure_smtp(request: Request, config: mail.SMTPSettings):
    accounts.require_admin(request)
    try:
        mail.save_settings(config)
    except ValueError as exc:
        raise HTTPException(422,str(exc))
    return mail.public_settings()


class MailTest(BaseModel):
    recipient: str = Field(default='',max_length=254)

    @field_validator('recipient')
    @classmethod
    def valid_recipient(cls,value):
        return accounts.clean_emails([value])[0] if value else ''


@app.post("/api/smtp/test")
def test_smtp(request: Request, data: MailTest):
    user=accounts.require_admin(request)
    if not mail.available():
        raise HTTPException(422,"Conecte uma conta Google ou configure o SMTP antes do teste")
    config = mail.delivery_settings()
    recipient=data.recipient or (mail.test_recipient() if config.get("provider")=="google" else '') or (config["sender"] if config.get("provider")=="google" else config["recipient"])
    recipients = [recipient]
    with db() as c:
        last = c.execute("SELECT created FROM outbox WHERE kind='test' ORDER BY created DESC LIMIT 1").fetchone()
        if last and time.time()-last["created"] < 60:
            raise HTTPException(429,"Aguarde um minuto antes de enviar outro teste")
        oid = uuid.uuid4().hex
        language=user.get('language','pt')
        subject={'pt':'Radar de Voos · teste de configuração','en':'Flight Radar · delivery test','es':'Radar de Vuelos · prueba de envío'}[language]
        body={'pt':'Este é um e-mail de teste solicitado no Radar de Voos. Não é um alerta de tarifa.','en':'This test email was requested in Flight Radar. It is not a fare alert.','es':'Este correo de prueba fue solicitado en Radar de Vuelos. No es una alerta de tarifa.'}[language]
        c.execute("INSERT INTO outbox(id,created,alert_ids,subject,body,status,next_due,recipients,owner_id,kind) VALUES(?,?,?,?,?,?,?,?,?,?)",
                  (oid,time.time(),"[]",subject,body,"pending",time.time(),json.dumps(recipients),user["id"],"test"))
        if data.recipient:
            c.execute("INSERT OR REPLACE INTO metadata(key,value) VALUES('mail_test_recipient',?)",(recipient,))
    return {"id":oid,"status":"pending","recipient":recipient}


@app.get("/api/auth/session")
def auth_session(request: Request):
    return {"user":accounts.current_user(request,False),"token":TOKEN,"can_bootstrap":accounts.can_bootstrap(request),"registration_open":not public_mode()}


@app.post("/api/auth/recovery")
def recovery_request(request:Request,data:recovery.RecoveryRequest):
    return recovery.request_reset(request,data)


@app.post("/api/auth/recovery/confirm")
def recovery_confirm(request:Request,data:recovery.RecoveryConfirm):
    return recovery.confirm_reset(request,data)


@app.post("/api/auth/register")
def register(request: Request, response: Response, data: accounts.Registration):
    if public_mode():raise HTTPException(403,"Solicite seu cadastro ao administrador.")
    user=accounts.register(data,response)
    audit.record(request,"register_success",user["id"])
    return user


@app.post("/api/auth/bootstrap")
def bootstrap(request: Request, response: Response, data: accounts.Registration):
    if not accounts.can_bootstrap(request):
        raise HTTPException(403,"Configure o primeiro administrador pelo endereço local da aplicação.")
    user=accounts.register(data,response,admin=True)
    audit.record(request,"bootstrap_success",user["id"])
    return user


@app.post("/api/auth/login")
def login(request: Request, response: Response, data: accounts.Login):
    return accounts.authenticate(data,request,response)


@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    import hashlib
    token=request.cookies.get(accounts.COOKIE,"")
    user=accounts.current_user(request,False)
    if user:audit.record(request,'logout',user['id'])
    with db() as c:
        c.execute("DELETE FROM sessions WHERE digest=?",(hashlib.sha256(token.encode()).hexdigest(),))
    response.delete_cookie(accounts.COOKIE,path="/")
    return {"ok":True}


@app.get("/api/audit")
def own_audit(request:Request,page:int|None=Query(None,ge=0,le=1000),q:str=Query('',max_length=120),event:str=Query('',max_length=64),start:float|None=Query(None,ge=0),end:float|None=Query(None,ge=0)):
    user=accounts.current_user(request)
    return audit.list_events(user) if page is None else audit.page_events(user,False,page,q,event,start,end)


@app.get('/api/admin/users')
def admin_users(request:Request,q:str=Query('',max_length=120),page:int=Query(0,ge=0,le=10000)):
    accounts.require_admin(request)
    return admin_accounts.listing(q,page)


@app.get('/api/admin/users/{uid}/monitorings')
def admin_monitorings(request:Request,uid:str,status:Literal['all','active','paused','ended']='all',page:int=Query(0,ge=0,le=10000)):
    accounts.require_admin(request)
    return admin_accounts.monitorings(uid,status,page)


@app.get('/api/admin/users/{uid}')
def admin_user(request:Request,uid:str):
    accounts.require_admin(request)
    with db() as c:
        user=accounts.public_user(admin_accounts.get(uid,c))
        user['client_number']=c.execute('SELECT number FROM client_refs WHERE entity_id=?',(uid,)).fetchone()[0]
    return user


@app.get('/api/admin/users/{uid}/monitorings/{sid}')
def admin_monitoring_detail(request:Request,uid:str,sid:str,page:int=Query(0,ge=0,le=10000)):
    actor=accounts.require_admin(request)
    with db() as c:
        c.execute('BEGIN')
        admin_accounts.get(uid,c)
        row=c.execute('SELECT s.*,r.number AS monitoring_number FROM searches s JOIN monitor_refs r ON r.entity_id=s.id WHERE s.id=? AND s.owner_id=?',(sid,uid)).fetchone()
        if not row:raise HTTPException(404,'Monitoramento não encontrado para este usuário.')
        flights,_=recent_results(c,row)
        result={'search':decode_search(row),'flights':flights[page*40:(page+1)*40],
                'total':len(flights),'page':page,'page_size':40,'readonly':True}
    audit.record(request,'admin_monitoring_viewed',uid,actor['id'])
    return result


@app.post('/api/admin/users')
def admin_create_user(request:Request,data:admin_accounts.Create):
    return admin_accounts.create(request,accounts.require_admin(request),data)


@app.put('/api/admin/users/{uid}')
def admin_update_user(request:Request,uid:str,data:admin_accounts.Update):
    return admin_accounts.update(request,accounts.require_admin(request),uid,data)


@app.put('/api/admin/users/{uid}/password')
def admin_user_password(request:Request,uid:str,data:admin_accounts.Password):
    return admin_accounts.password(request,accounts.require_admin(request),uid,data)


@app.get('/api/admin/whatsapp')
def admin_whatsapp(request:Request):
    accounts.require_admin(request)
    return whatsapp.public_settings()


@app.put('/api/admin/whatsapp')
def save_whatsapp(request:Request,data:whatsapp.Settings):
    accounts.require_admin(request)
    try:return whatsapp.save(data)
    except ValueError as exc:raise HTTPException(422,str(exc))


@app.post('/api/admin/whatsapp/check')
def check_whatsapp(request:Request):
    accounts.require_admin(request)
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row=c.execute("SELECT value FROM metadata WHERE key='whatsapp_check_last'").fetchone()
        if row and time.time()-float(row[0])<10:raise HTTPException(429,'Aguarde dez segundos antes de verificar novamente')
        c.execute("INSERT OR REPLACE INTO metadata VALUES('whatsapp_check_last',?)",(str(time.time()),))
    try:return whatsapp.check()
    except whatsapp.IntegrationError as exc:raise HTTPException(422,str(exc))


@app.post('/api/admin/whatsapp/test')
def test_whatsapp(request:Request,data:accounts.PhoneContact):
    user=accounts.require_admin(request)
    with whatsapp.LOCK:
        config=whatsapp.settings()
        if not whatsapp.available(config):raise HTTPException(422,'Configure e habilite o WhatsApp antes do teste')
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            last=c.execute("SELECT created FROM outbox WHERE channel='whatsapp' AND kind='test' ORDER BY created DESC LIMIT 1").fetchone()
            if last and time.time()-last[0]<60:raise HTTPException(429,'Aguarde um minuto antes de enviar outro teste')
            oid=uuid.uuid4().hex
            texts={'pt':'Radar de Voos · teste de configuração WhatsApp.','en':'Flight Radar · WhatsApp configuration test.','es':'Radar de Vuelos · prueba de configuración WhatsApp.'}
            c.execute("INSERT INTO outbox(id,created,alert_ids,subject,body,status,next_due,recipients,owner_id,channel,provider,transport_ref,kind) VALUES(?,?,'[]',?,?,'pending',?,?,?,'whatsapp',?,?,'test')",(oid,time.time(),'Radar de Voos · WhatsApp',texts[user.get('language','pt')],time.time(),json.dumps([data.phone]),user['id'],config['provider'],whatsapp.reference(config)))
    return {'id':oid,'status':'pending','recipient':data.phone}


class DeliveryFilter(BaseModel):
    page: int = Field(default=0,ge=0,le=10000)
    channel: Literal['all','email','whatsapp','telegram'] = 'all'
    status: Literal['all','sent','pending','failed','blocked','closed'] = 'all'
    user: str = Field(default='',max_length=120)
    q: str = Field(default='',max_length=200)
    start: float | None = Field(default=None,ge=0)
    end: float | None = Field(default=None,ge=0)


class LogPolicy(BaseModel):
    scope: Literal['deliveries','access'] = 'deliveries'
    days: int = Field(ge=1,le=3650)


class DeliveryCleanup(BaseModel):
    scope: Literal['deliveries','access'] = 'deliveries'
    before: float = Field(ge=0)
    proof: str = Field(default='',max_length=128)
    expires: int = 0


@app.get('/api/admin/deliveries')
def admin_deliveries(request:Request,filters:DeliveryFilter=Query()):
    accounts.require_admin(request)
    return deliveries.list_items(filters.model_dump(),filters.page)


@app.get('/api/admin/deliveries/{delivery_id}')
def admin_delivery(request:Request,delivery_id:str):
    accounts.require_admin(request)
    return deliveries.detail(delivery_id)


@app.get('/api/admin/delivery-retention')
def delivery_retention(request:Request,scope:Literal['deliveries','access']='deliveries'):
    accounts.require_admin(request)
    return deliveries.retention_info(scope)


@app.put('/api/admin/delivery-retention')
def change_log_policy(request:Request,data:LogPolicy):
    accounts.require_admin(request)
    return deliveries.configure_days(data.scope,data.days)


@app.post('/api/admin/delivery-cleanup/preview')
def preview_delivery_cleanup(request:Request,data:DeliveryCleanup):
    user=accounts.require_admin(request)
    return deliveries.preview(data.before,user['id'],TOKEN,data.scope)


@app.post('/api/admin/delivery-cleanup/confirm')
def confirm_delivery_cleanup(request:Request,data:DeliveryCleanup):
    user=accounts.require_admin(request)
    return deliveries.confirm(data.before,data.expires,data.proof,user['id'],TOKEN,data.scope)


@app.get("/api/admin/audit")
def admin_audit(request:Request,page:int|None=Query(None,ge=0,le=1000),q:str=Query('',max_length=120),event:str=Query('',max_length=64),start:float|None=Query(None,ge=0),end:float|None=Query(None,ge=0)):
    user=accounts.require_admin(request)
    return audit.list_events(user,all_users=True) if page is None else audit.page_events(user,True,page,q,event,start,end)


class LanguagePreference(BaseModel):
    language: str


@app.put("/api/profile/language")
def language_preference(request:Request,data:LanguagePreference):
    user=accounts.current_user(request)
    if data.language not in ('pt','en','es'):raise HTTPException(422,'Idioma não suportado')
    with db() as c:c.execute('UPDATE accounts SET language=? WHERE id=?',(data.language,user['id']))
    return {'ok':True}


@app.put("/api/profile")
def profile(request: Request, data: accounts.Contacts):
    return accounts.update_contacts(accounts.current_user(request)["id"],data)


@app.put("/api/google/client")
def google_client(request: Request, config: google_mail.OAuthClient):
    accounts.require_admin(request)
    try:return google_mail.configure(config)
    except google_mail.GoogleMailError as exc:raise HTTPException(422,str(exc))


@app.post("/api/mail/connect")
def connect_mail_account(request: Request, account: mail_discovery.MailAccount):
    user=accounts.require_admin(request)
    provider='google' if account.provider=='google' else mail_discovery.identify(account.email)
    if provider!='google':
        return {"provider":provider,"email":account.email,"ready":False}
    if not public_mode() and request.url.hostname not in ("127.0.0.1","localhost"):
        raise HTTPException(422,"Adicione a conta pelo endereço local da aplicação.")
    if not google_mail.public_settings()["configured"]:
        return {"provider":"google","email":account.email,"ready":False,"setup_required":True}
    try:
        url=google_mail.start(user,request.cookies.get(accounts.COOKIE,""),(public_origin() if public_mode() else "http://"+request.url.hostname+":"+str(request.url.port or 80)),login_hint=account.email)
        return {"provider":"google","email":account.email,"ready":True,"url":url}
    except google_mail.GoogleMailError as exc:raise HTTPException(422,str(exc))


@app.post("/api/google/start")
def google_start(request: Request):
    user=accounts.require_admin(request)
    if not public_mode() and request.url.hostname not in ("127.0.0.1","localhost"):
        raise HTTPException(422,"Conecte a conta Google pelo endereço local da aplicação.")
    try:
        return {"url":google_mail.start(user,request.cookies.get(accounts.COOKIE,""),(public_origin() if public_mode() else "http://"+request.url.hostname+":"+str(request.url.port or 80)))}
    except google_mail.GoogleMailError as exc:raise HTTPException(422,str(exc))


@app.post("/api/google/disconnect")
def google_disconnect(request: Request):
    accounts.require_admin(request)
    google_mail.disconnect()
    return {"ok":True}


@app.get("/api/google/callback")
def google_callback(request: Request, state: str = "", code: str = "", error: str = ""):
    import html
    pending=None;ok=False
    try:
        pending=google_mail.consume(state)
        google_mail.finish(pending,code,denied=bool(error))
        ok=True;message="Conta Google conectada. Você pode fechar esta janela."
    except google_mail.GoogleMailError as exc:
        message=str(exc)
        # Persist diagnostics only for a validated, session-bound authorization.
        if pending:google_mail.remember_connection_error(message)
    from .i18n import translate
    language=pending.get('language','pt') if pending else request.headers.get('accept-language','pt').split(',')[0].split('-')[0]
    if language not in ('pt','en','es'):language='en'
    message=translate(message,language)
    heading=translate('Conta conectada' if ok else 'Conexão não concluída',language)
    callback_title=translate('Conexão Google · Radar de Voos',language)
    back_label=translate('Voltar ao radar',language)
    nonce=secrets.token_urlsafe(20)
    origin=json.dumps(pending["origin"] if pending else (public_origin() if public_mode() else "http://127.0.0.1:8765"))
    payload=json.dumps({"type":"radar-google-oauth","ok":ok,"message":message}).replace('<','\\u003c')
    style='html{color-scheme:light;background:#f2f5f8;color:#182739;font:18px/1.6 system-ui,sans-serif}body{margin:0;padding:32px}main{max-width:520px;margin:40px auto;background:white;border:1px solid #c9d4df;border-radius:16px;padding:28px}h1{font-size:26px;line-height:1.3}a{color:#245580;font-weight:600}'
    document='<!doctype html><html lang="'+language+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+html.escape(callback_title)+'</title><style nonce="'+nonce+'">'+style+'</style></head><body><main><h1>'+html.escape(heading)+'</h1><p>'+html.escape(message)+'</p><a href="/" target="_blank" rel="noopener">'+html.escape(back_label)+'</a></main><script nonce="'+nonce+'">history.replaceState(null,"","/api/google/callback");if(window.opener){window.opener.postMessage('+payload+','+origin+');'+('window.close();' if ok else '')+'}</script></body></html>'
    return HTMLResponse(document,headers={"Cache-Control":"no-store", "Content-Security-Policy":"default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'nonce-"+nonce+"'; base-uri 'none'; frame-ancestors 'none'"})


if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/")
@app.get("/viagens")
@app.get("/viagens/{path:path}")
@app.get("/historico")
@app.get("/alertas")
@app.get("/perfil")
@app.get("/admin")
@app.get("/admin/{path:path}")
@app.get("/404")
def index(request: Request):
    params=request.query_params
    if "state" in params and ("code" in params or "error" in params):
        return google_callback(request=request,state=params.get("state",""),code=params.get("code",""),error=params.get("error",""))
    if not (DIST / "index.html").exists():
        raise HTTPException(503,"Interface indisponível.")
    return FileResponse(DIST / "index.html", headers={"Cache-Control":"no-cache"})
