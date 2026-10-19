"""Authentication and administration audit: socket IP and declared client details, never credentials."""
import json
import time
from .store import db

# Repetitive events produced without authentication: aggregated and capped apart.
NOISY = ('login_failed','login_throttled','recovery_requested')
# Sessions of one account: aggregated by account, address and user agent (another browser or
# system behind the same IP, e.g. CGNAT, keeps a row of its own), capped with the other account events.
SESSION = ('login_success','logout')
# Second-step events follow a correct password: aggregated like the anonymous events, but
# counted with the account's events.
SECOND_STEP = ('login_2fa_started','login_2fa_failed')
AGGREGATED = NOISY+SESSION+SECOND_STEP
AGGREGATE_SECONDS = 600
NOISY_LIMIT = 5000
RECORD_LIMIT = 20000
# Administration and configuration (admin_* and the first administrator) have a quota of
# their own: no account holder can evict them by producing other events.
ADMIN_LIMIT = 20000
CATEGORY = ("CASE WHEN event IN ("+",".join("'"+event+"'" for event in NOISY)+") THEN 'noisy'"
            " WHEN event LIKE 'admin\\_%' ESCAPE '\\' OR event='bootstrap_success' THEN 'admin' ELSE 'account' END")
EVENTS = ('login_success','login_failed','login_2fa_started','login_2fa_failed','recovery_code_used','login_throttled','logout',
          'register_success','bootstrap_success','recovery_requested','password_reset','admin_account_created',
          'admin_account_updated','admin_password_reset','admin_2fa_enabled','admin_2fa_disabled',
          'admin_monitoring_viewed','admin_smtp_saved','admin_smtp_removed',
          'admin_whatsapp_saved','admin_whatsapp_removed','admin_whatsapp_receipts_saved',
          'admin_google_client_saved','admin_google_client_removed','admin_google_connected',
          'admin_google_disconnected','admin_retention_changed','admin_logs_cleaned',
          'admin_health_incident_acknowledged','admin_health_notices_changed')


def setup(c):
    columns={r[1] for r in c.execute('PRAGMA table_info(access_audit)')}
    for name,definition in [('count','INTEGER NOT NULL DEFAULT 1'),('last_seen','REAL'),('details','TEXT')]:
        if name not in columns:
            c.execute('ALTER TABLE access_audit ADD COLUMN '+name+' '+definition)
    c.execute('CREATE INDEX IF NOT EXISTS audit_aggregate ON access_audit(event,ip,id)')


def changed(before,after,keys):
    """Names of the fields that differ; values (including secrets) are never returned."""
    return [key for key in keys if (before or {}).get(key)!=(after or {}).get(key)]


def record(request,event,user_id=None,actor_id=None,details=None,c=None):
    """With c, the row joins the caller's open transaction: it commits or rolls back with the change it records."""
    if c is None:
        with db() as c:
            if event in AGGREGATED:c.execute('BEGIN IMMEDIATE')
            return record(request,event,user_id,actor_id,details,c)
    address=request.client.host if request.client else 'unknown'
    agent=request.headers.get('user-agent','')[:512]
    browser=next((label for token,label in [('Edg/','Edge'),('OPR/','Opera'),('Firefox/','Firefox'),('Chrome/','Chrome'),('Safari/','Safari')] if token in agent),'Unknown')
    system=next((label for token,label in [('Android','Android'),('iPhone','iOS'),('iPad','iPadOS'),('Windows','Windows'),('Macintosh','macOS'),('Linux','Linux')] if token in agent),'Unknown')
    now=time.time()
    payload=json.dumps(details,sort_keys=True,separators=(',',':')) if details is not None else None
    if event in AGGREGATED:
        # One row per event, address and account (and user agent, for sessions) while repeats
        # keep arriving within the window.
        device=' AND user_agent=?' if event in SESSION else ''
        row=c.execute('SELECT id FROM access_audit WHERE event=? AND ip=? AND user_id IS ? AND COALESCE(last_seen,created)>=?'+device+' ORDER BY id DESC LIMIT 1',
                      (event,address,user_id,now-AGGREGATE_SECONDS)+((agent,) if device else ())).fetchone()
        if row:
            c.execute('UPDATE access_audit SET count=count+1,last_seen=? WHERE id=?',(now,row[0]))
            return
    c.execute('INSERT INTO access_audit(user_id,event,created,ip,user_agent,browser,system,actor_id,details) VALUES(?,?,?,?,?,?,?,?,?)',(user_id,event,now,address,agent,browser,system,actor_id,payload))


