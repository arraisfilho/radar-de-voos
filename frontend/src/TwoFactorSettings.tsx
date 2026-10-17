import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, LoaderCircle, RotateCw, Smartphone } from "lucide-react";
import { clsx } from "clsx";
import { api, errorStatus } from "./authApi";
import { copyText } from "./clipboard";
import { CodeField } from "./CodeField";
import { formatDate, formatDateTime } from "./format";
import { getLanguage, t, type Language } from "./i18n";
import { useUnsavedChanges } from "./navigationGuard";
import { PasswordField } from "./PasswordField";
import { plural } from "./plural";
import { qrMatrix, qrPath } from "./qr";
import { Button, ConfirmDialog, Notice } from "./ui";

/** GET /api/auth/2fa: the administrator's second factor. */
export type TwoFactorStatus = {
  enabled: boolean;
  /** Epoch in seconds; null while off. */
  enabled_at: number | null;
  recovery_codes_remaining: number;
};
/** POST /api/auth/2fa/setup: the enrollment waiting for its first code. */
type Setup = { secret: string; uri: string; expires_in: number };
/** Recovery codes of a confirmation, for one account; `issuedAt` in milliseconds. */
export type Issued = { userId: string; codes: string[]; issuedAt: number };
/** The saved status, the enrollment, or the recovery codes shown once after it. */
type Stage = { name: "status" } | { name: "setup"; setup: Setup } | { name: "codes"; issued: Issued };

/** The status per account: a late answer for one account never lands in another's cache. */
const statusKey = (userId: string) => ["two-factor", userId];

// The codes of the last confirmation also live here, outside the component: an
// answer that arrives after the block left the page, or a return to the profile,
// shows them again. In memory only, for the account that received them and for
// ten minutes; "Concluir" and signing out forget them.
const ISSUED_FOR = 10 * 60_000;
let issued: Issued | null = null;
export function keepIssuedCodes(userId: string, codes: string[], issuedAt = Date.now()): Issued {
  return (issued = { userId, codes, issuedAt });
}
export function issuedCodes(userId: string, now = Date.now()): Issued | null {
  if (issued && (issued.userId !== userId || now - issued.issuedAt > ISSUED_FOR)) issued = null;
  return issued;
}
export function forgetIssuedCodes() {
  issued = null;
}
// Signing out announces itself (Accounts.tsx); the chunk is loaded whenever codes exist.
if (typeof window !== "undefined") window.addEventListener("radar:signed-out", forgetIssuedCodes);

/** Names of the downloaded file: ASCII, in the language of the page. */
const RECOVERY_FILES: Record<Language, string> = {
  pt: "radar-de-voos-codigos-de-recuperacao.txt",
  en: "flight-radar-recovery-codes.txt",
  es: "radar-de-vuelos-codigos-de-recuperacion.txt",
};
export const recoveryFileName = () => RECOVERY_FILES[getLanguage()];

/** The secret in groups of four characters, as authenticator apps print it. */
export function groupSecret(secret: string): string {
  return (secret.replace(/\s/g, "").match(/.{1,4}/g) || []).join(" ");
}

/**
 * Text of the downloaded file: a title that names "Radar de Voos" (the issuer the
 * authenticator app shows), when and for which address the codes were issued, a
 * blank line, then one code per line.
 */
export function recoveryCodesText(codes: string[], issuedAt: Date, host: string): string {
  return [
    t("Radar de Voos: códigos de recuperação"),
    t("Emitidos em {0} para {1}", [formatDateTime(issuedAt), host]),
    "",
    ...codes,
    "",
  ].join("\n");
}

