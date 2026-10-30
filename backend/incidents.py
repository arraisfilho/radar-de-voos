"""Health incidents opened by the watcher over health.assess(), and notices to the administrators.

A reason code opens an incident after OPEN_AFTER checks in a row and resolves it after RESOLVE_AFTER
checks in a row without it. Every administrator is told through the outbox (kind 'health') on the
profile's WhatsApp and e-mail: once when it opens, every REMIND_SECONDS while it stays open and
unacknowledged, and when it resolves, if a notice went out. A code about one channel, or a channel
that is down in this check, is never used for the notice; with no channel left the incident records
'not_notified'. Warnings wait for the administrator's quiet hours to end, critical incidents do not.
"""
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import HTTPException
from . import accounts, health, mail, whatsapp
from .alert_messages import clean
from .store import db

logger = logging.getLogger('radar.health')
CHECK_SECONDS = 60
OPEN_AFTER = 2
RESOLVE_AFTER = 3
REMIND_SECONDS = 7200
# A code back within REOPEN_SECONDS of its resolution reopens that incident, silently; "Resolvido" goes only
# for an incident that lasted RESOLVED_NOTICE seconds or was reopened, and once per notice that went out.
REOPEN_SECONDS = 1800
RESOLVED_NOTICE = 300
# Outbox states of a notice that went or will go out.
GOING = ('sent', 'sending', 'pending')
RESOLVED_LIMIT = 20
STATE_KEY = 'health_watch'
SETTING_KEY = 'health_notices'
# Streaks restart when the last check is older than this: the watcher was not running in between.
STALE_STATE = 3*CHECK_SECONDS
# Codes about one delivery channel: that channel never carries their notices.
AFFECTS = {'whatsapp_late': 'whatsapp', 'whatsapp_failing': 'whatsapp', 'email_late': 'email', 'email_failing': 'email'}
CHANNELS = ('whatsapp', 'email')


def setup(c):
    c.execute('''CREATE TABLE IF NOT EXISTS health_incidents(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT NOT NULL,
      level TEXT NOT NULL CHECK(level IN ('warning','critical')),opened_at REAL NOT NULL,updated_at REAL NOT NULL,resolved_at REAL,
      acknowledged_at REAL,acknowledged_by TEXT REFERENCES accounts(id),last_notified_at REAL,details TEXT NOT NULL DEFAULT '{}',
      notified_count INTEGER NOT NULL DEFAULT 0,notice TEXT)''')
    if 'reopened' not in {r[1] for r in c.execute('PRAGMA table_info(health_incidents)')}:
        c.execute('ALTER TABLE health_incidents ADD COLUMN reopened INTEGER NOT NULL DEFAULT 0')
    c.execute('CREATE UNIQUE INDEX IF NOT EXISTS health_incidents_open ON health_incidents(code) WHERE resolved_at IS NULL')
    c.execute('CREATE INDEX IF NOT EXISTS health_incidents_resolved ON health_incidents(resolved_at)')
    # The outbox rows of each notice; event is 'opened', 'reminder-N', 'resolved-N' or 'reopened-N'.
    c.execute('CREATE TABLE IF NOT EXISTS health_notices(outbox_id TEXT PRIMARY KEY,incident_id INTEGER NOT NULL,event TEXT NOT NULL)')
    c.execute('CREATE INDEX IF NOT EXISTS health_notices_incident ON health_notices(incident_id)')
    # capacity_high (an estimate, never a measured effect) is gone: its incidents go with it, without a "Resolvido".
    c.execute("UPDATE outbox SET status='cancelled',error='Incidente resolvido antes do envio' WHERE status='pending' AND id IN (SELECT n.outbox_id FROM health_notices n JOIN health_incidents i ON i.id=n.incident_id WHERE i.code='capacity_high')")
    c.execute("DELETE FROM health_notices WHERE incident_id IN (SELECT id FROM health_incidents WHERE code='capacity_high')")
    c.execute("DELETE FROM health_incidents WHERE code='capacity_high'")


def notices_enabled(c):
    row = c.execute('SELECT value FROM metadata WHERE key=?', (SETTING_KEY,)).fetchone()
    return not row or row[0] != '0'


def set_notices(enabled):
    """Turn the notices on or off for every administrator; the watcher keeps recording. Returns the previous value."""
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        before = notices_enabled(c)
        c.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)', (SETTING_KEY, '1' if enabled else '0'))
    return before


