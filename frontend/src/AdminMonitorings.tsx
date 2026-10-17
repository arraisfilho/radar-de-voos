import { TaskPage } from "./TaskPage";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { Button, Modal } from "./ui";
import { t, getLocale } from "./i18n";
import type { User, SearchRecord, Flight, Leg } from "./types";

type Monitor = SearchRecord & { monitoring_number: number; archived: number };
type Listing = { items: Monitor[]; total: number; page_size: number };
type Detail = {
  search: Monitor;
  flights: Flight[];
  total: number;
  page_size: number;
  readonly: boolean;
};
async function read<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch("/api" + path, { signal, cache: "no-store" });
  if (!response.ok) {
    const data = await response.json();
    throw Error(
      typeof data.detail === "string"
        ? t(data.detail)
        : t("Não foi possível carregar os monitoramentos."),
    );
  }
  return response.json();
}
const localDate = (value: string) =>
  new Date(value).toLocaleString(getLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const duration = (value: number) =>
  `${Math.floor(value / 60)}h${value % 60 ? String(value % 60).padStart(2, "0") : ""}`;
const state = (item: Monitor) =>
  item.archived ? t("Encerrado") : item.active ? t("Ativo") : t("Pausado");
function LegPreferences({ leg, title }: { leg: Leg; title: string }) {
  const stops = leg.stops
    .map((n) =>
      n === 0 ? t("Direto") : n === 1 ? t("1 escala") : t("2 ou mais"),
    )
    .join(" · ");
  return (
    <section className="admin-monitor-leg">
      <h3>{title}</h3>
      <dl>
        <div>
          <dt>{t("Janela de saída")}</dt>
          <dd>
            {localDate(leg.start)} → {localDate(leg.end)}
          </dd>
        </div>
        <div>
          <dt>{t("Escalas permitidas")}</dt>
          <dd>{stops}</dd>
        </div>
        <div>
          <dt>{t("Duração máxima da viagem")}</dt>
          <dd>
            {leg.max_duration == null
              ? t("Sem limite")
              : duration(leg.max_duration)}
          </dd>
        </div>
        <div>
          <dt>{t("Companhia aérea")}</dt>
          <dd>
            {leg.airlines.length
              ? leg.airlines.join(" · ")
              : t("Todas as companhias")}
          </dd>
        </div>
        {leg.arrival_before && (
          <div>
            <dt>{t("Chegar até")}</dt>
            <dd>{localDate(leg.arrival_before)}</dd>
          </div>
        )}
        {leg.max_layover != null && (
          <div>
            <dt>{t("Espera máxima por conexão")}</dt>
            <dd>{duration(leg.max_layover)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
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
      title={t("Monitoramentos de {0}", [user.name])}
      description={t("Cliente #{0} · somente leitura", [
        user.client_number || "—",
      ])}
      className="admin-monitor-dialog"
    >
      <p className="admin-readonly">
        <Eye size={16} aria-hidden="true" />
        {t("Somente leitura. Sua sessão de administrador será mantida.")}
      </p>
      {selected ? (
        <>
          <Button variant="ghost" onClick={back}>
            <ArrowLeft size={16} />
            {t("Voltar aos monitoramentos")}
          </Button>
          {detail.isError ? (
            <p role="alert" className="form-error">
              {detail.error.message}
            </p>
          ) : !search || !config ? (
            <p role="status">{t("Carregando…")}</p>
          ) : (
            <>
              <header className="admin-monitor-heading">
                <div>
                  <span className="subtle-tag">
                    {t("Monitoramento #{0}", [search.monitoring_number])}
                  </span>
                  <h2>{config.name}</h2>
                  <p>
                    {config.origins.join(" + ")} {config.inbound ? "↔" : "→"}{" "}
                    {config.destinations.join(" + ")}
                  </p>
                </div>
                <span className="delivery-badge">{state(search)}</span>
              </header>
              <dl className="admin-monitor-general">
                <div>
                  <dt>{t("Passageiros")}</dt>
                  <dd>
                    {t("Adultos")}: {config.adults} · {t("Crianças")}:{" "}
                    {config.children || 0} · {t("Bebês com assento")}:{" "}
                    {config.infants_in_seat || 0} · {t("Bebês no colo")}:{" "}
                    {config.infants_on_lap || 0}
                  </dd>
                </div>
                <div>
                  <dt>{t("Cabine")}</dt>
                  <dd>
                    {
                      {
                        economy: t("Econômica"),
                        "premium-economy": t("Econômica premium"),
                        business: t("Executiva"),
                        first: t("Primeira classe"),
                      }[config.cabin]
                    }
                  </dd>
                </div>
                <div>
                  <dt>{t("Moeda")}</dt>
                  <dd>{config.currency}</dd>
                </div>
                <div>
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
                <div>
                  <dt>{t("Alertas")}</dt>
                  <dd>
                    {[
                      config.notify_email ? t("E-mail") : "",
                      config.notify_whatsapp ? "WhatsApp" : "",
                    ]
                      .filter(Boolean)
                      .join(" · ") || t("Somente no painel")}
                  </dd>
                </div>
                <div>
                  <dt>{t("Meta por trecho")}</dt>
                  <dd>
                    {config.target_cents == null
                      ? t("Sem meta")
                      : new Intl.NumberFormat(getLocale(), {
                          style: "currency",
                          currency: config.currency,
                        }).format(config.target_cents / 100)}
                  </dd>
                </div>
                <div>
                  <dt>{t("Queda mínima")}</dt>
                  <dd>
                    {new Intl.NumberFormat(getLocale(), {
                      style: "currency",
                      currency: config.currency,
                    }).format(config.min_drop_cents / 100)}
                  </dd>
                </div>
              </dl>
              <div className="admin-monitor-legs">
                <LegPreferences leg={config.outbound} title={t("Ida")} />
                {config.inbound && (
                  <LegPreferences leg={config.inbound} title={t("Volta")} />
                )}
              </div>
              <p className="help">
                {t(
                  "Horários locais dos aeroportos. Valores referentes ao grupo por trecho.",
                )}
              </p>
              <h3>{t("Resultados já coletados")}</h3>
              {!detail.data?.flights.length ? (
                <p className="small-empty">
                  {t("Nenhuma opção disponível nos dados atuais.")}
                </p>
              ) : (
                <div className="table-scroll">
                  <table className="admin-monitor-flights">
                    <thead>
                      <tr>
                        <th>{t("Voo")}</th>
                        <th>{t("Partida e chegada")}</th>
                        <th>{t("Duração")}</th>
                        <th>{t("Preço")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data.flights.map((flight, index) => (
                        <tr key={index}>
                          <td>
                            {flight.origin} → {flight.destination}
                            <small>{flight.airlines.join(" / ")}</small>
                          </td>
                          <td>
                            {localDate(flight.departure)}
                            <small>→ {localDate(flight.arrival)}</small>
                          </td>
                          <td>
                            {duration(flight.duration_minutes)}
                            <small>
                              {flight.stops === 0
                                ? t("Direto")
                                : flight.stops === 1
                                  ? t("1 escala")
                                  : t("{0} escalas", [flight.stops])}
                            </small>
                          </td>
                          <td>
                            {new Intl.NumberFormat(getLocale(), {
                              style: "currency",
                              currency: flight.currency || config.currency,
                            }).format(flight.price_cents / 100)}
                            <small>
                              {new Date(
                                flight.collected_at * 1000,
                              ).toLocaleString(getLocale())}
                            </small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="admin-pagination">
                <small>
                  {t("Opções: {0} · Página {1}", [
                    detail.data?.total || 0,
                    flightPage + 1,
                  ])}
                </small>
                <div>
                  <Button
                    variant="outline"
                    disabled={!flightPage || detail.isFetching}
                    onClick={() => setFlightPage((p) => p - 1)}
                    aria-label={t("Página anterior")}
                  >
                    <ChevronLeft size={16} />
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      detail.isFetching ||
                      (flightPage + 1) * 40 >= (detail.data?.total || 0)
                    }
                    onClick={() => setFlightPage((p) => p + 1)}
                    aria-label={t("Próxima página")}
                  >
                    <ChevronRight size={16} />
                  </Button>
                </div>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <label className="admin-monitor-filter">
            {t("Situação")}
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              {[
                ["all", t("Todos")],
                ["active", t("Ativos")],
                ["paused", t("Pausados")],
                ["ended", t("Encerrados")],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {list.isError ? (
            <p className="form-error" role="alert">
              {list.error.message}
            </p>
          ) : !list.data ? (
            <p role="status">{t("Carregando…")}</p>
          ) : (
            <>
              <div className="admin-monitor-list">
                {list.data.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSelected(item.id);
                      setFlightPage(0);
                    }}
                  >
                    <div>
                      <strong>
                        {t("Monitoramento #{0}", [item.monitoring_number])} ·{" "}
                        {item.config.name}
                      </strong>
                      <span>
                        {item.config.origins.join(" + ")}{" "}
                        {item.config.inbound ? "↔" : "→"}{" "}
                        {item.config.destinations.join(" + ")}
                      </span>
                      <small>
                        {t("Ida")}: {localDate(item.config.outbound.start)}
                        {item.config.inbound
                          ? " · " +
                            t("Volta") +
                            ": " +
                            localDate(item.config.inbound.start)
                          : ""}
                      </small>
                    </div>
                    <span className="delivery-badge">{state(item)}</span>
                    <Eye size={17} aria-hidden="true" />
                  </button>
                ))}
              </div>
              {!list.data.items.length && (
                <p className="small-empty">
                  {t("Nenhum monitoramento encontrado.")}
                </p>
              )}
              <div className="admin-pagination">
                <small>
                  {t("Monitoramentos: {0} · Página {1}", [
                    list.data.total,
                    page + 1,
                  ])}
                </small>
                <div>
                  <Button
                    variant="outline"
                    disabled={!page || list.isFetching}
                    onClick={() => setPage((p) => p - 1)}
                    aria-label={t("Página anterior")}
                  >
                    <ChevronLeft size={16} />
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      list.isFetching || (page + 1) * 15 >= list.data.total
                    }
                    onClick={() => setPage((p) => p + 1)}
                    aria-label={t("Próxima página")}
                  >
                    <ChevronRight size={16} />
                  </Button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </TaskPage>
  );
}
