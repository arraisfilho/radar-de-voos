"""Administrative transport log. Never exposes credentials or recovery links."""
import hashlib
import hmac
import json
import os
import time
from fastapi import HTTPException
from .store import db

TERMINAL = ('sent','failed','uncertain','cancelled','expired','quiet')
PAGE_SIZE = 15
BATCH_SIZE = 2000


def days(scope='deliveries'):
    env='RADAR_AUDIT_RETENTION_DAYS' if scope=='access' else 'RADAR_DELIVERY_RETENTION_DAYS'
    with db() as c:row=c.execute('SELECT value FROM metadata WHERE key=?',('log_days_'+scope,)).fetchone()
    value=int(row[0] if row else os.environ.get(env,'90'))
    if not 1 <= value <= 3650:raise ValueError('Retenção deve estar entre 1 e 3650 dias')
    return value


def configure_days(scope,value):
    with db() as c:c.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)',('log_days_'+scope,str(value)))
    return retention_info(scope)


def setup(c):
    columns = {r[1] for r in c.execute('PRAGMA table_info(outbox)')}
    for name, definition in [('body_html','TEXT'),('owner_id','TEXT REFERENCES accounts(id)'),('channel',"TEXT NOT NULL DEFAULT 'email'"),('kind',"TEXT NOT NULL DEFAULT 'legacy'"),('provider','TEXT'),('completed','REAL'),('transport_ref','TEXT'),('provider_message_id','TEXT')]:
        if name not in columns:
            c.execute('ALTER TABLE outbox ADD COLUMN '+name+' '+definition)
    if not c.execute("SELECT 1 FROM metadata WHERE key='delivery_log_v1'").fetchone():
        c.execute('UPDATE outbox SET owner_id=(SELECT owner_id FROM searches WHERE id=outbox.search_id),kind=\'alert\' WHERE search_id IS NOT NULL')
        c.execute("UPDATE outbox SET owner_id=(SELECT user_id FROM password_resets WHERE outbox_id=outbox.id LIMIT 1),kind='recovery' WHERE id IN (SELECT outbox_id FROM password_resets)")
        c.execute("UPDATE outbox SET kind='recovery' WHERE instr(body,'#reset=')>0")
        c.execute("UPDATE outbox SET completed=COALESCE(sent,created) WHERE status IN ('sent','failed','uncertain','cancelled','expired','quiet')")
        c.execute("INSERT INTO metadata VALUES('delivery_log_v1','1')")
    c.executescript("""
      CREATE INDEX IF NOT EXISTS delivery_time ON outbox(created DESC,id DESC);
      CREATE INDEX IF NOT EXISTS delivery_completed ON outbox(completed);
      CREATE INDEX IF NOT EXISTS delivery_owner ON outbox(owner_id,created DESC);
      CREATE INDEX IF NOT EXISTS delivery_channel ON outbox(channel,created DESC);
      CREATE INDEX IF NOT EXISTS delivery_queue ON outbox(channel,next_due,created) WHERE status='pending';
      CREATE TRIGGER IF NOT EXISTS delivery_owner_insert AFTER INSERT ON outbox
        WHEN NEW.search_id IS NOT NULL AND NEW.owner_id IS NULL BEGIN
        UPDATE outbox SET owner_id=(SELECT owner_id FROM searches WHERE id=NEW.search_id),kind='alert' WHERE id=NEW.id;
      END;
      CREATE TRIGGER IF NOT EXISTS delivery_finished_update AFTER UPDATE OF status ON outbox
        WHEN NEW.completed IS NULL AND NEW.status IN ('sent','failed','uncertain','cancelled','expired','quiet') BEGIN
        UPDATE outbox SET completed=COALESCE(NEW.sent,CAST(strftime('%s','now') AS REAL)) WHERE id=NEW.id;
      END;
      CREATE TRIGGER IF NOT EXISTS delivery_finished_insert AFTER INSERT ON outbox
        WHEN NEW.completed IS NULL AND NEW.status IN ('sent','failed','uncertain','cancelled','expired','quiet') BEGIN
        UPDATE outbox SET completed=COALESCE(NEW.sent,NEW.created) WHERE id=NEW.id;
      END;
    """)


def clauses(filters):
    where = ['1=1']; values = []
    if filters.get('channel','all') != 'all':
        where.append('o.channel=?');values.append(filters['channel'])
    groups = {'sent':('sent',),'pending':('pending','sending'),'failed':('failed','uncertain'),'closed':('cancelled','expired','quiet')}
    if filters.get('status','all') in groups:
        group=groups[filters['status']];where.append('o.status IN ('+','.join('?' for _ in group)+')');values.extend(group)
    # Escape LIKE wildcards: searches match literal user input, not SQL patterns.
    def like(value):return '%'+value.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'
    if filters.get('user'):
        where.append("(a.name LIKE ? ESCAPE '\\' OR a.phone LIKE ? ESCAPE '\\')");values.extend([like(filters['user'])]*2)
    if filters.get('q'):
        where.append("(o.subject LIKE ? ESCAPE '\\' OR o.recipients LIKE ? ESCAPE '\\')");values.extend([like(filters['q'])]*2)
    for key,operator in [('start','>='),('end','<=')]:
        if filters.get(key) is not None:where.append('o.created'+operator+'?');values.append(filters[key])
    return ' AND '.join(where),values