TEXTS = {
    'pt': dict(critical='Crítico', warning='Atenção', reminder='lembrete', resolved='Resolvido em {0}', reopened='Voltou: {0}', since='Desde {0}.', link='Ver em {0}',
               worker_stopped='{name} parado.', worker_late='{name} sem sinal há {age} (limite: {limit}).',
               collector='Coletor de tarifas', whatsapp_sender='Envio de WhatsApp', email_sender='Envio de e-mail',
               source_paused='Fonte de tarifas pausada há {paused}.', error_rate='{rate} das consultas da última hora falharam ({failed} de {total}).',
               queue_delay='Uma viagem espera na fila de coletas há {delay}.', stale_trip='A viagem {route} está sem coleta há {age}.',
               whatsapp_failing='As últimas {count} mensagens de WhatsApp falharam.', email_failing='Os últimos {count} e-mails falharam.',
               source_canary='A rota de controle {route} falhou nas últimas {count} consultas.',
               labels=dict(source_canary='Rota de controle falhando', source_paused='Fonte de tarifas pausada', collector_late='Coletor de tarifas sem sinal', whatsapp_late='Envio de WhatsApp sem sinal',
                           email_late='Envio de e-mail sem sinal', error_rate='Falhas nas consultas à fonte', queue_delay='Fila de coletas atrasada',
                           stale_trip='Viagem sem coleta', whatsapp_failing='Falhas no envio de WhatsApp', email_failing='Falhas no envio de e-mail')),
    'en': dict(critical='Critical', warning='Attention', reminder='reminder', resolved='Resolved in {0}', reopened='Back: {0}', since='Since {0}.', link='See {0}',
               worker_stopped='{name} stopped.', worker_late='{name} silent for {age} (limit: {limit}).',
               collector='Fare collector', whatsapp_sender='WhatsApp sending', email_sender='E-mail sending',
               source_paused='Fare source paused for {paused}.', error_rate="{rate} of the last hour's queries failed ({failed} of {total}).",
               queue_delay='A trip has been waiting in the collection queue for {delay}.', stale_trip='The trip {route} has not been collected for {age}.',
               whatsapp_failing='The last {count} WhatsApp messages failed.', email_failing='The last {count} e-mails failed.',
               source_canary='The control route {route} failed its last {count} queries.',
               labels=dict(source_canary='Control route failing', source_paused='Fare source paused', collector_late='Fare collector silent', whatsapp_late='WhatsApp sending silent',
                           email_late='E-mail sending silent', error_rate='Fare source queries failing', queue_delay='Collection queue delayed',
                           stale_trip='Trip not collected', whatsapp_failing='WhatsApp sending failing', email_failing='E-mail sending failing')),
    'es': dict(critical='Crítico', warning='Atención', reminder='recordatorio', resolved='Resuelto en {0}', reopened='Volvió: {0}', since='Desde las {0}.', link='Ver en {0}',
               worker_stopped='{name} detenido.', worker_late='{name} sin señal desde hace {age} (límite: {limit}).',
               collector='Consultas de tarifas', whatsapp_sender='Envío de WhatsApp', email_sender='Envío de correo',
               source_paused='Fuente de tarifas en pausa desde hace {paused}.', error_rate='Fallaron el {rate} de las consultas de la última hora ({failed} de {total}).',
               queue_delay='Un viaje espera en la cola de consultas desde hace {delay}.', stale_trip='El viaje {route} no se consulta desde hace {age}.',
               whatsapp_failing='Fallaron los últimos {count} mensajes de WhatsApp.', email_failing='Fallaron los últimos {count} correos.',
               source_canary='La ruta de control {route} falló en sus últimas {count} consultas.',
               labels=dict(source_canary='Ruta de control con fallos', source_paused='Fuente de tarifas en pausa', collector_late='Consultas de tarifas sin señal', whatsapp_late='Envío de WhatsApp sin señal',
                           email_late='Envío de correo sin señal', error_rate='Fallos en las consultas a la fuente', queue_delay='Cola de consultas retrasada',
                           stale_trip='Viaje sin consultar', whatsapp_failing='Fallos en el envío de WhatsApp', email_failing='Fallos en el envío de correo')),
}


def lasting(seconds):
    """'45 s', '25 min', '2 h', '2 h 5 min': the same in the three languages."""
    seconds = max(0, seconds or 0)
    if seconds < 60:
        return f'{round(seconds)} s'
    hours, minutes = divmod(round(seconds/60), 60)
    return f'{hours} h {minutes} min' if hours and minutes else f'{hours} h' if hours else f'{minutes} min'


