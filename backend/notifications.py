"""One opportunity can have several independent transport attempts."""
import json
import time

# Every state a delivery (an outbox row) takes; 'quiet' only in rows written before quiet hours held messages.
OUTBOX_STATES = ('pending', 'sending', 'sent', 'failed', 'uncertain', 'cancelled', 'expired', 'quiet', 'waiting_contact', 'waiting_service')
# Derived for display: 'held' is a pending delivery waiting for the end of the recipient's quiet hours.
DERIVED_STATES = ('held',)
# Every state of an alert: how persist_snapshots kept it, or the summary of its deliveries (sync_alerts).
ALERT_STATES = ('queued', 'sent', 'partial', 'uncertain', 'failed', 'waiting_contact', 'waiting_service', 'waiting_smtp',
                'in_app', 'cancelled', 'expired', 'quiet')


def lifetime(row):
    """Seconds a pending delivery stays sendable once due: an older fare is no longer news, and a
    recovery code dies in 10 minutes (recovery.CODE_SECONDS)."""
    return 600 if row.get('kind') == 'recovery' else 1800


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
    # A pending delivery due later is held by quiet hours: 'held', with the time it goes out.
    rows=c.execute('''SELECT n.alert_id,o.channel,CASE WHEN o.status='pending' AND o.next_due>? THEN 'held' ELSE o.status END shown,
        COUNT(*) count,MAX(o.next_due) due
      FROM notification_deliveries n
      JOIN alerts a ON a.id=n.alert_id
      JOIN searches s ON s.id=a.search_id
      JOIN outbox o ON o.id=n.outbox_id AND o.search_id=a.search_id
      WHERE s.owner_id=? AND n.alert_id IN ('''+marks+''')
      GROUP BY n.alert_id,o.channel,shown ORDER BY o.channel,shown''',[time.time(),user_id,*values])
    grouped={};held={}
    for row in rows:
        channels=grouped.setdefault(row['alert_id'],{})
        channels.setdefault(row['channel'],{})[row['shown']]=row['count']
        if row['shown']=='held':held[(row['alert_id'],row['channel'])]=row['due']
    receipts={}
    for row in c.execute('''SELECT n.alert_id,o.receipt_status,COUNT(*) count FROM notification_deliveries n
      JOIN alerts a ON a.id=n.alert_id JOIN searches s ON s.id=a.search_id
      JOIN outbox o ON o.id=n.outbox_id AND o.search_id=a.search_id
      WHERE s.owner_id=? AND n.alert_id IN ('''+marks+''') AND o.channel='whatsapp' AND o.status='sent' AND o.receipt_status IS NOT NULL
      GROUP BY n.alert_id,o.receipt_status''',[user_id,*values]):
        receipts.setdefault(row['alert_id'],{})[row['receipt_status']]=row['count']
    # The time a held delivery goes out reads on the account's clock, as the alert message does.
    zone=(c.execute('SELECT timezone FROM accounts WHERE id=?',(user_id,)).fetchone() or ['UTC'])[0] if held else None
    return {aid:[{'channel':channel,'counts':counts,**({'receipts':receipts.get(aid,{})} if channel=='whatsapp' and aid in receipts else {}),
                  **({'held_until':held[(aid,channel)],'held_zone':zone} if (aid,channel) in held else {})} for channel,counts in channels.items()] for aid,channels in grouped.items()}
