import { TaskPage } from "./TaskPage";
import { plainClick, routePath, type AppRoute, type Navigate } from "./navigation";
import { WhatsAppPanel } from "./WhatsAppPanel";
import { AdminUsers } from "./AdminUsers";
import { SmtpSettings } from "./SmtpSettings";
import { CellLabel, EmptyRows, FilterBar, LoadError, Pager, TableSkeleton, selectingText } from "./DataView";
import "./admin.css";
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import {
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  HeartPulse,
  CirclePause,
  Inbox,
  Shield,
  Mail,
  MessageCircle,
  OctagonAlert,
  Radar,
  RefreshCw,
  Send,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { t } from "./i18n";
import { Button, ConfirmDialog, Notice } from "./ui";
import { AuditPanel } from "./AuditPanel";
import { clockIn, StatusChip } from "./DeliveryChannels";
import { InfoTip } from "./InfoTip";
import { formatDate, formatDateTime, formatDateTimeCompact, formatDuration, formatNumber, formatPercent, formatRelative, formatTime } from "./format";
import { plural } from "./plural";
import { sourceKindLabel, sourceMessage } from "./LiveStatus";
import { healthCodeLabel } from "./healthCodes";
import type { GoogleMail, SMTP, SourceKind, SourceStatus } from "./types";

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
  /** When the sender takes it: later than now while quiet hours hold it. */
  next_due?: number | null;
  /** The recipient account's time zone: the end of its quiet hours reads on its clock. */
  owner_timezone?: string | null;
};
type LogPage = {
  items: Entry[];
  total: number;
  page_size: number;
  totals: Record<string, number>;
  receipt_totals?: Record<string, number>;
  /** Configuration blocks of the last 7 days, whatever the filters. */
  blocked?: { channel: string; status: string; count: number }[];
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
const channels = (): Record<string, string> => ({
  all: t("Todos os canais"),
  whatsapp: "WhatsApp",
  email: t("E-mail"),
});
const kinds = (): Record<string, string> => ({
  alert: t("Alerta"),
  test: t("Teste"),
  recovery: t("Recuperação de acesso"),
  health: t("Saúde"),
  health_digest: t("Resumo diário"),
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
function displayStatus(entry: Entry, now = Date.now() / 1000) {
  // Pending until the end of the recipient's quiet hours.
  if (entry.status === "pending" && (entry.next_due || 0) > now) return "held";
  if (entry.channel === "whatsapp" && entry.status === "sent" && entry.receipt_status)
    return ({ sent: "confirmed_sent", delivered: "delivered", read: "read", failed: "delivery_failed" } as Record<string, string>)[entry.receipt_status] || entry.status;
  return entry.status;
}
/**
 * The same chip as the person's alerts; with `exact`, the administration's own wording stays
 * visible under it (the tooltip reaches neither the keyboard nor touch).
 */
function DeliveryStatus({ entry, exact = false }: { entry: Entry; exact?: boolean }) {
  const status = displayStatus(entry);
  const text = status === "held" ? t("Retida até {0}", [clockIn(entry.next_due || 0, entry.owner_timezone)]) : statuses()[status] || status;
  const chip = <StatusChip state={status} detail={text} />;
  if (!exact) return chip;
  return (
    <span className="delivery-state">
      {chip}
      <small aria-hidden="true">{text}</small>
    </span>
  );
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

/** The detailed health the administrator receives: the fare source and whether alert links are local. */
type Health = { source?: SourceStatus | null; alert_links_local?: boolean };
const healthQuery = {
  queryKey: ["admin-health"],
  queryFn: async ({ signal }: { signal: AbortSignal }): Promise<Health> => {
    // A late worker answers 503 with the same body: the source part still holds.
    const response = await fetch("/api/health", { cache: "no-store", signal });
    return response.json();
  },
  refetchInterval: 30000,
  refetchIntervalInBackground: false,
};

/** The 2FA reminder, once dismissed, stays away for this browser session. */
const REMINDER_KEY = "radar-2fa-reminder-dismissed";
let reminderDismissed = false;
const reminderListeners = new Set<() => void>();
function dismissReminder() {
  reminderDismissed = true;
  try {
    sessionStorage.setItem(REMINDER_KEY, "1");
  } catch {
    /* Kept in memory. */
  }
  reminderListeners.forEach((listener) => listener());
}
function reminderHidden() {
  try {
    return reminderDismissed || sessionStorage.getItem(REMINDER_KEY) === "1";
  } catch {
    return reminderDismissed;
  }
}

/**
 * Above the administration: alert links that only open on this computer, and an administrator
 * account without two-step verification (dismissible for the session). Nothing when all is well.
 */
function AdminNotices({ userId, navigate }: { userId: string; navigate?: Navigate }) {
  const health = useQuery<Health>(healthQuery);
  const twoFactor = useQuery<{ enabled?: boolean }>({
    queryKey: ["two-factor", userId],
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/auth/2fa", { cache: "no-store", signal });
      if (!response.ok) throw Error(t("Não foi possível carregar a verificação em duas etapas."));
      return response.json();
    },
  });
  const hidden = useSyncExternalStore(
    (listener) => {
      reminderListeners.add(listener);
      return () => reminderListeners.delete(listener);
    },
    reminderHidden,
    reminderHidden,
  );
  const remind = twoFactor.data?.enabled === false && !hidden;
  if (!health.data?.alert_links_local && !remind) return null;
  return (
    <div className="admin-notices">
      {health.data?.alert_links_local && (
        <p className="banner warning" role="status">
          <TriangleAlert size={17} aria-hidden="true" />
          <span>{t("Os links dos alertas apontam para este computador. Defina RADAR_PUBLIC_URL.")}</span>
        </p>
      )}
      {remind && (
        <div className="banner warning admin-reminder" role="status">
          <Shield size={17} aria-hidden="true" />
          <span>
            {t("Sua conta de administrador está sem verificação em duas etapas.")}{" "}
            <a
              href={routePath({ view: "settings" })}
              onClick={(event) => navigate && plainClick(event) && navigate({ view: "settings" })}
            >
              {t("Ativar no perfil")}
            </a>
          </span>
          <button type="button" className="admin-reminder-dismiss" onClick={dismissReminder}>
            {t("Agora não")}
          </button>
        </div>
      )}
    </div>
  );
}

/** Fare source health for every trip: status, last failure, last success and next attempt. */
function SourceCard({ fallback, now }: { fallback?: SourceStatus | null; now: number }) {
  const health = useQuery<Health>(healthQuery);
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
              <DeliveryStatus entry={entry} />
            </div>
            <dl className="list-group detail-list">
              <div className="list-row">
                <dt>{t("Situação")}</dt>
                <dd>
                  {displayStatus(entry) === "held"
                    ? t("Retida até {0}", [clockIn(entry.next_due || 0, entry.owner_timezone)])
                    : statuses()[displayStatus(entry)] || displayStatus(entry)}
                </dd>
              </div>
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
  available = { email: true, whatsapp: true },
}: {
  onCleanup: () => void;
  route?: AppRoute;
  navigate?: Navigate;
  source?: SourceStatus | null;
  serverNow: number;
  /** Channels that can send now: blocks of a channel set up since then need no action. */
  available?: { email: boolean; whatsapp: boolean };
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
  // The chips' words (F3): a WhatsApp message reported undelivered counts as a problem, not as sent.
  const undelivered = data?.receipt_totals?.failed || 0;
  const problems = data
    ? ["failed", "uncertain", "expired", "waiting_contact", "waiting_service"].reduce((sum, key) => sum + (data.totals[key] || 0), 0) +
      undelivered
    : 0;
  const sending = data ? (data.totals.pending || 0) + (data.totals.sending || 0) : 0;
  const counts = data
    ? [
        plural((data.totals.sent || 0) - undelivered, "{0} enviado", "{0} enviados"),
        plural(sending, "{0} enviando", "{0} enviando"),
        plural(problems, "{0} com problema", "{0} com problema"),
      ].filter((_, i) => [(data.totals.sent || 0) - undelivered, sending, problems][i] > 0)
    : [];
  // Recent configuration blocks still to fix: a channel without service, or people without a contact.
  const blocks = (data?.blocked || []).filter(
    (item) => item.status === "waiting_contact" || !available[item.channel as "email" | "whatsapp"],
  );
  return (
    <div className="admin-stack">
      <SourceCard fallback={source} now={serverNow} />
      <section className="card admin-card" aria-labelledby="deliveries-title">
        <header className="admin-card-heading">
          <div>
            <div className="admin-card-title">
              <h2 id="deliveries-title">{t("Atividade de envio")}</h2>
              <InfoTip label={t("Sobre a atividade de envio")}>
                <p>{t("Consulte destinatários, resultados e o conteúdo de cada mensagem.")}</p>
                <p>{t("A consulta mantém um recorte estável. Use Atualizar para incluir novos envios.")}</p>
              </InfoTip>
            </div>
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
            {blocks.length > 0 && (
              <p className="banner warning delivery-blocks" role="status">
                <TriangleAlert size={17} aria-hidden="true" />
                <span>
                  {blocks.map((item, i) => (
                    <span key={item.channel + item.status} className="delivery-block">
                      {i > 0 && " · "}
                      {item.status === "waiting_contact"
                        ? plural(item.count, "{0} bloqueado: sem destinatário", "{0} bloqueados: sem destinatário")
                        : item.channel === "whatsapp"
                          ? plural(item.count, "{0} bloqueado: WhatsApp sem serviço", "{0} bloqueados: WhatsApp sem serviço")
                          : plural(item.count, "{0} bloqueado: e-mail sem serviço", "{0} bloqueados: e-mail sem serviço")}{" "}
                      —{" "}
                      {item.status === "waiting_contact" ? (
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => {
                            const next = { ...blankFilters, status: "blocked" };
                            setDraft(next);
                            setFilters(next);
                            setPage(0);
                          }}
                        >
                          {t("Ver envios")}
                        </button>
                      ) : (
                        <a
                          href={routePath({ view: "admin", section: "channels", channel: item.channel })}
                          onClick={(event) =>
                            navigate && plainClick(event) && navigate({ view: "admin", section: "channels", channel: item.channel })
                          }
                        >
                          {t("Configurar")}
                        </a>
                      )}
                    </span>
                  ))}
                </span>
              </p>
            )}
            <p className="admin-summary" role="status">
              <strong>{plural(data.total, "{0} registro", "{0} registros", formatNumber(data.total))}</strong>
              {counts.length > 0 && <span>{counts.join(" · ")}</span>}
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
                          <DeliveryStatus entry={entry} exact />
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

/** /api/admin/health: one read of the database, computed by backend/health.py. */
type QueryCounts = { ok: number; empty: number; error: number; blocked: number };
type QueryWindow = QueryCounts & { total: number; success_rate: number | null; p50_ms: number | null; p95_ms: number | null };
type TripRef = { id: string; title: string | null; route: string; owner_id: string | null };
type RouteStat = {
  route_key: string;
  direction: string;
  origin: string;
  destination: string;
  date: string;
  /** null once the trip was deleted: no link. */
  trip: TripRef | null;
  queries: number;
  p50_ms: number | null;
  p95_ms: number | null;
  failures: number;
  blocked: number;
  kind: SourceKind | null;
  last_failure_at: number | null;
};
type Worker = { alive: boolean; age_s: number | null; limit_s: number; late: boolean };
/** An incident of the watcher (backend/incidents.py): a reason code seen in two checks in a row, resolved after three without it. */
export type Incident = {
  id: number;
  code: string;
  level: "warning" | "critical";
  opened_at: number;
  updated_at: number;
  resolved_at: number | null;
  acknowledged_at: number | null;
  acknowledged_by: string | null;
  acknowledged_name: string | null;
  last_notified_at: number | null;
  notified_count: number;
  /** The last notice attempt: sent, held by quiet hours, not_notified (no channel) or disabled (notices off). */
  notice: "sent" | "held" | "not_notified" | "disabled" | null;
  /** When the first notice held by quiet hours goes out. */
  held_until?: number | null;
  /** Times it came back soon after resolving (no new notice then). */
  reopened?: number;
  details: Record<string, unknown>;
};
export type HealthMetrics = {
  generated_at: number;
  status: { level: "ok" | "warning" | "critical"; reasons: string[] };
  trips: { active: number; paused: number; ended: number; accounts: number };
  queries: { hour: QueryWindow; day: QueryWindow };
  series: (QueryCounts & { hour_start: number; p50_ms: number | null })[];
  cycles: { count: number; avg_s: number | null };
  freshness: { active: number; fresh: number; stalest: (TripRef & { age_s: number; last_at: number | null }) | null };
  queue: { due: number; max_delay_s: number | null };
  source: (SourceStatus & { paused_since: number | null }) | null;
  workers: Record<string, Worker>;
  slow_routes: RouteStat[];
  failing_routes: RouteStat[];
  empty_trips: (TripRef & { cycles: number; since: number | null })[];
  channels?: Record<string, { available: boolean; failed_streak: number; last_failure_at: number | null }>;
  /** Open ones first, then the last 20 resolved. */
  incidents: Incident[];
  settings: { notices: boolean; digest?: boolean; canary?: { enabled: boolean; origin: string; destination: string } };
  canary?: {
    enabled: boolean;
    origin: string;
    destination: string;
    last: CanaryResult | null;
    /** Oldest first, at most 12. */
    history: CanaryResult[];
    failed_streak: number;
    day: { total: number; success_rate: number | null; mean_ms: number | null };
    next_at: number | null;
  };
  /** Measured over the last 15 min (queries, response) and the last hour (interval); null without data. */
  pace?: {
    per_min: number | null;
    limit_per_min: number;
    p50_ms: number | null;
    p95_ms: number | null;
    interval_s: number | null;
    target_s: number;
  };
};
type CanaryResult = { at: number; status: "ok" | "empty" | "error" | "blocked"; kind: string | null; duration_ms: number };
const outcomes = ["ok", "empty", "error", "blocked"] as const;
const outcomeLabels = (): Record<(typeof outcomes)[number], string> => ({
  ok: t("Com resultado"),
  empty: t("Sem resultado"),
  error: t("Erro"),
  blocked: t("Bloqueio"),
});
const failureKinds = (): Record<string, string> => ({
  rate_limited: t("Limite da fonte"),
  blocked: t("Bloqueio"),
  timeout: t("Tempo esgotado"),
  network: t("Falha de rede"),
  server: t("Fonte indisponível"),
  format: t("Formato alterado"),
  no_results: t("Resposta sem voos"),
  unknown: t("Falha desconhecida"),
});
/** Milliseconds: "850 ms", "4,1 s". */
const millis = (ms: number | null | undefined) =>
  ms == null ? "—" : ms < 1000 ? t("{0} ms", [formatNumber(ms)]) : t("{0} s", [formatNumber(ms / 1000, 1)]);
/** A translated sentence whose {0} is an element (a bold number), placed where each language puts it. */
function withValue(key: string, value: ReactNode, values: unknown[] = []) {
  const [before, after = ""] = t(key, ["\u0000", ...values]).split("\u0000");
  return (
    <>
      {before}
      {value}
      {after}
    </>
  );
}
/** Trips refreshed this much slower than the target tint the pace's interval line. */
const PACE_SLOW = 1.2;
/** Seconds: "45 s", "12 min", "2 h 5 min". */
const lasting = (seconds: number | null | undefined) =>
  seconds == null ? "—" : seconds < 60 ? t("{0} s", [formatNumber(Math.max(0, seconds))]) : formatDuration(seconds / 60);
const tripName = (trip: TripRef) => trip.title || trip.route;
/** Where the administration shows a trip: its owner's read-only monitoring page. */
const tripRoute = (trip: TripRef | null): AppRoute | null =>
  trip?.owner_id ? { view: "admin", section: "users", userId: trip.owner_id, userAction: "monitorings", monitorId: trip.id } : null;

/** The reason codes of health.assess, worded with the metrics behind them. */
function reasonText(code: string, m: HealthMetrics): string {
  const hour = m.queries.hour,
    collector = m.workers.collector;
  switch (code) {
    case "source_paused":
      return t("A fonte de tarifas está pausada há {0}.", [lasting(m.generated_at - (m.source?.paused_since ?? m.generated_at))]);
    case "collector_late":
      return !collector?.alive
        ? t("O coletor de tarifas parou.")
        : t("O coletor de tarifas está sem sinal há {0} (limite: {1}).", [lasting(collector.age_s), lasting(collector.limit_s)]);
    case "whatsapp_late": {
      const worker = m.workers.whatsapp_sender;
      return !worker?.alive
        ? t("O envio de WhatsApp parou.")
        : t("O envio de WhatsApp está sem sinal há {0} (limite: {1}).", [lasting(worker.age_s), lasting(worker.limit_s)]);
    }
    case "email_late": {
      const worker = m.workers.email_sender;
      return !worker?.alive
        ? t("O envio de e-mail parou.")
        : t("O envio de e-mail está sem sinal há {0} (limite: {1}).", [lasting(worker.age_s), lasting(worker.limit_s)]);
    }
    case "source_canary":
      return t("A rota de controle {0} falhou nas últimas {1} consultas.", [
        m.canary ? `${m.canary.origin} → ${m.canary.destination}` : "",
        formatNumber(m.canary?.failed_streak ?? 0),
      ]);
    case "whatsapp_failing":
      return t("As últimas {0} mensagens de WhatsApp falharam.", [formatNumber(m.channels?.whatsapp?.failed_streak ?? 0)]);
    case "email_failing":
      return t("Os últimos {0} e-mails falharam.", [formatNumber(m.channels?.email?.failed_streak ?? 0)]);
    case "error_rate":
      return t("{0} das consultas da última hora falharam ({1} de {2}).", [
        formatPercent((hour.error + hour.blocked) / hour.total),
        formatNumber(hour.error + hour.blocked),
        formatNumber(hour.total),
      ]);
    case "queue_delay":
      return t("Uma viagem espera na fila de coletas há {0}.", [lasting(m.queue.max_delay_s)]);
    case "stale_trip":
      return m.freshness.stalest
        ? t("“{0}” está sem coleta há {1}.", [tripName(m.freshness.stalest), lasting(m.freshness.stalest.age_s)])
        : t("Há uma viagem ativa sem coleta há mais de uma hora.");
    default:
      return code;
  }
}

/** Queries per hour, stacked by outcome, and the median response time as a line. */
function QueryChart({ series }: { series: HealthMetrics["series"] }) {
  const labels = outcomeLabels();
  const totals = series.map((b) => b.ok + b.empty + b.error + b.blocked);
  const sums = Object.fromEntries(outcomes.map((key) => [key, series.reduce((sum, b) => sum + b[key], 0)])) as QueryCounts;
  const all = totals.reduce((sum, value) => sum + value, 0);
  const peak = Math.max(1, ...totals);
  const medians = series.map((b) => b.p50_ms).filter((value): value is number => value != null);
  const slowest = Math.max(1, ...medians);
  // viewBox units: 10 per hour, 100 high; the plot stretches to the card.
  const segments: string[][] = [[]];
  series.forEach((b, i) => {
    if (b.p50_ms == null) {
      if (segments[segments.length - 1].length) segments.push([]);
      return;
    }
    const y = (96 - (b.p50_ms / slowest) * 88).toFixed(1);
    segments[segments.length - 1].push(...(series[i - 1]?.p50_ms == null && series[i + 1]?.p50_ms == null ? [`${i * 10 + 2},${y}`, `${i * 10 + 8},${y}`] : [`${i * 10 + 5},${y}`]));
  });
  const lines = segments.filter((points) => points.length).map((points) => points.join(" "));
  const summary = t("Consultas por hora nas últimas 24 horas: {0} no total, {1} com resultado, {2} sem resultado, {3} com erro e {4} bloqueadas. Pico de {5} por hora; mediana de resposta de até {6}.", [
    formatNumber(all),
    formatNumber(sums.ok),
    formatNumber(sums.empty),
    formatNumber(sums.error),
    formatNumber(sums.blocked),
    formatNumber(peak),
    millis(medians.length ? slowest : null),
  ]);
  if (!all) return <p className="admin-footnote">{t("Nenhuma consulta à fonte nas últimas 24 horas.")}</p>;
  return (
    <figure className="health-chart">
      <svg className="health-chart-plot" viewBox="0 0 240 100" preserveAspectRatio="none" role="img" aria-label={summary}>
        {series.map((b, i) => {
          let top = 100;
          return outcomes.map((key) => {
            const height = (b[key] / peak) * 96;
            if (!height) return null;
            top -= height;
            return <rect key={key + i} className={"health-bar is-" + key} x={i * 10 + 1} y={top} width={8} height={height} />;
          });
        })}
        {lines.map((points) => (
          <polyline key={"halo" + points} className="health-latency-halo" points={points} />
        ))}
        {lines.map((points) => (
          <polyline key={points} className="health-latency" points={points} />
        ))}
      </svg>
      <div className="health-chart-axis" aria-hidden="true">
        {[0, 12, 23].map((i) => series[i] && <span key={i}>{formatTime(series[i].hour_start)}</span>)}
      </div>
      <figcaption>
        <ul className="health-legend">
          {outcomes.map((key) => (
            <li key={key}>
              <span className={"health-swatch is-" + key} aria-hidden="true" />
              {labels[key]} <strong>{formatNumber(sums[key])}</strong>
            </li>
          ))}
          <li>
            <span className="health-swatch is-latency" aria-hidden="true" />
            {t("Mediana de resposta")} <strong>{t("máx. {0}", [millis(medians.length ? slowest : null)])}</strong>
          </li>
        </ul>
        <p className="admin-footnote">{t("Barras: consultas por hora, até {0}. Linha: mediana do tempo de resposta.", [formatNumber(peak)])}</p>
      </figcaption>
    </figure>
  );
}

/** One row of a health list: a link to the trip's monitoring page when it still exists. */
function HealthRow({ trip, navigate, title, detail, value, note }: { trip: TripRef | null; navigate?: Navigate; title: string; detail: string; value: string; note?: string }) {
  const target = tripRoute(trip);
  const body = (
    <>
      <span className="health-row-text">
        <span className="health-row-title">{title}</span>
        <span className="health-row-detail">{detail}</span>
      </span>
      <span className="health-row-value">
        {value}
        {note && <small>{note}</small>}
      </span>
    </>
  );
  return target ? (
    <a className="list-row health-row" href={routePath(target)} onClick={(event) => navigate && plainClick(event) && navigate(target)}>
      {body}
    </a>
  ) : (
    <div className="list-row health-row">{body}</div>
  );
}

function HealthList({ id, title, footer, empty, children }: { id: string; title: string; footer: string; empty: string; children: ReactNode[] }) {
  return (
    <section className="list-section health-list" aria-labelledby={id}>
      <h2 className="list-section-title" id={id}>
        {title}
      </h2>
      {children.length ? <div className="list-group">{children}</div> : <p className="list-group health-list-empty">{empty}</p>}
      <p className="list-section-footer">{footer}</p>
    </section>
  );
}

const routeTitle = (r: RouteStat) =>
  `${r.origin} → ${r.destination} · ${formatDate(r.date, "short")}` + (r.direction === "inbound" ? " · " + t("volta") : "");
const routeDetail = (r: RouteStat) => (r.trip ? tripName(r.trip) : t("Viagem excluída"));

/** What the administrators were told about an open incident: the count of notices, or why there were none. */
function noticeText(incident: Incident): string {
  if (incident.notice === "disabled" && !incident.notified_count) return t("Não notificado: avisos de saúde desligados");
  if (incident.notice === "not_notified" && !incident.notified_count) return t("Não notificado: nenhum canal disponível");
  const count = plural(incident.notified_count, "{0} aviso enviado", "{0} avisos enviados", formatNumber(incident.notified_count));
  return incident.held_until
    ? count + " · " + t("o próximo sai às {0}, depois do horário silencioso", [formatTime(incident.held_until)])
    : count;
}

/** Saúde: collection health at a glance, refreshed every 30 seconds while the tab is open. */
function HealthPanel({ navigate, request }: { navigate?: Navigate; request: RequestFn }) {
  // Before the early returns: the hooks run on every render.
  const [pending, setPending] = useState<{ notices?: boolean; digest?: boolean; canary?: boolean; route?: boolean } | null>(null),
    [busyIncident, setBusyIncident] = useState<number | null>(null),
    [actionError, setActionError] = useState(""),
    [actionDone, setActionDone] = useState(""),
    [route, setRoute] = useState<{ origin: string; destination: string } | null>(null);
  // Reconhecer leaves the page with the incident: the focus goes to the list's heading.
  const openHeading = useRef<HTMLHeadingElement>(null);
  const query = useQuery<HealthMetrics>({
    queryKey: ["admin-health-metrics"],
    queryFn: ({ signal }) => read("/admin/health", signal),
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    staleTime: 15000,
  });
  const m = query.data;
  if (query.isError && !m) return <LoadError level={2} message={query.error.message} onRetry={() => void query.refetch()} />;
  if (!m)
    return (
      <div className="card">
        <TableSkeleton rows={6} />
      </div>
    );
  const { hour, day } = m.queries;
  const reasons = new Set(m.status.reasons);
  const level = {
    ok: { title: t("Saudável"), Icon: CheckCircle2 },
    warning: { title: t("Atenção"), Icon: TriangleAlert },
    critical: { title: t("Crítico"), Icon: OctagonAlert },
  }[m.status.level];
  const services: [string, string, LucideIcon][] = [
    ["collector", t("Coletor de tarifas"), Radar],
    ["email_sender", t("Envio de e-mail"), Mail],
    ["whatsapp_sender", t("Envio de WhatsApp"), MessageCircle],
    ["health_watcher", t("Vigilância de saúde"), HeartPulse],
  ].filter(([key]) => m.workers[key as string]) as [string, string, LucideIcon][];
  const incidents = m.incidents || [];
  const open = incidents.filter((incident) => incident.resolved_at == null),
    resolved = incidents.filter((incident) => incident.resolved_at != null);
  const notices = pending?.notices ?? m.settings?.notices ?? true,
    digest = pending?.digest ?? m.settings?.digest ?? false;
  const probe = m.canary,
    canaryOn = pending?.canary ?? probe?.enabled ?? true;
  /** One change of the health settings at a time; the controls stay focusable (aria-busy) and the result is announced. */
  async function saveSettings(changes: Record<string, unknown>, shown: NonNullable<typeof pending>, done: string) {
    if (pending) return;
    setPending(shown);
    setActionError("");
    setActionDone("");
    try {
      await request("/admin/health/settings", changes, "PUT");
      await query.refetch();
      setActionDone(done);
      if ("canary" in changes) setRoute(null);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setPending(null);
    }
  }
  async function acknowledge(id: number) {
    if (busyIncident !== null) return;
    setBusyIncident(id);
    setActionError("");
    setActionDone("");
    try {
      await request(`/admin/health/incidents/${id}/ack`, {}, "POST");
      await query.refetch();
      openHeading.current?.focus();
      setActionDone(t("Incidente reconhecido. Os lembretes foram encerrados."));
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusyIncident(null);
    }
  }
  const outcome = outcomeLabels();
  const draft = route ?? { origin: probe?.origin || "GRU", destination: probe?.destination || "REC" };
  const pace = m.pace;
  const slow = !!pace?.interval_s && pace.interval_s > PACE_SLOW * pace.target_s;
  return (
    <div className="admin-stack health">
      <section className="card admin-card" aria-labelledby="health-title">
        <header className="admin-card-heading">
          <div>
            <h2 id="health-title">{t("Saúde do radar")}</h2>
            <p>{t("Atualizado às {0} · atualização automática a cada 30 segundos.", [formatTime(m.generated_at)])}</p>
          </div>
          <div className="admin-card-actions">
            <Button variant="outline" size="small" onClick={() => void query.refetch()}>
              <RefreshCw size={15} aria-hidden="true" className={query.isFetching ? "spin" : undefined} />
              {t("Atualizar")}
            </Button>
          </div>
        </header>
        <label className="switch-row health-switch">
          <span>
            <strong>{t("Avisos de saúde")}</strong>
            <small>
              {notices
                ? t("Os administradores recebem os incidentes no WhatsApp e no e-mail do perfil.")
                : t("Desligados: os incidentes continuam registrados aqui, sem avisos.")}
            </small>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={notices}
            aria-busy={pending?.notices !== undefined || undefined}
            onChange={(event) =>
              void saveSettings({ notices: event.target.checked }, { notices: event.target.checked }, event.target.checked
                ? t("Avisos de saúde ligados.")
                : t("Avisos de saúde desligados. Os incidentes continuam registrados."))
            }
          />
        </label>
        <label className="switch-row health-switch">
          <span>
            <strong>{t("Resumo diário")}</strong>
            <small>{t("Às 08:00 no fuso de cada administrador: consultas, alertas, incidentes e rota de controle do dia anterior.")}</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={digest}
            aria-busy={pending?.digest !== undefined || undefined}
            onChange={(event) =>
              void saveSettings({ digest: event.target.checked }, { digest: event.target.checked }, event.target.checked
                ? t("Resumo diário ligado: sai às 08:00 no fuso de cada administrador.")
                : t("Resumo diário desligado."))
            }
          />
        </label>
        <div className={"health-banner is-" + m.status.level}>
          <level.Icon size={22} aria-hidden="true" />
          <div className="health-banner-text" role="status">
            <p className="health-banner-title">{level.title}</p>
            {m.status.reasons.length ? (
              <ul>
                {m.status.reasons.map((code) => (
                  <li key={code}>{reasonText(code, m)}</li>
                ))}
              </ul>
            ) : (
              <p>{t("Consultas, fila e serviços dentro dos limites.")}</p>
            )}
          </div>
        </div>
        {query.isError && <p className="admin-footnote">{t("Não foi possível atualizar agora. Os dados mostrados são das {0}.", [formatTime(m.generated_at)])}</p>}
        <dl className="admin-stats health-tiles">
          <div>
            <dt>{t("Viagens ativas")}</dt>
            <dd>
              {formatNumber(m.trips.active)}
              <small>
                {plural(m.trips.accounts, "em {0} conta", "em {0} contas", formatNumber(m.trips.accounts))} ·{" "}
                {t("{0} em pausa", [formatNumber(m.trips.paused)])}
              </small>
            </dd>
          </div>
          <div>
            <dt>{t("Consultas em 1 h")}</dt>
            <dd>
              {formatNumber(hour.total)}
              <small>{t("{0} em 24 h", [formatNumber(day.total)])}</small>
            </dd>
          </div>
          <div className={reasons.has("error_rate") ? "is-warning" : undefined}>
            <dt>{t("Taxa de sucesso")}</dt>
            <dd>
              {formatPercent(hour.success_rate)}
              <small>{hour.total ? t("24 h: {0}", [formatPercent(day.success_rate)]) : t("Sem consultas na última hora")}</small>
            </dd>
          </div>
          <div>
            <dt>{t("Resposta (p95)")}</dt>
            <dd>
              {millis(hour.p95_ms)}
              <small>{t("mediana {0} na última hora", [millis(hour.p50_ms)])}</small>
            </dd>
          </div>
          <div className={reasons.has("stale_trip") ? "is-warning" : undefined}>
            <dt>{t("Viagens atualizadas")}</dt>
            <dd>
              {t("{0} de {1}", [formatNumber(m.freshness.fresh), formatNumber(m.freshness.active)])}
              <small>
                {m.freshness.stalest
                  ? t("nos últimos 10 min · mais antiga há {0}", [lasting(m.freshness.stalest.age_s)])
                  : t("nos últimos 10 min")}
              </small>
            </dd>
          </div>
          <div className={reasons.has("queue_delay") ? "is-warning" : undefined}>
            <dt>{t("Atraso da fila")}</dt>
            <dd>
              {m.queue.max_delay_s ? lasting(m.queue.max_delay_s) : t("Sem atraso")}
              <small>{plural(m.queue.due, "{0} viagem aguardando coleta", "{0} viagens aguardando coleta", formatNumber(m.queue.due))}</small>
            </dd>
          </div>
        </dl>
      </section>
      <Notice tone="error" onDismiss={() => setActionError("")}>
        {actionError}
      </Notice>
      <Notice onDismiss={() => setActionDone("")}>{actionDone}</Notice>
      <section className="list-section health-list" aria-labelledby="health-open-title">
        <h2 className="list-section-title" id="health-open-title" ref={openHeading} tabIndex={-1}>
          {t("Incidentes abertos")}
        </h2>
        {open.length ? (
          <div className="list-group">
            {open.map((incident) => (
              <div key={incident.id} className="list-row health-row health-incident">
                <span className={clsx("status-pill", incident.level === "critical" ? "is-danger" : "is-warning")}>
                  {incident.level === "critical" ? t("Crítico") : t("Atenção")}
                </span>
                <span className="health-row-text">
                  <span className="health-row-title">{healthCodeLabel(incident.code)}</span>
                  <span className="health-row-detail">
                    {t("Desde {0} · há {1}", [formatDateTimeCompact(incident.opened_at), lasting(m.generated_at - incident.opened_at)])}
                  </span>
                  <span className="health-row-detail">{noticeText(incident)}</span>
                </span>
                {incident.acknowledged_at ? (
                  <span className="health-row-value">
                    {t("Reconhecido")}
                    <small>
                      {incident.acknowledged_name
                        ? t("por {0} às {1}", [incident.acknowledged_name, formatTime(incident.acknowledged_at)])
                        : t("às {0}", [formatTime(incident.acknowledged_at)])}
                    </small>
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    size="small"
                    aria-busy={busyIncident === incident.id || undefined}
                    aria-label={t("Reconhecer: {0}", [healthCodeLabel(incident.code)])}
                    onClick={() => void acknowledge(incident.id)}
                  >
                    {t("Reconhecer")}
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="list-group health-list-empty">{t("Nenhum incidente aberto.")}</p>
        )}
        <p className="list-section-footer">
          {t("Um incidente abre quando o problema aparece em duas verificações seguidas e fecha após três sem ele. Reconhecer encerra os lembretes.")}
        </p>
      </section>
      <section className="card admin-card" aria-labelledby="health-chart-title">
        <header className="admin-card-heading">
          <div>
            <h2 id="health-chart-title">{t("Consultas nas últimas 24 horas")}</h2>
            <p>{t("Cada barra é uma hora; a última é a hora atual.")}</p>
          </div>
        </header>
        <QueryChart series={m.series} />
      </section>
      <div className="health-grid">
        <SourceCard fallback={m.source} now={m.generated_at} />
        <section className="list-section health-list" aria-labelledby="health-services-title">
          <h2 className="list-section-title" id="health-services-title">
            {t("Serviços")}
          </h2>
          <div className="list-group">
            {services.map(([key, label, Icon]) => {
              const worker = m.workers[key];
              return (
                <div key={key} className="list-row health-row">
                  <span className="admin-channel-icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <span className="health-row-text">
                    <span className="health-row-title">{label}</span>
                    <span className="health-row-detail">
                      {worker?.age_s == null ? t("Sem sinal ainda") : t("Último sinal há {0}", [lasting(worker.age_s)])}
                    </span>
                  </span>
                  <span className={clsx("status-pill", !worker?.alive ? "is-danger" : worker.late ? "is-warning" : "is-active")}>
                    {!worker?.alive ? t("Parado") : worker.late ? t("Atrasado") : t("Ativo")}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="list-section-footer">
            {plural(m.cycles.count, "{0} ciclo de coleta em 24 h", "{0} ciclos de coleta em 24 h", formatNumber(m.cycles.count))}
            {m.cycles.avg_s != null && " · " + t("duração média {0}", [lasting(m.cycles.avg_s)])}
          </p>
        </section>
      </div>
      <div className="health-grid">
        {probe && (
          <section className="card admin-card canary-card" aria-labelledby="canary-title">
            <header className="admin-card-heading">
              <div>
                <div className="admin-card-title">
                  <h2 id="canary-title">{t("Rota de controle")}</h2>
                  <InfoTip label={t("Sobre a rota de controle")}>
                    <p>{t("Uma consulta fixa a cada 30 minutos mede a fonte mesmo sem viagens: um adulto, classe econômica, 30 dias à frente.")}</p>
                    <p>{t("Ela passa pela mesma fila e pela mesma proteção das viagens: não roda com a fonte pausada e uma falha conta como falha da fonte.")}</p>
                  </InfoTip>
                </div>
                <p>
                  {probe.enabled
                    ? t("{0} → {1} · a cada 30 minutos", [probe.origin, probe.destination])
                    : t("Desligada: a fonte é medida só pelas viagens.")}
                </p>
              </div>
              {probe.last && (
                <span className={clsx("status-pill", probe.last.status === "ok" ? "is-active" : probe.last.status === "empty" ? "is-paused" : probe.last.status === "blocked" ? "is-danger" : "is-warning")}>
                  {outcome[probe.last.status]}
                </span>
              )}
            </header>
            <dl className="admin-stats canary-stats">
              <div>
                <dt>{t("Último resultado")}</dt>
                <dd>
                  {probe.last ? outcome[probe.last.status] : t("Nenhum ainda")}
                  {probe.last && <small>{formatRelative(probe.last.at, m.generated_at)}</small>}
                </dd>
              </div>
              <div>
                <dt>{t("Latência média (24 h)")}</dt>
                <dd>{millis(probe.day.mean_ms)}</dd>
              </div>
              <div>
                <dt>{t("Sucesso (24 h)")}</dt>
                <dd>
                  {formatPercent(probe.day.success_rate)}
                  <small>{plural(probe.day.total, "{0} consulta", "{0} consultas", formatNumber(probe.day.total))}</small>
                </dd>
              </div>
            </dl>
            {probe.history.length > 0 && (
              <div
                className="canary-dots"
                role="img"
                aria-label={t("Últimos {0} resultados, do mais antigo ao mais recente: {1}.", [
                  formatNumber(probe.history.length),
                  probe.history.map((item) => outcome[item.status].toLowerCase()).join(", "),
                ])}
              >
                {probe.history.map((item) => (
                  <span key={item.at} className={"canary-dot is-" + item.status} title={outcome[item.status] + " · " + formatTime(item.at)} />
                ))}
              </div>
            )}
            <details className="admin-disclosure">
              <summary>
                <span>{t("Configurar a rota de controle")}</span>
              </summary>
              <div className="admin-disclosure-body">
                <label className="switch-row">
                  <span>{t("Consultar a rota de controle")}</span>
                  <input
                    type="checkbox"
                    role="switch"
                    className="switch"
                    checked={canaryOn}
                    aria-busy={pending?.canary !== undefined || undefined}
                    onChange={(event) =>
                      void saveSettings({ canary: { enabled: event.target.checked } }, { canary: event.target.checked }, event.target.checked
                        ? t("Rota de controle ligada.")
                        : t("Rota de controle desligada."))
                    }
                  />
                </label>
                <form
                  className="canary-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveSettings({ canary: draft }, { route: true }, t("Rota de controle salva: {0} → {1}.", [draft.origin, draft.destination]));
                  }}
                >
                  {(["origin", "destination"] as const).map((key) => (
                    <label key={key} className="field">
                      <span className="field-label">{key === "origin" ? t("Origem (IATA)") : t("Destino (IATA)")}</span>
                      <input
                        required
                        maxLength={3}
                        minLength={3}
                        autoCapitalize="characters"
                        spellCheck={false}
                        value={draft[key]}
                        onChange={(event) => setRoute({ ...draft, [key]: event.target.value.toUpperCase() })}
                      />
                    </label>
                  ))}
                  <Button type="submit" variant="outline" aria-busy={pending?.route || undefined}>
                    {t("Salvar rota")}
                  </Button>
                </form>
              </div>
            </details>
          </section>
        )}
        {pace && (
          <section className="card admin-card pace-card" aria-labelledby="pace-title">
            <header className="admin-card-heading">
              <div>
                <div className="admin-card-title">
                  <h2 id="pace-title">{t("Ritmo")}</h2>
                  <InfoTip label={t("Sobre o ritmo")}>
                    <p>
                      {t("Consultas por minuto: quantas consultas foram de fato enviadas à fonte nos últimos 15 minutos, com a rota de controle. O limite de {0} por minuto (uma nova consulta a cada {1}) é uma proteção contra bloqueios da fonte.", [
                        formatNumber(pace.limit_per_min, 1),
                        lasting(60 / pace.limit_per_min),
                      ])}
                    </p>
                    <p>{t("Resposta: quanto a fonte levou para responder nos últimos 15 minutos, na mediana e no p95. Um tempo alto significa que a fonte está lenta.")}</p>
                    <p>{t("Intervalo: de quanto em quanto tempo cada viagem ativa foi de fato atualizada na última hora. Acima da meta, as viagens estão demorando mais para atualizar.")}</p>
                  </InfoTip>
                </div>
                <p>{t("Medido nos últimos 15 minutos e, o intervalo, na última hora.")}</p>
              </div>
            </header>
            <p className="pace-line">
              {withValue("{0} consultas por minuto", <strong>{(pace.per_min == null ? "—" : formatNumber(pace.per_min, 1)) + " / " + formatNumber(pace.limit_per_min, 1)}</strong>)}
            </p>
            <div className="pace-bar" aria-hidden="true">
              <span style={{ width: Math.min(100, Math.round((100 * (pace.per_min || 0)) / pace.limit_per_min)) + "%" }} />
            </div>
            <p className="pace-line">{withValue("Resposta {0} · p95 {1}", <strong>{millis(pace.p50_ms)}</strong>, [millis(pace.p95_ms)])}</p>
            <p className={clsx("pace-line", slow && "is-warning")}>
              {slow && <TriangleAlert size={15} aria-hidden="true" />}
              {pace.interval_s == null
                ? t("Intervalo das viagens: ainda sem dois ciclos de uma mesma viagem na última hora.")
                : withValue("Viagens atualizadas a cada {0} (meta: {1})", <strong>{lasting(pace.interval_s)}</strong>, [lasting(pace.target_s)])}
              {slow && <span className="sr-only"> · {t("acima da meta")}</span>}
            </p>
          </section>
        )}
      </div>
      <div className="health-grid">
        <HealthList
          id="health-slow-title"
          title={t("Rotas mais lentas")}
          footer={t("Pela mediana do tempo de resposta nas últimas 24 horas.")}
          empty={t("Nenhuma consulta nas últimas 24 horas.")}
        >
          {m.slow_routes.map((r) => (
            <HealthRow
              key={[r.trip?.id, r.direction, r.origin, r.destination, r.date].join("|")}
              trip={r.trip}
              navigate={navigate}
              title={routeTitle(r)}
              detail={routeDetail(r)}
              value={t("mediana {0}", [millis(r.p50_ms)])}
              note={t("p95 {0} · {1}", [millis(r.p95_ms), plural(r.queries, "{0} consulta", "{0} consultas", formatNumber(r.queries))])}
            />
          ))}
        </HealthList>
        <HealthList
          id="health-failing-title"
          title={t("Rotas com falhas")}
          footer={t("Erros e bloqueios nas últimas 24 horas.")}
          empty={t("Nenhuma falha nas últimas 24 horas.")}
        >
          {m.failing_routes.map((r) => (
            <HealthRow
              key={[r.trip?.id, r.direction, r.origin, r.destination, r.date].join("|")}
              trip={r.trip}
              navigate={navigate}
              title={routeTitle(r)}
              detail={routeDetail(r)}
              value={t("{0} de {1}", [formatNumber(r.failures), formatNumber(r.queries)])}
              note={failureKinds()[r.kind || "unknown"] || failureKinds().unknown}
            />
          ))}
        </HealthList>
        <HealthList
          id="health-empty-title"
          title={t("Viagens sem resultado")}
          footer={t("Viagens ativas com resposta da fonte desde a última edição, mas sem nenhum preço completo para comparar.")}
          empty={t("Todas as viagens consultadas têm preço.")}
        >
          {m.empty_trips.map((trip) => (
            <HealthRow
              key={trip.id}
              trip={trip}
              navigate={navigate}
              title={tripName(trip)}
              detail={trip.title ? trip.route : ""}
              value={plural(trip.cycles, "{0} ciclo sem preço", "{0} ciclos sem preço", formatNumber(trip.cycles))}
              note={trip.since ? t("desde {0}", [formatDateTimeCompact(trip.since)]) : undefined}
            />
          ))}
        </HealthList>
      </div>
      <section className="list-section health-list" aria-labelledby="health-history-title">
        <h2 className="list-section-title" id="health-history-title">
          {t("Histórico")}
        </h2>
        {resolved.length ? (
          <div className="list-group">
            {resolved.map((incident) => (
              <div key={incident.id} className="list-row health-row">
                <span className="health-row-text">
                  <span className="health-row-title">{healthCodeLabel(incident.code)}</span>
                  <span className="health-row-detail">
                    {t("Resolvido em {0} · durou {1}", [formatDateTimeCompact(incident.resolved_at!), lasting(incident.resolved_at! - incident.opened_at)])}
                  </span>
                </span>
                <span className="health-row-value">
                  {incident.level === "critical" ? t("Crítico") : t("Atenção")}
                  <small>{plural(incident.notified_count, "{0} aviso", "{0} avisos", formatNumber(incident.notified_count))}</small>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="list-group health-list-empty">{t("Nenhum incidente resolvido ainda.")}</p>
        )}
        <p className="list-section-footer">{t("Os últimos 20 incidentes resolvidos.")}</p>
      </section>
    </div>
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
  const [localTab, setLocalTab] = useState<Section>("health"),
    [localChannel, setLocalChannel] = useState("whatsapp"),
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
    ["health", t("Saúde")],
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
      {!task && <AdminNotices userId={userId} navigate={navigate} />}
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
            available={{ email: !!mail?.available, whatsapp: whatsappAvailable }}
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
        {tab === "health" && <HealthPanel navigate={navigate} request={request} />}
        {tab === "channels" && (
          <div className="admin-channels">
            <nav className="list-section channel-nav" aria-labelledby="channel-nav-title">
              <h2 className="list-section-title" id="channel-nav-title">
                {t("Canais de envio")}
              </h2>
              <div className="list-group">
                {[
                  {
                    key: "whatsapp",
                    label: "WhatsApp",
                    icon: MessageCircle,
                    detail: whatsappAvailable ? t("Envios habilitados") : t("Não configurado"),
                    on: whatsappAvailable,
                  },
                  { key: "email", label: t("E-mail"), icon: Mail, detail: email.detail, on: email.active },
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
              </div>
            </nav>
            <div className="channel-detail">
              {channel === "email" ? (
                <EmailChannel mail={mail} request={request} onChanged={onChanged} />
              ) : (
                <WhatsAppPanel request={request} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
