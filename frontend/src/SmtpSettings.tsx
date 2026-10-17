import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Save, Send, Server, Trash2 } from "lucide-react";
import { t } from "./i18n";
import { useUnsavedChanges } from "./navigationGuard";
import { Button, Card, ConfirmDialog, Notice } from "./ui";
import type { SMTP } from "./types";

type RequestFn = (path: string, body: unknown, method?: string) => Promise<unknown>;
type Draft = SMTP & { password: string };
/** The fields the form edits (the password is new text, never the saved one). */
const EDITABLE = ["enabled", "host", "port", "security", "username", "sender", "recipient"] as const;

/** Anything saved beyond the defaults (the API has no "exists" flag). */
const configured = (smtp: SMTP | null) =>
  !!smtp && !!(smtp.enabled || smtp.host || smtp.username || smtp.sender || smtp.recipient || smtp.password_set);

/**
 * Manual SMTP server for the alert e-mails, used when no Google account is
 * connected. Saving, testing and removing the configuration (administration,
 * e-mail channel).
 */
export function SmtpSettings({
  smtp,
  provider,
  request,
  onChanged,
}: {
  smtp: SMTP | null;
  provider: "google" | "smtp" | null;
  request: RequestFn;
  onChanged: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<Draft | null>(smtp ? { ...smtp, password: "" } : null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [confirm, setConfirm] = useState(false),
    [confirmError, setConfirmError] = useState(""),
    // The saved configuration the draft is compared with.
    [baseline, setBaseline] = useState<SMTP | null>(smtp);
  const id = useId();
  // The removal's success waits for its dialog to close (see Modal.onClosed).
  const closedMessage = useRef("");
  useEffect(() => {
    if (smtp && !draft) {
      setDraft({ ...smtp, password: "" });
      setBaseline(smtp);
    }
  }, [smtp]);
  // Switching channel or tab with unsaved changes asks first (navigationGuard).
  const reference = baseline || smtp;
  useUnsavedChanges(
    !!draft && !!reference && (draft.password !== "" || EDITABLE.some((key) => draft[key] !== reference[key])),
  );
  if (!draft) return null;
  const saved = configured(smtp);
  const inUse = provider === "smtp";
  const update = (part: Partial<Draft>) => setDraft({ ...draft, ...part });
  /** Runs a request; its error shows next to the form, or in the confirmation that ran it. */
  async function run(action: () => Promise<void>, fail: (message: string) => void = setError) {
    setBusy(true);
    setError("");
    setConfirmError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      fail(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    void run(async () => {
      const result = (await request("/smtp", draft, "PUT")) as SMTP;
      setDraft({ ...result, password: "" });
      setBaseline(result);
      await onChanged();
      setMessage(t("Configuração SMTP salva."));
    });
  }
  return (
    <Card className="channel-card disclosure-card">
      <details className="smtp-manual" id="smtp-settings" open={inUse || undefined}>
        <summary>
          <span className="channel-card-icon" aria-hidden="true">
            <Server size={20} />
          </span>
          <span className="disclosure-summary">
            <strong>{t("Servidor SMTP")}</strong>
            <small>
              {provider === "google"
                ? t("SMTP fora de uso")
                : smtp?.enabled
                  ? t("Serviço em uso: SMTP")
                  : t("Não configurado")}
            </small>
          </span>
        </summary>
        <form className="channel-form" onSubmit={save}>
          <fieldset disabled={busy} className="channel-fields">
            <label className="switch-row">
              <span>{t("Habilitar SMTP quando não houver conta conectada")}</span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={draft.enabled}
                onChange={(e) => update({ enabled: e.target.checked })}
              />
            </label>
            <div className="two-fields">
              <div className="field">
                <label className="field-label" htmlFor={id + "-host"}>
                  {t("Servidor SMTP")}
                </label>
                <input
                  id={id + "-host"}
                  required={draft.enabled}
                  placeholder={t("smtp.seuprovedor.com")}
                  autoComplete="off"
                  value={draft.host}
                  onChange={(e) => update({ host: e.target.value })}
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor={id + "-port"}>
                  {t("Porta")}
                </label>
                <input
                  id={id + "-port"}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={65535}
                  required
                  value={draft.port}
                  onChange={(e) => update({ port: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor={id + "-security"}>
                {t("Segurança")}
              </label>
              <select
                id={id + "-security"}
                value={draft.security}
                onChange={(e) =>
                  update({ security: e.target.value, port: e.target.value === "ssl" ? 465 : 587 })
                }
              >
                <option value="starttls">{t("STARTTLS (normalmente porta 587)")}</option>
                <option value="ssl">{t("TLS direto (normalmente porta 465)")}</option>
              </select>
            </div>
            <div className="field">
              <label className="field-label" htmlFor={id + "-user"}>
                {t("Usuário SMTP")}
              </label>
              <input
                id={id + "-user"}
                autoComplete="off"
                value={draft.username}
                onChange={(e) => update({ username: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={id + "-password"}>
                {t("Senha ou senha de aplicativo")}
              </label>
              <input
                id={id + "-password"}
                type="password"
                autoComplete="new-password"
                value={draft.password}
                placeholder={
                  draft.password_set ? t("Senha salva · deixe vazio para manter") : t("Digite a senha")
                }
                onChange={(e) => update({ password: e.target.value })}
              />
            </div>
            <div className="two-fields">
              <div className="field">
                <label className="field-label" htmlFor={id + "-sender"}>
                  {t("E-mail remetente")}
                </label>
                <input
                  id={id + "-sender"}
                  type="email"
                  required={draft.enabled}
                  placeholder={t("radar@seudominio.com")}
                  value={draft.sender}
                  onChange={(e) => update({ sender: e.target.value })}
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor={id + "-recipient"}>
                  {t("E-mail para testes")}
                </label>
                <input
                  id={id + "-recipient"}
                  type="email"
                  required={draft.enabled}
                  placeholder={t("voce@exemplo.com")}
                  value={draft.recipient}
                  onChange={(e) => update({ recipient: e.target.value })}
                />
              </div>
            </div>
          </fieldset>
          <div className="channel-actions">
            <Button type="submit" disabled={busy}>
              <Save size={16} aria-hidden="true" />
              {busy ? t("Salvando…") : t("Salvar configuração")}
            </Button>
            {provider !== "google" && (
              <Button
                type="button"
                variant="outline"
                disabled={busy || !smtp?.enabled}
                onClick={() =>
                  void run(async () => {
                    await request("/smtp/test", {});
                    setMessage(t("E-mail de teste colocado na fila. Consulte a aba Envios."));
                  })
                }
              >
                <Send size={15} aria-hidden="true" />
                {t("Testar serviço de e-mail em uso")}
              </Button>
            )}
            {saved && (
              <Button type="button" variant="danger" className="channel-remove" disabled={busy} onClick={() => setConfirm(true)}>
                <Trash2 size={15} aria-hidden="true" />
                {t("Remover configuração SMTP")}
              </Button>
            )}
          </div>
          <p className="admin-footnote">{t("O teste usa o destinatário salvo. Alertas anteriores não serão reenviados.")}</p>
        </form>
        <Notice tone="error" onDismiss={() => setError("")}>
          {error}
        </Notice>
        <Notice onDismiss={() => setMessage("")}>{message}</Notice>
      </details>
      <ConfirmDialog
        open={confirm}
        onOpenChange={(open) => {
          setConfirm(open);
          if (!open) setConfirmError("");
        }}
        title={t("Remover a configuração SMTP?")}
        description={
          inUse
            ? t("Apaga servidor, usuário e senha salvos. Os alertas por e-mail param até que uma conta Google seja conectada ou um novo servidor seja configurado.")
            : t("Apaga servidor, usuário e senha salvos. A conta Google conectada, se houver, continua enviando os alertas.")
        }
        confirmLabel={t("Remover configuração")}
        busy={busy}
        error={confirmError}
        onConfirm={() =>
          // The dialog closes once the request succeeds; an error stays in it.
          void run(async () => {
            const result = (await request("/smtp", {}, "DELETE")) as SMTP;
            setDraft({ ...result, password: "" });
            setBaseline(result);
            closedMessage.current = t("Configuração SMTP removida.");
            setConfirm(false);
            await onChanged();
          }, setConfirmError)
        }
        onClosed={() => {
          if (!closedMessage.current) return;
          setMessage(closedMessage.current);
          closedMessage.current = "";
        }}
      />
    </Card>
  );
}
