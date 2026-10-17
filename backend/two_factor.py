"""Second factor for the administrator: authenticator codes (TOTP, RFC 6238) and one-time
recovery codes.

The authenticator secret is never stored. It is an HMAC of a per-enrollment salt, kept in the
database, with a server key from a private 0600 file: a copy of the database alone does not
reveal it. Recovery codes are kept as SHA-256 digests bound to the account.
"""
import base64
import hashlib
import hmac
import json
import logging
import math
import re
import secrets
import time
from urllib.parse import quote, urlencode
from fastapi import HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator
from . import accounts, audit, store
from .network import public_mode
from .store import db

logger = logging.getLogger("radar.two_factor")
KEY_FILE = "two-factor-private.json"
ISSUER = "Radar de Voos"
PERIOD = 30
DIGITS = 6
# Steps accepted before and after the current one: about 30 seconds of clock difference either way.
DRIFT = 1
# An enrollment is confirmed within ten minutes and five wrong codes, or starts over.
SETUP_SECONDS = 600
SETUP_ATTEMPTS = 5
# After the password, the second step stays open for five minutes; a few per account and address.
CHALLENGE_SECONDS = 300
CHALLENGE_COOKIE = "radar_2fa"
CHALLENGE_PATH = "/api/auth/login"
CHALLENGE_LIMIT = 5
# The login limits allow four failures every 15 minutes without ever locking: enough for a
# password, not for six digits. Wrong authenticator codes also have a budget per account in any
# 24 hours, kept whoever signs in meanwhile; recovery codes (about 79 random bits) stay outside it.
CODE_LIMIT = 10
CODE_WINDOW = 86400
RECOVERY_CODES = 10
# Lowercase letters and digits without 0/o and 1/i/l.
RECOVERY_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"
RECOVERY_LENGTH = 16
EXPIRED = "A verificação expirou. Entre novamente."
WRONG_CODE = "Código incorreto."
CODES_EXHAUSTED = "Muitos códigos incorretos. Use um código de recuperação ou tente mais tarde."
KEY_UNAVAILABLE = "Código do aplicativo indisponível no momento. Use um código de recuperação."
ALREADY_ENABLED = "A verificação em duas etapas já está ativa."
NOT_ENABLED = "A verificação em duas etapas não está ativa."
SETUP_WRONG_CODE = "Código incorreto. Confira o horário do celular e tente de novo."
SETUP_EXPIRED = "A configuração expirou. Comece de novo."
WRONG_PASSWORD = "Senha incorreta."
SIGNED_OUT = "Entre na sua conta para continuar"


def clean_code(value):
    value = re.sub(r"\s", "", value)
    if not re.fullmatch("[0-9]{%d}" % DIGITS, value):
        raise ValueError("Informe o código de 6 dígitos")
    return value


def clean_recovery(value):
    value = re.sub(r"[\s-]", "", value).lower()
    if not re.fullmatch("[a-z0-9]{%d}" % RECOVERY_LENGTH, value):
        raise ValueError("Informe um código de recuperação válido")
    return value


class Code(BaseModel):
    code: str = Field(max_length=20)

    @field_validator("code")
    @classmethod
    def code_valid(cls, value):
        return clean_code(value)


class SecondStep(BaseModel):
    """Exactly one of the authenticator code and a recovery code."""
    code: str = Field(default="", max_length=20)
    recovery_code: str = Field(default="", max_length=40)

    @model_validator(mode="after")
    def one_code(self):
        if bool(self.code.strip()) == bool(self.recovery_code.strip()):
            raise ValueError("Informe o código do aplicativo ou um código de recuperação")
        self.code = clean_code(self.code) if self.code.strip() else ""
        self.recovery_code = clean_recovery(self.recovery_code) if self.recovery_code.strip() else ""
        return self


class Password(BaseModel):
    password: str = Field(min_length=1, max_length=200)


