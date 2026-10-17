import { afterSave, useUnsavedChanges } from "./navigationGuard";
import { TaskPage } from "./TaskPage";
import type { AppRoute, Navigate } from "./navigation";
import { AdminMonitorings } from "./AdminMonitorings";
import { useState, useEffect, useId } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Plus, Pencil, KeyRound, Eye, Search, Ellipsis, UsersRound } from "lucide-react";
import { t } from "./i18n";
import { Button, ContextMenu, Notice } from "./ui";
import { TimeZoneField } from "./TimeZoneField";
import { PasswordField } from "./PasswordField";
import { PhoneField } from "./PhoneField";
import { EmailFields } from "./EmailFields";
import { AdditionalPhones } from "./AdditionalPhones";
import { Avatar } from "./Avatar";
import { CellLabel, EmptyRows, LoadError, Pager, TableSkeleton } from "./DataView";
import { formatNumber } from "./format";
import { plural } from "./plural";
import type { User } from "./types";
type RequestFn = (
  path: string,
  body: unknown,
  method?: string,
) => Promise<unknown>;
type Draft = Omit<User, "id" | "role" | "phone_verified"> & {
  password: string;
};
const blank = (): Draft => ({
  search_limit: 5,
  name: "",
  country: "BR",
  phone: "",
  password: "",
  language: "pt",
  emails: [],
  whatsapp_use_login: true,
  whatsapp_country: "BR",
  whatsapp_phone: null,
  telegram_username: "",
  additional_phones: [],
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  quiet_hours: false,
  quiet_start: "22:00",
  quiet_end: "08:00",
});
/**
 * The search term as the server compares it: a phone typed as the list shows
 * it ("+55 11 98765-4321", "(11) 98765-4321") loses its spaces, parentheses,
 * dots and hyphens, since accounts store E.164. Names, e-mails and "#ID" stay.
 */
export function userSearchTerm(value: string): string {
  const term = value.trim();
  return /\d/.test(term) && /^\+?[\d\s().-]+$/.test(term) ? term.replace(/[\s().-]/g, "") : term;
}
/** Title of each account task, also while the account loads. */
const taskTitle = (action?: AppRoute["userAction"]) =>
  action === "new"
    ? t("Novo usuário")
    : action === "edit"
      ? t("Editar cadastro")
      : action === "password"
        ? t("Redefinir senha")
        : t("Monitoramentos");