def clock(moment, zone, language, now):
    try:
        tz = ZoneInfo(zone or 'UTC')
    except (ZoneInfoNotFoundError, ValueError):
        tz = ZoneInfo('UTC')
    local, today = datetime.fromtimestamp(moment, tz), datetime.fromtimestamp(now, tz)
    if local.date() == today.date():
        return local.strftime('%H:%M')
    return local.strftime('%m/%d %H:%M' if language == 'en' else '%d/%m %H:%M')


def describe(code, details, language='pt'):
    """What happened, with the numbers of the incident, in the administrator's language."""
    l = TEXTS[language if language in TEXTS else 'en']
    if code in health.WORKERS:
        name = l[health.WORKERS[code]]
        return l['worker_stopped'].format(name=name) if not details.get('alive') else l['worker_late'].format(name=name, age=lasting(details.get('age_s')), limit=lasting(details.get('limit_s')))
    if code == 'source_paused':
        return l[code].format(paused=lasting(details.get('paused_s')))
    if code == 'error_rate':
        return l[code].format(rate=f"{round(100*details.get('rate', 0))}%", failed=details.get('failed'), total=details.get('total'))
    if code == 'queue_delay':
        return l[code].format(delay=lasting(details.get('max_delay_s')))
    if code == 'stale_trip':
        # The route, never the trip's free-text name.
        return l[code].format(route=clean(details.get('route') or ''), age=lasting(details.get('age_s')))
    if code in ('whatsapp_failing', 'email_failing'):
        return l[code].format(count=details.get('failed_streak'))
    if code == 'source_canary':
        return l[code].format(route=f"{details.get('origin')} → {details.get('destination')}", count=details.get('failed_streak'))
    return l['labels'].get(code, code)


def message(incident, event, admin, now, link):
    """Subject and the WhatsApp and e-mail bodies of one notice, on the administrator's clock and language."""
    language = admin['language'] if admin['language'] in TEXTS else 'en'
    l = TEXTS[language]
    label = l['labels'].get(incident['code'], incident['code'])
    since = clock(incident['opened_at'], admin['timezone'], language, now)
    subject = None
    if event.startswith('resolved'):
        head = 'Radar de Voos · '+l['resolved'].format(lasting(incident['resolved_at']-incident['opened_at']))
        lines = [label+' · '+l['since'].format(since).rstrip('.')]
    elif event.startswith('reopened'):
        # Back after a "Resolvido": since when it is back.
        head = subject = 'Radar de Voos · '+l['reopened'].format(label)
        lines = [describe(incident['code'], incident['details'], language), l['since'].format(clock(incident.get('back_at') or now, admin['timezone'], language, now))]
    else:
        head = 'Radar de Voos · '+l[incident['level']]+(' ('+l['reminder']+')' if event.startswith('reminder') else '')
        lines = [describe(incident['code'], incident['details'], language), l['since'].format(since)]
    if link:
        lines.append(l['link'].format(link))
    return subject or head+': '+label, '\n'.join(['*'+head+'*']+lines), '\n'.join([head]+lines)


def page_link():
    from . import offer_links
    try:
        return offer_links.origin()+'/admin/saude'
    except ValueError:
        return ''


def contacts(admin):
    """The profile's WhatsApp number and e-mail addresses of an administrator."""
    number, country = (admin['phone'], admin['country']) if admin['whatsapp_use_login'] else (admin['whatsapp_phone'], admin['whatsapp_country'])
    try:
        phone = accounts.phone_e164(number, country) if number else None
    except ValueError:
        phone = None
    return {'whatsapp': [phone] if phone else [], 'email': json.loads(admin['emails'] or '[]')}


def queue(c, admin, channel, recipients, subject, body, due, now, kind, config):
    """One pending outbox row for an account (health notices, recovery codes), for the existing senders;
    config is whatsapp.settings()."""
    oid = uuid.uuid4().hex
    if channel == 'whatsapp':
        c.execute("INSERT INTO outbox(id,created,alert_ids,subject,body,status,next_due,recipients,owner_id,channel,provider,transport_ref,kind) VALUES(?,?,'[]',?,?,'pending',?,?,?,'whatsapp',?,?,?)",
                  (oid, now, subject, body, due, json.dumps(recipients), admin['id'], config['provider'], whatsapp.reference(config), kind))
    else:
        c.execute("INSERT INTO outbox(id,created,alert_ids,subject,body,status,next_due,recipients,owner_id,channel,kind) VALUES(?,?,'[]',?,?,'pending',?,?,?,'email',?)",
                  (oid, now, subject, body, due, json.dumps(recipients), admin['id'], kind))
    return oid


