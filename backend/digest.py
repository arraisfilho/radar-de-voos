"""Daily health summary, off by default: from HOUR in each administrator's time zone, about the previous local day.

It goes through the outbox (kind 'health_digest') on the channels of the incident notices and waits for the
administrator's quiet hours. The local date it was sent is kept per administrator, so a restart never sends
it twice; past HOUR, a summary not sent yet that day goes at the next check.
"""
from datetime import datetime, time as day_start, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from . import accounts, canary, health, incidents, whatsapp
from .store import db

KEY = 'health_digest'
SENT = 'health_digest_sent:'
HOUR = 8
KIND = 'health_digest'


def enabled(c):
    row = c.execute('SELECT value FROM metadata WHERE key=?', (KEY,)).fetchone()
    return bool(row and row[0] == '1')


def set_enabled(on):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        before = enabled(c)
        c.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)', (KEY, '1' if on else '0'))
    return before


def zone(name):
    try:
        return ZoneInfo(name or 'UTC')
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo('UTC')


def window(now, tz):
    """The local day before now's: its start, its end and its date."""
    today = datetime.fromtimestamp(now, tz).date()
    day = today-timedelta(days=1)
    return datetime.combine(day, day_start(0), tz).timestamp(), datetime.combine(today, day_start(0), tz).timestamp(), day


def summary(c, start, end, now):
    """The numbers of [start, end): queries, alerts per channel, incidents and the canary; active trips now."""
    total, answered = c.execute("SELECT COUNT(*),SUM(status IN ('ok','empty')) FROM source_queries WHERE at>=? AND at<?", (start, end)).fetchone()
    durations = [r[0] for r in c.execute('SELECT duration_ms FROM source_queries WHERE at>=? AND at<?', (start, end))]
    alerts = {r['channel']: {'sent': r['sent'] or 0, 'delivered': r['delivered'] or 0} for r in c.execute(
        "SELECT channel,SUM(status='sent') sent,SUM(receipt_status IN ('delivered','read')) delivered FROM outbox WHERE kind='alert' AND created>=? AND created<? GROUP BY channel", (start, end))}
    rows = c.execute('SELECT code,opened_at,resolved_at FROM health_incidents WHERE opened_at<? AND (resolved_at IS NULL OR resolved_at>=?)', (end, start)).fetchall()
    longest = max(rows, key=lambda r: (r['resolved_at'] or now)-r['opened_at'], default=None)
    probe = c.execute("SELECT COUNT(*),SUM(status IN ('ok','empty')),AVG(duration_ms) FROM source_queries WHERE search_id=? AND at>=? AND at<?", (canary.ID, start, end)).fetchone()
    return {'queries': total, 'success_rate': round(answered/total, 4) if total else None, 'p95_ms': health.percentile(durations, .95),
            'active_trips': c.execute('SELECT COUNT(*) FROM searches WHERE active=1 AND archived=0').fetchone()[0], 'alerts': alerts,
            'incidents': len(rows), 'longest': {'code': longest['code'], 'duration_s': round((longest['resolved_at'] or now)-longest['opened_at'])} if longest else None,
            'canary': {**canary.settings(c), 'total': probe[0], 'answered': probe[1] or 0, 'mean_ms': None if probe[2] is None else round(probe[2])}}


TEXTS = {
    'pt': dict(title='Resumo de {0}', queries='Consultas: {0} · {1} com sucesso · p95 {2}', no_queries='Consultas: nenhuma', trips='Viagens ativas: {0}',
               alerts='Alertas: {0}', no_alerts='Alertas: nenhum enviado', sent=('{0} enviado', '{0} enviados'), delivered=('{0} entregue', '{0} entregues'),
               incidents='Incidentes: {0} · o mais longo: {1}, {2}', no_incidents='Incidentes: nenhum', canary='Rota de controle {0}: {1} de {2} com resposta · média {3}',
               canary_idle='Rota de controle {0}: nenhuma consulta', canary_off='Rota de controle: desligada', email='E-mail', subject='Resumo diário de {0}'),
    'en': dict(title='Summary of {0}', queries='Queries: {0} · {1} successful · p95 {2}', no_queries='Queries: none', trips='Active trips: {0}',
               alerts='Alerts: {0}', no_alerts='Alerts: none sent', sent=('{0} sent', '{0} sent'), delivered=('{0} delivered', '{0} delivered'),
               incidents='Incidents: {0} · longest: {1}, {2}', no_incidents='Incidents: none', canary='Control route {0}: {1} of {2} answered · mean {3}',
               canary_idle='Control route {0}: no queries', canary_off='Control route: off', email='E-mail', subject='Daily summary of {0}'),
    'es': dict(title='Resumen del {0}', queries='Consultas: {0} · {1} con éxito · p95 {2}', no_queries='Consultas: ninguna', trips='Viajes activos: {0}',
               alerts='Alertas: {0}', no_alerts='Alertas: ninguna enviada', sent=('{0} enviada', '{0} enviadas'), delivered=('{0} entregada', '{0} entregadas'),
               incidents='Incidentes: {0} · el más largo: {1}, {2}', no_incidents='Incidentes: ninguno', canary='Ruta de control {0}: {1} de {2} con respuesta · media {3}',
               canary_idle='Ruta de control {0}: ninguna consulta', canary_off='Ruta de control: desactivada', email='Correo', subject='Resumen diario del {0}'),
}


