import { Component, lazy, Suspense, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { LogOut, Mail, MessageCircle, RotateCw, Shield, Smartphone } from "lucide-react";
import { useUnsavedChanges } from "./navigationGuard";
import { AdditionalPhones } from "./AdditionalPhones";
import { EmailFields } from "./EmailFields";
import { LanguagePicker } from "./LanguagePicker";
import { AppearancePicker } from "./AppearancePicker";
import { PhoneField } from "./PhoneField";
import { TimeZoneField, validTimeZone } from "./TimeZoneField";
import { AuditPanel } from "./AuditPanel";
import { SystemVersion } from "./SystemVersion";
import { Avatar } from "./Avatar";
import { InfoTip } from "./InfoTip";
import { Button, Notice } from "./ui";
import { getLanguage, t } from "./i18n";
import { plainClick, routePath } from "./navigation";
import { contactsBody } from "./contacts";
import type { User } from "./types";
// Two-step verification is for administrators: its code and the QR code library
// come in a chunk of their own, never downloaded by other accounts. A lazy
// component keeps a failed download, so a retry needs a new one.
const loadTwoFactor = () =>
  lazy(() => import("./TwoFactorSettings").then((module) => ({ default: module.TwoFactorSettings })));
let TwoFactorSettings = loadTwoFactor();

/** The head of the two-step verification block, the same while it downloads or after a failure. */
function TwoFactorShell({ children }: { children: ReactNode }) {
  return (
    <div className="list-group two-factor">
      <div className="list-row two-factor-heading">
        <Smartphone size={18} aria-hidden="true" />
        <span className="list-row-label two-factor-title">{t("Verificação em duas etapas")}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * The two-step verification block. A failure to download or show it stays in the
 * block, with a retry, and the rest of the profile keeps working.
 */
export class TwoFactorBlock extends Component<{ token: string; userId: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error(error);
  }
  retry = () => {
    TwoFactorSettings = loadTwoFactor();
    this.setState({ failed: false });
  };
  render() {
    if (this.state.failed)
      return (
        <TwoFactorShell>
          <div className="form-block two-factor-body">
            <Notice tone="error">{t("Não foi possível carregar a verificação em duas etapas.")}</Notice>
            <div className="two-factor-actions">
              <Button type="button" variant="outline" size="small" onClick={this.retry}>
                <RotateCw size={16} aria-hidden="true" />
                {t("Tentar novamente")}
              </Button>
            </div>
          </div>
        </TwoFactorShell>
      );
    return (
      <Suspense
        fallback={
          <TwoFactorShell>
            <div className="form-block" role="status">
              <span className="sr-only">{t("Carregando…")}</span>
              <span className="skeleton skeleton-line two-factor-skeleton" aria-hidden="true" />
            </div>
          </TwoFactorShell>
        }
      >
        <TwoFactorSettings token={this.props.token} userId={this.props.userId} />
      </Suspense>
    );
  }
}

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
    body: JSON.stringify(contactsBody(draft)),
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
  help,
  dirty,
  busy,
  children,
}: {
  title: string;
  className: string;
  footer?: string;
  /** Help behind an info button next to the title, instead of text under the block. */
  help?: { label: string; content: ReactNode };
  dirty?: boolean;
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`list-section ${className}`}>
      {help ? (
        <div className="list-section-head">
          <h2 className="list-section-title">{title}</h2>
          <InfoTip label={help.label}>{help.content}</InfoTip>
        </div>
      ) : (
        <h2 className="list-section-title">{title}</h2>
      )}
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
              href={routePath({ view: "admin", section: "health" })}
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
          help={{
            label: t("Sobre os contatos de alerta"),
            content: (
              <>
                <p>{t("Os alertas vão para estes contatos. Em cada viagem, escolha os canais em Configurar alertas.")}</p>
                <p>{t("Trocar o número do WhatsApp não muda o telefone de acesso.")}</p>
              </>
            ),
          }}
          dirty={changed("contacts")}
          busy={busy}
        >
          <fieldset className="form-block whatsapp-contact">
            <legend>
              <MessageCircle className="contact-legend-icon" size={16} aria-hidden="true" />
              {t("WhatsApp")}
            </legend>
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
          </fieldset>
          <div className="form-block">
            <AdditionalPhones
              compact
              label={
                <>
                  {t("Outros números de WhatsApp")}{" "}
                  <span className="form-block-count">{(draft.additional_phones || []).length}/4</span>
                </>
              }
              defaultCountry={user.country}
              values={draft.additional_phones || []}
              disabled={busy}
              onChange={(additional_phones) => setDraft({ ...draft, additional_phones })}
            />
          </div>
          <div className="form-block">
            <EmailFields
              compact
              label={
                <>
                  <Mail className="contact-legend-icon" size={16} aria-hidden="true" />
                  {t("E-mails de alerta")} <span className="form-block-count">{draft.emails.length}/4</span>
                </>
              }
              values={draft.emails}
              onChange={(emails) => setDraft({ ...draft, emails })}
            />
          </div>
        </Group>
        <Group
          title={t("Preferências")}
          className="profile-preferences"
          footer={t(
            "Avisos desse horário ficam retidos e saem depois, se o preço ainda valer. E-mails de segurança continuam ativos.",
          )}
          dirty={changed("preferences")}
          busy={busy}
        >
          <div className="list-row">
            <LanguagePicker labeled />
          </div>
          <div className="list-row">
            <AppearancePicker labeled />
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
            {/* An account still on the default UTC: the device shortcut names the zone it would set. */}
            <TimeZoneField
              value={draft.timezone}
              suggest={user.timezone === "UTC"}
              onChange={(timezone) => setDraft({ ...draft, timezone })}
            />
          </div>
        </Group>
      </form>
      <section className="list-section profile-security">
        <h2 className="list-section-title">{t("Segurança")}</h2>
        {user.role === "admin" && <TwoFactorBlock token={token} userId={user.id} />}
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
