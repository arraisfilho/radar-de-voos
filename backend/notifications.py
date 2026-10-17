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
    if not c.execute("SELECT 1 FROM metadata WHERE key='delivery_blocked_v1'").fetchone():
        # Reclassify only known configuration failures with zero transport attempts.
        # Keep their contents, timestamps and links; blocked rows are never queued again.
        rows=c.execute("SELECT id,recipients,error FROM outbox WHERE status='failed' AND COALESCE(attempts,0)=0 AND error IN ('E-mail sem destinatários ou serviço indisponível','Número WhatsApp não cadastrado','Integração WhatsApp indisponível')").fetchall()
        for row in rows:
            status='waiting_contact' if not json.loads(row['recipients'] or '[]') else 'waiting_service'
            c.execute('UPDATE outbox SET status=?,completed=COALESCE(completed,created) WHERE id=?',(status,row['id']))
        ids=[r[0] for r in c.execute("SELECT DISTINCT n.alert_id FROM notification_deliveries n JOIN outbox o ON o.id=n.outbox_id WHERE o.status IN ('waiting_contact','waiting_service')")]
        sync_alerts(c,ids)
        c.execute("INSERT INTO metadata VALUES('delivery_blocked_v1','1')")


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
        elif 'waiting_contact' in statuses:status='waiting_contact'
        elif 'waiting_service' in statuses:status='waiting_service'
        else:status=statuses[0]
        c.execute('UPDATE alerts SET status=? WHERE id=?',(status,aid))


def channel_summaries(c, user_id, alert_ids):
    """One grouped query for the visible alerts; no contact or provider diagnostics."""
    if not alert_ids:return {}
    values=list(dict.fromkeys(alert_ids));marks=','.join('?' for _ in values)
    rows=c.execute('''SELECT n.alert_id,o.channel,o.status,COUNT(*) count
      FROM notification_deliveries n
      JOIN alerts a ON a.id=n.alert_id
      JOIN searches s ON s.id=a.search_id
      JOIN outbox o ON o.id=n.outbox_id AND o.search_id=a.search_id
      WHERE s.owner_id=? AND n.alert_id IN ('''+marks+''')
      GROUP BY n.alert_id,o.channel,o.status ORDER BY o.channel,o.status''',[user_id,*values])
    grouped={}
    for row in rows:
        channels=grouped.setdefault(row['alert_id'],{})
        channels.setdefault(row['channel'],{})[row['status']]=row['count']
    return {aid:[{'channel':channel,'counts':counts} for channel,counts in channels.items()] for aid,channels in grouped.items()}
