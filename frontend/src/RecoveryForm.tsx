import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Mail, MessageCircle } from "lucide-react";
import { clsx } from "clsx";
import { t } from "./i18n";
import { api, errorStatus, retryAfter } from "./authApi";
import { Button, Card } from "./ui";
import { PhoneField } from "./PhoneField";
import { PasswordField } from "./PasswordField";
import { CodeField } from "./CodeField";
import { QuickPreferences } from "./QuickPreferences";
import { SystemVersion } from "./SystemVersion";
import { AppIcon } from "./AppIcon";
import { usePageTitle } from "./pageTitle";

type Channel = "whatsapp" | "email";
/** Wait before another code: the server sends at most one a minute per account. */
export const RESEND_SECONDS = 60;
/** The server's refusal of the code itself (wrong, spent or expired), as recovery.WRONG_CODE. */
const WRONG_CODE = "Código inválido ou vencido. Peça um novo.";
/** "14:05" for 845 seconds. */
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** A recovery request with a fresh form token: the screen may stay open across a server restart. */
async function post(path: string, body: unknown) {
  let token: string;
  try {
    const r = await fetch("/api/auth/session", { cache: "no-store" });
    if (!r.ok) throw Error();
    token = (await r.json()).token;
  } catch {
    throw Error(t("Não foi possível conectar ao radar."));
  }
  return api(path, token, body);
}

/**
 * "Esqueci minha senha": the login phone and the channel of the code, then, on
 * the same screen, the code and the new password. The server answers the same
 * whether or not the account exists; a new phone or channel asks for a new code.
 */
