"""Google OAuth + Gmail send-only transport; secrets stay in the private data dir."""
import base64
import hashlib
import json
import os
import secrets
import threading
import time
from email.message import EmailMessage
from pathlib import Path
from typing import Literal
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from pydantic import BaseModel, Field, model_validator
from .store import db
from .network import public_mode, public_origin

AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
TOKEN_URL = 'https://oauth2.googleapis.com/token'
USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
SCOPES = 'openid email ' + SEND_SCOPE
REDIRECT_URI = 'http://127.0.0.1:8765/api/google/callback'
LOCK = threading.RLock()
APPLICATION_CLIENT_FILE = Path(__file__).resolve().parents[1] / 'config' / 'google-oauth-public.json'


class GoogleMailError(Exception):
    pass


class OAuthClient(BaseModel):
    client_id: str = Field(min_length=10, max_length=300)
    client_secret: str = Field(default='', max_length=500)
    client_type: Literal['web','desktop'] = 'web'

    @model_validator(mode='after')
    def valid(self):
        self.client_id = self.client_id.strip()
        self.client_secret = self.client_secret.strip()
        if not self.client_id.endswith('.apps.googleusercontent.com') or any(c.isspace() for c in self.client_id):
            raise ValueError('Informe o Client ID OAuth do Google')
        if any(c in self.client_secret for c in '\r\n\x00'):
            raise ValueError('Client Secret inválido')
        return self


def path():
    from .mail import DATA_DIR
    return DATA_DIR / 'google-oauth-private.json'


def application_client():
    """Official desktop releases can carry the app's public client ID, never tokens/secrets."""
    if not APPLICATION_CLIENT_FILE.exists():
        return {}
    data=json.loads(APPLICATION_CLIENT_FILE.read_text())
    if set(data)-{'client_id','client_type'} or data.get('client_type')!='desktop':
        raise GoogleMailError('A configuração pública do aplicativo deve conter somente Client ID e tipo desktop, sem segredos')
    client_id=data.get('client_id','')
    if not client_id:
        return {}
    OAuthClient(client_id=client_id,client_type='desktop')
    return {'client_id':client_id,'client_type':'desktop'}


def redirect_uri(data=None):
    data=data if data is not None else settings()
    if public_mode():return public_origin()+'/api/google/callback'
    return 'http://127.0.0.1:8765/' if data.get('client_type')=='desktop' else REDIRECT_URI


def ready(data):
    if public_mode() and data.get('client_type','web')!='web':return False
    return bool(data.get('client_id') and (data.get('client_type')=='desktop' or data.get('client_secret')))


def client_parameters(data):
    return {'client_id':data['client_id'], **({'client_secret':data['client_secret']} if data.get('client_secret') else {})}


def settings():
    with LOCK:
        private=json.loads(path().read_text()) if path().exists() else {}
        public={} if public_mode() else application_client()
        if not public:
            return private
        if private.get('client_id')!=public['client_id'] or private.get('client_type')!='desktop':
            if private.get('refresh_token'):
                return {**public,'needs_reconnect':True,'email':private.get('email',''),'error':'A integração do aplicativo foi atualizada. Reconecte sua conta Google.'}
            return public
        # Keep only the matching desktop client's privately provisioned credential.
        # Changing the app ID/type above must never inherit another client's secret.
        return {**private,**public}


