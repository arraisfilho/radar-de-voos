import { t } from "./i18n";
import { useEffect, useRef, useState } from "react";
import {
  Mail,
  CheckCircle2,
  LogOut,
  ArrowRight,
  LoaderCircle,
} from "lucide-react";
import { Button, Card } from "./ui";
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
  const popup = useRef<Window | null>(null);
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
        setError(
          t(
            "A conexão Google ainda não está disponível nesta versão. Você não precisa configurar o Google Cloud.",
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
  return (
    <>
      <Card className="google-mail-card">
        <div className="google-mail-heading">
          <span className="google-mail-icon">
            <Mail size={24} />
          </span>
          <div>
            <h2>
              {status.connected && !adding
                ? t("Conta de envio")
                : t("Adicionar conta de e-mail")}
            </h2>
            <p>
              {status.connected && !adding
                ? t("Seus alertas serão enviados por esta conta.")
                : t(
                    "Informe seu e-mail. Nós identificamos o provedor e abrimos o login para você.",
                  )}
            </p>
          </div>
          {status.connected && (
            <span className="delivery-badge success">
              <CheckCircle2 size={14} />
              {t("Conectada")}
            </span>
          )}
        </div>
        {status.connected && !adding ? (
          <>
            <p className="google-account">{status.email}</p>
            <div className="google-mail-actions">
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
              <Button
                variant="ghost"
                onClick={async () => {
                  try {
                    await request("/google/disconnect", {});
                    await onChanged();
                    setMessage(t("Conta desconectada deste radar."));
                  } catch (e) {
                    setError(t((e as Error).message));
                  }
                }}
              >
                <LogOut size={16} />
                {t("Desconectar")}
              </Button>
            </div>
            <form
              className="add-mail-account"
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
              <label>
                {t("E-mail para teste")}
                <input
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  value={testEmail}
                  disabled={testing}
                  placeholder="voce@exemplo.com"
                  onChange={(event) => setTestEmail(event.target.value)}
                />
              </label>
              <p className="help">
                {t(
                  "Este endereço será salvo para os próximos testes. Os destinatários dos alertas continuam no perfil de cada usuário.",
                )}
              </p>
              <div className="google-mail-actions">
                <Button type="submit" variant="outline" disabled={testing}>
                  {testing ? t("Solicitando…") : t("Enviar e-mail de teste")}
                </Button>
              </div>
            </form>
          </>
        ) : (
          <form
            className="add-mail-account"
            onSubmit={(e) => {
              e.preventDefault();
              void connect();
            }}
          >
            <label>
              {t("Seu e-mail")}
              <input
                type="email"
                required
                autoComplete="email"
                maxLength={254}
                value={email}
                placeholder="voce@empresa.com"
                disabled={busy}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setOtherProvider(false);
                  setError("");
                }}
              />
            </label>
            <p className="help">
              {t(
                "Gmail e Google Workspace abrem a janela de login do Google. Sua senha é informada somente lá.",
              )}
            </p>
            <div className="google-mail-actions">
              <Button type="submit" disabled={busy}>
                {busy ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  <ArrowRight size={17} />
                )}{" "}
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
          <p role="status" className="help">
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
            <div className="google-mail-actions">
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
        {(error || status.error) && (
          <p role="alert" className="form-error">
            {t(error || status.error || "")}
          </p>
        )}
        {message && (
          <p role="status" className="profile-success">
            {message}
          </p>
        )}
      </Card>
    </>
  );
}
