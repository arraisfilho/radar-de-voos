"""Run inside the disposable runtime image, with --network none and no volumes."""
import os
os.environ['RADAR_DEPLOYMENT']='public'
os.environ['RADAR_PUBLIC_URL']='https://radar.example.com'
from fastapi import Request
from backend import store
from backend.app import app, google_callback
from backend.i18n import translate

store.setup(seed=False)
assert app is not None
assert translate('Conta conectada','es')=='Cuenta conectada'
response=google_callback(Request({'type':'http','headers':[(b'accept-language',b'es')]}),state='invalid-fixture-state')
assert response.status_code==200
body=response.body.decode()
assert 'Conexión no completada' in body
assert 'https://radar.example.com' in body
assert 'http://127.0.0.1:8765' not in body
assert response.headers['cache-control']=='no-store'
print('Runtime OAuth callback: packaged translations, HTTPS origin and safe invalid-state page passed.')

with store.db() as c:
    assert 'body_html' in {r[1] for r in c.execute('PRAGMA table_info(outbox)')}
    assert c.execute("SELECT name FROM sqlite_master WHERE name='offer_links'").fetchone()
print('Runtime alert schema: HTML transport column and expiring offer links passed.')

with store.db() as c:
    for name in ('client_refs','monitor_refs','number_accounts_insert','number_searches_insert'):
        assert c.execute('SELECT name FROM sqlite_master WHERE name=?',(name,)).fetchone()
print('Runtime stable identifiers: customer and monitoring registries/triggers passed.')
