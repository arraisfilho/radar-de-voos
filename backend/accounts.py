"""Accounts, contact normalization and revocable server-side sessions."""
import re
from datetime import datetime,timezone
from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
import hashlib
import secrets
import time
import sqlite3
from ipaddress import ip_address
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from email_validator import validate_email, EmailNotValidError
import phonenumbers
from pydantic import BaseModel, Field, field_validator, model_validator
from fastapi import HTTPException, Request
from .store import db
from .network import public_mode

HASHER = PasswordHasher()
DUMMY_HASH = HASHER.hash(secrets.token_urlsafe(32))
COOKIE = "radar_session"
SESSION_SECONDS = 7 * 86400


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


def public_user(row):
    import json
    return {"search_limit":row["search_limit"],"additional_phones":json.loads(row["additional_phones"]),"id":row["id"], "name":row["name"], "role":row["role"], "country":row["country"],
            "timezone":row["timezone"],"quiet_hours":bool(row["quiet_hours"]),"quiet_start":row["quiet_start"],"quiet_end":row["quiet_end"],"language":row["language"], "telegram_username":row["telegram_username"], "phone":row["phone"], "phone_verified":False, "emails":json.loads(row["emails"]),
            "whatsapp_use_login":bool(row["whatsapp_use_login"]), "whatsapp_country":row["whatsapp_country"],
            "whatsapp_phone":row["phone"] if row["whatsapp_use_login"] else row["whatsapp_phone"]}


def current_user(request: Request, required=True):
    token = request.cookies.get(COOKIE, "")
    row = None
    if token:
        with db() as c:
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
    password_hash = HASHER.hash(data.password)
    if admin:
        with db() as c:
            existing = c.execute("SELECT * FROM accounts WHERE phone=?",(data.phone,)).fetchone()
        if existing:
            try:
                valid = HASHER.verify(existing["password_hash"],data.password)
            except (VerificationError,InvalidHashError):
                valid = False
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


def authenticate(data, request, response):
    try:
        phone = phone_e164(data.phone,data.country.upper())
    except ValueError:
        phone = "invalid"
    key = request.client.host if request.client else "unknown"
    now = time.time()
    with db() as c:
        c.execute("DELETE FROM login_attempts WHERE created<?",(now-900,))
        limited=c.execute("SELECT COUNT(*) FROM login_attempts WHERE address=?",(key,)).fetchone()[0] >= 10
        row=c.execute("SELECT * FROM accounts WHERE phone=?",(phone,)).fetchone()
    if limited:
        from .audit import record
        record(request,'login_throttled')
        raise HTTPException(429,"Muitas tentativas. Aguarde alguns minutos e tente novamente.")
    try:
        valid=HASHER.verify(row["password_hash"] if row else DUMMY_HASH,data.password) and row is not None
    except (VerificationError,InvalidHashError):
        valid=False
    with db() as c:
        if not valid:
            c.execute("INSERT INTO login_attempts(address,created) VALUES(?,?)",(key,now))
        else:
            c.execute("DELETE FROM login_attempts WHERE address=?",(key,))
            establish_session(c,row["id"],response)
    from .audit import record
    record(request,'login_success' if valid else 'login_failed',row['id'] if row else None)
    if not valid:
        raise HTTPException(401,"Telefone ou senha incorretos")
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
