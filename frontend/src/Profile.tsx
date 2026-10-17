import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { LogOut, Shield } from "lucide-react";
import { useUnsavedChanges } from "./navigationGuard";
import { AdditionalPhones } from "./AdditionalPhones";
import { EmailFields } from "./EmailFields";
import { LanguagePicker } from "./LanguagePicker";
import { PhoneField } from "./PhoneField";
import { TimeZoneField, validTimeZone } from "./TimeZoneField";
import { AuditPanel } from "./AuditPanel";
import { SystemVersion } from "./SystemVersion";
import { Avatar } from "./Avatar";
import { Button } from "./ui";
import { getLanguage, t } from "./i18n";
import { plainClick, routePath } from "./navigation";
import type { User } from "./types";

type Section = "account" | "contacts" | "preferences";
const fields: Record<Section, (keyof User)[]> = {
  account: ["name"],
  contacts: ["emails", "whatsapp_use_login", "whatsapp_country", "whatsapp_phone", "additional_phones", "telegram_username"],
  preferences: ["quiet_hours", "quiet_start", "quiet_end", "timezone"],
};
const snapshot = (user: User, section: Section) =>
  JSON.stringify(fields[section].map((key) => (key === "additional_phones" ? user[key] || [] : user[key])));

async function saveProfile(token: string, draft: User): Promise<User> {
  const response = await fetch("/api/profile", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-radar-token": token,
      "x-radar-language": getLanguage(),
    },
    body: JSON.stringify({
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
    }),
  });
  const data = await response.json();
  if (!response.ok)
    throw Error(
      typeof data.detail === "string"
        ? t(data.detail)
        : Array.isArray(data.detail)
          ? data.detail.map((d: { msg: string }) => t(d.msg.replace(/^Value error, /, ""))).join(" · ")
          : t("Não foi possível concluir a ação"),
    );
  return data;
}

/** Grouped list in the iOS Settings style, with "Salvar" inside the block that changed. */
function Group({
  title,
  className,
  footer,
  dirty,
  busy,
  children,
}: {
  title: string;
  className: string;
  footer?: string;
  dirty?: boolean;
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`list-section ${className}`}>
      <h2 className="list-section-title">{title}</h2>
      <div className="list-group">{children}</div>
      {footer && <p className="list-section-footer">{footer}</p>}
      {dirty && (
        <div className="profile-save-row">
          <span>{t("Alterações não salvas")}</span>
          <Button type="submit" size="small" disabled={busy}>
            {busy ? t("Salvando…") : t("Salvar")}
          </Button>
        </div>
      )}
    </section>
  );
}

