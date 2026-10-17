import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import { clsx } from "clsx";
import { t, useLanguage } from "./i18n";
import { formatDate, formatRelative, formatTime } from "./format";
import { plural } from "./plural";
import type { Route, SearchRecord, SourceKind, SourceStatus } from "./types";

/** Plain-language reason for one failed fare query (API contract, section 8). */
export function queryFailure(route: Pick<Route, "error" | "error_kind">): string {
  switch (route.error_kind) {
    case "rate_limited":
    case "blocked":
    case "timeout":
    case "network":
    case "server":
    case "no_results":
      return sourceKindLabel(route.error_kind);
    default:
      // "format" and "unknown" carry an existing backend sentence.
      return route.error ? t(route.error) : t("Consulta não concluída");
  }
}

/** One sentence per failure kind, for the trip notices and the administration. */
export function sourceKindLabel(kind: SourceKind | null | undefined): string {
  switch (kind) {
    case "rate_limited":
      return t("A fonte limitou temporariamente as consultas");
    case "blocked":
      return t("A fonte bloqueou temporariamente as consultas");
    case "timeout":
      return t("A fonte não respondeu a tempo");
    case "network":
      return t("Não foi possível conectar à fonte de tarifas");
    case "server":
      return t("A fonte de tarifas está indisponível no momento");
    case "format":
      return t("Não foi possível processar a resposta da fonte");
    case "no_results":
      return t("Nenhum voo encontrado para essas datas nesta consulta");
    default:
      return t("Consulta não concluída");
  }
}

/**
 * Why the collection is paused. Only the global kinds (rate limit, block,
 * format change) speak for the whole source; a pause after failures of one
 * route kind (timeout, network, server, no results) is described neutrally.
 */
function pauseReason(kind: SourceKind | null) {
  return kind === "rate_limited"
    ? t("a fonte de tarifas está limitando consultas.")
    : kind === "blocked"
      ? t("a fonte de tarifas bloqueou as consultas temporariamente.")
      : kind === "format"
        ? t("a fonte de tarifas mudou o formato das respostas.")
        : t("houve falhas seguidas nas consultas.");
}

/** Lead and sentence describing a paused or unstable fare source; null when it works. */
export function sourceMessage(source: SourceStatus | null | undefined, now: number) {
  if (!source || source.status === "ok") return null;
  if (source.status === "paused")
    return {
      tone: "warning" as const,
      lead: t("Coleta pausada:"),
      text: `${pauseReason(source.kind)} ${
        source.retry_at && source.retry_at > now
          ? t("Nova tentativa às {0}.", [formatTime(source.retry_at)])
          : t("Uma consulta de teste está em andamento.")
      }`,
    };
  return {
    tone: "info" as const,
    lead: t("Coleta instável:"),
    text: t("algumas consultas à fonte de tarifas falharam recentemente. Os preços podem demorar a atualizar."),
  };
}

/** Discreet banner about the fare source, for pages that list several trips. */
export function SourceNotice({ source, now }: { source?: SourceStatus | null; now: number }) {
  const message = sourceMessage(source, now);
  if (!message) return null;
  return (
    <div className={clsx("banner source-notice", message.tone)} role="status">
      <CircleAlert size={18} aria-hidden="true" />
      <p>
        <strong>{message.lead}</strong> {message.text}
      </p>
    </div>
  );
}

/**
 * Why the prices of this trip may be behind: the fare source state, or the
 * queries of the last update that did not finish, grouped by reason.
 */
export function CollectionNotice({
  source,
  routes,
  now,
}: {
  source?: SourceStatus | null;
  routes: Route[];
  now: number;
}) {
  useLanguage();
  const message = sourceMessage(source, now);
  const failed = routes.filter((route) => route.stale && (route.error || route.error_kind));
  if (!message && !failed.length) return null;
  const reasons = new Map<string, Route[]>();
  for (const route of failed) {
    const reason = queryFailure(route);
    reasons.set(reason, [...(reasons.get(reason) || []), route]);
  }
  return (
    <div className={clsx("banner collection-notice", message?.tone || "warning")} role="status">
      <CircleAlert size={18} aria-hidden="true" />
      <div>
        {message ? (
          <p>
            <strong>{message.lead}</strong> {message.text}
          </p>
        ) : (
          <>
            <p>
              <strong>
                {plural(
                  failed.length,
                  "{0} consulta não foi concluída na última atualização.",
                  "{0} consultas não foram concluídas na última atualização.",
                )}
              </strong>{" "}
              {t("Os preços exibidos são os últimos encontrados.")}
            </p>
            <ul>
              {[...reasons].map(([reason, items]) => (
                <li key={reason}>
                  {reason}
                  <small>
                    {items
                      .slice(0, 3)
                      .map((route) => `${route.origin} → ${route.destination} · ${formatDate(route.date, "short")}`)
                      .join(", ")}
                    {items.length > 3 ? ` ${t("e mais {0}", [items.length - 3])}` : ""}
                  </small>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

// Only this small component renders each second; flight results do not tick.
export function LiveStatus({
  search,
  serverTime,
  updatedAt,
  error,
  source,
}: {
  search: SearchRecord;
  serverTime: number;
  updatedAt: number;
  error: boolean;
  source?: SourceStatus | null;
}) {
  useLanguage();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const serverNow = serverTime + Math.max(0, now - updatedAt) / 1000;
  const remaining = Math.max(0, Math.ceil((search.next_due || 0) - serverNow));
  const countdown = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  const collecting = search.state === "collecting";
  const sourcePaused = source?.status === "paused";
  const tone = error ? "error" : !search.active ? "paused" : sourcePaused ? "waiting" : "live";
  const pill = error
    ? t("Desconectado")
    : !search.active
      ? t("Pausado")
      : sourcePaused
        ? t("Coleta pausada")
        : t("Ao vivo");
  const label = error
    ? t("Sem conexão com o servidor")
    : !search.active
      ? t("Retome para voltar a acompanhar os preços")
      : sourcePaused
        ? source?.retry_at && source.retry_at > serverNow
          ? t("Nova tentativa às {0}", [formatTime(source.retry_at)])
          : t("Consulta de teste em andamento")
        : collecting
          ? t("Atualizando preços…")
          : remaining
            ? t("Próxima atualização em {0}", [countdown])
            : t("Na fila de atualização");
  return (
    <span className="live-status">
      <span className={clsx("live-pill", `is-${tone}`, collecting && tone === "live" && "is-collecting")}>
        <i className="live-dot" aria-hidden="true" />
        {pill}
      </span>
      <span className="live-status-counter">{label}</span>
      <small className="live-status-updated">
        {t("Última atualização:")}{" "}
        {search.last_success ? formatRelative(search.last_success, serverNow) : t("Ainda não realizada")}
      </small>
    </span>
  );
}
