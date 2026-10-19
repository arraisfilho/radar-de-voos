import { Fragment, useEffect, useId, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { clsx } from "clsx";
import { t } from "./i18n";
import { healthCodeLabel } from "./healthCodes";
import { CellLabel, EmptyRows, FilterBar, LoadError, Pager, TableSkeleton } from "./DataView";
import { dayKey, formatDateTime, formatNumber, formatTime } from "./format";
import { plural } from "./plural";
import "./audit.css";

type Details = Record<string, unknown>;
type Access = {
  id: number;
  created: number;
  /** Last occurrence of an aggregated record; null when it happened once. */
  last_seen?: number | null;
  /** Occurrences aggregated in this record (1 or more). */
  count?: number;
  event: string;
  ip: string;
  browser: string;
  system: string;
  user_agent: string;
  actor_name?: string | null;
  account_name: string | null;
  login: string | null;
  /** Context of the event, never secret values. */
  details?: Details | null;
};
type Page = {
  items: Access[];
  total: number;
  page_size: number;
  days: number;
  max_records: number;
  noisy_max_records?: number;
  admin_max_records?: number;
  /** Event codes for the filter. */
  events?: string[];
};
const empty = { q: "", event: "", start: "", end: "" };
/** Configuration events have no account (API contract, section 6): never in a personal list. */
const SETTINGS_EVENTS = [
  "admin_smtp_saved",
  "admin_smtp_removed",
  "admin_whatsapp_saved",
  "admin_whatsapp_removed",
  "admin_whatsapp_receipts_saved",
  "admin_google_client_saved",
  "admin_google_client_removed",
  "admin_google_connected",
  "admin_google_disconnected",
  "admin_retention_changed",
  "admin_logs_cleaned",
  "admin_health_incident_acknowledged",
  "admin_health_notices_changed",
];

/** Event names in plain language. */
export function auditLabels(): Record<string, string> {
  return {
    login_success: t("Login realizado"),
    login_failed: t("Login recusado"),
    login_2fa_started: t("Senha aceita, código pedido"),
    login_2fa_failed: t("Código de verificação recusado"),
    recovery_code_used: t("Código de recuperação usado"),
    login_throttled: t("Tentativas limitadas"),
    logout: t("Logout realizado"),
    register_success: t("Cadastro realizado"),
    bootstrap_success: t("Administrador criado"),
    recovery_requested: t("Recuperação solicitada"),
    password_reset: t("Senha redefinida"),
    admin_account_created: t("Cadastro criado pelo administrador"),
    admin_account_updated: t("Cadastro alterado pelo administrador"),
    admin_password_reset: t("Senha redefinida pelo administrador"),
    admin_2fa_enabled: t("Verificação em duas etapas ativada"),
    admin_2fa_disabled: t("Verificação em duas etapas desativada"),
    admin_monitoring_viewed: t("Monitoramento consultado pelo administrador"),
    admin_smtp_saved: t("SMTP salvo pelo administrador"),
    admin_smtp_removed: t("SMTP removido pelo administrador"),
    admin_whatsapp_saved: t("Integração WhatsApp salva pelo administrador"),
    admin_whatsapp_removed: t("Integração WhatsApp removida pelo administrador"),
    admin_whatsapp_receipts_saved: t("Confirmações do WhatsApp alteradas pelo administrador"),
    admin_google_client_saved: t("Cliente Google salvo pelo administrador"),
    admin_google_client_removed: t("Cliente Google removido pelo administrador"),
    admin_google_connected: t("Conta Google conectada pelo administrador"),
    admin_google_disconnected: t("Conta Google desconectada pelo administrador"),
    admin_retention_changed: t("Retenção alterada pelo administrador"),
    admin_logs_cleaned: t("Limpeza manual de logs"),
    admin_health_incident_acknowledged: t("Incidente de saúde reconhecido"),
    admin_health_notices_changed: t("Configuração de saúde alterada"),
  };
}

/** Names of the configuration fields listed in `changed` (names only, never values). */
function fieldLabels(): Record<string, string> {
  return {
    enabled: t("Ativação"),
    host: t("Servidor SMTP"),
    port: t("Porta"),
    security: t("Segurança"),
    username: t("Usuário SMTP"),
    password: t("Senha"),
    sender: t("E-mail remetente"),
    recipient: t("E-mail para testes"),
    provider: t("Tipo de integração"),
    base_url: t("URL do serviço"),
    session_id: t("ID da sessão"),
    token: t("Token da API"),
    secret: t("Segredo de assinatura"),
    identity: t("Vínculo com a integração"),
    client_id: "Client ID",
    client_secret: "Client Secret",
    client_type: t("Tipo de cliente"),
    notices: t("Avisos de saúde"),
    digest: t("Resumo diário"),
    canary_enabled: t("Rota de controle"),
    canary_origin: t("Origem da rota de controle"),
    canary_destination: t("Destino da rota de controle"),
  };
}

/** Reading order of the known detail fields (the server sends them sorted by name). */
const DETAIL_ORDER = [
  "code",
  "scope",
  "provider",
  "client_type",
  "enabled",
  "changed",
  "before",
  "after",
  "removed",
  "has_more",
  "existed",
  "was_connected",
  "connection_removed",
  "receipts_removed",
  "cancelled",
  "sessions_revoked",
  "remaining",
];
const yesNo = (value: unknown) => (value ? t("Sim") : t("Não"));
const scopeLabel = (value: unknown) =>
  value === "deliveries" ? t("Atividade de envio") : value === "access" ? t("Auditoria de acessos") : String(value);

/**
 * The context of an event as label and value pairs, from the known fields
 * only. `changed` lists field names; values are never shown or sent.
 */
export function auditDetails(event: string, details: Details | null | undefined): [string, string][] {
  if (!details || typeof details !== "object") return [];
  const rows: [string, string][] = [];
  const fields = fieldLabels();
  const days = (value: unknown) =>
    typeof value === "number" ? plural(value, "{0} dia", "{0} dias") : String(value);
  for (const key of DETAIL_ORDER) {
    const value = details[key];
    if (value === null || value === undefined) continue;
    switch (key) {
      case "changed":
        if (Array.isArray(value))
          rows.push([
            t("Campos alterados"),
            value.length ? value.map((name) => fields[String(name)] || String(name)).join(", ") : t("Nenhum"),
          ]);
        break;
      case "enabled":
        rows.push([t("Ativação"), value ? t("Habilitado") : t("Desabilitado")]);
        break;
      case "provider":
        rows.push([t("Integrador"), value === "openwa" ? "OpenWA" : value === "google" ? "Google" : String(value)]);
        break;
      case "client_type":
        rows.push([t("Tipo de cliente"), value === "web" ? t("Aplicativo da Web") : value === "desktop" ? t("Aplicativo para computador") : String(value)]);
        break;
      case "scope":
        rows.push([t("Registros"), scopeLabel(value)]);
        break;
      case "code":
        rows.push([t("Incidente"), healthCodeLabel(String(value))]);
        break;
      case "before":
        rows.push(
          event === "admin_logs_cleaned"
            ? [t("Data de corte"), typeof value === "number" ? formatDateTime(value) : String(value)]
            : [t("Antes"), days(value)],
        );
        break;
      case "after":
        rows.push([t("Depois"), days(value)]);
        break;
      case "removed":
        rows.push([t("Registros removidos"), typeof value === "number" ? formatNumber(value) : String(value)]);
        break;
      case "has_more":
        rows.push([t("Restam registros para limpar"), yesNo(value)]);
        break;
      case "existed":
        rows.push([t("Havia configuração salva"), yesNo(value)]);
        break;
      case "receipts_removed":
        rows.push([t("Confirmações removidas"), yesNo(value)]);
        break;
      case "cancelled":
        rows.push([t("Mensagens pendentes canceladas"), typeof value === "number" ? formatNumber(value) : String(value)]);
        break;
      case "was_connected":
        rows.push([t("Havia conta conectada"), yesNo(value)]);
        break;
      case "connection_removed":
        rows.push([t("Conexão removida"), yesNo(value)]);
        break;
      case "sessions_revoked":
        rows.push([t("Outras sessões encerradas"), typeof value === "number" ? formatNumber(value) : String(value)]);
        break;
      case "remaining":
        rows.push([t("Códigos de recuperação restantes"), typeof value === "number" ? formatNumber(value) : String(value)]);
        break;
    }
  }
  return rows;
}

/**
 * End of an aggregated record's period ("até 08:25"): nothing when both ends
 * print the same (same minute), the time alone within one day, otherwise the
 * date and time.
 */
export function auditUntil(created: number, lastSeen: number | null | undefined): string {
  if (!lastSeen) return "";
  const end = formatDateTime(lastSeen);
  if (end === formatDateTime(created)) return "";
  return t("até {0}", [dayKey(created) === dayKey(lastSeen) ? formatTime(lastSeen) : end]);
}

/**
 * Access audit: the personal list in the profile (a disclosure) and the
 * administration tab (`admin`, open, with every account). Aggregated records
 * show how many times they happened and the period.
 */
export function AuditPanel({
  admin = false,
  expanded = false,
  actions,
}: {
  admin?: boolean;
  expanded?: boolean;
  /** Extra controls in the heading (administration). */
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(expanded),
    [draft, setDraft] = useState(empty),
    [filters, setFilters] = useState(empty),
    [page, setPage] = useState(0),
    [events, setEvents] = useState<string[]>([]),
    [shown, setShown] = useState<number[]>([]);
  const id = useId();
  const labels = auditLabels();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const query = useQuery<Page>({
    queryKey: ["audit", admin, filters, page],
    enabled: open,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ page: String(page), q: filters.q, event: filters.event });
      if (filters.start) params.set("start", String(new Date(filters.start).getTime() / 1000));
      if (filters.end) params.set("end", String(new Date(filters.end).getTime() / 1000));
      const result = await fetch((admin ? "/api/admin/audit" : "/api/audit") + "?" + params, { cache: "no-store", signal });
      if (!result.ok) throw Error(t("Não foi possível carregar os acessos"));
      return result.json();
    },
    refetchInterval: open ? 30000 : false,
    // The rows of the last page stay while the next one loads: the pager keeps the focus.
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  // The event filter follows the codes the server lists; older servers fall back to the known names.
  useEffect(() => {
    if (data?.events?.length) setEvents(data.events);
  }, [data?.events?.join()]);
  const codes = (events.length ? events : Object.keys(labels)).filter(
    (code) => admin || !SETTINGS_EVENTS.includes(code),
  );
  const active = [filters.q, filters.event, filters.start, filters.end].filter(Boolean).length;
  const body = (
    <>
      <FilterBar
        title={admin ? t("Filtrar registros de acesso") : t("Filtrar seus acessos")}
        active={active}
        onApply={() => {
          setPage(0);
          setFilters({ ...draft });
        }}
        onReset={() => {
          setDraft(empty);
          setFilters(empty);
          setPage(0);
        }}
      >
        {admin && (
          <label className="field">
            <span className="field-label">{t("Usuário")}</span>
            <input
              type="search"
              maxLength={120}
              placeholder={t("Nome, telefone ou autor")}
              value={draft.q}
              onChange={(e) => setDraft({ ...draft, q: e.target.value })}
            />
          </label>
        )}
        <label className="field">
          <span className="field-label">{t("Evento")}</span>
          <select value={draft.event} onChange={(e) => setDraft({ ...draft, event: e.target.value })}>
            <option value="">{t("Todos os eventos")}</option>
            {codes.map((code) => (
              <option key={code} value={code}>
                {labels[code] || code}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t("De")}</span>
          <input
            type="datetime-local"
            value={draft.start}
            max={draft.end || undefined}
            onChange={(e) => setDraft({ ...draft, start: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="field-label">{t("Até")}</span>
          <input
            type="datetime-local"
            value={draft.end}
            min={draft.start || undefined}
            onChange={(e) => setDraft({ ...draft, end: e.target.value })}
          />
        </label>
      </FilterBar>
      {query.isError ? (
        <LoadError message={t("Não foi possível carregar os acessos")} onRetry={() => void query.refetch()} />
      ) : query.isPending || !data ? (
        <TableSkeleton rows={admin ? 6 : 3} />
      ) : !data.items.length ? (
        <EmptyRows icon={ShieldCheck} title={t("Nenhum acesso encontrado")}>
          {t("Nenhum acesso encontrado para os filtros selecionados.")}
        </EmptyRows>
      ) : (
        <div className="table-frame">
          <table
            role="table"
            className={clsx("data-table audit-table", admin && "is-admin", query.isPlaceholderData && "is-stale")}
            aria-busy={query.isFetching || undefined}
          >
            <caption className="sr-only">
              {admin
                ? t("Registros de acesso: evento, conta, data, origem e detalhes")
                : t("Seus acessos: evento, data, origem e detalhes")}
            </caption>
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader" className="col-event">{t("Evento")}</th>
                {admin && <th scope="col" role="columnheader" className="col-account">{t("Conta")}</th>}
                <th scope="col" role="columnheader" className="col-when">{t("Data e hora")}</th>
                <th scope="col" role="columnheader" className="col-origin">{t("Origem")}</th>
                <th scope="col" role="columnheader" className="col-details">
                  <span className="sr-only">{t("Detalhes")}</span>
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {data.items.map((entry) => {
                const count = entry.count || 1;
                // The period of an aggregated record: first and last occurrence.
                const until = count > 1 ? auditUntil(entry.created, entry.last_seen) : "";
                const rows = auditDetails(entry.event, entry.details);
                const label = labels[entry.event] || entry.event;
                const unfolded = shown.includes(entry.id);
                const detailsId = `${id}-details-${entry.id}`;
                return (
                  <Fragment key={entry.id}>
                    <tr role="row" className={unfolded ? "is-expanded" : undefined}>
                      <td role="cell" className="cell-event">
                        <span className="cell-title">
                          {label}
                          {count > 1 && (
                            <span className="audit-count" title={plural(count, "{0} ocorrência", "{0} ocorrências")}>
                              {"× " + formatNumber(count)}
                            </span>
                          )}
                        </span>
                        {admin && entry.actor_name && (
                          <span className="cell-secondary">{t("Por: {0}", [entry.actor_name])}</span>
                        )}
                      </td>
                      {admin && (
                        <td role="cell" className="cell-account">
                          <CellLabel>{t("Conta")}</CellLabel>
                          {/* Configuration events belong to no account; the author is named in the event. */}
                          <span className="cell-title cell-truncate">
                            {entry.account_name || (entry.actor_name ? "—" : t("Não identificado"))}
                          </span>
                          {entry.login && <span className="cell-secondary">{entry.login}</span>}
                        </td>
                      )}
                      <td role="cell" className="cell-when">
                        <time dateTime={new Date(entry.created * 1000).toISOString()}>{formatDateTime(entry.created)}</time>
                        {until && <span className="cell-secondary">{until}</span>}
                      </td>
                      <td role="cell" className="cell-origin">
                        <span className="audit-ip">{entry.ip}</span>
                        <span className="cell-secondary">
                          {entry.browser} · {entry.system}
                        </span>
                      </td>
                      <td role="cell" className="cell-details">
                        {/* Disclosure: the context of the event opens in a row of its own. */}
                        <button
                          type="button"
                          className="audit-toggle"
                          aria-expanded={unfolded}
                          aria-controls={unfolded ? detailsId : undefined}
                          onClick={() =>
                            setShown(unfolded ? shown.filter((item) => item !== entry.id) : [...shown, entry.id])
                          }
                        >
                          {t("Detalhes")}
                          <span className="sr-only">
                            {": "}
                            {label} · {formatDateTime(entry.created)}
                          </span>
                          <ChevronDown size={16} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                    {unfolded && (
                      <tr role="row" className="audit-details-row" id={detailsId}>
                        <td role="cell" colSpan={admin ? 5 : 4}>
                          <dl className="audit-details">
                            {rows.map(([name, value]) => (
                              <div key={name}>
                                <dt>{name}</dt>
                                <dd>{value}</dd>
                              </div>
                            ))}
                            <div className="audit-agent">
                              <dt>{t("Navegador informado")}</dt>
                              <dd>{entry.user_agent || "—"}</dd>
                            </div>
                          </dl>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <Pager
          page={page}
          pageSize={data.page_size}
          total={data.total}
          onPage={setPage}
          label={t("Páginas de acessos")}
          summary={plural(data.total, "{0} registro", "{0} registros", formatNumber(data.total))}
        />
      )}
      <p className="audit-note">
        {t("IP e dispositivo são informações declaradas pela conexão. Horários no fuso {0}.", [zone])}{" "}
        {data &&
          (admin && data.noisy_max_records && data.admin_max_records
            ? t("Retenção de {0}, com limites separados: {1}, {2} e {3}.", [
                plural(data.days, "{0} dia", "{0} dias"),
                plural(data.max_records, "{0} registro de conta", "{0} registros de conta", formatNumber(data.max_records)),
                plural(data.noisy_max_records, "{0} tentativa recusada", "{0} tentativas recusadas", formatNumber(data.noisy_max_records)),
                plural(data.admin_max_records, "{0} registro de administração", "{0} registros de administração", formatNumber(data.admin_max_records)),
              ])
            : t("Retenção: {0}, até {1}.", [
                plural(data.days, "{0} dia", "{0} dias"),
                plural(data.max_records, "{0} registro", "{0} registros", formatNumber(data.max_records)),
              ]))}
      </p>
    </>
  );
  if (admin && expanded)
    return (
      <section className="card admin-card audit-panel is-admin" aria-labelledby={id + "-title"}>
        <header className="admin-card-heading">
          <div>
            <h2 id={id + "-title"}>{t("Auditoria de acessos")}</h2>
            <p>{t("Acessos, tentativas recusadas e alterações feitas pela administração.")}</p>
          </div>
          {actions && <div className="admin-card-actions">{actions}</div>}
        </header>
        {body}
      </section>
    );
  return (
    <div className="list-group audit-panel is-personal">
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="list-row audit-summary">
          <ShieldCheck size={18} aria-hidden="true" />
          <span className="list-row-label">{admin ? t("Auditoria de acessos") : t("Seus acessos recentes")}</span>
        </summary>
        <div className="audit-body">{body}</div>
      </details>
    </div>
  );
}
