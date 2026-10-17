"""Authenticated OpenWA receipts, independent of transport attempts and retries."""
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from datetime import datetime
from urllib.parse import urlsplit
from fastapi import HTTPException
from . import store

PATH='/api/webhooks/whatsapp/openwa'
MAX_BODY=16384
INBOX_TTL=3600
INBOX_LIMIT=1000
STATES={'pending','sent','delivered','read','failed'}


def setup(c):
    c.executescript('''CREATE TABLE IF NOT EXISTS whatsapp_receipt_inbox(
      transport_ref TEXT NOT NULL, session_id TEXT NOT NULL, message_id TEXT NOT NULL,
      state TEXT NOT NULL, observed REAL NOT NULL, received REAL NOT NULL,
      PRIMARY KEY(transport_ref,session_id,message_id,state));
      CREATE INDEX IF NOT EXISTS whatsapp_receipt_lookup ON outbox(transport_ref,provider_message_id) WHERE channel='whatsapp';
      CREATE INDEX IF NOT EXISTS whatsapp_receipt_expiry ON whatsapp_receipt_inbox(received);''')
    c.execute('DELETE FROM whatsapp_receipt_inbox WHERE received<?',(time.time()-INBOX_TTL,))


def settings():
    path=store.DATA_DIR/'whatsapp-receipts-private.json'
    try:return json.loads(path.read_text())
    except (OSError,ValueError):return {}


def public_settings():
    from . import whatsapp
    from .network import public_mode,public_origin
    data=settings();config=whatsapp.settings()
    matches=bool(data.get('transport_ref')==whatsapp.reference(config) and config['provider']=='openwa')
    return {'enabled':bool(data.get('enabled')),'secret_set':bool(data.get('secret')),
            'active':bool(data.get('enabled') and data.get('secret') and matches),
            'identity_matches':matches,'callback_url':public_origin()+PATH if public_mode() else None,'callback_path':PATH}


def save(enabled,secret):
    from . import whatsapp
    with whatsapp.LOCK:
        previous=settings();config=whatsapp.settings();binding=whatsapp.reference(config)
        same=previous.get('transport_ref')==binding
        secret=secret or (previous.get('secret','') if same else '')
        if secret and (not secret.isascii() or not 32<=len(secret)<=255 or any(ord(ch)<33 for ch in secret)):
            raise ValueError('Use um segredo de 32 a 255 caracteres, sem espaços.')
        if enabled and (config['provider']!='openwa' or not whatsapp.available(config) or not secret):
            raise ValueError('Salve a integração OpenWA e informe o segredo das confirmações.')
        data={'enabled':enabled,'secret':secret,'transport_ref':binding,'session_id':config['values'].get('session_id','')}
        store.DATA_DIR.mkdir(parents=True,exist_ok=True,mode=0o700)
        path=store.DATA_DIR/'whatsapp-receipts-private.json';tmp=path.with_suffix('.'+secrets.token_hex(6)+'.tmp')
        fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as file:json.dump(data,file)
        tmp.replace(path)
    return public_settings()


def parse(body,signature):
    from . import whatsapp
    cfg=settings();config=whatsapp.settings()
    if not cfg.get('enabled') or not cfg.get('secret') or config['provider']!='openwa' or cfg.get('transport_ref')!=whatsapp.reference(config):
        raise HTTPException(403,'Confirmações indisponíveis.')
    expected='sha256='+hmac.new(cfg['secret'].encode(),body,hashlib.sha256).hexdigest()
    if not isinstance(signature,str) or not re.fullmatch(r'sha256=[0-9a-f]{64}',signature) or not hmac.compare_digest(signature,expected):
        raise HTTPException(403,'Assinatura inválida.')
    try:
        payload=json.loads(body)
        if not isinstance(payload,dict):raise ValueError()
        if payload.get('sessionId')!=cfg['session_id']:raise ValueError()
        event=payload.get('event');data=payload.get('data')
        if event not in ('message.ack','message.failed') or not isinstance(data,dict):raise ValueError()
        mid=data.get('messageId',data.get('id'))
        if not isinstance(mid,str) or not 1<=len(mid)<=500 or any(ord(ch)<32 for ch in mid):raise ValueError()
        if data.get('id',mid)!=mid:raise ValueError()
        state=data.get('status')
        if state is None:
            ack=data.get('ack')
            if type(ack) is not int:raise ValueError()
            state={-1:'failed',0:'pending',1:'sent',2:'delivered',3:'read',4:'read'}.get(ack)
        if not isinstance(state,str) or state not in STATES or (event=='message.failed' and state!='failed'):raise ValueError()
        instant=datetime.fromisoformat(payload['timestamp'].replace('Z','+00:00'))
        if instant.tzinfo is None:raise ValueError()
        observed=instant.timestamp()
        if observed<0 or observed>time.time()+600:raise ValueError()
    except (ValueError,TypeError,KeyError,AttributeError,OverflowError):
        raise HTTPException(422,'Confirmação inválida.') from None
    return cfg,mid,state,observed


