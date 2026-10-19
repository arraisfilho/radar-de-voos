import { t } from "./i18n";

/** Short names of the reason codes of backend/health.py (LEVELS): incidents and the audit. */
export function healthCodeLabels(): Record<string, string> {
  return {
    source_paused: t("Fonte de tarifas pausada"),
    collector_late: t("Coletor de tarifas sem sinal"),
    whatsapp_late: t("Envio de WhatsApp sem sinal"),
    email_late: t("Envio de e-mail sem sinal"),
    error_rate: t("Falhas nas consultas à fonte"),
    queue_delay: t("Fila de coletas atrasada"),
    stale_trip: t("Viagem sem coleta"),
    whatsapp_failing: t("Falhas no envio de WhatsApp"),
    email_failing: t("Falhas no envio de e-mail"),
    source_canary: t("Rota de controle falhando"),
  };
}

export const healthCodeLabel = (code: string) => healthCodeLabels()[code] || code;
