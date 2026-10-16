"""Owner-scoped notification history and observed price changes, kept distinct."""
import json
from .store import db


def feed(user_id,mode,search_id,page,status):
    with db() as c:
        params=[user_id];where='s.owner_id=?'
        if search_id:where+=' AND s.id=?';params.append(search_id)
        totals={r['status']:r['n'] for r in c.execute('SELECT a.status,COUNT(*) n FROM alerts a JOIN searches s ON a.search_id=s.id WHERE '+where+' GROUP BY a.status',params)}
        if mode=='notifications':
            clause=where;values=list(params)
            if status!='all':
                statuses={'sent':['sent'],'pending':['queued'],'failed':['failed','partial','uncertain','waiting_smtp','waiting_contact']}[status]
                clause+=' AND a.status IN ('+','.join('?' for _ in statuses)+')';values+=statuses
            rows=[dict(r) for r in c.execute('SELECT a.*,s.config,s.archived FROM alerts a JOIN searches s ON a.search_id=s.id WHERE '+clause+' ORDER BY a.created DESC,a.id DESC LIMIT 31 OFFSET ?',values+[page*30])]
            for row in rows:
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
