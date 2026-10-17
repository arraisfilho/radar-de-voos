import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { t } from "./i18n";
import { CheckCheck, X } from "lucide-react";
import { Button } from "./ui";

type Settings = {enabled:boolean;secret_set:boolean;active:boolean;identity_matches:boolean;callback_url:string|null;callback_path:string};
type RequestFn = (path:string,body:unknown,method?:string)=>Promise<unknown>;
/** Delivery and read receipts from the WhatsApp integrator: receiver switch, signing secret and webhook address. */
export function WhatsAppReceipts({request}:{request:RequestFn}) {
  // Hook order matters to the tests: the switch, then the secret.
  const cache=useQueryClient();
  const [enabled,setEnabled]=useState<boolean|null>(null),[secret,setSecret]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[saved,setSaved]=useState(false);
  const query=useQuery<Settings>({queryKey:["whatsapp-receipts"],queryFn:async({signal})=>{
    const response=await fetch('/api/admin/whatsapp/receipts',{cache:'no-store',signal});
    if(!response.ok)throw Error(t("Não foi possível carregar as confirmações."));
    return response.json();
  }});
  const data=query.data;
  return <details className="whatsapp-receipts">
    <summary><span className="channel-card-icon" aria-hidden="true"><CheckCheck size={20}/></span><span className="disclosure-summary"><strong>{t("Confirmações de entrega e leitura")}</strong>{data&&<small>{data.active?t("Habilitado"):t("Não configurado")}</small>}</span></summary>
    <div className="admin-disclosure-body">
      {query.isError?<p className="notice is-error" role="alert">{t("Não foi possível carregar as confirmações.")}</p>:!data?<p role="status" className="field-help">{t("Carregando…")}</p>:<>
        <p className="field-help">{data.active?t("Receptor habilitado. Cadastre o webhook no OpenWA."):t("Configure o receptor e o webhook para acompanhar as confirmações.")}</p>
        <form className="channel-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError("");setSaved(false);try{
          await request('/admin/whatsapp/receipts',{enabled:enabled??data.enabled,secret},'PUT');
          setSecret("");setEnabled(null);setSaved(true);await cache.invalidateQueries({queryKey:['whatsapp-receipts']});
        }catch(err){setError((err as Error).message);}finally{setBusy(false);}}}>
          <fieldset disabled={busy} className="channel-fields">
            <label className="switch-row"><span>{t("Receber confirmações do WhatsApp")}</span><input type="checkbox" role="switch" className="switch" checked={enabled??data.enabled} onChange={e=>{setEnabled(e.target.checked);setSaved(false);}}/></label>
            <label className="field"><span className="field-label">{t("Segredo de assinatura")}</span><input type="password" autoComplete="new-password" minLength={32} maxLength={255} value={secret} required={(enabled??data.enabled)&&(!data.secret_set||!data.identity_matches)} placeholder={data.secret_set&&data.identity_matches?t("Segredo salvo · deixe vazio para manter"):t("Use o mesmo segredo no webhook OpenWA")} onChange={e=>{setSecret(e.target.value);setSaved(false);}}/></label>
            <div className="channel-actions"><Button type="submit" variant="outline">{busy?t("Salvando…"):t("Salvar confirmações")}</Button></div>
          </fieldset>
        </form>
        <label className="field"><span className="field-label">{t(data.callback_url ? "URL do webhook" : "Caminho do webhook")}</span><input readOnly value={data.callback_url??data.callback_path} onFocus={e=>e.currentTarget.select()}/></label>
        {!data.callback_url&&<p className="field-help">{t("O teste local usa eventos simulados. Em produção, cadastre a URL HTTPS do Radar no OpenWA.")}</p>}
        <p className="field-help">{t("No OpenWA, selecione message.ack e message.failed e use o mesmo segredo.")}</p>
        {saved&&<p className="notice is-success" role="status">{t("Configuração de confirmações salva.")}</p>}
      </>}
      {error&&<div className="notice is-error" role="alert"><p>{t(error)}</p><button type="button" className="notice-dismiss" aria-label={t("Dispensar mensagem")} onClick={()=>setError("")}><X size={16} aria-hidden="true"/></button></div>}
    </div>
  </details>;
}
