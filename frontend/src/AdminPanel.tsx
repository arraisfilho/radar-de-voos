import { TaskPage } from "./TaskPage";
import { plainClick, routePath, type AppRoute, type Navigate } from "./navigation";
import { WhatsAppPanel } from "./WhatsAppPanel";
import { AdminUsers } from "./AdminUsers";
import { SmtpSettings } from "./SmtpSettings";
import { CellLabel, EmptyRows, FilterBar, LoadError, Pager, TableSkeleton, selectingText } from "./DataView";
import "./admin.css";
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import {
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  CirclePause,
  Inbox,
  Mail,
  MessageCircle,
  RefreshCw,
  Send,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { t } from "./i18n";
import { Button, ConfirmDialog, Notice } from "./ui";
import { AuditPanel } from "./AuditPanel";
import { formatDateTime, formatDateTimeCompact, formatNumber, formatRelative, formatTime } from "./format";
import { plural } from "./plural";
import { sourceKindLabel, sourceMessage } from "./LiveStatus";
import type { GoogleMail, SMTP, SourceStatus } from "./types";

// The Google account panel loads only when the e-mail channel opens.
const GoogleMailPanel = lazy(() => import("./GoogleMailPanel").then((module) => ({ default: module.GoogleMailPanel })));

type RequestFn = (
  path: string,
  body: unknown,
  method?: string,
) => Promise<unknown>;
type Entry = {
  id: string;
  created: number;
  completed: number | null;
  sent: number | null;
  status: string;
  channel: string;
  kind: string;
  provider: string | null;
  subject: string;
  recipients: string[];
  attempts: number;
  account_name: string | null;
  login: string | null;
  body?: string | null;
  error?: string | null;
  content_protected?: boolean;
  provider_message_id?: string | null;
  receipt_status?: string | null;
  receipt_sent_at?: number | null;
  delivered_at?: number | null;
  read_at?: number | null;
  receipt_failed_at?: number | null;
  owner_id?: string | null;
};
type LogPage = {
  items: Entry[];
  total: number;
  page_size: number;
  totals: Record<string, number>;
  receipt_totals?: Record<string, number>;
};
type Policy = {
  days: number;
  cutoff: number;
  total: number;
  protected: number;
  last_cleanup: number | null;
  batch_size: number;
};
type Plan = {
  count: number;
  total: number;
  before: number;
  expires: number;
  proof: string;
  has_more: boolean;
  totals: Record<string, number>;
  receipt_totals?: Record<string, number>;
};
/** E-mail delivery as the state reports it to administrators. */
export type MailState = {
  google: GoogleMail | null;
  smtp: SMTP | null;
  /** Service the server would use; "smtp" even when nothing is configured. */
  provider?: "google" | "smtp" | null;
  /** `email_available`: a message can be sent now. */
  available?: boolean;
  testRecipient: string;
  /** Suggested address for connecting an account. */
  defaultEmail: string;
};

/**
 * The e-mail channel as it really is: active only when a message can be sent
 * now (`email_available`), naming the service in use. The server prefers a
 * Google account with a saved authorization, so one that must be reconnected
 * keeps the channel inactive even with SMTP enabled.
 */
export function emailChannel(mail?: MailState): { active: boolean; detail: string; summary: string } {
  const active = !!mail?.available;
  // Older servers omit the provider: a connected account wins, as on the server.
  const provider = mail?.provider || (mail?.google?.connected ? "google" : "smtp");
  if (active && provider === "google")
    return {
      active,
      detail: mail?.google?.email ? t("Conta Google · {0}", [mail.google.email]) : t("Conta Google"),
      summary: t("Serviço em uso: conta Google."),
    };
  if (active) return { active, detail: t("Servidor SMTP"), summary: t("Serviço em uso: servidor SMTP.") };
  if (provider === "google")
    return {
      active,
      detail: t("Conta Google · reconexão necessária"),
      summary: t("A conta Google precisa ser reconectada. Até lá, os alertas por e-mail não são enviados."),
    };
  return {
    active,
    detail: t("Não configurado"),
    summary: t("Nenhum serviço de e-mail ativo. Conecte uma conta Google ou configure um servidor SMTP."),
  };
}
type Section = NonNullable<AppRoute["section"]>;

/** Local calendar day "YYYY-MM-DD" of an epoch in seconds. */
const day = (n: number) => {
  const d = new Date(n * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const when = (n: number | null | undefined) => (n ? formatDateTime(n) : "—");
const statuses = (): Record<string, string> => ({
  sent: t("Aceito pelo provedor"),
  confirmed_sent: t("Enviado"),
  delivered: t("Entregue"),
  read: t("Lido"),
  delivery_failed: t("Falha de entrega"),
  pending: t("Na fila"),
  sending: t("Enviando"),
  failed: t("Falha no envio"),
  waiting_contact: t("Bloqueado: sem destinatário"),
  waiting_service: t("Bloqueado: canal indisponível"),
  uncertain: t("Envio requer verificação"),
  cancelled: t("Cancelado"),
  expired: t("Expirado"),
  quiet: t("Silenciado neste horário"),
});
/** Pill tone of a delivery status; the text always says the state. */
function statusTone(status: string) {
  if (["sent", "confirmed_sent", "delivered", "read"].includes(status)) return "is-active";
  if (["failed", "delivery_failed"].includes(status)) return "is-danger";
  if (["uncertain", "waiting_contact", "waiting_service"].includes(status)) return "is-warning";
  if (["pending", "sending"].includes(status)) return "is-info";
  return "is-ended";
}
const channels = (): Record<string, string> => ({
  all: t("Todos os canais"),
  email: t("E-mail"),
  whatsapp: "WhatsApp",
  telegram: "Telegram",
});
const kinds = (): Record<string, string> => ({
  alert: t("Alerta"),
  test: t("Teste"),
  recovery: t("Recuperação de acesso"),
  legacy: t("Registro anterior"),
});
const blankFilters = { channel: "all", status: "all", user: "", q: "", start: "", end: "" };
async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch("/api" + path, { cache: "no-store", signal });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw Error(
      typeof e.detail === "string"
        ? t(e.detail)
        : t("Não foi possível carregar os registros."),
    );
  }
  return r.json();
}
function displayStatus(entry: Entry) {
  if (entry.channel === "whatsapp" && entry.status === "sent" && entry.receipt_status)
    return ({ sent: "confirmed_sent", delivered: "delivered", read: "read", failed: "delivery_failed" } as Record<string, string>)[entry.receipt_status] || entry.status;
  return entry.status;
}
function DeliveryStatus({ status }: { status: string }) {
  return <span className={clsx("status-pill", statusTone(status))}>{statuses()[status] || status}</span>;
}
/** Channel with its icon: never told by color alone. */
function ChannelName({ channel }: { channel: string }) {
  const Icon = channel === "whatsapp" ? MessageCircle : channel === "telegram" ? Send : Mail;
  return (
    <span className="channel-name">
      <Icon size={15} aria-hidden="true" />
      {channels()[channel] || channel}
    </span>
  );
}

/** Fare source health for every trip: status, last failure, last success and next attempt. */
function SourceCard({ fallback, now }: { fallback?: SourceStatus | null; now: number }) {
  const health = useQuery<{ source?: SourceStatus | null }>({
    queryKey: ["admin-health"],
    queryFn: async ({ signal }) => {
      // A late worker answers 503 with the same body: the source part still holds.
      const response = await fetch("/api/health", { cache: "no-store", signal });
      return response.json();
    },
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });
  const source = health.data && "source" in health.data ? health.data.source : fallback;
  const status = source?.status;
  const tone = status === "ok" ? "is-active" : status === "degraded" ? "is-warning" : status === "paused" ? "is-danger" : "is-ended";
  const Icon = status === "ok" ? CheckCircle2 : status === "degraded" ? TriangleAlert : status === "paused" ? CirclePause : CircleHelp;
  const message = sourceMessage(source, now);
  return (
    <section className={clsx("card source-card", tone)} aria-labelledby="source-card-title">
      <div className="source-card-head">
        <span className="source-card-icon" aria-hidden="true">
          <Icon size={22} />
        </span>
        <div>
          <h2 id="source-card-title">{t("Fonte de tarifas")}</h2>
          <p>{t("Consultas de preço no Google Voos, para todas as viagens.")}</p>
        </div>
        <span className={clsx("status-pill", tone)}>
          {status === "ok"
            ? t("Funcionando")
            : status === "degraded"
              ? t("Instável")
              : status === "paused"
                ? t("Pausada")
                : t("Sem informação")}
        </span>
      </div>
      {message && (
        <p className="source-card-message">
          <strong>{message.lead}</strong> {message.text}
        </p>
      )}
      {source ? (
        <dl className="admin-stats source-facts">
          <div>
            <dt>{t("Último sucesso")}</dt>
            <dd>
              {source.last_success_at ? (
                <time title={formatDateTime(source.last_success_at)}>{formatRelative(source.last_success_at, now)}</time>
              ) : (
                t("Nenhum ainda")
              )}
            </dd>
          </div>
          <div>
            <dt>{t("Falhas seguidas")}</dt>
            <dd>{formatNumber(source.consecutive_failures)}</dd>
          </div>
          <div>
            <dt>{t("Próxima tentativa")}</dt>
            <dd>
              {source.status !== "paused"
                ? t("Sem pausa")
                : source.retry_at && source.retry_at > now
                  ? formatTime(source.retry_at)
                  : t("Consulta de teste em andamento")}
            </dd>
          </div>
          <div>
            <dt>{t("Última falha")}</dt>
            <dd>
              {/* The kind in plain language while the source is unstable or paused, then when. */}
              {source.kind ? (
                <>
                  {sourceKindLabel(source.kind)}
                  {source.last_failure_at && (
                    <small title={formatDateTime(source.last_failure_at)}>{formatRelative(source.last_failure_at, now)}</small>
                  )}
                </>
              ) : source.last_failure_at ? (
                <time title={formatDateTime(source.last_failure_at)}>{formatRelative(source.last_failure_at, now)}</time>
              ) : (
                t("Nenhuma registrada")
              )}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="source-card-message">{t("O estado da fonte aparece aqui assim que o servidor informar.")}</p>
      )}
    </section>
  );
}

function LogDetail({
  id,
  onClose,
  navigate,
}: {
  id: string | null;
  onClose: () => void;
  navigate?: Navigate;
}) {
  const query = useQuery<Entry>({
    queryKey: ["admin-delivery", id],
    queryFn: ({ signal }) =>
      read("/admin/deliveries/" + encodeURIComponent(id!), signal),
    enabled: !!id,
    refetchInterval: 15000,
    staleTime: 0,
  });
  const entry = query.data;
  const service =
    entry?.provider === "google"
      ? "Gmail"
      : entry?.provider === "smtp"
        ? "SMTP"
        : entry?.provider === "openwa"
          ? "OpenWA"
          : entry?.provider || t("Não registrado");
  return (
    <TaskPage
      onBack={onClose}
      backLabel={t("Voltar aos envios")}
      title={t("Detalhes do envio")}
      description={t("Conteúdo registrado e resultado da tentativa de envio.")}
      className="delivery-detail"
    >
      {query.isError ? (
        <LoadError level={2} message={query.error.message} onRetry={() => void query.refetch()} />
      ) : !entry ? (
        <TableSkeleton rows={4} />
      ) : (
        <>
          <section className="card delivery-summary" aria-labelledby="delivery-subject">
            <div className="delivery-summary-head">
              <h2 id="delivery-subject">{entry.subject}</h2>
              <DeliveryStatus status={displayStatus(entry)} />
            </div>
            <dl className="list-group detail-list">
              <div className="list-row">
                <dt>{t("Usuário")}</dt>
                <dd>
                  {entry.account_name || t("Não identificado")}
                  {entry.login && <small>{entry.login}</small>}
                </dd>
              </div>
              <div className="list-row">
                <dt>{t("Destinatários")}</dt>
                <dd>{entry.recipients.join(", ") || "—"}</dd>
              </div>
              <div className="list-row">
                <dt>{t("Canal / serviço")}</dt>
                <dd>
                  <ChannelName channel={entry.channel} />
                  <small>{service}</small>
                </dd>
              </div>
              <div className="list-row">
                <dt>{t("Tipo")}</dt>
                <dd>{kinds()[entry.kind] || entry.kind}</dd>
              </div>
              <div className="list-row">
                <dt>{t("Solicitado em")}</dt>
                <dd>{when(entry.created)}</dd>
              </div>
              <div className="list-row">
                <dt>{t("Concluído em")}</dt>
                <dd>{when(entry.completed)}</dd>
              </div>
              <div className="list-row">
                <dt>{t("Tentativas")}</dt>
                <dd>{formatNumber(entry.attempts)}</dd>
              </div>
              {entry.channel === "whatsapp" && (
                <>
                  <div className="list-row">
                    <dt>{t("Envio confirmado em")}</dt>
                    <dd>{when(entry.receipt_sent_at)}</dd>
                  </div>
                  <div className="list-row">
                    <dt>{t("Entrega confirmada em")}</dt>
                    <dd>{when(entry.delivered_at)}</dd>
                  </div>
                  <div className="list-row">
                    <dt>{t("Leitura confirmada em")}</dt>
                    <dd>{when(entry.read_at)}</dd>
                  </div>
                </>
              )}
            </dl>
            {entry.error && (
              <p className="delivery-error">
                <TriangleAlert size={16} aria-hidden="true" />
                <span>{t(entry.error)}</span>
              </p>
            )}
            {entry.status === "waiting_contact" && (
              <p className="admin-footnote">
                {t("Cadastre um contato para receber os próximos alertas. Este registro não será reenviado.")}
              </p>
            )}
            {["waiting_contact", "waiting_service"].includes(entry.status) && navigate && (
              <div className="admin-actions">
                <Button
                  variant="outline"
                  onClick={() =>
                    entry.status === "waiting_contact" && entry.owner_id
                      ? navigate({ view: "admin", section: "users", userAction: "edit", userId: entry.owner_id })
                      : navigate({ view: "admin", section: "channels", channel: entry.channel })
                  }
                >
                  {entry.status === "waiting_contact" ? t("Corrigir contato") : t("Configurar canal")}
                </Button>
              </div>
            )}
            {entry.provider_message_id && (
              <p className="admin-footnote">{t("ID no integrador: {0}", [entry.provider_message_id])}</p>
            )}
          </section>
          <section className="card delivery-message" aria-labelledby="delivery-message-title">
            <h2 id="delivery-message-title">{t("Mensagem")}</h2>
            {entry.content_protected ? (
              <p className="admin-footnote">
                {t("Conteúdo protegido: mensagens de recuperação de acesso não exibem links de segurança.")}
              </p>
            ) : (
              <pre className="admin-message">{entry.body}</pre>
            )}
          </section>
          <p className="admin-footnote">
            {entry.channel === "whatsapp" && entry.receipt_status
              ? t("Horários de confirmação informados pelo integrador.")
              : t("Aceito pelo provedor não confirma entrega na caixa de entrada ou leitura pelo destinatário.")}
          </p>
        </>
      )}
    </TaskPage>
  );
}

function DeliveryLog({
  onCleanup,
  route,
  navigate,
  source,
  serverNow,
}: {
  onCleanup: () => void;
  route?: AppRoute;
  navigate?: Navigate;
  source?: SourceStatus | null;
  serverNow: number;
}) {
  const [draft, setDraft] = useState(blankFilters),
    [filters, setFilters] = useState(blankFilters),
    [page, setPage] = useState(0),
    [anchor, setAnchor] = useState(Date.now() / 1000),
    [localSelected, setLocalSelected] = useState<string | null>(null);
  const selected = route?.deliveryId || localSelected;
  const setSelected = (id: string | null) =>
    navigate
      ? navigate({
          view: "admin",
          section: "deliveries",
          deliveryId: id || undefined,
        })
      : setLocalSelected(id);
  const params = new URLSearchParams({
    channel: filters.channel,
    status: filters.status,
    user: filters.user,
    q: filters.q,
    page: String(page),
    end: String(anchor),
  });
  if (filters.start)
    params.set(
      "start",
      String(new Date(filters.start + "T00:00:00").getTime() / 1000),
    );
  if (filters.end) {
    const end = new Date(filters.end + "T00:00:00");
    end.setDate(end.getDate() + 1);
    params.set("end", String(Math.min(anchor, end.getTime() / 1000 - 0.001)));
  }
  const query = useQuery<LogPage>({
    queryKey: ["admin-deliveries", params.toString()],
    queryFn: ({ signal }) => read("/admin/deliveries?" + params, signal),
    staleTime: 15000,
    refetchInterval: 15000,
    enabled: !selected,
    // The rows of the last page stay while the next one loads: the pager keeps the focus.
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const refresh = () => {
    setPage(0);
    setAnchor(Date.now() / 1000);
  };
  const active = [
    filters.channel !== "all",
    filters.status !== "all",
    filters.user,
    filters.q,
    filters.start,
    filters.end,
  ].filter(Boolean).length;
  if (selected)
    return <LogDetail id={selected} onClose={() => setSelected(null)} navigate={navigate} />;
  const attention = data
    ? (data.totals.failed || 0) +
      (data.totals.uncertain || 0) +
      (data.totals.waiting_contact || 0) +
      (data.totals.waiting_service || 0) +
      (data.receipt_totals?.failed || 0)
    : 0;
  const waiting = data ? (data.totals.pending || 0) + (data.totals.sending || 0) : 0;
  return (
    <div className="admin-stack">
      <SourceCard fallback={source} now={serverNow} />
      <section className="card admin-card" aria-labelledby="deliveries-title">
        <header className="admin-card-heading">
          <div>
            <h2 id="deliveries-title">{t("Atividade de envio")}</h2>
            <p>{t("Consulte destinatários, resultados e o conteúdo de cada mensagem.")}</p>
          </div>
          <div className="admin-card-actions">
            <Button variant="ghost" size="small" onClick={onCleanup}>
              {t("Limpar logs")}
            </Button>
            <Button variant="outline" size="small" onClick={refresh}>
              <RefreshCw size={15} aria-hidden="true" className={query.isFetching ? "spin" : undefined} />
              {t("Atualizar")}
            </Button>
          </div>
        </header>
        <FilterBar
          title={t("Filtrar envios")}
          active={active}
          onApply={() => {
            setFilters({ ...draft });
            refresh();
          }}
          onReset={() => {
            setDraft(blankFilters);
            setFilters(blankFilters);
            refresh();
          }}
        >
          <label className="field">
            <span className="field-label">{t("Mensagem ou destinatário")}</span>
            <input
              type="search"
              maxLength={200}
              value={draft.q}
              onChange={(e) => setDraft({ ...draft, q: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">{t("Usuário")}</span>
            <input
              type="search"
              maxLength={120}
              placeholder={t("Nome ou login")}
              value={draft.user}
              onChange={(e) => setDraft({ ...draft, user: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">{t("Canal")}</span>
            <select value={draft.channel} onChange={(e) => setDraft({ ...draft, channel: e.target.value })}>
              {Object.entries(channels()).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">{t("Situação")}</span>
            <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
              <option value="all">{t("Todas as situações")}</option>
              <option value="sent">{t("Aceito pelo provedor")}</option>
              <option value="delivered">{t("Entregue no WhatsApp")}</option>
              <option value="read">{t("Lido no WhatsApp")}</option>
              <option value="delivery_failed">{t("Falha de entrega no WhatsApp")}</option>
              <option value="pending">{t("Na fila / enviando")}</option>
              <option value="failed">{t("Problemas e bloqueios")}</option>
              <option value="blocked">{t("Bloqueados por configuração")}</option>
              <option value="closed">{t("Cancelado / expirado / silenciado")}</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">{t("De")}</span>
            <input
              type="date"
              value={draft.start}
              max={draft.end || undefined}
              onChange={(e) => setDraft({ ...draft, start: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">{t("Até")}</span>
            <input
              type="date"
              value={draft.end}
              min={draft.start || undefined}
              onChange={(e) => setDraft({ ...draft, end: e.target.value })}
            />
          </label>
        </FilterBar>
        {query.isError ? (
          <LoadError message={query.error.message} onRetry={() => void query.refetch()} />
        ) : !data ? (
          <TableSkeleton rows={6} />
        ) : (
          <>
            <p className="admin-summary" role="status">
              <strong>{plural(data.total, "{0} registro", "{0} registros", formatNumber(data.total))}</strong>
              <span>
                {[
                  plural(data.totals.sent || 0, "{0} aceito", "{0} aceitos", formatNumber(data.totals.sent || 0)),
                  plural(waiting, "{0} pendente", "{0} pendentes", formatNumber(waiting)),
                  t("{0} para verificar", [formatNumber(attention)]),
                ].join(" · ")}
              </span>
            </p>
            {data.items.length ? (
              <div className="table-frame">
                <table
                  role="table"
                  className={clsx("data-table delivery-table", query.isPlaceholderData && "is-stale")}
                  aria-busy={query.isFetching || undefined}
                >
                  <caption className="sr-only">
                    {t("Envios: mensagem, destinatário, canal, situação e data")}
                  </caption>
                  <thead role="rowgroup">
                    <tr role="row">
                      <th scope="col" role="columnheader" className="col-message">{t("Mensagem")}</th>
                      <th scope="col" role="columnheader" className="col-recipient">{t("Usuário / destinatário")}</th>
                      <th scope="col" role="columnheader" className="col-channel">{t("Canal")}</th>
                      <th scope="col" role="columnheader" className="col-status">{t("Situação")}</th>
                      <th scope="col" role="columnheader" className="col-when">{t("Data e hora")}</th>
                      <th scope="col" role="columnheader" className="col-action">
                        <span className="sr-only">{t("Detalhes")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody role="rowgroup">
                    {data.items.map((entry) => (
                      <tr role="row" key={entry.id} className="is-clickable" onClick={() => !selectingText() && setSelected(entry.id)}>
                        <td role="cell" className="cell-message">
                          <span className="cell-title cell-truncate cell-clamp" title={entry.subject}>
                            {entry.subject}
                          </span>
                          <span className="cell-secondary">{kinds()[entry.kind] || entry.kind}</span>
                        </td>
                        <td role="cell" className="cell-recipient">
                          <span className="cell-title cell-truncate">{entry.account_name || t("Não identificado")}</span>
                          <span className="cell-secondary cell-truncate" title={entry.recipients.join(", ")}>
                            {entry.recipients.join(", ") || entry.login || "—"}
                          </span>
                        </td>
                        <td role="cell" className="cell-channel cell-field">
                          <CellLabel>{t("Canal")}</CellLabel>
                          <ChannelName channel={entry.channel} />
                        </td>
                        <td role="cell" className="cell-status">
                          <DeliveryStatus status={displayStatus(entry)} />
                        </td>
                        <td role="cell" className="cell-when cell-field">
                          <CellLabel>{t("Data e hora")}</CellLabel>
                          <time title={formatDateTime(entry.created)}>{formatDateTimeCompact(entry.created)}</time>
                        </td>
                        <td role="cell" className="cell-action">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="row-action"
                            aria-label={t("Ver envio: {0}", [entry.subject])}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelected(entry.id);
                            }}
                          >
                            <ChevronRight size={18} aria-hidden="true" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyRows icon={Inbox} title={t("Nenhum envio encontrado")}>
                {t("Ajuste os filtros ou use Atualizar para incluir envios recentes.")}
              </EmptyRows>
            )}
            <Pager
              page={page}
              pageSize={data.page_size}
              total={data.total}
              onPage={setPage}
              label={t("Páginas de envios")}
              summary={t("Consulta atualizada em {0}", [formatDateTimeCompact(anchor)])}
            />
            <p className="admin-footnote">
              {t("A consulta mantém um recorte estável. Use Atualizar para incluir novos envios.")}
            </p>
          </>
        )}
      </section>
    </div>
  );
}

function Retention({
  request,
  initialScope = "deliveries",
}: {
  request: RequestFn;
  initialScope?: string;
}) {
  const cache = useQueryClient(),
    [scope, setScope] = useState(initialScope),
    // null: untouched, the field shows the saved period; any text (even empty) is the admin's.
    [policyDays, setPolicyDays] = useState<string | null>(null),
    [before, setBefore] = useState(""),
    [mode, setMode] = useState("before"),
    [plan, setPlan] = useState<Plan | null>(null),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [shorten, setShorten] = useState<number | null>(null),
    [shortenError, setShortenError] = useState("");
  // A success from the confirmation waits for the dialog to close (see Modal.onClosed).
  const closedMessage = useRef("");
  const query = useQuery<Policy>({
    queryKey: ["delivery-retention", scope],
    queryFn: ({ signal }) =>
      read("/admin/delivery-retention?scope=" + scope, signal),
  });
  const value = before || (query.data ? day(query.data.cutoff) : "");
  function resetPlan() {
    setPlan(null);
    setChecked(false);
    setMessage("");
    setError("");
  }
  /** From the confirmation, a failure stays in the open dialog, where it is announced. */
  async function savePolicy(days: number, confirming = false) {
    setBusy(true);
    resetPlan();
    setShortenError("");
    try {
      await request("/admin/delivery-retention", { scope, days }, "PUT");
      await cache.invalidateQueries({ queryKey: ["delivery-retention"] });
      await cache.invalidateQueries({ queryKey: ["audit"] });
      setPolicyDays(null);
      const done = t("Retenção salva. A nova regra será aplicada nas verificações automáticas.");
      if (confirming) {
        closedMessage.current = done;
        setShorten(null);
      } else setMessage(done);
    } catch (e) {
      if (confirming) setShortenError(t((e as Error).message));
      else setError(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  function submitPolicy(event: FormEvent) {
    event.preventDefault();
    const days = Number(policyDays ?? query.data?.days);
    // A shorter period deletes older records at the next check: confirm first.
    if (query.data && days < query.data.days) {
      setShortenError("");
      setShorten(days);
    } else void savePolicy(days);
  }
  async function preview() {
    setBusy(true);
    resetPlan();
    try {
      setPlan(
        (await request("/admin/delivery-cleanup/preview", {
          scope,
          before:
            mode === "all"
              ? Date.now() / 1000
              : new Date(value + "T00:00:00").getTime() / 1000,
        })) as Plan,
      );
    } catch (e) {
      setError(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  async function purge() {
    if (!plan || !checked) return;
    setBusy(true);
    setError("");
    try {
      const result = (await request("/admin/delivery-cleanup/confirm", {
        scope,
        before: plan.before,
        expires: plan.expires,
        proof: plan.proof,
      })) as { removed: number; has_more: boolean };
      setMessage(
        plural(result.removed, "{0} registro removido.", "{0} registros removidos.", formatNumber(result.removed)) +
          (result.has_more
            ? " " + t("Há mais registros. Consulte uma nova prévia para continuar.")
            : ""),
      );
      setPlan(null);
      setChecked(false);
      await cache.invalidateQueries({ queryKey: ["delivery-retention"] });
      await cache.invalidateQueries({ queryKey: ["admin-deliveries"] });
      await cache.invalidateQueries({ queryKey: ["audit"] });
      cache.removeQueries({ queryKey: ["admin-delivery"] });
    } catch (e) {
      setPlan(null);
      setChecked(false);
      setError(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  const scopes = [
    ["deliveries", t("Atividade de envio")],
    ["access", t("Auditoria de acessos")],
  ] as const;
  return (
    <section className="card admin-card admin-retention" aria-labelledby="retention-title">
      <header className="admin-card-heading">
        <div>
          <h2 id="retention-title">{t("Retenção e limpeza")}</h2>
          <p>{t("Defina por quanto tempo os registros ficam guardados e limpe os antigos.")}</p>
        </div>
      </header>
      <div className="segmented retention-scope" role="group" aria-label={t("Tipo de log")}>
        {scopes.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={scope === key}
            disabled={busy}
            onClick={() => {
              if (scope === key) return;
              setScope(key);
              setPolicyDays(null);
              setBefore("");
              resetPlan();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {query.isError ? (
        <LoadError message={query.error.message} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <TableSkeleton rows={3} />
      ) : (
        <>
          <p className="retention-policy">
            {scope === "deliveries"
              ? t("Registros de envio concluídos são removidos automaticamente após {0}.", [plural(query.data.days, "{0} dia", "{0} dias")])
              : t("Registros de acesso são removidos automaticamente após {0}. Cada categoria tem também um limite próprio de quantidade.", [plural(query.data.days, "{0} dia", "{0} dias")])}
          </p>
          <dl className="admin-stats">
            <div>
              <dt>{t("Registros guardados")}</dt>
              <dd>{formatNumber(query.data.total)}</dd>
            </div>
            {scope === "deliveries" && (
              <div>
                <dt>{t("Protegidos")}</dt>
                <dd>
                  {formatNumber(query.data.protected)}
                  <small>{t("na fila ou em processamento, protegidos da limpeza")}</small>
                </dd>
              </div>
            )}
            <div>
              <dt>{t("Última verificação")}</dt>
              <dd>{query.data.last_cleanup ? formatDateTime(query.data.last_cleanup) : t("Ainda não realizada")}</dd>
            </div>
          </dl>
          <form className="retention-form" onSubmit={submitPolicy}>
            <label className="field">
              <span className="field-label">{t("Manter logs por (dias)")}</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={3650}
                required
                disabled={busy}
                value={policyDays ?? String(query.data.days)}
                onChange={(e) => setPolicyDays(e.target.value)}
              />
            </label>
            <Button type="submit" variant="outline" disabled={busy}>
              {t("Salvar retenção")}
            </Button>
          </form>
          <p className="admin-footnote">
            {t("Reduzir o prazo permite excluir registros antigos na próxima verificação automática. Preços e oportunidades são preservados.")}{" "}
            {t("Limpeza em lotes de até {0}.", [
              plural(query.data.batch_size, "{0} registro", "{0} registros", formatNumber(query.data.batch_size)),
            ])}
          </p>
          <details className="admin-disclosure manual-cleanup">
            <summary>
              <Trash2 size={18} aria-hidden="true" />
              <span>{t("Limpeza manual")}</span>
            </summary>
            <div className="admin-disclosure-body">
              <p>
                {t("Exclui definitivamente os logs selecionados de todos os usuários. Não remove contas, preços ou oportunidades.")}
              </p>
              <form
                className="cleanup-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void preview();
                }}
              >
                <label className="field">
                  <span className="field-label">{t("O que excluir")}</span>
                  <select
                    value={mode}
                    disabled={busy}
                    onChange={(e) => {
                      setMode(e.target.value);
                      resetPlan();
                    }}
                  >
                    <option value="before">{t("Anteriores à data")}</option>
                    <option value="all">
                      {scope === "deliveries" ? t("Todos os envios concluídos") : t("Todos os acessos registrados")}
                    </option>
                  </select>
                </label>
                {mode === "before" && (
                  <label className="field">
                    <span className="field-label">
                      {scope === "deliveries" ? t("Concluídos antes de") : t("Registrados antes de")}
                    </span>
                    <input
                      type="date"
                      required
                      disabled={busy}
                      value={value}
                      max={day(Date.now() / 1000)}
                      onChange={(e) => {
                        setBefore(e.target.value);
                        resetPlan();
                      }}
                    />
                  </label>
                )}
                <Button type="submit" variant="outline" disabled={busy}>
                  {t("Consultar prévia")}
                </Button>
              </form>
              {plan && (
                <div className="cleanup-preview" role="status">
                  <p className="cleanup-count">
                    <strong>
                      {plural(plan.count, "{0} registro será excluído neste lote.", "{0} registros serão excluídos neste lote.", formatNumber(plan.count))}
                    </strong>
                  </p>
                  <p>
                    {t("Total elegível: {0}.", [formatNumber(plan.total)])}{" "}
                    {scope === "deliveries" && t("Pendentes e envios em processamento não serão excluídos.")}
                  </p>
                  {plan.count > 0 && (
                    <>
                      <label className="check-row">
                        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                        {t("Entendo que esta exclusão é definitiva.")}
                      </label>
                      <Button
                        variant="danger"
                        className="button-confirm"
                        disabled={!checked || busy}
                        onClick={() => void purge()}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                        {plural(plan.count, "Excluir {0} registro", "Excluir {0} registros", formatNumber(plan.count))}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          </details>
        </>
      )}
      <Notice tone="error" onDismiss={() => setError("")}>
        {error}
      </Notice>
      <Notice onDismiss={() => setMessage("")}>{message}</Notice>
      <p className="admin-footnote">{t("A limpeza remove somente os registros selecionados. Os backups são preservados.")}</p>
      <ConfirmDialog
        open={shorten !== null}
        onOpenChange={(open) => {
          if (open) return;
          setShorten(null);
          setShortenError("");
        }}
        title={plural(shorten ?? 0, "Reduzir a retenção para {0} dia?", "Reduzir a retenção para {0} dias?")}
        description={t("Registros mais antigos que o novo prazo serão excluídos na próxima verificação automática, que roda de hora em hora. A exclusão não pode ser desfeita.")}
        confirmLabel={t("Reduzir retenção")}
        busy={busy}
        error={shortenError}
        onConfirm={() => shorten !== null && void savePolicy(shorten, true)}
        onClosed={() => {
          if (!closedMessage.current) return;
          setMessage(closedMessage.current);
          closedMessage.current = "";
        }}
      />
    </section>
  );
}

/** E-mail channel: the Google account and the SMTP server. */
function EmailChannel({
  mail,
  request,
  onChanged,
}: {
  mail?: MailState;
  request: RequestFn;
  onChanged: () => Promise<unknown>;
}) {
  const google = mail?.google;
  return (
    <section className="channel-panel" aria-labelledby="channel-email-title">
      <header className="channel-panel-heading">
        <span className="admin-channel-icon is-large" aria-hidden="true">
          <Mail size={22} />
        </span>
        <div>
          <h2 id="channel-email-title">{t("E-mail")}</h2>
          <p>{emailChannel(mail).summary}</p>
        </div>
      </header>
      {google && (
        <Suspense
          fallback={
            <div className="card">
              <TableSkeleton rows={3} />
            </div>
          }
        >
          <GoogleMailPanel
            status={google}
            testRecipient={mail?.testRecipient || ""}
            defaultEmail={mail?.defaultEmail || ""}
            request={request}
            onChanged={onChanged}
          />
        </Suspense>
      )}
      <SmtpSettings smtp={mail?.smtp ?? null} provider={mail?.provider ?? null} request={request} onChanged={onChanged} />
    </section>
  );
}

export function AdminPanel({
  request,
  userId = "",
  route,
  navigate,
  source,
  serverNow = Date.now() / 1000,
  mail,
  whatsappAvailable = false,
  onChanged = async () => {},
}: {
  request: RequestFn;
  userId?: string;
  route?: AppRoute;
  navigate?: Navigate;
  /** Fare source from the state, until the health check answers. */
  source?: SourceStatus | null;
  serverNow?: number;
  mail?: MailState;
  whatsappAvailable?: boolean;
  /** The shared state changed (channels): refresh it. */
  onChanged?: () => Promise<unknown>;
}) {
  // Hook order matters to the tests: the tab and the channel come first.
  const [localTab, setLocalTab] = useState<Section>("deliveries"),
    [localChannel, setLocalChannel] = useState("email"),
    [retentionScope, setRetentionScope] = useState("deliveries");
  const tabList = useRef<HTMLDivElement>(null);
  const tab = route?.section || localTab,
    channel = route?.channel || localChannel;
  /**
   * Clicks add a history entry; arrow keys replace it. A tab keeps the focus;
   * a shortcut from inside a section (its button goes away) hands it to the title.
   */
  const setTab = (next: Section, replace = false, keepFocus = true) =>
    navigate
      ? navigate({ view: "admin", section: next }, replace, { keepFocus })
      : setLocalTab(next);
  const setChannel = (next: string) =>
    navigate
      ? navigate({ view: "admin", section: "channels", channel: next }, false, { keepFocus: true })
      : setLocalChannel(next);
  const tabs: [Section, string][] = [
    ["deliveries", t("Envios")],
    ["channels", t("Canais")],
    ["users", t("Usuários")],
    ["audit", t("Auditoria")],
    ["retention", t("Retenção")],
  ];
  // A task (message, account form, monitorings) is a page of its own, without tabs.
  const task =
    (tab === "deliveries" && !!route?.deliveryId) || (tab === "users" && !!route?.userAction);
  // Phones scroll the tabs sideways: keep the selected one in view.
  useEffect(() => {
    const list = tabList.current,
      selected = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !selected || list.scrollWidth <= list.clientWidth) return;
    list.scrollLeft = Math.max(0, selected.offsetLeft - (list.clientWidth - selected.offsetWidth) / 2);
    // Also when the tabs come back from a task page (a message, an account form).
  }, [tab, task]);
  function tabKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const index = tabs.findIndex(([key]) => key === tab);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    setTab(tabs[next][0], true);
    event.currentTarget.querySelector<HTMLElement>(`#admin-tab-${tabs[next][0]}`)?.focus();
  }
  const email = emailChannel(mail);
  return (
    <div className={clsx("admin-workspace", task && "is-task")}>
      {!task && (
        <div
          ref={tabList}
          className="segmented admin-tabs"
          role="tablist"
          aria-label={t("Seções da administração")}
          onKeyDown={tabKeys}
        >
          {tabs.map(([key, label]) => (
            <button
              key={key}
              id={"admin-tab-" + key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              // Only the selected section's panel is in the page.
              aria-controls={tab === key ? "admin-panel-" + key : undefined}
              tabIndex={tab === key ? 0 : -1}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div
        role={task ? undefined : "tabpanel"}
        id={"admin-panel-" + tab}
        aria-labelledby={task ? undefined : "admin-tab-" + tab}
        tabIndex={task ? undefined : 0}
        className="admin-panel"
      >
        {tab === "deliveries" && (
          <DeliveryLog
            route={route}
            navigate={navigate}
            source={source}
            serverNow={serverNow}
            onCleanup={() => {
              setRetentionScope("deliveries");
              setTab("retention", false, false);
            }}
          />
        )}
        {tab === "users" && (
          <AdminUsers
            request={request}
            userId={userId}
            route={route}
            navigate={navigate}
          />
        )}
        {tab === "audit" && (
          <AuditPanel
            admin
            expanded
            actions={
              <Button
                variant="ghost"
                size="small"
                onClick={() => {
                  setRetentionScope("access");
                  setTab("retention", false, false);
                }}
              >
                {t("Limpar logs")}
              </Button>
            }
          />
        )}
        {tab === "retention" && (
          <Retention request={request} initialScope={retentionScope} />
        )}
        {tab === "channels" && (
          <div className="admin-channels">
            <nav className="list-section channel-nav" aria-labelledby="channel-nav-title">
              <h2 className="list-section-title" id="channel-nav-title">
                {t("Canais de envio")}
              </h2>
              <div className="list-group">
                {[
                  { key: "email", label: t("E-mail"), icon: Mail, detail: email.detail, on: email.active },
                  {
                    key: "whatsapp",
                    label: "WhatsApp",
                    icon: MessageCircle,
                    detail: whatsappAvailable ? t("Envios habilitados") : t("Não configurado"),
                    on: whatsappAvailable,
                  },
                ].map((item) => (
                  <a
                    key={item.key}
                    className={clsx("list-row channel-link", channel === item.key && "is-selected")}
                    href={routePath({ view: "admin", section: "channels", channel: item.key })}
                    aria-current={channel === item.key ? "page" : undefined}
                    onClick={(event) => plainClick(event) && setChannel(item.key)}
                  >
                    <span className="admin-channel-icon" aria-hidden="true">
                      <item.icon size={18} />
                    </span>
                    <span className="channel-link-text">
                      <span className="channel-link-name">{item.label}</span>
                      <span className="channel-link-detail">{item.detail}</span>
                    </span>
                    <span className={clsx("status-pill", item.on ? "is-active" : "is-ended")}>
                      {item.on ? t("Ativo") : t("Inativo")}
                    </span>
                  </a>
                ))}
                <div className="list-row channel-link is-disabled" role="link" aria-disabled="true">
                  <span className="admin-channel-icon" aria-hidden="true">
                    <Send size={18} />
                  </span>
                  <span className="channel-link-text">
                    <span className="channel-link-name">Telegram</span>
                    <span className="channel-link-detail">{t("Integração ainda não disponível")}</span>
                  </span>
                  <span className="status-pill is-ended">{t("Em breve")}</span>
                </div>
              </div>
            </nav>
            <div className="channel-detail">
              {channel === "whatsapp" ? (
                <WhatsAppPanel request={request} />
              ) : channel === "telegram" ? (
                <section className="channel-panel" aria-labelledby="channel-telegram-title">
                  <header className="channel-panel-heading">
                    <span className="admin-channel-icon is-large" aria-hidden="true">
                      <Send size={22} />
                    </span>
                    <div>
                      <h2 id="channel-telegram-title">Telegram</h2>
                      <p>{t("Integração ainda não disponível. Nenhuma mensagem é enviada por este canal.")}</p>
                    </div>
                    <span className="status-pill is-ended">{t("Em breve")}</span>
                  </header>
                  <p className="admin-footnote">
                    {t("As credenciais de envio serão administradas aqui; os contatos dos destinatários ficam no perfil de cada usuário.")}
                  </p>
                </section>
              ) : (
                <EmailChannel mail={mail} request={request} onChanged={onChanged} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
