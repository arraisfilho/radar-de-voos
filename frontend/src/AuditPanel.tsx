import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { t, getLocale } from "./i18n";
import { Button, Card } from "./ui";

type Access = { id: number; created: number; event: string; ip: string; browser: string; system: string; user_agent: string; actor_name?: string | null; account_name: string | null; login: string | null };
type Page = { items: Access[]; total: number; page_size: number; days: number; max_records: number };
const empty = { q: "", event: "", start: "", end: "" };

export function AuditPanel({ admin = false, expanded = false }: { admin?: boolean; expanded?: boolean }) {
  const [open, setOpen] = useState(expanded), [draft, setDraft] = useState(empty), [filters, setFilters] = useState(empty), [page, setPage] = useState(0);
  const labels: Record<string, string> = {
    admin_monitoring_viewed: t("Monitoramento consultado pelo administrador"),
    admin_account_created: t("Cadastro criado pelo administrador"),
    admin_account_updated: t("Cadastro alterado pelo administrador"),
    admin_password_reset: t("Senha redefinida pelo administrador"),
    login_success: t("Login realizado"), login_failed: t("Login recusado"), login_throttled: t("Tentativas limitadas"),
    register_success: t("Cadastro realizado"), bootstrap_success: t("Administrador criado"), recovery_requested: t("Recuperação solicitada"), password_reset: t("Senha redefinida"), logout: t("Logout realizado"),
  };
  const query = useQuery<Page>({
    queryKey: ["audit", admin, filters, page], enabled: open,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ page: String(page), q: filters.q, event: filters.event });
      if (filters.start) params.set("start", String(new Date(filters.start).getTime() / 1000));
      if (filters.end) params.set("end", String(new Date(filters.end).getTime() / 1000));
      const result = await fetch((admin ? "/api/admin/audit" : "/api/audit") + "?" + params, { cache: "no-store", signal });
      if (!result.ok) throw Error(t("Não foi possível carregar os acessos"));
      return result.json();
    }, refetchInterval: open ? 30000 : false,
  });
  return <Card className="audit-panel">
    <details open={open} onToggle={e => setOpen(e.currentTarget.open)}>
      <summary>{admin ? t("Auditoria de acessos") : t("Seus acessos recentes")}</summary>
      <p className="help">{t("IP e dispositivo são informações declaradas pela conexão. Horários no fuso {0}.", [Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"])}</p>
      {query.data && <p className="help">{t("Retenção: {0} dias, até {1} registros.", [query.data.days, query.data.max_records])}</p>}
      <form className="audit-filters" onSubmit={e => { e.preventDefault(); setPage(0); setFilters({ ...draft }); }}>
        {admin && <label>{t("Usuário")}<input type="search" maxLength={120} value={draft.q} onChange={e => setDraft({ ...draft, q: e.target.value })} /></label>}
        <label>{t("Evento")}<select value={draft.event} onChange={e => setDraft({ ...draft, event: e.target.value })}><option value="">{t("Todos os eventos")}</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>{t("De")}<input type="datetime-local" value={draft.start} max={draft.end || undefined} onChange={e => setDraft({ ...draft, start: e.target.value })} /></label>
        <label>{t("Até")}<input type="datetime-local" value={draft.end} min={draft.start || undefined} onChange={e => setDraft({ ...draft, end: e.target.value })} /></label>
        <div className="audit-filter-actions"><Button type="button" variant="ghost" onClick={() => { setDraft(empty); setFilters(empty); setPage(0); }}>{t("Limpar filtros")}</Button><Button type="submit">{t("Consultar")}</Button></div>
      </form>
      {query.isError ? <div role="alert"><p>{t("Não foi possível carregar os acessos")}</p><Button variant="outline" onClick={() => void query.refetch()}>{t("Tentar novamente")}</Button></div>
        : query.isPending || !query.data ? <p role="status">{t("Carregando…")}</p>
        : !query.data.items.length ? <p className="activity-empty" role="status">{t("Nenhum acesso encontrado para os filtros selecionados.")}</p>
        : <>
          <div className="table-scroll"><table className="audit-table"><thead><tr>{admin && <th>{t("Conta")}</th>}<th>{t("Data e hora")}</th><th>{t("Evento")}</th><th>IP</th><th>{t("Dispositivo")}</th></tr></thead>
            <tbody>{query.data.items.map(entry => <tr key={entry.id}>
              {admin && <td data-label={t("Conta")}>{entry.account_name || t("Não identificado")}<small>{entry.login}</small></td>}
              <td data-label={t("Data e hora")}>{new Date(entry.created * 1000).toLocaleString(getLocale())}</td>
              <td data-label={t("Evento")}>{labels[entry.event] || entry.event}{admin && entry.actor_name && <small>{t("Por: {0}", [entry.actor_name])}</small>}</td>
              <td data-label="IP">{entry.ip}</td>
              <td data-label={t("Dispositivo")}><details><summary>{entry.browser} · {entry.system}</summary><small>{entry.user_agent}</small></details></td>
            </tr>)}</tbody></table></div>
          <div className="admin-pagination"><span>{t("{0} registros · página {1}", [query.data.total, page + 1])}</span><div>
            <Button size="icon" variant="outline" aria-label={t("Página anterior")} disabled={page === 0 || query.isFetching} onClick={() => setPage(page - 1)}><ChevronLeft size={18} /></Button>
            <Button size="icon" variant="outline" aria-label={t("Próxima página")} disabled={(page + 1) * query.data.page_size >= query.data.total || query.isFetching} onClick={() => setPage(page + 1)}><ChevronRight size={18} /></Button>
          </div></div>
        </>}
    </details>
  </Card>;
}
