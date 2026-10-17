import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { t } from "./i18n";
import { Button } from "./ui";

type Settings = {enabled:boolean;secret_set:boolean;active:boolean;identity_matches:boolean;callback_url:string|null;callback_path:string};
type RequestFn = (path:string,body:unknown,method?:string)=>Promise<unknown>;
export function WhatsAppReceipts({request}:{request:RequestFn}) {
  const cache=useQueryClient();
  const [enabled,setEnabled]=useState<boolean|null>(null),[secret,setSecret]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[saved,setSaved]=useState(false);
  const query=useQuery<Settings>({queryKey:["whatsapp-receipts"],queryFn:async({signal})=>{
    const response=await fetch('/api/admin/whatsapp/receipts',{cache:'no-store',signal});
    if(!response.ok)throw Error(t("Não foi possível carregar as confirmações."));
    return response.json();
  }});
  const data=query.data;
  return <details className="whatsapp-receipts">
    <summary>{t("Confirmações de entrega e leitura")}</summary>
    {query.isError?<p role="alert">{t("Não foi possível carregar as confirmações.")}</p>:!data?<p role="status">{t("Carregando…")}</p>:<>
      <p className="help">{data.active?t("Receptor habilitado. Cadastre o webhook no OpenWA."):t("Configure o receptor e o webhook para acompanhar as confirmações.")}</p>
      <form onSubmit={async e=>{e.preventDefault();setBusy(true);setError("");setSaved(false);try{
        await request('/admin/whatsapp/receipts',{enabled:enabled??data.enabled,secret},'PUT');
        setSecret("");setEnabled(null);setSaved(true);await cache.invalidateQueries({queryKey:['whatsapp-receipts']});
      }catch(err){setError((err as Error).message);}finally{setBusy(false);}}}>
        <fieldset disabled={busy}>
          <label className="check-row"><input type="checkbox" checked={enabled??data.enabled} onChange={e=>{setEnabled(e.target.checked);setSaved(false);}}/>{t("Receber confirmações do WhatsApp")}</label>
          <label>{t("Segredo de assinatura")}<input type="password" autoComplete="new-password" minLength={32} maxLength={255} value={secret} required={(enabled??data.enabled)&&(!data.secret_set||!data.identity_matches)} placeholder={data.secret_set&&data.identity_matches?t("Segredo salvo · deixe vazio para manter"):t("Use o mesmo segredo no webhook OpenWA")} onChange={e=>{setSecret(e.target.value);setSaved(false);}}/></label>
          <Button type="submit">{busy?t("Salvando…"):t("Salvar confirmações")}</Button>
        </fieldset>
      </form>
      <label>{t(data.callback_url ? "URL do webhook" : "Caminho do webhook")}<input readOnly value={data.callback_url??data.callback_path} onFocus={e=>e.currentTarget.select()}/></label>
      {!data.callback_url&&<p className="help">{t("O teste local usa eventos simulados. Em produção, cadastre a URL HTTPS do Radar no OpenWA.")}</p>}
      <p className="help">{t("No OpenWA, selecione message.ack e message.failed e use o mesmo segredo.")}</p>
      {saved&&<p role="status">{t("Configuração de confirmações salva.")}</p>}
    </>}
    {error&&<p className="form-error" role="alert">{error}</p>}
  </details>;
}
