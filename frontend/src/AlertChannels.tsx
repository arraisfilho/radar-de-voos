import type { ReactNode } from "react";
import { Mail, MessageCircle } from "lucide-react";
import { clsx } from "clsx";
import { t } from "./i18n";

/**
 * A phone without its middle digits, counted over all of its digits for any country: the last 4
 * and all but 8 at the start stay, at least one ("+55 63 99999-9260" reads "+55 63 9····-9260").
 */
export function maskPhone(value: string): string {
  const total = value.replace(/\D/g, "").length,
    keep = Math.max(1, total - 8);
  let seen = 0;
  return value.trim().replace(/\d/g, (digit) => (seen++ < keep || seen > total - 4 ? digit : "·"));
}

/** A masked phone: the dots stay visual, screen readers hear "terminado em 9260". */
export function MaskedPhone({ phone }: { phone: string }) {
  return (
    <>
      <span aria-hidden="true">{maskPhone(phone)}</span>
      <span className="sr-only">{t("terminado em {0}", [phone.replace(/\D/g, "").slice(-4)])}</span>
    </>
  );
}

/** The first destination and how many more: "a@b.org e mais 1". */
const first = (values: string[], show: (value: string) => ReactNode = (value) => value) =>
  values.length ? (
    <>
      {show(values[0])}
      {values.length > 1 && " " + t("e mais {0}", [values.length - 1])}
    </>
  ) : null;

/**
 * Where this trip's alerts go, WhatsApp first: the channels that would really send (on, available
 * and with a contact). Nothing reaches the person outside the app: "Somente no painel".
 * `compact` keeps only the icons (trip card); their names stay for screen readers and on hover.
 */
export function ChannelSummary({
  whatsapp,
  email,
  compact = false,
}: {
  /** WhatsApp numbers that would receive the alert; empty when the channel is off or unavailable. */
  whatsapp: string[];
  email: string[];
  compact?: boolean;
}) {
  const targets = [
    { key: "whatsapp", icon: MessageCircle, name: t("WhatsApp"), to: first(whatsapp, (phone) => <MaskedPhone phone={phone} />) },
    { key: "email", icon: Mail, name: t("E-mail"), to: first(email) },
  ].filter((item) => item.to);
  if (compact)
    return (
      <span className="channel-icons">
        {targets.length
          ? targets.map(({ key, icon: Icon, name }) => (
              <span key={key} className="channel-icon-mark" title={name}>
                <Icon size={14} aria-hidden="true" />
                <span className="sr-only">{name}</span>
              </span>
            ))
          : t("Somente no painel")}
      </span>
    );
  return (
    <p className={clsx("channel-summary", !targets.length && "is-empty")} role="status">
      <span className="channel-summary-label">{t("Você será avisado por:")}</span>
      {targets.length
        ? targets.map(({ key, icon: Icon, name, to }) => (
            <span key={key} className="channel-target">
              <Icon size={16} aria-hidden="true" />
              <span className="sr-only">{name}: </span>
              <span className="channel-target-to">{to}</span>
            </span>
          ))
        : <span className="channel-target">{t("Somente no painel")}</span>}
    </p>
  );
}
