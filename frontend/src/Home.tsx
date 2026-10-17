import { useState } from "react";
import { CalendarDays, ChevronRight, Plane, Plus } from "lucide-react";
import { Button } from "./ui";
import { t } from "./i18n";
import { tripTitle, legDates } from "./tripSummary";
import { partyLabel } from "./passengers";
import { formatMoney, formatRelative } from "./format";
import { plainClick, routePath } from "./navigation";
import { RouteCodes, RoutePlaces } from "./RouteSummary";
import type { Airport, SearchRecord } from "./types";

type Filter = "active" | "paused" | "ended";
const FILTERS: Filter[] = ["active", "paused", "ended"];

function filterLabel(filter: Filter) {
  return filter === "active" ? t("Ativas") : filter === "paused" ? t("Pausadas") : t("Encerradas");
}

function statusLabel(filter: Filter) {
  return filter === "active" ? t("Ativa") : filter === "paused" ? t("Pausada") : t("Encerrada");
}

/** First access: what the radar does, in the order the person will use it. */
function Onboarding({ onNew }: { onNew: () => void }) {
  const steps = [
    [t("Escolha rota e datas"), t("Informe origem, destino e a janela em que você pode viajar.")],
    [t("Acompanhe os preços ao vivo"), t("O radar consulta as tarifas ao longo do dia e destaca as melhores opções.")],
    [t("Receba alertas por WhatsApp ou e-mail"), t("Avisamos quando o preço cair ou atingir a sua meta.")],
  ];
  return (
    <section className="card home-empty" aria-labelledby="home-empty-title">
      <span className="empty-icon" aria-hidden="true">
        <Plane />
      </span>
      <h2 id="home-empty-title">{t("Qual será sua próxima viagem?")}</h2>
      <p className="home-empty-copy">
        {t("Crie um monitoramento e acompanhe as tarifas sem precisar pesquisar todos os dias.")}
      </p>
      <ol className="onboarding-steps" role="list">
        {steps.map(([title, text], index) => (
          <li key={title}>
            <span className="onboarding-number" aria-hidden="true">
              {index + 1}
            </span>
            <span>
              <strong>{title}</strong>
              <span>{text}</span>
            </span>
          </li>
        ))}
      </ol>
      <Button size="large" onClick={onNew}>
        <Plus size={20} aria-hidden="true" />
        {t("Criar meu primeiro monitoramento")}
      </Button>
    </section>
  );
}

/** Boarding-pass card: one stretched link opens the trip. */
function TripCard({
  search,
  status,
  airports,
  serverNow,
  onOpen,
}: {
  search: SearchRecord;
  status: Filter;
  airports: Airport[];
  serverNow: number;
  onOpen: (id: string, history: boolean) => void;
}) {
  const summary = tripTitle(search.config),
    config = search.config,
    ended = status === "ended",
    headingId = `trip-card-${search.id}`;
  const sides = config.inbound ? (["outbound", "inbound"] as const) : (["outbound"] as const);
  const updated = Math.max(0, ...sides.map((side) => search.summary?.[side]?.collected || 0)) || search.last_success;
  const route = ended ? { view: "history" as const, searchId: search.id } : { view: "searches" as const, searchId: search.id };
  return (
    <article className="home-monitor card card-interactive" aria-labelledby={headingId}>
      <div className="trip-card-top">
        {summary.secondaryRoute ? (
          <h2 id={headingId} className="trip-card-name">
            {summary.title}
          </h2>
        ) : (
          <span className="trip-card-kind">{config.inbound ? t("Ida e volta") : t("Somente ida")}</span>
        )}
        <span className={`status-pill is-${status}`}>{statusLabel(status)}</span>
      </div>
      {summary.secondaryRoute ? (
        <RouteCodes config={config} className="trip-card-route" />
      ) : (
        <h2 id={headingId} className="trip-card-heading">
          <RouteCodes config={config} className="trip-card-route" />
        </h2>
      )}
      <RoutePlaces config={config} airports={airports} className="trip-card-places" />
      <p className="trip-card-dates">
        <CalendarDays size={16} aria-hidden="true" />
        <span>
          <strong>{t("Ida")}</strong> {legDates(config.outbound)}
        </span>
        {config.inbound && (
          <span>
            <strong>{t("Volta")}</strong> {legDates(config.inbound)}
          </span>
        )}
      </p>
      <div className="trip-card-divider" aria-hidden="true" />
      {ended ? (
        <p className="trip-card-note">{t("Monitoramento encerrado. O histórico de preços continua disponível.")}</p>
      ) : (
        <div className="trip-card-fares">
          <p className="trip-card-label">{t("Menor preço agora")}</p>
          <dl>
            {sides.map((side) => (
              <div key={side}>
                <dt>{side === "outbound" ? t("Ida") : t("Volta")}</dt>
                <dd>{search.summary?.[side] ? formatMoney(search.summary[side]!.price, config.currency) : "—"}</dd>
              </div>
            ))}
          </dl>
          <p className="trip-card-party">{t("Total para {0} · por trecho", [partyLabel(config)])}</p>
        </div>
      )}
      <div className="trip-card-footer">
        {!ended && (
          <span className="trip-card-updated">
            {updated ? t("Atualizado {0}", [formatRelative(updated, serverNow)]) : t("Aguardando a primeira coleta")}
          </span>
        )}
        <a
          className="stretched-link trip-card-action"
          href={routePath(route)}
          aria-describedby={headingId}
          onClick={(event) => plainClick(event) && onOpen(search.id, ended)}
        >
          {ended ? t("Ver histórico") : t("Ver voos")}
          <ChevronRight size={17} aria-hidden="true" />
        </a>
      </div>
    </article>
  );
}

export function Home({
  searches,
  archived = [],
  airports = [],
  serverNow = Date.now() / 1000,
  onOpen,
  onNew,
}: {
  searches: SearchRecord[];
  archived?: SearchRecord[];
  airports?: Airport[];
  serverNow?: number;
  onOpen: (id: string, history: boolean) => void;
  onNew: () => void;
}) {
  const [chosen, setChosen] = useState<Filter | null>(null);
  const groups: Record<Filter, SearchRecord[]> = {
    active: searches.filter((search) => search.active),
    paused: searches.filter((search) => !search.active),
    ended: archived,
  };
  const available = FILTERS.filter((filter) => groups[filter].length > 0);
  if (!available.length) return <Onboarding onNew={onNew} />;
  const current = chosen && available.includes(chosen) ? chosen : available[0];
  return (
    <div className="home-trips">
      {available.length > 1 && (
        <div className="segmented home-filter" role="group" aria-label={t("Filtrar viagens")}>
          {available.map((filter) => (
            <button key={filter} type="button" aria-pressed={current === filter} onClick={() => setChosen(filter)}>
              {filterLabel(filter)}
              <span className="segment-count">{groups[filter].length}</span>
            </button>
          ))}
        </div>
      )}
      <div className="home-grid">
        {groups[current].map((search) => (
          <TripCard
            key={search.id}
            search={search}
            status={current}
            airports={airports}
            serverNow={serverNow}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}
