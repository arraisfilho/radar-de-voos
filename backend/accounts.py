"""Accounts, contact normalization and revocable server-side sessions."""
import hmac
import json
import math
import os
import re
import threading
from contextlib import contextmanager
from datetime import datetime,timezone
from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
import hashlib
import secrets
import time
import sqlite3
from ipaddress import ip_address, ip_network
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from email_validator import validate_email, EmailNotValidError
import phonenumbers
from pydantic import BaseModel, Field, field_validator, model_validator
from fastapi import HTTPException, Request
from . import store
from .store import db
from .network import public_mode

HASHER = PasswordHasher()
DUMMY_HASH = HASHER.hash(secrets.token_urlsafe(32))
COOKIE = "radar_session"
SESSION_SECONDS = 7 * 86400
# Login limits: per address and per account, the account limit applies to unknown phones too.
LOGIN_WINDOW = 900
ADDRESS_LIMIT = 10
ACCOUNT_LIMIT = 5
LOCK_STEPS = (60, 120, 240, 480, 900)
SERIES_GAP = 3600
LOGIN_HISTORY = 86400
THROTTLED = "Muitas tentativas. Aguarde alguns minutos e tente novamente."
# Argon2 is memory-hard: bound concurrent hashes/verifications for the whole process.
PASSWORD_SLOTS = threading.BoundedSemaphore(4)
# A short wait: waiting requests hold threads of the pool shared by every sync route.
PASSWORD_WAIT = 0.3
BUSY = "Serviço temporariamente ocupado. Tente novamente em alguns segundos."
# Server secret for the per-account limit key; created on first use, kept with the other secrets.
LIMIT_SECRET_FILE = "login-limit-private.json"
LIMIT_SECRET_LOCK = threading.Lock()


@contextmanager
def password_slot():
    if not PASSWORD_SLOTS.acquire(timeout=PASSWORD_WAIT):
        raise HTTPException(503, BUSY, headers={"Retry-After": "5"})
    try:
        yield
    finally:
        PASSWORD_SLOTS.release()


def hash_password(password):
    with password_slot():
        return HASHER.hash(password)


def verify_password(password_hash, password):
    with password_slot():
        try:
            return HASHER.verify(password_hash, password)
        except (VerificationError, InvalidHashError):
            return False


def phone_e164(value, country):
    try:
        parsed = phonenumbers.parse(value, country)
    except phonenumbers.NumberParseException:
        raise ValueError("Informe um telefone válido, com DDD ou código de área")
    if parsed.extension or not phonenumbers.is_valid_number(parsed):
        raise ValueError("Informe um telefone válido, com DDD ou código de área")
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)


def clean_emails(values):
    result = []
    for value in values:
        try:
            email = validate_email(value.strip(), check_deliverability=False, allow_smtputf8=False).ascii_email
        except EmailNotValidError:
            raise ValueError("Informe endereços de e-mail válidos")
        if email.casefold() not in {v.casefold() for v in result}:
            result.append(email)
    return result


class PhoneContact(BaseModel):
    country: str = Field(max_length=2)
    phone: str = Field(min_length=4,max_length=50)

    @model_validator(mode='after')
    def normalize(self):
        self.country=self.country.upper()
        if self.country not in phonenumbers.SUPPORTED_REGIONS:raise ValueError('Selecione um país válido')
        self.phone=phone_e164(self.phone,self.country)
        return self