export function AdminUsers({
  request,
  userId,
  route,
  navigate,
}: {
  request: RequestFn;
  userId: string;
  route?: AppRoute;
  navigate?: Navigate;
}) {
  // Hook order matters to the tests: search, filter, page, editing, draft, target.
  const cache = useQueryClient(),
    [q, setQ] = useState(""),
    [filter, setFilter] = useState(""),
    [page, setPage] = useState(0),
    [editing, setEditing] = useState<User | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [target, setTarget] = useState<User | null>(null),
    [password, setPassword] = useState(""),
    [repeat, setRepeat] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [inspecting, setInspecting] = useState<User | null>(null);
  const id = useId();
  const query = useQuery<{ items: User[]; total: number; page_size: number }>({
    queryKey: ["admin-users", filter, page],
    enabled: !route?.userAction,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    // The rows of the last page stay while the next one loads: the pager keeps the focus.
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const r = await fetch(
        "/api/admin/users?" +
          new URLSearchParams({ q: filter, page: String(page) }),
        { signal, cache: "no-store" },
      );
      if (!r.ok) throw Error(t("Não foi possível carregar os usuários."));
      return r.json();
    },
  });
  const [initialDraft, setInitialDraft] = useState("");
  useUnsavedChanges(
    (!!draft && JSON.stringify(draft) !== initialDraft) ||
      (!!target && !!(password || repeat)),
  );
  const account = useQuery<User>({
    queryKey: ["admin-user", route?.userId],
    enabled: !!route?.userId,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        "/api/admin/users/" + encodeURIComponent(route!.userId!),
        { signal, cache: "no-store" },
      );
      if (!response.ok) throw Error(t("Usuário não encontrado"));
      return response.json();
    },
  });
  useEffect(() => {
    if (!route) return;
    setError("");
    setPassword("");
    setRepeat("");
    setConfirmed(false);
    if (route.userAction === "new") {
      const next = blank();
      setEditing(null);
      setDraft(next);
      setInitialDraft(JSON.stringify(next));
    } else setDraft(null); // an edit waits for the account as fetched now (below)
    setTarget(route.userAction === "password" ? account.data || null : null);
    setInspecting(
      route.userAction === "monitorings" ? account.data || null : null,
    );
  }, [route?.userId, route?.userAction, account.data?.id]);
  // The edit form starts only from the account fetched after this page opened,
  // never from a cached copy: saving a stale copy would undo the last change.
  const fresh =
    route?.userAction === "edit" && account.isFetchedAfterMount && !account.isError && account.data?.id === route.userId
      ? account.data
      : null;
  useEffect(() => {
    if (!fresh) return;
    const next = {
      ...structuredClone(fresh),
      additional_phones: fresh.additional_phones || [],
      password: "",
    };
    setEditing(fresh);
    setDraft(next);
    setInitialDraft(JSON.stringify(next));
  }, [fresh?.id, route?.userAction]);
  function closeTask() {
    if (busy) return;
    if (navigate) {
      navigate({ view: "admin", section: "users" });
      return;
    }
    setDraft(null);
    setTarget(null);
    setInspecting(null);
    setPassword("");
    setRepeat("");
  }
  function open(user: User | null) {
    setError("");
    setNotice("");
    if (navigate) {
      // The route builds the form: blank, or from the account as fetched now
      // (the list row may be older than the account).
      navigate({
        view: "admin",
        section: "users",
        userId: user?.id,
        userAction: user ? "edit" : "new",
      });
      return;
    }
    setEditing(user);
    setDraft(
      user
        ? {
            ...structuredClone(user),
            additional_phones: user.additional_phones || [],
            password: "",
          }
        : blank(),
    );
  }
  function openPassword(user: User) {
    setTarget(user);
    navigate?.({
      view: "admin",
      section: "users",
      userId: user.id,
      userAction: "password",
    });
    setPassword("");
    setRepeat("");
    setConfirmed(false);
    setError("");
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const { password, ...contacts } = draft;
      const result = (await request(
        "/admin/users" + (editing ? "/" + editing.id : ""),
        editing ? contacts : { ...contacts, password },
        editing ? "PUT" : "POST",
      )) as User;
      setDraft(null);
      afterSave(() => navigate?.({ view: "admin", section: "users" }));
      setNotice(t("Cadastro salvo."));
      // The next edit loads the account again instead of this cached copy.
      if (editing) cache.removeQueries({ queryKey: ["admin-user", editing.id] });
      await cache.invalidateQueries({ queryKey: ["admin-users"] });
      await cache.invalidateQueries({ queryKey: ["admin-user"] });
      await cache.invalidateQueries({ queryKey: ["radar"] });
      await cache.invalidateQueries({ queryKey: ["audit"] });
      if (editing?.id === userId && editing.phone !== result.phone)
        window.location.reload();
    } catch (e) {
      setError(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  async function reset(e: React.FormEvent) {
    e.preventDefault();
    if (!target || !confirmed) return;
    if (password !== repeat) {
      setError(t("As senhas não conferem."));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await request(
        "/admin/users/" + target.id + "/password",
        { password },
        "PUT",
      );
      const self = target.id === userId;
      setTarget(null);
      afterSave(() => navigate?.({ view: "admin", section: "users" }));
      setPassword("");
      setRepeat("");
      setNotice(t("Senha redefinida. As sessões da conta foram encerradas."));
      await cache.invalidateQueries({ queryKey: ["audit"] });
      if (self) window.location.reload();
    } catch (e) {
      setError(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  // Live regions rendered with or without a message, so the message is announced.
  const errorNotice = (
    <Notice tone="error" onDismiss={() => setError("")}>
      {error}
    </Notice>
  );
  // "Cadastro salvo" arrives as the form gives way to the list: its region sits
  // above both views, so the same live region is in the page before and after.
  const savedNotice = <Notice onDismiss={() => setNotice("")}>{notice}</Notice>;
  // A task is a page of its own: the route says which, the state holds its data.
  const task =
    route?.userAction ||
    (draft ? (editing ? "edit" : "new") : target ? "password" : inspecting ? "monitorings" : undefined);
  if (task === "monitorings" && inspecting)
    return (
      <>
      {savedNotice}
      <AdminMonitorings
        user={inspecting}
        onClose={closeTask}
        monitoringId={route?.monitorId}
        onSelect={
          navigate
            ? (monitorId) =>
                navigate({
                  view: "admin",
                  section: "users",
                  userId: inspecting.id,
                  userAction: "monitorings",
                  monitorId,
                })
            : undefined
        }
      />
      </>
    );
  if (task) {
    const ready = task === "password" ? !!target : task === "monitorings" ? false : !!draft;
    return (
      <>
      {savedNotice}
      <TaskPage
        onBack={closeTask}
        backLabel={t("Voltar aos usuários")}
        title={taskTitle(task)}
        description={
          task === "password" && target
            ? t("Nova senha para {0}.", [target.name])
            : task === "edit" || task === "new"
              ? t("Dados de acesso, contatos e preferências do usuário.")
              : undefined
        }
        className="admin-user-task"
      >
        {!ready ? (
          // The account is still loading (or failed); the page keeps its title.
          account.isError ? (
            <LoadError level={2} message={account.error.message} onRetry={() => void account.refetch()} />
          ) : (
            <TableSkeleton rows={4} />
          )
        ) : task === "password" && target ? (
          <form className="admin-form" onSubmit={reset}>
            <fieldset disabled={busy} className="admin-form-sections">
              <section className="list-section">
                <h2 className="list-section-title">{t("Nova senha")}</h2>
                <div className="list-group">
                  <div className="form-block">
                    <PasswordField
                      label={t("Nova senha")}
                      required
                      minLength={10}
                      maxLength={200}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  <div className="form-block">
                    <PasswordField
                      label={t("Confirmar nova senha")}
                      required
                      minLength={10}
                      maxLength={200}
                      autoComplete="new-password"
                      value={repeat}
                      onChange={(e) => setRepeat(e.target.value)}
                    />
                  </div>
                </div>
                <p className="list-section-footer">
                  {t("Mínimo de 10 caracteres. Compartilhe a senha por um meio seguro.")}
                </p>
              </section>
              <label className="check-row admin-confirm">
                <input
                  type="checkbox"
                  required
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                {t(
                  "Encerrar as sessões desta conta e invalidar os links de recuperação anteriores.",
                )}
              </label>
            </fieldset>
            {errorNotice}
            <div className="admin-form-footer">
              <Button variant="outline" type="button" disabled={busy} onClick={closeTask}>
                {t("Cancelar")}
              </Button>
              <Button type="submit" variant="danger" className="button-confirm" disabled={busy || !confirmed}>
                <KeyRound size={16} aria-hidden="true" />
                {t("Redefinir senha")}
              </Button>
            </div>
          </form>
        ) : draft ? (
          <form className="admin-form" onSubmit={save} autoComplete="off">
            <fieldset disabled={busy} className="admin-form-sections">
              <section className="list-section">
                <h2 className="list-section-title">{t("Conta")}</h2>
                <div className="list-group">
                  <label className="form-row">
                    <span className="form-row-label">{t("Nome")}</span>
                    <input
                      required
                      minLength={2}
                      maxLength={80}
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </label>
                  <div className="form-block">
                    <PhoneField
                      label={t("Telefone de acesso")}
                      country={draft.country}
                      value={draft.phone}
                      disabled={busy}
                      onChange={(country, phone) => setDraft({ ...draft, country, phone })}
                    />
                    {editing && (
                      <p className="help">
                        {t("Alterar o telefone de acesso encerra as sessões desta conta.")}
                      </p>
                    )}
                  </div>
                  {!editing && (
                    <div className="form-block">
                      <PasswordField
                        label={t("Senha inicial")}
                        required
                        minLength={10}
                        maxLength={200}
                        autoComplete="new-password"
                        value={draft.password}
                        onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                      />
                      <p className="help">
                        {t("Mínimo de 10 caracteres. Compartilhe a senha por um meio seguro.")}
                      </p>
                    </div>
                  )}
                </div>
              </section>
              <section className="list-section">
                <h2 className="list-section-title">{t("Contatos de alerta")}</h2>
                <div className="list-group">
                  <div className="form-block">
                    <EmailFields
                      compact
                      label={
                        <>
                          {t("E-mails de alerta")}{" "}
                          <span className="form-block-count">{draft.emails.length}/4</span>
                        </>
                      }
                      values={draft.emails}
                      onChange={(emails) => setDraft({ ...draft, emails })}
                    />
                  </div>
                  <div className="form-block whatsapp-contact">
                    <label className="switch-row">
                      <span>{t("Usar o telefone de acesso no WhatsApp")}</span>
                      <input
                        type="checkbox"
                        role="switch"
                        className="switch"
                        checked={draft.whatsapp_use_login}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            whatsapp_use_login: e.target.checked,
                            whatsapp_phone: null,
                          })
                        }
                      />
                    </label>
                    {!draft.whatsapp_use_login && (
                      <PhoneField
                        label={t("Número para WhatsApp")}
                        country={draft.whatsapp_country}
                        value={draft.whatsapp_phone || ""}
                        disabled={busy}
                        onChange={(whatsapp_country, whatsapp_phone) =>
                          setDraft({ ...draft, whatsapp_country, whatsapp_phone })
                        }
                      />
                    )}
                  </div>
                  <div className="form-block">
                    <AdditionalPhones
                      defaultCountry={draft.country}
                      values={draft.additional_phones}
                      disabled={busy}
                      onChange={(additional_phones) => setDraft({ ...draft, additional_phones })}
                    />
                  </div>
                </div>
                <p className="list-section-footer">
                  {t("Contatos para receber os próximos alertas por WhatsApp.")}
                </p>
              </section>
              <section className="list-section">
                <h2 className="list-section-title">{t("Preferências")}</h2>
                <div className="list-group">
                  <label className="form-row">
                    <span className="form-row-label">{t("Idioma")}</span>
                    <select
                      value={draft.language}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          language: e.target.value as User["language"],
                        })
                      }
                    >
                      <option value="pt">Português</option>
                      <option value="en">English</option>
                      <option value="es">Español</option>
                    </select>
                  </label>
                  <label className="form-row">
                    <span className="form-row-label">{t("Limite de monitoramentos")}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={100}
                      step={1}
                      required
                      value={draft.search_limit ?? 5}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          search_limit: e.target.valueAsNumber,
                        })
                      }
                    />
                    <span className="field-help">
                      {t(
                        "Padrão: 5. Buscas pausadas também contam. Reduzir o limite não remove buscas existentes.",
                      )}
                    </span>
                  </label>
                </div>
              </section>
              <section className="list-section">
                <h2 className="list-section-title">{t("Horário silencioso")}</h2>
                <div className="list-group">
                  <div className="form-block quiet-hours">
                    <label className="switch-row">
                      <span>{t("Silenciar alertas de preço neste horário")}</span>
                      <input
                        type="checkbox"
                        role="switch"
                        className="switch"
                        checked={draft.quiet_hours}
                        onChange={(e) => setDraft({ ...draft, quiet_hours: e.target.checked })}
                      />
                    </label>
                    {draft.quiet_hours && (
                      <div className="two-fields quiet-hours-times">
                        <label>
                          <span>{t("Início")}</span>
                          <input
                            type="time"
                            required
                            value={draft.quiet_start}
                            onChange={(e) => setDraft({ ...draft, quiet_start: e.target.value })}
                          />
                        </label>
                        <label>
                          <span>{t("Fim")}</span>
                          <input
                            type="time"
                            required
                            value={draft.quiet_end}
                            onChange={(e) => setDraft({ ...draft, quiet_end: e.target.value })}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                  <div className="form-block">
                    <TimeZoneField
                      value={draft.timezone}
                      disabled={busy}
                      onChange={(timezone) => setDraft({ ...draft, timezone })}
                    />
                  </div>
                </div>
              </section>
            </fieldset>
            {errorNotice}
            <div className="admin-form-footer">
              <Button variant="outline" type="button" disabled={busy} onClick={closeTask}>
                {t("Cancelar")}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? t("Salvando…") : t("Salvar cadastro")}
              </Button>
            </div>
          </form>
        ) : null}
      </TaskPage>
      </>
    );
  }
  const data = query.data;
  return (
    <>
    {savedNotice}
    <section className="card admin-card admin-users" aria-labelledby={id + "-title"}>
      <header className="admin-card-heading">
        <div>
          <h2 id={id + "-title"}>{t("Cadastro de usuários")}</h2>
          <p>{t("Gerencie contas e contatos sem alterar sua sessão de administrador.")}</p>
        </div>
        <div className="admin-card-actions">
          <Button size="small" onClick={() => open(null)}>
            <Plus size={16} aria-hidden="true" />
            {t("Novo usuário")}
          </Button>
        </div>
      </header>
      <form
        className="admin-search"
        role="search"
        aria-label={t("Buscar usuário")}
        onSubmit={(e) => {
          e.preventDefault();
          setFilter(userSearchTerm(q));
          setPage(0);
        }}
      >
        <label className="sr-only" htmlFor={id + "-q"}>
          {t("Buscar usuário")}
        </label>
        <div className="field-frame">
          <Search size={18} aria-hidden="true" />
          <input
            id={id + "-q"}
            type="search"
            maxLength={120}
            placeholder={t("Nome, telefone, e-mail ou #ID")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button type="submit" variant="outline">
          {t("Consultar")}
        </Button>
      </form>
      {query.isError ? (
        <LoadError message={query.error.message} onRetry={() => void query.refetch()} />
      ) : !data ? (
        <TableSkeleton rows={5} />
      ) : !data.items.length ? (
        <EmptyRows icon={UsersRound} title={t("Nenhum usuário encontrado.")}>
          {filter ? t("Revise a busca ou limpe o campo para ver todas as contas.") : undefined}
        </EmptyRows>
      ) : (
        <div className="table-frame user-table-frame">
          <table
            role="table"
            className={clsx("data-table user-table", query.isPlaceholderData && "is-stale")}
            aria-busy={query.isFetching || undefined}
          >
            <caption className="sr-only">{t("Usuários: conta, telefone, papel, cota e ações")}</caption>
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader" className="col-user">{t("Usuário")}</th>
                <th scope="col" role="columnheader" className="col-phone">{t("Telefone")}</th>
                <th scope="col" role="columnheader" className="col-role">{t("Papel")}</th>
                <th scope="col" role="columnheader" className="col-quota">{t("Cota")}</th>
                <th scope="col" role="columnheader" className="col-monitorings">{t("Monitoramentos")}</th>
                <th scope="col" role="columnheader" className="col-actions">
                  <span className="sr-only">{t("Ações")}</span>
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {data.items.map((user) => {
                const counts = user.monitoring_counts;
                const used = (counts?.active || 0) + (counts?.paused || 0),
                  limit = user.search_limit || 5;
                return (
                  <tr role="row" key={user.id}>
                    <td role="cell" className="cell-user">
                      <span className="user-identity">
                        <Avatar name={user.name} />
                        <span className="user-identity-text">
                          <span className="cell-title cell-truncate">{user.name}</span>
                          <span className="cell-secondary">{t("Cliente #{0}", [user.client_number || "—"])}</span>
                          <span className="cell-secondary cell-truncate" title={user.emails.join(", ")}>
                            {user.emails.join(" · ") || t("Sem e-mail cadastrado")}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td role="cell" className="cell-phone cell-field">
                      <CellLabel>{t("Telefone")}</CellLabel>
                      <span>{user.phone_display ?? user.phone}</span>
                    </td>
                    <td role="cell" className="cell-role cell-field">
                      <CellLabel>{t("Papel")}</CellLabel>
                      <span className={clsx("status-pill", user.role === "admin" ? "is-info" : "is-ended")}>
                        {user.role === "admin" ? t("Administrador") : t("Usuário")}
                      </span>
                    </td>
                    <td role="cell" className="cell-quota">
                      <span className="quota">
                        <span className="quota-text">{t("Em uso: {0}/{1}", [formatNumber(used), formatNumber(limit)])}</span>
                        <span className={clsx("quota-bar", used >= limit && "is-full")} aria-hidden="true">
                          <span style={{ width: `${Math.min(100, (used / Math.max(1, limit)) * 100)}%` }} />
                        </span>
                      </span>
                    </td>
                    <td role="cell" className="cell-monitorings">
                      <Button
                        variant="outline"
                        size="small"
                        onClick={() => {
                          setInspecting(user);
                          navigate?.({
                            view: "admin",
                            section: "users",
                            userId: user.id,
                            userAction: "monitorings",
                          });
                        }}
                        aria-label={t("Ver monitoramentos de {0}", [user.name])}
                      >
                        <Eye size={15} aria-hidden="true" />
                        {t("Monitoramentos")}
                        <span className="button-count">{formatNumber(counts?.total || 0)}</span>
                      </Button>
                      <span className="cell-secondary">
                        {t("Ativos: {0} · Pausados: {1} · Encerrados: {2}", [
                          counts?.active || 0,
                          counts?.paused || 0,
                          counts?.ended || 0,
                        ])}
                      </span>
                    </td>
                    <td role="cell" className="cell-actions">
                      <ContextMenu
                        summaryClassName="icon-trigger"
                        summaryLabel={t("Ações de {0}", [user.name])}
                        label={<Ellipsis size={20} aria-hidden="true" />}
                      >
                        <button
                          type="button"
                          className="menu-item"
                          onClick={() => open(user)}
                          aria-label={t("Editar usuário {0}", [user.name])}
                        >
                          <Pencil size={18} aria-hidden="true" />
                          {t("Editar")}
                        </button>
                        <button
                          type="button"
                          className="menu-item"
                          onClick={() => openPassword(user)}
                          aria-label={t("Redefinir senha de {0}", [user.name])}
                        >
                          <KeyRound size={18} aria-hidden="true" />
                          {t("Redefinir senha")}
                        </button>
                      </ContextMenu>
                    </td>
                  </tr>
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
          label={t("Páginas de usuários")}
          summary={plural(data.total, "{0} usuário", "{0} usuários", formatNumber(data.total))}
        />
      )}
    </section>
    </>
  );
}
