"""Private provider settings and a bounded, recipient-specific WhatsApp outbox."""
import hashlib
import json
import os
import secrets
import threading
import time
import uuid
from pydantic import BaseModel,Field
from . import store,accounts
from .integrations import WHATSAPP_PROVIDERS,catalog
from .integrations.base import IntegrationError
from .notifications import sync_alerts,link

LOCK=threading.RLock()
class Settings(BaseModel):
    provider:str=Field(default='openwa',max_length=50)
    enabled:bool=False
    values:dict[str,str]=Field(default_factory=dict,max_length=20)


def settings():
    path=store.DATA_DIR/'whatsapp-private.json'
    if path.exists():return json.loads(path.read_text())
    values={f['key']:f['default'] for f in WHATSAPP_PROVIDERS['openwa'].fields};values['base_url']=os.environ.get('RADAR_WHATSAPP_URL','')
    return {'provider':'openwa','enabled':False,'values':values}


def public_settings():
    data=settings();provider=WHATSAPP_PROVIDERS.get(data['provider']);fields=provider.fields if provider else []
    secret_keys={f['key'] for f in fields if f['secret']}
    return {'provider':data['provider'],'enabled':data['enabled'],'values':{f['key']:data['values'].get(f['key'],'') for f in fields if not f['secret']},'secrets_set':{k:bool(data['values'].get(k)) for k in secret_keys},'providers':catalog(),'available':available(data)}


def available(data=None):
    data=data or settings();provider=WHATSAPP_PROVIDERS.get(data['provider'])
    return bool(data['enabled'] and provider and all(data['values'].get(f['key']) for f in provider.fields))


def reference(data):
    p=WHATSAPP_PROVIDERS.get(data['provider']);public={f['key']:data['values'].get(f['key'],'') for f in p.fields if not f['secret']} if p else {}
    return hashlib.sha256(json.dumps([data['provider'],public],sort_keys=True).encode()).hexdigest()


def save(data):
    provider=WHATSAPP_PROVIDERS.get(data.provider)
    if not provider:raise ValueError('Integrador WhatsApp não suportado')
    with LOCK:
        previous=settings();values=provider.normalize(data.values)
        same=previous['provider']==data.provider and all(values.get(f['key'],'')==previous['values'].get(f['key'],'') for f in provider.fields if not f['secret'])
        for f in provider.fields:
            if f['secret'] and not values.get(f['key']):values[f['key']]=previous['values'].get(f['key'],'') if same else ''
        if data.enabled and not all(values.get(f['key']) for f in provider.fields):raise ValueError('Informe todos os campos da integração WhatsApp; ao trocar URL ou sessão, informe o token novamente')
        result={'provider':data.provider,'enabled':data.enabled,'values':values}
        store.DATA_DIR.mkdir(parents=True,exist_ok=True,mode=0o700)
        path=store.DATA_DIR/'whatsapp-private.json';tmp=path.with_suffix('.'+secrets.token_hex(6)+'.tmp')
        fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as f:json.dump(result,f)
        tmp.replace(path);os.chmod(path,0o600)
        # A saved identity switch or disabling must never redirect queued messages.
        with store.db() as c:
            rows=c.execute("SELECT id,alert_ids FROM outbox WHERE channel='whatsapp' AND status='pending' AND (transport_ref!=? OR ?=0)",(reference(result),int(result['enabled']))).fetchall()
            for row in rows:
                c.execute("UPDATE outbox SET status='cancelled',error='Configuração WhatsApp alterada' WHERE id=?",(row['id'],));sync_alerts(c,json.loads(row['alert_ids']))
    return public_settings()


def recipients(c,sid):
    row=c.execute('SELECT a.* FROM accounts a JOIN searches s ON s.owner_id=a.id WHERE s.id=?',(sid,)).fetchone()
    if not row:return []
    values=[(row['phone'] if row['whatsapp_use_login'] else row['whatsapp_phone'],row['country'] if row['whatsapp_use_login'] else row['whatsapp_country'])]+[(p['phone'],p['country']) for p in json.loads(row['additional_phones'])]
    phones=[]
    for value,country in values:
        if not value:continue
        try:phone=accounts.phone_e164(value,country)
        except ValueError:continue
        if phone not in phones:phones.append(phone)
    return phones


def enqueue(c,sid,version,ids,subject,body):
    config=settings();phones=recipients(c,sid)
    for phone in phones or [None]:
        oid=uuid.uuid4().hex
        error='Número WhatsApp não cadastrado' if phone is None else 'Integração WhatsApp indisponível' if not available(config) else None
        c.execute('INSERT INTO outbox(id,search_id,version,created,alert_ids,subject,body,status,next_due,recipients,channel,provider,transport_ref,error) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(oid,sid,version,time.time(),json.dumps(ids),subject,body,'failed' if error else 'pending',time.time(),json.dumps([phone] if phone else []),'whatsapp',config['provider'],reference(config),error))
        link(c,oid,ids)


def check():
    with LOCK:
        config=settings();provider=WHATSAPP_PROVIDERS.get(config['provider'])
        if not provider:raise IntegrationError('Integrador WhatsApp não suportado')
        return {**provider.check(config['values']),'checked_at':time.time()}


def send_one():
    # Configuration mutations wait for an in-flight HTTP operation to finish.
    with LOCK:
        config=settings()
        with store.db() as c:
            c.execute('BEGIN IMMEDIATE')
            row=c.execute("SELECT * FROM outbox WHERE channel='whatsapp' AND status='pending' AND next_due<=? ORDER BY created,id LIMIT 1",(time.time(),)).fetchone()
            if not row:return
            row=dict(row);status=None
            if not available(config) or row['provider']!=config['provider'] or row['transport_ref']!=reference(config):status='cancelled'
            if row['search_id']:
                search=c.execute('SELECT * FROM searches WHERE id=?',(row['search_id'],)).fetchone()
                if not search or not search['active'] or search['archived'] or search['version']!=row['version']:status='cancelled'
                elif accounts.search_is_quiet(c,row['search_id']):status='quiet'
                elif json.loads(row['recipients'] or '[]')!=[p for p in json.loads(row['recipients'] or '[]') if p in recipients(c,row['search_id'])]:status='cancelled'
            if time.time()-row['created']>1800:status='expired'
            if status:
                c.execute('UPDATE outbox SET status=? WHERE id=?',(status,row['id']));sync_alerts(c,json.loads(row['alert_ids']));return
            c.execute("UPDATE outbox SET status='sending',attempts=attempts+1 WHERE id=?",(row['id'],))
        try:
            phones=json.loads(row['recipients'] or '[]')
            if len(phones)!=1:raise IntegrationError('Destinatário WhatsApp inválido')
            provider_id=WHATSAPP_PROVIDERS[config['provider']].send(config['values'],phones[0],row['body'])
            status,error='sent',None
        except IntegrationError as exc:status,error,provider_id='uncertain' if exc.uncertain else 'failed',str(exc),None
        except Exception:status,error,provider_id='uncertain','Não foi possível confirmar a operação no WhatsApp',None
        with store.db() as c:
            c.execute('UPDATE outbox SET status=?,error=?,sent=?,provider_message_id=? WHERE id=?',(status,error,time.time() if status=='sent' else None,provider_id,row['id']));sync_alerts(c,json.loads(row['alert_ids']))
