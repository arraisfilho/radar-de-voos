import type { ReactNode } from "react";
import { clsx } from "clsx";
import {
  ArrowDownWideNarrow,
  Bell,
  ChevronRight,
  Info,
  LoaderCircle,
  Mail,
  PlaneLanding,
  PlaneTakeoff,
  Search,
  SlidersHorizontal,
  TrendingDown,
} from "lucide-react";
import { Button } from "./ui";
import { FlightRow } from "./FlightRow";
import { t } from "./i18n";
import { formatDate, formatDuration, formatMoney, formatRelative } from "./format";
import { partyLabel } from "./passengers";
import { plural } from "./plural";
import { legDates } from "./tripSummary";
import { plainClick, routePath } from "./navigation";
import type { Alert, Config, Flight, Leg, SearchRecord, User } from "./types";

function Metric({
  icon: Icon,
  label,
  value,
  detail,
  stale = false,
  className,
}: {
  icon: typeof PlaneTakeoff;
  label: string;
  value: string;
  detail: string;
  stale?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx("card metric", className)}>
      <p className="metric-label">
        <Icon size={16} aria-hidden="true" />
        {label}
      </p>
      <p className="metric-value">{value}</p>
      <p className="metric-detail">{detail}</p>
      {stale && <span className="status-pill is-warning">{t("Atualização pendente")}</span>}
    </div>
  );
}

function stopsLabel(stops: number[]) {
  if ([0, 1, 2].every((n) => stops.includes(n))) return t("Com ou sem escalas");
  return stops.map((n) => (n === 0 ? t("Direto") : n === 1 ? t("1 escala") : t("2+ escalas"))).join(" + ");
}

/**
 * "Voos" tab: lowest fares, the trip alerts, the filters and the best options,
 * in the order a person checks them.
 */
