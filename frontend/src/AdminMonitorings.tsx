import { TaskPage } from "./TaskPage";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ChevronRight, Eye, PlaneTakeoff } from "lucide-react";
import { Button } from "./ui";
import { t } from "./i18n";
import { EmptyRows, LoadError, Pager, TableSkeleton, selectingText } from "./DataView";
import { formatDateTime, formatDateTimeCompact, formatDuration, formatMoney, formatNumber } from "./format";
import { legDates, tripRoute } from "./tripSummary";
import { plural } from "./plural";
import type { User, SearchRecord, Flight, Leg } from "./types";

type Monitor = SearchRecord & { monitoring_number: number; archived: number };
type Listing = { items: Monitor[]; total: number; page_size?: number };
type Detail = {
  search: Monitor;
  flights: Flight[];
  total: number;
  page_size?: number;
  readonly: boolean;
};
async function read<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch("/api" + path, { signal, cache: "no-store" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw Error(
      typeof data.detail === "string"
        ? t(data.detail)
        : t("Não foi possível carregar os monitoramentos."),
    );
  }
  return response.json();
}
const state = (item: Monitor) =>
  item.archived ? t("Encerrado") : item.active ? t("Ativo") : t("Pausado");
const tone = (item: Monitor) =>
  item.archived ? "is-ended" : item.active ? "is-active" : "is-paused";
const cabins = (): Record<string, string> => ({
  economy: t("Econômica"),
  "premium-economy": t("Econômica premium"),
  business: t("Executiva"),
  first: t("Primeira classe"),
});

