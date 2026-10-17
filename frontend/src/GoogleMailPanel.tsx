import { t } from "./i18n";
import { useUnsavedChanges } from "./navigationGuard";
import { useEffect, useRef, useState } from "react";
import { Mail, CheckCircle2, LogOut, ArrowRight, LoaderCircle, KeyRound, Trash2, ExternalLink } from "lucide-react";
import { Button, Card, ConfirmDialog, Notice } from "./ui";
import type { GoogleMail } from "./types";
type Props = {
  status: GoogleMail;
  request: (path: string, body: unknown, method?: string) => Promise<unknown>;
  onChanged: () => Promise<unknown>;
  defaultEmail?: string;
  testRecipient?: string;
};
type Discovery = {
  provider: "google" | "other" | "unknown";
  email: string;
  ready: boolean;
  url?: string;
  setup_required?: boolean;
};
/**
 * Google account that sends the alert e-mails: connection through the Google
 * login window, test message and, on public deployments, the OAuth client.
 * Disconnecting and removing the client ask for confirmation first.
 */
export function GoogleMailPanel({
  status,
  request,
  onChanged,
  defaultEmail = "",
  testRecipient = "",
}: Props) {
  const [email, setEmail] = useState(status.email || defaultEmail),
    [adding, setAdding] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [otherProvider, setOtherProvider] = useState(false),
    [testEmail, setTestEmail] = useState(testRecipient || status.email),
    [testing, setTesting] = useState(false);
  const [clientId, setClientId] = useState(status.client_id || "");
  const [clientSecret, setClientSecret] = useState("");
  const [savingClient, setSavingClient] = useState(false);
  const [setupOpen, setSetupOpen] = useState(!status.configured);
  const [confirm, setConfirm] = useState<"disconnect" | "remove" | null>(null);
  const [removing, setRemoving] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  // The Client ID last saved, which the field is compared with.
  const [savedClientId, setSavedClientId] = useState(status.client_id || "");
  const popup = useRef<Window | null>(null);
  // The success of a confirmation waits for its dialog to close (see Modal.onClosed).
  const closedMessage = useRef("");
  useEffect(() => setSavedClientId(status.client_id || ""), [status.client_id]);
  // An unsaved OAuth client asks before the channel or tab changes (navigationGuard).
  useUnsavedChanges(
    status.deployment === "public" && (clientId.trim() !== savedClientId.trim() || clientSecret !== ""),
  );
  useEffect(() => {
    if (status.connected) {
      setEmail(status.email);
      setTestEmail((previous) => previous || testRecipient || status.email);
    }
  }, [status.connected, status.email, testRecipient]);
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (
        event.origin !== new URL(status.redirect_uri).origin ||
        event.source !== popup.current ||
        event.data?.type !== "radar-google-oauth"
      )
        return;
      setBusy(false);
      setProgress("");
      if (event.data.ok) {
        setAdding(false);
        setMessage(t("Conta adicionada."));
        setError("");
        void onChanged();
      } else {
        setError(
          typeof event.data.message === "string"
            ? event.data.message
            : t("Não foi possível concluir a conexão Google. Tente novamente."),
        );
        void onChanged();
      }
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [status.redirect_uri, onChanged]);
  useEffect(() => {
    if (!busy || !popup.current) return;
    const timer = setInterval(() => {
      if (popup.current?.closed) {
        setBusy(false);
        setProgress("");
        void onChanged();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [busy, onChanged]);
  async function connect(provider: "auto" | "google" = "auto") {
    setError("");
    setMessage("");
    setOtherProvider(false);
    let windowRef: Window | null = null;
    if (status.configured) {
      try {
        windowRef = window.open(
          "about:blank",
          "radar-google-connect",
          "popup=yes,width=540,height=720",
        );
      } catch {
        setError(
          t(
            "O navegador não permitiu abrir a janela de login. Tente em uma janela do Safari ou Chrome.",
          ),
        );
        return;
      }
      if (!windowRef) {
        setError(
          t(
            "Permita a abertura da janela de login no navegador e tente novamente.",
          ),
        );
        return;
      }
      windowRef.document.title = t("Adicionar conta");
      windowRef.document.body.textContent = t(
        "Identificando o provedor do seu e-mail…",
      );
    }
    popup.current = windowRef;
    setBusy(true);
    setProgress(t("Identificando sua conta…"));
    try {
      const result = (await request("/mail/connect", {
        email,
        provider,
      })) as Discovery;
      if (result.provider !== "google") {
        windowRef?.close();
        setBusy(false);
        setProgress("");
        setOtherProvider(true);
        return;
      }
      if (result.setup_required) {
        windowRef?.close();
        setBusy(false);
        setProgress("");
        setSetupOpen(true);
        setError(
          t(
            status.deployment === "public"
              ? "Configure a integração Google antes de conectar a conta."
              : "Solicite a configuração Google ao administrador.",
          ),
        );
        return;
      }
      if (!result.url || !windowRef || windowRef.closed) {
        windowRef?.close();
        setBusy(false);
        setProgress("");
        setError(
          t(
            "A janela de login foi fechada. Clique em Continuar para tentar novamente.",
          ),
        );
        return;
      }
      setProgress(t("Conclua o login na janela do Google."));
      windowRef.location.href = result.url;
    } catch (e) {
      windowRef?.close();
      setBusy(false);
      setProgress("");
      setError(t((e as Error).message));
    }
  }
  /**
   * Disconnect or remove the client. The dialog closes once the request
   * succeeds; an error stays in the dialog, where it is announced.
   */
  async function finish(path: string, method: string | undefined, done: string, after?: () => void) {
    setRemoving(true);
    setError("");
    setMessage("");
    setConfirmError("");
    try {
      await request(path, {}, method);
      after?.();
      closedMessage.current = done;
      setConfirm(null);
      await onChanged();
    } catch (e) {
      setConfirmError(t((e as Error).message));
    } finally {
      setRemoving(false);
    }
  }
  const closeConfirm = (open: boolean) => {
    if (open) return;
    setConfirm(null);
    setConfirmError("");
  };
  function showClosedMessage() {
    if (!closedMessage.current) return;
    setMessage(closedMessage.current);
    closedMessage.current = "";
  }
  return (
    <Card className="channel-card google-card">
      <div className="channel-card-heading">
        <span className="channel-card-icon" aria-hidden="true">
          <Mail size={20} />
        </span>
        <div>
          <h3>
            {status.connected && !adding
              ? t("Conta de envio")
              : t("Adicionar conta de e-mail")}
          </h3>
          <p>
            {status.connected && !adding
              ? t("Serviço em uso: conta conectada.")
              : t(
                  "Informe seu e-mail. Nós identificamos o provedor e abrimos o login para você.",
                )}
          </p>
        </div>
        {status.connected && (
          <span className="status-pill is-active">
            {t("Conectada")}
          </span>
        )}
      </div>
      {status.deployment === "public" && (
        <details
          className="admin-disclosure google-web-setup"
          open={setupOpen}
          onToggle={(event) => setSetupOpen(event.currentTarget.open)}
        >
          <summary>
            <KeyRound size={18} aria-hidden="true" />
            <span>{t("Configuração Google")}</span>
          </summary>
          <div className="admin-disclosure-body">
            <p className="admin-footnote">
              {t(
                "Configure uma vez com um cliente OAuth do tipo Aplicativo da Web. Depois, basta informar o e-mail e autorizar no Google.",
              )}{" "}
              <a
                href="https://console.cloud.google.com/auth/clients"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("Abrir clientes OAuth no Google Cloud")}
                <ExternalLink size={13} aria-hidden="true" className="inline-icon" />
                <span className="sr-only">{t("(abre em nova aba)")}</span>
              </a>
            </p>
            <label className="field">
              <span className="field-label">{t("URL de retorno autorizada")}</span>
              <input
                readOnly
                value={status.redirect_uri}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            <form
              className="channel-form"
              onSubmit={async (event) => {
                event.preventDefault();
                setSavingClient(true);
                setError("");
                setMessage("");
                try {
                  await request(
                    "/google/client",
                    {
                      client_id: clientId.trim(),
                      client_secret: clientSecret.trim(),
                      client_type: "web",
                    },
                    "PUT",
                  );
                  setClientSecret("");
                  setSavedClientId(clientId.trim());
                  await onChanged();
                  setSetupOpen(false);
                  setMessage(
                    t(
                      "Integração salva. Informe seu e-mail e clique em Continuar para autorizar no Google.",
                    ),
                  );
                } catch (error) {
                  setError(t((error as Error).message));
                } finally {
                  setSavingClient(false);
                }
              }}
            >
              <label className="field">
                <span className="field-label">Client ID</span>
                <input
                  required
                  value={clientId}
                  maxLength={300}
                  disabled={savingClient || busy}
                  autoComplete="off"
                  onChange={(event) => setClientId(event.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">Client Secret</span>
                <input
                  type="password"
                  value={clientSecret}
                  maxLength={500}
                  disabled={savingClient || busy}
                  autoComplete="new-password"
                  required={
                    !status.client_secret_set ||
                    clientId.trim() !== status.client_id
                  }
                  placeholder={
                    status.client_secret_set
                      ? t("Deixe vazio para manter o segredo salvo")
                      : ""
                  }
                  onChange={(event) => setClientSecret(event.target.value)}
                />
              </label>
              <div className="channel-actions">
                <Button
                  type="submit"
                  variant="outline"
                  disabled={savingClient || busy}
                >
                  {savingClient ? t("Salvando…") : t("Salvar integração Google")}
                </Button>
                {(status.client_id || status.client_secret_set) && (
                  <Button
                    type="button"
                    variant="danger"
                    className="channel-remove"
                    disabled={savingClient || busy || removing}
                    onClick={() => setConfirm("remove")}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    {t("Remover cliente Google")}
                  </Button>
                )}
              </div>
            </form>
          </div>
        </details>
      )}
      {status.connected && !adding ? (
        <>
          <div className="google-account-row">
            <p className="google-account">
              <CheckCircle2 size={18} aria-hidden="true" />
              <span>{status.email}</span>
            </p>
            <div className="channel-actions">
              <Button
                variant="outline"
                onClick={() => {
                  setAdding(true);
                  setError("");
                  setMessage("");
                }}
              >
                {t("Trocar conta")}
              </Button>
              <Button variant="danger" disabled={removing} onClick={() => setConfirm("disconnect")}>
                <LogOut size={16} aria-hidden="true" />
                {t("Desconectar")}
              </Button>
            </div>
          </div>
          <form
            className="channel-form mail-test"
            onSubmit={async (event) => {
              event.preventDefault();
              setTesting(true);
              setError("");
              setMessage("");
              try {
                const result = (await request("/smtp/test", {
                  recipient: testEmail,
                })) as {
                  recipient: string;
                };
                setMessage(
                  t(
                    "Teste solicitado para {0}. Acompanhe o resultado em Atividade de envio.",
                    [result.recipient],
                  ),
                );
                await onChanged();
              } catch (e) {
                setError(t((e as Error).message));
              } finally {
                setTesting(false);
              }
            }}
          >
            <label className="field">
              <span className="field-label">{t("E-mail para teste")}</span>
              <input
                type="email"
                required
                maxLength={254}
                autoComplete="email"
                value={testEmail}
                disabled={testing}
                placeholder={t("voce@exemplo.com")}
                onChange={(event) => setTestEmail(event.target.value)}
              />
              <span className="field-help">
                {t(
                  "Este endereço será salvo para os próximos testes. Os destinatários dos alertas continuam no perfil de cada usuário.",
                )}
              </span>
            </label>
            <div className="channel-actions">
              <Button type="submit" variant="outline" disabled={testing}>
                {testing ? t("Solicitando…") : t("Enviar e-mail de teste")}
              </Button>
            </div>
          </form>
        </>
      ) : (
        <form
          className="channel-form add-mail-account"
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          <label className="field">
            <span className="field-label">{t("Seu e-mail")}</span>
            <input
              type="email"
              required
              autoComplete="email"
              maxLength={254}
              value={email}
              placeholder={t("voce@empresa.com")}
              disabled={busy}
              onChange={(e) => {
                setEmail(e.target.value);
                setOtherProvider(false);
                setError("");
              }}
            />
            <span className="field-help">
              {t(
                "Gmail e Google Workspace abrem a janela de login do Google. Sua senha é informada somente lá.",
              )}
            </span>
          </label>
          <div className="channel-actions">
            <Button type="submit" disabled={busy || savingClient}>
              {busy ? (
                <LoaderCircle size={17} className="spin" aria-hidden="true" />
              ) : (
                <ArrowRight size={17} aria-hidden="true" />
              )}
              {busy ? t("Conectando…") : t("Continuar")}
            </Button>
            {adding && (
              <Button
                variant="ghost"
                type="button"
                disabled={busy}
                onClick={() => setAdding(false)}
              >
                {t("Cancelar")}
              </Button>
            )}
          </div>
        </form>
      )}
      {progress && (
        <p role="status" className="field-help">
          {progress}
        </p>
      )}
      {otherProvider && (
        <div className="mail-provider-choice">
          <p>
            {t(
              "Não identificamos o Google automaticamente. Sua conta pode usar outro provedor ou um serviço intermediário.",
            )}
          </p>
          <div className="channel-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => void connect("google")}
            >
              {t("Minha conta é do Google")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                const details =
                  document.querySelector<HTMLDetailsElement>(".smtp-manual");
                if (details) {
                  details.open = true;
                  details.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  });
                  details.querySelector<HTMLElement>("summary")?.focus();
                }
              }}
            >
              {t("Configurar outro provedor")}
            </Button>
          </div>
        </div>
      )}
      {status.error && !error && <Notice tone="error">{t(status.error)}</Notice>}
      <Notice tone="error" onDismiss={() => setError("")}>
        {error}
      </Notice>
      <Notice onDismiss={() => setMessage("")}>{message}</Notice>
      <ConfirmDialog
        open={confirm === "disconnect"}
        onOpenChange={closeConfirm}
        title={t("Desconectar a conta Google?")}
        description={t(
          "Os alertas por e-mail param para todos os usuários até que outra conta seja conectada ou o SMTP seja habilitado. A autorização continua na conta Google até ser revogada lá.",
        )}
        confirmLabel={t("Desconectar conta")}
        busy={removing}
        error={confirm === "disconnect" ? confirmError : ""}
        onConfirm={() => void finish("/google/disconnect", undefined, t("Conta desconectada deste radar."))}
        onClosed={showClosedMessage}
      >
        {status.email && (
          <p className="confirm-subject">
            <strong>{status.email}</strong>
          </p>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "remove"}
        onOpenChange={closeConfirm}
        title={t("Remover o cliente Google?")}
        description={t(
          "Apaga o Client ID, o Client Secret e a autorização salvos neste radar; os alertas por e-mail deixam de usar a conta Google. A autorização não é revogada no Google.",
        )}
        confirmLabel={t("Remover cliente Google")}
        busy={removing}
        error={confirm === "remove" ? confirmError : ""}
        onClosed={showClosedMessage}
        onConfirm={() =>
          void finish("/google/client", "DELETE", t("Cliente Google removido. Configure um novo cliente para conectar uma conta."), () => {
            setClientId("");
            setClientSecret("");
            setSavedClientId("");
            setSetupOpen(true);
            setAdding(false);
          })
        }
      />
    </Card>
  );
}
