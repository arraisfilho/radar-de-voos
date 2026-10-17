"""Manual account administration; never establishes a session for the target."""
import secrets
import sqlite3
import time
from typing import Literal
from pydantic import Field,BaseModel,model_validator
from fastapi import HTTPException
from . import accounts,audit
from .store import db


class Create(accounts.Registration):
    search_limit: int = Field(default=5,ge=1,le=100)
    language: Literal['pt','en','es'] = 'pt'


class Update(accounts.Contacts):
    search_limit: int | None = Field(default=None,ge=1,le=100)
    country: str = Field(max_length=2)
    phone: str = Field(min_length=4,max_length=50)
    language: Literal['pt','en','es'] = 'pt'

    @model_validator(mode='after')
    def normalize_login(self):
        self.country=accounts.Contacts.country_valid(self.country)
        self.phone=accounts.phone_e164(self.phone,self.country)
        return self


class Password(BaseModel):
    password: str = Field(min_length=10,max_length=200)


def listing(q,page):
    text='%'+q.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'
    number=q.strip().lstrip('#')
    number=int(number) if number.isascii() and number.isdigit() and len(number)<16 else -1
    where=" WHERE a.name LIKE ? ESCAPE '\\' OR a.phone LIKE ? ESCAPE '\\' OR a.emails LIKE ? ESCAPE '\\' OR r.number=?"
    args=(text,text,text,number)
    with db() as c:
        c.execute('BEGIN')
        total=c.execute('SELECT COUNT(*) FROM accounts a JOIN client_refs r ON r.entity_id=a.id'+where,args).fetchone()[0]
        rows=c.execute('''SELECT a.*,r.number AS client_number,
          COALESCE(m.active,0) active_count,COALESCE(m.paused,0) paused_count,
          COALESCE(m.ended,0) ended_count,COALESCE(m.total,0) total_count
          FROM accounts a JOIN client_refs r ON r.entity_id=a.id
          LEFT JOIN (SELECT owner_id,
            SUM(CASE WHEN active=1 AND archived=0 THEN 1 ELSE 0 END) active,
            SUM(CASE WHEN active=0 AND archived=0 THEN 1 ELSE 0 END) paused,
            SUM(CASE WHEN archived=1 THEN 1 ELSE 0 END) ended,COUNT(*) total
            FROM searches GROUP BY owner_id) m ON m.owner_id=a.id'''+where+' ORDER BY a.name,a.id LIMIT 15 OFFSET ?',(*args,page*15)).fetchall()
    return {'items':[{**accounts.public_user(r),'client_number':r['client_number'],
        'monitoring_counts':{key:r[key+'_count'] for key in ('active','paused','ended','total')}} for r in rows],'total':total,'page_size':15}


def monitorings(uid,status,page):
    from .store import decode_search
    clause={'all':'','active':' AND s.active=1 AND s.archived=0','paused':' AND s.active=0 AND s.archived=0','ended':' AND s.archived=1'}[status]
    with db() as c:
        c.execute('BEGIN')
        user=get(uid,c)
        number=c.execute('SELECT number FROM client_refs WHERE entity_id=?',(uid,)).fetchone()[0]
        total=c.execute('SELECT COUNT(*) FROM searches s WHERE s.owner_id=?'+clause,(uid,)).fetchone()[0]
        rows=c.execute('''SELECT s.*,r.number AS monitoring_number FROM searches s
          JOIN monitor_refs r ON r.entity_id=s.id WHERE s.owner_id=?'''+clause+' ORDER BY s.created DESC,s.id LIMIT 15 OFFSET ?',(uid,page*15)).fetchall()
    return {'client':{'id':uid,'name':user['name'],'client_number':number},
            'items':[decode_search(r) for r in rows],'total':total,'page':page,'page_size':15}


def get(uid,c):
    row=c.execute('SELECT * FROM accounts WHERE id=?',(uid,)).fetchone()
    if not row:raise HTTPException(404,'Usuário não encontrado')
    return row


def create(request,actor,data):
    uid=secrets.token_hex(16);hashed=accounts.hash_password(data.password)
    try:
        with db() as c:
            c.execute("INSERT INTO accounts(id,name,role,country,phone,password_hash,created) VALUES(?,?,'user',?,?,?,?)",(uid,data.name,data.country,data.phone,hashed,time.time()))
            accounts.update_contacts_in(c,uid,data)
            c.execute('UPDATE accounts SET language=?,search_limit=? WHERE id=?',(data.language,data.search_limit,uid))
            result=accounts.public_user(get(uid,c))
    except sqlite3.IntegrityError:raise HTTPException(409,'Este telefone já está cadastrado')
    audit.record(request,'admin_account_created',uid,actor['id'])
    return result


def invalidate_recovery(c,uid):
    c.execute('UPDATE password_resets SET used=1 WHERE user_id=?',(uid,))
    c.execute("UPDATE outbox SET status='cancelled' WHERE status='pending' AND id IN (SELECT outbox_id FROM password_resets WHERE user_id=?)",(uid,))


def update(request,actor,uid,data):
    try:
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            previous=get(uid,c)
            if data.search_limit is not None:
                c.execute('UPDATE accounts SET search_limit=? WHERE id=?',(data.search_limit,uid))
            accounts.update_contacts_in(c,uid,data)
            c.execute('UPDATE accounts SET country=?,phone=?,language=? WHERE id=?',(data.country,data.phone,data.language,uid))
            if previous['phone']!=data.phone:
                c.execute('DELETE FROM sessions WHERE user_id=?',(uid,))
                invalidate_recovery(c,uid)
            result=accounts.public_user(get(uid,c))
    except sqlite3.IntegrityError:raise HTTPException(409,'Este telefone já está cadastrado')
    audit.record(request,'admin_account_updated',uid,actor['id'])
    return result


def password(request,actor,uid,data):
    with db() as c:get(uid,c)
    hashed=accounts.hash_password(data.password)
    with db() as c:
        c.execute('BEGIN IMMEDIATE');target=get(uid,c)
        c.execute('UPDATE accounts SET password_hash=? WHERE id=?',(hashed,uid))
        # The new password works at once: the account's login lock is lifted.
        accounts.clear_login_failures(c,target['phone'])
        c.execute('DELETE FROM sessions WHERE user_id=?',(uid,))
        invalidate_recovery(c,uid)
    audit.record(request,'admin_password_reset',uid,actor['id'])
    return {'ok':True,'sessions_revoked':True}