def apply(c,row,state,observed,received):
    if state=='pending' or observed<row['created']-300:return
    current=row['receipt_status']
    rank={None:0,'sent':1,'failed':1,'delivered':2,'read':3}
    if state=='failed':
        if current in ('failed','delivered','read'):return
    elif rank[state]<=rank.get(current,0):return
    column={'sent':'receipt_sent_at','delivered':'delivered_at','read':'read_at','failed':'receipt_failed_at'}[state]
    c.execute(f'UPDATE outbox SET receipt_status=?,{column}=COALESCE({column},?),receipt_received_at=? WHERE id=?',(state,observed,received,row['id']))


def receive(body,signature):
    cfg,mid,state,observed=parse(body,signature);now=time.time()
    with store.db() as c:
        c.execute('BEGIN IMMEDIATE')
        c.execute('DELETE FROM whatsapp_receipt_inbox WHERE received<?',(now-INBOX_TTL,))
        rows=c.execute("SELECT * FROM outbox WHERE channel='whatsapp' AND provider='openwa' AND transport_ref=? AND provider_message_id=? AND status='sent' LIMIT 2",(cfg['transport_ref'],mid)).fetchall()
        # A reused provider ID must never confirm an arbitrary recipient.
        if len(rows)==1:apply(c,rows[0],state,observed,now)
        elif not rows and state!='pending' and c.execute("SELECT 1 FROM outbox WHERE channel='whatsapp' AND provider='openwa' AND transport_ref=? AND status='sending' LIMIT 1",(cfg['transport_ref'],)).fetchone():
            exists=c.execute('SELECT 1 FROM whatsapp_receipt_inbox WHERE transport_ref=? AND session_id=? AND message_id=? AND state=?',(cfg['transport_ref'],cfg['session_id'],mid,state)).fetchone()
            if not exists and c.execute('SELECT COUNT(*) FROM whatsapp_receipt_inbox').fetchone()[0]>=INBOX_LIMIT:
                raise HTTPException(503,'Confirmação temporariamente indisponível.')
            c.execute('''INSERT INTO whatsapp_receipt_inbox VALUES(?,?,?,?,?,?) ON CONFLICT(transport_ref,session_id,message_id,state)
              DO UPDATE SET observed=MIN(observed,excluded.observed),received=MIN(received,excluded.received)''',(cfg['transport_ref'],cfg['session_id'],mid,state,observed,now))
    return {'ok':True}


def reconcile(c,outbox_id):
    row=c.execute('SELECT * FROM outbox WHERE id=?',(outbox_id,)).fetchone()
    if not row or row['status']!='sent' or not row['provider_message_id']:return
    events=c.execute('SELECT * FROM whatsapp_receipt_inbox WHERE transport_ref=? AND message_id=? AND received>=? ORDER BY observed,received',(row['transport_ref'],row['provider_message_id'],time.time()-INBOX_TTL)).fetchall()
    for event in events:
        row=c.execute('SELECT * FROM outbox WHERE id=?',(outbox_id,)).fetchone()
        apply(c,row,event['state'],event['observed'],event['received'])
    c.execute('DELETE FROM whatsapp_receipt_inbox WHERE transport_ref=? AND message_id=?',(row['transport_ref'],row['provider_message_id']))
