import {useEffect,useState} from 'react';
import {ChevronRight} from 'lucide-react';
import {t,useLanguage,getLocale} from './i18n';
import type {SearchRecord} from './types';
// Only this small component renders each second; flight results do not tick.
export function LiveStatus({search,serverTime,updatedAt,error}:{search:SearchRecord;serverTime:number;updatedAt:number;error:boolean}) {
  useLanguage();
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer)},[]);
  const remaining=Math.max(0,Math.ceil((search.next_due||0)-(serverTime+Math.max(0,now-updatedAt)/1000)));
  const countdown=`${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`;
  const collecting=search.state==='collecting';
  const label=error?t('Sem conexão com o servidor'):!search.active?t('Pausado'):collecting?t('Atualizando preços…'):remaining?t('Próxima atualização em {0}',[countdown]):t('Na fila de atualização');
  return <span className="live-status"><i className={`live-dot ${search.active&&!error?'':'off'}`}/><strong>{error?t('Desconectado'):search.active?t('Ao vivo'):t('Pausado')}</strong><span className="live-status-counter">{label}</span><small>{t('Última atualização:')} {search.last_success?new Date(search.last_success*1000).toLocaleTimeString(getLocale(),{hour:'2-digit',minute:'2-digit'}):t('Ainda não realizada')}</small><ChevronRight size={14}/></span>;
}
