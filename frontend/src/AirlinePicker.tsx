import {useEffect,useId,useRef,useState} from 'react';
import {Search,X,LoaderCircle} from 'lucide-react';
import {t,useLanguage} from './i18n';
type Airline={code:string;name:string;custom:boolean};
const cache=new Map<string,Airline>();
export function AirlinePicker({values,onChange}:{values:string[];onChange:(codes:string[])=>void}) {
  const language=useLanguage(),id=useId(),input=useRef<HTMLInputElement>(null),list=useRef<HTMLDivElement>(null);
  const [query,setQuery]=useState(''),[results,setResults]=useState<Airline[]>([]),[open,setOpen]=useState(false),[index,setIndex]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[,refresh]=useState(0);
  useEffect(()=>{
    const missing=values.filter(code=>!cache.has(code));if(!missing.length)return;
    const controller=new AbortController();
    fetch('/api/airlines?codes='+encodeURIComponent(missing.join(',')),{signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();const items:Airline[]=await r.json();if(controller.signal.aborted)return;items.forEach(item=>cache.set(item.code,item));refresh(n=>n+1)}).catch(()=>{});
    return ()=>controller.abort();
  },[values.join(',')]);
  useEffect(()=>{
    input.current?.setCustomValidity(query.trim()?t('Selecione uma companhia da lista ou limpe o campo.'):'');
  },[query,language]);
  useEffect(()=>{
    setResults([]);setIndex(0);setError('');
    if(query.trim().length<2||values.length>=20){setBusy(false);return}
    const controller=new AbortController();setBusy(true);
    const timer=setTimeout(async()=>{
      try{const r=await fetch('/api/airlines?q='+encodeURIComponent(query.trim()),{signal:controller.signal});if(!r.ok)throw Error(t('Não foi possível buscar as companhias.'));const items:Airline[]=await r.json();if(controller.signal.aborted)return;items.forEach(item=>cache.set(item.code,item));setResults(items.filter(item=>!values.includes(item.code)))}catch(e){if(!controller.signal.aborted)setError((e as Error).message)}finally{if(!controller.signal.aborted)setBusy(false)}
    },180);
    return ()=>{clearTimeout(timer);controller.abort()};
  },[query,values.join(',')]);
  function choose(item:Airline){if(values.includes(item.code)||values.length>=20)return;cache.set(item.code,item);onChange([...values,item.code]);setQuery('');input.current?.setCustomValidity('');setOpen(false);setIndex(0);input.current?.focus()}
  const active=open&&query.trim().length>=2&&values.length<20;
  return <div className="airline-picker" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false)}}>
    <label htmlFor={id}>{t('Companhia aérea')} <span>{t('Opcional')}</span></label>
    {!!values.length&&<div className="airline-tokens">{values.map(code=><span key={code} className="airline-token"><span title={cache.get(code)?.name||code}>{cache.get(code)?.name||code}</span><b>{code}</b><button type="button" aria-label={t('Remover companhia {0}',[cache.get(code)?.name||code])} onClick={()=>onChange(values.filter(v=>v!==code))}><X size={13}/></button></span>)}<button type="button" className="airline-clear" onClick={()=>{onChange([]);setQuery('');setOpen(false)}}>{t('Limpar')}</button></div>}
    {values.length<20?<div className="airline-combobox"><Search size={16} aria-hidden="true"/><input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={active} aria-controls={id+'-list'} aria-activedescendant={active&&results[index]?id+'-'+results[index].code:undefined} aria-describedby={id+'-help'} autoComplete="off" placeholder={t('Nome ou sigla: LATAM, LA…')} value={query} onFocus={()=>setOpen(true)} onClick={()=>setOpen(true)} onChange={e=>{setQuery(e.target.value);setOpen(true)}} onKeyDown={e=>{
      if(e.key==='Escape'&&active){e.preventDefault();e.stopPropagation();setOpen(false)}
      else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setOpen(true);setIndex(n=>Math.max(0,Math.min(results.length-1,n+(e.key==='ArrowDown'?1:-1))));requestAnimationFrame(()=>list.current?.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'}))}
      else if(e.key==='Enter'&&query.trim()){e.preventDefault();if(active&&results[index])choose(results[index]);else input.current?.reportValidity()}
    }}/>{busy&&<LoaderCircle className="spin" size={15}/>}</div>:null}
    {active&&<div ref={list} className="airline-results" id={id+'-list'} role="listbox" aria-label={t('Companhias encontradas')}>
      {busy?<p role="status">{t('Buscando…')}</p>:error?<p role="alert">{t(error)}</p>:!results.length?<p role="status">{t('Nenhuma companhia encontrada. Tente o nome ou a sigla.')}</p>:results.map((item,n)=><button type="button" role="option" aria-selected={index===n} tabIndex={-1} id={id+'-'+item.code} key={item.code} className={index===n?'highlighted':''} onMouseEnter={()=>setIndex(n)} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(item)}><span>{item.custom?t('Usar sigla informada'):item.name}</span><b>{item.code}</b></button>)}
    </div>}
    <p id={id+'-help'} className="airline-hint">{values.length>=20?t('Até 20 companhias por trecho.'):values.length?t('A busca usará somente as companhias selecionadas.'):t('Sem seleção, todas as companhias.')}</p>
  </div>;
}
