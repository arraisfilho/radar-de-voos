"""One opportunity can have several independent transport attempts."""
import json


def setup(c):
    c.executescript("""
      CREATE TABLE IF NOT EXISTS notification_deliveries(
        outbox_id TEXT NOT NULL REFERENCES outbox(id) ON DELETE CASCADE,
        alert_id TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
        PRIMARY KEY(outbox_id,alert_id));
      CREATE INDEX IF NOT EXISTS notification_by_alert ON notification_deliveries(alert_id,outbox_id);
      DROP TRIGGER IF EXISTS notification_link_insert;
    """)
    if not c.execute("SELECT 1 FROM metadata WHERE key='notification_links_v1'").fetchone():
        c.execute('INSERT OR IGNORE INTO notification_deliveries SELECT o.id,a.id FROM outbox o,json_each(o.alert_ids) j JOIN alerts a ON a.id=j.value')
        c.execute("INSERT INTO metadata VALUES('notification_links_v1','1')")


def link(c,oid,ids):
    c.executemany('INSERT OR IGNORE INTO notification_deliveries SELECT ?,id FROM alerts WHERE id=?',[(oid,aid) for aid in ids])


def sync_alerts(c,ids):
    for aid in ids:
        statuses=[r[0] for r in c.execute('SELECT o.status FROM notification_deliveries n JOIN outbox o ON o.id=n.outbox_id WHERE n.alert_id=?',(aid,))]
        if not statuses:
            # Legacy/manual queue rows are linked once; normal enqueue paths link directly.
            c.execute('INSERT OR IGNORE INTO notification_deliveries SELECT o.id,a.id FROM outbox o,json_each(o.alert_ids) j JOIN alerts a ON a.id=j.value WHERE a.id=?',(aid,))
            statuses=[r[0] for r in c.execute('SELECT o.status FROM notification_deliveries n JOIN outbox o ON o.id=n.outbox_id WHERE n.alert_id=?',(aid,))]
        if not statuses:continue
        if any(s in ('pending','sending') for s in statuses):status='queued'
        elif all(s=='sent' for s in statuses):status='sent'
        elif 'sent' in statuses:status='partial'
        elif 'uncertain' in statuses:status='uncertain'
        elif 'failed' in statuses:status='failed'
        else:status=statuses[0]
        c.execute('UPDATE alerts SET status=? WHERE id=?',(status,aid))
