"""Opaque, expiring redirects to an allowlisted flight search; no account data."""
import os
import re
import secrets
import time
from urllib.parse import urlsplit
from .network import public_mode, public_origin


def setup(c):
    c.execute('''CREATE TABLE IF NOT EXISTS offer_links(
      token TEXT PRIMARY KEY, alert_id TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
      target TEXT NOT NULL, expires REAL NOT NULL)''')
    c.execute('CREATE INDEX IF NOT EXISTS offer_links_expiry ON offer_links(expires)')


def valid_target(value):
    if not isinstance(value,str):return False
    try:
        url=urlsplit(value)
        return (len(value)<=8000 and not any(ord(ch)<32 for ch in value)
                and url.scheme=='https' and url.hostname=='www.google.com'
                and url.port in (None,443) and not url.username and not url.password
                and url.path=='/travel/flights/search' and not url.fragment)
    except (ValueError,TypeError):return False


def origin():
    if public_mode():return public_origin()
    value=os.environ.get('RADAR_PUBLIC_URL','http://127.0.0.1:8765').rstrip('/')
    parsed=urlsplit(value)
    if (parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username
        or parsed.password or parsed.path or parsed.query or parsed.fragment
        or any(ord(ch)<32 for ch in value)):
        raise ValueError('RADAR_PUBLIC_URL deve ser uma origem HTTP(S) válida')
    return value


def create(c,aid,target):
    if not valid_target(target):return ''
    token=secrets.token_urlsafe(12)
    # Links contain no session credentials and stop resolving after 30 days.
    c.execute('INSERT INTO offer_links VALUES(?,?,?,?)',(token,aid,target,time.time()+30*86400))
    return origin()+'/go/'+token


def resolve(c,token):
    if not re.fullmatch(r'[A-Za-z0-9_-]{16}',token):return None
    row=c.execute('SELECT target FROM offer_links WHERE token=? AND expires>?',(token,time.time())).fetchone()
    return row['target'] if row and valid_target(row['target']) else None
