import { Mail, MessageCircle, Send, Bell, ChevronDown } from "lucide-react";
import { t } from "./i18n";
import type { Alert, ChannelDelivery } from "./types";

const labels = (): Record<string, string> => ({
  sent: t("Aceito"),
  pending: t("Na fila"),
  queued: t("Na fila"),
  sending: t("Enviando"),
  failed: t("Falhou"),
  uncertain: t("Não confirmado"),
  partial: t("Envio parcial"),
  cancelled: t("Cancelado"),
  expired: t("Expirado"),
  quiet: t("Silenciado neste horário"),
  waiting_contact: t("Sem destinatário"),
  waiting_service: t("Canal indisponível"),
  waiting_smtp: t("Aguardando serviço de envio"),
  in_app: t("Somente no painel"),
  unknown: t("Estado indisponível"),
});
export function channelState(counts: Record<string, number>): string {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  if (!total) return "unknown";
  if (counts.sending) return "sending";
  if (counts.pending || counts.queued) return "queued";
  if (counts.sent === total) return "sent";
  if (counts.sent) return "partial";
  if (counts.uncertain) return "uncertain";
  if (counts.failed) return "failed";
  return Object.keys(counts).length === 1 ? Object.keys(counts)[0] : "unknown";
}
function Channel({ item }: { item: ChannelDelivery }) {
  const state = channelState(item.counts),
    names = labels();
  const Icon =
    item.channel === "email"
      ? Mail
      : item.channel === "whatsapp"
        ? MessageCircle
        : item.channel === "telegram"
          ? Send
          : Bell;
  const name =
    item.channel === "email"
      ? t("E-mail")
      : item.channel === "whatsapp"
        ? "WhatsApp"
        : item.channel === "telegram"
          ? "Telegram"
          : t("Outro canal");
  const total = Object.values(item.counts).reduce((sum, n) => sum + n, 0),
    accepted = item.counts.sent || 0;
  return (
    <details className={`channel-delivery channel-${state}`}>
      <summary>
        <Icon size={15} aria-hidden="true" />
        <span>{name}</span>
        <strong>{names[state] || names.unknown}</strong>
        {total > 1 && (
          <small>
            {accepted}/{total}
          </small>
        )}
        <ChevronDown size={13} aria-hidden="true" />
      </summary>
      <div className="channel-delivery-details">
        <p>{t("{0} de {1} envios aceitos", [accepted, total])}</p>
        <ul>
          {Object.entries(item.counts).map(([status, count]) => (
            <li key={status}>
              {names[status] || names.unknown}: {count}
            </li>
          ))}
        </ul>
        {["failed", "uncertain", "partial"].includes(state) && <p>{t("Revise os contatos no perfil. Se estiverem corretos, solicite à administração a verificação do canal.")}</p>}
        {state === "waiting_contact" && <p>{t("Cadastre um contato no perfil para receber os próximos alertas.")}</p>}
        {["waiting_smtp", "waiting_service"].includes(state) && <p>{t("A administração precisa configurar o serviço de envio.")}</p>}
        <p>{t("Aceito pelo provedor não confirma entrega ou leitura.")}</p>
      </div>
    </details>
  );
}
export function DeliveryChannels({
  event,
}: {
  event: Pick<Alert, "status" | "channels">;
}) {
  const channels = event.channels || [];
  if (!channels.length)
    return (
      <span
        className={`delivery-badge ${event.status === "sent" ? "success" : ""}`}
        title={t(
          "Os detalhes por canal dependem dos registros de envio disponíveis.",
        )}
      >
        {labels()[event.status] || labels().unknown}
      </span>
    );
  const order = ["email", "whatsapp", "telegram"];
  const total = channels.reduce(
    (sum, item) => sum + Object.values(item.counts).reduce((a, b) => a + b, 0),
    0,
  );
  const accepted = channels.reduce(
    (sum, item) => sum + (item.counts.sent || 0),
    0,
  );
  const incomplete =
    event.status === "partial" && (accepted === 0 || accepted === total);
  return (
    <div
      className="channel-deliveries"
      role="group"
      aria-label={t("Situação por canal")}
    >
      {incomplete && (
        <span className="delivery-badge">
          {t("Envio parcial · registros incompletos")}
        </span>
      )}
      {[...channels]
        .sort((a, b) => order.indexOf(a.channel) - order.indexOf(b.channel))
        .map((item) => (
          <Channel key={item.channel} item={item} />
        ))}
    </div>
  );
}