/** Account, alert contacts, preferences and security in grouped lists. */
export function Profile({
  user,
  token,
  onSaved,
  onLogout,
  onNotice,
  onAdmin,
  onDirtyChange,
}: {
  user: User;
  token: string;
  onSaved: () => Promise<unknown>;
  onLogout: () => Promise<void>;
  onNotice: (message: string, error: boolean) => void;
  /** Administrators get a link to the administration. */
  onAdmin?: () => void;
  /** Tells the shell when the phone save bar shows, so toasts stand above it. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(user)),
    [busy, setBusy] = useState(false);
  const changed = (section: Section) => snapshot(draft, section) !== snapshot(user, section);
  const dirty = changed("account") || changed("contacts") || changed("preferences");
  useUnsavedChanges(dirty);
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty]);
  const phone = user.phone_display ?? user.phone;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!validTimeZone(draft.timezone)) {
      onNotice(t("Escolha um fuso horário válido da lista."), true);
      return;
    }
    setBusy(true);
    try {
      const updated = await saveProfile(token, draft);
      setDraft(updated);
      await onSaved();
      onNotice(t("Seus dados foram salvos."), false);
    } catch (error) {
      onNotice((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="profile-page">
      <div className="profile-identity">
        <Avatar name={user.name} size="lg" />
        <div>
          <strong>{user.name}</strong>
          <span>{phone}</span>
        </div>
      </div>
      <form className="profile-form" id="profile-form" onSubmit={save}>
        <Group title={t("Conta")} className="profile-account" dirty={changed("account")} busy={busy}>
          <label className="form-row">
            <span className="form-row-label">{t("Seu nome")}</span>
            <input
              required
              autoComplete="name"
              minLength={2}
              maxLength={80}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <div className="list-row">
            <span className="list-row-label">{t("Telefone de acesso")}</span>
            <span className="list-row-detail profile-phone">{phone}</span>
          </div>
          {onAdmin && (
            <a
              className="list-row"
              href={routePath({ view: "admin", section: "deliveries" })}
              onClick={(event) => plainClick(event) && onAdmin()}
            >
              <Shield size={18} aria-hidden="true" />
              <span className="list-row-label">{t("Administração")}</span>
            </a>
          )}
        </Group>
        <Group
          title={t("Contatos de alerta")}
          className="profile-contacts"
          footer={t("Os alertas usam estes contatos. Em cada viagem, escolha os canais em Configurar alertas.")}
          dirty={changed("contacts")}
          busy={busy}
        >
          <div className="form-block">
            <EmailFields
              compact
              label={
                <>
                  {t("E-mails de alerta")} <span className="form-block-count">{draft.emails.length}/4</span>
                </>
              }
              values={draft.emails}
              onChange={(emails) => setDraft({ ...draft, emails })}
            />
          </div>
          <fieldset className="form-block whatsapp-contact">
            <legend>{t("WhatsApp")}</legend>
            <label className="switch-row">
              <span>{t("Usar meu telefone de acesso")}</span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={draft.whatsapp_use_login}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    whatsapp_use_login: e.target.checked,
                    whatsapp_phone: e.target.checked ? user.phone : "",
                  })
                }
              />
            </label>
            {draft.whatsapp_use_login ? (
              <p className="contact-preview">{phone}</p>
            ) : (
              <PhoneField
                label={t("Outro número para WhatsApp")}
                country={draft.whatsapp_country}
                value={draft.whatsapp_phone || ""}
                onChange={(country, value) => setDraft({ ...draft, whatsapp_country: country, whatsapp_phone: value })}
              />
            )}
            <p className="help">
              {t(
                "Você pode trocar este contato sem mudar seu telefone de acesso. Ative o WhatsApp nos alertas de cada busca.",
              )}
            </p>
          </fieldset>
          <div className="form-block">
            <AdditionalPhones
              label={
                <>
                  {t("Outros telefones")}{" "}
                  <span className="form-block-count">{(draft.additional_phones || []).length}/4</span>
                </>
              }
              defaultCountry={user.country}
              values={draft.additional_phones || []}
              disabled={busy}
              onChange={(additional_phones) => setDraft({ ...draft, additional_phones })}
            />
          </div>
        </Group>
        <Group
          title={t("Preferências")}
          className="profile-preferences"
          footer={t(
            "As oportunidades continuam no painel. Alertas silenciados não são enviados depois. E-mails de segurança continuam ativos.",
          )}
          dirty={changed("preferences")}
          busy={busy}
        >
          <div className="list-row">
            <LanguagePicker labeled />
          </div>
          <div className="form-block quiet-hours">
            <label className="switch-row">
              <span>
                <strong>{t("Horário silencioso")}</strong>
                <small>{t("Silenciar alertas de preço neste horário")}</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={draft.quiet_hours}
                onChange={(e) => setDraft({ ...draft, quiet_hours: e.target.checked })}
              />
            </label>
            {draft.quiet_hours && (
              <div className="two-fields quiet-hours-times">
                <label>
                  <span>{t("Início")}</span>
                  <input type="time" required value={draft.quiet_start} onChange={(e) => setDraft({ ...draft, quiet_start: e.target.value })} />
                </label>
                <label>
                  <span>{t("Fim")}</span>
                  <input type="time" required value={draft.quiet_end} onChange={(e) => setDraft({ ...draft, quiet_end: e.target.value })} />
                </label>
              </div>
            )}
          </div>
          <div className="form-block">
            <TimeZoneField value={draft.timezone} onChange={(timezone) => setDraft({ ...draft, timezone })} />
          </div>
        </Group>
      </form>
      <section className="list-section profile-security">
        <h2 className="list-section-title">{t("Segurança")}</h2>
        <AuditPanel />
      </section>
      <div className="list-group profile-signout">
        <button type="button" className="list-row" disabled={busy} onClick={() => void onLogout()}>
          <LogOut size={18} aria-hidden="true" />
          <span className="list-row-label">{t("Sair da conta")}</span>
        </button>
      </div>
      <SystemVersion />
      {dirty && (
        <div className="profile-save-bar" role="region" aria-label={t("Alterações não salvas")}>
          <span>{t("Alterações não salvas")}</span>
          <div>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setDraft(structuredClone(user))}>
              {t("Descartar")}
            </Button>
            <Button type="submit" form="profile-form" disabled={busy}>
              {busy ? t("Salvando…") : t("Salvar")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
