import { useEffect, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import {
  ArrowDownWideNarrow,
  Bell,
  ChevronRight,
  Info,
  LoaderCircle,
  Mail,
  MessageCircle,
  PlaneLanding,
  PlaneTakeoff,
  Search,
  SlidersHorizontal,
  TrendingDown,
} from "lucide-react";
import { Button } from "./ui";
import { RefreshButton } from "./RefreshButton";
import { FlightRow } from "./FlightRow";
import { t } from "./i18n";
import { formatDate, formatDuration, formatMoney, formatRelative } from "./format";
import { partyLabel } from "./passengers";
import { plural } from "./plural";
import { legDates } from "./tripSummary";
import { ChannelSummary } from "./AlertChannels";
import { plainClick, routePath } from "./navigation";
import type { Alert, Config, Flight, Leg, SearchRecord, User } from "./types";
import {
  DEFAULT_VIEW,
  PERIODS,
  SORTS,
  airlinesOf,
  applyView,
  isFiltered,
  loadView,
  saveView,
  type FlightView,
  type Period,
  type Sort,
  type StopsView,
} from "./flightView";

const sortLabel = (sort: Sort) =>
  ({
    price: t("Menor preço"),
    duration: t("Menor duração"),
    departure: t("Saída mais cedo"),
    "departure-late": t("Saída mais tarde"),
    arrival: t("Chegada mais cedo"),
  })[sort];
const periodLabel = (period: Period) =>
  ({ dawn: t("Madrugada"), morning: t("Manhã"), afternoon: t("Tarde"), evening: t("Noite") })[period];
const stopsViewLabel = (stops: StopsView) =>
  ({ any: t("Qualquer escala"), direct: t("Diretos"), one: t("Até 1 escala") })[stops];

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
    <div className={clsx("metric", className)}>
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

/** Filters on, over both legs: stops, duration, connection, arrival and airlines, plus checked bags. */
function filterCount(config: Config) {
  const legs = [config.outbound, config.inbound].filter((leg): leg is Leg => !!leg);
  return (
    legs.reduce(
      (sum, leg) =>
        sum +
        Number(leg.stops.length < 3) +
        Number(leg.max_duration != null) +
        Number(leg.max_layover != null) +
        Number(!!leg.arrival_before) +
        Number(leg.airlines.length > 0),
      0,
    ) + Number((config.checked_bags || 0) > 0)
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
  pendingFilters,
  onConfigureAlerts,
  onShowAlerts,
  onManageContacts,
  whatsappAvailable = false,
  emailAvailable = false,
  whatsappTo = [],
  onRefresh,
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
  /** The filters form, mounted when its card first opens. */
  filters: ReactNode;
  /** Unsaved changes of that form: it stays mounted with the card closed, as the pending bar submits it. */
  pendingFilters: boolean;
  onConfigureAlerts: () => void;
  onShowAlerts: () => void;
  onManageContacts: () => void;
  whatsappAvailable?: boolean;
  emailAvailable?: boolean;
  /** The account's WhatsApp numbers. */
  whatsappTo?: string[];
  /** Asks a manual refresh; the button counts down to the next one allowed. */
  onRefresh?: () => Promise<void> | void;
}) {
  const saved = search.config,
    currency = saved.currency || "BRL",
    money = (cents: number | null | undefined) => formatMoney(cents, currency);
  const leg: Leg | null = direction === "outbound" ? config.outbound : config.inbound;
  const collecting = search.state === "collecting";
  const detail = (flight?: Flight) =>
    flight ? `${formatDate(flight.departure, "short")} · ${flight.airlines[0]} · ${flight.origin} → ${flight.destination}` : t("Buscando opções");
  const alertsRoute = { view: "searches" as const, searchId: search.id, panel: "alerts" as const };
  // The filters form (and its code) loads when the card first opens, then stays
  // mounted: closing keeps its state. Pending changes mount it while closed, as
  // the pending bar submits it (form="monitor-filters") and its validation opens the card.
  // One state for the filters panel: mounted once opened (it keeps its form), and open now.
  const [panel, setPanel] = useState({ mounted: false, open: false });
  const panelId = "trip-filters-panel",
    activeFilters = filterCount(config);
  // Order and filters for this screen only, kept on the device per trip and leg.
  const [view, setView] = useState<FlightView>(() => loadView(search.id, direction));
  useEffect(() => setView(loadView(search.id, direction)), [search.id, direction]);
  const changeView = (patch: Partial<FlightView>) => {
    const next = { ...view, ...patch };
    setView(next);
    saveView(search.id, direction, next);
  };
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((value) => value !== item) : [...list, item]);
  const airlines = airlinesOf(flights);
  const shown = applyView(flights, view),
    filtered = isFiltered(view);
  return (
    <>
      {/* Lowest fares and the trip's alerts in one block, so the first flights show without scrolling. */}
      <section className={clsx("card trip-summary", !saved.inbound && "is-one-way")} aria-label={t("Resumo da viagem")}>
        <div className="trip-prices">
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
        <div className="trip-alerts">
          <h2 id="trip-alerts-title" className="trip-alerts-title">
            <Bell size={15} aria-hidden="true" />
            {t("Alertas desta viagem")}
          </h2>
          <Button variant="outline" size="small" className="trip-alerts-action" onClick={onConfigureAlerts}>
            {t("Configurar alertas")}
          </Button>
            <p className="trip-alerts-summary">
              <ChannelSummary
                compact
                whatsapp={saved.notify_whatsapp && whatsappAvailable ? whatsappTo : []}
                email={saved.notify_email && emailAvailable ? user.emails : []}
              />{" "}
              {saved.target_cents ? t("Meta {0}", [money(saved.target_cents)]) : t("Sem meta de preço")} ·{" "}
              {t("Queda mínima {0}", [money(saved.min_drop_cents)])}
            </p>
            {lastAlert ? (
              <p className="trip-alerts-last">
                <a href={routePath(alertsRoute)} onClick={(event) => plainClick(event) && onShowAlerts()}>
                  {t("Último alerta: {0}, {1}", [
                    lastAlert.payload?.kind !== "target"
                      ? t("Queda de preço")
                      : lastAlert.payload.reason === "reminder"
                        ? t("Ainda dentro da meta")
                        : t("Meta atingida"),
                    formatMoney(lastAlert.price, lastAlert.payload?.flight?.currency || currency),
                  ])}
                  <span className="trip-alerts-when"> · {formatRelative(lastAlert.created, serverNow)}</span>
                  <ChevronRight size={14} aria-hidden="true" />
                </a>
              </p>
            ) : !search.active ? (
              <p className="trip-alerts-last">{t("Pausado: nenhum aviso será gerado.")}</p>
            ) : (
              // The target and the minimum drop are right above: only what is not there yet.
              !search.last_success && <p className="trip-alerts-last">{t("A primeira coleta cria a referência de preço.")}</p>
            )}
            {/* A channel on without its contact: the way to fix it, WhatsApp first. */}
            {((saved.notify_whatsapp && !whatsappTo.length) || (saved.notify_email && !user.emails.length)) && (
              <a
                className="trip-alerts-contact"
                href={routePath({ view: "settings" })}
                onClick={(event) => plainClick(event) && onManageContacts()}
              >
                {saved.notify_whatsapp && !whatsappTo.length ? (
                  <>
                    <MessageCircle size={15} aria-hidden="true" />
                    {t("Cadastre um número de WhatsApp no perfil para receber alertas.")}
                  </>
                ) : (
                  <>
                    <Mail size={15} aria-hidden="true" />
                    {t("Adicione seus e-mails no perfil para receber alertas.")}
                  </>
                )}
                <ChevronRight size={14} aria-hidden="true" />
              </a>
            )}
        </div>
      </section>
      {bestOut && bestIn && bestOut.destination !== bestIn.origin && (
        <p className="airport-note">
          <Info size={16} aria-hidden="true" />
          {t("Aeroportos diferentes na ida e na volta: chegada em {0} e saída de {1}. Traslado não incluído.", [
            bestOut.destination,
            bestIn.origin,
          ])}
        </p>
      )}
      <section className="card results-card" aria-labelledby="results-title">
        <div className="results-head">
          <div>
            <h2 id="results-title">{t("Melhores opções")}</h2>
            <p aria-live="polite" aria-atomic="true">
              {plural(flights.length, "{0} opção encontrada", "{0} opções encontradas")} · {partyLabel(saved)} ·{" "}
              {t("por trecho")}
            </p>
          </div>
          <label className="sort-label">
            <ArrowDownWideNarrow size={15} aria-hidden="true" />
            <span className="sr-only">{t("Ordenar por")}</span>
            <select value={view.sort} onChange={(event) => changeView({ sort: event.target.value as Sort })}>
              {SORTS.map((sort) => (
                <option key={sort} value={sort}>
                  {sortLabel(sort)}
                </option>
              ))}
            </select>
          </label>
          {onRefresh && search.active ? (
            <RefreshButton
              refreshAfter={search.refresh_after}
              serverNow={serverNow}
              collecting={collecting}
              onRefresh={onRefresh}
            />
          ) : null}
          {/* "Critérios" opens what the trip monitors (it changes the collection); the chips below only change this list. */}
          <Button
            variant="outline"
            size="small"
            className="filters-button"
            aria-expanded={panel.open}
            aria-controls={panelId}
            onClick={() => setPanel({ mounted: true, open: !panel.open })}
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            {t("Critérios")}
            {activeFilters > 0 && (
              <span className="filters-count">
                {activeFilters}
                <span className="sr-only"> {plural(activeFilters, "filtro ativo", "filtros ativos")}</span>
              </span>
            )}
          </Button>
        </div>
        {/* A disclosure without a visible summary: the button above drives it, and a validation
            error inside it opens it too (SearchForm unfolds the details around a field). */}
        <details
          id={panelId}
          className="filters-panel"
          open={panel.open}
          onToggle={(event) => {
            const open = event.currentTarget.open;
            if (open !== panel.open) setPanel({ mounted: panel.mounted || open, open });
          }}
        >
          <summary>{t("Critérios do monitoramento")}</summary>
          <div className="quick-filters-body">{(panel.mounted || pendingFilters) && filters}</div>
        </details>
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
              <li>{stopsLabel(leg.stops)}</li>
              <li>
                {leg.max_duration == null ? t("Sem limite de duração") : t("Até {0}", [formatDuration(leg.max_duration)])}
              </li>
            </ul>
          )}
        </div>
        {flights.length > 0 && (
          <div className="view-filters" role="group" aria-label={t("Filtrar esta lista")}>
            {(["any", "direct", "one"] as StopsView[]).map((stops) => (
              <button
                key={stops}
                type="button"
                className={clsx("chip", view.stops === stops && "is-selected")}
                aria-pressed={view.stops === stops}
                onClick={() => changeView({ stops })}
              >
                {stopsViewLabel(stops)}
              </button>
            ))}
            <span className="view-filters-sep" aria-hidden="true" />
            {PERIODS.map((period) => (
              <button
                key={period}
                type="button"
                className={clsx("chip", view.periods.includes(period) && "is-selected")}
                aria-pressed={view.periods.includes(period)}
                onClick={() => changeView({ periods: toggle(view.periods, period) })}
              >
                {periodLabel(period)}
              </button>
            ))}
            {airlines.length > 1 && (
              <>
                <span className="view-filters-sep" aria-hidden="true" />
                {airlines.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={clsx("chip", view.airlines.includes(name) && "is-selected")}
                    aria-pressed={view.airlines.includes(name)}
                    onClick={() => changeView({ airlines: toggle(view.airlines, name) })}
                  >
                    {name}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
        {filtered && (
          <p className="view-count" aria-live="polite">
            {t("Mostrando {0} de {1}", [shown.length, flights.length])} ·{" "}
            <button type="button" className="link-button" onClick={() => changeView({ ...DEFAULT_VIEW, sort: view.sort })}>
              {t("Limpar")}
            </button>
          </p>
        )}
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
          ) : !shown.length ? (
            <div className="empty-state flights-empty">
              <Search aria-hidden="true" />
              <h3>{t("Nenhum voo com estes filtros")}</h3>
              <p>{t("Os filtros desta lista só mostram o que já foi coletado.")}</p>
              <Button variant="outline" onClick={() => changeView({ ...DEFAULT_VIEW, sort: view.sort })}>
                {t("Limpar filtros")}
              </Button>
            </div>
          ) : (
            shown.slice(0, visibleCount).map((flight) => <FlightRow key={flight.id + flight.direction} flight={flight} />)
          )}
        </div>
        {shown.length > visibleCount && (
          <Button className="load-more" variant="outline" onClick={onShowMore}>
            {t("Mostrar mais · {0} de {1}", [visibleCount, shown.length])}
          </Button>
        )}
        <p className="results-disclaimer">{t("Confirme disponibilidade, bagagem e condições no site de compra.")}</p>
      </section>
    </>
  );
}