def setup(c):
    # enabled stays NULL until the first code confirms the enrollment; last_step blocks code reuse.
    c.execute("CREATE TABLE IF NOT EXISTS two_factor(user_id TEXT PRIMARY KEY REFERENCES accounts(id),salt TEXT NOT NULL,"
              "created REAL NOT NULL,enabled REAL,attempts INTEGER NOT NULL DEFAULT 0,last_step INTEGER)")
    c.execute("CREATE TABLE IF NOT EXISTS two_factor_recovery(user_id TEXT NOT NULL REFERENCES accounts(id),digest TEXT NOT NULL,"
              "used REAL,PRIMARY KEY(user_id,digest))")
    c.execute("CREATE TABLE IF NOT EXISTS two_factor_challenges(digest TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id),"
              "address TEXT NOT NULL DEFAULT '',created REAL NOT NULL,expires REAL NOT NULL)")
    # Development databases created this table, and its index, without the address.
    if "address" not in {r[1] for r in c.execute("PRAGMA table_info(two_factor_challenges)")}:
        c.execute("ALTER TABLE two_factor_challenges ADD COLUMN address TEXT NOT NULL DEFAULT ''")
        c.execute("DROP INDEX IF EXISTS two_factor_challenges_user")
    c.execute("CREATE INDEX IF NOT EXISTS two_factor_challenges_user ON two_factor_challenges(user_id,address,created)")
    c.execute("CREATE TABLE IF NOT EXISTS two_factor_failures(user_id TEXT NOT NULL REFERENCES accounts(id),created REAL NOT NULL)")
    c.execute("CREATE INDEX IF NOT EXISTS two_factor_failures_user ON two_factor_failures(user_id,created)")