def write(data):
    with LOCK:
        target = path()
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temp = target.with_suffix('.tmp')
        fd = os.open(temp, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
        with os.fdopen(fd,'w') as file:
            json.dump(data,file)
        temp.replace(target)
        os.chmod(target,0o600)


def public_settings():
    data = settings()
    return {'configured':ready(data),
            'client_id':data.get('client_id',''),'client_secret_set':bool(data.get('client_secret')),
            'connected':bool(ready(data) and data.get('refresh_token') and not data.get('needs_reconnect')),
            'deployment':'public' if public_mode() else 'local',
            'client_type':data.get('client_type','web'),
            'email':data.get('email',''),'error':data.get('error'), 'redirect_uri':redirect_uri(data)}


def configure(client):
    if public_mode() and client.client_type!='web':
        raise GoogleMailError('Na nuvem, configure um cliente Google do tipo Aplicativo da Web.')
    with LOCK:
        previous = settings()
        if client.client_type=='web' and not client.client_secret and (not previous.get('client_secret') or client.client_id != previous.get('client_id')):
            raise GoogleMailError('Informe o Client Secret desse projeto Google')
        secret = client.client_secret or (previous.get('client_secret','') if client.client_id==previous.get('client_id') else '')
        changed = client.client_id != previous.get('client_id') or secret != previous.get('client_secret','') or client.client_type != previous.get('client_type','web')
        data = {} if changed else previous
        write({**data,'client_id':client.client_id,'client_secret':secret,'client_type':client.client_type,'error':None})
    if changed:
        with db() as c:c.execute('DELETE FROM oauth_requests')
    return public_settings()


def remote(url, data=None, access_token=None, form=False):
    headers = {}
    if access_token:headers['Authorization']='Bearer '+access_token
    if data is not None:
        body = urlencode(data).encode() if form else json.dumps(data).encode()
        headers['Content-Type']='application/x-www-form-urlencoded' if form else 'application/json'
    else:body=None
    request = Request(url,data=body,headers=headers)
    with urlopen(request,timeout=15) as response:
        return json.loads(response.read(1000000))


def start(user, cookie, origin, login_hint=None):
    data=settings()
    if public_mode() and origin!=public_origin():
        raise GoogleMailError('O endereço público da conexão Google é inválido.')
    if not ready(data):
        raise GoogleMailError('A conexão Google ainda não está habilitada nesta distribuição do aplicativo')
    state=secrets.token_urlsafe(40);verifier=secrets.token_urlsafe(64)
    challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    with db() as c:
        c.execute('DELETE FROM oauth_requests WHERE created<? OR user_id=?',(time.time()-600,user['id']))
        c.execute('INSERT INTO oauth_requests(digest,user_id,session_digest,verifier,origin,created,language) VALUES(?,?,?,?,?,?,?)',
                  (hashlib.sha256(state.encode()).hexdigest(),user['id'],hashlib.sha256(cookie.encode()).hexdigest(),verifier,origin,time.time(),user.get("language","pt")))
    return AUTH_URL+'?'+urlencode({'client_id':data['client_id'],'redirect_uri':redirect_uri(data),'response_type':'code',
                                  'scope':SCOPES,'access_type':'offline','prompt':'consent select_account',
                                  'state':state,'code_challenge':challenge,'code_challenge_method':'S256', **({'login_hint':login_hint} if login_hint else {})})


def consume(state):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row=c.execute("SELECT o.* FROM oauth_requests o JOIN sessions s ON s.digest=o.session_digest AND s.user_id=o.user_id JOIN accounts a ON a.id=o.user_id WHERE o.digest=? AND o.created>? AND s.expires>? AND a.role='admin'",
                      (hashlib.sha256(state.encode()).hexdigest(),time.time()-600,time.time())).fetchone()
        if not row:
            raise GoogleMailError('Esta autorização expirou ou não pertence a uma sessão administrativa ativa. Abra a conexão novamente.')
        c.execute('DELETE FROM oauth_requests WHERE digest=?',(row['digest'],))
        return dict(row)


def authorization_error(exc):
    """Translate only known protocol errors; never forward provider descriptions/tokens."""
    try:
        payload=json.loads(exc.read(8192))
        error=payload.get('error')
        description=payload.get('error_description','')
        if error=='invalid_request' and 'client_secret' in description:
            return 'O Google exige uma credencial adicional do aplicativo. A integração precisa ser ajustada pelo responsável pelo radar; sua senha não é necessária.'
        return {
            'invalid_client':'O Google recusou a identificação do aplicativo. O responsável pelo radar precisa revisar a integração.',
            'invalid_grant':'A autorização Google expirou ou já foi usada. Clique em Continuar para iniciar um novo login.',
            'redirect_uri_mismatch':'O endereço de retorno do aplicativo não foi aceito pelo Google. O responsável pelo radar precisa revisar a integração.',
            'access_denied':'A conexão não foi autorizada. Confira as permissões da conta Google e tente novamente.',
        }.get(error,'O Google recusou a conclusão da conexão. Tente novamente; se persistir, o responsável pelo radar precisa revisar a integração.')
    except (ValueError,AttributeError,TypeError,OSError):
        return 'O Google não concluiu a conexão. Tente novamente ou solicite a revisão da integração do radar.'


def remember_connection_error(message):
    with LOCK:
        write({**settings(),'error':message})


def finish(pending, code, denied=False):
    if denied or not code:
        raise GoogleMailError('A conexão com Google não foi autorizada. Você pode tentar novamente.')
    with LOCK:
        data=settings()
        try:
            tokens=remote(TOKEN_URL,{**client_parameters(data),
                                  'code':code,'code_verifier':pending['verifier'],'redirect_uri':redirect_uri(data),'grant_type':'authorization_code'},form=True)
            if SEND_SCOPE not in tokens.get('scope','').split() or not tokens.get('refresh_token'):
                raise GoogleMailError('Autorize o envio de e-mails para concluir a conexão com Google')
            info=remote(USERINFO_URL,access_token=tokens['access_token'])
            from .accounts import clean_emails
            if not info.get('email_verified'):
                raise GoogleMailError('O Google não confirmou o endereço da conta selecionada')
            address=clean_emails([info['email']])[0]
        except GoogleMailError:raise
        except HTTPError as exc:
            raise GoogleMailError(authorization_error(exc)) from None
        except (URLError,TimeoutError,OSError):
            raise GoogleMailError('Não foi possível falar com o Google para concluir a conexão. Verifique a conexão de internet e tente novamente.') from None
        except (KeyError,ValueError):
            raise GoogleMailError('O Google retornou uma resposta incompleta. Inicie a conexão novamente.') from None
        write({**data,'access_token':tokens['access_token'],'refresh_token':tokens['refresh_token'],
               'expires':time.time()+int(tokens.get('expires_in',3600)), 'email':address,'needs_reconnect':False,'error':None})


def access_token(force=False):
    with LOCK:
        data=settings()
        if not ready(data) or not data.get('refresh_token') or data.get('needs_reconnect'):
            raise GoogleMailError('Reconecte a conta Google na Administração')
        if not force and data.get('expires',0)>time.time()+60:return data['access_token']
        try:
            tokens=remote(TOKEN_URL,{**client_parameters(data),
                                  'refresh_token':data['refresh_token'],'grant_type':'refresh_token'},form=True)
            token=tokens['access_token']
        except HTTPError as exc:
            if exc.code in (400,401):
                write({**data,'needs_reconnect':True,'error':'A autorização expirou ou foi revogada. Reconecte a conta Google.'})
            raise GoogleMailError('Não foi possível renovar a autorização Google. Confira a conexão na Administração.')
        except (URLError,TimeoutError,KeyError,ValueError,OSError):
            raise GoogleMailError('Não foi possível conectar ao Google para renovar a autorização')
        write({**data,'access_token':token,'expires':time.time()+int(tokens.get('expires_in',3600)), 'error':None})
        return token


def disconnect():
    with LOCK:
        data=settings()
        # Local deletion is immediate. Revocation can also be done in the Google account.
        write({k:v for k,v in data.items() if k in ('client_id','client_secret','client_type')})
    with db() as c:c.execute('DELETE FROM oauth_requests')


def transmit(config, message_id, subject, body):
    with LOCK:
        data=settings()
        token=access_token()
        message=EmailMessage()
        message['From']=data['email']
        message['To']=', '.join(config['recipient']) if isinstance(config['recipient'],list) else config['recipient']
        message['Subject']=subject;message['Message-ID']=f'<radar-{message_id}@radar.local>'
        message.set_content(body)
        if config.get("body_html"):message.add_alternative(config["body_html"],subtype="html")
        raw=base64.urlsafe_b64encode(message.as_bytes()).decode()
        try:
            try:response=remote(SEND_URL,{'raw':raw},access_token=token)
            except HTTPError as exc:
                if exc.code != 401:raise
                response=remote(SEND_URL,{'raw':raw},access_token=access_token(force=True))
            if not response.get('id'):raise GoogleMailError('O Google não confirmou o aceite da mensagem. Não haverá reenvio automático.')
        except GoogleMailError:raise
        except HTTPError:
            raise GoogleMailError('O Google recusou o envio. Confira a API Gmail e as permissões do projeto na Administração.')
        except (URLError,TimeoutError,ValueError,OSError):
            raise GoogleMailError('Envio pelo Google não confirmado. Não haverá reenvio automático para evitar duplicação.')
