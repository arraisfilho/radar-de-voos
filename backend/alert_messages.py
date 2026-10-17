"""Channel-specific alert presentation; comparisons remain the engine's decision."""
from datetime import datetime
from html import escape
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from .offer_links import valid_target

LABELS={
 'pt':dict(target='Meta atingida',lower_price='Preço caiu',outbound='IDA',inbound='VOLTA',direct='Direto',stop='escala',stops='escalas',saving='Economia',before='De',now='por',view='Ver passagem',adult='adulto',adults='adultos',passenger='passageiro',passengers='passageiros',scope='preços por trecho',bags='Bagagem a confirmar.',opportunities='Novas oportunidades',notice='Confira disponibilidade e condições antes de comprar.',reminder='Ainda dentro da meta',seen='visto às {0}',manage='Pausar ou editar a viagem'),
 'en':dict(target='Target reached',lower_price='Price drop',outbound='OUTBOUND',inbound='RETURN',direct='Nonstop',stop='stop',stops='stops',saving='Save',before='Was',now='now',view='View flight',adult='adult',adults='adults',passenger='passenger',passengers='passengers',scope='prices per leg',bags='Check baggage allowance.',opportunities='New opportunities',notice='Check availability and conditions before booking.',reminder='Still within target',seen='seen at {0}',manage='Pause or edit this trip'),
 'es':dict(target='Objetivo alcanzado',lower_price='Bajó el precio',outbound='IDA',inbound='VUELTA',direct='Directo',stop='escala',stops='escalas',saving='Ahorro',before='Antes',now='ahora',view='Ver vuelo',adult='adulto',adults='adultos',passenger='pasajero',passengers='pasajeros',scope='precios por trayecto',bags='Equipaje por confirmar.',opportunities='Nuevas oportunidades',notice='Confirma disponibilidad y condiciones antes de comprar.',reminder='Sigue dentro del objetivo',seen='visto a las {0}',manage='Pausar o editar el viaje')}


def clean(value):
    # Provider strings must not inject WhatsApp formatting or extra message lines.
    return ' '.join(str(value).translate(str.maketrans('', '', '*_~`')).split())


def money(cents,currency='BRL',language='pt'):
    amount=f'{cents/100:,.2f}'
    if language in ('pt','es'):amount=amount.replace(',','_').replace('.',',').replace('_','.')
    return ('R$ ' if currency=='BRL' else currency+' ')+amount


def seen_at(events,zone='UTC'):
    # Collection time on the owner's clock; the default zone (UTC) is named so it is not read as local time.
    moment=max((e.get('collected_at') or e['flight'].get('collected_at') or 0 for _,e in events),default=0)
    if not moment:return ''
    try:tz=ZoneInfo(zone)
    except (ZoneInfoNotFoundError,ValueError):tz=ZoneInfo('UTC')
    return datetime.fromtimestamp(moment,tz).strftime('%H:%M')+(' UTC' if tz.key in ('UTC','Etc/UTC') else '')


def render(events,language='pt',channel='text',links=None,name='',page='',zone='UTC'):
    language=language if language in LABELS else 'en';l=LABELS[language]
    links=links or {};bold=(lambda text:'*'+text+'*') if channel=='whatsapp' else (lambda text:text)
    # A reminder (target still met, nothing new) is titled apart from a first alert.
    reason=lambda e:'reminder' if e.get('reason')=='reminder' else e['kind']
    kinds={reason(e) for _,e in events};mixed=len(kinds)>1
    title=l['opportunities'] if mixed else l[next(iter(kinds))]
    clock=seen_at(events,zone)
    about=' · '.join(filter(None,[clean(name),clock and l['seen'].format(clock)]))
    text=[('🎯 ' if kinds<={'target','reminder'} else '💰 ')+bold(title)]+([about] if about else [])
    cards=[];footers=[]
    for index,(direction,event) in enumerate(events):
        f=event['flight'];currency=f.get('currency','BRL')
        start=datetime.fromisoformat(f['departure']);end=datetime.fromisoformat(f['arrival'])
        route=f"{l[direction]} · {clean(f['origin'])} → {clean(f['destination'])}"
        if mixed:route+=' · '+l[reason(event)]
        date_format='%m/%d/%Y · %H:%M' if language=='en' else '%d/%m/%Y · %H:%M'
        date=start.strftime(date_format)+' → '+(end.strftime(date_format) if start.date()!=end.date() else end.strftime('%H:%M'))
        stops=l['direct'] if not f['stops'] else f"{f['stops']} {l['stop'] if f['stops']==1 else l['stops']}"
        hours,minutes=divmod(f['duration_minutes'],60);duration=f'{hours}h'+(f'{minutes:02d}' if minutes else '')
        details=' / '.join(clean(a) for a in f['airlines'])+' · '+stops+' · '+duration
        current=money(event['price_cents'],currency,language)
        previous=event.get('previous');discount=previous is not None and previous>event['price_cents']
        price=(l['before']+' '+money(previous,currency,language)+' '+l['now']+' ' if discount else '')+bold(current)
        saving=''
        if discount:
            saving=f"💰 {l['saving']}: {money(previous-event['price_cents'],currency,language)} · {round(100*(previous-event['price_cents'])/previous)}%"
        link=links.get(index) or (f.get('search_url','') if valid_target(f.get('search_url','')) else '')
        text.extend(['', '✈️ '+bold(route),date,details,price])
        if saving:text.append(saving)
        if link:text.append('🔗 '+l['view']+': '+link)
        extra=sum(f.get(k,0) for k in ('children','infants_in_seat','infants_on_lap'))
        count=f.get('adults',1)+extra
        party=f"{count} {l['passenger'] if count==1 else l['passengers']}" if extra else f"{count} {l['adult'] if count==1 else l['adults']}"
        footer=party+' · '+l['scope']
        if footer not in footers:footers.append(footer)
        old=f'<del style="color:#526176;font-size:14px">{escape(money(previous,currency,language))}</del> ' if discount else ''
        button=(f'<a href="{escape(link,quote=True)}" style="display:inline-block;background:#365d86;color:#fff;padding:11px 18px;border-radius:6px;text-decoration:none;font-weight:600">{escape(l["view"])}</a>') if link else ''
        cards.append(f'<section style="border:1px solid #d4dce6;border-radius:10px;padding:20px;margin:16px 0"><h2 style="margin:0 0 10px;font-size:18px">{escape(route)}</h2><p>{escape(date)}</p><p style="color:#526176">{escape(details)}</p><p>{old}<strong style="font-size:26px;color:#28583f">{escape(current)}</strong></p>'+ (f'<p>{escape(saving)}</p>' if saving else '')+button+'</section>')
    text.extend(['',*footers,l['bags']])
    if page:text.append(l['manage']+': '+page)
    manage=f'<br><a href="{escape(page,quote=True)}" style="color:#365d86">{escape(l["manage"])}</a>' if page else ''
    html=f'<!doctype html><html lang="{language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f3f6f9;font:16px/1.5 Arial,sans-serif;color:#243044"><main style="max-width:600px;margin:auto;padding:24px"><h1 style="font-size:24px">{escape(title)}</h1>'+(f'<p style="margin:-8px 0 0;color:#526176">{escape(about)}</p>' if about else '')+''.join(cards)+f'<p style="font-size:14px;color:#526176">{escape(" · ".join(footers))}<br>{escape(l["bags"])}<br>{escape(l["notice"])}{manage}</p></main></body></html>'
    return '\n'.join(text),html