def totp(secret, step, digits=DIGITS):
    """RFC 6238 code: HMAC-SHA-1 of the time step, with the dynamic truncation of RFC 4226."""
    digest = hmac.new(secret, step.to_bytes(8, "big"), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = int.from_bytes(digest[offset:offset + 4], "big") & 0x7FFFFFFF
    return str(value % 10 ** digits).zfill(digits)


def server_key(c):
    """Key of the authenticator secrets, from a private 0600 file in the data directory.

    Created on first use. Missing or unreadable while an enrollment is active, or present but
    not readable at all (permissions), it is neither replaced nor overwritten: authenticator
    codes get HTTP 503 until the file is restored, and recovery codes, which do not depend on
    it, still sign in.
    """
    replaceable = True
    try:
        value = bytes.fromhex(json.loads((store.DATA_DIR / KEY_FILE).read_text())["secret"])
        if len(value) >= 32:
            return value
    except (FileNotFoundError, ValueError, KeyError, TypeError):
        pass
    except OSError:
        # Present but not readable (permissions, a folder in its place): never written over.
        replaceable = False
    if replaceable and not c.execute("SELECT 1 FROM two_factor WHERE enabled IS NOT NULL").fetchone():
        return accounts.private_secret(KEY_FILE)
    logger.error("Two-factor key file missing or unreadable; restore it from the backup.",
                 extra={"event": "two_factor_key_unavailable"})
    raise HTTPException(503, KEY_UNAVAILABLE)


def secret_for(key, user_id, salt):
    """160-bit authenticator secret of one enrollment, the size RFC 4226 recommends."""
    return hmac.new(key, ("totp:" + user_id + ":" + salt).encode(), hashlib.sha256).digest()[:20]


def provisioning_uri(phone, secret):
    """otpauth:// URI (Key URI Format) that authenticator apps read from the QR code."""
    query = urlencode({"secret": secret, "issuer": ISSUER, "algorithm": "SHA1", "digits": DIGITS, "period": PERIOD}, quote_via=quote)
    return "otpauth://totp/" + quote(ISSUER, safe="") + ":" + quote(phone, safe="") + "?" + query


def accepted_step(secret, code, last_step, now):
    """Time step of a valid code within DRIFT steps of now and after the last one accepted, or None."""
    current = int(now // PERIOD)
    for step in range(current - DRIFT, current + DRIFT + 1):
        if (last_step is None or step > last_step) and hmac.compare_digest(totp(secret, step), code):
            return step
    return None


def recovery_digest(user_id, code):
    """SHA-256 bound to the account: a code has about 79 random bits, so no slow hash is needed."""
    return hashlib.sha256(("recovery:" + user_id + ":" + code).encode()).hexdigest()


def new_recovery_codes():
    codes = []
    while len(codes) < RECOVERY_CODES:
        code = "".join(secrets.choice(RECOVERY_ALPHABET) for _ in range(RECOVERY_LENGTH))
        if code not in codes:
            codes.append(code)
    return codes


def grouped(code):
    return "-".join(code[index:index + 4] for index in range(0, len(code), 4))


def token_digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def enabled(c, user_id):
    return c.execute("SELECT 1 FROM two_factor WHERE user_id=? AND enabled IS NOT NULL", (user_id,)).fetchone() is not None


def state(c, user_id):
    row = c.execute("SELECT enabled FROM two_factor WHERE user_id=? AND enabled IS NOT NULL", (user_id,)).fetchone()
    remaining = c.execute("SELECT COUNT(*) FROM two_factor_recovery WHERE user_id=? AND used IS NULL", (user_id,)).fetchone()[0] if row else 0
    return {"enabled": bool(row), "enabled_at": row["enabled"] if row else None, "recovery_codes_remaining": remaining}


def status(user):
    with db() as c:
        return state(c, user["id"])


def forget(c, user_id):
    """Remove the enrollment salt, the recovery codes, open second steps and the wrong-code budget."""
    for table in ("two_factor", "two_factor_recovery", "two_factor_challenges", "two_factor_failures"):
        c.execute("DELETE FROM " + table + " WHERE user_id=?", (user_id,))


def current_session(c, request, user_id):
    """True while the request's session is open: a password reset in the meantime revokes it."""
    return c.execute("SELECT 1 FROM sessions WHERE digest=? AND user_id=? AND expires>?",
                     (token_digest(request.cookies.get(accounts.COOKIE, "")), user_id, time.time())).fetchone() is not None


def check_password(request, user_id, password):
    """Password check before turning the second factor on or off, under the login limits: a wrong
    password counts as a login failure. Returns the reservation and the verified hash."""
    with db() as c:
        row = c.execute("SELECT phone,password_hash FROM accounts WHERE id=?", (user_id,)).fetchone()
    address = accounts.limit_address(request.client.host if request.client else "unknown")
    with db() as c:
        c.execute("BEGIN IMMEDIATE")
        attempt, wait = accounts.reserve_login(c, address, accounts.limit_key(row["phone"]), time.time())
    if attempt is None:
        audit.record(request, "login_throttled", user_id)
        raise HTTPException(429, accounts.THROTTLED, headers={"Retry-After": str(wait)})
    try:
        valid = accounts.verify_password(row["password_hash"], password)
    except HTTPException:
        # No verification happened, so the busy answer must not count as a failure.
        with db() as c:
            c.execute("DELETE FROM login_attempts WHERE rowid=?", (attempt,))
        raise
    if not valid:
        # The reservation stays as the account's failure, as in a refused login.
        audit.record(request, "login_failed", user_id)
        raise HTTPException(403, WRONG_PASSWORD)
    return attempt, row["password_hash"]


def still_current(c, request, user_id, attempt, verified):
    """In the final transaction: the reservation goes back, and the verified hash and this session
    must still be current. A password reset during the check replaces one and revokes the other."""
    c.execute("DELETE FROM login_attempts WHERE rowid=?", (attempt,))
    current = c.execute("SELECT password_hash FROM accounts WHERE id=?", (user_id,)).fetchone()
    return current is not None and current["password_hash"] == verified and current_session(c, request, user_id)


def release(attempt):
    """The password was right but the change failed (and rolled back the release): no failure stays."""
    with db() as c:
        c.execute("DELETE FROM login_attempts WHERE rowid=?", (attempt,))


def begin(request, user, data):
    """Start an enrollment, or replace one not yet confirmed, after the password; the login changes
    only after confirm(). A session alone, without the password, cannot bind an authenticator."""
    uid = user["id"]
    with db() as c:
        if enabled(c, uid):
            raise HTTPException(409, ALREADY_ENABLED)
    attempt, verified = check_password(request, uid, data.password)
    salt = secrets.token_hex(16)
    try:
        with db() as c:
            c.execute("BEGIN IMMEDIATE")
            if not still_current(c, request, uid, attempt, verified):
                failure = (401, SIGNED_OUT)
            elif enabled(c, uid):
                failure = (409, ALREADY_ENABLED)
            else:
                failure = None
                c.execute("INSERT OR REPLACE INTO two_factor(user_id,salt,created,enabled,attempts,last_step) VALUES(?,?,?,NULL,0,NULL)",
                          (uid, salt, time.time()))
                secret = base64.b32encode(secret_for(server_key(c), uid, salt)).decode()
    except Exception:
        release(attempt)
        raise
    if failure:
        raise HTTPException(*failure)
    return {"secret": secret, "uri": provisioning_uri(user["phone"], secret), "expires_in": SETUP_SECONDS}


def confirm(request, user, data):
    """The first valid code turns the second factor on, issues the recovery codes and ends the
    account's other sessions, which were opened with the password alone."""
    uid, now = user["id"], time.time()
    session = token_digest(request.cookies.get(accounts.COOKIE, ""))
    failure = None
    with db() as c:
        c.execute("BEGIN IMMEDIATE")
        if not current_session(c, request, uid):
            raise HTTPException(401, SIGNED_OUT)
        row = c.execute("SELECT * FROM two_factor WHERE user_id=?", (uid,)).fetchone()
        if row and row["enabled"] is not None:
            raise HTTPException(409, ALREADY_ENABLED)
        if not row or row["created"]+SETUP_SECONDS <= now or row["attempts"] >= SETUP_ATTEMPTS:
            c.execute("DELETE FROM two_factor WHERE user_id=?", (uid,))
            failure = (410, SETUP_EXPIRED)
        else:
            step = accepted_step(secret_for(server_key(c), uid, row["salt"]), data.code, None, now)
            if step is None:
                c.execute("UPDATE two_factor SET attempts=attempts+1 WHERE user_id=?", (uid,))
                failure = (422, SETUP_WRONG_CODE)
            else:
                codes = new_recovery_codes()
                c.execute("UPDATE two_factor SET enabled=?,attempts=0,last_step=? WHERE user_id=?", (now, step, uid))
                c.execute("DELETE FROM two_factor_recovery WHERE user_id=?", (uid,))
                c.executemany("INSERT INTO two_factor_recovery(user_id,digest) VALUES(?,?)",
                              [(uid, recovery_digest(uid, code)) for code in codes])
                revoked = c.execute("SELECT COUNT(*) FROM sessions WHERE user_id=? AND digest<>? AND expires>?",
                                    (uid, session, now)).fetchone()[0]
                c.execute("DELETE FROM sessions WHERE user_id=? AND digest<>?", (uid, session))
                c.execute("DELETE FROM two_factor_challenges WHERE user_id=?", (uid,))
                # In the same transaction: the codes are never issued without their record.
                audit.record(request, "admin_2fa_enabled", uid, uid, {"sessions_revoked": revoked}, c=c)
                result = state(c, uid)
    # Raised after the commit, so the wrong attempt (or the expired enrollment's removal) is kept.
    if failure:
        raise HTTPException(*failure)
    return {**result, "recovery_codes": [grouped(code) for code in codes]}


def disable(request, user, data):
    """Turn the second factor off after the password, checked under the login limits."""
    uid = user["id"]
    with db() as c:
        if not enabled(c, uid):
            raise HTTPException(409, NOT_ENABLED)
    attempt, verified = check_password(request, uid, data.password)
    try:
        with db() as c:
            c.execute("BEGIN IMMEDIATE")
            if not still_current(c, request, uid, attempt, verified):
                failure = (401, SIGNED_OUT)
            elif not enabled(c, uid):
                failure = (409, NOT_ENABLED)
            else:
                failure = None
                forget(c, uid)
                audit.record(request, "admin_2fa_disabled", uid, uid, c=c)
                result = state(c, uid)
    except Exception:
        release(attempt)
        raise
    if failure:
        raise HTTPException(*failure)
    return result


def open_challenge(c, user_id, address):
    """After a correct password: a random token for the second step, stored as its SHA-256 digest.

    At most CHALLENGE_LIMIT stay open per account and address: logins from elsewhere, even with
    the password, do not close the step the owner is completing.
    """
    token, now = secrets.token_urlsafe(32), time.time()
    c.execute("DELETE FROM two_factor_challenges WHERE expires<=?", (now,))
    c.execute("INSERT INTO two_factor_challenges(digest,user_id,address,created,expires) VALUES(?,?,?,?,?)",
              (token_digest(token), user_id, address, now, now+CHALLENGE_SECONDS))
    c.execute("DELETE FROM two_factor_challenges WHERE user_id=? AND address=? AND digest NOT IN "
              "(SELECT digest FROM two_factor_challenges WHERE user_id=? AND address=? ORDER BY created DESC LIMIT ?)",
              (user_id, address, user_id, address, CHALLENGE_LIMIT))
    return token


def set_challenge_cookie(response, token):
    response.set_cookie(CHALLENGE_COOKIE, token, max_age=CHALLENGE_SECONDS, httponly=True, samesite="strict",
                        secure=public_mode(), path=CHALLENGE_PATH)


def verify_login(request, response, data):
    """Second step of the login, under the limits per account and address of the password step."""
    token = request.cookies.get(CHALLENGE_COOKIE, "")
    address = accounts.limit_address(request.client.host if request.client else "unknown")
    now = time.time()
    outcome, user_id, wait = "expired", None, 0
    with db() as c:
        c.execute("BEGIN IMMEDIATE")
        c.execute("DELETE FROM two_factor_challenges WHERE expires<=?", (now,))
        c.execute("DELETE FROM two_factor_failures WHERE created<=?", (now-CODE_WINDOW,))
        row = c.execute("SELECT a.*,t.salt,t.last_step FROM two_factor_challenges h JOIN accounts a ON a.id=h.user_id "
                        "JOIN two_factor t ON t.user_id=a.id AND t.enabled IS NOT NULL WHERE h.digest=?",
                        (token_digest(token),)).fetchone() if token else None
        if row:
            user_id, account = row["id"], accounts.limit_key(row["phone"])
            attempt, wait = accounts.reserve_login(c, address, account, now)
            failures = [r[0] for r in c.execute("SELECT created FROM two_factor_failures WHERE user_id=? ORDER BY created DESC LIMIT ?",
                                                 (user_id, CODE_LIMIT))]
            if attempt is None:
                outcome = "throttled"
            elif data.code and len(failures) >= CODE_LIMIT:
                # No code is checked, so the reservation goes back.
                c.execute("DELETE FROM login_attempts WHERE rowid=?", (attempt,))
                outcome, wait = "exhausted", max(1, math.ceil(failures[-1]+CODE_WINDOW-now))
            else:
                if data.code:
                    step = accepted_step(secret_for(server_key(c), user_id, row["salt"]), data.code, row["last_step"], now)
                    passed = step is not None
                    if passed:
                        c.execute("UPDATE two_factor SET last_step=? WHERE user_id=?", (step, user_id))
                    else:
                        c.execute("INSERT INTO two_factor_failures(user_id,created) VALUES(?,?)", (user_id, now))
                else:
                    passed = c.execute("UPDATE two_factor_recovery SET used=? WHERE user_id=? AND digest=? AND used IS NULL",
                                       (now, user_id, recovery_digest(user_id, data.recovery_code))).rowcount == 1
                if passed:
                    outcome = "success"
                    c.execute("DELETE FROM two_factor_challenges WHERE digest=?", (token_digest(token),))
                    # As after a password login: this account's failures go, other accounts' remain.
                    # The wrong-code budget is not reset: it bounds the guesses in any 24 hours.
                    c.execute("DELETE FROM login_attempts WHERE account=?", (account,))
                    accounts.establish_session(c, user_id, response)
                    # In the same transaction: a recovery code is never spent without its record.
                    audit.record(request, "login_success", user_id, c=c)
                    if data.recovery_code:
                        remaining = c.execute("SELECT COUNT(*) FROM two_factor_recovery WHERE user_id=? AND used IS NULL",
                                              (user_id,)).fetchone()[0]
                        audit.record(request, "recovery_code_used", user_id, details={"remaining": remaining}, c=c)
                else:
                    # The reservation stays: it is the failure.
                    outcome = "failed"
    if outcome == "expired":
        raise HTTPException(410, EXPIRED)
    if outcome in ("throttled", "exhausted"):
        audit.record(request, "login_throttled", user_id)
        raise HTTPException(429, accounts.THROTTLED if outcome == "throttled" else CODES_EXHAUSTED, headers={"Retry-After": str(wait)})
    if outcome == "failed":
        audit.record(request, "login_2fa_failed", user_id)
        raise HTTPException(401, WRONG_CODE)
    response.delete_cookie(CHALLENGE_COOKIE, path=CHALLENGE_PATH, secure=public_mode(), httponly=True, samesite="strict")
    return accounts.public_user(row)