def channels_available():
    return {'whatsapp': whatsapp.available(), 'email': mail.available()}


class Notices:
    """What one check needs to notify: read once, on the first notice of the check."""

    def __init__(self, c, now, down):
        self.c, self.now, self.down, self.loaded = c, now, down, False

    def load(self):
        if not self.loaded:
            self.enabled = notices_enabled(self.c)
            self.admins = self.c.execute("SELECT * FROM accounts WHERE role='admin' ORDER BY created,id").fetchall()
            self.available = channels_available()
            self.whatsapp = whatsapp.settings()
            self.link = page_link()
            self.loaded = True

    def send(self, incident, event):
        """Queue one notice to every administrator, each in a savepoint of its own; updates the count and state."""
        self.load()
        queued = []
        if self.enabled:
            for admin in self.admins:
                self.c.execute('SAVEPOINT health_notice')
                try:
                    due = self.now if incident['level'] == 'critical' else accounts.quiet_until(admin, self.now) or self.now
                    subject, chat, text = message(incident, event, admin, self.now, self.link)
                    rows = []
                    for channel, recipients in contacts(admin).items():
                        if not recipients or not self.available[channel] or channel == AFFECTS.get(incident['code']) or channel in self.down:
                            continue
                        oid = queue(self.c, admin, channel, recipients, subject, chat if channel == 'whatsapp' else text, due, self.now, 'health', self.whatsapp)
                        self.c.execute('INSERT INTO health_notices VALUES(?,?,?)', (oid, incident['id'], event))
                        rows.append(due)
                    self.c.execute('RELEASE health_notice')
                    queued += rows
                except Exception:
                    # One administrator's broken profile never undoes the check or the others' notices.
                    self.c.execute('ROLLBACK TO health_notice'); self.c.execute('RELEASE health_notice')
                    logger.warning('Falha ao preparar aviso de saúde', exc_info=True, extra={'incident_id': incident['id'], 'account_id': admin['id']})
        state = ('held' if min(queued) > self.now else 'sent') if queued else 'not_notified' if self.enabled else 'disabled'
        self.c.execute('UPDATE health_incidents SET notified_count=?,notice=? WHERE id=?', (notice_state(self.c, incident['id'])['count'], state, incident['id']))
        return bool(queued)


# The notices of an incident: still to go (pending, sending), the last real send, the last attempt not
# cancelled, the events that went or will go out (GOING) and every event ever queued.
NOTICE_STATE = """SELECT COALESCE(SUM(o.status IN ('pending','sending')),0) waiting,
  MAX(CASE WHEN o.status='sent' THEN COALESCE(o.sent,o.created) END) sent,
  MAX(CASE WHEN o.status!='cancelled' THEN o.created END) tried,
  COUNT(DISTINCT CASE WHEN o.status IN ('sent','sending','pending') THEN n.event END) count,
  COUNT(DISTINCT n.event) events
  FROM health_notices n JOIN outbox o ON o.id=n.outbox_id WHERE n.incident_id=?"""


def notice_state(c, incident_id):
    return dict(c.execute(NOTICE_STATE, (incident_id,)).fetchone())


def last_notice(c, incident_id):
    """The incident's last notice that went or will go out (GOING): its event and when it was queued; None without one."""
    return c.execute("SELECT n.event,o.created FROM health_notices n JOIN outbox o ON o.id=n.outbox_id WHERE n.incident_id=? AND o.status IN ('sent','sending','pending') ORDER BY o.created DESC,o.id DESC LIMIT 1",
                     (incident_id,)).fetchone()


def mark_sent(c, outbox_id, at):
    """Called by the senders: the incident's last notice is the one that just went out."""
    c.execute('UPDATE health_incidents SET last_notified_at=? WHERE id=(SELECT incident_id FROM health_notices WHERE outbox_id=?)', (at, outbox_id))


def follow_up(c, notices, incident, now):
    """An open, unacknowledged incident: its first notice when none is on its way or went out, then a reminder
    REMIND_SECONDS after the last real send (or the last failed attempt); nothing while one is still to go."""
    info = notice_state(c, incident['id'])
    c.execute('UPDATE health_incidents SET notified_count=?,last_notified_at=COALESCE(?,last_notified_at) WHERE id=?', (info['count'], info['sent'], incident['id']))
    if info['waiting']:
        return
    if info['tried'] is None and not info['sent']:
        notices.send(incident, 'opened')
    elif now-(info['sent'] or info['tried']) >= REMIND_SECONDS:
        notices.send(incident, 'reminder-%d' % info['events'])


