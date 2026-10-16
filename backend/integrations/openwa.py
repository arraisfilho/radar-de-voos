"""OpenWA adapter. No redirects, raw provider errors, or automatic POST retries."""
import json
from http.client import HTTPException
from ipaddress import ip_address
from urllib.parse import urlsplit,quote
from urllib.request import Request,build_opener,HTTPRedirectHandler,ProxyHandler
from urllib.error import HTTPError,URLError
from .base import IntegrationError


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None


class OpenWA:
    id='openwa';name='OpenWA'
    help='Use a URL base, sem /api/docs. O ID da sessão é o identificador exibido no integrador.'
    fields=[{'key':'base_url','label':'URL do serviço','secret':False,'default':'','type':'url'},
            {'key':'session_id','label':'ID da sessão','secret':False,'default':'','type':'text'},
            {'key':'token','label':'Token da API','secret':True,'default':'','type':'password'}]

    def normalize(self,values):
        values={str(k):str(v).strip() for k,v in values.items()}
        if any(k not in {'base_url','session_id','token'} for k in values):raise ValueError('Campo de integração desconhecido')
        if any(len(v)>2000 or any(ord(ch)<32 for ch in v) for v in values.values()):raise ValueError('Campo de integração inválido')
        if not values.get('token','').isascii():raise ValueError('Token deve conter apenas caracteres ASCII')
        base=values.get('base_url','').rstrip('/')
        if base:
            u=urlsplit(base)
            local=False
            try:local=ip_address(u.hostname or '').is_private
            except ValueError:local=u.hostname=='localhost'
            if not u.hostname or u.username or u.password or u.query or u.fragment or u.scheme not in ('https','http') or (u.scheme=='http' and not local):raise ValueError('Use uma URL HTTPS válida, sem credenciais ou parâmetros')
            try:u.port
            except ValueError:raise ValueError('Porta inválida na URL')
            if u.path.endswith(('/api','/api/docs')):raise ValueError('Informe a URL base do serviço, sem /api ou /api/docs')
        if len(values.get('session_id',''))>200:raise ValueError('ID de sessão muito longo')
        return {**values,'base_url':base}

    def _request(self,values,method,path,payload=None):
        if not all(values.get(k) for k in ('base_url','session_id','token')):raise IntegrationError('Configure URL, sessão e token do WhatsApp')
        request=Request(values['base_url']+path,method=method,data=json.dumps(payload).encode() if payload is not None else None,headers={'X-API-Key':values['token'],'Content-Type':'application/json','Accept':'application/json'})
        try:
            with build_opener(NoRedirect(),ProxyHandler({})).open(request,timeout=12) as response:
                status=response.status;raw=response.read(1048577)
            if len(raw)>1048576:raise ValueError('large response')
            result=json.loads(raw)
            if not isinstance(result,dict):raise ValueError('invalid response')
            return status,result
        except HTTPError as exc:
            exc.close()
            message={401:'Token do WhatsApp recusado',403:'Acesso à sessão WhatsApp não autorizado',404:'Sessão WhatsApp não encontrada',400:'Sessão WhatsApp inativa ou requisição recusada',429:'Limite da API WhatsApp atingido'}.get(exc.code,'A API WhatsApp não confirmou a operação')
            raise IntegrationError(message,method=='POST' and exc.code>=500) from None
        except (URLError,TimeoutError,OSError,ValueError,HTTPException):
            raise IntegrationError('Não foi possível confirmar a operação no WhatsApp',method=='POST') from None

    def check(self,values):
        status,data=self._request(values,'GET','/api/sessions/'+quote(values['session_id'],safe=''))
        if status!=200 or data.get('id')!=values['session_id']:raise IntegrationError('A API retornou uma sessão diferente da configurada')
        state=data.get('status');allowed={'created','initializing','qr_ready','authenticating','ready','disconnected','failed'}
        if state not in allowed:raise IntegrationError('Estado da sessão WhatsApp desconhecido')
        return {'ready':state=='ready','status':state}

    def send(self,values,phone,text):
        status,data=self._request(values,'POST','/api/sessions/'+quote(values['session_id'],safe='')+'/messages/send-text',{'chatId':phone.lstrip('+')+'@c.us','text':text})
        message_id=data.get('messageId')
        if status!=201 or not isinstance(message_id,str) or not message_id or len(message_id)>500 or values['token'] in message_id or any(ord(c)<32 for c in message_id):raise IntegrationError('A API WhatsApp não retornou uma confirmação válida',True)
        return message_id