class Contacts(BaseModel):
    additional_phones: list[PhoneContact] = Field(default_factory=list,max_length=4)
    name: str = Field(min_length=2, max_length=80)
    emails: list[str] = Field(default_factory=list, max_length=4)
    telegram_username: str = Field(default="",max_length=33)
    timezone: str = Field(default="UTC",max_length=80)
    quiet_hours: bool = False
    quiet_start: str = "22:00"
    quiet_end: str = "08:00"
    whatsapp_use_login: bool = True
    whatsapp_country: str = "BR"
    whatsapp_phone: str | None = Field(default=None, max_length=50)

    @field_validator('timezone')
    @classmethod
    def timezone_valid(cls,value):
        try:ZoneInfo(value)
        except (ZoneInfoNotFoundError,ValueError):raise ValueError('Escolha um fuso horário válido')
        return value

    @field_validator('quiet_start','quiet_end')
    @classmethod
    def quiet_time_valid(cls,value):
        if not re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]',value):raise ValueError('Informe um horário válido')
        return value

    @field_validator('additional_phones')
    @classmethod
    def phones_unique(cls,values):
        return list({item.phone:item for item in values}.values())

    @field_validator("telegram_username")
    @classmethod
    def telegram_valid(cls,value):
        value=value.strip().lstrip("@")
        if value and not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{4,31}",value):
            raise ValueError("Informe o usuário Telegram com 5 a 32 caracteres: letras, números e sublinhado")
        return value

    @field_validator("name")
    @classmethod
    def name_valid(cls, value):
        value = value.strip()
        if len(value) < 2 or any(ord(c) < 32 for c in value):
            raise ValueError("Informe seu nome")
        return value

    @field_validator("emails")
    @classmethod
    def emails_valid(cls, values):
        return clean_emails(values)

    @field_validator("whatsapp_country")
    @classmethod
    def country_valid(cls, value):
        value = value.upper()
        if value not in phonenumbers.SUPPORTED_REGIONS:
            raise ValueError("Selecione um país válido")
        return value

    @model_validator(mode="after")
    def whatsapp_valid(self):
        if self.quiet_hours and self.quiet_start==self.quiet_end:raise ValueError('O horário silencioso deve ter início e fim diferentes')
        if self.whatsapp_use_login:
            self.whatsapp_phone = None
        else:
            self.whatsapp_phone = phone_e164(self.whatsapp_phone or "", self.whatsapp_country)
        return self


class Registration(Contacts):
    country: str
    phone: str = Field(min_length=4, max_length=50)
    password: str = Field(min_length=10, max_length=200)

    @field_validator("country")
    @classmethod
    def login_country_valid(cls, value):
        return Contacts.country_valid(value)

    @model_validator(mode="after")
    def phone_valid(self):
        self.phone = phone_e164(self.phone, self.country)
        return self


class Login(BaseModel):
    country: str = Field(max_length=2)
    phone: str = Field(min_length=4, max_length=50)
    password: str = Field(min_length=1, max_length=200)


def phone_display(value):
    """E.164 login phone in international notation, e.g. +55 11 98765-4321."""
    try:
        return phonenumbers.format_number(phonenumbers.parse(value, None), phonenumbers.PhoneNumberFormat.INTERNATIONAL)
    except phonenumbers.NumberParseException:
        return value


def public_user(row):
    import json
    return {"search_limit":row["search_limit"],"additional_phones":json.loads(row["additional_phones"]),"id":row["id"], "name":row["name"], "role":row["role"], "country":row["country"],
            "timezone":row["timezone"],"quiet_hours":bool(row["quiet_hours"]),"quiet_start":row["quiet_start"],"quiet_end":row["quiet_end"],"language":row["language"], "telegram_username":row["telegram_username"], "phone":row["phone"], "phone_display":phone_display(row["phone"]), "phone_verified":False, "emails":json.loads(row["emails"]),
            "whatsapp_use_login":bool(row["whatsapp_use_login"]), "whatsapp_country":row["whatsapp_country"],
            "whatsapp_phone":row["phone"] if row["whatsapp_use_login"] else row["whatsapp_phone"]}


