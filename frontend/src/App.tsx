import { DeliveryChannels } from "./DeliveryChannels";
import { SystemVersion } from "./SystemVersion";
import {SidebarSearches} from "./SidebarSearches";
import {partyLabel} from "./passengers";
import { t, getLocale, getLanguage, useLanguage } from "./i18n";
import { canPreview, filterFlights } from "./preview";
import { reusableRevision } from "./statePolling";
import { Home } from "./Home";
import { Activity } from "./Activity";
import { LiveStatus } from "./LiveStatus";
import { LanguagePicker } from "./LanguagePicker";
import {AirlineLogo} from "./AirlineLogo";
import { AdminPanel } from "./AdminPanel";
import { suggestCurrency } from "./currency";
import { GoogleMailPanel } from "./GoogleMailPanel";
import { Profile } from "./Accounts";
import { SearchForm as Filters } from "./SearchForm";
import { useEffect, useState, useMemo, useRef, memo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plane,
  House,
  PlaneTakeoff,
  PlaneLanding,
  Search,
  History,
  Bell,
  Settings,
  UserRound,
  Shield,
  Plus,
  Pause,
  Play,
  RefreshCw,
  SlidersHorizontal,
  ArrowRight,
  X,
  Mail,
  ExternalLink,
  Download,
  CircleAlert,
  CheckCircle2,
  LoaderCircle,
  Clock,
  MapPin,
  ArrowLeftRight,
  Archive,
  Save,
  Send,
  CalendarDays,
  Info,
  LogOut,
  Trash2,
  TrendingDown,
  ChevronRight,
} from "lucide-react";
import { Button, Card, Modal } from "./ui";
import type {
  Alert,
  Config,
  Flight,
  Leg,
  SearchRecord,
  SMTP,
  Snapshot,
  State,
} from "./types";
const moneyFormats = new Map<string, Intl.NumberFormat>();
function moneyFormatter(currency: string, exact: boolean) {
  const key = `${getLocale()}:${currency}:${exact}`;
  if (!moneyFormats.has(key)) moneyFormats.set(key, new Intl.NumberFormat(getLocale(), {style:"currency", currency, ...(exact ? {} : {maximumFractionDigits:0})}));
  return moneyFormats.get(key)!;
}
const formatMoney = (v: number | null | undefined, currency = "BRL") => v == null ? "—" : moneyFormatter(currency,false).format(v/100).replace(/\u00a0/g," ");
const exactMoney = (v: number, currency = "BRL") => moneyFormatter(currency,true).format(v/100).replace(/\u00a0/g," ");
const time = (v: number | null | undefined) =>
  v
    ? new Date(v * 1000).toLocaleTimeString(getLocale(), {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : t("Ainda não realizada");
const fullDate = (v: number) => new Date(v * 1000).toLocaleString(getLocale());
const localDate = (s: string) =>
  new Date(s.slice(0, 10) + "T12:00:00")
    .toLocaleDateString(getLocale(), { day: "2-digit", month: "short" })
    .replace(".", "");
const duration = (n: number) =>
  n < 60
    ? t("{0} min", [n])
    : t("{0} h{1}", [
        Math.floor(n / 60),
        n % 60 ? t(" {0} min", [n % 60]) : "",
      ]);
const clone = <T,>(v: T): T => structuredClone(v);
const stateLabels = (): Record<string, string> => ({
  scheduled: t("Agendada"),
  collecting: t("Consultando"),
  partial: t("Atualização parcial"),
  error: t("Falha de coleta"),
  paused: t("Pausada"),
  expired: t("Prazo encerrado"),
  ended: t("Encerrada"),
});

const blankLeg = (day: string): Leg => ({
  start: day + "T00:00",
  end: day + "T23:59",
  arrival_before: null,
  stops: [0, 1, 2],
  max_duration: null,
  max_layover: null,
  airlines: [],
});
function blankConfig(): Config {
  const day = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  return {
    language: getLanguage(),
    currency: suggestCurrency(),
    name: "",
    origins: [],
    destinations: [],
    outbound: blankLeg(day),
    inbound: null,
    adults: 1,
    children:0, infants_in_seat:0, infants_on_lap:0,
    cabin: "economy",
    interval: 300,
    checked_bags: 0,
    target_cents: null,
    min_drop_cents: 5000,
    notify_email: false,
    notify_whatsapp:false,
  };
}
const FlightCard = memo(function FlightCard({flight}:{flight:Flight}) {
 useLanguage();
 const [expanded,setExpanded]=useState(false);
 const airline=flight.airlines.join(" / ");
 const codes=flight.airline_codes||[];
 return <article className={`flight-card compact-flight ${flight.stale ? "stale-card" : ""}`}>
   <div className="compact-flight-row">
    <div className="compact-carrier" title={airline}><div className="carrier-logos">{flight.airlines.map((name,i)=><AirlineLogo key={name} name={name} code={codes[i]}/>)}</div><span>{airline}</span></div>
    <div className="compact-route"><strong><span className="compact-endpoint">{flight.departure.slice(11,16)} {flight.origin}</span><span className="route-arrow"> → </span><span className="compact-endpoint">{flight.arrival.slice(11,16)} {flight.destination}</span></strong><small>{localDate(flight.departure)} → {localDate(flight.arrival)} · {duration(flight.duration_minutes)} · {flight.stops ? t("{0} escala(s)",[flight.stops]) : t("Direto")}</small></div>
    <div className="compact-price"><strong>{exactMoney(flight.price_cents,flight.currency||"BRL")}</strong><small>{partyLabel(flight)} · {t("por trecho")}</small></div>
    <a className="button button-outline compact-flight-link" href={flight.search_url} target="_blank" rel="noreferrer">{t("Ver passagem")}<ExternalLink size={13}/></a>
    <Button variant="ghost" className="flight-expand" aria-label={t("Detalhes do itinerário")} aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}><ChevronRight size={16} style={{transform:expanded ? "rotate(90deg)" : undefined}}/></Button>
   </div>
   {flight.stale&&<small className="old-label">{t("Último preço encontrado · atualização pendente")}</small>}
   {expanded&&<div className="flight-details"><strong>{airline}</strong><p>{t("Atualizado às ")}{time(flight.collected_at)}</p><p className="help">{flight.checked_bags_requested ? t("Pesquisa com taxas estimadas para {0} mala(s) despachada(s). Franquia e peso a confirmar na companhia.",[flight.checked_bags_requested]) : t("Taxas de bagagem não adicionadas à pesquisa. Confira a franquia da tarifa na companhia.")}</p>{flight.segments.map((segment,index)=><div className="compact-segment" key={index}><span>{segment.origin} → {segment.destination}</span><span>{localDate(segment.departure)} {segment.departure.slice(11)} → {localDate(segment.arrival)} {segment.arrival.slice(11)}</span>{index<flight.layovers.length&&<small>{t("Conexão de")} {duration(flight.layovers[index])}</small>}</div>)}</div>}
 </article>;
});

function Trend({
  hasReturn,
  version,
  currency,
  searchId,
}: {
  history: Snapshot[];
  hasReturn: boolean;
  version: number;
  currency: string;
  searchId: string;
}) {
  const [chosenVersion, setChosenVersion] = useState<number | null>(null),
    [direction, setDirection] = useState("both"),
    [selected, setSelected] = useState<Snapshot | null>(null);
  const series = useQuery<{
    points: Snapshot[];
    versions: number[];
    bucket_seconds: number;
  }>({
    queryKey: ["trend", searchId, chosenVersion || version],
    queryFn: async () => {
      const response = await fetch(
        `/api/searches/${searchId}/trend?version=${chosenVersion || version}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw Error(t("Não foi possível carregar o gráfico"));
      return response.json();
    },
    refetchInterval: 30000,
  });
  const canReturn=series.data?.points.length ? series.data.points.some(p=>p.direction==="inbound") : hasReturn;
  const shownDirection=canReturn?direction:"outbound";
  const points = (series.data?.points || []).filter(
      (p) => shownDirection === "both" || p.direction === shownDirection,
    ),
    unit = points[0]?.currency || currency;
  const start = points[0]?.collected || 0,
    end = points.at(-1)?.collected || start;
  const min = Math.min(...points.map((p) => p.price!)),
    max = Math.max(...points.map((p) => p.price!));
  const low = Math.max(0, min - (max - min || 100) * 0.1),
    high = max + (max - min || 100) * 0.1;
  const x = (v: number) => 125 + ((v - start) / Math.max(1, end - start)) * 520,
    y = (v: number) => 160 - ((v - low) / Math.max(1, high - low)) * 130;
  return (
    <div className="trend">
      <div className="chart-controls">
        <div className="history-direction"><span>{t("Trechos")}</span><div className="segmented">{[["both",t("Ida e volta")],["outbound",t("Ida")],["inbound",t("Volta")]].filter(([value])=>canReturn||value==="outbound").map(([value,label])=><button key={value} aria-pressed={shownDirection===value} onClick={()=>{setDirection(value);setSelected(null);}}>{label}</button>)}</div></div>
        <label>
          {t("Filtros usados")}
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
      </div>
      {series.isError ? (
        <p role="alert">{t("Não foi possível carregar o gráfico")}</p>
      ) : !points.length ? (
        <p>
          {series.isLoading
            ? t("Carregando…")
            : t("O histórico começa com a primeira coleta completa.")}
        </p>
      ) : (
        <>
          <div className="trend-legend">
            <span>
              <i />
              {t("Ida")}
            </span>
            {canReturn && <span>
              <i />
              {t("Volta")}
            </span>}
            <small>
              {unit} {t("· menor preço por intervalo")}
            </small>
          </div>
          <svg
            viewBox="0 0 680 200"
            onPointerDown={(event) => {
              const rect = event.currentTarget.getBoundingClientRect(),
                px = ((event.clientX - rect.left) / rect.width) * 680,
                py = ((event.clientY - rect.top) / rect.height) * 200;
              const nearest = points.reduce((a, b) =>
                Math.hypot(x(a.collected) - px, y(a.price!) - py) <
                Math.hypot(x(b.collected) - px, y(b.price!) - py)
                  ? a
                  : b,
              );
              setSelected(nearest);
            }}
            role="group"
            aria-label={t("Evolução dos preços de ida e volta")}
          >
            {[0, 1, 2, 3, 4].map((i) => {
              const value = low + ((high - low) * i) / 4;
              return (
                <g key={i}>
                  <line
                    x1="125"
                    x2="645"
                    y1={y(value)}
                    y2={y(value)}
                    stroke="#d7dfe7"
                  />
                  <text
                    x="115"
                    y={y(value) + 4}
                    textAnchor="end"
                    fill="currentColor"
                    fontSize="12"
                  >
                    {formatMoney(value, unit)}
                  </text>
                </g>
              );
            })}
            {["outbound", "inbound"].map((leg, index) => {
              const list = points.filter((p) => p.direction === leg);
              return (
                <g key={leg} stroke={index ? "#527c5b" : "#315f90"} fill="none">
                  <polyline
                    points={list
                      .map((p) => `${x(p.collected)},${y(p.price!)}`)
                      .join(" ")}
                    strokeWidth="2.4"
                    strokeDasharray={index ? "6 3" : undefined}
                  />
                  {list.map((point) => (
                    <circle
                      key={point.id}
                      cx={x(point.collected)}
                      cy={y(point.price!)}
                      r="5"
                      fill="white"
                      tabIndex={-1}
                      role="button"
                      aria-label={`${leg === "outbound" ? t("Ida") : t("Volta")}: ${exactMoney(point.price!, unit)} · ${fullDate(point.collected)}`}
                      onClick={() => setSelected(point)}
                      onFocus={() => setSelected(point)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelected(point);
                        }
                      }}
                    >
                      <title>
                        {fullDate(point.collected)} ·{" "}
                        {exactMoney(point.price!, unit)}
                      </title>
                    </circle>
                  ))}
                </g>
              );
            })}
            <text x="125" y="190" fill="currentColor" fontSize="12">
              {fullDate(start)}
            </text>
            <text
              x="645"
              y="190"
              textAnchor="end"
              fill="currentColor"
              fontSize="12"
            >
              {fullDate(end)}
            </text>
          </svg>
          <label className="sr-only" htmlFor={`point-${searchId}`}>
            {t("Selecionar ponto do gráfico")}
          </label>
          <input
            id={`point-${searchId}`}
            type="range"
            min={0}
            max={Math.max(0, points.length - 1)}
            value={Math.max(
              0,
              points.findIndex((p) => p.id === selected?.id),
            )}
            aria-valuetext={
              selected
                ? `${fullDate(selected.collected)} · ${exactMoney(selected.price!, selected.currency)}`
                : t("Selecione um ponto")
            }
            onChange={(e) => setSelected(points[Number(e.target.value)])}
          />
          <p className="chart-detail" aria-live="polite">
            {selected
              ? `${selected.direction === "outbound" ? t("Ida") : t("Volta")} · ${fullDate(selected.collected)} · ${exactMoney(selected.price!, selected.currency)}`
              : t("Toque em um ponto para ver o preço e o horário.")}
          </p>
          <small>
            {t(
              "O gráfico agrupa o menor preço por intervalo quando há muitas coletas. Os dados completos permanecem no histórico exportado.",
            )}
          </small>
        </>
      )}
    </div>
  );
}
function AlertItem({ event }: { event: Alert }) {
  const p = event.payload,
    f = p.flight;
  return (
    <article className="alert-item">
      <div className="alert-item-top">
        <span className="alert-icon">
          <TrendingDown size={17} />
        </span>
        <div>
          <strong>{t(p.title)}</strong>
          <p>
            {event.direction === "outbound" ? "IDA" : "VOLTA"} ·{" "}
            {localDate(f.departure)} · {f.departure.slice(11, 16)}
          </p>
        </div>
        <span className="muted">{time(event.created)}</span>
      </div>
      <div className="alert-route">
        {f.origin} → {f.destination} · {f.airlines.join(" / ")}
      </div>
      <div className="alert-price">
        {event.previous && event.previous > event.price && (
          <del>{formatMoney(event.previous, f.currency || "BRL")}</del>
        )}
        <strong>{exactMoney(event.price, f.currency || "BRL")}</strong>
      </div>
      {p.saving_cents ? (
        <p className="saving">
          {t("Economia de")} {exactMoney(p.saving_cents, f.currency || "BRL")} (
          {p.saving_percent}%)
        </p>
      ) : (
        <p className="saving">{t("Dentro do orçamento configurado")}</p>
      )}
      <p className="help">
        {t(
          "Melhor preço encontrado para suas preferências. A opção pode ter mudado.",
        )}
      </p>
      <div className="alert-bottom">
        <DeliveryChannels event={event} />
        <a href={f.search_url} target="_blank" rel="noreferrer">
          {t("Conferir pesquisa")}
          <ExternalLink size={12} />
        </a>
      </div>
    </article>
  );
}
export default function App({ onLogout }: { onLogout: () => Promise<void> }) {
  const queryClient = useQueryClient(),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [deleteTarget, setDeleteTarget] = useState<SearchRecord | null>(null),
    [view, setView] = useState("home"),
    [direction, setDirection] = useState("outbound"),
    [modal, setModal] = useState<"new" | "edit" | "status" | "alerts" | null>(null),
    [draft, setDraft] = useState<Config | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<{
      message: string;
      error: boolean;
    } | null>(null),
    [visibleCount, setVisibleCount] = useState(40),
    [alertPending,setAlertPending] = useState(false),
    [smtpDraft, setSmtpDraft] = useState<
      | (SMTP & {
          password: string;
        })
      | null
    >(null);
  const receivedAtRef = useRef(Date.now());
  const drafts = useRef(new Map<string, {version:number; config:Config}>());
  const detail = view === "history" || modal === "status";
  const query = useQuery<State>({
    queryKey: ["radar", selectedId, detail, view],
    queryFn: async ({signal,queryKey}) => {
      const previous=queryClient.getQueryData<State>(queryKey);
      const since=reusableRevision(previous,queryClient.getQueryState(queryKey)?.dataUpdatedAt || Date.now());
      const r = await fetch(
        `/api/state?preview_pool=true&detail=${detail}&scope=${view}` + (selectedId ? "&search_id=" + selectedId : "") + (since?"&since="+since:""),
        { cache: "no-store", signal },
      );
      if (r.status === 401) {
        await onLogout();
        throw Error(t("Sessão encerrada"));
      }
      if (!r.ok) throw Error(t("Não foi possível conectar ao serviço local"));
      const next=await r.json();
      if(next.unchanged && previous) return {...previous,server_time:next.server_time};
      return next;
    },
    refetchInterval: q => q.state.data?.selected?.state === "collecting" ? 3000 : q.state.data?.selected?.active || q.state.data?.searches.some(s=>s.active) ? 15000 : 30000,
    refetchIntervalInBackground: false,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === selectedId && previousQuery?.queryKey[3] === view ? previous : undefined,
    staleTime: 5000,
    retry: 1,
  });
  if(query.dataUpdatedAt) receivedAtRef.current=query.dataUpdatedAt;
  const receivedAt=receivedAtRef.current;
  const data = query.data,
    search = data?.selected;
  const money = (value: number | null | undefined) =>
    formatMoney(value, search?.config.currency || "BRL");
  useEffect(() => {
    if (!search) return;
    const cached = drafts.current.get(search.id);
    if(cached && cached.version !== search.version) drafts.current.delete(search.id);
    setDraft(clone(cached?.version === search.version ? cached.config : search.config));
    setDirection("outbound");
  }, [search?.id, search?.version]);
  function updateDraft(config: Config) {
    setDraft(config);
    if (search && modal !== "new") {
      if(JSON.stringify(config)===JSON.stringify(search.config)) drafts.current.delete(search.id);
      else drafts.current.set(search.id, {version:search.version,config:clone(config)});
    }
  }
  useEffect(() => {
    if (
      view === "searches" &&
      search &&
      data?.archived.some((item) => item.id === search.id)
    )
      setView("history");
  }, [search?.id, search?.active, data?.archived, view]);
  useEffect(() => {
    if (data?.smtp && !smtpDraft) setSmtpDraft({ ...data.smtp, password: "" });
  }, [data?.smtp]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(null), 8000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  async function request(path: string, body: unknown, method = "POST") {
    const response = await fetch("/api" + path, {
      method,
      headers: {
        "content-type": "application/json",
        "x-radar-token": data?.token || "",
      },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) {
      const detail = result.detail;
      throw Error(
        t(
          typeof detail === "string"
            ? detail
            : Array.isArray(detail)
              ? detail
                  .map((d: { msg: string }) =>
                    t(d.msg.replace(/^Value error, /, "")),
                  )
                  .join(" · ")
              : t("Não foi possível concluir a ação"),
        ),
      );
    }
    return result;
  }
  async function perform(action: () => Promise<unknown>, message?: string) {
    setBusy(true);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ["radar"] });
      if (message) setNotice({ message, error: false });
    } catch (e) {
      setNotice({ message: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }
  async function save(submitted?:Config) {
    const savingDraft=submitted || draft;
    if (!savingDraft) return;
    await perform(async () => {
      let reused = false;
      if (modal === "new") {
        const r = await request("/searches", {
          ...savingDraft,
          language: getLanguage(),
        });
        setSelectedId(r.id);
        setView("searches");
      } else if (search) {
        const result = await request(
          "/searches/" + search.id,
          { ...savingDraft, language: getLanguage() },
          "PUT",
        );
        reused = !!result.results_reused;
      }
      if (search && modal !== "new") drafts.current.delete(search.id);
      setModal(null);
      setNotice({message: reused ? t("Filtros salvos e aplicados aos voos já coletados.") : t("Busca salva. A próxima coleta usará os novos filtros."),error:false});
    });
  }
  function newSearch() {
    setDraft({
      ...blankConfig(),
      currency: suggestCurrency(data?.user.country),
    });
    setModal("new");
  }
  const monitoringAction = (sid: string, value: string) =>
    perform(
      async () => {
        await request(`/searches/${sid}/action`, { action: value });
        if (value === "archive") {
          setSelectedId(sid);
          setView("history");
        }
      },
      value === "archive"
        ? t("Monitoramento encerrado. Histórico preservado.")
        : value === "pause"
          ? t("Monitoramento pausado.")
          : t("Monitoramento retomado."),
    );
  const action = (value: string) =>
    search && monitoringAction(search.id, value);
  const dirty =
    !!draft &&
    !!search &&
    JSON.stringify(draft) !== JSON.stringify(search.config);
  const previewing = dirty && modal !== "new";
  const previewCompatible = !!search && !!draft && canPreview(search.config,draft);
  const displayConfig = previewing && previewCompatible ? draft! : search?.config;
  const eligibleFlights = useMemo(() => displayConfig ? filterFlights(data?.flights || [],displayConfig) : [], [data?.flights,displayConfig]);
  const flights = useMemo(() => eligibleFlights.filter(f=>f.direction===direction),[eligibleFlights,direction]);
  const bestOut = eligibleFlights.find(f=>f.direction === "outbound"), bestIn = eligibleFlights.find(f=>f.direction === "inbound");
  useEffect(()=>setVisibleCount(40),[search?.id,search?.version,direction,draft]);
  const hasPendingDrafts = dirty || drafts.current.size > 0;
  useEffect(()=>{
    if (!hasPendingDrafts) return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=""};
    window.addEventListener("beforeunload",warn);return ()=>window.removeEventListener("beforeunload",warn);
  },[hasPendingDrafts]);
  const serverNow = data ? data.server_time + (Date.now()-receivedAt)/1000 : Date.now()/1000;
  const collecting = search?.state === "collecting";
  function discardDraft() {
    if (!search) return;
    drafts.current.delete(search.id);setDraft(clone(search.config));
  }
  const title = search
    ? `${search.config.origins
        .map((a) => data?.airports.find((p) => p.code === a)?.city || a)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(" / ")} ${search.config.inbound ? "↔" : "→"} ${search.config.destinations
        .map((a) => data?.airports.find((p) => p.code === a)?.city || a)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(" / ")}`
    : t("Suas próximas viagens");
  const nav = [
    { id: "home", label: t("Página inicial"), icon: House },
    { id: "history", label: t("Histórico"), icon: History },
    { id: "alerts", label: t("Alertas"), icon: Bell },
    { id: "settings", label: t("Meu perfil"), icon: UserRound },
    ...(data?.user.role === "admin"
      ? [{ id: "admin", label: t("Administração"), icon: Shield }]
      : []),
  ];
  if (query.isLoading)
    return (
      <div className="loading-page">
        <span className="brand-icon">
          <Plane />
        </span>
        <h1>{t("Radar de Voos")}</h1>
        <p>
          <LoaderCircle className="spin" size={17} />
          {t("Conectando ao seu radar…")}
        </p>
      </div>
    );
  if (!data)
    return (
      <div className="loading-page">
        <CircleAlert size={35} />
        <h1>{t("O radar está desconectado")}</h1>
        <p>{t("Inicie o servidor local seguindo as instruções do projeto.")}</p>
        <Button onClick={() => query.refetch()}>{t("Tentar novamente")}</Button>
      </div>
    );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        {t("Pular para o conteúdo")}
      </a>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label={t("Radar de Voos, início")}>
          <span className="brand-icon">
            <Plane size={25} />
          </span>
          <span>{t("Radar de Voos")}</span>
        </a>
        <nav aria-label={t("Navegação principal")}>
          {nav.map((item) => (
            <button
              className={view === item.id || item.id === "home" && view === "searches" ? "selected" : ""}
              key={item.id}
              onClick={() => setView(item.id)}
            >
              <item.icon size={19} />
              {item.label}
              {item.id === "alerts" && (data.alert_total || 0) > 0 && (
                <span className="nav-count">{data.alert_total}</span>
              )}
            </button>
          ))}
        </nav>
        <SidebarSearches searches={data.searches} selectedId={search?.id}
          limit={data.user.search_limit ?? 5} pending={new Set(drafts.current.keys())}
          onSelect={id=>{setSelectedId(id);setView("searches");setDirection("outbound");}}
          onNew={newSearch}/>
        <div className="sidebar-bottom account-summary">
          <SystemVersion />
          <LanguagePicker />
          <strong>{data.user.name}</strong>
          <span>{data.user.phone}</span>
          <Button variant="ghost" onClick={() => void onLogout()}>
            <LogOut size={16} />
            {t("Sair da conta")}
          </Button>
        </div>
      </aside>
      <header className="mobile-header">
        <span className="brand">
          <Plane size={24} />
          {t("Radar de Voos")}
        </span>
        <LanguagePicker />
        <div className="mobile-account">
          <SystemVersion />
          <strong>{data.user.name}</strong>
          <small>{data.user.phone}</small>
        </div>
        <Button
          variant="ghost"
          aria-label={t("Sair da conta")}
          onClick={() => void onLogout()}
        >
          <LogOut size={19} />
        </Button>
        <Button
          variant="ghost"
          aria-label={t("Meu perfil")}
          onClick={() => setView("settings")}
        >
          <Settings size={21} />
        </Button>
      </header>
      <main id="main" className="main-content">
        <header className={`page-heading ${view === "searches" ? "monitor-heading" : ""}`}>
          <div>
            <p className="eyebrow">
              {view === "home" ? t("SEU RADAR DE PASSAGENS") : view === "searches"
                ? t("SEU RADAR DE PASSAGENS")
                : view === "history"
                  ? t("EVOLUÇÃO DOS PREÇOS")
                  : view === "alerts"
                    ? t("OPORTUNIDADES ENCONTRADAS")
                    : t("PREFERÊNCIAS DO RADAR")}
            </p>
            <h1>
              {view === "home" ? t("Minhas viagens") : view === "searches"
                ? search?.config.name || title
                : view === "history"
                  ? t("Histórico de preços")
                  : view === "alerts"
                    ? t("Seus alertas")
                    : view === "admin"
                      ? t("Administração")
                      : t("Meu perfil")}
            </h1>
            <p className="page-subtitle">
              {view === "home" ? t("Suas buscas e oportunidades em um só lugar.") : view === "searches"
                ? ""
                : view === "settings"
                  ? t(
                      "Gerencie seus dados e os contatos que recebem seus alertas.",
                    )
                  : view === "admin"
                    ? t("Configure o serviço de envio para todas as contas.")
                    : search?.config.name ||
                      t("Selecione uma busca para acompanhar.")}
            </p>
          </div>
          <Button onClick={newSearch}>
            <Plus size={17} />
            <span>{t("Nova busca")}</span>
          </Button>
        </header>
        {view === "history" && (
          <Card className="history-selector">
            <label>
              {t("Monitoramento")}
              <select
                value={search?.id || ""}
                onChange={(e) => {setSelectedId(e.target.value);setDirection("outbound");}}
              >
                <option value="" disabled>
                  {t("Selecione uma busca")}
                </option>
                <optgroup label={t("Em acompanhamento")}>{data.searches.map(s=><option key={s.id} value={s.id}>{s.config.name} · {s.config.origins.join(" + ")} → {s.config.destinations.join(" + ")}</option>)}</optgroup>
                <optgroup label={t("Encerradas")}>{data.archived.map(s=><option key={s.id} value={s.id}>{s.config.name} · {s.config.origins.join(" + ")} → {s.config.destinations.join(" + ")}</option>)}</optgroup>
              </select>
            </label>
            {search && data.archived.some((s) => s.id === search.id) && (
              <div className="google-mail-actions">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    search.ends_at > serverNow
                      ? perform(async () => {
                          await request(`/searches/${search.id}/restore`, {});
                          setView("searches");
                        }, t("Monitoramento retomado."))
                      : (setDraft({
                          ...clone(search.config),
                          name: search.config.name,
                        }),
                        setModal("new"))
                  }
                >
                  {search.ends_at > serverNow
                    ? t("Voltar ao monitoramento")
                    : t("Reutilizar com novas datas")}
                </Button>
                <Button variant="ghost" onClick={() => setDeleteTarget(search)}>
                  {t("Excluir")}
                </Button>
              </div>
            )}
          </Card>
        )}
        {query.isError && (
          <div role="status" className="banner warning">
            <CircleAlert size={17} />
            {t("Sem conexão. Exibindo a última atualização.")}
          </div>
        )}
        {notice && (
          <div
            role={notice.error ? "alert" : "status"}
            className={`toast ${notice.error ? "error" : ""}`}
          >
            {notice.error ? (
              <CircleAlert size={19} />
            ) : (
              <CheckCircle2 size={19} />
            )}
            <span>{notice.message}</span>
            <button
              aria-label={t("Dispensar mensagem")}
              onClick={() => setNotice(null)}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {view === "searches" && data.searches.length > 1 && (
            <div className="mobile-search-select">
              <label>
                {t("Busca")}
                <select
                  value={search?.id || ""}
                  onChange={(e) => {setSelectedId(e.target.value);setDirection("outbound");}}
                >
                  {data.searches.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.config.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        {view === "home" && <Home searches={data.searches} onNew={newSearch} onHistory={()=>setView("history")} onOpen={id=>{setSelectedId(id);setView("searches");}}/>}
        {view === "searches" && search && draft && (
          <>
            <Card className="route-card">
              <div className="route-fields">
                <div>
                  <span className="field-caption">
                    {t("Origem")}
                  </span>
                  <div className="route-tags">
                    {search.config.origins.map((a) => (
                      <span className="airport-tag" key={a}>
                        <b>{a}</b>
                        <span>
                          {data.airports.find((p) => p.code === a)?.city}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
                <ArrowLeftRight className="route-swap" size={20} />
                <div>
                  <span className="field-caption">
                    {t("Destino")}
                  </span>
                  <div className="route-tags">
                    {search.config.destinations.map((a) => (
                      <span className="airport-tag" key={a}>
                        <b>{a}</b>
                        <span>
                          {data.airports.find((p) => p.code === a)?.name}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="route-passenger">
                  <span>
                    <Plane size={15} />
                    {partyLabel(search.config)}
                  </span>
                  <small>
                    {
                      (
                        {
                          economy: t("Econômica"),
                          "premium-economy": t("Econômica premium"),
                          business: t("Executiva"),
                          first: t("Primeira classe"),
                        } as Record<string, string>
                      )[search.config.cabin]
                    }
                  </small>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    setModal("edit");
                  }}
                >
                  <SlidersHorizontal size={16} />
                  {t("Editar busca")}
                </Button>
              </div>
              <div className="route-dates">
                <span>
                  <CalendarDays size={15} />
                  {t("Ida:")} {localDate(search.config.outbound.start)},{" "}
                  {search.config.outbound.start.slice(11)} →{" "}
                  {localDate(search.config.outbound.end)},{" "}
                  {search.config.outbound.end.slice(11)}
                </span>
                {search.config.inbound && (
                  <span>
                    <CalendarDays size={15} />
                    {t("Volta:")} {localDate(search.config.inbound.start)} →{" "}
                    {localDate(search.config.inbound.end)}
                  </span>
                )}
              </div>
              <div className="route-activity">
                <button className="route-live" onClick={()=>setModal("status")} aria-label={t("Acompanhamento ao vivo")}><LiveStatus search={search} serverTime={data.server_time} updatedAt={receivedAt} error={query.isError}/></button>
                <div className="route-controls">
                  <Button variant="ghost" disabled={busy} onClick={()=>action(search.active?"pause":"resume")}>{search.active?<Pause size={15}/>:<Play size={15}/>} {search.active?t("Pausar"):t("Retomar")}</Button>
                  <Button variant="ghost" disabled={busy} onClick={()=>action("archive")}><Archive size={15}/>{t("Encerrar")}</Button>
                </div>
              </div>
            </Card>
            <div className={`metrics-grid ${search.config.inbound ? "" : "one-way-metrics"}`}>
              {[
                [PlaneTakeoff, t("Menor ida"), bestOut],
                ...(search.config.inbound ? [[PlaneLanding,t("Menor volta"),bestIn]] : []),
              ].map(([Icon, label, flight], i) => {
                const I = Icon as typeof Plane;
                const f = flight as Flight | undefined;
                return (
                  <Card className="metric" key={i}>
                    <span className="metric-icon">
                      <I size={21} />
                    </span>
                    <div>
                      <p>{label as string}</p>
                      <strong>{money(f?.price_cents)}</strong>
                      <small>
                        {f
                          ? `${localDate(f.departure)} · ${f.airlines[0]} · ${f.origin} → ${f.destination}`
                          : i === 1 && !search.config.inbound
                            ? t("Busca somente de ida")
                            : t("Buscando opções")}
                      </small>
                      {f?.stale && (
                        <span className="old-label">
                          {t("Atualização pendente")}
                        </span>
                      )}
                    </div>
                  </Card>
                );
              })}
              {search.config.inbound && (
              <Card className="metric">
                <span className="metric-icon">
                  <TrendingDown size={21} />
                </span>
                <div>
                  <p>{t("Soma estimada")}</p>
                  <strong>
                    {bestOut && bestIn
                      ? money(bestOut.price_cents + bestIn.price_cents)
                      : "—"}
                  </strong>
                  <small>
                    {partyLabel(search.config)} · {t("bilhetes separados")}
                  </small>
                </div>
              </Card>
              )}
            </div>
            {bestOut && bestIn && bestOut.destination !== bestIn.origin && (
              <div className="airport-note">
                <Info size={16} />
                {t("Aeroportos diferentes na ida e na volta: chegada em")}{" "}
                {bestOut.destination} {t("e saída de")} {bestIn.origin}.
                Traslado não incluído.
              </div>
            )}
            <Card className="monitor-alert-bar"><Bell size={20}/><div><strong>{t("Alertas desta busca")}</strong><small>{[search.config.notify_email?t("E-mail"):"",search.config.notify_whatsapp?"WhatsApp":""].filter(Boolean).join(" + ")||t("Somente no painel")} · {search.config.target_cents?t("Meta {0}",[money(search.config.target_cents)]):t("Sem meta de preço")} · {t("Queda mínima {0}",[money(search.config.min_drop_cents)])}</small></div><Button variant="outline" onClick={()=>{setAlertPending(dirty);setModal("alerts");}}><Bell size={15}/>{t("Configurar alertas")}</Button></Card>
            <div className="content-grid monitor-content">
              <Card className="filters-card quick-filters-card">
                <div className="section-heading">
                  <h2>
                    <SlidersHorizontal size={17} />
                    {t("Filtros da busca")}
                  </h2>
                </div>
                <Filters
                  key={search.id + ":" + search.version}
                  config={draft}
                  setConfig={updateDraft}
                  airports={data.airports}
                  emailRecipients={data.user.emails}
                  whatsappAvailable={data.whatsapp_available}
                  whatsappRecipients={[data.user.whatsapp_phone,...(data.user.additional_phones||[]).map(p=>p.phone)].filter((p):p is string=>!!p)}
                  onSave={save}
                  saving={busy}
                  dirty={dirty}
                />
              </Card>
              <div className="results-column">
                <Card className="results-card">
                  <div className="section-heading">
                    <div>
                      <h2>{t("Melhores opções")}</h2>
                      <p aria-live="polite" aria-atomic="true">
                        {flights.length} {t("opções encontradas ·")}{" "}
                        {partyLabel(search.config)} · {t("por trecho")}
                      </p>
                    </div>
                    <span className="sort-label">
                      {t("Menor preço")}
                      <ChevronRight size={13} />
                    </span>
                  </div>
                  <div className="results-tabs">
                    <div className="tabs">
                      <button
                        className={direction === "outbound" ? "active" : ""}
                        onClick={() => setDirection("outbound")}
                      >
                        {t("Ida ·")} {localDate(search.config.outbound.start)}
                        {search.config.outbound.start.slice(0, 10) !==
                        search.config.outbound.end.slice(0, 10)
                          ? "–" + localDate(search.config.outbound.end)
                          : ""}
                      </button>
                      {search.config.inbound && <button
                        disabled={!search.config.inbound}
                        className={direction === "inbound" ? "active" : ""}
                        onClick={() => setDirection("inbound")}
                      >
                        {t("Volta")}{" "}
                        {search.config.inbound
                          ? " · " + localDate(search.config.inbound.start)
                          : ""}
                      </button>}
                    </div>
                    <Button
                      className="mobile-filter-button"
                      variant="outline"
                      onClick={() => setModal("edit")}
                    >
                      <SlidersHorizontal size={16} />
                      {t("Filtros")}
                    </Button>
                  </div>
                  {previewing && <p className="preview-note">{previewCompatible?t("Prévia nos voos já coletados. Salve para atualizar o monitoramento."):t("Estas mudanças precisam de nova coleta após salvar. Os preços abaixo seguem a busca salva.")}</p>}
                  <div className="criteria-tags">
                    <span>
                      {(direction === "outbound"
                        ? displayConfig!.outbound
                        : displayConfig!.inbound
                      )?.stops
                        .map((n) =>
                          n === 0
                            ? t("Direto")
                            : n === 1
                              ? t("1 escala")
                              : t("2+ escalas"),
                        )
                        .join(" + ")}
                    </span>
                    <span>
                      {(direction === "outbound" ? displayConfig!.outbound : displayConfig!.inbound)?.max_duration == null
                        ? t("Sem limite de duração")
                        : `${t("Até")} ${duration((direction === "outbound" ? displayConfig!.outbound : displayConfig!.inbound)!.max_duration!)}`}
                    </span>
                    {displayConfig!.target_cents && (
                      <span>
                        {t("Meta")} {money(displayConfig!.target_cents)}
                      </span>
                    )}
                  </div>
                  <div className="flights-list">
                    {!flights.length ? (
                      <div className="empty-state">
                        {collecting ? (
                          <LoaderCircle className="spin" />
                        ) : (
                          <Search />
                        )}
                        <h3>
                          {collecting
                            ? t("Buscando oportunidades…")
                            : search.last_finished
                              ? t("Nenhum voo corresponde aos filtros")
                              : t("A primeira coleta está a caminho")}
                        </h3>
                        <p>
                          {search.error
                            ? t(
                                "Estamos atualizando suas opções. Tente buscar novamente em instantes.",
                              )
                            : search.last_finished
                              ? t(
                                  "Experimente ampliar a janela ou a duração. Seus critérios não são relaxados automaticamente.",
                                )
                              : t(
                                  "As tarifas reais aparecerão aqui assim que a fonte responder.",
                                )}
                        </p>
                      </div>
                    ) : (
                      flights.slice(0,visibleCount).map((f) => (
                        <FlightCard key={f.id + f.direction} flight={f} />
                      ))
                    )}
                  </div>
                  {flights.length > visibleCount && <Button className="load-more" variant="outline" onClick={()=>setVisibleCount(n=>n+40)}>{t("Mostrar mais · {0} de {1}",[visibleCount,flights.length])}</Button>}
                  <p className="results-disclaimer">
                    {t(
                      "Confirme disponibilidade, bagagem e condições no site de compra.",
                    )}
                  </p>
                </Card>
                <Card className="alerts-summary">
                  <div className="alerts-summary-heading">
                    <span className="soft-icon">
                      <Bell size={21} />
                    </span>
                    <div>
                      <h2>{t("Último alerta desta busca")}</h2>
                      <p>
                        {t("Oportunidades que respeitam seus filtros salvos.")}
                      </p>
                    </div>
                    <Button variant="ghost" onClick={() => setView("alerts")}>
                      {t("Ver todos")}
                      <ChevronRight size={15} />
                    </Button>
                  </div>
                  {data.alerts[0] ? (
                    <AlertItem event={data.alerts[0]} />
                  ) : (
                    <div className="small-empty">
                      {search.config.target_cents
                        ? t(
                            "Avisaremos ao atingir {0} ou cair pelo menos {1}.",
                            [
                              money(search.config.target_cents),
                              money(search.config.min_drop_cents),
                            ],
                          )
                        : t(
                            "Uma primeira coleta cria a referência. Novas quedas elegíveis aparecem aqui.",
                          )}
                    </div>
                  )}
                  {!data.user.emails.length && (
                    <button
                      className="smtp-callout"
                      onClick={() => setView("settings")}
                    >
                      <Mail size={16} />
                      <span>
                        {t(
                          "Adicione seus e-mails no perfil para receber alertas.",
                        )}
                      </span>
                      <ChevronRight size={15} />
                    </button>
                  )}
                </Card>
              </div>
            </div>
          </>
        )}
        {view === "searches" && !search && (
          <Card>
            <div className="empty-state">
              <PlaneTakeoff />
              <h2>{t("Vamos acompanhar sua próxima viagem?")}</h2>
              <p>
                {t(
                  "Escolha aeroportos, uma janela de saída e quanto quer pagar.",
                )}
              </p>
              <Button onClick={newSearch}>
                <Plus size={16} />
                {t("Criar primeira busca")}
              </Button>
            </div>
          </Card>
        )}
        {view === "history" && !search && <Card className="activity-empty"><History size={28}/><h2>{t("Seu histórico começa com uma viagem")}</h2><Button onClick={newSearch}><Plus size={16}/>{t("Nova busca")}</Button></Card>}
        {view === "history" && search && (
          <>
            <Card className="history-chart">
              <div className="section-heading">
                <div>
                  <h2>{t("Menor preço por janela")}</h2>
                  <p>
                    {t("Ida e volta separadas ·")} {partyLabel(search.config)} · {t("por trecho · fuso do dispositivo")}
                  </p>
                </div>
                <a
                  className="button button-outline"
                  href={"/api/export/" + search.id}
                >
                  <Download size={15} />
                  {t("Baixar histórico")}
                </a>
              </div>
              <Trend
                key={search.id+":"+search.version}
                history={data.history}
                hasReturn={!!search.config.inbound}
                version={search.version}
                searchId={search.id}
                currency={search.config.currency || "BRL"}
              />
            </Card>
            <Card className="table-card">
              <div className="section-heading">
                <h2>{t("Variações de preço")}</h2>
                <span className="muted">
                  {t("Somente o primeiro preço e as mudanças de valor")}
                </span>
              </div>
              <div className="table-scroll">
                <table><thead><tr><th>{t("Data e hora")}</th><th>{t("Direção")}</th><th>{t("Preço anterior → atual")}</th></tr></thead><tbody>{data.history.map(h=><tr key={h.id}><td>{fullDate(h.collected)}<small>{t("Versão {0}",[h.version])}</small></td><td>{h.direction==="outbound" ? t("Ida") : t("Volta")}</td><td>{h.previous_price==null ? t("Primeiro preço") : formatMoney(h.previous_price,h.currency||"BRL")} → <strong>{formatMoney(h.price,h.currency||"BRL")}</strong></td></tr>)}</tbody></table>
              </div>
            </Card>
          </>
        )}
        {view === "alerts" && <Activity searches={[...data.searches,...data.archived]} onOpen={id=>{setSelectedId(id);setView(data.archived.some(s=>s.id===id)?"history":"searches");}}/>}
        {view === "settings" && (
          <Profile
            user={data.user}
            token={data.token}
            onLogout={onLogout}
            onSaved={() =>
              queryClient.invalidateQueries({ queryKey: ["radar"] })
            }
          />
        )}
        {view === "admin" && data.user.role === "admin" && <AdminPanel request={request} userId={data.user.id}>
        {data.google_mail && (
          <GoogleMailPanel
            status={data.google_mail}
            testRecipient={data.mail_test_recipient || ""}
            defaultEmail={
              data.smtp?.username?.includes("@")
                ? data.smtp.username
                : data.user.emails[0] || ""
            }
            request={request}
            onChanged={() =>
              queryClient.invalidateQueries({ queryKey: ["radar"] })
            }
          />
        )}
        {smtpDraft && (
          <div className="admin-smtp-settings">
            <Card className="settings-card">
              <details className="smtp-manual">
                <summary>{t("Configuração manual SMTP")}</summary>
                <div className="section-heading">
                  <div>
                    <h2>
                      <Mail size={19} />
                      {t("E-mail por SMTP")}
                    </h2>
                    <p>
                      {t(
                        "As credenciais ficam neste computador e não entram no Git.",
                      )}
                    </p>
                  </div>
                  <span
                    className={`delivery-badge ${data.smtp?.enabled ? "success" : ""}`}
                  >
                    {data.smtp?.enabled
                      ? t("Habilitado")
                      : t("Não configurado")}
                  </span>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    perform(async () => {
                      await request("/smtp", smtpDraft, "PUT");
                      setSmtpDraft({
                        ...smtpDraft,
                        password: "",
                        password_set:
                          !!smtpDraft.password || smtpDraft.password_set,
                      });
                    }, t("Configuração SMTP salva localmente. Use o botão abaixo para testar."));
                  }}
                >
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={smtpDraft.enabled}
                      onChange={(e) =>
                        setSmtpDraft({
                          ...smtpDraft,
                          enabled: e.target.checked,
                        })
                      }
                    />
                    {t("Habilitar envio de e-mails")}
                  </label>
                  <div className="two-fields">
                    <label>
                      {t("Servidor SMTP")}
                      <input
                        required={smtpDraft.enabled}
                        placeholder="smtp.seuprovedor.com"
                        autoComplete="off"
                        value={smtpDraft.host}
                        onChange={(e) =>
                          setSmtpDraft({ ...smtpDraft, host: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      {t("Porta")}
                      <input
                        type="number"
                        min={1}
                        max={65535}
                        required
                        value={smtpDraft.port}
                        onChange={(e) =>
                          setSmtpDraft({
                            ...smtpDraft,
                            port: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                  <label>
                    {t("Segurança")}
                    <select
                      value={smtpDraft.security}
                      onChange={(e) =>
                        setSmtpDraft({
                          ...smtpDraft,
                          security: e.target.value,
                          port: e.target.value === "ssl" ? 465 : 587,
                        })
                      }
                    >
                      <option value="starttls">
                        {t("STARTTLS (normalmente porta 587)")}
                      </option>
                      <option value="ssl">
                        {t("TLS direto (normalmente porta 465)")}
                      </option>
                    </select>
                  </label>
                  <label>
                    {t("Usuário SMTP")}
                    <input
                      autoComplete="off"
                      value={smtpDraft.username}
                      onChange={(e) =>
                        setSmtpDraft({ ...smtpDraft, username: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    {t("Senha ou senha de aplicativo")}
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={smtpDraft.password}
                      placeholder={
                        smtpDraft.password_set
                          ? t("Senha salva · deixe vazio para manter")
                          : t("Digite somente neste formulário local")
                      }
                      onChange={(e) =>
                        setSmtpDraft({ ...smtpDraft, password: e.target.value })
                      }
                    />
                  </label>
                  <div className="two-fields">
                    <label>
                      {t("E-mail remetente")}
                      <input
                        type="email"
                        required={smtpDraft.enabled}
                        placeholder="radar@seudominio.com"
                        value={smtpDraft.sender}
                        onChange={(e) =>
                          setSmtpDraft({ ...smtpDraft, sender: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      {t("E-mail para testes")}
                      <input
                        type="email"
                        required={smtpDraft.enabled}
                        placeholder="voce@exemplo.com"
                        value={smtpDraft.recipient}
                        onChange={(e) =>
                          setSmtpDraft({
                            ...smtpDraft,
                            recipient: e.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                  <div className="settings-actions">
                    <Button type="submit" disabled={busy}>
                      <Save size={16} />
                      {t("Salvar configuração")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy || !data.smtp?.enabled}
                      onClick={() =>
                        perform(
                          () => request("/smtp/test", {}),
                          t(
                            "E-mail de teste colocado na fila. Consulte a aba Envios.",
                          ),
                        )
                      }
                    >
                      <Send size={15} />
                      {t("Enviar e-mail de teste")}
                    </Button>
                  </div>
                  <p className="help">
                    {t(
                      "O teste usa o destinatário da configuração já salva. Alertas antigos que aguardavam configuração não são enviados retroativamente. Nenhuma mensagem é marcada como entregue sem confirmação.",
                    )}
                  </p>
                </form>
              </details>
            </Card>

          </div>
        )}
        </AdminPanel>}
        {search && view === "searches" && (
          <footer className="page-footer">
            <span>
              {t("Tarifas pesquisadas no Google Voos")}
              <br />
              {t(
                "Preços observados, sem garantia de disponibilidade · voos no horário local dos aeroportos",
              )}
              <br />
              {t("Encerramento automático:")} {fullDate(search.ends_at)}{" "}
              {t("· fim da última janela de partida.")}
            </span>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setDeleteTarget(search)}
            >
              <Trash2 size={14} />
              {t("Excluir monitoramento")}
            </Button>
          </footer>
        )}
        {view === "searches" && previewing && !modal && <aside className="pending-bar" aria-label={t("Alterações pendentes")}><span role="status"><strong>{t("Alterações pendentes")}</strong> {t("Salve para atualizar o monitoramento.")}</span><div><Button variant="ghost" disabled={busy} onClick={discardDraft}>{t("Descartar")}</Button><Button form="monitor-filters" type="submit" disabled={busy}><Save size={16}/>{busy?t("Salvando…"):t("Salvar")}</Button></div></aside>}
      </main>
      <nav className="mobile-nav" aria-label={t("Navegação no celular")}>
        {nav.map((item) => (
          <button
            key={item.id}
            className={view === item.id || item.id === "home" && view === "searches" ? "selected" : ""}
            onClick={() => setView(item.id)}
          >
            <item.icon size={20} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <Modal
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("Excluir monitoramento?")}
        description={t(
          "A exclusão remove esta busca, preços coletados, histórico e alertas locais. Não pode ser desfeita e não retira e-mails já enviados.",
        )}
      >
        <p>
          <strong>{deleteTarget?.config.name}</strong>
        </p>
        <div className="google-mail-actions">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setDeleteTarget(null)}
          >
            {t("Cancelar")}
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() =>
              deleteTarget &&
              perform(async () => {
                await request(`/searches/${deleteTarget.id}`, {}, "DELETE");
                drafts.current.delete(deleteTarget.id);
                setDeleteTarget(null);
                setSelectedId(null);
                setView("home");
              }, t("Monitoramento excluído."))
            }
          >
            {t("Excluir definitivamente")}
          </Button>
        </div>
      </Modal>
      <Modal open={modal === "alerts"} onOpenChange={open=>{if(!open)setModal(null);}} title={t("Alertas desta busca")} description={t("Defina a meta de preço e como receber as oportunidades.")} className="alert-settings-modal">
        {alertPending&&<p className="alert-draft-note" role="status">{t("Salvar também aplica as alterações pendentes da busca.")}</p>}
        {draft&&<Filters config={draft} setConfig={updateDraft} airports={data.airports} emailRecipients={data.user.emails}
                  whatsappAvailable={data.whatsapp_available}
                  whatsappRecipients={[data.user.whatsapp_phone,...(data.user.additional_phones||[]).map(p=>p.phone)].filter((p):p is string=>!!p)} onSave={save} saving={busy} alertsOnly/>}
      </Modal>
      <Modal
        open={modal === "new" || modal === "edit"}
        onOpenChange={(v) => {
          if (!v) {
            if (modal === "new" && search) {const cached=drafts.current.get(search.id);setDraft(clone(cached?.version===search.version?cached.config:search.config));}
            setModal(null);
          }
        }}
        className="search-modal"
        title={modal === "new" ? t("Nova busca") : t("Editar busca")}
        description={t(
          "Escolha os aeroportos, horários e condições. Salvar altera o radar e os alertas.",
        )}
        wide
      >
        {draft && (
          <>
          {modal === "edit" && <div className="editor-preview"><span>{previewCompatible?t("{0} opções na prévia",[eligibleFlights.length]):t("Nova coleta após salvar")}</span><Button variant="ghost" onClick={()=>setModal(null)}>{t("Ver resultados")}</Button></div>}
          <Filters
            config={draft}
            setConfig={updateDraft}
            airports={data.airports}
            emailRecipients={data.user.emails}
                  whatsappAvailable={data.whatsapp_available}
                  whatsappRecipients={[data.user.whatsapp_phone,...(data.user.additional_phones||[]).map(p=>p.phone)].filter((p):p is string=>!!p)}
            onSave={save}
            saving={busy}
            general
            editing={modal === "edit"}
            dirty={dirty}
          />
          </>
        )}
      </Modal>
      <Modal
        open={modal === "status"}
        onOpenChange={(v) => !v && setModal(null)}
        title={t("Acompanhamento ao vivo")}
        description={t(
          "Seu radar continua buscando enquanto você faz outras coisas.",
        )}
        wide
      >
        <div className="status-overview">
          {search && <LiveStatus search={search} serverTime={data.server_time} updatedAt={receivedAt} error={query.isError}/>}
          <span>
            {t("Atualização a cada")} {(search?.config.interval || 0) / 60} min
          </span>
          <span>
            {t("Última atualização:")} {time(search?.last_success)}
          </span>
        </div>
        <p className="help">
          {collecting
            ? t("Estamos procurando novas opções para sua viagem.")
            : search?.active
              ? t(
                  "O monitoramento é automático a cada cinco minutos. Em períodos de fila, a atualização pode levar mais tempo.",
                )
              : t("Seu radar está pausado. Retome quando quiser.")}
        </p>
        <details className="technical-details">
          <summary>{t("Detalhes técnicos")}</summary>
          <div className="route-status-list">
            {data.routes.map((r) => (
              <article key={r.key}>
                <div>
                  <strong>
                    {r.origin} → {r.destination}
                  </strong>
                  <small>
                    {localDate(r.date)} ·{" "}
                    {r.direction === "outbound" ? t("Ida") : t("Volta")}
                  </small>
                </div>
                <span
                  className={`delivery-badge ${r.status !== "error" ? "success" : ""}`}
                >
                  {r.status === "error"
                    ? t("Falhou")
                    : r.count
                      ? t("{0} elegíveis", [r.count])
                      : t("Sem opções elegíveis")}
                </span>
                <div>
                  <small>
                    {t("Última tentativa:")} {time(r.last_attempt)}
                  </small>
                  <small>
                    {t("Última resposta válida:")} {time(r.last_valid)}
                  </small>
                </div>
                {r.error && <p className="error-text">{r.error}</p>}
              </article>
            ))}
            {!data.routes.length && (
              <p>{t("A primeira coleta ainda não foi concluída.")}</p>
            )}
          </div>
        </details>
      </Modal>
    </div>
  );
}
