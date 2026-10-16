"""SQLite persistence; runtime data lives outside tracked source files."""
import json
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from .domain import Search, default_search, ADAPTER_VERSION

DATA_DIR = Path(os.environ.get("RADAR_DATA_DIR", Path(__file__).resolve().parents[1] / ".data")).resolve()


@contextmanager
def db():
    DATA_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    connection = sqlite3.connect(DATA_DIR / "radar.sqlite3", timeout=15)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def setup(seed=True):
    with db() as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript("""
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
        INSERT OR IGNORE INTO schema_version VALUES (1);
        CREATE TABLE IF NOT EXISTS searches (
            id TEXT PRIMARY KEY, config TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
            active INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0,
            created REAL NOT NULL, next_due REAL, last_started REAL, last_finished REAL,
            last_success REAL, state TEXT NOT NULL DEFAULT 'scheduled', progress INTEGER DEFAULT 0,
            total INTEGER DEFAULT 0, failures INTEGER DEFAULT 0, error TEXT);
        CREATE TABLE IF NOT EXISTS cycles (
            id INTEGER PRIMARY KEY AUTOINCREMENT, search_id TEXT NOT NULL REFERENCES searches(id),
            version INTEGER NOT NULL, started REAL NOT NULL, finished REAL, status TEXT NOT NULL,
            total INTEGER NOT NULL, successes INTEGER DEFAULT 0, failures INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS results (
            id INTEGER PRIMARY KEY AUTOINCREMENT, cycle_id INTEGER NOT NULL REFERENCES cycles(id),
            search_id TEXT NOT NULL REFERENCES searches(id), version INTEGER NOT NULL,
            direction TEXT NOT NULL, route_key TEXT NOT NULL, collected REAL NOT NULL,
            status TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(cycle_id, route_key));
        CREATE INDEX IF NOT EXISTS results_search ON results(search_id, version, direction, collected);
        CREATE TABLE IF NOT EXISTS filter_result_refs (
            search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
            version INTEGER NOT NULL,
            result_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
            PRIMARY KEY(search_id,version,result_id));
        CREATE INDEX IF NOT EXISTS filter_result_refs_result ON filter_result_refs(result_id);
        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT, search_id TEXT NOT NULL REFERENCES searches(id),
            version INTEGER NOT NULL, cycle_id INTEGER NOT NULL REFERENCES cycles(id),
            direction TEXT NOT NULL, collected REAL NOT NULL, complete INTEGER NOT NULL,
            price INTEGER, flight TEXT, count INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS baselines (
            search_id TEXT NOT NULL REFERENCES searches(id), version INTEGER NOT NULL,
            direction TEXT NOT NULL, price INTEGER NOT NULL, flight TEXT NOT NULL,
            alert_floor INTEGER, alerted REAL, PRIMARY KEY(search_id, version, direction));
        CREATE TABLE IF NOT EXISTS alerts (
            id TEXT PRIMARY KEY, search_id TEXT NOT NULL REFERENCES searches(id),
            version INTEGER NOT NULL, cycle_id INTEGER NOT NULL REFERENCES cycles(id),
            direction TEXT NOT NULL, created REAL NOT NULL, kind TEXT NOT NULL,
            price INTEGER NOT NULL, previous INTEGER, payload TEXT NOT NULL,
            status TEXT NOT NULL, UNIQUE(search_id,version,direction,kind,cycle_id));
        CREATE TABLE IF NOT EXISTS outbox (
            id TEXT PRIMARY KEY, search_id TEXT REFERENCES searches(id), version INTEGER,
            created REAL NOT NULL, alert_ids TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
            status TEXT NOT NULL, attempts INTEGER DEFAULT 0, next_due REAL NOT NULL,
            error TEXT, sent REAL);
        """)
        alert_schema=c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='alerts'").fetchone()[0]
        if 'direction,kind,price' in alert_schema.replace(' ',''):
            c.execute("DELETE FROM metadata WHERE key='notification_links_v1'")
            c.execute("CREATE TABLE alerts_revised(id TEXT PRIMARY KEY,search_id TEXT NOT NULL REFERENCES searches(id),version INTEGER NOT NULL,cycle_id INTEGER NOT NULL REFERENCES cycles(id),direction TEXT NOT NULL,created REAL NOT NULL,kind TEXT NOT NULL,price INTEGER NOT NULL,previous INTEGER,payload TEXT NOT NULL,status TEXT NOT NULL,UNIQUE(search_id,version,direction,kind,cycle_id))")
            c.execute("INSERT INTO alerts_revised SELECT * FROM alerts")
            c.execute("DROP TABLE alerts")
            c.execute("ALTER TABLE alerts_revised RENAME TO alerts")
        c.executescript("""
        CREATE TABLE IF NOT EXISTS accounts (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','admin')),
            country TEXT NOT NULL, phone TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
            emails TEXT NOT NULL DEFAULT '[]', whatsapp_use_login INTEGER NOT NULL DEFAULT 1,
            whatsapp_country TEXT NOT NULL DEFAULT 'BR', whatsapp_phone TEXT, created REAL NOT NULL);
        CREATE UNIQUE INDEX IF NOT EXISTS accounts_single_admin ON accounts(role) WHERE role='admin';
        CREATE TABLE IF NOT EXISTS sessions (digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES accounts(id), expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS login_attempts (address TEXT NOT NULL, created REAL NOT NULL);
        """)
        c.execute("CREATE TABLE IF NOT EXISTS access_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT REFERENCES accounts(id),event TEXT NOT NULL,created REAL NOT NULL,ip TEXT NOT NULL,user_agent TEXT NOT NULL,browser TEXT NOT NULL,system TEXT NOT NULL)")
        c.execute("CREATE INDEX IF NOT EXISTS audit_user_time ON access_audit(user_id,created)")
        c.execute("CREATE INDEX IF NOT EXISTS audit_time ON access_audit(created,id)")
        if "search_limit" not in {r[1] for r in c.execute("PRAGMA table_info(accounts)")}:
            c.execute("ALTER TABLE accounts ADD COLUMN search_limit INTEGER NOT NULL DEFAULT 5 CHECK(search_limit BETWEEN 1 AND 100)")
        if "language" not in {r[1] for r in c.execute("PRAGMA table_info(accounts)")}:
            c.execute("ALTER TABLE accounts ADD COLUMN language TEXT NOT NULL DEFAULT 'pt'")
        for name,definition in [('timezone',"TEXT NOT NULL DEFAULT 'UTC'"),('quiet_hours','INTEGER NOT NULL DEFAULT 0'),('quiet_start',"TEXT NOT NULL DEFAULT '22:00'"),('quiet_end',"TEXT NOT NULL DEFAULT '08:00'")]:
            if name not in {r[1] for r in c.execute('PRAGMA table_info(accounts)')}:
                c.execute('ALTER TABLE accounts ADD COLUMN '+name+' '+definition)
        c.execute('CREATE TABLE IF NOT EXISTS recovery_attempts(ip TEXT NOT NULL,created REAL NOT NULL)')
        c.execute('CREATE TABLE IF NOT EXISTS password_resets(digest TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id),created REAL NOT NULL,expires REAL NOT NULL,used INTEGER NOT NULL DEFAULT 0,outbox_id TEXT NOT NULL)')
        if "telegram_username" not in {r[1] for r in c.execute("PRAGMA table_info(accounts)")}:
            c.execute("ALTER TABLE accounts ADD COLUMN telegram_username TEXT NOT NULL DEFAULT ''")
        if "owner_id" not in {r[1] for r in c.execute("PRAGMA table_info(searches)")}:
            c.execute("ALTER TABLE searches ADD COLUMN owner_id TEXT REFERENCES accounts(id)")
        if "recipients" not in {r[1] for r in c.execute("PRAGMA table_info(outbox)")}:
            c.execute("ALTER TABLE outbox ADD COLUMN recipients TEXT")
        if 'additional_phones' not in {r[1] for r in c.execute('PRAGMA table_info(accounts)')}:
            c.execute("ALTER TABLE accounts ADD COLUMN additional_phones TEXT NOT NULL DEFAULT '[]'")
        if 'actor_id' not in {r[1] for r in c.execute('PRAGMA table_info(access_audit)')}:
            c.execute('ALTER TABLE access_audit ADD COLUMN actor_id TEXT REFERENCES accounts(id)')
        c.execute("CREATE INDEX IF NOT EXISTS searches_owner ON searches(owner_id,archived)")
        c.execute("UPDATE searches SET archived=1 WHERE state='expired' AND active=0")
        # Old queued messages lack an account-specific recipient: never use a global fallback.
        c.execute("UPDATE outbox SET status='cancelled' WHERE search_id IS NOT NULL AND recipients IS NULL AND status='pending'")
        c.execute("INSERT OR IGNORE INTO schema_version VALUES (2)")
        c.execute("CREATE TABLE IF NOT EXISTS oauth_requests (digest TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id),session_digest TEXT NOT NULL,verifier TEXT NOT NULL,origin TEXT NOT NULL,created REAL NOT NULL)")
        if "language" not in {r[1] for r in c.execute("PRAGMA table_info(oauth_requests)")}:
            c.execute("ALTER TABLE oauth_requests ADD COLUMN language TEXT NOT NULL DEFAULT 'pt'")
        from . import deliveries
        deliveries.setup(c)
        from . import offer_links
        offer_links.setup(c)
        from . import notifications
        notifications.setup(c)
        from . import revisions
        revisions.setup(c)
        c.execute("CREATE INDEX IF NOT EXISTS alerts_search_created ON alerts(search_id,created)")
        c.execute("CREATE INDEX IF NOT EXISTS results_cycle ON results(cycle_id)")
        c.execute("CREATE INDEX IF NOT EXISTS results_route_revision ON results(search_id,version,route_key,id)")
        c.execute("CREATE INDEX IF NOT EXISTS snapshots_cycle ON snapshots(cycle_id)")
        c.execute("CREATE INDEX IF NOT EXISTS alerts_cycle ON alerts(cycle_id)")
        previous_adapter = c.execute("SELECT value FROM metadata WHERE key='adapter_version'").fetchone()
        if previous_adapter and previous_adapter[0] != ADAPTER_VERSION:
            c.execute("UPDATE searches SET version=version+1,error=NULL,last_success=NULL")
            c.execute("DELETE FROM filter_result_refs")
        c.execute("INSERT OR REPLACE INTO metadata VALUES('adapter_version',?)", (ADAPTER_VERSION,))
        # Cadence is a server policy. Preserve prices and filter references.
        c.execute("UPDATE searches SET config=json_set(config,'$.interval',300) WHERE COALESCE(json_extract(config,'$.interval'),0)<>300")
        c.execute("CREATE INDEX IF NOT EXISTS snapshots_search_time ON snapshots(search_id,version,direction,collected)")
        # Recover an interrupted process: no running task survived the restart.
        c.execute("UPDATE cycles SET status='interrupted', finished=? WHERE status='running'", (time.time(),))
        c.execute("UPDATE searches SET state='scheduled', next_due=MAX(?,COALESCE(last_started,0)+300) WHERE active=1 AND archived=0", (time.time(),))
        # A crashed send may have reached SMTP. Hold it for manual review, not a blind resend.
        c.execute("UPDATE outbox SET status='uncertain', error='Processo interrompido durante envio; confirme antes de reenviar' WHERE status='sending'")
        from .notifications import sync_alerts
        sync_alerts(c,[r[0] for r in c.execute("SELECT DISTINCT value FROM outbox,json_each(outbox.alert_ids) WHERE outbox.status='uncertain'")])
        if seed and not c.execute("SELECT 1 FROM searches").fetchone():
            add_search(c, default_search())


def add_search(c, config, owner_id=None):
    sid = uuid.uuid4().hex
    c.execute("INSERT INTO searches(id,config,created,next_due,owner_id) VALUES(?,?,?,?,?)", (sid, config.model_dump_json(), time.time(), time.time(), owner_id))
    return sid


def decode_search(row):
    item = dict(row)
    item["config"] = Search.model_validate_json(item["config"]).model_dump()
    return item
