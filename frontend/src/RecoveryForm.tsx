import {useEffect,useState} from 'react';
import {CheckCircle2} from 'lucide-react';
import {t,getLanguage,useLanguage} from './i18n';
import {PasswordField} from './PasswordField';
import {PhoneField} from './PhoneField';
import {QuickPreferences} from './QuickPreferences';
import {SystemVersion} from './SystemVersion';
import {AppIcon} from './AppIcon';
import {usePageTitle} from './pageTitle';
import {Button,Card} from './ui';
export function RecoveryForm({token,onBack}:{token:string;onBack:()=>void}) {
  useLanguage();
  usePageTitle(t('Recuperar acesso'));
  const [country,setCountry]=useState('BR'),[phone,setPhone]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(token)history.replaceState(null,'',location.pathname+location.search)},[token]);
  return <main className="auth-page">
    <div className="auth-toolbar"><QuickPreferences/></div>
    <Card className="auth-card">
      <div className="auth-intro">
        <AppIcon size="lg"/>
        <h1>{t('Radar de Voos')}</h1>
        <h2 className="auth-heading">{t('Recuperar acesso')}</h2>
        {!done && !token && <p>{t('Enviaremos o link ao primeiro e-mail do seu perfil. Sem e-mail, peça ao administrador para redefinir a senha.')}</p>}
      </div>
      {done ? <div className="auth-status" role="status">
        <p><CheckCircle2 className="auth-done-icon" size={28} aria-hidden="true"/>{token?t('Senha atualizada. Entre novamente em seus dispositivos.'):t('Se a conta tiver e-mail e o envio estiver ativo, você receberá um link válido por 20 minutos.')}</p>
      </div> : <form onSubmit={async e=>{
        e.preventDefault();setError('');if(token&&password!==confirm){setError(t('As senhas não coincidem'));return}setBusy(true);
        try{const session=await fetch('/api/auth/session',{cache:'no-store'}).then(r=>r.json());const r=await fetch('/api/auth/recovery'+(token?'/confirm':''),{method:'POST',headers:{'content-type':'application/json','x-radar-token':session.token,'x-radar-language':getLanguage()},body:JSON.stringify(token?{token,password}:{country,phone})});const data=await r.json();if(!r.ok)throw Error(typeof data.detail==='string'?data.detail:t('Não foi possível concluir a ação'));setPassword('');setConfirm('');setDone(true)}catch(e){setError(t((e as Error).message))}finally{setBusy(false)}
      }}>
        {token ? <><PasswordField label={t('Nova senha')} required minLength={10} maxLength={200} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/><PasswordField label={t('Confirmar senha')} required minLength={10} maxLength={200} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/></> : <PhoneField label={t('Celular de acesso')} country={country} value={phone} onChange={(c,p)=>{setCountry(c);setPhone(p)}}/>}
        {error&&<p role="alert" className="form-error">{error}</p>}
        <Button className="full" type="submit" size="large" disabled={busy}>{busy?t('Aguarde…'):token?t('Salvar nova senha'):t('Enviar link de recuperação')}</Button>
      </form>}
      <div className="auth-links"><Button type="button" variant="ghost" onClick={onBack}>{t('Voltar ao login')}</Button></div>
    </Card>
    <footer className="auth-footer"><SystemVersion/></footer>
  </main>
}