/** Saves the recovery codes as a text file, through a temporary link. */
export function downloadRecoveryCodes(kept: Issued) {
  const text = recoveryCodesText(kept.codes, new Date(kept.issuedAt), location.host);
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = recoveryFileName();
  document.body.append(link);
  link.click();
  link.remove();
  // Safari may read the file after click() returns: the address stays valid for a minute.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The otpauth:// address as a QR code: dark modules on a light field in both appearances. */
function QrCode({ value }: { value: string }) {
  const { size, path } = useMemo(() => qrPath(qrMatrix(value)), [value]);
  return (
    <svg
      className="two-factor-qr"
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={t("QR code para configurar o aplicativo autenticador")}
    >
      <path d={path} />
    </svg>
  );
}

function CopyButton({ done, label, onCopy }: { done: boolean; label: string; onCopy: () => void }) {
  return (
    <Button type="button" variant="outline" size="small" onClick={onCopy}>
      {done ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      {done ? t("Copiado") : label}
    </Button>
  );
}

/**
 * Two-step verification of the administrator, in Perfil > Segurança: the status,
 * the enrollment (password, then a QR code), the recovery codes shown once, and
 * turning it off with the password. Loaded on demand, with the QR code library.
 */
export function TwoFactorSettings({ token, userId }: { token: string; userId: string }) {
  const client = useQueryClient();
  const status = useQuery<TwoFactorStatus>({
    queryKey: statusKey(userId),
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/auth/2fa", { cache: "no-store", signal });
      if (!response.ok) throw Error(t("Não foi possível carregar a verificação em duas etapas."));
      return response.json();
    },
  });
  // Codes still kept for this account (an answer after the block left the page) come back first.
  const [stage, setStage] = useState<Stage>(() => {
      const kept = issuedCodes(userId);
      return kept ? { name: "codes", issued: kept } : { name: "status" };
    }),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    // Messages of the block, in regions mounted in every view (see Notice in ui.tsx).
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    // The server refused the confirmation code itself.
    [invalid, setInvalid] = useState(false),
    [copied, setCopied] = useState(""),
    // The password dialog: before the enrollment ("start") or to turn it off ("stop").
    [dialog, setDialog] = useState<"start" | "stop" | null>(null),
    [password, setPassword] = useState(""),
    [dialogError, setDialogError] = useState("");
  const titleId = useId(),
    expiryId = useId(),
    errorId = useId();
  const heading = useRef<HTMLHeadingElement>(null),
    stepHeading = useRef<HTMLHeadingElement>(null),
    codeInput = useRef<HTMLInputElement>(null),
    passwordInput = useRef<HTMLInputElement>(null),
    copiedTimer = useRef(0),
    // Set by an action that replaces the content: its title takes the focus.
    moveFocus = useRef(false),
    // A message that waits for the dialog to leave, so it is announced.
    afterDialog = useRef<{ error?: string; notice?: string; focus?: boolean } | null>(null);
  const data = status.data;
  const view =
    stage.name !== "status" ? stage.name : !data ? (status.isError ? "error" : "loading") : data.enabled ? "on" : "off";
  // Leaving asks first while the enrollment is open (a confirmation may be on its
  // way) and while the recovery codes, shown once, are on screen.
  useUnsavedChanges(
    view === "setup" || view === "codes",
    view === "codes"
      ? {
          title: t("Sair sem guardar os códigos?"),
          description: t("Os códigos de recuperação não serão mostrados de novo. Saia só depois de copiá-los ou baixá-los."),
          stay: t("Continuar aqui"),
          leave: t("Sair mesmo assim"),
        }
      : {
          title: t("Sair antes de concluir?"),
          description: t(
            "A ativação da verificação em duas etapas ainda não terminou. Se sair agora, volte ao perfil para concluí-la ou começar de novo.",
          ),
          stay: t("Continuar aqui"),
          leave: t("Sair mesmo assim"),
        },
  );
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (view === "setup" || view === "codes" ? stepHeading : heading).current?.focus();
  }, [view]);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  function go(next: Stage, focus = true) {
    moveFocus.current = focus;
    setCopied("");
    setInvalid(false);
    setStage(next);
  }
  async function copy(item: string, text: string) {
    window.clearTimeout(copiedTimer.current);
    setError("");
    try {
      await copyText(text);
    } catch {
      setCopied("");
      setError(t("Não foi possível copiar. Selecione o texto e copie manualmente."));
      return;
    }
    setCopied(item);
    copiedTimer.current = window.setTimeout(() => setCopied(""), 2500);
  }
  function save(kept: Issued) {
    setError("");
    try {
      downloadRecoveryCodes(kept);
    } catch {
      setError(t("Não foi possível baixar o arquivo. Copie os códigos."));
    }
  }
  function openDialog(kind: "start" | "stop") {
    setError("");
    setNotice("");
    setPassword("");
    setDialogError("");
    setDialog(kind);
  }
  function closeDialog() {
    setDialog(null);
    setPassword("");
    setDialogError("");
  }
  /** The password of either dialog, checked by the server under the login limits. */
  async function sendPassword() {
    if (busy || !dialog) return;
    if (!password) {
      setDialogError(t("Digite sua senha para confirmar."));
      passwordInput.current?.focus();
      return;
    }
    const kind = dialog;
    setBusy(true);
    setDialogError("");
    try {
      if (kind === "start") {
        const setup: Setup = await api("/auth/2fa/setup", token, { password });
        setCode("");
        // The QR code's title takes the focus once the dialog has left and the page is
        // no longer hidden from assistive technology (showAfterDialog).
        afterDialog.current = { focus: true };
        closeDialog();
        go({ name: "setup", setup }, false);
      } else {
        const next: TwoFactorStatus = await api("/auth/2fa/disable", token, { password });
        await client.cancelQueries({ queryKey: statusKey(userId) });
        client.setQueryData(statusKey(userId), next);
        void client.invalidateQueries({ queryKey: ["audit"] });
        afterDialog.current = { notice: t("Verificação em duas etapas desativada.") };
        closeDialog();
      }
    } catch (e) {
      setPassword("");
      if (errorStatus(e) === 409) {
        // Turned on, or off, in another tab: the status reloads and the reason shows in the block.
        afterDialog.current = { error: (e as Error).message };
        moveFocus.current = true;
        closeDialog();
        void status.refetch();
      } else {
        setDialogError((e as Error).message);
        passwordInput.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  }
  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setInvalid(false);
    try {
      const { recovery_codes, ...next }: TwoFactorStatus & { recovery_codes: string[] } = await api(
        "/auth/2fa/confirm",
        token,
        { code },
      );
      // Kept before anything else: if the block already left the page, the codes wait for it.
      const kept = keepIssuedCodes(userId, recovery_codes);
      await client.cancelQueries({ queryKey: statusKey(userId) });
      client.setQueryData(statusKey(userId), next);
      void client.invalidateQueries({ queryKey: ["audit"] });
      setCode("");
      setNotice(t("Verificação em duas etapas ativada."));
      go({ name: "codes", issued: kept });
    } catch (e) {
      const failure = errorStatus(e);
      setCode("");
      setError((e as Error).message);
      // 410: ten minutes or too many wrong codes; 409: turned on elsewhere. Both start over.
      if (failure === 410 || failure === 409) {
        if (failure === 409) void status.refetch();
        go({ name: "status" });
      } else {
        setInvalid(failure === 422);
        codeInput.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  }
  function cancel() {
    setCode("");
    setError("");
    go({ name: "status" });
  }
  function finish() {
    forgetIssuedCodes();
    setError("");
    setNotice("");
    go({ name: "status" });
  }
  function showAfterDialog() {
    const message = afterDialog.current;
    afterDialog.current = null;
    if (message?.error) setError(message.error);
    if (message?.notice) setNotice(message.notice);
    if (message?.focus) stepHeading.current?.focus();
  }
  // One password field for both dialogs (only one is open at a time); Enter sends it.
  const passwordForm = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void sendPassword();
      }}
    >
      <PasswordField
        ref={passwordInput}
        label={t("Sua senha")}
        required
        maxLength={200}
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
    </form>
  );

  const minutes = stage.name === "setup" ? Math.max(1, Math.round(stage.setup.expires_in / 60)) : 0;
  const shownError = error || (view === "error" ? t("Não foi possível carregar a verificação em duas etapas.") : "");
  return (
    <section className="list-group two-factor" aria-labelledby={titleId}>
      <div className="list-row two-factor-heading">
        <Smartphone size={18} aria-hidden="true" />
        <h3 id={titleId} ref={heading} tabIndex={-1} className="list-row-label two-factor-title">
          {t("Verificação em duas etapas")}
        </h3>
        {data && (
          <span className={clsx("status-pill", data.enabled && "is-active")}>
            {data.enabled ? t("Ativada") : t("Desativada")}
          </span>
        )}
      </div>
      {/* A success that comes with a change of view (on, off) is announced from here. */}
      <div className={clsx("two-factor-messages", notice && "is-shown")}>
        <Notice onDismiss={() => setNotice("")}>{notice}</Notice>
      </div>
      {view === "loading" && (
        <div className="form-block" role="status">
          <span className="sr-only">{t("Carregando…")}</span>
          <span className="skeleton skeleton-line two-factor-skeleton" aria-hidden="true" />
        </div>
      )}
      {view === "off" && (
        <div className="form-block two-factor-body">
          <p className="two-factor-text">
            {t(
              "Além da senha, o login pedirá um código de 6 dígitos gerado por um aplicativo autenticador no seu celular.",
            )}
          </p>
          <div className="two-factor-actions">
            <Button type="button" size="small" onClick={() => openDialog("start")}>
              {t("Ativar")}
            </Button>
          </div>
        </div>
      )}
      {view === "on" && data && (
        <>
          <p className="list-row">
            <span className="list-row-label">
              {data.enabled_at ? t("Ativada desde {0}", [formatDate(data.enabled_at)]) : t("Ativada")}
            </span>
          </p>
          <p className="list-row">
            <span className="list-row-label">{t("Códigos de recuperação")}</span>
            <span className="list-row-detail">
              {plural(data.recovery_codes_remaining, "{0} restante", "{0} restantes")}
            </span>
          </p>
          <div className="form-block two-factor-body">
            {data.recovery_codes_remaining <= 3 && (
              <p className="two-factor-text">
                {t("Para gerar novos códigos de recuperação, desative e ative a verificação de novo.")}
              </p>
            )}
            <div className="two-factor-actions">
              <Button type="button" variant="danger" size="small" onClick={() => openDialog("stop")}>
                {t("Desativar")}
              </Button>
            </div>
          </div>
        </>
      )}
      {stage.name === "setup" && (
        <>
          <div className="form-block two-factor-body">
            <h4 ref={stepHeading} tabIndex={-1} className="two-factor-step">
              {t("Escaneie o QR code")}
            </h4>
            <p className="two-factor-text">{t("Abra o aplicativo autenticador no celular e escaneie este código.")}</p>
            <QrCode value={stage.setup.uri} />
            <p className="two-factor-text">
              <strong>{t("Não consegue ler o QR code?")}</strong> {t("Digite esta chave no aplicativo:")}
            </p>
            <p className="two-factor-secret" translate="no">
              {groupSecret(stage.setup.secret)}
            </p>
            <div className="two-factor-actions">
              <CopyButton
                done={copied === "secret"}
                label={t("Copiar chave")}
                onCopy={() => void copy("secret", stage.setup.secret.replace(/\s/g, ""))}
              />
            </div>
            {/* The otpauth:// address, for password managers that take it: selectable even
                where copying is blocked. */}
            <details className="two-factor-link">
              <summary>{t("Mostrar link de configuração")}</summary>
              <textarea
                className="two-factor-uri"
                readOnly
                rows={3}
                spellCheck={false}
                aria-label={t("Link de configuração")}
                value={stage.setup.uri}
                onFocus={(event) => event.currentTarget.select()}
              />
              <CopyButton
                done={copied === "uri"}
                label={t("Copiar link")}
                onCopy={() => void copy("uri", stage.setup.uri)}
              />
            </details>
          </div>
          <form className="form-block two-factor-body two-factor-confirm" onSubmit={confirm}>
            <CodeField
              ref={codeInput}
              label={t("Código de 6 dígitos do aplicativo")}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? `${errorId} ${expiryId}` : expiryId}
              value={code}
              onValue={(value) => {
                setCode(value);
                setInvalid(false);
              }}
            />
            <p className="two-factor-text" id={expiryId}>
              {plural(minutes, "A configuração expira em {0} minuto.", "A configuração expira em {0} minutos.")}{" "}
              {t("Ao confirmar, as outras sessões abertas da sua conta serão encerradas; esta continua.")}
            </p>
            <div className="two-factor-actions is-end">
              {/* Disabled during the confirmation: its answer must find the setup on screen. */}
              <Button type="button" variant="ghost" size="small" disabled={busy} onClick={cancel}>
                {t("Cancelar")}
              </Button>
              <Button type="submit" size="small" aria-disabled={busy || undefined}>
                {busy && <LoaderCircle size={16} className="spin" aria-hidden="true" />}
                {t("Confirmar")}
              </Button>
            </div>
          </form>
        </>
      )}
      {stage.name === "codes" && (
        <div className="form-block two-factor-body">
          <h4 ref={stepHeading} tabIndex={-1} className="two-factor-step">
            {t("Guarde seus códigos de recuperação")}
          </h4>
          <p className="two-factor-text">
            {t("Se perder o acesso ao aplicativo autenticador, entre com um destes códigos. Cada código vale uma vez.")}
          </p>
          {/* role="list": Safari drops the list semantics of a list without bullets. */}
          <ul className="two-factor-codes" role="list" translate="no" aria-label={t("Códigos de recuperação")}>
            {stage.issued.codes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="two-factor-warning">
            {t("Eles não serão mostrados de novo. Copie ou baixe agora e guarde em um lugar seguro.")}
          </p>
          <div className="two-factor-actions">
            <CopyButton
              done={copied === "codes"}
              label={t("Copiar")}
              onCopy={() => void copy("codes", stage.issued.codes.join("\n"))}
            />
            <Button type="button" variant="outline" size="small" onClick={() => save(stage.issued)}>
              <Download size={16} aria-hidden="true" />
              {t("Baixar")}
            </Button>
            <Button type="button" size="small" className="two-factor-done" onClick={finish}>
              {t("Concluir")}
            </Button>
          </div>
        </div>
      )}
      {/* Errors of every view (loading, API, copy, download), next to the actions at the end of the block. */}
      <div className={clsx("two-factor-messages", shownError && "is-shown")}>
        <Notice tone="error" id={errorId} onDismiss={error ? () => setError("") : undefined}>
          {shownError}
        </Notice>
        {view === "error" && (
          <div className="two-factor-actions">
            <Button type="button" variant="outline" size="small" onClick={() => void status.refetch()}>
              <RotateCw size={16} aria-hidden="true" />
              {t("Tentar novamente")}
            </Button>
          </div>
        )}
      </div>
      {/* Copy results for screen readers; the button's own label changes too. */}
      <p className="sr-only" role="status" aria-live="polite">
        {copied ? t("Copiado para a área de transferência.") : ""}
      </p>
      <ConfirmDialog
        open={dialog === "start"}
        onOpenChange={(open) => !open && closeDialog()}
        title={t("Ativar a verificação em duas etapas")}
        description={t("Para proteger sua conta, confirme sua senha antes de ligar um aplicativo autenticador a ela.")}
        confirmLabel={t("Continuar")}
        confirmVariant="primary"
        busy={busy}
        error={dialog === "start" ? dialogError : ""}
        initialFocus={passwordInput}
        onConfirm={() => void sendPassword()}
        onClosed={showAfterDialog}
      >
        {passwordForm}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "stop"}
        onOpenChange={(open) => !open && closeDialog()}
        title={t("Desativar a verificação em duas etapas?")}
        description={t("O login voltará a pedir só a senha, e os códigos de recuperação deixarão de valer.")}
        confirmLabel={t("Desativar")}
        busy={busy}
        error={dialog === "stop" ? dialogError : ""}
        initialFocus={passwordInput}
        onConfirm={() => void sendPassword()}
        onClosed={showAfterDialog}
      >
        {passwordForm}
      </ConfirmDialog>
    </section>
  );
}
