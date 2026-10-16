import { DeliveryChannels } from "./DeliveryChannels";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { Card, Button } from "./ui";
import { t, getLocale } from "./i18n";
import type { Alert, SearchRecord, Flight } from "./types";
type Item = Alert & {
  search_id: string;
  search_name: string;
  archived: number;
  currency?: string;
  flight?: Flight;
};
type Feed = {
  items: Item[];
  has_more: boolean;
  page: number;
  totals: Record<string, number>;
};
const money = (value: number, currency: string) =>
  new Intl.NumberFormat(getLocale(), { style: "currency", currency }).format(
    value / 100,
  );

export function Activity({
  searches,
  onOpen,
}: {
  searches: SearchRecord[];
  onOpen: (id: string) => void;
}) {
  const [mode, setMode] = useState("notifications"),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [page, setPage] = useState(0);
  const query = useQuery<Feed>({
    queryKey: ["activity", mode, search, status, page],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ mode, status, page: String(page) });
      if (search) params.set("search_id", search);
      const response = await fetch("/api/activity?" + params, {
        signal,
        cache: "no-store",
      });
      if (!response.ok) throw Error(t("Não foi possível carregar os alertas"));
      return response.json();
    },
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });
  const totals = query.data?.totals || {};
  const sent = totals.sent || 0,
    pending = totals.queued || 0,
    failed =
      (totals.failed || 0) +
      (totals.partial || 0) +
      (totals.uncertain || 0) +
      (totals.waiting_smtp || 0) +
      (totals.waiting_contact || 0);
  return (
    <>
      <div className="activity-summary">
        <span>
          <strong>{sent}</strong>
          {t("Envios completos")}
        </span>
        <span>
          <strong>{pending}</strong>
          {t("Pendentes")}
        </span>
        <span>
          <strong>{failed}</strong>
          {t("Exigem atenção")}
        </span>
      </div>
      <Card className="activity-toolbar">
        <div className="segmented" aria-label={t("Tipo de histórico")}>
          {[
            ["notifications", t("Avisos")],
            ["changes", t("Variações de preço")],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={mode === value}
              onClick={() => {
                setMode(value);
                setPage(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="activity-filters">
          <label>
            {t("Viagem")}
            <select
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            >
              <option value="">{t("Todas as viagens")}</option>
              {searches.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.config.name}
                  {s.active
                    ? ""
                    : ` · ${t(s.state === "paused" ? "Pausado" : "Encerrado")}`}
                </option>
              ))}
            </select>
          </label>
          {mode === "notifications" && (
            <label>
              {t("Situação")}
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(0);
                }}
              >
                {[
                  ["all", t("Todos os avisos")],
                  ["sent", t("Enviados")],
                  ["pending", t("Pendentes")],
                  ["failed", t("Com problema")],
                ].map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </Card>
      <p className="activity-help">
        {mode === "notifications"
          ? t(
              "Os avisos permanecem no histórico. Consulte os ícones para ver a situação de cada canal. Aceito não confirma entrega ou leitura.",
            )
          : t(
              "Altas e quedas do menor preço elegível. O voo pode mudar. Somente oportunidades elegíveis geram avisos.",
            )}
      </p>
      {query.isError ? (
        <p className="form-error" role="alert">
          {t("Não foi possível carregar os alertas")}
        </p>
      ) : query.isLoading ? (
        <p role="status">{t("Carregando…")}</p>
      ) : !query.data?.items.length ? (
        <Card className="activity-empty">
          <Bell size={26} />
          <h2>
            {mode === "notifications"
              ? t("Nenhum aviso registrado ainda")
              : t("Nenhuma variação registrada ainda")}
          </h2>
          <p>
            {t(
              "Os registros aparecem após as coletas. Uma alta de preço não é um e-mail enviado.",
            )}
          </p>
        </Card>
      ) : (
        <div className="activity-list">
          {query.data.items.map((item) => {
            const observed = mode === "changes",
              up =
                observed &&
                item.previous !== null &&
                item.price > item.previous;
            const flight = observed ? item.flight : item.payload?.flight;
            const currency = observed
              ? item.currency || "BRL"
              : flight?.currency || "BRL";
            return (
              <Card className="activity-item" key={item.id}>
                <div className="activity-item-head">
                  <strong>{item.search_name}</strong>
                  <time dateTime={new Date(item.created * 1000).toISOString()}>
                    {new Date(item.created * 1000).toLocaleString(getLocale(), {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
                <div className="activity-item-body">
                  <span className={up ? "price-rise" : "price-drop"}>
                    {observed ? (
                      up ? (
                        <ArrowUp size={16} />
                      ) : (
                        <ArrowDown size={16} />
                      )
                    ) : (
                      <Bell size={16} />
                    )}{" "}
                    {observed
                      ? up
                        ? t("Preço subiu")
                        : t("Preço caiu")
                      : t(
                          item.payload.kind === "target"
                            ? "Meta atingida"
                            : "Nova menor tarifa",
                        )}
                  </span>
                  <span>
                    {item.direction === "outbound" ? t("Ida") : t("Volta")}
                    {flight
                      ? ` · ${new Date(flight.departure.slice(0, 10) + "T12:00").toLocaleDateString(getLocale(), { day: "2-digit", month: "2-digit" })} ${flight.departure.slice(11, 16)} · ${flight.origin} → ${flight.destination} · ${flight.airlines.join(" / ")}`
                      : ""}
                  </span>
                  <span className="activity-price">
                    {item.previous !== null && (
                      <del>{money(item.previous, currency)}</del>
                    )}{" "}
                    <strong>{money(item.price, currency)}</strong>
                  </span>
                </div>
                <div className="activity-item-footer">
                  {observed ? (
                    <span className="delivery-badge">
                      {t("Variação observada · no painel")}
                    </span>
                  ) : (
                    <DeliveryChannels event={item} />
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => onOpen(item.search_id)}
                  >
                    {item.archived ? t("Ver histórico") : t("Abrir busca")}
                    <ChevronRight size={14} />
                  </Button>
                  {!observed && flight?.search_url && (
                    <a
                      href={flight.search_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("Ver passagem")}
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {(page > 0 || query.data?.has_more) && (
        <div className="activity-pagination">
          <Button
            variant="outline"
            disabled={page === 0 || query.isFetching}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft size={16} />
            {t("Mais recentes")}
          </Button>
          <span>{t("Página {0}", [page + 1])}</span>
          <Button
            variant="outline"
            disabled={!query.data?.has_more || query.isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("Mais antigos")}
            <ChevronRight size={16} />
          </Button>
        </div>
      )}
    </>
  );
}