def cleanup_in(c,now):
    """Retention in days for every row, then one cap per category: none can evict another."""
    from .deliveries import days
    c.execute('DELETE FROM access_audit WHERE COALESCE(last_seen,created)<?',(now-days('access')*86400,))
    for category,limit in (('noisy',NOISY_LIMIT),('account',RECORD_LIMIT),('admin',ADMIN_LIMIT)):
        c.execute('DELETE FROM access_audit WHERE '+CATEGORY+'=? AND id NOT IN (SELECT id FROM access_audit WHERE '+CATEGORY+'=? ORDER BY COALESCE(last_seen,created) DESC,id DESC LIMIT ?)',(category,category,limit))
    c.execute("INSERT OR REPLACE INTO metadata VALUES('audit_retention_last_run',?)",(str(now),))


def cleanup():
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        cleanup_in(c,time.time())


def public(row):
    item=dict(row)
    try:item['details']=json.loads(item['details']) if item.get('details') else None
    except ValueError:item['details']=None
    return item


SELECT='SELECT e.*,a.name AS account_name,a.phone AS login,actor.name AS actor_name'
JOIN=' FROM access_audit e LEFT JOIN accounts a ON a.id=e.user_id LEFT JOIN accounts actor ON actor.id=e.actor_id'
# Aggregated rows move to the top while repeats keep arriving.
ORDER=' ORDER BY COALESCE(e.last_seen,e.created) DESC,e.id DESC'


def list_events(user,all_users=False):
    with db() as c:
        where='' if all_users and user['role']=='admin' else ' WHERE e.user_id=?'
        args=() if not where else (user['id'],)
        return [public(r) for r in c.execute(SELECT+JOIN+where+ORDER+' LIMIT 100',args)]


def page_events(user,all_users=False,page=0,q='',event='',start=None,end=None):
    from .deliveries import days
    from fastapi import HTTPException
    if start is not None and end is not None and start>end:
        raise HTTPException(422,'O início precisa ser anterior ao fim')
    clauses=[];args=[]
    if not (all_users and user['role']=='admin'):
        clauses.append('e.user_id=?');args.append(user['id'])
    if q:
        escaped='%'+q.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'
        clauses.append("(a.name LIKE ? ESCAPE '\\' OR a.phone LIKE ? ESCAPE '\\' OR actor.name LIKE ? ESCAPE '\\')");args.extend([escaped,escaped,escaped])
    if event:clauses.append('e.event=?');args.append(event)
    # An aggregated row matches when its first-to-last interval overlaps the filter.
    if start is not None:clauses.append('COALESCE(e.last_seen,e.created)>=?');args.append(start)
    if end is not None:clauses.append('e.created<=?');args.append(end)
    where=' WHERE '+' AND '.join(clauses) if clauses else ''
    with db() as c:
        c.execute('BEGIN')
        total=c.execute('SELECT COUNT(*)'+JOIN+where,args).fetchone()[0]
        rows=[public(r) for r in c.execute(SELECT+JOIN+where+ORDER+' LIMIT 25 OFFSET ?',[*args,page*25])]
    return {'items':rows,'total':total,'page':page,'page_size':25,'days':days('access'),'max_records':RECORD_LIMIT,'noisy_max_records':NOISY_LIMIT,
            'admin_max_records':ADMIN_LIMIT,'events':list(EVENTS)}
