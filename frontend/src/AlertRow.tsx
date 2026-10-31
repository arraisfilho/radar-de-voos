import type { ReactNode } from "react";
import { ChevronRight, Target, TrendingDown, TrendingUp, UserRound } from "lucide-react";
import { DeliveryChannels, needsContact } from "./DeliveryChannels";
import { GoogleFlightsLink } from "./FlightRow";
import { t } from "./i18n";
import { dayKey, formatDateTime, formatDay, formatMoney, formatTime } from "./format";
import { plainClick, routePath } from "./navigation";
import { estimateLabel, estimatedFare } from "./passengers";
import { priceChangeLabel } from "./pricePresentation";
import type { Alert, Flight } from "./types";

/** A sent alert, or an observed price change ("changes" mode of the alert center). */
export type AlertItem = Alert & {
  search_id?: string;
  search_name?: string;
  archived?: number;
  currency?: string;
  flight?: Flight;
};

/**
 * One alert: trend icon, title, trip and flight, large price, channel chips
 * and the actions that follow from it.
 */
export function AlertRow({
  item,
  observed = false,
  tripName,
  onOpenTrip,
  onManageContacts,
}: {
  item: AlertItem;
  observed?: boolean;
  tripName?: string;
  onOpenTrip?: () => void;
  onManageContacts?: () => void;
}) {
  const flight = observed ? item.flight : item.payload?.flight;
  const currency = (observed ? item.currency : flight?.currency) || "BRL";
  const rise = observed && item.previous !== null && item.price > item.previous;
  const kind = rise ? "rise" : !observed && item.payload?.kind === "target" ? "target" : "drop";
  const Icon = kind === "rise" ? TrendingUp : kind === "target" ? Target : TrendingDown;
  const title = observed
    ? rise
      ? t("Preço subiu")
      : t("Preço caiu")
    : kind === "target"
      ? item.payload?.reason === "reminder"
        ? t("Ainda dentro da meta")
        : t("Meta atingida")
      : t("Queda de preço");
  // A goal met says how far below the target it is; "Preço subiu" belongs to the price changes only.
  const target = item.payload?.target_cents;
  const change =
    kind !== "target"
      ? priceChangeLabel(item.previous, item.price, currency)
      : target == null
        ? t("Dentro da meta")
        : target > item.price
          ? t("Dentro da meta ({0}) · {1} abaixo da meta", [formatMoney(target, currency), formatMoney(target - item.price, currency)])
          : t("Dentro da meta ({0})", [formatMoney(target, currency)]);
  const trip = [
    tripName,
    item.direction === "outbound" ? t("Ida") : t("Volta"),
    flight ? `${flight.origin} → ${flight.destination}` : "",
  ].filter(Boolean);
  const tripRoute = item.search_id
    ? routePath({ view: item.archived ? "history" : "searches", searchId: item.search_id })
    : null;
  const contact = !observed && needsContact(item);
  // A sent alert is a snapshot: the fare may have changed since. Both kinds say when the fare is an estimate.
  const note = [
    !observed && t("Melhor preço encontrado para suas preferências. A opção pode ter mudado."),
    flight && estimatedFare(flight) && estimateLabel(flight),
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <article className={`alert-row is-${kind}`}>
      <span className="alert-row-icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <div className="alert-row-head">
        <p className="alert-row-title">
          <strong>{title}</strong>
          <time dateTime={Number.isFinite(item.created) ? new Date(item.created * 1000).toISOString() : undefined}>
            {formatTime(item.created)}
          </time>
        </p>
        <p className="alert-row-trip">{trip.join(" · ")}</p>
        {flight && (
          <p className="alert-row-flight">
            {flight.airlines.join(" / ")} · {formatDateTime(flight.departure)}
          </p>
        )}
        {note && <p className="alert-row-note">{note}</p>}
      </div>
      <p className="alert-row-price">
        <strong>{formatMoney(item.price, currency)}</strong>
        {item.previous !== null && item.previous > item.price && (
          <del>
            <span className="sr-only">{t("Preço anterior:")} </span>
            {formatMoney(item.previous, currency)}
          </del>
        )}
        {change && <small>{change}</small>}
      </p>
      <div className="alert-row-foot">
        {observed ? (
          <span className="delivery-badge">{t("Variação observada · no painel")}</span>
        ) : (
          <DeliveryChannels event={item} />
        )}
        {(contact || tripRoute || (!observed && flight?.search_url)) && (
          <div className="alert-row-actions">
            {contact && (
              <a
                className="button button-outline button-small"
                href={routePath({ view: "settings" })}
                onClick={(event) => onManageContacts && plainClick(event) && onManageContacts()}
              >
                <UserRound size={14} aria-hidden="true" />
                {t("Configurar contato")}
              </a>
            )}
            {tripRoute && (
              <a
                className="button button-ghost button-small"
                href={tripRoute}
                onClick={(event) => onOpenTrip && plainClick(event) && onOpenTrip()}
              >
                {t("Abrir viagem")}
                <ChevronRight size={14} aria-hidden="true" />
              </a>
            )}
            {!observed && flight?.search_url && <GoogleFlightsLink flight={flight} />}
          </div>
        )}
      </div>
    </article>
  );
}

/** Items (newest first) grouped under "Hoje", "Ontem" or the date. */
export function AlertDays<T extends { id: string | number; created: number }>({
  items,
  now,
  level = 2,
  render,
}: {
  items: T[];
  now: number;
  level?: 2 | 3;
  render: (item: T) => ReactNode;
}) {
  const groups: { key: string; items: T[] }[] = [];
  for (const item of items) {
    const key = dayKey(item.created),
      last = groups.at(-1);
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, items: [item] });
  }
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className="alert-days">
      {groups.map((group) => (
        <section key={group.key} className="list-section alert-day">
          <Heading className="list-section-title">{formatDay(group.items[0].created, now)}</Heading>
          <div className="list-group alert-list">
            {group.items.map((item) => (
              <div key={item.id} className="alert-list-item">
                {render(item)}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
