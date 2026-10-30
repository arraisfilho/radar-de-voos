import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Shield } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { t } from "./i18n";
import { api, errorStatus, type Session } from "./authApi";
import { Button, Card } from "./ui";
import { PhoneField } from "./PhoneField";
import { PasswordField } from "./PasswordField";
import { CodeField } from "./CodeField";
import { EmailFields } from "./EmailFields";
import { QuickPreferences } from "./QuickPreferences";
import { SystemVersion } from "./SystemVersion";
import { AppIcon } from "./AppIcon";
import { usePageTitle } from "./pageTitle";
import type { User } from "./types";

/** Answer of /auth/login for an account with two-step verification: no session yet. */
type TwoFactorChallenge = { two_factor_required: true; expires_in: number };

/**
 * Sign-in, sign-up and the first administrator. Loaded on demand, so signed-in
 * visits never download the phone number library at startup. An account with
 * two-step verification gets a code step after the password, in the same card.
 * `notice` (a new password was set) shows above the login fields.
 */
export function SignIn({
  session,
  notice,
  onSignedIn,
  onRecover,
}: {
  session: Session;
  notice?: string;
  onSignedIn: (session: Session) => void;
  onRecover: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState<"login" | "register" | "admin">("login");
  const [name, setName] = useState(""),
    [country, setCountry] = useState("BR"),
    [phone, setPhone] = useState(""),
    [password, setPassword] = useState(""),
    [emails, setEmails] = useState<string[]>([]);
  // The code step replaces the password form: "app" asks for the authenticator
  // code, "recovery" for one of the codes saved when the verification was turned on.
  const [step, setStep] = useState<"password" | "code">("password"),
    [method, setMethod] = useState<"app" | "recovery">("app"),
    [code, setCode] = useState(""),
    [recoveryCode, setRecoveryCode] = useState(""),
    // The server refused the code itself (wrong or malformed), not the attempt.
    [invalid, setInvalid] = useState(false);
  const client = useQueryClient();
  const hint = useId(),
    errorId = useId();
  const passwordInput = useRef<HTMLInputElement>(null),
    codeInput = useRef<HTMLInputElement>(null),
    // Back from the code step, the password field takes the focus.
    leftCodeStep = useRef(false);
  useEffect(() => {
    if (step === "code") leftCodeStep.current = true;
    else if (leftCodeStep.current) {
      leftCodeStep.current = false;
      passwordInput.current?.focus();
    }
  }, [step]);
  usePageTitle(
    step === "code"
      ? t("Verificação em duas etapas")
      : mode === "login"
        ? t("Entrar")
        : mode === "admin"
          ? t("Configurar administrador")
          : t("Criar conta"),
  );
  function signedIn(user: User) {
    client.clear();
    setPassword("");
    onSignedIn({
      ...session,
      user,
      can_bootstrap: mode === "admin" ? false : session.can_bootstrap,
    });
  }
  /** Back to the password, with the reason when the code step expired. */
  function backToPassword(message = "") {
    setStep("password");
    setCode("");
    setRecoveryCode("");
    setInvalid(false);
    setError(message);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result: User | TwoFactorChallenge = await api(
        mode === "login" ? "/auth/login" : mode === "admin" ? "/auth/bootstrap" : "/auth/register",
        session.token,
        {
          name,
          country,
          phone,
          password,
          emails,
          whatsapp_use_login: true,
          whatsapp_country: country,
          // New accounts take this device's time zone (alert times, quiet hours); the profile can change it.
          ...(mode !== "login" && { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" }),
        },
      );
      if ("two_factor_required" in result && result.two_factor_required) {
        // The password is already checked; the code step does not keep it.
        setPassword("");
        setCode("");
        setRecoveryCode("");
        setMethod("app");
        setStep("code");
        return;
      }
      signedIn(result as User);
    } catch (e) {
      setError(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInvalid(false);
    try {
      const user: User = await api(
        "/auth/login/2fa",
        session.token,
        method === "app" ? { code } : { recovery_code: recoveryCode.trim() },
      );
      signedIn(user);
    } catch (e) {
      // 410: the five minutes to type the code are over; the password is asked again.
      const status = errorStatus(e);
      if (status === 410) {
        backToPassword(t((e as Error).message));
        return;
      }
      // 401 and 422 refuse the code; 429 and 503 (the server's key missing: only a
      // recovery code works) keep it valid, and the recovery code stays one click away.
      setInvalid(status === 401 || status === 422);
      setError(t((e as Error).message));
      if (method === "app") setCode("");
      codeInput.current?.focus();
    } finally {
      setBusy(false);
    }
  }
  const coding = step === "code";
  return (
    <main className="auth-page">
      <div className="auth-toolbar">
        <QuickPreferences />
      </div>
      <Card className="auth-card">
        <div className="auth-intro">
          <AppIcon size="lg" />
          <h1>{t("Radar de Voos")}</h1>
          <h2 className="auth-heading">
            {coding
              ? t("Verificação em duas etapas")
              : mode === "login"
                ? t("Entre no seu radar")
                : mode === "admin"
                  ? t("Cadastre o administrador")
                  : t("Crie sua conta")}
          </h2>
          <p id={hint}>
            {coding
              ? method === "app"
                ? t("Digite o código de 6 dígitos do seu aplicativo autenticador.")
                : t("Digite um dos códigos de recuperação que você guardou ao ativar a verificação.")
              : mode === "login"
                ? t("Suas viagens e alertas em um só lugar.")
                : mode === "admin"
                  ? t("Gerencie o serviço de e-mail e mantenha suas buscas existentes.")
                  : t("Escolha suas viagens. Nós acompanhamos os preços.")}
          </p>
        </div>
        <form onSubmit={coding ? verify : submit}>
          {coding ? (
            method === "app" ? (
              <CodeField
                key="app"
                ref={codeInput}
                autoFocus
                label={t("Código do aplicativo")}
                aria-invalid={invalid || undefined}
                aria-describedby={error ? `${errorId} ${hint}` : hint}
                value={code}
                onValue={(value) => {
                  setCode(value);
                  setInvalid(false);
                }}
              />
            ) : (
              <label key="recovery">
                {t("Código de recuperação")}
                <input
                  ref={codeInput}
                  autoFocus
                  required
                  className="recovery-input"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={40}
                  placeholder={t("xxxx-xxxx-xxxx-xxxx")}
                  aria-invalid={invalid || undefined}
                  aria-describedby={error ? `${errorId} ${hint}` : hint}
                  value={recoveryCode}
                  onChange={(e) => {
                    setRecoveryCode(e.target.value);
                    setInvalid(false);
                  }}
                />
              </label>
            )
          ) : (
            <>
              {mode === "login" && notice && (
                <p className="auth-notice" role="status">
                  {notice}
                </p>
              )}
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
                ref={passwordInput}
                label={t("Senha")}
                required
                minLength={mode === "login" ? 1 : 10}
                maxLength={200}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {mode !== "login" && <p className="help">{t("Use pelo menos dez caracteres.")}</p>}
              {mode !== "login" && (
                <details className="optional-contacts">
                  <summary>{t("Adicionar e-mail (opcional)")}</summary>
                  <p className="help">{t("O código para criar uma nova senha também pode chegar por e-mail.")}</p>
                  <EmailFields compact values={emails} onChange={setEmails} />
                </details>
              )}
              {mode === "admin" && (
                <p className="help">{t("Se já cadastrou esse telefone, use a senha da conta existente.")}</p>
              )}
            </>
          )}
          {/* One alert region for both steps, there before any message (as Notice in
              ui.tsx): an error that arrives with a change of step is announced too. */}
          <p id={errorId} className={clsx("form-error", !error && "is-empty")} role="alert">
            {error}
          </p>
          <Button className="full" size="large" type="submit" disabled={busy}>
            {busy
              ? t("Aguarde…")
              : coding
                ? t("Verificar")
                : mode === "login"
                  ? t("Entrar")
                  : mode === "admin"
                    ? t("Criar administrador")
                    : t("Criar conta")}
          </Button>
        </form>
        {coding ? (
          <>
            {/* Disabled while a code is checked: a late answer must find the same step. */}
            <div className="auth-links">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setMethod(method === "app" ? "recovery" : "app");
                  setInvalid(false);
                  setError("");
                }}
              >
                {method === "app" ? t("Usar código de recuperação") : t("Usar o código do aplicativo")}
              </Button>
            </div>
            <div className="auth-switch">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => backToPassword()}>
                <ArrowLeft size={16} aria-hidden="true" />
                {t("Voltar")}
              </Button>
            </div>
          </>
        ) : (
          <>
            {mode === "login" && (
              <div className="auth-links">
                <Button type="button" variant="ghost" disabled={busy} onClick={onRecover}>
                  {t("Esqueci minha senha")}
                </Button>
              </div>
            )}
            {session.registration_open !== false ? (
              <div className="auth-switch">
                <span>{mode === "login" ? t("Ainda não tem conta?") : t("Já tem uma conta?")}</span>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
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
              <p className="auth-note">{t("Solicite seu cadastro ao administrador.")}</p>
            )}
            {session.can_bootstrap && mode !== "admin" && (
              <button
                type="button"
                className="bootstrap-link"
                disabled={busy}
                onClick={() => {
                  setMode("admin");
                  setError("");
                }}
              >
                <Shield size={16} aria-hidden="true" />
                {t("Configurar administrador")}
              </button>
            )}
            {mode === "admin" && (
              <p className="auth-note">{t("Esta configuração inicial só está disponível neste computador.")}</p>
            )}
          </>
        )}
      </Card>
      <footer className="auth-footer">
        <SystemVersion />
      </footer>
    </main>
  );
}
