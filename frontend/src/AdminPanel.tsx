import { TaskPage } from "./TaskPage";
import type { AppRoute, Navigate } from "./navigation";
import { WhatsAppPanel } from "./WhatsAppPanel";
import { AdminUsers } from "./AdminUsers";
import "./admin.css";
import { useState, type ReactNode, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Mail,
  MessageCircle,
  Send,
  Trash2,
  Eye,
} from "lucide-react";
import { t, getLocale } from "./i18n";
import { Button, Card, Modal } from "./ui";
import { AuditPanel } from "./AuditPanel";

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
  owner_id?: string | null;
};
type LogPage = {
  items: Entry[];
  total: number;
  page_size: number;
  totals: Record<string, number>;
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
};
const date = (n: number | null) =>
  n
    ? new Date(n * 1000).toLocaleString(getLocale(), {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
const day = (n: number) => {
  const d = new Date(n * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const statuses = (): Record<string, string> => ({
  sent: t("Aceito pelo provedor"),
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
async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch("/api" + path, { cache: "no-store", signal });
  if (!r.ok) {
    const e = await r.json();
    throw Error(
      typeof e.detail === "string"
        ? t(e.detail)
        : t("Não foi possível carregar os registros."),
    );
  }
  return r.json();
}
function tabKeys(e: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  const tabs = Array.from(
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  );
  const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
  const n =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? tabs.length - 1
        : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  e.preventDefault();
  tabs[n]?.focus();
  tabs[n]?.click();
}
function Badge({ status }: { status: string }) {
  return (
    <span
      className={`delivery-badge ${status === "sent" ? "success" : ["failed", "uncertain", "waiting_contact", "waiting_service"].includes(status) ? "delivery-warning" : ""}`}
    >
      {statuses()[status] || status}
    </span>
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
    staleTime: 0,
  });
  const entry = query.data;
  return (
    <TaskPage
      onBack={onClose}
      title={t("Detalhes do envio")}
      description={t("Conteúdo registrado e resultado da tentativa de envio.")}
      className="delivery-detail"
    >
      {query.isError ? (
        <p role="alert" className="form-error">
          {query.error.message}
        </p>
      ) : !entry ? (
        <p role="status">{t("Carregando…")}</p>
      ) : (
        <>
          <div className="admin-detail-heading">
            <strong>{entry.subject}</strong>
            <Badge status={entry.status} />
          </div>
          <dl className="admin-metadata">
            <div>
              <dt>{t("Usuário")}</dt>
              <dd>
                {entry.account_name || t("Não identificado")}
                <small>{entry.login}</small>
              </dd>
            </div>
            <div>
              <dt>{t("Destinatários")}</dt>
              <dd>{entry.recipients.join(", ") || "—"}</dd>
            </div>
            <div>
              <dt>{t("Canal / serviço")}</dt>
              <dd>
                {channels()[entry.channel] || entry.channel} ·{" "}
                {entry.provider === "google"
                  ? "Gmail"
                  : entry.provider === "smtp"
                    ? "SMTP"
                    : entry.provider === "openwa"
                      ? "OpenWA"
                      : entry.provider || t("Não registrado")}
              </dd>
            </div>
            <div>
              <dt>{t("Tipo")}</dt>
              <dd>{kinds()[entry.kind] || entry.kind}</dd>
            </div>
            <div>
              <dt>{t("Solicitado em")}</dt>
              <dd>{date(entry.created)}</dd>
            </div>
            <div>
              <dt>{t("Concluído em")}</dt>
              <dd>{date(entry.completed)}</dd>
            </div>
            <div>
              <dt>{t("Tentativas")}</dt>
              <dd>{entry.attempts}</dd>
            </div>
          </dl>
          {entry.status === "waiting_contact" && <p className="help">{t("Cadastre um contato para receber os próximos alertas. Este registro não será reenviado.")}</p>}
          {["waiting_contact", "waiting_service"].includes(entry.status) && navigate && <Button variant="outline" onClick={() => entry.status === "waiting_contact" && entry.owner_id ? navigate({view: "admin", section: "users", userAction: "edit", userId: entry.owner_id}) : navigate({view: "admin", section: "channels", channel: entry.channel})}>{entry.status === "waiting_contact" ? t("Corrigir contato") : t("Configurar canal")}</Button>}
          {entry.error && (
            <p className="form-error" role="alert">
              {t(entry.error)}
            </p>
          )}
          {entry.provider_message_id && (
            <p className="help">
              {t("ID no integrador: {0}", [entry.provider_message_id])}
            </p>
          )}
          <h3>{t("Mensagem")}</h3>
          {entry.content_protected ? (
            <p className="help">
              {t(
                "Conteúdo protegido: mensagens de recuperação de acesso não exibem links de segurança.",
              )}
            </p>
          ) : (
            <pre className="admin-message">{entry.body}</pre>
          )}
          <p className="help">
            {t(
              "Aceito pelo provedor não confirma entrega na caixa de entrada ou leitura pelo destinatário.",
            )}
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
}: {
  onCleanup: () => void;
  route?: AppRoute;
  navigate?: Navigate;
}) {
  const [draft, setDraft] = useState({
      channel: "all",
      status: "all",
      user: "",
      q: "",
      start: "",
      end: "",
    }),
    [filters, setFilters] = useState(draft),
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
  });
  const data = query.data;
  const refresh = () => {
    setPage(0);
    setAnchor(Date.now() / 1000);
  };
  if (selected)
    return <LogDetail id={selected} onClose={() => setSelected(null)} navigate={navigate} />;
  return (
    <Card className="admin-log">
      <div className="section-heading">
        <div>
          <h2>{t("Atividade de envio")}</h2>
          <p>
            {t(
              "Consulte destinatários, resultados e o conteúdo de cada mensagem.",
            )}
          </p>
        </div>
        <Button variant="ghost" onClick={onCleanup}>
          <Trash2 size={15} />
          {t("Limpar logs")}
        </Button>
        <Button variant="outline" onClick={refresh} disabled={query.isFetching}>
          <RefreshCw size={15} />
          {t("Atualizar")}
        </Button>
      </div>
      <details className="admin-filter-panel">
        <summary>
          {t("Filtrar envios")}
          <span>
            {[
              filters.channel !== "all",
              filters.status !== "all",
              filters.user,
              filters.q,
              filters.start,
              filters.end,
            ].filter(Boolean).length || ""}
          </span>
        </summary>
        <form
          className="admin-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setFilters({ ...draft });
            refresh();
            const panel = e.currentTarget.closest("details");
            if (panel) panel.open = false;
          }}
        >
          <label>
            {t("Canal")}
            <select
              value={draft.channel}
              onChange={(e) => setDraft({ ...draft, channel: e.target.value })}
            >
              {Object.entries(channels()).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Situação")}
            <select
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value })}
            >
              <option value="all">{t("Todas as situações")}</option>
              <option value="sent">{t("Aceito pelo provedor")}</option>
              <option value="pending">{t("Na fila / enviando")}</option>
              <option value="failed">{t("Problemas e bloqueios")}</option>
              <option value="blocked">{t("Bloqueados por configuração")}</option>
              <option value="closed">
                {t("Cancelado / expirado / silenciado")}
              </option>
            </select>
          </label>
          <label>
            {t("Usuário")}
            <input
              type="search"
              maxLength={120}
              placeholder={t("Nome ou login")}
              value={draft.user}
              onChange={(e) => setDraft({ ...draft, user: e.target.value })}
            />
          </label>
          <label>
            {t("Mensagem ou destinatário")}
            <input
              type="search"
              maxLength={200}
              value={draft.q}
              onChange={(e) => setDraft({ ...draft, q: e.target.value })}
            />
          </label>
          <label>
            {t("De")}
            <input
              type="date"
              value={draft.start}
              max={draft.end || undefined}
              onChange={(e) => setDraft({ ...draft, start: e.target.value })}
            />
          </label>
          <label>
            {t("Até")}
            <input
              type="date"
              value={draft.end}
              min={draft.start || undefined}
              onChange={(e) => setDraft({ ...draft, end: e.target.value })}
            />
          </label>
          <div className="admin-filter-actions">
            <Button type="submit" size="large" disabled={query.isFetching}>
              {t("Consultar")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                const empty = {
                  channel: "all",
                  status: "all",
                  user: "",
                  q: "",
                  start: "",
                  end: "",
                };
                setDraft(empty);
                setFilters(empty);
                refresh();
              }}
            >
              {t("Limpar filtros")}
            </Button>
          </div>
        </form>
      </details>
      {query.isError ? (
        <p role="alert" className="form-error">
          {query.error.message}
        </p>
      ) : !data ? (
        <p role="status">{t("Carregando…")}</p>
      ) : (
        <>
          <div className="admin-log-summary" role="status">
            <strong>{t("{0} registros", [data.total])}</strong>
            <span>
              {t("{0} aceitos · {1} pendentes · {2} para verificar", [
                data.totals.sent || 0,
                (data.totals.pending || 0) + (data.totals.sending || 0),
                (data.totals.failed || 0) + (data.totals.uncertain || 0) + (data.totals.waiting_contact || 0) + (data.totals.waiting_service || 0),
              ])}
            </span>
          </div>
          <div className="admin-log-scroll table-scroll">
            <table className="admin-log-table">
              <thead>
                <tr>
                  <th>{t("Data e hora")}</th>
                  <th>{t("Usuário / destinatário")}</th>
                  <th>{t("Mensagem")}</th>
                  <th>{t("Canal")}</th>
                  <th>{t("Situação")}</th>
                  <th>
                    <span className="sr-only">{t("Detalhes")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((entry) => (
                  <tr key={entry.id}>
                    <td>{date(entry.created)}</td>
                    <td>
                      <strong>
                        {entry.account_name || t("Não identificado")}
                      </strong>
                      <small title={entry.recipients.join(", ")}>
                        {entry.recipients.join(", ") || entry.login || "—"}
                      </small>
                    </td>
                    <td>
                      <span className="admin-subject" title={entry.subject}>
                        {entry.subject}
                      </span>
                      <small>{kinds()[entry.kind] || entry.kind}</small>
                    </td>
                    <td>{channels()[entry.channel] || entry.channel}</td>
                    <td>
                      <Badge status={entry.status} />
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        onClick={() => setSelected(entry.id)}
                        aria-label={t("Ver envio: {0}", [entry.subject])}
                      >
                        <Eye size={16} />
                        <span>{t("Ver")}</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.items.length && (
              <p className="small-empty">
                {t("Nenhum envio encontrado com estes filtros.")}
              </p>
            )}
          </div>
          <div className="admin-pagination">
            <small>
              {t("Página {0} de {1}", [
                page + 1,
                Math.max(1, Math.ceil(data.total / data.page_size)),
              ])}{" "}
              · {t("Consulta atualizada em {0}", [date(anchor)])}
            </small>
            <div>
              <Button
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
                aria-label={t("Página anterior")}
              >
                <ChevronLeft size={16} />
              </Button>
              <Button
                variant="outline"
                disabled={(page + 1) * data.page_size >= data.total}
                onClick={() => setPage(page + 1)}
                aria-label={t("Próxima página")}
              >
                <ChevronRight size={16} />
              </Button>
            </div>
          </div>
          <p className="help">
            {t(
              "A consulta mantém um recorte estável. Use Atualizar para incluir novos envios.",
            )}
          </p>
        </>
      )}
    </Card>
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
    [policyDays, setPolicyDays] = useState(""),
    [before, setBefore] = useState(""),
    [mode, setMode] = useState("before"),
    [plan, setPlan] = useState<Plan | null>(null),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
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
  async function savePolicy(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    resetPlan();
    try {
      await request(
        "/admin/delivery-retention",
        { scope, days: Number(policyDays || query.data?.days) },
        "PUT",
      );
      await cache.invalidateQueries({ queryKey: ["delivery-retention"] });
      setMessage(
        t(
          "Retenção salva. A nova regra será aplicada nas verificações automáticas.",
        ),
      );
    } catch (e) {
      setError(t((e as Error).message));
    } finally {
      setBusy(false);
    }
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
        t("{0} registros removidos.", [result.removed]) +
          (result.has_more
            ? " " +
              t("Há mais registros. Consulte uma nova prévia para continuar.")
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
  return (
    <Card className="admin-retention">
      <h2>{t("Retenção e limpeza")}</h2>
      <label className="admin-log-scope">
        {t("Tipo de log")}
        <select
          value={scope}
          disabled={busy}
          onChange={(e) => {
            setScope(e.target.value);
            setPolicyDays("");
            setBefore("");
            resetPlan();
          }}
        >
          <option value="deliveries">{t("Atividade de envio")}</option>
          <option value="access">{t("Auditoria de acessos")}</option>
        </select>
      </label>
      {query.isError ? (
        <p role="alert" className="form-error">
          {query.error.message}
        </p>
      ) : !query.data ? (
        <p role="status">{t("Carregando…")}</p>
      ) : (
        <>
          <p>
            {scope === "deliveries"
              ? t(
                  "Registros de envio concluídos são removidos automaticamente após {0} dias.",
                  [query.data.days],
                )
              : t(
                  "Registros de acesso são removidos automaticamente após {0} dias, com limite de 20 mil registros.",
                  [query.data.days],
                )}
          </p>
          <div className="admin-policy">
            <span>
              <strong>{query.data.total}</strong> {t("registros")}
            </span>
            {scope === "deliveries" && (
              <span>
                <strong>{query.data.protected}</strong>{" "}
                {t("na fila ou em processamento, protegidos da limpeza")}
              </span>
            )}
          </div>
          <form className="admin-cleanup-form" onSubmit={savePolicy}>
            <label>
              {t("Manter logs por (dias)")}
              <input
                type="number"
                min={1}
                max={3650}
                required
                disabled={busy}
                value={policyDays || String(query.data.days)}
                onChange={(e) => setPolicyDays(e.target.value)}
              />
            </label>
            <Button type="submit" variant="outline" disabled={busy}>
              {t("Salvar retenção")}
            </Button>
          </form>
          <p className="help">
            {t(
              "Reduzir o prazo permite excluir registros antigos na próxima verificação automática. Preços e oportunidades são preservados.",
            )}
          </p>
          <p className="help">
            {t("Última verificação: {0}", [date(query.data.last_cleanup)])} ·{" "}
            {t("Limpeza em lotes de até {0} registros.", [
              query.data.batch_size,
            ])}
          </p>
          <details className="admin-manual-cleanup">
            <summary>{t("Limpeza manual")}</summary>
            <p>
              {t(
                "Exclui definitivamente os logs selecionados de todos os usuários. Não remove contas, preços ou oportunidades.",
              )}
            </p>
            <form
              className="admin-cleanup-form"
              onSubmit={(e) => {
                e.preventDefault();
                void preview();
              }}
            >
              <label>
                {t("O que excluir")}
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
                    {scope === "deliveries"
                      ? t("Todos os envios concluídos")
                      : t("Todos os acessos registrados")}
                  </option>
                </select>
              </label>
              {mode === "before" && (
                <label>
                  {scope === "deliveries"
                    ? t("Concluídos antes de")
                    : t("Registrados antes de")}
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
              <div className="admin-cleanup-preview" role="status">
                <strong>
                  {t("{0} registros serão excluídos neste lote.", [plan.count])}
                </strong>
                <p>
                  {t("Total elegível: {0}.", [plan.total])}{" "}
                  {scope === "deliveries" &&
                    t(
                      "Pendentes e envios em processamento não serão excluídos.",
                    )}
                </p>
                {plan.count > 0 && (
                  <>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setChecked(e.target.checked)}
                      />
                      {t("Entendo que esta exclusão é definitiva.")}
                    </label>
                    <Button
                      variant="danger"
                      disabled={!checked || busy}
                      onClick={() => void purge()}
                    >
                      <Trash2 size={16} />
                      {t("Excluir {0} registros", [plan.count])}
                    </Button>
                  </>
                )}
              </div>
            )}
          </details>
        </>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="profile-success">
          {message}
        </p>
      )}
      <p className="help">
        {t(
          "A limpeza remove somente os registros selecionados. Os backups são preservados.",
        )}
      </p>
    </Card>
  );
}
export function AdminPanel({
  children,
  request,
  userId = "",
  route,
  navigate,
}: {
  children: ReactNode;
  request: RequestFn;
  userId?: string;
  route?: AppRoute;
  navigate?: Navigate;
}) {
  const [localTab, setLocalTab] = useState("deliveries"),
    [localChannel, setLocalChannel] = useState("email"),
    [retentionScope, setRetentionScope] = useState("deliveries");
  const tab = route?.section || localTab,
    channel = route?.channel || localChannel;
  const setTab = (next: string) =>
    navigate
      ? navigate({ view: "admin", section: next as AppRoute["section"] })
      : setLocalTab(next);
  const setChannel = (next: string) =>
    navigate
      ? navigate({ view: "admin", section: "channels", channel: next })
      : setLocalChannel(next);
  const tabs = [
    ["deliveries", t("Envios")],
    ["channels", t("Canais")],
    ["users", t("Usuários")],
    ["audit", t("Auditoria")],
    ["retention", t("Retenção")],
  ];
  return (
    <div className="admin-workspace">
      {navigate && (
        <Button
          variant="ghost"
          className="admin-exit"
          onClick={() => navigate({ view: "home" })}
        >
          {t("Voltar às viagens")}
        </Button>
      )}
      <label className="admin-section-picker">
        {t("Seção administrativa")}
        <select value={tab} onChange={(e) => setTab(e.target.value)}>
          {tabs.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div
        className="admin-tabs"
        role="tablist"
        aria-label={t("Administração")}
        onKeyDown={tabKeys}
      >
        {tabs.map(([key, label]) => (
          <button
            key={key}
            id={"admin-tab-" + key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-controls={"admin-panel-" + key}
            tabIndex={tab === key ? 0 : -1}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={"admin-panel-" + tab}
        aria-labelledby={"admin-tab-" + tab}
        tabIndex={0}
      >
        {tab === "deliveries" && (
          <DeliveryLog
            route={route}
            navigate={navigate}
            onCleanup={() => {
              setRetentionScope("deliveries");
              setTab("retention");
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
          <>
            <div className="admin-audit-actions">
              <Button
                variant="outline"
                onClick={() => {
                  setRetentionScope("access");
                  setTab("retention");
                }}
              >
                <Trash2 size={15} />
                {t("Limpar logs")}
              </Button>
            </div>
            <AuditPanel admin expanded />
          </>
        )}
        {tab === "retention" && (
          <Retention request={request} initialScope={retentionScope} />
        )}
        {tab === "channels" && (
          <>
            <div
              className="admin-channel-tabs"
              role="tablist"
              aria-label={t("Canais de envio")}
              onKeyDown={tabKeys}
            >
              {[
                ["email", t("E-mail"), Mail],
                ["whatsapp", "WhatsApp", MessageCircle],
                ["telegram", "Telegram", Send],
              ].map(([key, label, Icon]) => {
                const I = Icon as typeof Mail;
                return (
                  <button
                    key={String(key)}
                    id={"channel-tab-" + key}
                    type="button"
                    role="tab"
                    aria-selected={channel === key}
                    aria-controls={"channel-panel-" + key}
                    tabIndex={channel === key ? 0 : -1}
                    onClick={() => setChannel(String(key))}
                  >
                    <I size={16} />
                    {String(label)}
                    {key === "telegram" && <small>{t("Em breve")}</small>}
                  </button>
                );
              })}
            </div>
            <div
              role="tabpanel"
              id={"channel-panel-" + channel}
              aria-labelledby={"channel-tab-" + channel}
              tabIndex={0}
            >
              {channel === "email" ? (
                <div className="admin-email-settings">{children}</div>
              ) : channel === "whatsapp" ? (
                <WhatsAppPanel request={request} />
              ) : (
                <Card className="admin-future-channel">
                  <h2>{channel === "whatsapp" ? "WhatsApp" : "Telegram"}</h2>
                  <p>
                    {t(
                      "Integração ainda não disponível. Nenhuma mensagem é enviada por este canal.",
                    )}
                  </p>
                  <p className="help">
                    {t(
                      "As credenciais de envio serão administradas aqui; os contatos dos destinatários ficam no perfil de cada usuário.",
                    )}
                  </p>
                </Card>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
