"""Authentication audit: socket IP and declared client details, never credentials."""
import os
import time
from .store import db


def record(request,event,user_id=None,actor_id=None):
    address=request.client.host if request.client else 'unknown'
    agent=request.headers.get('user-agent','')[:512]
    browser=next((label for token,label in [('Edg/','Edge'),('OPR/','Opera'),('Firefox/','Firefox'),('Chrome/','Chrome'),('Safari/','Safari')] if token in agent),'Unknown')
    system=next((label for token,label in [('Android','Android'),('iPhone','iOS'),('iPad','iPadOS'),('Windows','Windows'),('Macintosh','macOS'),('Linux','Linux')] if token in agent),'Unknown')
    with db() as c:
        c.execute('INSERT INTO access_audit(user_id,event,created,ip,user_agent,browser,system,actor_id) VALUES(?,?,?,?,?,?,?,?)',(user_id,event,time.time(),address,agent,browser,system,actor_id))
        cleanup_in(c,time.time())


def cleanup_in(c,now):
    from .deliveries import days
    c.execute('DELETE FROM access_audit WHERE created<?',(now-days('access')*86400,))
    c.execute('DELETE FROM access_audit WHERE id NOT IN (SELECT id FROM access_audit ORDER BY id DESC LIMIT 20000)')
    c.execute("INSERT OR REPLACE INTO metadata VALUES('audit_retention_last_run',?)",(str(now),))


def cleanup():
    with db() as c:cleanup_in(c,time.time())



def list_events(user,all_users=False):
    with db() as c:
        where='' if all_users and user['role']=='admin' else 'WHERE e.user_id=?'
        args=() if not where else (user['id'],)
        return [dict(r) for r in c.execute('SELECT e.*,a.name AS account_name,a.phone AS login,actor.name AS actor_name FROM access_audit e LEFT JOIN accounts a ON a.id=e.user_id LEFT JOIN accounts actor ON actor.id=e.actor_id '+where+' ORDER BY e.id DESC LIMIT 100',args)]


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
        clauses.append("(a.name LIKE ? ESCAPE '\\' OR a.phone LIKE ? ESCAPE '\\')");args.extend([escaped,escaped])
    if event:clauses.append('e.event=?');args.append(event)
    for value,operator in [(start,'>='),(end,'<=')]:
        if value is not None:clauses.append('e.created'+operator+'?');args.append(value)
    where=' WHERE '+' AND '.join(clauses) if clauses else ''
    join=' FROM access_audit e LEFT JOIN accounts a ON a.id=e.user_id LEFT JOIN accounts actor ON actor.id=e.actor_id'
    with db() as c:
        c.execute('BEGIN')
        total=c.execute('SELECT COUNT(*)'+join+where,args).fetchone()[0]
        rows=[dict(r) for r in c.execute('SELECT e.*,a.name AS account_name,a.phone AS login,actor.name AS actor_name'+join+where+' ORDER BY e.id DESC LIMIT 25 OFFSET ?',[*args,page*25])]
    return {'items':rows,'total':total,'page':page,'page_size':25,'days':days('access'),'max_records':20000}