export function TripFlights({
  search,
  config,
  user,
  flights,
  bestOut,
  bestIn,
  direction,
  onDirection,
  visibleCount,
  onShowMore,
  previewing,
  previewCompatible,
  lastAlert,
  serverNow,
  filters,
  onConfigureAlerts,
  onShowAlerts,
  onManageContacts,
}: {
  search: SearchRecord;
  config: Config;
  user: User;
  flights: Flight[];
  bestOut?: Flight;
  bestIn?: Flight;
  direction: string;
  onDirection: (direction: "outbound" | "inbound") => void;
  visibleCount: number;
  onShowMore: () => void;
  previewing: boolean;
  previewCompatible: boolean;
  lastAlert?: Alert;
  serverNow: number;
  filters: ReactNode;
  onConfigureAlerts: () => void;
  onShowAlerts: () => void;
  onManageContacts: () => void;
}) {
  const saved = search.config,
    currency = saved.currency || "BRL",
    money = (cents: number | null | undefined) => formatMoney(cents, currency);
  const leg: Leg | null = direction === "outbound" ? config.outbound : config.inbound;
  const collecting = search.state === "collecting";
  const channels =
    [saved.notify_email ? t("E-mail") : "", saved.notify_whatsapp ? "WhatsApp" : ""].filter(Boolean).join(" + ") ||
    t("Somente no painel");
  const detail = (flight?: Flight) =>
    flight ? `${formatDate(flight.departure, "short")} · ${flight.airlines[0]} · ${flight.origin} → ${flight.destination}` : t("Buscando opções");
  const alertsRoute = { view: "searches" as const, searchId: search.id, panel: "alerts" as const };
  return (
    <>
      <div className={clsx("metrics-grid", !saved.inbound && "one-way-metrics")}>
        <Metric icon={PlaneTakeoff} label={t("Menor ida")} value={money(bestOut?.price_cents)} detail={detail(bestOut)} stale={bestOut?.stale} />
        {saved.inbound && (
          <>
            <Metric icon={PlaneLanding} label={t("Menor volta")} value={money(bestIn?.price_cents)} detail={detail(bestIn)} stale={bestIn?.stale} />
            <Metric
              icon={TrendingDown}
              className="metric-total"
              label={t("Soma estimada")}
              value={bestOut && bestIn ? money(bestOut.price_cents + bestIn.price_cents) : "—"}
              detail={`${partyLabel(saved)} · ${t("bilhetes separados")}`}
            />
          </>
        )}
      </div>
      {bestOut && bestIn && bestOut.destination !== bestIn.origin && (
        <p className="airport-note">
          <Info size={16} aria-hidden="true" />
          {t("Aeroportos diferentes na ida e na volta: chegada em {0} e saída de {1}. Traslado não incluído.", [
            bestOut.destination,
            bestIn.origin,
          ])}
        </p>
      )}
      <section className="card trip-alerts-card" aria-labelledby="trip-alerts-title">
        <span className="trip-alerts-icon" aria-hidden="true">
          <Bell size={20} />
        </span>
        <div className="trip-alerts-body">
          <h2 id="trip-alerts-title">{t("Alertas desta viagem")}</h2>
          <p className="trip-alerts-summary">
            {channels} · {saved.target_cents ? t("Meta {0}", [money(saved.target_cents)]) : t("Sem meta de preço")} ·{" "}
            {t("Queda mínima {0}", [money(saved.min_drop_cents)])}
          </p>
          {lastAlert ? (
            <p className="trip-alerts-last">
              <a href={routePath(alertsRoute)} onClick={(event) => plainClick(event) && onShowAlerts()}>
                {t("Último alerta: {0}, {1}", [
                  lastAlert.payload?.kind === "target" ? t("Meta atingida") : t("Queda de preço"),
                  formatMoney(lastAlert.price, lastAlert.payload?.flight?.currency || currency),
                ])}
                <span className="trip-alerts-when"> · {formatRelative(lastAlert.created, serverNow)}</span>
                <ChevronRight size={14} aria-hidden="true" />
              </a>
            </p>
          ) : (
            <p className="trip-alerts-last">
              {saved.target_cents
                ? t("Avisaremos ao atingir {0} ou cair pelo menos {1}.", [money(saved.target_cents), money(saved.min_drop_cents)])
                : t("Uma primeira coleta cria a referência. Novas quedas elegíveis aparecem aqui.")}
            </p>
          )}
          {!user.emails.length && (
            <a
              className="trip-alerts-contact"
              href={routePath({ view: "settings" })}
              onClick={(event) => plainClick(event) && onManageContacts()}
            >
              <Mail size={15} aria-hidden="true" />
              {t("Adicione seus e-mails no perfil para receber alertas.")}
              <ChevronRight size={14} aria-hidden="true" />
            </a>
          )}
        </div>
        <Button variant="outline" onClick={onConfigureAlerts}>
          {t("Configurar alertas")}
        </Button>
      </section>
      <details className="filters-card quick-filters-card card">
        <summary>
          <SlidersHorizontal size={18} aria-hidden="true" />
          <span className="quick-filters-title">
            <strong>{t("Filtros da viagem")}</strong>
            <span>{t("Escalas, duração, horários, companhias e bagagem")}</span>
          </span>
        </summary>
        <div className="quick-filters-body">{filters}</div>
      </details>
      <section className="card results-card" aria-labelledby="results-title">
        <div className="results-head">
          <div>
            <h2 id="results-title">{t("Melhores opções")}</h2>
            <p aria-live="polite" aria-atomic="true">
              {plural(flights.length, "{0} opção encontrada", "{0} opções encontradas")} · {partyLabel(saved)} ·{" "}
              {t("por trecho")}
            </p>
          </div>
          <span className="sort-label">
            <ArrowDownWideNarrow size={15} aria-hidden="true" />
            {t("Ordenado por menor preço")}
          </span>
        </div>
        <div className="results-toolbar">
          {config.inbound ? (
            <div className="segmented results-legs" role="group" aria-label={t("Trecho exibido")}>
              <button type="button" aria-pressed={direction === "outbound"} onClick={() => onDirection("outbound")}>
                {t("Ida")} · {legDates(config.outbound, true)}
              </button>
              <button type="button" aria-pressed={direction === "inbound"} onClick={() => onDirection("inbound")}>
                {t("Volta")} · {legDates(config.inbound, true)}
              </button>
            </div>
          ) : (
            <span className="info-chip results-leg">
              {t("Ida")} · {legDates(config.outbound, true)}
            </span>
          )}
          {leg && (
            <ul className="criteria-chips" aria-label={t("Critérios desta busca")}>
              <li className="info-chip">{stopsLabel(leg.stops)}</li>
              <li className="info-chip">
                {leg.max_duration == null ? t("Sem limite de duração") : t("Até {0}", [formatDuration(leg.max_duration)])}
              </li>
              {!!config.target_cents && <li className="info-chip">{t("Meta {0}", [money(config.target_cents)])}</li>}
            </ul>
          )}
        </div>
        {previewing && (
          <p className="preview-note">
            {previewCompatible
              ? t("Prévia nos voos já coletados. Salve para atualizar o monitoramento.")
              : t("Estas mudanças precisam de nova coleta após salvar. Os preços abaixo seguem a busca salva.")}
          </p>
        )}
        <div className="flights-list">
          {!flights.length ? (
            <div className="empty-state flights-empty">
              {collecting ? <LoaderCircle className="spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
              <h3>
                {collecting
                  ? t("Buscando oportunidades…")
                  : search.last_finished
                    ? t("Nenhum voo corresponde aos filtros")
                    : t("A primeira coleta está a caminho")}
              </h3>
              <p>
                {search.error
                  ? t("Estamos atualizando suas opções. Tente buscar novamente em instantes.")
                  : search.last_finished
                    ? t("Experimente ampliar a janela ou a duração. Seus critérios não são relaxados automaticamente.")
                    : t("As tarifas reais aparecerão aqui assim que a fonte responder.")}
              </p>
            </div>
          ) : (
            flights.slice(0, visibleCount).map((flight) => <FlightRow key={flight.id + flight.direction} flight={flight} />)
          )}
        </div>
        {flights.length > visibleCount && (
          <Button className="load-more" variant="outline" onClick={onShowMore}>
            {t("Mostrar mais · {0} de {1}", [visibleCount, flights.length])}
          </Button>
        )}
        <p className="results-disclaimer">{t("Confirme disponibilidade, bagagem e condições no site de compra.")}</p>
      </section>
    </>
  );
}
