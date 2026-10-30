"""Password recovery by a 6-digit code sent by WhatsApp or e-mail, as the person chooses.

A code goes to the account's WhatsApp number (the profile's, never the additional ones) or to its
first e-mail. It is kept as an HMAC-SHA-256 with a server secret, bound to the account and to the
request. It lives CODE_SECONDS, takes CODE_ATTEMPTS tries, and a new request replaces it. A wrong
code also counts as a failed login (accounts.reserve_login), so the login lock bounds the guesses.
"""
import hashlib
import hmac
import secrets
import time
from typing import Literal
from pydantic import BaseModel,Field,field_validator
from fastapi import HTTPException
from . import accounts,audit,incidents,mail,two_factor,whatsapp
from .store import db

SECRET_FILE='recovery-private.json'
CODE_SECONDS=600
CODE_ATTEMPTS=5
# Requests that send a code, per account: one a minute, five an hour. Per address: five an hour.
RESEND_SECONDS=60
HOURLY_REQUESTS=5
ADDRESS_REQUESTS=5
WRONG_CODE='Código inválido ou vencido. Peça um novo.'
SUBJECT={'pt':'Radar de Voos · recuperar acesso','en':'Flight Radar · recover access','es':'Radar de Vuelos · recuperar acceso'}
TEXT={'pt':'Seu código para criar uma nova senha no Radar de Voos é {code}. Vale por 10 minutos. Se não foi você, ignore esta mensagem.',
      'en':'Your code to create a new Flight Radar password is {code}. It is valid for 10 minutes. If this was not you, ignore this message.',
      'es':'Tu código para crear una nueva contraseña en Radar de Vuelos es {code}. Vale por 10 minutos. Si no fuiste tú, ignora este mensaje.'}

class RecoveryRequest(BaseModel):
    country:str=Field(max_length=2)
    phone:str=Field(max_length=50)
    channel:Literal['whatsapp','email']

class RecoveryConfirm(BaseModel):
    country:str=Field(max_length=2)
    phone:str=Field(max_length=50)
    code:str=Field(max_length=20)
    password:str=Field(min_length=10,max_length=200)
    @field_validator('code')
    @classmethod
    def code_valid(cls,value):return two_factor.clean_code(value)


def digest(user_id,request_id,code):
    """Keyed hash of a code: a copy of the database alone does not let anyone test the million codes."""
    return hmac.new(accounts.private_secret(SECRET_FILE),('recovery:'+user_id+':'+request_id+':'+code).encode(),hashlib.sha256).hexdigest()


def destination(user,channel):
    """Where a code for the account goes by `channel` (an E.164 number or an e-mail), or None."""
    emails,(number,country)=accounts.contact_points(user)
    if channel=='email':return emails[0] if emails else None
    try:return accounts.phone_e164(number,country) if number else None
    except ValueError:return None


def invalidate(c,user_id):
    """Open codes of the account stop working and their unsent messages are cancelled (and emptied,
    by the trigger in deliveries.setup)."""
    c.execute('UPDATE password_resets SET used=1 WHERE user_id=? AND used=0',(user_id,))
    c.execute("UPDATE outbox SET status='cancelled' WHERE owner_id=? AND kind='recovery' AND status='pending'",(user_id,))


