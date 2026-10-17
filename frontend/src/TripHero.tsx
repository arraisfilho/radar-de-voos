import { Archive, Armchair, Bell, CalendarDays, Ellipsis, Pause, Pencil, Play, RotateCcw, Trash2, UsersRound } from "lucide-react";
import { Button, Card, ContextMenu } from "./ui";
import { LiveStatus, CollectionNotice } from "./LiveStatus";
import { RouteCodes, RoutePlaces } from "./RouteSummary";
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

function LegChip({ label, leg }: { label: string; leg: Leg }) {
  return (
    <li className="info-chip">
      <CalendarDays size={15} aria-hidden="true" />
      <span>
        <strong>{label}</strong> {legWindow(leg)}
      </span>
    </li>
  );
}

/**
 * Trip header: live status and actions, the route as on a boarding pass and
 * the search details. Ended trips offer restoring or reusing instead of editing.
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
}) {
  const config = search.config,
    summary = tripTitle(config),
    restorable = search.ends_at > serverNow;
  return (
    <Card className="route-card">
      <div className="trip-hero-top">
        <div className="route-live">
          {ended ? (
            <span className="live-status">
              <span className="live-pill is-ended">
                <i className="live-dot" aria-hidden="true" />
                {t("Encerrado")}
              </span>
              <span className="live-status-counter">{t("Monitoramento encerrado. Histórico preservado.")}</span>
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
        <div className="trip-hero-actions">
          {ended ? (
            <Button variant="outline" disabled={busy} onClick={onRestore}>
              <RotateCcw size={16} aria-hidden="true" />
              {restorable ? t("Voltar ao monitoramento") : t("Reutilizar com novas datas")}
            </Button>
          ) : (
            <Button variant="outline" onClick={onEdit}>
              <Pencil size={16} aria-hidden="true" />
              {t("Editar")}
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
                <button type="button" className="menu-item" onClick={onAlerts}>
                  <Bell size={18} aria-hidden="true" />
                  {t("Configurar alertas")}
                </button>
                <button type="button" className="menu-item" disabled={busy} onClick={onToggle}>
                  {search.active ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
                  {search.active ? t("Pausar monitoramento") : t("Retomar monitoramento")}
                </button>
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
      <div className="trip-hero-route">
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
        <RoutePlaces config={config} airports={airports} className="trip-hero-places" />
      </div>
      <ul className="trip-hero-chips" aria-label={t("Detalhes da viagem")}>
        <LegChip label={t("Ida")} leg={config.outbound} />
        {config.inbound && <LegChip label={t("Volta")} leg={config.inbound} />}
        <li className="info-chip">
          <UsersRound size={15} aria-hidden="true" />
          {partyLabel(config)}
        </li>
        <li className="info-chip">
          <Armchair size={15} aria-hidden="true" />
          {cabinLabel(config.cabin)}
        </li>
      </ul>
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