export function RecoveryForm({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  usePageTitle(t("Recuperar acesso"));
  const [country, setCountry] = useState("BR"),
    [phone, setPhone] = useState(""),
    [channel, setChannel] = useState<Channel>("whatsapp"),
    [sent, setSent] = useState(false),
    [code, setCode] = useState(""),
    [password, setPassword] = useState(""),
    [wait, setWait] = useState(0),
    // Seconds left of a login lock (HTTP 429): the code stays valid and waits.
    [locked, setLocked] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    // The server refused the code (wrong, spent or expired).
    [invalid, setInvalid] = useState(false);
  const hint = useId(),
    errorId = useId(),
    passwordHelp = useId();
  const codeInput = useRef<HTMLInputElement>(null),
    passwordInput = useRef<HTMLInputElement>(null);
  // The resend button counts the wait down, one second at a time.
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);
  // So does "Criar nova senha" during a lock; its notice goes when the lock ends.
  useEffect(() => {
    if (locked <= 0) return;
    const timer = setTimeout(() => {
      if (locked === 1) setError("");
      setLocked(locked - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [locked]);
  /** Another phone or channel: back to the first step, for a new code. Another phone (another account)
   * also ends the waits, which belong to the former one. */
  function edit(phone: boolean) {
    if (phone) {
      setWait(0);
      setLocked(0);
    }
    if (!sent) return;
    setSent(false);
    setCode("");
    setInvalid(false);
    setError("");
  }
  async function send() {
    setBusy(true);
    setError("");
    setInvalid(false);
    try {
      await post("/auth/recovery", { country, phone, channel });
      setSent(true);
      setCode("");
      setWait(RESEND_SECONDS);
    } catch (e) {
      setError(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!sent) return void send();
    // The server counts characters (code points): an emoji is one, where the browser's minLength counts two.
    if ([...password].length < 10) {
      setError(t("Use pelo menos dez caracteres."));
      passwordInput.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    setInvalid(false);
    try {
      await post("/auth/recovery/confirm", { country, phone, code, password });
      setPassword("");
      onDone();
    } catch (e) {
      const message = (e as Error).message;
      if (errorStatus(e) === 429) {
        // The login lock: the code took no try and stays as typed.
        const seconds = Math.max(1, retryAfter(e) ?? 60);
        setLocked(seconds);
        setError(
          t("Acesso bloqueado temporariamente por tentativas erradas. Tente de novo em {0} min ou peça ao administrador para redefinir a senha.", [
            Math.max(1, Math.ceil(seconds / 60)),
          ]),
        );
        return;
      }
      // Only the refusal of the code clears it; another refusal (a field out of range) keeps what was typed.
      if (message === t(WRONG_CODE)) {
        setInvalid(true);
        setCode("");
        codeInput.current?.focus();
      }
      setError(t(message));
    } finally {
      setBusy(false);
    }
  }
  const channels: { key: Channel; label: string; icon: typeof Mail }[] = [
    { key: "whatsapp", label: t("WhatsApp"), icon: MessageCircle },
    { key: "email", label: t("E-mail"), icon: Mail },
  ];
  const waiting = wait > 0 && t("Reenviar em {0} s", [wait]);
  return (
    <main className="auth-page">
      <div className="auth-toolbar">
        <QuickPreferences />
      </div>
      <Card className="auth-card">
        <div className="auth-intro">
          <AppIcon size="lg" />
          <h1>{t("Radar de Voos")}</h1>
          <h2 className="auth-heading">{t("Recuperar acesso")}</h2>
          <p id={hint}>
            {!sent
              ? t("Enviamos um código para o WhatsApp ou o e-mail da sua conta.")
              : channel === "whatsapp"
                ? t("Digite o código que chegou no seu WhatsApp.")
                : t("Digite o código que chegou no seu e-mail.")}
          </p>
        </div>
        <form onSubmit={submit}>
          <PhoneField
            label={t("Celular de acesso")}
            country={country}
            value={phone}
            onChange={(c, p) => {
              setCountry(c);
              setPhone(p);
              edit(true);
            }}
          />
          <fieldset className="channel-choice">
            <legend>{t("Receber o código por")}</legend>
            <div className="channel-options">
              {channels.map(({ key, label, icon: Icon }) => (
                <label key={key} className="channel-option">
                  <input
                    type="radio"
                    name="recovery-channel"
                    value={key}
                    checked={channel === key}
                    onChange={() => {
                      setChannel(key);
                      edit(false);
                    }}
                  />
                  <span className="channel-card">
                    <Icon size={18} aria-hidden="true" />
                    {label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {/* In the page before the code is sent, so the notice is announced when it arrives. */}
          <p className={clsx("auth-notice", !sent && "is-empty")} role="status">
            {sent &&
              (channel === "whatsapp"
                ? t("Se a conta existir e tiver WhatsApp cadastrado, o código chega em instantes.")
                : t("Se a conta existir e tiver e-mail cadastrado, o código chega em instantes."))}
          </p>
          {sent && (
            <>
              <CodeField
                ref={codeInput}
                autoFocus
                label={channel === "whatsapp" ? t("Código recebido no WhatsApp") : t("Código recebido no e-mail")}
                aria-invalid={invalid || undefined}
                aria-describedby={error ? `${errorId} ${hint}` : hint}
                value={code}
                onValue={(value) => {
                  setCode(value);
                  setInvalid(false);
                }}
              />
              <PasswordField
                ref={passwordInput}
                label={t("Nova senha")}
                required
                minLength={10}
                maxLength={200}
                autoComplete="new-password"
                aria-describedby={passwordHelp}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p id={passwordHelp} className="help">
                {t("Pelo menos 10 caracteres.")}
              </p>
            </>
          )}
          <p id={errorId} className={clsx("form-error", !error && "is-empty")} role="alert">
            {error}
          </p>
          <Button
            className="full"
            size="large"
            type="submit"
            disabled={busy || (sent ? code.length < 6 || !password || locked > 0 : wait > 0)}
          >
            {busy
              ? t("Aguarde…")
              : sent
                ? locked > 0
                  ? t("Criar nova senha em {0}", [clock(locked)])
                  : t("Criar nova senha")
                : waiting || t("Enviar código")}
          </Button>
        </form>
        <div className="auth-links">
          {sent && (
            <Button type="button" variant="ghost" disabled={busy || wait > 0} onClick={() => void send()}>
              {waiting || t("Reenviar código")}
            </Button>
          )}
          <Button type="button" variant="ghost" disabled={busy} onClick={onBack}>
            {t("Voltar ao login")}
          </Button>
        </div>
        <p className="auth-note">{t("Sem WhatsApp ou e-mail na conta? Peça ao administrador para redefinir a senha.")}</p>
      </Card>
      <footer className="auth-footer">
        <SystemVersion />
      </footer>
    </main>
  );
}
