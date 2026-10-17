import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Bell, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Clock, RotateCw } from "lucide-react";
import { Button } from "./ui";
import { AlertDays, AlertRow, type AlertItem } from "./AlertRow";
import { t } from "./i18n";
import { tripTitle } from "./tripSummary";
import type { SearchRecord } from "./types";

type Mode = "notifications" | "changes";
type Status = "all" | "sent" | "pending" | "failed";
type Feed = {
  items: AlertItem[];
  has_more: boolean;
  page: number;
  totals: Record<string, number>;
};

/** Alert center: delivery summary, notifications or price changes, grouped by day. */
export function Activity({
  searches,
  serverNow,
  onOpen,
  onManageContacts,
}: {
  searches: SearchRecord[];
  serverNow: number;
  onOpen: (id: string, history: boolean) => void;
  onManageContacts: () => void;
}) {
  const [mode, setMode] = useState<Mode>("notifications"),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState<Status>("all"),
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
  const tiles = [
    { status: "sent" as const, label: t("Aceitos"), value: totals.sent || 0, icon: CheckCircle2 },
    { status: "pending" as const, label: t("Pendentes"), value: totals.queued || 0, icon: Clock },
    {
      status: "failed" as const,
      label: t("Exigem atenção"),
      value: ["failed", "partial", "uncertain", "waiting_smtp", "waiting_service", "waiting_contact"].reduce(
        (sum, key) => sum + (totals[key] || 0),
        0,
      ),
      icon: CircleAlert,
    },
  ];
  const trips = new Map(searches.map((item) => [item.id, tripTitle(item.config).title]));
  const observed = mode === "changes";
  const filter = (next: Partial<{ mode: Mode; search: string; status: Status }>) => {
    if (next.mode) setMode(next.mode);
    if (next.search !== undefined) setSearch(next.search);
    if (next.status) setStatus(next.status);
    setPage(0);
  };
  return (
    <div className="activity-page">
      <div className="activity-summary" role="group" aria-label={t("Situação dos avisos")}>
        {tiles.map((tile) => {
          const selected = !observed && status === tile.status;
          return (
            <button
              key={tile.status}
              type="button"
              className={clsx("summary-tile", `is-${tile.status}`, tile.value > 0 && "has-items")}
              aria-pressed={selected}
              onClick={() => filter({ mode: "notifications", status: selected ? "all" : tile.status })}
            >
              <span className="summary-tile-icon" aria-hidden="true">
                <tile.icon size={18} />
              </span>
              <strong>{tile.value}</strong>
              <span>{tile.label}</span>
            </button>
          );
        })}
      </div>
      <div className="activity-toolbar">
        <div className="segmented activity-mode" role="group" aria-label={t("Tipo de histórico")}>
          {(
            [
              ["notifications", t("Avisos")],
              ["changes", t("Variações de preço")],
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={mode === value} onClick={() => filter({ mode: value })}>
              {label}
            </button>
          ))}
        </div>
        <div className="activity-filters">
          <label>
            <span>{t("Viagem")}</span>
            <select value={search} onChange={(e) => filter({ search: e.target.value })}>
              <option value="">{t("Todas as viagens")}</option>
              {searches.map((item) => (
                <option key={item.id} value={item.id}>
                  {trips.get(item.id)}
                  {item.active ? "" : ` · ${t(item.state === "paused" ? "Pausado" : "Encerrado")}`}
                </option>
              ))}
            </select>
          </label>
          {!observed && (
            <label>
              <span>{t("Situação")}</span>
              <select value={status} onChange={(e) => filter({ status: e.target.value as Status })}>
                {(
                  [
                    ["all", t("Todos os avisos")],
                    ["sent", t("Enviados")],
                    ["pending", t("Pendentes")],
                    ["failed", t("Com problema")],
                  ] as const
                ).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
      <p className="activity-help">
        {observed
          ? t("Altas e quedas do menor preço elegível. O voo pode mudar. Somente oportunidades elegíveis geram avisos.")
          : t(
              "Os avisos permanecem no histórico. Consulte os ícones para ver a situação de cada canal. Aceito não confirma entrega ou leitura.",
            )}
      </p>
      {query.isError ? (
        <div className="banner warning activity-error" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <p>{t("Não foi possível carregar os alertas")}</p>
          <Button variant="outline" size="small" onClick={() => void query.refetch()}>
            <RotateCw size={14} aria-hidden="true" />
            {t("Tentar novamente")}
          </Button>
        </div>
      ) : query.isLoading ? (
        <div className="activity-loading" role="status">
          <span className="sr-only">{t("Carregando…")}</span>
          <span className="skeleton skeleton-line" aria-hidden="true" />
          <span className="skeleton skeleton-row" aria-hidden="true" />
          <span className="skeleton skeleton-row" aria-hidden="true" />
        </div>
      ) : !query.data?.items.length ? (
        <section className="card activity-empty-card">
          <div className="empty-state">
            <Bell aria-hidden="true" />
            <h2>{observed ? t("Nenhuma variação registrada ainda") : t("Nenhum aviso registrado ainda")}</h2>
            <p>{t("Os registros aparecem após as coletas. Uma alta de preço não é um e-mail enviado.")}</p>
          </div>
        </section>
      ) : (
        <AlertDays
          items={query.data.items}
          now={serverNow}
          render={(item) => (
            <AlertRow
              item={item}
              observed={observed}
              tripName={(item.search_id && trips.get(item.search_id)) || item.search_name}
              onOpenTrip={item.search_id ? () => onOpen(item.search_id!, !!item.archived) : undefined}
              onManageContacts={onManageContacts}
            />
          )}
        />
      )}
      {(page > 0 || query.data?.has_more) && (
        <nav className="activity-pagination" aria-label={t("Páginas de alertas")}>
          <Button variant="outline" disabled={page === 0 || query.isFetching} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft size={16} aria-hidden="true" />
            {t("Mais recentes")}
          </Button>
          <span>{t("Página {0}", [page + 1])}</span>
          <Button variant="outline" disabled={!query.data?.has_more || query.isFetching} onClick={() => setPage((p) => p + 1)}>
            {t("Mais antigos")}
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
        </nav>
      )}
    </div>
  );
}
