import { Archive, Armchair, Bell, CalendarDays, ChevronDown, Ellipsis, Pause, Pencil, Play, RotateCcw, Trash2, UsersRound } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Card, ContextMenu } from "./ui";
import { LiveStatus, CollectionNotice } from "./LiveStatus";
import { RouteCodes, RoutePlaces } from "./RouteSummary";
import { cityLabel, placeLabel } from "./airports";
import { t } from "./i18n";
import { formatDateRange, formatDateTimeRange } from "./format";
import { partyLabel } from "./passengers";
import { plainClick, routePath, type Navigate } from "./navigation";
import { tripTitle } from "./tripSummary";
import type { Airport, Leg, Route, SearchRecord, SourceStatus } from "./types";

export function cabinLabel(cabin: string) {
  return (
    {
      economy: t("Econômica"),
      "premium-economy": t("Econômica premium"),
      business: t("Executiva"),
      first: t("Primeira classe"),
    } as Record<string, string>
  )[cabin] || cabin;
}

/** Departure window; whole days show only the dates. */
function legWindow(leg: Leg) {
  const end = leg.end || leg.start;
  return leg.start.endsWith("T00:00") && end.endsWith("T23:59")
    ? formatDateRange(leg.start.slice(0, 10), end.slice(0, 10), "short")
    : formatDateTimeRange(leg.start, end);
}

function LegFact({ label, leg }: { label: string; leg: Leg }) {
  return (
    <li className="trip-hero-dates">
      <CalendarDays size={14} aria-hidden="true" />
      <span>
        <strong>{label}</strong> {legWindow(leg)}
      </span>
    </li>
  );
}

/**
 * Trip header in about 120 px: the route and its actions on one row, then the live status and the
 * search details on one line. A paused trip shows "Retomar"; an ended one, restoring or reusing.
 */