def current_user(request: Request, required=True, timeout=15):
    token = request.cookies.get(COOKIE, "")
    row = None
    if token:
        with db(timeout) as c:
            row = c.execute("SELECT u.* FROM accounts u JOIN sessions s ON s.user_id=u.id WHERE s.digest=? AND s.expires>?", (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
    if not row and required:
        raise HTTPException(401,"Entre na sua conta para continuar")
    return public_user(row) if row else None


def require_admin(request):
    user = current_user(request)
    if user["role"] != "admin":
        raise HTTPException(403,"Esta configuração é exclusiva do administrador")
    return user


def can_bootstrap(request):
    if public_mode():return False
    try:
        local = ip_address(request.client.host).is_loopback
    except (ValueError, AttributeError):
        local = bool(request.client and request.client.host == "testclient" and request.url.hostname == "testserver")
    with db() as c:
        return local and not c.execute("SELECT 1 FROM accounts WHERE role='admin'").fetchone()


def establish_session(c, user_id, response):
    token = secrets.token_urlsafe(40)
    c.execute("DELETE FROM sessions WHERE expires<=?",(time.time(),))
    c.execute("INSERT INTO sessions(digest,user_id,expires) VALUES(?,?,?)",(hashlib.sha256(token.encode()).hexdigest(),user_id,time.time()+SESSION_SECONDS))
    response.set_cookie(COOKIE,token,max_age=SESSION_SECONDS,httponly=True,samesite="strict",secure=public_mode(),path="/")


def register(data, response, admin=False):
    import json
    uid = secrets.token_hex(16)
    password_hash = hash_password(data.password)
    if admin:
        with db() as c:
            existing = c.execute("SELECT * FROM accounts WHERE phone=?",(data.phone,)).fetchone()
        if existing:
            valid = verify_password(existing["password_hash"],data.password)
            if not valid:
                raise HTTPException(409,"Esse telefone já tem conta. Use a senha existente para configurar o administrador.")
            with db() as c:
                if c.execute("SELECT 1 FROM accounts WHERE role='admin'").fetchone():
                    raise HTTPException(409,"O administrador já foi cadastrado")
                try:
                    c.execute("UPDATE accounts SET role='admin' WHERE id=?",(existing["id"],))
                except sqlite3.IntegrityError:
                    raise HTTPException(409,"O administrador já foi cadastrado")
                c.execute("UPDATE searches SET owner_id=? WHERE owner_id IS NULL",(existing["id"],))
                establish_session(c,existing["id"],response)
                return public_user(c.execute("SELECT * FROM accounts WHERE id=?",(existing["id"],)).fetchone())
    try:
        with db() as c:
            if admin and c.execute("SELECT 1 FROM accounts WHERE role='admin'").fetchone():
                raise HTTPException(409,"O administrador já foi cadastrado")
            c.execute("INSERT INTO accounts(id,name,role,country,phone,password_hash,emails,whatsapp_use_login,whatsapp_country,whatsapp_phone,created,telegram_username) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",(uid,data.name,"admin" if admin else "user",data.country,data.phone,password_hash,json.dumps(data.emails),int(data.whatsapp_use_login),data.whatsapp_country,data.whatsapp_phone,time.time(),data.telegram_username))
            c.execute("UPDATE accounts SET timezone=?,quiet_hours=?,quiet_start=?,quiet_end=?,additional_phones=? WHERE id=?",(data.timezone,int(data.quiet_hours),data.quiet_start,data.quiet_end,json.dumps([p.model_dump() for p in data.additional_phones]),uid))
            if admin:
                c.execute("UPDATE searches SET owner_id=? WHERE owner_id IS NULL",(uid,))
            establish_session(c,uid,response)
            return public_user(c.execute("SELECT * FROM accounts WHERE id=?",(uid,)).fetchone())
    except sqlite3.IntegrityError:
        raise HTTPException(409,"Não foi possível cadastrar esse telefone. Se já tem conta, entre.")


def limit_secret():
    """HMAC key of the login limits, from a private 0600 file in the data directory."""
    path = store.DATA_DIR / LIMIT_SECRET_FILE
    with LIMIT_SECRET_LOCK:
        try:
            value = bytes.fromhex(json.loads(path.read_text())["secret"])
            if len(value) >= 32:
                return value
        except (FileNotFoundError, ValueError, KeyError, TypeError):
            # Missing or unreadable: a new secret; earlier counters stop matching and expire.
            pass
        value = secrets.token_bytes(32)
        store.DATA_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
        temp = path.with_suffix("."+secrets.token_hex(6)+".tmp")
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as file:
            json.dump({"secret": value.hex()}, file)
        temp.replace(path)
        return value


def limit_key(value):
    return hmac.new(limit_secret(), value.encode(), hashlib.sha256).hexdigest()


def login_key(data):
    """Normalized phone (or None) and the limit key: an HMAC with a server secret, never the number.

    Keys from the former unsalted SHA-256 no longer match and expire with LOGIN_HISTORY.
    """
    country = data.country.upper()
    try:
        phone = phone_e164(data.phone, country)
    except ValueError:
        # Invalid input never matches an account but keeps a counter of its own.
        return None, limit_key("invalid:"+country+":"+re.sub(r"\D", "", data.phone))
    return phone, limit_key(phone)


def limit_address(host):
    """Key of the per-address login limit: the IPv6 /64 network (one subscriber usually holds a
    whole /64), the IPv4 address itself (also when IPv4-mapped), or the raw value if not an IP."""
    try:
        address = ip_address(host)
    except ValueError:
        return host
    if address.version == 6 and address.ipv4_mapped:
        return str(address.ipv4_mapped)
    if address.version == 6:
        return str(ip_network((address, 64), strict=False))
    return str(address)


def clear_login_failures(c, phone):
    """Forget the account's failures, and so its lock, after a password reset (as a successful login does)."""
    c.execute("DELETE FROM login_attempts WHERE account=?", (limit_key(phone),))


def account_lock_until(times):
    """Moment an account may try again, from its failure times in ascending order.

    The fifth failure within LOGIN_WINDOW locks for LOCK_STEPS[0]; each later failure
    of the same series uses the next step, capped at the last. A series ends after
    SERIES_GAP without failures; a successful login or a password reset deletes the
    account's failures.
    """
    level, until, start = 0, 0.0, 0
    for index, moment in enumerate(times):
        if index and moment-times[index-1] >= SERIES_GAP:
            level, until, start = 0, 0.0, index
        recent = sum(1 for value in times[start:index+1] if value > moment-LOGIN_WINDOW)
        if level or recent >= ACCOUNT_LIMIT:
            until = moment+LOCK_STEPS[min(level, len(LOCK_STEPS)-1)]
            level += 1
    return until


def reserve_login(c, address, account, now):
    """Decide and reserve one attempt inside the caller's BEGIN IMMEDIATE transaction.

    Returns (rowid, 0) when allowed, or (None, seconds) when limited. The reserved row
    already counts as a failure, so concurrent attempts cannot exceed the limits.
    """
    c.execute("DELETE FROM login_attempts WHERE created<? OR (account IS NULL AND created<?)", (now-LOGIN_HISTORY, now-LOGIN_WINDOW))
    by_address = [r[0] for r in c.execute("SELECT created FROM login_attempts WHERE address=? AND created>? ORDER BY created", (address, now-LOGIN_WINDOW))]
    by_account = [r[0] for r in c.execute("SELECT created FROM login_attempts WHERE account=? ORDER BY created", (account,))]
    waits = []
    if len(by_address) >= ADDRESS_LIMIT:
        waits.append(by_address[len(by_address)-ADDRESS_LIMIT]+LOGIN_WINDOW-now)
    until = account_lock_until(by_account)
    if until > now:
        waits.append(until-now)
    if waits:
        return None, max(1, math.ceil(max(waits)))
    return c.execute("INSERT INTO login_attempts(address,created,account) VALUES(?,?,?)", (address, now, account)).lastrowid, 0


def authenticate(data, request, response):
    phone, account = login_key(data)
    address = limit_address(request.client.host if request.client else "unknown")
    now = time.time()
    with db() as c:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute("SELECT * FROM accounts WHERE phone=?", (phone,)).fetchone() if phone else None
        attempt, wait = reserve_login(c, address, account, now)
    from .audit import record
    user_id = row["id"] if row else None
    if attempt is None:
        # Same answer for existing and unknown phones: counting does not depend on the account row.
        record(request, "login_throttled", user_id)
        raise HTTPException(429, THROTTLED, headers={"Retry-After": str(wait)})
    try:
        valid = verify_password(row["password_hash"] if row else DUMMY_HASH, data.password) and row is not None
    except HTTPException:
        # No verification happened, so the busy answer must not count as a failure.
        with db() as c:
            c.execute("DELETE FROM login_attempts WHERE rowid=?", (attempt,))
        raise
    if valid:
        with db() as c:
            c.execute("BEGIN IMMEDIATE")
            # Reset only this account; failures from this address against other accounts remain.
            c.execute("DELETE FROM login_attempts WHERE account=?", (account,))
            establish_session(c, row["id"], response)
    record(request, "login_success" if valid else "login_failed", user_id)
    if not valid:
        raise HTTPException(401, "Telefone ou senha incorretos")
    return public_user(row)


def update_contacts(user_id, data):
    with db() as c:
        return update_contacts_in(c,user_id,data)


def update_contacts_in(c,user_id,data):
    import json
    previous = c.execute("SELECT emails FROM accounts WHERE id=?",(user_id,)).fetchone()
    if previous and json.loads(previous["emails"]) != data.emails:
        c.execute("UPDATE outbox SET status='cancelled' WHERE id IN (SELECT outbox_id FROM password_resets WHERE user_id=?) AND status='pending'",(user_id,))
        c.execute("UPDATE password_resets SET used=1 WHERE user_id=?",(user_id,))
        pending = c.execute("SELECT id,alert_ids FROM outbox WHERE channel='email' AND status='pending' AND search_id IN (SELECT id FROM searches WHERE owner_id=?)",(user_id,)).fetchall()
        for row in pending:
            c.execute("UPDATE outbox SET status='cancelled' WHERE id=?",(row["id"],))
            from .notifications import sync_alerts
            sync_alerts(c,json.loads(row['alert_ids']))
    c.execute("UPDATE accounts SET name=?,emails=?,additional_phones=?,telegram_username=?,whatsapp_use_login=?,whatsapp_country=?,whatsapp_phone=?,timezone=?,quiet_hours=?,quiet_start=?,quiet_end=? WHERE id=?",(data.name,json.dumps(data.emails),json.dumps([p.model_dump() for p in data.additional_phones]),data.telegram_username,int(data.whatsapp_use_login),data.whatsapp_country,data.whatsapp_phone,data.timezone,int(data.quiet_hours),data.quiet_start,data.quiet_end,user_id))
    return public_user(c.execute("SELECT * FROM accounts WHERE id=?",(user_id,)).fetchone())


def alert_recipients(c, search_id):
    import json
    row=c.execute("SELECT a.emails FROM accounts a JOIN searches s ON s.owner_id=a.id WHERE s.id=?",(search_id,)).fetchone()
    return json.loads(row["emails"]) if row else []


def is_quiet(config,now=None):
    if not config['quiet_hours']:return False
    local=datetime.fromtimestamp(now if now is not None else time.time(),timezone.utc).astimezone(ZoneInfo(config['timezone'])).strftime('%H:%M')
    start,end=config['quiet_start'],config['quiet_end']
    return start<=local<end if start<end else local>=start or local<end


def search_is_quiet(c,sid,now=None):
    row=c.execute('SELECT a.* FROM accounts a JOIN searches s ON s.owner_id=a.id WHERE s.id=?',(sid,)).fetchone()
    return is_quiet(row,now) if row else False


def ensure_search_capacity(c,user_id):
    limit=c.execute('SELECT search_limit FROM accounts WHERE id=?',(user_id,)).fetchone()[0]
    count=c.execute('SELECT COUNT(*) FROM searches WHERE archived=0 AND owner_id=?',(user_id,)).fetchone()[0]
    if count>=limit:
        raise HTTPException(422,'Limite de buscas atingido. Encerre um monitoramento ou solicite um ajuste ao administrador.')
