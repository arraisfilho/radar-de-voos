import type { ReactNode } from "react";
import { useUnsavedChanges } from "./navigationGuard";
import { SystemVersion } from "./SystemVersion";
import { AdditionalPhones } from "./AdditionalPhones";
import { useLanguage, getLanguage, getLocale, t } from "./i18n";
import { LanguagePicker } from "./LanguagePicker";
import { useEffect, useState, lazy, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plane, Plus, X, LogOut, Shield, Mail, UserRound } from "lucide-react";
import { Button, Card } from "./ui";
import { PhoneField } from "./PhoneField";
import { TimeZoneField } from "./TimeZoneField";
import { PasswordField } from "./PasswordField";
import { AuditPanel } from "./AuditPanel";
import { RecoveryForm } from "./RecoveryForm";
const Dashboard = lazy(() => import("./App"));
import type { User } from "./types";
type Session = {
  user: User | null;
  token: string;
  can_bootstrap: boolean;
  registration_open?: boolean;
};
async function api(
  path: string,
  token: string,
  body: unknown,
  method = "POST",
) {
  const r = await fetch("/api" + path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-radar-token": token,
      "x-radar-language": getLanguage(),
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok)
    throw Error(
      t(
        typeof data.detail === "string"
          ? data.detail
          : Array.isArray(data.detail)
            ? data.detail
                .map((d: { msg: string }) =>
                  t(d.msg.replace(/^Value error, /, "")),
                )
                .join(" · ")
            : t("Não foi possível concluir a ação"),
      ),
    );
  return data;
}
export function EmailFields({
  values,
  onChange,
  compact = false,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  compact?: boolean;
}) {
  return (
    <fieldset className="email-fields">
      <legend>{t("E-mails para receber alertas")}</legend>
      {!compact && (
        <p className="help">
          {t(
            "Cadastre até quatro endereços. Os alertas serão enviados a todos eles.",
          )}
        </p>
      )}
      {values.map((value, i) => (
        <div className="email-row" key={i}>
          <label>
            <span>E-mail {i + 1}</span>
            <input
              type="email"
              required
              autoComplete={i === 0 ? "email" : "off"}
              maxLength={254}
              placeholder="voce@exemplo.com"
              value={value}
              onChange={(e) =>
                onChange(values.map((v, n) => (n === i ? e.target.value : v)))
              }
            />
          </label>
          <Button
            type="button"
            variant="ghost"
            aria-label={t("Remover e-mail {0}", [i + 1])}
            onClick={() => onChange(values.filter((_, n) => n !== i))}
          >
            <X size={18} />
          </Button>
        </div>
      ))}
      {values.length < 4 && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => onChange([...values, ""])}
        >
          <Plus size={16} />
          {values.length ? t("Adicionar outro e-mail") : t("Adicionar e-mail")}
        </Button>
      )}
    </fieldset>
  );
}
export function AuthGate() {
  const language = useLanguage();
  const [recovery, setRecovery] = useState(() =>
    location.hash.startsWith("#reset="),
  );
  const [resetToken] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get("reset") || "",
  );
  const [session, setSession] = useState<Session | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState<"login" | "register" | "admin">("login");
  const [name, setName] = useState(""),
    [country, setCountry] = useState("BR"),
    [phone, setPhone] = useState(""),
    [password, setPassword] = useState(""),
    [emails, setEmails] = useState<string[]>([]);
  const client = useQueryClient();
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => {
        if (!r.ok) throw Error(t("Não foi possível conectar ao radar."));
        return r.json();
      })
      .then(setSession)
      .catch((e) => setError(t(e.message)));
  }, []);
  useEffect(() => {
    if (!session?.user) return;
    let active = true;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((fresh) =>
        api("/profile/language", fresh.token, { language }, "PUT"),
      )
      .catch(() => {
        if (active)
          setError(t(t("Não foi possível salvar o idioma dos alertas.")));
      });
    return () => {
      active = false;
    };
  }, [session?.user?.id, language]);
  async function logout() {
    try {
      const refreshed: Session = await fetch("/api/auth/session", {
        cache: "no-store",
      }).then((r) => {
        if (!r.ok) throw Error(t("Não foi possível encerrar a sessão"));
        return r.json();
      });
      await api("/auth/logout", refreshed.token, {});
    } catch (e) {
      setError(t((e as Error).message));
      return;
    }
    client.clear();
    setPassword("");
    setPhone("");
    setName("");
    setEmails([]);
    setMode("login");
    const fresh: Session = await fetch("/api/auth/session").then((r) =>
      r.json(),
    );
    setSession(fresh);
  }
  if (recovery)
    return (
      <RecoveryForm
        token={resetToken}
        onBack={() => {
          if (resetToken) location.replace("/");
          else setRecovery(false);
        }}
      />
    );
  if (session?.user)
    return (
      <>
        <div aria-live="polite">
          {error && (
            <p role="alert" className="toast error">
              {error}
            </p>
          )}
        </div>
        <Suspense
          fallback={
            <div className="loading-account">{t("Abrindo seu radar…")}</div>
          }
        >
          <Dashboard onLogout={logout} />
        </Suspense>
      </>
    );
  return (
    <main className="auth-page">
      <SystemVersion />
      <LanguagePicker />
      <a href="/" className="brand auth-brand">
        <Plane size={28} />
        {t("Radar de Voos")}
      </a>
      <Card className="auth-card">
        <div className="auth-intro">
          <span className="auth-symbol">
            {mode === "admin" ? <Shield /> : <UserRound />}
          </span>
          <h1>
            {mode === "login"
              ? t("Entre no seu radar")
              : mode === "admin"
                ? t("Cadastre o administrador")
                : t("Crie sua conta")}
          </h1>
          <p>
            {mode === "login"
              ? t("Suas viagens e alertas em um só lugar.")
              : mode === "admin"
                ? t(
                    "Gerencie o serviço de e-mail e mantenha suas buscas existentes.",
                  )
                : t("Escolha suas viagens. Nós acompanhamos os preços.")}
          </p>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!session) return;
            setBusy(true);
            setError("");
            try {
              const user: User = await api(
                mode === "login"
                  ? "/auth/login"
                  : mode === "admin"
                    ? "/auth/bootstrap"
                    : "/auth/register",
                session.token,
                {
                  name,
                  country,
                  phone,
                  password,
                  emails,
                  whatsapp_use_login: true,
                  whatsapp_country: country,
                },
              );
              client.clear();
              setPassword("");
              setSession({
                ...session,
                user,
                can_bootstrap: mode === "admin" ? false : session.can_bootstrap,
              });
            } catch (e) {
              setError(t((e as Error).message));
            } finally {
              setBusy(false);
            }
          }}
        >
          {mode !== "login" && (
            <label>
              {t("Seu nome")}
              <input
                required
                autoComplete="name"
                minLength={2}
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          <PhoneField
            label={t("Celular de acesso")}
            country={country}
            value={phone}
            onChange={(c, p) => {
              setCountry(c);
              setPhone(p);
            }}
          />
          <PasswordField
            key={mode}
            label={t("Senha")}
            required
            minLength={mode === "login" ? 1 : 10}
            maxLength={200}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode !== "login" && (
            <p className="help">{t("Use pelo menos dez caracteres.")}</p>
          )}
          {mode !== "login" && (
            <details className="optional-contacts">
              <summary>
                {t("Adicionar e-mails para alertas (opcional)")}
              </summary>
              <EmailFields values={emails} onChange={setEmails} />
            </details>
          )}
          {mode === "admin" && (
            <p className="help">
              {t(
                "Se já cadastrou esse telefone, use a senha da conta existente.",
              )}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button className="full" type="submit" disabled={busy || !session}>
            {busy
              ? t("Aguarde…")
              : mode === "login"
                ? t("Entrar")
                : mode === "admin"
                  ? t("Criar administrador")
                  : t("Criar conta")}
          </Button>
        </form>
        {mode === "login" && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setRecovery(true)}
          >
            {t("Esqueci minha senha")}
          </Button>
        )}
        {session?.registration_open !== false ? (
          <div className="auth-switch">
            <span>
              {mode === "login"
                ? t("Ainda não tem conta?")
                : t("Já tem uma conta?")}
            </span>
            <Button
              variant="ghost"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
                setPassword("");
              }}
            >
              {mode === "login" ? t("Criar conta") : t("Entrar")}
            </Button>
          </div>
        ) : (
          <p className="help">{t("Solicite seu cadastro ao administrador.")}</p>
        )}
        {session?.can_bootstrap && mode !== "admin" && (
          <button
            className="bootstrap-link"
            onClick={() => {
              setMode("admin");
              setError("");
            }}
          >
            <Shield size={15} />
            {t("Configurar o primeiro administrador neste Mac")}
          </button>
        )}
        {mode === "admin" && (
          <p className="help">
            {t(
              "Esta configuração inicial só está disponível neste computador.",
            )}
          </p>
        )}
      </Card>
    </main>
  );
}
export function Profile({
  user,
  token,
  onSaved,
  onLogout,
  isBusy = false,
  preferences,
}: {
  user: User;
  token: string;
  onSaved: () => Promise<unknown>;
  onLogout: () => Promise<void>;
  isBusy?: boolean;
  preferences?: ReactNode;
}) {
  const [draft, setDraft] = useState(() => structuredClone(user)),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const contacts = (value: User) => [
    value.name,
    value.emails,
    value.whatsapp_use_login,
    value.whatsapp_country,
    value.whatsapp_phone,
    value.telegram_username,
    value.additional_phones || [],
    value.quiet_hours,
    value.quiet_start,
    value.quiet_end,
    value.timezone,
  ];
  useUnsavedChanges(
    JSON.stringify(contacts(draft)) !== JSON.stringify(contacts(user)),
  );
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    try { new Intl.DateTimeFormat(getLocale(), {timeZone: draft.timezone}).format(); }
    catch { setError(t("Escolha um fuso horário válido da lista.")); return; }
    setBusy(true);
    try {
      const updated: User = await api(
        "/profile",
        token,
        {
          additional_phones: draft.additional_phones || [],
          timezone: draft.timezone,
          quiet_hours: draft.quiet_hours,
          quiet_start: draft.quiet_start,
          quiet_end: draft.quiet_end,
          name: draft.name,
          telegram_username: draft.telegram_username,
          emails: draft.emails,
          whatsapp_use_login: draft.whatsapp_use_login,
          whatsapp_country: draft.whatsapp_country,
          whatsapp_phone: draft.whatsapp_phone,
        },
        "PUT",
      );
      setDraft(updated);
      await onSaved();
      setMessage(t("Seus contatos foram salvos."));
    } catch (e) {
      setError(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="profile-grid compact-profile">
      <Card className="profile-identity">
        <div>
          <span>{t("Sua conta")}</span>
          <strong>{user.name}</strong>
          <small>{user.phone}</small>
        </div>
        <Button variant="outline" disabled={busy || isBusy} onClick={onLogout}>
          <LogOut size={16} />
          {t("Sair da conta")}
        </Button>
      </Card>
      <form className="profile-form" onSubmit={save}>
        <Card className="profile-card profile-contacts">
          <h2>
            <UserRound size={20} />
            {t("Meu cadastro")}
          </h2>

          <label>
            {t("Seu nome")}
            <input
              required
              autoComplete="name"
              minLength={2}
              maxLength={80}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <details className="profile-section" open>
            <summary>
              {t("E-mails de alerta")} <span>{draft.emails.length}/4</span>
            </summary>
            <EmailFields
              compact
              values={draft.emails}
              onChange={(emails) => setDraft({ ...draft, emails })}
            />
          </details>
          <details className="profile-section">
            <summary>{t("WhatsApp")}</summary>
            <fieldset className="whatsapp-contact">
              <legend>{t("Número para WhatsApp")}</legend>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.whatsapp_use_login}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      whatsapp_use_login: e.target.checked,
                      whatsapp_phone: e.target.checked ? user.phone : "",
                    })
                  }
                />
                {t("Usar meu telefone de acesso")}
              </label>
              {draft.whatsapp_use_login ? (
                <p className="contact-preview">{user.phone}</p>
              ) : (
                <PhoneField
                  label={t("Outro número para WhatsApp")}
                  country={draft.whatsapp_country}
                  value={draft.whatsapp_phone || ""}
                  onChange={(country, phone) =>
                    setDraft({
                      ...draft,
                      whatsapp_country: country,
                      whatsapp_phone: phone,
                    })
                  }
                />
              )}
              <p className="help">
                {t(
                  "Você pode trocar este contato sem mudar seu telefone de acesso. Ative o WhatsApp nos alertas de cada busca.",
                )}
              </p>
            </fieldset>
          </details>
          <details className="profile-section">
            <summary>{t("Outros telefones")}</summary>
            <AdditionalPhones
              defaultCountry={user.country}
              values={draft.additional_phones || []}
              disabled={busy}
              onChange={(additional_phones) =>
                setDraft({ ...draft, additional_phones })
              }
            />
          </details>
        </Card>
        <Card className="profile-card profile-preferences">
          <h2>{t("Preferências")}</h2>
          {preferences}
          <details className="optional-contacts profile-section">
            <summary>{t("Horário silencioso")}</summary>
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.quiet_hours}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    quiet_hours: e.target.checked,

                  })
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
            <TimeZoneField value={draft.timezone} onChange={timezone => setDraft({ ...draft, timezone })} />
            <p className="help">
              {t(
                "As oportunidades continuam no painel. Alertas silenciados não são enviados depois. E-mails de segurança continuam ativos.",
              )}
            </p>
          </details>
        </Card>
        <div className="profile-form-footer">
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="profile-success" role="status">
              {message}
            </p>
          )}
          <Button disabled={busy} type="submit">
            {busy ? t("Salvando…") : t("Salvar meus dados")}
          </Button>
        </div>
      </form>
      <AuditPanel />
    </div>
  );
}