export function TripHero({
  search,
  airports,
  routes,
  source,
  serverTime,
  serverNow,
  updatedAt,
  connectionError,
  ended,
  busy,
  onEdit,
  onAlerts,
  onToggle,
  onEnd,
  onDelete,
  onRestore,
  listing = false,
  switcher,
}: {
  search: SearchRecord;
  airports: Airport[];
  routes: Route[];
  source?: SourceStatus | null;
  serverTime: number;
  serverNow: number;
  updatedAt: number;
  connectionError: boolean;
  ended: boolean;
  busy: boolean;
  onEdit: () => void;
  onAlerts: () => void;
  onToggle: () => void;
  onEnd: () => void;
  onDelete: () => void;
  onRestore: () => void;
  /** Above the flight list, which repeats the dates on its leg buttons: phones leave them out here. */
  listing?: boolean;
  /** With two trips or more: on phones the route title itself picks the trip (same choices as the page's selector). */
  switcher?: { value: string; onChange: (id: string) => void; options: ReactNode };
}) {
  const config = search.config,
    summary = tripTitle(config),
    restorable = search.ends_at > serverNow;
  return (
    <Card className={listing ? "route-card is-listing" : "route-card"}>
      <div className="trip-hero-top">
        <div className={switcher ? "trip-hero-route has-switcher" : "trip-hero-route"}>
          {summary.secondaryRoute ? (
            <>
              <h1 tabIndex={-1} className="trip-hero-name">
                {summary.title}
              </h1>
              <RouteCodes config={config} className="trip-hero-codes is-secondary" />
            </>
          ) : (
            <h1 tabIndex={-1} className="trip-hero-heading">
              <RouteCodes config={config} className="trip-hero-codes" />
            </h1>
          )}
          {switcher && (
            // Phones: the title is the trip selector (a native select over it, ▾ beside the codes).
            <>
              <ChevronDown className="trip-hero-switch-mark" size={18} aria-hidden="true" />
              <select
                className="trip-hero-switch"
                aria-label={t("Trocar de viagem")}
                value={switcher.value}
                onChange={(event) => switcher.onChange(event.target.value)}
              >
                {switcher.options}
              </select>
            </>
          )}
          <RoutePlaces config={config} airports={airports} className="trip-hero-places" />
          {/* Phones: only the cities, on one line; the airport names stay in the tooltip. */}
          <p
            className="trip-hero-cities"
            title={`${placeLabel(config.origins, airports) || config.origins.join(" / ")} → ${placeLabel(config.destinations, airports) || config.destinations.join(" / ")}`}
          >
            {cityLabel(config.origins, airports)} → {cityLabel(config.destinations, airports)}
          </p>
        </div>
        <div className="trip-hero-actions">
          {ended ? (
            <Button variant="outline" disabled={busy} onClick={onRestore}>
              <RotateCcw size={16} aria-hidden="true" />
              {restorable ? t("Voltar ao monitoramento") : t("Reutilizar com novas datas")}
            </Button>
          ) : !search.active ? (
            // A paused trip: resuming is the main action, in sight.
            <Button disabled={busy} onClick={onToggle}>
              <Play size={16} aria-hidden="true" />
              {t("Retomar")}
            </Button>
          ) : (
            // "Editar viagem" names it; phones show only the pencil (44 px) beside the menu.
            <Button variant="outline" className="trip-hero-edit" aria-label={t("Editar viagem")} onClick={onEdit}>
              <Pencil size={16} aria-hidden="true" />
              <span className="trip-hero-edit-label">{t("Editar")}</span>
            </Button>
          )}
          <ContextMenu
            className="trip-menu"
            summaryClassName="icon-trigger"
            summaryLabel={t("Ações da viagem")}
            label={<Ellipsis size={20} aria-hidden="true" />}
          >
            {!ended && (
              <>
                {!search.active && (
                  <button type="button" className="menu-item" onClick={onEdit}>
                    <Pencil size={18} aria-hidden="true" />
                    {t("Editar viagem")}
                  </button>
                )}
                <button type="button" className="menu-item" onClick={onAlerts}>
                  <Bell size={18} aria-hidden="true" />
                  {t("Configurar alertas")}
                </button>
                {search.active && (
                  <button type="button" className="menu-item" disabled={busy} onClick={onToggle}>
                    <Pause size={18} aria-hidden="true" />
                    {t("Pausar monitoramento")}
                  </button>
                )}
                <div className="menu-separator" role="separator" />
                <button type="button" className="menu-item" disabled={busy} onClick={onEnd}>
                  <Archive size={18} aria-hidden="true" />
                  {t("Encerrar monitoramento…")}
                </button>
              </>
            )}
            <button type="button" className="menu-item is-destructive" disabled={busy} onClick={onDelete}>
              <Trash2 size={18} aria-hidden="true" />
              {t("Excluir monitoramento…")}
            </button>
          </ContextMenu>
        </div>
      </div>
      <div className="trip-hero-meta">
        <div className="route-live">
          {ended ? (
            <span className="live-status">
              <span className="live-pill is-ended">
                <i className="live-dot" aria-hidden="true" />
                {t("Encerrado")}
              </span>
              <span className="live-status-counter">{t("Histórico preservado.")}</span>
            </span>
          ) : (
            <LiveStatus
              search={search}
              serverTime={serverTime}
              updatedAt={updatedAt}
              error={connectionError}
              source={source}
            />
          )}
        </div>
        <ul className="trip-hero-facts" aria-label={t("Detalhes da viagem")}>
          <LegFact label={t("Ida")} leg={config.outbound} />
          {config.inbound && <LegFact label={t("Volta")} leg={config.inbound} />}
          <li>
            <UsersRound size={14} aria-hidden="true" />
            {partyLabel(config)}
          </li>
          <li>
            <Armchair size={14} aria-hidden="true" />
            {cabinLabel(config.cabin)}
          </li>
        </ul>
      </div>
      {!ended && <CollectionNotice source={source} routes={routes} now={serverNow} />}
    </Card>
  );
}

export type TripSection = "flights" | "history" | "alerts";

/** Voos | Histórico | Alertas: real links in the segmented style. */
export function TripSections({
  searchId,
  current,
  ended,
  navigate,
}: {
  searchId: string;
  current: TripSection;
  ended: boolean;
  navigate: Navigate;
}) {
  const sections = [
    ...(ended ? [] : [{ id: "flights" as const, label: t("Voos"), route: { view: "searches" as const, searchId } }]),
    { id: "history" as const, label: t("Histórico"), route: { view: "history" as const, searchId } },
    { id: "alerts" as const, label: t("Alertas"), route: { view: "searches" as const, searchId, panel: "alerts" as const } },
  ];
  return (
    <nav className="monitor-sections" aria-label={t("Seções do monitoramento")}>
      <div className="segmented">
        {sections.map((section) => (
          <a
            key={section.id}
            href={routePath(section.route)}
            aria-current={current === section.id ? "page" : undefined}
            onClick={(event) => plainClick(event) && navigate(section.route)}
          >
            {section.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