def request_reset(request,data):
    """Always the same answer: it never tells whether the account, the channel or the limits allowed a code."""
    # Counted like the login limit: an IPv6 /64 is one address.
    now=time.time();ip=accounts.limit_address(request.client.host if request.client else 'unknown')
    try:phone=accounts.phone_e164(data.phone,data.country.upper())
    except ValueError:phone=None
    config=whatsapp.settings()
    ready=whatsapp.available(config) if data.channel=='whatsapp' else mail.available()
    # Drawn for every request, sent or not.
    code=f'{secrets.randbelow(10**6):06d}'
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        c.execute('DELETE FROM recovery_attempts WHERE created<?',(now-3600,))
        limited=c.execute('SELECT COUNT(*) FROM recovery_attempts WHERE ip=?',(ip,)).fetchone()[0]>=ADDRESS_REQUESTS
        user=c.execute('SELECT * FROM accounts WHERE phone=?',(phone,)).fetchone() if phone else None
        if not limited:
            c.execute('INSERT INTO recovery_attempts(ip,created) VALUES(?,?)',(ip,now))
        target=destination(user,data.channel) if user and ready and not limited else None
        recent=[r[0] for r in c.execute('SELECT created FROM password_resets WHERE user_id=? AND created>?',(user['id'],now-3600))] if target else []
        if target and len(recent)<HOURLY_REQUESTS and all(now-moment>=RESEND_SECONDS for moment in recent):
            # One code at a time: the earlier one stops working and its message, if unsent, is cancelled.
            invalidate(c,user['id'])
            language=request.headers.get('x-radar-language',user['language'])
            if language not in ('pt','en','es'):language='en'
            # Never held by quiet hours: the senders hold only messages of a trip.
            oid=incidents.queue(c,user,data.channel,[target],SUBJECT[language],TEXT[language].format(code=code),now,now,'recovery',config)
            c.execute('INSERT INTO password_resets(digest,user_id,created,expires,used,outbox_id,channel,attempts) VALUES(?,?,?,?,0,?,?,0)',
                      (digest(user['id'],oid,code),user['id'],now,now+CODE_SECONDS,oid,data.channel))
        c.execute('DELETE FROM password_resets WHERE expires<?',(now-86400,))
    audit.record(request,'recovery_requested',details={'channel':data.channel})
    return {'ok':True}


def check(c,user_id,code,now):
    """The account's open code if `code` matches it. Each try spends one of its attempts before the
    comparison; a code without attempts left no longer matches anything."""
    row=c.execute('SELECT * FROM password_resets WHERE user_id=? AND used=0 AND expires>? AND attempts<? ORDER BY created DESC LIMIT 1',(user_id,now,CODE_ATTEMPTS)).fetchone()
    if not row:return None
    c.execute('UPDATE password_resets SET attempts=attempts+1 WHERE digest=?',(row['digest'],))
    return row if hmac.compare_digest(row['digest'],digest(user_id,row['outbox_id'],code)) else None


def confirm_reset(request,data):
    phone,account=accounts.login_key(data)
    address=accounts.limit_address(request.client.host if request.client else 'unknown')
    now=time.time()
    # The try is counted in its own transaction, before any password hashing. Its reservation is a
    # failed login unless the code matches: unknown phones and wrong codes feed the login limits.
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        user=c.execute('SELECT id FROM accounts WHERE phone=?',(phone,)).fetchone() if phone else None
        attempt,wait=accounts.reserve_login(c,address,account,now)
        row=check(c,user['id'],data.code,now) if user and attempt is not None else None
        if row:c.execute('DELETE FROM login_attempts WHERE rowid=?',(attempt,))
    if attempt is None:
        audit.record(request,'login_throttled',user['id'] if user else None)
        raise HTTPException(429,accounts.THROTTLED,headers={'Retry-After':str(wait)})
    if not row:raise HTTPException(422,WRONG_CODE)
    try:password_hash=accounts.hash_password(data.password)
    except HTTPException:
        # Busy: nothing was checked against the password, so the right code gets its try back.
        with db() as c:c.execute('UPDATE password_resets SET attempts=MAX(attempts-1,0) WHERE digest=?',(row['digest'],))
        raise
    uid=row['user_id']
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        # Still open: no new request, reset or contact change while the password was hashed.
        current=c.execute('SELECT 1 FROM password_resets WHERE digest=? AND used=0 AND expires>?',(row['digest'],time.time())).fetchone()
        if current:
            c.execute('UPDATE accounts SET password_hash=? WHERE id=?',(password_hash,uid))
            # Proven ownership of the account lifts its login lock; the second step stays required.
            accounts.clear_login_failures(c,phone)
            c.execute('DELETE FROM sessions WHERE user_id=?',(uid,))
            invalidate(c,uid)
    if not current:raise HTTPException(422,WRONG_CODE)
    audit.record(request,'password_reset',uid)
    return {'ok':True}
