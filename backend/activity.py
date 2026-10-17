"""Owner-scoped notification history and observed price changes, kept distinct."""
import json
import time
from .store import db
from .notifications import channel_summaries

# Alert states shown in red or amber ("Com problema"), as the delivery chips show them.
PROBLEMS = ['failed', 'partial', 'uncertain', 'expired', 'waiting_smtp', 'waiting_service', 'waiting_contact']
RECEIPT_FAILED = ("EXISTS(SELECT 1 FROM notification_deliveries n JOIN outbox o ON o.id=n.outbox_id WHERE n.alert_id=a.id "
                  "AND o.channel='whatsapp' AND o.status='sent' AND o.receipt_status='failed')")
# A queued alert whose deliveries in progress all wait for the end of quiet hours: "Silenciado", not "Enviando".
DELIVERY = "EXISTS(SELECT 1 FROM notification_deliveries n JOIN outbox o ON o.id=n.outbox_id WHERE n.alert_id=a.id AND "
HELD = ("("+DELIVERY+"o.status='pending' AND o.next_due>?) AND NOT "
        +DELIVERY+"(o.status='sending' OR (o.status='pending' AND o.next_due<=?))))")


def feed(user_id,mode,search_id,page,status):
    with db() as c:
        params=[user_id];where='s.owner_id=?'
        if search_id:where+=' AND s.id=?';params.append(search_id)
        totals={r['status']:r['n'] for r in c.execute('SELECT a.status,COUNT(*) n FROM alerts a JOIN searches s ON a.search_id=s.id WHERE '+where+' GROUP BY a.status',params)}
        # A WhatsApp message accepted and then reported undelivered: the alert reads 'sent', its chip a failure.
        undelivered=c.execute("SELECT COUNT(*) FROM alerts a JOIN searches s ON a.search_id=s.id WHERE "+where+" AND a.status='sent' AND "+RECEIPT_FAILED,params).fetchone()[0]
        if undelivered:totals['delivery_failed']=undelivered
        now=time.time()
        held=c.execute("SELECT COUNT(*) FROM alerts a JOIN searches s ON a.search_id=s.id WHERE "+where+" AND a.status='queued' AND "+HELD,params+[now,now]).fetchone()[0]
        if held:totals['held']=held
        if mode=='notifications':
            clause=where;values=list(params)
            if status=='sent':clause+=" AND a.status='sent' AND NOT "+RECEIPT_FAILED
            elif status=='pending':clause+=" AND a.status='queued' AND NOT "+HELD;values+=[now,now]
            elif status!='all':
                statuses=PROBLEMS
                clause+=' AND (a.status IN ('+','.join('?' for _ in statuses)+')'+(" OR (a.status='sent' AND "+RECEIPT_FAILED+"))" if status=='failed' else ')');values+=statuses
            rows=[dict(r) for r in c.execute('SELECT a.*,s.config,s.archived FROM alerts a JOIN searches s ON a.search_id=s.id WHERE '+clause+' ORDER BY a.created DESC,a.id DESC LIMIT 31 OFFSET ?',values+[page*30])]
            channels=channel_summaries(c,user_id,[row['id'] for row in rows[:30]])
            for row in rows:
                row['channels']=channels.get(row['id'],[])
                row['search_name']=json.loads(row.pop('config'))['name'];row['payload']=json.loads(row['payload'])
        else:
            rows=[dict(r) for r in c.execute('''WITH changes AS (
              SELECT h.id,h.search_id,h.version,h.direction,h.collected AS created,h.price,
                COALESCE(json_extract(h.flight,'$.currency'),'BRL') AS currency,
                LAG(h.price) OVER(PARTITION BY h.search_id,h.version,h.direction ORDER BY h.collected,h.id) AS previous,
                s.config,s.archived,h.flight
              FROM snapshots h JOIN searches s ON h.search_id=s.id WHERE '''+where+''' AND h.complete=1 AND h.price IS NOT NULL
            ) SELECT * FROM changes WHERE previous IS NOT NULL AND previous<>price ORDER BY created DESC,id DESC LIMIT 31 OFFSET ?''',params+[page*30])]
            for row in rows:
                row['search_name']=json.loads(row.pop('config'))['name']
                row['flight']=json.loads(row['flight']) if row['flight'] else None
        return {'items':rows[:30],'has_more':len(rows)>30,'page':page,'totals':totals}