def withdraw(c, incident_id, now, reason):
    """Cancel the incident's notices still held by quiet hours; returns the notices that went or will go out."""
    for row in c.execute("SELECT o.id FROM outbox o JOIN health_notices n ON n.outbox_id=o.id WHERE n.incident_id=? AND o.status='pending' AND o.next_due>?", (incident_id, now)).fetchall():
        c.execute("UPDATE outbox SET status='cancelled',error=? WHERE id=?", (reason, row['id']))
    count = notice_state(c, incident_id)['count']
    c.execute('UPDATE health_incidents SET notified_count=? WHERE id=?', (count, incident_id))
    return count


def cleanup(c, now):
    """Incidents resolved more than 90 days ago, and links to notices or incidents that are gone."""
    c.execute('DELETE FROM health_incidents WHERE resolved_at<?', (now-90*86400,))
    c.execute('DELETE FROM health_notices WHERE outbox_id NOT IN (SELECT id FROM outbox) OR incident_id NOT IN (SELECT id FROM health_incidents)')


def cancel_for(c, account_id, reason='Contato alterado; o aviso será refeito'):
    """A profile's contacts changed: its pending health notices go nowhere stale; the next check or reminder rebuilds them."""
    c.execute("UPDATE outbox SET status='cancelled',error=? WHERE owner_id=? AND kind IN ('health','health_digest') AND status='pending'", (reason, account_id))


def load_state(c, now):
    row = c.execute('SELECT value FROM metadata WHERE key=?', (STATE_KEY,)).fetchone()
    try:
        data = json.loads(row[0]) if row else {}
    except ValueError:
        data = {}
    if not isinstance(data, dict) or not 0 <= now-data.get('checked_at', 0) <= STALE_STATE:
        return {}
    return data.get('codes') or {}


def check(metrics):
    """One watcher check over collected metrics: open, update, remind and resolve incidents. Returns the open ones."""
    now = metrics['generated_at']
    present = {code: health.details(code, metrics) for code in metrics['status']['reasons']}
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        streaks = load_state(c, now)
        current = {r['code']: dict(r) for r in c.execute('SELECT * FROM health_incidents WHERE resolved_at IS NULL')}
        notices = Notices(c, now, {AFFECTS[code] for code in present if code in AFFECTS})
        kept = {}
        for code in sorted(set(present) | set(current) | set(streaks)):
            last = streaks.get(code) or {}
            if code in present:
                streak = {'seen': last.get('seen', 0)+1, 'since': last['since'] if last.get('seen') else now, 'clear': 0}
            else:
                streak = {'seen': 0, 'clear': last.get('clear', 0)+1, 'cleared': last['cleared'] if last.get('clear') else now}
            incident = current.get(code)
            if incident and code in present:
                c.execute('UPDATE health_incidents SET updated_at=?,details=? WHERE id=?', (now, json.dumps(present[code], sort_keys=True), incident['id']))
                incident['details'] = present[code]
                if not incident['acknowledged_at']:
                    follow_up(c, notices, incident, now)
            elif incident and streak['clear'] >= RESOLVE_AFTER:
                incident.update(resolved_at=streak['cleared'], details=json.loads(incident['details']))
                c.execute('UPDATE health_incidents SET resolved_at=?,updated_at=? WHERE id=?', (streak['cleared'], now, incident['id']))
                told = withdraw(c, incident['id'], now, 'Incidente resolvido antes do envio')
                last = last_notice(c, incident['id'])
                # Told it opened, long enough or back once, and not told yet that it resolved.
                if told and (streak['cleared']-incident['opened_at'] >= RESOLVED_NOTICE or incident['reopened']) and not (last and last['event'].startswith('resolved')):
                    notices.send(incident, 'resolved-%d' % notice_state(c, incident['id'])['events'])
                logger.info('Incidente de saúde resolvido', extra={'incident_id': incident['id'], 'code': code})
                continue
            elif not incident and code in present and streak['seen'] >= OPEN_AFTER and (recent := c.execute(
                    'SELECT id FROM health_incidents WHERE code=? AND resolved_at>=? ORDER BY resolved_at DESC LIMIT 1', (code, now-REOPEN_SECONDS)).fetchone()):
                # Back soon after resolving: the same incident again, without a new opening notice. Told it
                # resolved, the administrators read "Voltou", at most once every REMIND_SECONDS (flapping).
                row = dict(c.execute('SELECT * FROM health_incidents WHERE id=?', (recent['id'],)).fetchone())
                c.execute('UPDATE health_incidents SET resolved_at=NULL,updated_at=?,details=?,reopened=reopened+1 WHERE id=?', (now, json.dumps(present[code], sort_keys=True), row['id']))
                incident = {**row, 'resolved_at': None, 'reopened': row['reopened']+1, 'details': present[code], 'back_at': streak['since']}
                last = last_notice(c, row['id'])
                back = c.execute("SELECT MAX(o.created) FROM health_notices n JOIN outbox o ON o.id=n.outbox_id WHERE n.incident_id=? AND n.event LIKE 'reopened%' AND o.status IN ('sent','sending','pending')",
                                 (row['id'],)).fetchone()[0]
                if last and last['event'].startswith('resolved') and not (back is not None and now-back < REMIND_SECONDS):
                    notices.send(incident, 'reopened-%d' % notice_state(c, row['id'])['events'])
                logger.warning('Incidente de saúde reaberto', extra={'incident_id': row['id'], 'code': code})
            elif not incident and code in present and streak['seen'] >= OPEN_AFTER:
                level = health.LEVELS[code]
                cursor = c.execute('INSERT INTO health_incidents(code,level,opened_at,updated_at,details) VALUES(?,?,?,?,?)',
                                   (code, level, streak['since'], now, json.dumps(present[code], sort_keys=True)))
                incident = {'id': cursor.lastrowid, 'code': code, 'level': level, 'opened_at': streak['since'], 'details': present[code], 'notified_count': 0, 'reopened': 0}
                logger.warning('Incidente de saúde aberto', extra={'incident_id': incident['id'], 'code': code, 'level': level})
                notices.send(incident, 'opened')
            if code in present or incident:
                kept[code] = streak
        c.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)', (STATE_KEY, json.dumps({'checked_at': now, 'codes': kept}, sort_keys=True)))
        return [r['id'] for r in c.execute('SELECT id FROM health_incidents WHERE resolved_at IS NULL')]


