import { memo, useId, useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { clsx } from "clsx";
import { AirlineLogo } from "./AirlineLogo";
import { Button } from "./ui";
import { t, useLanguage } from "./i18n";
import { formatDate, formatDateTime, formatDuration, formatMoney, formatTime, toDate } from "./format";
import { partyLabel } from "./passengers";
import { plural } from "./plural";
import type { Flight } from "./types";

/** Calendar days between two local wall-clock times ("+1" for an arrival the next day). */
function dayOffset(departure: string, arrival: string) {
  const from = toDate(departure.slice(0, 10)),
    to = toDate(arrival.slice(0, 10));
  return Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())
    ? 0
    : Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/** Link to the fare on Google Flights, with a name that tells the rows apart. */
export function GoogleFlightsLink({ flight, className }: { flight: Flight; className?: string }) {
  const airline = flight.airlines.join(" / ");
  return (
    <a
      className={clsx("button button-outline button-small google-flights-link", className)}
      href={flight.search_url}
      target="_blank"
      rel="noreferrer"
    >
      {t("Ver no Google Voos")}
      <span className="sr-only">
        {`: ${t("{0}, saída às {1}, {2}", [airline, formatTime(flight.departure), formatMoney(flight.price_cents, flight.currency || "BRL")])}`}
      </span>
      <ExternalLink size={14} aria-hidden="true" />
      <span className="sr-only"> {t("(abre em nova aba)")}</span>
    </a>
  );
}

/**
 * One flight option. Wide screens keep logo, times, price and action on one
 * row; phones stack times, details, then price (left) and action (right).
 */
export const FlightRow = memo(function FlightRow({ flight }: { flight: Flight }) {
  useLanguage();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const airline = flight.airlines.join(" / ");
  const codes = flight.airline_codes || [];
  const departure = formatTime(flight.departure),
    arrival = formatTime(flight.arrival);
  const days = dayOffset(flight.departure, flight.arrival);
  const stops = flight.stops ? plural(flight.stops, "{0} escala", "{0} escalas") : t("Direto");
  return (
    <article className={clsx("flight-row", flight.stale && "is-stale")}>
      <div className="flight-row-main">
        <span className={clsx("flight-logos", flight.airlines.length > 1 && "is-multiple")} aria-hidden="true">
          {flight.airlines.slice(0, 2).map((name, i) => (
            <AirlineLogo key={name} name={name} code={codes[i]} />
          ))}
        </span>
        <div className="flight-info">
          <p className="flight-times">
            <span>
              <strong>{departure}</strong> <span className="flight-airport">{flight.origin}</span>
            </span>
            <span className="flight-arrow" aria-hidden="true">
              →
            </span>
            <span className="sr-only"> – </span>
            <span>
              <strong>{arrival}</strong>
              {days > 0 && (
                <>
                  <sup className="flight-days" aria-hidden="true" title={formatDate(flight.arrival, "medium")}>
                    +{days}
                  </sup>
                  <span className="sr-only"> ({formatDate(flight.arrival, "short")})</span>
                </>
              )}{" "}
              <span className="flight-airport">{flight.destination}</span>
            </span>
          </p>
          <p className="flight-meta">
            {airline} · {formatDate(flight.departure, "short")} · {formatDuration(flight.duration_minutes)} · {stops}
          </p>
        </div>
        <div className="flight-foot">
          <p className="flight-price">
            <strong>{formatMoney(flight.price_cents, flight.currency || "BRL")}</strong>
            <small>
              {partyLabel(flight)} · {t("por trecho")}
            </small>
          </p>
          <GoogleFlightsLink flight={flight} />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="flight-expand"
          aria-label={`${t("Detalhes do itinerário")}: ${airline}, ${departure}`}
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDown size={18} aria-hidden="true" />
        </Button>
      </div>
      {flight.stale && (
        <p className="flight-stale">
          <span className="status-pill is-warning">{t("Último preço encontrado · atualização pendente")}</span>
        </p>
      )}
      <div id={detailsId} className="flight-details" hidden={!expanded}>
        {expanded && (
          <>
            <ol className="flight-segments">
              {flight.segments.map((segment, index) => (
                <li key={index}>
                  <strong>
                    {segment.origin} → {segment.destination}
                  </strong>
                  <span>
                    {formatDateTime(segment.departure, "numeric")} → {formatDateTime(segment.arrival, "numeric")}
                  </span>
                  {index < flight.layovers.length && (
                    <small>{t("Conexão de {0}", [formatDuration(flight.layovers[index])])}</small>
                  )}
                </li>
              ))}
            </ol>
            <p className="help">
              {flight.checked_bags_requested
                ? t(
                    flight.checked_bags_requested === 1
                      ? "Pesquisa com taxas estimadas para {0} mala despachada. Franquia e peso a confirmar na companhia."
                      : "Pesquisa com taxas estimadas para {0} malas despachadas. Franquia e peso a confirmar na companhia.",
                    [flight.checked_bags_requested],
                  )
                : t("Taxas de bagagem não adicionadas à pesquisa. Confira a franquia da tarifa na companhia.")}
            </p>
            <p className="help">{t("Preço atualizado às {0}", [formatTime(flight.collected_at)])}</p>
          </>
        )}
      </div>
    </article>
  );
});
