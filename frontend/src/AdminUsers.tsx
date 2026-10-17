import { afterSave, useUnsavedChanges } from "./navigationGuard";
import { TaskPage } from "./TaskPage";
import type { AppRoute, Navigate } from "./navigation";
import { AdminMonitorings } from "./AdminMonitorings";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Pencil,
  KeyRound,
  Eye,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { t } from "./i18n";
import { Card, Button, Modal } from "./ui";
import { TimeZoneField } from "./TimeZoneField";
import { PasswordField } from "./PasswordField";
import { PhoneField } from "./PhoneField";
import { EmailFields } from "./Accounts";
import { AdditionalPhones } from "./AdditionalPhones";
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
  const query = useQuery<{ items: User[]; total: number; page_size: number }>({
    queryKey: ["admin-users", filter, page],
    enabled: !route?.userAction,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
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
    } else if (
      route.userAction === "edit" &&
      account.data &&
      account.data.id === route.userId
    ) {
      const next = {
        ...structuredClone(account.data),
        additional_phones: account.data.additional_phones || [],
        password: "",
      };
      setEditing(account.data);
      setDraft(next);
      setInitialDraft(JSON.stringify(next));
    } else setDraft(null);
    setTarget(route.userAction === "password" ? account.data || null : null);
    setInspecting(
      route.userAction === "monitorings" ? account.data || null : null,
    );
  }, [route?.userId, route?.userAction, account.data?.id]);
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
    setError("");
    setNotice("");
    navigate?.({
      view: "admin",
      section: "users",
      userId: user?.id,
      userAction: user ? "edit" : "new",
    });
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
  return (
    <Card className="admin-users">
      {!draft && !target && !inspecting && !route?.userAction && (
        <>
          <div className="section-heading">
            <div>
              <h2>{t("Cadastro de usuários")}</h2>
              <p>
                {t(
                  "Gerencie contas e contatos sem alterar sua sessão de administrador.",
                )}
              </p>
            </div>
            <Button onClick={() => open(null)}>
              <Plus size={16} />
              {t("Novo usuário")}
            </Button>
          </div>
          <form
            className="admin-user-search"
            onSubmit={(e) => {
              e.preventDefault();
              setFilter(q);
              setPage(0);
            }}
          >
            <label>
              <span className="sr-only">{t("Buscar usuário")}</span>
              <input
                type="search"
                maxLength={120}
                placeholder={t("Nome, telefone, e-mail ou #ID")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <Button type="submit" variant="outline">
              {t("Consultar")}
            </Button>
          </form>
          {notice && (
            <p className="profile-success" role="status">
              {notice}
            </p>
          )}
          {query.isError ? (
            <p className="form-error" role="alert">
              {query.error.message}
            </p>
          ) : !query.data ? (
            <p role="status">{t("Carregando…")}</p>
          ) : (
            <>
              <div className="admin-user-list">
                {query.data.items.map((user) => (
                  <article key={user.id}>
                    <div>
                      <strong>{user.name}</strong>
                      <span className="subtle-tag">
                        {t("Cliente #{0}", [user.client_number || "—"])}
                      </span>
                      {user.role === "admin" && (
                        <span className="subtle-tag">{t("Administrador")}</span>
                      )}
                      <small>{user.phone}</small>
                      <small className="admin-user-quota">
                        {t("Em uso: {0}/{1}", [
                          (user.monitoring_counts?.active || 0) +
                            (user.monitoring_counts?.paused || 0),
                          user.search_limit || 5,
                        ])}
                      </small>
                      <small className="admin-user-monitor-counts">
                        {t("Ativos: {0} · Pausados: {1} · Encerrados: {2}", [
                          user.monitoring_counts?.active || 0,
                          user.monitoring_counts?.paused || 0,
                          user.monitoring_counts?.ended || 0,
                        ])}
                      </small>
                      <small>
                        {user.emails.join(" · ") || t("Sem e-mail cadastrado")}
                      </small>
                    </div>
                    <div className="admin-user-actions">
                      <Button
                        variant="outline"
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
                        <Eye size={15} />
                        {t("Monitoramentos")} (
                        {user.monitoring_counts?.total || 0})
                      </Button>
                      <details className="user-secondary-actions">
                        <summary>{t("Gerenciar")}</summary>
                        <Button
                          variant="outline"
                          onClick={() => open(user)}
                          aria-label={t("Editar usuário {0}", [user.name])}
                        >
                          <Pencil size={15} />
                          {t("Editar")}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
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
                          }}
                          aria-label={t("Redefinir senha de {0}", [user.name])}
                        >
                          <KeyRound size={15} />
                          {t("Senha")}
                        </Button>
                      </details>
                    </div>
                  </article>
                ))}
                {!query.data.items.length && (
                  <p className="small-empty">
                    {t("Nenhum usuário encontrado.")}
                  </p>
                )}
              </div>
              <div className="admin-pagination">
                <small>
                  {t("{0} usuários · página {1}", [query.data.total, page + 1])}
                </small>
                <div>
                  <Button
                    variant="outline"
                    disabled={!page}
                    onClick={() => setPage(page - 1)}
                    aria-label={t("Página anterior")}
                  >
                    <ChevronLeft size={16} />
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      (page + 1) * query.data.page_size >= query.data.total
                    }
                    onClick={() => setPage(page + 1)}
                    aria-label={t("Próxima página")}
                  >
                    <ChevronRight size={16} />
                  </Button>
                </div>
              </div>
            </>
          )}
        </>
      )}
      {inspecting && (
        <AdminMonitorings
          user={inspecting}
          onClose={closeTask}
          monitoringId={route?.monitorId}
          onSelect={
            navigate
              ? (id) =>
                  navigate({
                    view: "admin",
                    section: "users",
                    userId: inspecting.id,
                    userAction: "monitorings",
                    monitorId: id,
                  })
              : undefined
          }
        />
      )}
      {draft && (
        <TaskPage
          onBack={closeTask}
          title={editing ? t("Editar cadastro") : t("Novo usuário")}
          description={t(
            "Dados de acesso, contatos e preferências do usuário.",
          )}
          className="admin-user-dialog"
        >
          {draft && (
            <form onSubmit={save} autoComplete="off">
              <fieldset disabled={busy} className="admin-account-fields">

                  <label>
                    {t("Nome")}
                    <input
                      required
                      minLength={2}
                      maxLength={80}
                      value={draft.name}
                      onChange={(e) =>
                        setDraft({ ...draft, name: e.target.value })
                      }
                    />
                  </label>



                <PhoneField
                  label={t("Telefone de acesso")}
                  country={draft.country}
                  value={draft.phone}
                  disabled={busy}
                  onChange={(country, phone) =>
                    setDraft({ ...draft, country, phone })
                  }
                />
                {editing && (
                  <p className="help">
                    {t(
                      "Alterar o telefone de acesso encerra as sessões desta conta.",
                    )}
                  </p>
                )}
                {!editing && (
                  <div>
                    <PasswordField label={t("Senha inicial")}
                      required
                      minLength={10}
                      maxLength={200}
                      autoComplete="new-password"
                      value={draft.password}
                      onChange={(e) =>
                        setDraft({ ...draft, password: e.target.value })
                      }
                    />
                    <small>
                      {t(
                        "Mínimo de 10 caracteres. Compartilhe a senha por um meio seguro.",
                      )}
                    </small>
                  </div>
                )}
                <details className="profile-section" open>
                  <summary>
                    {t("E-mails de alerta")}{" "}
                    <span>{draft.emails.length}/4</span>
                  </summary>
                  <EmailFields
                    compact
                    values={draft.emails}
                    onChange={(emails) => setDraft({ ...draft, emails })}
                  />
                </details>
                <details className="profile-section">
                  <summary>{t("WhatsApp")}</summary>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={draft.whatsapp_use_login}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          whatsapp_use_login: e.target.checked,
                          whatsapp_phone: null,
                        })
                      }
                    />
                    {t("Usar o telefone de acesso no WhatsApp")}
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
                  <AdditionalPhones
                    defaultCountry={draft.country}
                    values={draft.additional_phones}
                    disabled={busy}
                    onChange={(additional_phones) =>
                      setDraft({ ...draft, additional_phones })
                    }
                  />
                  <p className="help">
                    {t(
                      "Contatos para receber os próximos alertas por WhatsApp.",
                    )}
                  </p>
                </details>
                <details className="profile-section"><summary>{t("Preferências")}</summary>
                  <label>
                    {t("Idioma")}
                    <select
                      value={draft.language}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          language: e.target.value as User["language"],
                        })
                      }
                    >
                      <option value="pt">🇧🇷 Português</option>
                      <option value="en">🇺🇸 English</option>
                      <option value="es">🇪🇸 Español</option>
                    </select>
                  </label>
                <label>
                  {t("Limite de monitoramentos")}
                  <input
                    type="number"
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
                  <small className="help">
                    {t(
                      "Padrão: 5. Buscas pausadas também contam. Reduzir o limite não remove buscas existentes.",
                    )}
                  </small>
                </label>
                </details>
                <details className="profile-section">
                  <summary>{t("Horário silencioso")}</summary>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={draft.quiet_hours}
                      onChange={(e) =>
                        setDraft({ ...draft, quiet_hours: e.target.checked })
                      }
                    />
                    {t("Silenciar alertas de preço neste horário")}
                  </label>
                  <div className="two-fields">
                    <label>
                      {t("Início")}
                      <input
                        type="time"
                        required
                        value={draft.quiet_start}
                        onChange={(e) =>
                          setDraft({ ...draft, quiet_start: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      {t("Fim")}
                      <input
                        type="time"
                        required
                        value={draft.quiet_end}
                        onChange={(e) =>
                          setDraft({ ...draft, quiet_end: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <TimeZoneField value={draft.timezone} disabled={busy} onChange={timezone => setDraft({ ...draft, timezone })} />
                </details>
              </fieldset>
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
              <div className="admin-form-footer">
                <Button
                  variant="outline"
                  type="button"
                  disabled={busy}
                  onClick={closeTask}
                >
                  {t("Cancelar")}
                </Button>
                <Button type="submit" size="large" disabled={busy}>
                  {busy ? t("Salvando…") : t("Salvar cadastro")}
                </Button>
              </div>
            </form>
          )}
        </TaskPage>
      )}
      {target && (
        <TaskPage
          onBack={closeTask}
          title={t("Redefinir senha")}
          description={target ? t("Nova senha para {0}.", [target.name]) : ""}
        >
          <form onSubmit={reset}>
            <fieldset disabled={busy} className="admin-account-fields">
              <PasswordField label={t("Nova senha")}
                  required
                  minLength={10}
                  maxLength={200}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />

              <PasswordField label={t("Confirmar nova senha")}
                  required
                  minLength={10}
                  maxLength={200}
                  autoComplete="new-password"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                />

              <label className="check-row">
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
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <Button type="submit" size="large" disabled={busy || !confirmed}>
              {t("Redefinir senha")}
            </Button>
          </form>
        </TaskPage>
      )}
      {route?.userAction &&
        route.userAction !== "new" &&
        !draft &&
        !target &&
        !inspecting && (
          <div>
            <Button variant="ghost" onClick={closeTask}>
              {t("Voltar aos usuários")}
            </Button>
            <p role={account.isError ? "alert" : "status"}>
              {account.isError ? account.error.message : t("Carregando…")}
            </p>
          </div>
        )}
    </Card>
  );
}