def public(row):
    row=dict(row)
    try:row['recipients']=json.loads(row.get('recipients') or '[]')
    except (ValueError,TypeError):row['recipients']=[]
    return row


def list_items(filters,page=0):
    where,values=clauses(filters)
    join=' FROM outbox o LEFT JOIN accounts a ON a.id=o.owner_id WHERE '+where
    with db() as c:
        # Single read snapshot keeps counts and page consistent during concurrent sends.
        c.execute('BEGIN')
        totals={r['status']:r['n'] for r in c.execute('SELECT o.status,COUNT(*) n'+join+' GROUP BY o.status',values)}
        rows=c.execute('SELECT o.id,o.created,o.completed,o.sent,o.status,o.channel,o.kind,o.provider,o.subject,o.recipients,o.attempts,o.provider_message_id,a.name account_name,a.phone login,o.owner_id'+join+' ORDER BY o.created DESC,o.id DESC LIMIT ? OFFSET ?',values+[PAGE_SIZE,page*PAGE_SIZE]).fetchall()
    return {'items':[public(r) for r in rows],'page':page,'page_size':PAGE_SIZE,'total':sum(totals.values()),'totals':totals}


def detail(delivery_id):
    with db() as c:
        row=c.execute('SELECT o.*,a.name account_name,a.phone login FROM outbox o LEFT JOIN accounts a ON a.id=o.owner_id WHERE o.id=?',(delivery_id,)).fetchone()
    if not row:raise HTTPException(404,'Registro de envio não encontrado')
    item=public(row)
    # Old reset requests may no longer have a corresponding password_resets row.
    protected=item['kind']=='recovery' or '#reset=' in item['body']
    item['body']=None if protected else item['body']
    item['content_protected']=protected
    item.pop('alert_ids',None)
    return item


def retention_info(scope='deliveries'):
    now=time.time()
    with db() as c:
        counts=({'access':c.execute('SELECT COUNT(*) FROM access_audit').fetchone()[0]} if scope=='access' else {r['status']:r['n'] for r in c.execute('SELECT status,COUNT(*) n FROM outbox GROUP BY status')})
        last=c.execute("SELECT value FROM metadata WHERE key=?",('audit_retention_last_run' if scope=='access' else 'delivery_retention_last_run',)).fetchone()
    return {'scope':scope,'days':days(scope),'cutoff':now-days(scope)*86400,'total':sum(counts.values()),'protected':counts.get('pending',0)+counts.get('sending',0),'last_cleanup':float(last[0]) if last else None,'batch_size':BATCH_SIZE}


def candidates(c,before,scope='deliveries'):
    if scope=='access':return [r[0] for r in c.execute('SELECT id FROM access_audit WHERE created<? ORDER BY created,id LIMIT ?',(before,BATCH_SIZE+1))]
    return [r[0] for r in c.execute("SELECT id FROM outbox WHERE completed<? AND status IN ('sent','failed','uncertain','cancelled','expired','quiet') ORDER BY completed,id LIMIT ?",(before,BATCH_SIZE+1))]


def signature(ids,before,expires,actor,secret,scope='deliveries'):
    payload=json.dumps([ids,before,expires,actor,scope],separators=(',',':')).encode()
    return hmac.new(secret.encode(),payload,hashlib.sha256).hexdigest()


def preview(before,actor,secret,scope='deliveries'):
    if before>time.time()+1:raise HTTPException(422,'A data de limpeza não pode estar no futuro')
    with db() as c:
        c.execute('BEGIN')
        ids=candidates(c,before,scope)
        totals=({'access':c.execute('SELECT COUNT(*) FROM access_audit WHERE created<?',(before,)).fetchone()[0]} if scope=='access' else {r['status']:r['n'] for r in c.execute("SELECT status,COUNT(*) n FROM outbox WHERE completed<? AND status IN ('sent','failed','uncertain','cancelled','expired','quiet') GROUP BY status",(before,))})
    expires=int(time.time()+300)
    return {'count':min(len(ids),BATCH_SIZE),'total':sum(totals.values()),'totals':totals,'has_more':len(ids)>BATCH_SIZE,'before':before,'expires':expires,'proof':signature(ids,before,expires,actor,secret,scope)}


def confirm(before,expires,proof,actor,secret,scope='deliveries'):
    now=time.time()
    if expires<now or expires>now+301:raise HTTPException(409,'Prévia expirada. Consulte novamente antes de limpar.')
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        ids=candidates(c,before,scope)
        if not proof or not hmac.compare_digest(signature(ids,before,expires,actor,secret,scope),proof):
            raise HTTPException(409,'Os registros mudaram. Consulte novamente antes de limpar.')
        selected=ids[:BATCH_SIZE]
        if selected:c.executemany('DELETE FROM '+('access_audit' if scope=='access' else 'outbox')+' WHERE id=?',[(i,) for i in selected])
    return {'removed':len(selected),'has_more':len(ids)>BATCH_SIZE}


def cleanup(now=None):
    now=time.time() if now is None else now
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        last=c.execute("SELECT value FROM metadata WHERE key='delivery_retention_last_run'").fetchone()
        if last and now-float(last[0])<3600:return 0
        ids=candidates(c,now-days()*86400)[:BATCH_SIZE]
        if ids:c.executemany('DELETE FROM outbox WHERE id=?',[(i,) for i in ids])
        c.execute("INSERT OR REPLACE INTO metadata VALUES('delivery_retention_last_run',?)",(str(now),))
    return len(ids)