def number(value, language, digits=0):
    """1.234 and 8,2 in Portuguese and Spanish, 1,234 and 8.2 in English; no decimal when it is zero."""
    text = f'{value:,.{digits}f}'
    if digits and text.endswith('.'+'0'*digits):
        text = text[:-digits-1]
    return text.replace(',', '_').replace('.', ',').replace('_', '.') if language in ('pt', 'es') else text


def millis(ms, language):
    return '—' if ms is None else f'{ms} ms' if ms < 1000 else number(ms/1000, language, 1)+' s'


def message(data, day, language, link):
    """Subject and the WhatsApp and e-mail bodies of one summary."""
    language = language if language in TEXTS else 'en'
    l = TEXTS[language]
    count = lambda forms, n: forms[0 if n == 1 else 1].format(number(n, language))
    date = day.strftime('%m/%d' if language == 'en' else '%d/%m')
    head = 'Radar de Voos · '+l['title'].format(date)
    lines = [l['queries'].format(number(data['queries'], language), number(100*data['success_rate'], language, 1)+'%', millis(data['p95_ms'], language))
             if data['queries'] else l['no_queries'], l['trips'].format(number(data['active_trips'], language))]
    channels = []
    for channel in ('whatsapp', 'email'):
        sent = (data['alerts'].get(channel) or {}).get('sent', 0)
        if sent:
            delivered = data['alerts'][channel]['delivered']
            channels.append(('WhatsApp' if channel == 'whatsapp' else l['email'])+' '+count(l['sent'], sent)+(', '+count(l['delivered'], delivered) if channel == 'whatsapp' else ''))
    lines.append(l['alerts'].format(' · '.join(channels)) if channels else l['no_alerts'])
    longest = data['longest']
    lines.append(l['incidents'].format(data['incidents'], incidents.TEXTS[language]['labels'].get(longest['code'], longest['code']), incidents.lasting(longest['duration_s']))
                 if longest else l['no_incidents'])
    probe, route = data['canary'], f"{data['canary']['origin']} → {data['canary']['destination']}"
    lines.append(l['canary_off'] if not probe['enabled'] else l['canary'].format(route, number(probe['answered'], language), number(probe['total'], language), millis(probe['mean_ms'], language))
                 if probe['total'] else l['canary_idle'].format(route))
    if link:
        lines.append(incidents.TEXTS[language]['link'].format(link))
    return 'Radar de Voos · '+l['subject'].format(date), '\n'.join(['*'+head+'*']+lines), '\n'.join([head]+lines)


def send_due(now=None):
    """Queue the summary for each administrator past HOUR on their clock who has not had today's; returns the outbox ids."""
    import time
    now = time.time() if now is None else now
    queued = []
    with db() as c:
        # Off (the default): a plain read, no write lock every minute.
        if not enabled(c):
            return queued
        c.execute('BEGIN IMMEDIATE')
        if not enabled(c):
            return queued
        available, config, link = incidents.channels_available(), whatsapp.settings(), incidents.page_link()
        for admin in c.execute("SELECT * FROM accounts WHERE role='admin' ORDER BY created,id").fetchall():
            tz = zone(admin['timezone'])
            local = datetime.fromtimestamp(now, tz)
            sent = c.execute('SELECT value FROM metadata WHERE key=?', (SENT+admin['id'],)).fetchone()
            if local.hour < HOUR or (sent and sent[0] >= local.date().isoformat()):
                continue
            start, end, day = window(now, tz)
            subject, chat, text = message(summary(c, start, end, now), day, admin['language'], link)
            # Informative: it waits for the quiet hours like a warning.
            due = accounts.quiet_until(admin, now) or now
            for channel, recipients in incidents.contacts(admin).items():
                if recipients and available[channel]:
                    queued.append(incidents.queue(c, admin, channel, recipients, subject, chat if channel == 'whatsapp' else text, due, now, KIND, config))
            # Recorded even without a channel: one summary per local day, whatever happens.
            c.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)', (SENT+admin['id'], local.date().isoformat()))
    return queued
