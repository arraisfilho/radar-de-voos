"""Email ownership-based password recovery. Tokens are one-use and stored hashed."""
import os
from urllib.parse import urlsplit
import hashlib
import json
import secrets
import time
import uuid
from pydantic import BaseModel,Field
from fastapi import HTTPException
from . import accounts,mail,audit
from .store import db

class RecoveryRequest(BaseModel):
    country:str=Field(max_length=2)
    phone:str=Field(max_length=50)

class RecoveryConfirm(BaseModel):
    token:str=Field(min_length=20,max_length=256)
    password:str=Field(min_length=10,max_length=200)


def request_reset(request,data):
    now=time.time();ip=request.client.host if request.client else 'unknown'
    try:phone=accounts.phone_e164(data.phone,data.country.upper())
    except ValueError:phone='invalid'
    available=mail.available()
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        c.execute('DELETE FROM recovery_attempts WHERE created<?',(now-3600,))
        limited=c.execute('SELECT COUNT(*) FROM recovery_attempts WHERE ip=?',(ip,)).fetchone()[0]>=5
        user=c.execute('SELECT * FROM accounts WHERE phone=?',(phone,)).fetchone()
        if not limited:
            c.execute('INSERT INTO recovery_attempts(ip,created) VALUES(?,?)',(ip,now))
        if not limited and user and available and json.loads(user['emails']):
            count=c.execute('SELECT COUNT(*) FROM password_resets WHERE user_id=? AND created>?',(user['id'],now-3600)).fetchone()[0]
            if count<5:
                token=secrets.token_urlsafe(32);digest=hashlib.sha256(token.encode()).hexdigest()
                # A later request invalidates earlier links and cancels unsent recovery mail.
                c.execute("UPDATE outbox SET status='cancelled' WHERE id IN (SELECT outbox_id FROM password_resets WHERE user_id=?) AND status='pending'",(user['id'],))
                c.execute('UPDATE password_resets SET used=1 WHERE user_id=?',(user['id'],))
                oid=uuid.uuid4().hex
                c.execute('INSERT INTO password_resets(digest,user_id,created,expires,used,outbox_id) VALUES(?,?,?,?,0,?)',(digest,user['id'],now,now+1200,oid))
                language=request.headers.get('x-radar-language',user['language'])
                if language not in ('pt','en','es'):language='en'
                subject={'pt':'Radar de Voos · recuperar acesso','en':'Flight Radar · recover access','es':'Radar de Vuelos · recuperar acceso'}[language]
                text={'pt':'Para definir uma nova senha, abra o link em até 20 minutos. Se não solicitou, ignore esta mensagem.','en':'Open this link within 20 minutes to set a new password. If you did not request it, ignore this message.','es':'Abre el enlace en 20 minutos para definir una nueva contraseña. Si no lo solicitaste, ignora este mensaje.'}[language]
                origin=os.environ.get('RADAR_PUBLIC_URL','http://127.0.0.1:8765').rstrip('/')
                parsed=urlsplit(origin)
                if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('','/'):
                    raise ValueError('RADAR_PUBLIC_URL deve ser uma origem HTTP(S) válida')
                link=origin+'/#reset='+token
                c.execute("INSERT INTO outbox(id,created,alert_ids,subject,body,status,next_due,recipients,owner_id,kind) VALUES(?,?,'[]',?,?,'pending',?,?,?,'recovery')",(oid,now,subject,text+'\n\n'+link,now,json.dumps([json.loads(user['emails'])[0]]),user['id']))
        c.execute('DELETE FROM password_resets WHERE expires<?',(now-86400,))
    audit.record(request,'recovery_requested')
    return {'ok':True}


def confirm_reset(request,data):
    digest=hashlib.sha256(data.token.encode()).hexdigest()
    # Validate before spending password hashing resources.
    with db() as c:row=c.execute('SELECT user_id FROM password_resets WHERE digest=? AND used=0 AND expires>?',(digest,time.time())).fetchone()
    if not row:raise HTTPException(422,'O link de recuperação expirou ou já foi usado')
    password_hash=accounts.HASHER.hash(data.password)
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row=c.execute('SELECT user_id FROM password_resets WHERE digest=? AND used=0 AND expires>?',(digest,time.time())).fetchone()
        if not row:raise HTTPException(422,'O link de recuperação expirou ou já foi usado')
        uid=row['user_id']
        c.execute('UPDATE accounts SET password_hash=? WHERE id=?',(password_hash,uid))
        c.execute('DELETE FROM sessions WHERE user_id=?',(uid,))
        c.execute('UPDATE password_resets SET used=1 WHERE user_id=?',(uid,))
        c.execute("UPDATE outbox SET status='cancelled' WHERE id IN (SELECT outbox_id FROM password_resets WHERE user_id=?) AND status='pending'",(uid,))
    audit.record(request,'password_reset',uid)
    return {'ok':True}