function LegPreferences({ leg, title }: { leg: Leg; title: string }) {
  const stops = leg.stops
    .map((n) =>
      n === 0 ? t("Direto") : n === 1 ? t("1 escala") : t("2 ou mais"),
    )
    .join(" · ");
  return (
    <section className="list-section admin-monitor-leg" aria-label={title}>
      <h3 className="list-section-title">{title}</h3>
      <dl className="list-group detail-list">
        <div className="list-row">
          <dt>{t("Janela de saída")}</dt>
          <dd>
            {formatDateTimeCompact(leg.start)} – {formatDateTimeCompact(leg.end)}
          </dd>
        </div>
        <div className="list-row">
          <dt>{t("Escalas permitidas")}</dt>
          <dd>{stops}</dd>
        </div>
        <div className="list-row">
          <dt>{t("Duração máxima da viagem")}</dt>
          <dd>
            {leg.max_duration == null
              ? t("Sem limite")
              : formatDuration(leg.max_duration)}
          </dd>
        </div>
        <div className="list-row">
          <dt>{t("Companhia aérea")}</dt>
          <dd>
            {leg.airlines.length
              ? leg.airlines.join(" · ")
              : t("Todas as companhias")}
          </dd>
        </div>
        {leg.arrival_before && (
          <div className="list-row">
            <dt>{t("Chegar até")}</dt>
            <dd>{formatDateTimeCompact(leg.arrival_before)}</dd>
          </div>
        )}
        {leg.max_layover != null && (
          <div className="list-row">
            <dt>{t("Espera máxima por conexão")}</dt>
            <dd>{formatDuration(leg.max_layover)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
/** One customer's monitorings, read only: list, then configuration and collected results. */
export function AdminMonitorings({
  user,
  onClose,
  monitoringId,
  onSelect,
}: {
  user: User;
  onClose: () => void;
  monitoringId?: string;
  onSelect?: (id?: string) => void;
}) {
  // Hook order matters to the tests: status, page, selection, flight page.
  const [status, setStatus] = useState("all"),
    [page, setPage] = useState(0),
    [localSelected, setLocalSelected] = useState<string | null>(null),
    [flightPage, setFlightPage] = useState(0);
  const selected = monitoringId || localSelected;
  const setSelected = (id: string | null) =>
    onSelect ? onSelect(id || undefined) : setLocalSelected(id);
  const base = "/admin/users/" + encodeURIComponent(user.id) + "/monitorings";
  const list = useQuery<Listing>({
    queryKey: ["admin-monitorings", user.id, status, page],
    queryFn: ({ signal }) =>
      read(
        base + "?" + new URLSearchParams({ status, page: String(page) }),
        signal,
      ),
    enabled: !selected,
    refetchOnMount: "always",
    // Another page of the same customer keeps the last rows while it loads: the pager keeps the focus.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === user.id ? previous : undefined),
  });
  const detail = useQuery<Detail>({
    queryKey: ["admin-monitoring", user.id, selected, flightPage],
    queryFn: ({ signal }) =>
      read(
        base + "/" + encodeURIComponent(selected!) + "?page=" + flightPage,
        signal,
      ),
    enabled: !!selected,
    refetchOnMount: "always",
    // Another page of results of the same monitoring keeps the last rows while it loads.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === user.id && previousQuery?.queryKey[2] === selected ? previous : undefined,
  });
  const search = detail.data?.search,
    config = search?.config;
  function back() {
    setSelected(null);
    setFlightPage(0);
  }
  return (
    <TaskPage
      onBack={selected ? back : onClose}
      backLabel={selected ? t("Voltar aos monitoramentos") : t("Voltar aos usuários")}
      title={t("Monitoramentos de {0}", [user.name])}
      description={t("Cliente #{0} · somente leitura", [
        user.client_number || "—",
      ])}
      className="admin-monitor-page"
    >
      <p className="admin-readonly">
        <Eye size={16} aria-hidden="true" />
        {t("Somente leitura. Sua sessão de administrador será mantida.")}
      </p>
      {selected ? (
        detail.isError ? (
          <LoadError level={2} message={detail.error.message} onRetry={() => void detail.refetch()} />
        ) : !search || !config ? (
          <TableSkeleton rows={4} />
        ) : (
          <>
            <section className="card admin-monitor-summary" aria-labelledby="monitor-title">
              <div className="admin-monitor-head">
                <div>
                  <span className="cell-secondary">
                    {t("Monitoramento #{0}", [search.monitoring_number])}
                  </span>
                  <h2 id="monitor-title">{config.name}</h2>
                  <p className="admin-monitor-route">{tripRoute(config)}</p>
                </div>
                <span className={clsx("status-pill", tone(search))}>{state(search)}</span>
              </div>
              <dl className="list-group detail-list">
                <div className="list-row">
                  <dt>{t("Passageiros")}</dt>
                  <dd>
                    {t("Adultos")}: {config.adults} · {t("Crianças")}:{" "}
                    {config.children || 0} · {t("Bebês com assento")}:{" "}
                    {config.infants_in_seat || 0} · {t("Bebês no colo")}:{" "}
                    {config.infants_on_lap || 0}
                  </dd>
                </div>
                <div className="list-row">
                  <dt>{t("Cabine")}</dt>
                  <dd>{cabins()[config.cabin] || config.cabin}</dd>
                </div>
                <div className="list-row">
                  <dt>{t("Moeda")}</dt>
                  <dd>{config.currency}</dd>
                </div>
                <div className="list-row">
                  <dt>{t("Bagagem despachada")}</dt>
                  <dd>
                    {config.checked_bags === 0
                      ? t("Sem taxas de bagagem na pesquisa")
                      : config.checked_bags === 1
                        ? t("Taxas estimadas para 1 mala")
                        : t("Taxas estimadas para {0} malas", [
                            config.checked_bags,
                          ])}
                  </dd>
                </div>
                <div className="list-row">
                  <dt>{t("Alertas")}</dt>
                  <dd>
                    {[
                      config.notify_whatsapp ? "WhatsApp" : "",
                      config.notify_email ? t("E-mail") : "",
                    ]
                      .filter(Boolean)
                      .join(" · ") || t("Somente no painel")}
                  </dd>
                </div>
                <div className="list-row">
                  <dt>{t("Meta por trecho")}</dt>
                  <dd>
                    {config.target_cents == null
                      ? t("Sem meta")
                      : formatMoney(config.target_cents, config.currency)}
                  </dd>
                </div>
                <div className="list-row">
                  <dt>{t("Queda mínima")}</dt>
                  <dd>{formatMoney(config.min_drop_cents, config.currency)}</dd>
                </div>
              </dl>
            </section>
            <div className="admin-monitor-legs">
              <LegPreferences leg={config.outbound} title={t("Ida")} />
              {config.inbound && (
                <LegPreferences leg={config.inbound} title={t("Volta")} />
              )}
            </div>
            <p className="admin-footnote">
              {t(
                "Horários locais dos aeroportos. Valores referentes ao grupo por trecho.",
              )}
            </p>
            <section className="card admin-card" aria-labelledby="monitor-results-title">
              <header className="admin-card-heading">
                <div>
                  <h2 id="monitor-results-title">{t("Resultados já coletados")}</h2>
                </div>
              </header>
              {!detail.data?.flights.length ? (
                <EmptyRows icon={PlaneTakeoff} title={t("Nenhuma opção disponível nos dados atuais.")} />
              ) : (
                <div className="table-frame">
                  <table
                    role="table"
                    className={clsx("data-table admin-monitor-flights", detail.isPlaceholderData && "is-stale")}
                    aria-busy={detail.isFetching || undefined}
                  >
                    <caption className="sr-only">
                      {t("Resultados coletados: voo, partida e chegada, duração e preço")}
                    </caption>
                    <thead role="rowgroup">
                      <tr role="row">
                        <th scope="col" role="columnheader" className="col-flight">{t("Voo")}</th>
                        <th scope="col" role="columnheader" className="col-times">{t("Partida e chegada")}</th>
                        <th scope="col" role="columnheader" className="col-duration">{t("Duração")}</th>
                        <th scope="col" role="columnheader" className="col-price numeric">{t("Preço")}</th>
                      </tr>
                    </thead>
                    <tbody role="rowgroup">
                      {detail.data.flights.map((flight, index) => (
                        <tr role="row" key={index}>
                          <td role="cell" className="cell-flight">
                            <span className="cell-title">
                              {flight.origin} → {flight.destination}
                            </span>
                            <span className="cell-secondary">{flight.airlines.join(" / ")}</span>
                          </td>
                          <td role="cell" className="cell-times">
                            {formatDateTimeCompact(flight.departure)}
                            <span className="cell-secondary">→ {formatDateTimeCompact(flight.arrival)}</span>
                          </td>
                          <td role="cell" className="cell-duration">
                            {formatDuration(flight.duration_minutes)}
                            <span className="cell-secondary">
                              {flight.stops === 0
                                ? t("Direto")
                                : flight.stops === 1
                                  ? t("1 escala")
                                  : t("{0} escalas", [flight.stops])}
                            </span>
                          </td>
                          <td role="cell" className="cell-price numeric">
                            <span className="cell-title">
                              {formatMoney(flight.price_cents, flight.currency || config.currency)}
                            </span>
                            <span className="cell-secondary">{formatDateTime(flight.collected_at)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Pager
                page={flightPage}
                pageSize={detail.data?.page_size || 40}
                total={detail.data?.total || 0}
                onPage={setFlightPage}
                label={t("Páginas de resultados")}
                summary={plural(detail.data?.total || 0, "{0} opção coletada", "{0} opções coletadas", formatNumber(detail.data?.total || 0))}
              />
            </section>
          </>
        )
      ) : (
        <section className="card admin-card" aria-label={t("Monitoramentos")}>
          <div className="segmented admin-monitor-filter" role="group" aria-label={t("Situação")}>
            {[
              ["all", t("Todos")],
              ["active", t("Ativos")],
              ["paused", t("Pausados")],
              ["ended", t("Encerrados")],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={status === value}
                onClick={() => {
                  setStatus(value);
                  setPage(0);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {list.isError ? (
            <LoadError level={2} message={list.error.message} onRetry={() => void list.refetch()} />
          ) : !list.data ? (
            <TableSkeleton rows={4} />
          ) : !list.data.items.length ? (
            <EmptyRows level={2} icon={PlaneTakeoff} title={t("Nenhum monitoramento encontrado.")} />
          ) : (
            <div className="table-frame">
              <table
                role="table"
                className={clsx("data-table admin-monitor-table", list.isPlaceholderData && "is-stale")}
                aria-busy={list.isFetching || undefined}
              >
                <caption className="sr-only">
                  {t("Monitoramentos: viagem, rota, datas e situação")}
                </caption>
                <thead role="rowgroup">
                  <tr role="row">
                    <th scope="col" role="columnheader" className="col-trip">{t("Viagem")}</th>
                    <th scope="col" role="columnheader" className="col-route">{t("Rota")}</th>
                    <th scope="col" role="columnheader" className="col-dates">{t("Datas")}</th>
                    <th scope="col" role="columnheader" className="col-status">{t("Situação")}</th>
                    <th scope="col" role="columnheader" className="col-action">
                      <span className="sr-only">{t("Detalhes")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {list.data.items.map((item) => (
                    <tr
                      role="row"
                      key={item.id}
                      className="is-clickable"
                      onClick={() => {
                        if (selectingText()) return;
                        setSelected(item.id);
                        setFlightPage(0);
                      }}
                    >
                      <td role="cell" className="cell-trip">
                        <span className="cell-title cell-truncate cell-clamp">{item.config.name}</span>
                        <span className="cell-secondary">
                          {t("Monitoramento #{0}", [item.monitoring_number])}
                        </span>
                      </td>
                      <td role="cell" className="cell-route">{tripRoute(item.config)}</td>
                      <td role="cell" className="cell-dates">
                        <span>
                          {t("Ida")}: {legDates(item.config.outbound)}
                        </span>
                        {item.config.inbound && (
                          <span className="cell-secondary">
                            {t("Volta")}: {legDates(item.config.inbound)}
                          </span>
                        )}
                      </td>
                      <td role="cell" className="cell-status">
                        <span className={clsx("status-pill", tone(item))}>{state(item)}</span>
                      </td>
                      <td role="cell" className="cell-action">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="row-action"
                          aria-label={t("Ver monitoramento #{0}", [item.monitoring_number])}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelected(item.id);
                            setFlightPage(0);
                          }}
                        >
                          <ChevronRight size={18} aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {list.data && (
            <Pager
              page={page}
              pageSize={list.data.page_size || 15}
              total={list.data.total}
              onPage={setPage}
              label={t("Páginas de monitoramentos")}
              summary={plural(list.data.total, "{0} monitoramento", "{0} monitoramentos", formatNumber(list.data.total))}
            />
          )}
        </section>
      )}
    </TaskPage>
  );
}