def watch(worker_status, now=None):
    """The watcher's check: health.collect() (whose percentile cache the page shares), then check()."""
    return check(health.collect(worker_status, now))


def public(row):
    item = dict(row)
    try:
        item['details'] = json.loads(item['details'] or '{}')
    except ValueError:
        item['details'] = {}
    return item


# held_until: when the first notice held by quiet hours goes out.
SELECT = '''SELECT i.*,a.name AS acknowledged_name,(SELECT MIN(o.next_due) FROM health_notices n JOIN outbox o ON o.id=n.outbox_id
  WHERE n.incident_id=i.id AND o.status='pending' AND o.next_due>strftime('%s','now')) AS held_until
  FROM health_incidents i LEFT JOIN accounts a ON a.id=i.acknowledged_by'''


def overview():
    """The open incidents (newest first), the last RESOLVED_LIMIT resolved ones and the notice setting."""
    with db() as c:
        c.execute('BEGIN')
        rows = c.execute(SELECT+' WHERE i.resolved_at IS NULL ORDER BY i.opened_at DESC,i.id DESC').fetchall()
        rows += c.execute(SELECT+' WHERE i.resolved_at IS NOT NULL ORDER BY i.resolved_at DESC,i.id DESC LIMIT ?', (RESOLVED_LIMIT,)).fetchall()
        from . import canary, digest
        return {'incidents': [public(r) for r in rows], 'settings': {'notices': notices_enabled(c), 'digest': digest.enabled(c), 'canary': canary.settings(c)}}


def acknowledge(incident_id, actor_id, now=None):
    """Silence the reminders of an open incident and withdraw its held notices; (incident, changed)."""
    now = time.time() if now is None else now
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row = c.execute('SELECT * FROM health_incidents WHERE id=?', (incident_id,)).fetchone()
        if not row:
            raise HTTPException(404, 'Incidente não encontrado')
        if row['resolved_at'] is not None:
            raise HTTPException(409, 'Este incidente já foi resolvido.')
        changed = row['acknowledged_at'] is None
        if changed:
            c.execute('UPDATE health_incidents SET acknowledged_at=?,acknowledged_by=? WHERE id=?', (now, actor_id, incident_id))
            withdraw(c, incident_id, now, 'Incidente reconhecido antes do envio')
        return public(c.execute(SELECT+' WHERE i.id=?', (incident_id,)).fetchone()), changed
