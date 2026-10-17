import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { t, getLocale } from "./i18n";
import { Button, Card } from "./ui";
import { PhoneField } from "./PhoneField";
import { Save, Send } from "lucide-react";
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
export function WhatsAppPanel({ request }: { request: RequestFn }) {
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
    [consent, setConsent] = useState(false);
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
  const provider = query.data?.providers.find((p) => p.id === draft?.provider);
  const identityUnchanged =
    !!draft &&
    query.data?.provider === draft.provider &&
    provider?.fields
      .filter((f) => !f.secret)
      .every(
        (f) =>
          (draft.values[f.key] || "") === (query.data?.values[f.key] || ""),
      );
  const dirty =
    !!draft &&
    !!query.data &&
    (draft.provider !== query.data.provider ||
      draft.enabled !== query.data.enabled ||
      Object.entries(draft.values).some(([key, value]) =>
        provider?.fields.find((f) => f.key === key)?.secret
          ? !!value
          : value !== (query.data?.values[key] || ""),
      ));
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
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
      setMessage(
        t("Configuração WhatsApp salva. Use Verificar sessão antes do teste."),
      );
      await cache.invalidateQueries({ queryKey: ["radar"] });
      await cache.invalidateQueries({ queryKey: ["admin-deliveries"] });
    });
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
    <Card className="whatsapp-panel">
      <div className="section-heading">
        <div>
          <h2>WhatsApp</h2>
          <p>{t("Escolha o integrador e configure a conexão de envio.")}</p>
        </div>
        <span className="subtle-tag">
          {query.data?.available ? t("Habilitado") : t("Não configurado")}
        </span>
      </div>
      {query.isError ? (
        <p className="form-error" role="alert">
          {query.error.message}
        </p>
      ) : !draft ? (
        <p role="status">{t("Carregando…")}</p>
      ) : (
        <form onSubmit={save}>
          <fieldset disabled={busy} className="admin-account-fields">
            <label>
              {t("Tipo de integração")}
              <select
                value={draft.provider}
                onChange={(e) => {
                  const next = query.data?.providers.find(
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
                {query.data?.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {provider?.fields.map((field) => (
              <label key={field.key}>
                {t(field.label)}
                <input
                  type={field.type}
                  autoComplete={field.secret ? "new-password" : "off"}
                  required={
                    draft.enabled &&
                    (!field.secret ||
                      !query.data?.secrets_set[field.key] ||
                      !identityUnchanged)
                  }
                  maxLength={field.key === "session_id" ? 200 : 2000}
                  value={draft.values[field.key] || ""}
                  placeholder={
                    field.secret &&
                    identityUnchanged &&
                    query.data?.secrets_set[field.key]
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
            {provider?.help && <p className="help">{t(provider.help)}</p>}
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) =>
                  setDraft({ ...draft, enabled: e.target.checked })
                }
              />
              {t("Habilitar envios por WhatsApp")}
            </label>
            <div className="settings-actions">
              <Button type="submit">
                <Save size={16} />
                {t("Salvar configuração")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={
                  dirty ||
                  !provider?.fields
                    .filter((f) => f.secret)
                    .every((f) => query.data?.secrets_set[f.key])
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
                {t("Verificar sessão")}
              </Button>
            </div>
            {dirty && (
              <p className="help">
                {t(
                  "Salve as alterações antes de verificar ou enviar um teste.",
                )}
              </p>
            )}
            {check && (
              <p className="help" role="status">
                {states[check.status] || check.status} ·{" "}
                {new Date(check.checked_at * 1000).toLocaleString(getLocale())}
              </p>
            )}
          </fieldset>
        </form>
      )}
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
      <details className="whatsapp-test">
        <summary>{t("Enviar mensagem de teste")}</summary>
        <p className="help">
          {t(
            "O teste envia uma mensagem real apenas para o número informado. Consulte o resultado na aba Envios.",
          )}
        </p>
        <form
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
          <Button
            type="submit"
            variant="outline"
            disabled={
              busy || dirty || !query.data?.available || !phone || !consent
            }
          >
            <Send size={15} />
            {t("Enviar teste WhatsApp")}
          </Button>
        </form>
      </details>
      <p className="help">
        {t(
          "Aceitação pelo integrador não confirma entrega ou leitura. Falhas ambíguas não são reenviadas automaticamente.",
        )}
      </p>
    </Card>
  );
}
