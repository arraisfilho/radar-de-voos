import { WhatsAppReceipts } from "./WhatsAppReceipts";
import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { t } from "./i18n";
import { useUnsavedChanges } from "./navigationGuard";
import { formatDateTime } from "./format";
import { Button, Card, ConfirmDialog, Notice } from "./ui";
import { PhoneField } from "./PhoneField";
import { MessageCircle, Save, Send, ShieldCheck, Trash2 } from "lucide-react";
type Field = {
  key: string;
  label: string;
  secret: boolean;
  default: string;
  type: string;
};
type Settings = {
  provider: string;
  enabled: boolean;
  values: Record<string, string>;
  secrets_set: Record<string, boolean>;
  providers: { id: string; name: string; fields: Field[]; help?: string }[];
  available: boolean;
};
type Draft = {
  provider: string;
  enabled: boolean;
  values: Record<string, string>;
};
type RequestFn = (
  path: string,
  body: unknown,
  method?: string,
) => Promise<unknown>;
/**
 * WhatsApp channel: integrator, connection, delivery receipts and a test
 * message. Removing the integration asks for confirmation first.
 */
export function WhatsAppPanel({ request }: { request: RequestFn }) {
  // Hook order matters to the tests: the draft comes first.
  const cache = useQueryClient(),
    [draft, setDraft] = useState<Draft | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [check, setCheck] = useState<{
      ready: boolean;
      status: string;
      checked_at: number;
    } | null>(null),
    [country, setCountry] = useState("BR"),
    [phone, setPhone] = useState(""),
    [consent, setConsent] = useState(false),
    [confirm, setConfirm] = useState(false),
    [confirmError, setConfirmError] = useState(""),
    [confirmSave, setConfirmSave] = useState(false);
  const id = useId();
  // A success from a confirmation waits for its dialog to close (see Modal.onClosed).
  const closedMessage = useRef("");
  const query = useQuery<Settings>({
    queryKey: ["whatsapp-settings"],
    queryFn: async ({ signal }) => {
      const r = await fetch("/api/admin/whatsapp", {
        cache: "no-store",
        signal,
      });
      if (!r.ok)
        throw Error(t("Não foi possível carregar a configuração WhatsApp."));
      return r.json();
    },
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (query.data && !draft)
      setDraft({
        provider: query.data.provider,
        enabled: query.data.enabled,
        values: { ...query.data.values },
      });
  }, [query.data, draft]);
  const data = query.data;
  const provider = data?.providers.find((p) => p.id === draft?.provider);
  const identityUnchanged =
    !!draft &&
    data?.provider === draft.provider &&
    provider?.fields
      .filter((f) => !f.secret)
      .every(
        (f) =>
          (draft.values[f.key] || "") === (data?.values[f.key] || ""),
      );
  const dirty =
    !!draft &&
    !!data &&
    (draft.provider !== data.provider ||
      draft.enabled !== data.enabled ||
      Object.entries(draft.values).some(([key, value]) =>
        provider?.fields.find((f) => f.key === key)?.secret
          ? !!value
          : value !== (data?.values[key] || ""),
      ));
  // Switching channel or tab with unsaved changes asks first (navigationGuard).
  useUnsavedChanges(dirty);
  // Something saved beyond the defaults: the integration can be removed.
  const saved =
    !!data &&
    (data.enabled ||
      Object.values(data.secrets_set).some(Boolean) ||
      Object.values(data.values).some(Boolean));
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
  async function refreshShared() {
    await cache.invalidateQueries({ queryKey: ["radar"] });
    await cache.invalidateQueries({ queryKey: ["admin-deliveries"] });
    await cache.invalidateQueries({ queryKey: ["whatsapp-receipts"] });
  }
  // Saving the enabled integration switched off, or with another integrator,
  // URL or session, cancels the messages still queued (the server never
  // redirects them): that save asks first.
  const cancelsQueue = !!data?.enabled && !!draft && (!draft.enabled || !identityUnchanged);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (cancelsQueue) {
      setConfirmError("");
      setConfirmSave(true);
      return;
    }
    await persist();
  }
  /** From the confirmation, a failure stays in the open dialog and the success waits for it to close. */
  async function persist(confirming = false) {
    if (!draft) return;
    await run(async () => {
      const result = (await request(
        "/admin/whatsapp",
        draft,
        "PUT",
      )) as Settings;
      setDraft({
        provider: result.provider,
        enabled: result.enabled,
        values: { ...result.values },
      });
      cache.setQueryData(["whatsapp-settings"], result);
      setCheck(null);
      const done = t("Configuração WhatsApp salva. Use Verificar sessão antes do teste.");
      if (confirming) {
        closedMessage.current = done;
        setConfirmSave(false);
      } else setMessage(done);
      await refreshShared();
    }, confirming ? setConfirmError : setError);
  }
  function showClosedMessage() {
    if (!closedMessage.current) return;
    setMessage(closedMessage.current);
    closedMessage.current = "";
  }
  const states: Record<string, string> = {
    ready: t("Pronta para envio"),
    created: t("Criada"),
    initializing: t("Inicializando"),
    qr_ready: t("Aguardando leitura do QR code"),
    authenticating: t("Autenticando"),
    disconnected: t("Desconectada"),
    failed: t("Falha na sessão"),
  };
  return (
    <section className="channel-panel whatsapp-panel" aria-labelledby={id + "-title"}>
      <header className="channel-panel-heading">
        <span className="admin-channel-icon is-large" aria-hidden="true">
          <MessageCircle size={22} />
        </span>
        <div>
          <h2 id={id + "-title"}>WhatsApp</h2>
          <p>{t("Escolha o integrador e configure a conexão de envio.")}</p>
        </div>
        <span className={data?.available ? "status-pill is-active" : "status-pill is-ended"}>
          {data?.available ? t("Habilitado") : t("Não configurado")}
        </span>
      </header>
      <Card className="channel-card">
        {query.isError ? (
          <Notice tone="error">{query.error.message}</Notice>
        ) : !draft ? (
          <div className="table-skeleton" role="status">
            <span className="sr-only">{t("Carregando…")}</span>
            <span className="skeleton skeleton-table-row" aria-hidden="true" />
            <span className="skeleton skeleton-table-row" aria-hidden="true" />
          </div>
        ) : (
          <form className="channel-form" onSubmit={save}>
            <fieldset disabled={busy} className="channel-fields">
              <label className="field">
                <span className="field-label">{t("Tipo de integração")}</span>
                <select
                  value={draft.provider}
                  onChange={(e) => {
                    const next = data?.providers.find(
                      (p) => p.id === e.target.value,
                    );
                    if (next) {
                      setDraft({
                        provider: next.id,
                        enabled: false,
                        values: Object.fromEntries(
                          next.fields.map((f) => [f.key, f.default]),
                        ),
                      });
                      setCheck(null);
                    }
                  }}
                >
                  {data?.providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {provider?.fields.map((field) => (
                <label className="field" key={field.key}>
                  <span className="field-label">{t(field.label)}</span>
                  <input
                    type={field.type}
                    autoComplete={field.secret ? "new-password" : "off"}
                    required={
                      draft.enabled &&
                      (!field.secret ||
                        !data?.secrets_set[field.key] ||
                        !identityUnchanged)
                    }
                    maxLength={field.key === "session_id" ? 200 : 2000}
                    value={draft.values[field.key] || ""}
                    placeholder={
                      field.secret &&
                      identityUnchanged &&
                      data?.secrets_set[field.key]
                        ? t("Token salvo · deixe vazio para manter")
                        : field.default
                    }
                    onChange={(e) => {
                      setDraft({
                        ...draft,
                        values: { ...draft.values, [field.key]: e.target.value },
                      });
                      setCheck(null);
                    }}
                  />
                </label>
              ))}
              {provider?.help && <p className="field-help">{t(provider.help)}</p>}
              <label className="switch-row">
                <span>{t("Habilitar envios por WhatsApp")}</span>
                <input
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={draft.enabled}
                  onChange={(e) =>
                    setDraft({ ...draft, enabled: e.target.checked })
                  }
                />
              </label>
            </fieldset>
            <div className="channel-actions">
              <Button type="submit" disabled={busy}>
                <Save size={16} aria-hidden="true" />
                {t("Salvar configuração")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={
                  busy ||
                  dirty ||
                  !provider?.fields
                    .filter((f) => f.secret)
                    .every((f) => data?.secrets_set[f.key])
                }
                onClick={() =>
                  void run(async () => {
                    const result = (await request(
                      "/admin/whatsapp/check",
                      {},
                    )) as {
                      ready: boolean;
                      status: string;
                      checked_at: number;
                    };
                    setCheck(result);
                    setMessage(
                      result.ready
                        ? t("Sessão WhatsApp pronta.")
                        : t("A sessão ainda não está pronta para enviar."),
                    );
                  })
                }
              >
                <ShieldCheck size={16} aria-hidden="true" />
                {t("Verificar sessão")}
              </Button>
              {saved && (
                <Button
                  type="button"
                  variant="danger"
                  className="channel-remove"
                  disabled={busy}
                  onClick={() => setConfirm(true)}
                >
                  <Trash2 size={15} aria-hidden="true" />
                  {t("Remover integração")}
                </Button>
              )}
            </div>
            {dirty && (
              <p className="field-help">
                {t(
                  "Salve as alterações antes de verificar ou enviar um teste.",
                )}
              </p>
            )}
            {check && (
              <p className="field-help" role="status">
                {states[check.status] || check.status} · {formatDateTime(check.checked_at)}
              </p>
            )}
          </form>
        )}
        <Notice tone="error" onDismiss={() => setError("")}>
          {error}
        </Notice>
        <Notice onDismiss={() => setMessage("")}>{message}</Notice>
      </Card>
      <Card className="channel-card disclosure-card">
        <WhatsAppReceipts request={request} />
      </Card>
      <Card className="channel-card disclosure-card">
        <details className="whatsapp-test">
          <summary>
            <span className="channel-card-icon" aria-hidden="true">
              <Send size={20} />
            </span>
            <span className="disclosure-summary">
              <strong>{t("Enviar mensagem de teste")}</strong>
              <small>{t("Mensagem real para um número informado por você.")}</small>
            </span>
          </summary>
          <div className="admin-disclosure-body">
            <p className="field-help">
              {t(
                "O teste envia uma mensagem real apenas para o número informado. Consulte o resultado na aba Envios.",
              )}
            </p>
            <form
              className="channel-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!consent) return;
                void run(async () => {
                  await request("/admin/whatsapp/test", { country, phone });
                  setConsent(false);
                  setMessage(
                    t("Teste WhatsApp colocado na fila. Consulte a aba Envios."),
                  );
                  await cache.invalidateQueries({ queryKey: ["admin-deliveries"] });
                });
              }}
            >
              <PhoneField
                label={t("Número para teste")}
                country={country}
                value={phone}
                disabled={busy}
                onChange={(c, p) => {
                  setCountry(c);
                  setPhone(p);
                  setConsent(false);
                }}
              />
              <label className="check-row">
                <input
                  type="checkbox"
                  required
                  checked={consent}
                  disabled={busy}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                {t("Enviar uma mensagem de teste para este número.")}
              </label>
              <div className="channel-actions">
                <Button
                  type="submit"
                  variant="outline"
                  disabled={
                    busy || dirty || !data?.available || !phone || !consent
                  }
                >
                  <Send size={15} aria-hidden="true" />
                  {t("Enviar teste WhatsApp")}
                </Button>
              </div>
            </form>
          </div>
        </details>
      </Card>
      <p className="admin-footnote">
        {t(
          "Aceitação pelo integrador não confirma entrega ou leitura. Falhas ambíguas não são reenviadas automaticamente.",
        )}
      </p>
      <ConfirmDialog
        open={confirm}
        onOpenChange={(open) => {
          setConfirm(open);
          if (!open) setConfirmError("");
        }}
        title={t("Remover a integração WhatsApp?")}
        description={t(
          "Remove a integração e o segredo das confirmações; mensagens pendentes são canceladas. Os números cadastrados pelos usuários são preservados.",
        )}
        confirmLabel={t("Remover integração")}
        busy={busy}
        error={confirm ? confirmError : ""}
        onConfirm={() =>
          // The dialog closes once the request succeeds; an error stays in it.
          void run(async () => {
            const result = (await request("/admin/whatsapp", {}, "DELETE")) as Settings;
            cache.setQueryData(["whatsapp-settings"], result);
            setDraft({
              provider: result.provider,
              enabled: result.enabled,
              values: { ...result.values },
            });
            setCheck(null);
            closedMessage.current = t("Integração WhatsApp removida. Mensagens pendentes foram canceladas.");
            setConfirm(false);
            await refreshShared();
          }, setConfirmError)
        }
        onClosed={showClosedMessage}
      />
      <ConfirmDialog
        open={confirmSave}
        onOpenChange={(open) => {
          setConfirmSave(open);
          if (!open) setConfirmError("");
        }}
        title={t("Salvar e cancelar as mensagens pendentes?")}
        description={t(
          "Desligar o WhatsApp ou trocar o integrador, a URL ou a sessão cancela as mensagens que ainda estão na fila. Elas não serão reenviadas.",
        )}
        confirmLabel={t("Salvar e cancelar pendentes")}
        busy={busy}
        error={confirmSave ? confirmError : ""}
        onConfirm={() => void persist(true)}
        onClosed={showClosedMessage}
      />
    </section>
  );
}
