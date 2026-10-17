import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, CheckCircle2, Download } from "lucide-react";
import { clsx } from "clsx";
import { priceAxis, visiblePricePoints } from "./priceChart";
import { t } from "./i18n";
import { formatDateTime, formatMoney } from "./format";
import { partyLabel } from "./passengers";
import type { SearchRecord, Snapshot } from "./types";

type Direction = "both" | "outbound" | "inbound";
const legName = (direction: string) => (direction === "outbound" ? t("Ida") : t("Volta"));

/** Lowest fare per window over time, with a slider to read each point. */
function Trend({
  hasReturn,
  version,
  currency,
  searchId,
}: {
  hasReturn: boolean;
  version: number;
  currency: string;
  searchId: string;
}) {
  const [chosenVersion, setChosenVersion] = useState<number | null>(null),
    [direction, setDirection] = useState<Direction>("both"),
    [selected, setSelected] = useState<Snapshot | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(640);
  const legsLabel = useId();
  useEffect(() => {
    if (!frame.current) return;
    const measure = () => setChartWidth(Math.max(260, Math.round(frame.current!.getBoundingClientRect().width)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);
  const series = useQuery<{ points: Snapshot[]; versions: number[]; bucket_seconds: number }>({
    queryKey: ["trend", searchId, chosenVersion || version],
    queryFn: async () => {
      const response = await fetch(`/api/searches/${searchId}/trend?version=${chosenVersion || version}`, { cache: "no-store" });
      if (!response.ok) throw Error(t("Não foi possível carregar o gráfico"));
      return response.json();
    },
    refetchInterval: 30000,
  });
  const canReturn = series.data?.points.length ? series.data.points.some((p) => p.direction === "inbound") : hasReturn;
  const shown: Direction = canReturn ? direction : "outbound";
  const points = (series.data?.points || []).filter((p) => shown === "both" || p.direction === shown),
    unit = points[0]?.currency || currency;
  const start = points[0]?.collected || 0,
    end = points.at(-1)?.collected || start;
  const { low, high, ticks } = priceAxis(points.map((p) => p.price!));
  const stable =
    points.length > 1 &&
    ["outbound", "inbound"].every((side) => new Set(points.filter((p) => p.direction === side).map((p) => p.price)).size <= 1);
  const left = 86,
    right = chartWidth - 16;
  const x = (v: number) => (end === start ? (left + right) / 2 : left + ((v - start) / (end - start)) * (right - left));
  const y = (v: number) => 160 - ((v - low) / Math.max(1, high - low)) * 130;
  const index = Math.max(0, points.findIndex((p) => p.id === selected?.id));
  const describe = (point: Snapshot) =>
    `${legName(point.direction)} · ${formatDateTime(point.collected)} · ${formatMoney(point.price, point.currency || unit)}`;
  return (
    <div className="trend" ref={frame}>
      {(canReturn || (series.data?.versions.length || 0) > 1) && (
        <div className="chart-controls">
          {canReturn && (
            <div className="history-direction">
              <span id={legsLabel}>{t("Trechos")}</span>
              <div className="segmented" role="group" aria-labelledby={legsLabel}>
                {(
                  [
                    ["both", t("Ida e volta")],
                    ["outbound", t("Ida")],
                    ["inbound", t("Volta")],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={shown === value}
                    onClick={() => {
                      setDirection(value);
                      setSelected(null);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {(series.data?.versions.length || 0) > 1 && (
            <label className="chart-version">
              <span>{t("Filtros usados")}</span>
              <select
                value={chosenVersion || version}
                onChange={(e) => {
                  setChosenVersion(Number(e.target.value));
                  setSelected(null);
                }}
              >
                {(series.data?.versions || [version]).map((v) => (
                  <option key={v} value={v}>
                    {v === version ? t("Filtros atuais") : t("Versão {0}", [v])}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {series.isError ? (
        <p className="banner warning" role="alert">
          {t("Não foi possível carregar o gráfico")}
        </p>
      ) : !points.length ? (
        <p className="chart-empty" role="status">
          {series.isLoading ? t("Carregando…") : t("O histórico começa com a primeira coleta completa.")}
        </p>
      ) : (
        <>
          {stable && (
            <p className="trend-stable">
              <CheckCircle2 size={16} aria-hidden="true" />
              {t("Preço estável neste período")}
            </p>
          )}
          <div className="trend-summary">
            {(["outbound", "inbound"] as const).map((side) => {
              const last = points.filter((p) => p.direction === side).at(-1);
              return last ? (
                <span key={side} className={`trend-key is-${side}`}>
                  <i aria-hidden="true" />
                  {legName(side)}
                  <strong>{formatMoney(last.price, unit)}</strong>
                </span>
              ) : null;
            })}
            <small>
              {unit} {t("· menor preço por intervalo")}
            </small>
          </div>
          <svg
            className="trend-plot"
            viewBox={`0 0 ${chartWidth} 200`}
            onPointerDown={(event) => {
              const rect = event.currentTarget.getBoundingClientRect(),
                px = ((event.clientX - rect.left) / rect.width) * chartWidth,
                py = ((event.clientY - rect.top) / rect.height) * 200;
              setSelected(
                points.reduce((a, b) =>
                  Math.hypot(x(a.collected) - px, y(a.price!) - py) < Math.hypot(x(b.collected) - px, y(b.price!) - py) ? a : b,
                ),
              );
            }}
            role="group"
            aria-label={canReturn ? t("Evolução dos preços de ida e volta") : t("Evolução do preço de ida")}
          >
            {ticks.map((value, i) => (
              <g key={i}>
                <line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="var(--separator)" />
                <text x={left - 10} y={y(value) + 4} textAnchor="end" fill="currentColor" fontSize="12">
                  {formatMoney(value, unit)}
                </text>
              </g>
            ))}
            {selected && (
              <line
                className="trend-cursor"
                x1={x(selected.collected)}
                x2={x(selected.collected)}
                y1={24}
                y2={164}
                stroke="var(--border-strong)"
                strokeDasharray="3 3"
              />
            )}
            {(["outbound", "inbound"] as const).map((leg, legIndex) => {
              const list = visiblePricePoints(points.filter((p) => p.direction === leg));
              return (
                <g key={leg} stroke={legIndex ? "var(--chart-in)" : "var(--chart-out)"} fill="none">
                  <polyline
                    points={list.map((p) => `${x(p.collected)},${y(p.price!)}`).join(" ")}
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    strokeDasharray={legIndex ? "6 4" : undefined}
                  />
                  {list.map((point) => (
                    <circle
                      key={point.id}
                      cx={x(point.collected)}
                      cy={y(point.price!)}
                      r={point.id === selected?.id ? 6 : 4}
                      strokeWidth="2"
                      fill={point.id === selected?.id ? (legIndex ? "var(--chart-in)" : "var(--chart-out)") : "var(--surface)"}
                      onClick={() => setSelected(point)}
                    >
                      <title>{describe(point)}</title>
                    </circle>
                  ))}
                </g>
              );
            })}
            <text x={left} y="190" fill="currentColor" fontSize="12">
              {formatDateTime(start, "numeric")}
            </text>
            <text x={right} y="190" textAnchor="end" fill="currentColor" fontSize="12">
              {formatDateTime(end, "numeric")}
            </text>
          </svg>
          <input
            className="chart-slider"
            type="range"
            min={0}
            max={Math.max(0, points.length - 1)}
            value={index}
            aria-label={t("Selecionar ponto do gráfico")}
            aria-valuetext={selected ? describe(selected) : t("Selecione um ponto")}
            style={{ "--progress": `${points.length > 1 ? (index / (points.length - 1)) * 100 : 0}%` } as CSSProperties}
            onChange={(e) => setSelected(points[Number(e.target.value)])}
          />
          <p className="chart-detail" aria-live="polite">
            {selected ? describe(selected) : t("Selecione um ponto do gráfico para ver o preço e o horário.")}
          </p>
          <p className="trend-note">
            {t(
              "O gráfico agrupa o menor preço por intervalo quando há muitas coletas. Os dados completos permanecem no histórico exportado.",
            )}
          </p>
        </>
      )}
    </div>
  );
}

/** Chart card of a trip: lowest fare per window, both legs, export link. */
export function PriceChartCard({ search }: { search: SearchRecord }) {
  return (
    <section className="card history-chart" aria-labelledby="history-chart-title">
      <div className="card-heading">
        <div>
          <h2 id="history-chart-title">{t("Menor preço por janela")}</h2>
          <p>
            {search.config.inbound ? t("Ida e volta separadas ·") : t("Somente ida ·")} {partyLabel(search.config)} ·{" "}
            {t("por trecho · fuso do dispositivo")}
          </p>
        </div>
        {/* CSV opens in a spreadsheet (UTF-8, ";", decimal comma); JSON keeps everything collected. */}
        <div className="history-downloads">
          <a className="button button-outline button-small" href={"/api/export/" + search.id + "?format=csv"} download>
            <Download size={15} aria-hidden="true" />
            {t("Baixar CSV")}
          </a>
          <a className="button button-ghost button-small" href={"/api/export/" + search.id} download>
            {t("JSON")}
          </a>
        </div>
      </div>
      <Trend
        key={search.id + ":" + search.version}
        hasReturn={!!search.config.inbound}
        version={search.version}
        searchId={search.id}
        currency={search.config.currency || "BRL"}
      />
    </section>
  );
}

/** First price and each change, newest first; rows become cards on phones. */
export function PriceVariations({ history }: { history: Snapshot[] }) {
  return (
    <section className="card table-card" aria-labelledby="variations-title">
      <div className="card-heading">
        <div>
          <h2 id="variations-title">{t("Variações de preço")}</h2>
          <p>{t("Todas as versões · primeiro preço e mudanças de valor")}</p>
        </div>
      </div>
      {history.length ? (
        <div className="table-scroll">
          <table role="table" className="price-variations">
            <caption className="sr-only">{t("Variações de preço: data e hora, trecho, preço anterior e preço atual")}</caption>
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader">{t("Data e hora")}</th>
                <th scope="col" role="columnheader">{t("Trecho")}</th>
                <th scope="col" role="columnheader" className="numeric">
                  {t("Preço anterior → atual")}
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {history.map((h) => {
                const currency = h.currency || "BRL",
                  trend = h.previous_price == null || h.price == null ? "" : h.price < h.previous_price ? "down" : "up";
                return (
                  <tr role="row" key={h.id}>
                    <td role="cell" className="variation-when">
                      <span>{formatDateTime(h.collected)}</span>
                      <small>{t("Filtros · versão {0}", [h.version])}</small>
                    </td>
                    <td role="cell" className="variation-leg">
                      <span className={clsx("leg-tag", `is-${h.direction}`)}>{legName(h.direction)}</span>
                    </td>
                    <td role="cell" className="numeric variation-price">
                      {h.previous_price == null ? (
                        <span className="variation-first">{t("Primeiro preço nestes filtros")}</span>
                      ) : (
                        <span className="variation-previous">{formatMoney(h.previous_price, currency)}</span>
                      )}
                      <span aria-hidden="true"> → </span>
                      <span className="sr-only"> {t("para")} </span>
                      <strong>{formatMoney(h.price, currency)}</strong>
                      {trend && (
                        <span className={`variation-trend is-${trend}`}>
                          {trend === "down" ? <ArrowDownRight size={15} aria-hidden="true" /> : <ArrowUpRight size={15} aria-hidden="true" />}
                          <span className="sr-only">{trend === "down" ? t("Preço caiu") : t("Preço subiu")}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="card-empty">{t("O histórico começa com a primeira coleta completa.")}</p>
      )}
    </section>
  );
}
