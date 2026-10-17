import { Bell, Mail, MessageCircle, Send, type LucideIcon } from "lucide-react";
import { clsx } from "clsx";
import { getLocale, t } from "./i18n";
import type { Alert, ChannelDelivery } from "./types";

export type Tone = "green" | "red" | "amber" | "gray";
/** What people see of a delivery: six short labels in four colors (UX audit, 8.2). */
const shortLabels = (): Record<string, [string, Tone]> => ({
  sending: [t("Enviando"), "gray"],
  sent: [t("Enviado"), "green"],
  delivered: [t("Entregue"), "green"],
  read: [t("Lido"), "green"],
  failed: [t("Falha"), "red"],
  check: [t("Verificar"), "amber"],
  quiet: [t("Silenciado"), "gray"],
  cancelled: [t("Cancelado"), "gray"],
});
/** Each technical state under its short label; in_app and unknown states show no chip. */
const GROUPS: Record<string, string> = {
  pending: "sending",
  queued: "sending",
  sending: "sending",
  sent: "sent",
  confirmed_sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
  expired: "failed",
  delivery_failed: "failed",
  waiting_contact: "failed",
  waiting_service: "failed",
  waiting_smtp: "failed",
  uncertain: "check",
  partial: "check",
  delivery_partial: "check",
  quiet: "quiet",
  // Pending until the end of the recipient's quiet hours: silenced for now, it goes out then.
  held: "quiet",
  cancelled: "cancelled",
};
/** The technical state behind a short label, for the accessible name and the tooltip. */
const details = (): Record<string, string> => ({
  pending: t("Na fila"),
  queued: t("Na fila"),
  waiting_smtp: t("Aguardando serviço de envio"),
  confirmed_sent: t("Envio confirmado"),
  failed: t("Falha no envio"),
  expired: t("Expirado"),
  delivery_failed: t("Falha de entrega"),
  waiting_contact: t("Sem destinatário"),
  waiting_service: t("Canal indisponível"),
  uncertain: t("Não confirmado"),
  partial: t("Envio parcial"),
  delivery_partial: t("Entrega parcial"),
  quiet: t("Horário silencioso"),
});

/** "07:00" on the account's clock (its time zone), like "visto às" in the alert message; the device's without one. */
export function clockIn(seconds: number, zone?: string | null) {
  const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  try {
    return new Intl.DateTimeFormat(getLocale(), zone ? { ...options, timeZone: zone } : options).format(seconds * 1000);
  } catch {
    return new Intl.DateTimeFormat(getLocale(), options).format(seconds * 1000);
  }
}

/** Short label and color of a state; null where nothing is shown. */
export function deliveryStatus(state: string): { label: string; tone: Tone } | null {
  const group = GROUPS[state];
  if (!group) return null;
  const [label, tone] = shortLabels()[group];
  return { label, tone };
}

/**
 * One delivery state: the channel icon (when given) and the short label in its color. The
 * technical state and the counts go to the accessible name and the tooltip, never on screen.
 */
export function StatusChip({
  state,
  icon: Icon,
  name,
  detail,
}: {
  state: string;
  icon?: LucideIcon;
  /** The channel, first in the accessible name. */
  name?: string;
  /** Extra detail; the technical state by default. */
  detail?: string;
}) {
  const status = deliveryStatus(state);
  if (!status) return null;
  const extra = detail ?? details()[state];
  const full = (name ? name + ": " : "") + [status.label, extra !== status.label && extra].filter(Boolean).join(" · ");
  return (
    <span className={clsx("status-chip", "tone-" + status.tone)} title={full}>
      {Icon && <Icon size={14} aria-hidden="true" />}
      <span aria-hidden="true">{status.label}</span>
      <span className="sr-only">{full}</span>
    </span>
  );
}

/** True when a channel had no recipient, so the person should add a contact in the profile. */
export function needsContact(event: Pick<Alert, "status" | "channels">): boolean {
  const channels = event.channels || [];
  return channels.length
    ? channels.some((item) => (item.counts.waiting_contact || 0) > 0)
    : event.status === "waiting_contact";
}

/** The state of one channel from its delivery counts: in progress first, then sent, then the problem. */
export function channelState(counts: Record<string, number>): string {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  if (!total) return "unknown";
  if (counts.sending) return "sending";
  if (counts.pending || counts.queued) return "queued";
  if (counts.held) return "held";
  if (counts.sent === total) return "sent";
  if (counts.sent) return "partial";
  return (
    ["uncertain", "failed", "waiting_contact", "waiting_service", "expired", "waiting_smtp", "quiet", "cancelled"].find(
      (state) => counts[state],
    ) || "unknown"
  );
}

const ICONS: Record<string, LucideIcon> = { email: Mail, whatsapp: MessageCircle, telegram: Send };
const channelName = (channel: string) =>
  channel === "email" ? t("E-mail") : channel === "whatsapp" ? "WhatsApp" : channel === "telegram" ? "Telegram" : t("Outro canal");

/** The state of one channel, with WhatsApp receipts when the integration confirmed them. */
function channelStatus(item: ChannelDelivery) {
  const receipts = item.channel === "whatsapp" ? item.receipts || {} : {};
  const total = Object.values(item.counts).reduce((sum, n) => sum + n, 0),
    accepted = item.counts.sent || 0;
  const read = receipts.read || 0,
    delivered = read + (receipts.delivered || 0);
  const transport = channelState(item.counts);
  const state =
    transport !== "sent"
      ? transport
      : read === accepted
        ? "read"
        : delivered === accepted
          ? "delivered"
          : receipts.failed === accepted
            ? "delivery_failed"
            : (receipts.failed || 0) > 0
              ? "delivery_partial"
              : (receipts.sent || 0) + delivered === accepted
                ? "confirmed_sent"
                : "sent";
  const counts = [
    state === "held" && item.held_until ? t("sai às {0}", [clockIn(item.held_until, item.held_zone)]) : details()[state],
    total > 1 && t("{0} de {1} destinatários", [accepted, total]),
    Object.keys(receipts).length > 0 && t("Entregues: {0}/{1} · Lidas: {2}", [delivered, total, read]),
    (receipts.failed || 0) > 0 && t("Falhas de entrega: {0}", [receipts.failed]),
  ].filter(Boolean);
  return { state, detail: counts.join(" · ") };
}

/** One chip per channel, WhatsApp first; nothing for alerts kept in the app or without records. */
export function DeliveryChannels({ event }: { event: Pick<Alert, "status" | "channels"> }) {
  const channels = event.channels || [];
  if (!channels.length) return <StatusChip state={event.status} icon={Bell} />;
  const order = ["whatsapp", "email", "telegram"];
  const chips = [...channels]
    .sort((a, b) => order.indexOf(a.channel) - order.indexOf(b.channel))
    .map((item) => ({ item, ...channelStatus(item) }))
    .filter(({ state }) => deliveryStatus(state));
  if (!chips.length) return null;
  return (
    <div className="channel-deliveries" role="group" aria-label={t("Situação por canal")}>
      {chips.map(({ item, state, detail }) => (
        <StatusChip
          key={item.channel}
          state={state}
          icon={ICONS[item.channel] || Bell}
          name={channelName(item.channel)}
          detail={detail}
        />
      ))}
    </div>
  );
}
