import { NavigationPrompt } from "./NavigationPrompt";
import { useNavigation, routePath, focusPageHeading, plainClick, type View, type AppRoute } from "./navigation";
import { tripTitle } from "./tripSummary";
import { SystemVersion } from "./SystemVersion";
import { SidebarSearches } from "./SidebarSearches";
import { t, getLanguage } from "./i18n";
import { canPreview, filterFlights } from "./preview";
import { reusableRevision } from "./statePolling";
import { Home } from "./Home";
import { Activity } from "./Activity";
import { SourceNotice } from "./LiveStatus";
import { TripHero, TripSections } from "./TripHero";
import { TripFlights } from "./TripFlights";
import { AlertDays, AlertRow } from "./AlertRow";
import { PriceChartCard, PriceVariations } from "./PriceHistory";
import { QuickPreferences } from "./QuickPreferences";
import { AppIcon } from "./AppIcon";
import { Avatar } from "./Avatar";
import { ErrorBoundary } from "./ErrorBoundary";
import { ViewSkeleton } from "./Skeleton";
import { FormSkeleton } from "./FormSkeleton";
import { usePageTitle } from "./pageTitle";
import { formatDateTime, formatMoney } from "./format";
import { plural } from "./plural";
import { suggestCurrency } from "./currency";
import { creationFailure, whatsappNumberBody } from "./contacts";
import { markAlertsSeen, unseenAlerts, useAlertsSeen } from "./alertsSeen";
// Also styles the editor page and the filters card, which the app draws before the form's code arrives.
import "./search-form.css";
import { useEffect, useState, useMemo, useRef, lazy, Suspense } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
// The profile (phone fields), administration (with the e-mail panels) and the
// trip form (calendar, sliders, airport and airline search) load only when opened.
const Profile = lazy(() => import("./Profile").then((module) => ({ default: module.Profile })));
const AdminPanel = lazy(() => import("./AdminPanel").then((module) => ({ default: module.AdminPanel })));
// Set once the trip form's code is in. Pending filter changes only come from the form: before
// that, a draft that differs from the trip is the previous trip's, until the draft effect
// replaces it, and must not download the form into the closed filters card.
let filtersLoaded = false;
const importFilters = () =>
  import("./SearchForm").then(({ SearchForm }) => {
    filtersLoaded = true;
    return { default: SearchForm };
  });
let filtersCode: ReturnType<typeof importFilters> | undefined;
/** The form's code, for the lazy component and for an early start on the editor's page. Both
 * share one download, so the form waits for its stylesheet; a failure allows a new attempt. */
const loadFilters = () =>
  (filtersCode ??= importFilters().catch((error) => {
    filtersCode = undefined;
    throw error;
  }));
const Filters = lazy(loadFilters);
import {
  House,
  PlaneTakeoff,
  History,
  Bell,
  UserRound,
  Shield,
  Plus,
  X,
  CircleAlert,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Archive,
  Save,
  LogOut,
  MapPinOff,
  LoaderCircle,
} from "lucide-react";
import { Button, Card, ConfirmDialog, ContextMenu, Modal, Notice } from "./ui";
import type { Config, Leg, SearchRecord, State, User } from "./types";
import "./pages.css";
const clone = <T,>(v: T): T => structuredClone(v);
/**
 * The account's WhatsApp numbers, once each: the access phone as the server
 * formats it (phone_display); the others raw, until the server formats them.
 */
const whatsappTargets = (user: User) =>
  [...new Set([user.whatsapp_phone, ...(user.additional_phones || []).map((p) => p.phone)])]
    .filter((phone): phone is string => !!phone)
    .map((phone) => (phone === user.phone ? user.phone_display ?? phone : phone));
/** A new-trip draft with something filled in (route or name). */
const draftHasContent = (config: Config | null | undefined) =>
  !!(config?.origins.length || config?.destinations.length || config?.name);

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
    children: 0,
    infants_in_seat: 0,
    infants_on_lap: 0,
    cabin: "economy",
    interval: 300,
    checked_bags: 0,
    target_cents: null,
    min_drop_cents: 5000,
    notify_email: false,
    notify_whatsapp: true,
  };
}
export default function App({
  onLogout,
  alert,
  onDismissAlert,
}: {
  onLogout: () => Promise<void>;
  /** An account error from the session gate, shown in this shell's toast region. */
  alert?: string;
  onDismissAlert?: () => void;
}) {
  const { route, navigate, restoreScroll } = useNavigation();
  const tripPage = !!route.searchId && ["searches", "history"].includes(route.view);
  const activeView = tripPage ? "home" : route.view;
  const view = route.view,
    selectedId = route.searchId || null;
  const modal = route.editor || null;
  const editorOrigin = useRef<AppRoute>({ view: "home" });
  const [creationDraft, setCreationDraft] = useState<Config | null>(null);
  const [draftOwner, setDraftOwner] = useState("");
  const [creationProgress, setCreationProgress] = useState<{step: number; leg: "outbound" | "inbound"; maxStep: number}>({step: 0, leg: "outbound", maxStep: 0});
  const [discardCreation, setDiscardCreation] = useState(false);
  const setView = (next: View) =>
    navigate((current) => ({
      view: next,
      ...(["history", "searches"].includes(next) && current.searchId
        ? { searchId: current.searchId }
        : {}),
    }));
  const openSearch = (id: string, history = false) =>
    navigate({ view: history ? "history" : "searches", searchId: id });
  const setSelectedId = (id: string | null) =>
    navigate((current) => ({ ...current, searchId: id || undefined }));
  const closeEditor = () => {
    // An error of the editor belongs to its form; it must not come back as a toast elsewhere.
    setNotice(null);
    navigate(
      route.editor === "new"
        ? editorOrigin.current
        : { view: "searches", searchId: route.searchId },
    );
  };
  const setModal = (next: "new" | "edit" | "alerts" | null) => {
    if (next === null) {
      if (route.editor) closeEditor();
    } else {
      editorOrigin.current = route;
      navigate({
        view: next === "new" ? "home" : "searches",
        searchId: next === "new" ? undefined : selectedId || undefined,
        editor: next,
        step: next === "new" ? creationProgress.step : 0,
        leg: next === "new" ? creationProgress.leg : "outbound",
      });
    }
  };
  const apiView = route.editor === "new" || view === "notfound" ? "home" : view;
  const queryClient = useQueryClient(),
    [deleteTarget, setDeleteTarget] = useState<SearchRecord | null>(null),
    [direction, setDirection] = useState("outbound"),
    [draft, setDraft] = useState<Config | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<{
      message: string;
      error: boolean;
    } | null>(null),
    [visibleCount, setVisibleCount] = useState(40),
    [alertPending, setAlertPending] = useState(false),
    // Declared after the states above: tests address those by position.
    [endTarget, setEndTarget] = useState<SearchRecord | null>(null),
    [profileDirty, setProfileDirty] = useState(false),
    [deleteError, setDeleteError] = useState(""),
    [endError, setEndError] = useState("");
  const receivedAtRef = useRef(Date.now());
  const drafts = useRef(new Map<string, { version: number; config: Config }>());
  // Toasts that wait for their dialog to leave (Modal.onClosed): the page behind it is hidden until then.
  const deletedNotice = useRef(false);
  const detail = view === "history";
  const query = useQuery<State>({
    queryKey: ["radar", selectedId, detail, apiView],
    queryFn: async ({ signal, queryKey }) => {
      const previous = queryClient.getQueryData<State>(queryKey);
      const since = reusableRevision(
        previous,
        queryClient.getQueryState(queryKey)?.dataUpdatedAt || Date.now(),
      );
      const r = await fetch(
        `/api/state?preview_pool=true&detail=${detail}&scope=${apiView}` +
          (selectedId ? "&search_id=" + encodeURIComponent(selectedId) : "") +
          (since ? "&since=" + since : ""),
        { cache: "no-store", signal },
      );
      if (r.status === 401) {
        await onLogout();
        throw Error(t("Sessão encerrada"));
      }
      if (!r.ok)
        throw Error(
          r.status === 404
            ? t("Monitoramento não encontrado.")
            : t("Não foi possível conectar ao Radar de Voos."),
        );
      const next = await r.json();
      if (next.unchanged && previous)
        return { ...previous, server_time: next.server_time };
      return next;
    },
    refetchInterval: (q) =>
      q.state.data?.selected?.state === "collecting"
        ? 3000
        : q.state.data?.selected?.active ||
            q.state.data?.searches.some((s) => s.active)
          ? 15000
          : 30000,
    refetchIntervalInBackground: false,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === selectedId &&
      previousQuery?.queryKey[3] === apiView
        ? previous
        : undefined,
    staleTime: 5000,
    retry: 1,
  });
  if (query.dataUpdatedAt) receivedAtRef.current = query.dataUpdatedAt;
  const receivedAt = receivedAtRef.current;
  const data = query.data,
    search = data?.selected;
  // The shell keeps the last account data while another view loads.
  const lastData = useRef<State | undefined>(undefined);
  if (data) lastData.current = data;
  const shell = data ?? lastData.current;
  // "Alertas" counts what arrived since the last visit to the alert center on this device.
  const alertsSeen = useAlertsSeen(shell?.user.id);
  useEffect(() => {
    if (shell && (alertsSeen === null || view === "alerts")) markAlertsSeen(shell.user.id, shell.server_time);
  }, [shell?.user.id, shell?.server_time, view, alertsSeen === null]);
  const unseen = unseenAlerts(shell?.alert_recent, alertsSeen);
  const alertsBadge = (className: string) =>
    unseen > 0 && (
      <span
        className={clsx("nav-count is-unseen", className)}
        title={t("Alertas desde a sua última visita")}
        aria-label={plural(unseen, "{0} alerta novo", "{0} alertas novos")}
      >
        {unseen >= 100 ? "99+" : unseen}
      </span>
    );
  // The saved-draft notice belongs to the moment the assistant opens with a
  // previous draft; filling in a new one never adds it (no layout shift).
  const assistantOpening = useRef({ open: false, resumed: false });
  if (route.editor === "new") {
    if (!assistantOpening.current.open && data?.user && draftOwner === data.user.id)
      assistantOpening.current = { open: true, resumed: draftHasContent(creationDraft) };
  } else if (assistantOpening.current.open) assistantOpening.current = { open: false, resumed: false };
  const draftResumed = route.editor === "new" && assistantOpening.current.resumed;
  useEffect(() => {
    if (!data?.user.id || draftOwner === data.user.id) return;
    let restored: Config | null = null;
    try {
      const stored = JSON.parse(
        sessionStorage.getItem("radar-trip-draft:" + data.user.id) || "null",
      );
      const saved = stored?.config || stored;
      if (stored?.config) setCreationProgress({
        step: Math.min(2, Math.max(0, Number(stored.step) || 0)),
        leg: stored.leg === "inbound" ? "inbound" : "outbound",
        maxStep: Math.min(2, Math.max(0, Number(stored.maxStep) || 0)),
      });
      if (
        saved &&
        Array.isArray(saved.origins) &&
        Array.isArray(saved.destinations) &&
        saved.outbound?.start &&
        saved.outbound?.end &&
        typeof saved.adults === "number"
      )
        restored = saved;
    } catch {
      /* Storage is optional, including in private browsing. */
    }
    if (!restored) setCreationProgress({step: 0, leg: "outbound", maxStep: 0});
    setCreationDraft(restored);
    setDraftOwner(data.user.id);
  }, [data?.user.id]);
  useEffect(() => {
    if (!data?.user.id || draftOwner !== data.user.id) return;
    try {
      if (creationDraft)
        sessionStorage.setItem(
          "radar-trip-draft:" + data.user.id,
          JSON.stringify({config: creationDraft, ...creationProgress}),
        );
      else sessionStorage.removeItem("radar-trip-draft:" + data.user.id);
    } catch {
      /* Keep the in-memory draft when storage is unavailable. */
    }
  }, [creationDraft, creationProgress, data?.user.id, draftOwner]);
  useEffect(() => {
    if (
      route.editor === "new" &&
      !creationDraft &&
      data?.user &&
      draftOwner === data.user.id
    )
      setCreationDraft({
        ...blankConfig(),
        currency: suggestCurrency(data.user.country),
      });
  }, [route.editor, creationDraft, data?.user.id, draftOwner]);
  useEffect(() => {
    if (data) restoreScroll();
  }, [data, route]);
  useEffect(() => {
    if (data) focusPageHeading();
  });
  useEffect(() => {
    // A link or reload into the editor downloads the form alongside the trip data, not after
    // it. A failure shows where the form renders.
    if (route.editor) loadFilters().catch(() => {});
  }, []);
  useEffect(() => {
    if (!search || route.editor === "new") return;
    const cached = drafts.current.get(search.id);
    if (cached && cached.version !== search.version)
      drafts.current.delete(search.id);
    setDraft(
      clone(cached?.version === search.version ? cached.config : search.config),
    );
    setDirection("outbound");
  }, [search?.id, search?.version]);
  function updateDraft(config: Config) {
    if (modal === "new") {
      setCreationDraft(config);
      return;
    }
    setDraft(config);
    if (search) {
      if (JSON.stringify(config) === JSON.stringify(search.config))
        drafts.current.delete(search.id);
      else
        drafts.current.set(search.id, {
          version: search.version,
          config: clone(config),
        });
    }
  }
  useEffect(() => {
    // Ended trips keep their history and alerts; flights are no longer collected.
    if (
      view === "searches" &&
      route.panel !== "alerts" &&
      search &&
      data?.archived.some((item) => item.id === search.id)
    )
      setView("history");
  }, [search?.id, search?.active, data?.archived, view, route.panel]);
  // Leaving the editor another way (browser Back) drops its form error too.
  const editorOpen = useRef(!!route.editor);
  useEffect(() => {
    if (editorOpen.current && !route.editor) setNotice((current) => (current?.error ? null : current));
    editorOpen.current = !!route.editor;
  }, [route.editor]);
  useEffect(() => {
    // Confirmations leave on their own; errors stay until dismissed.
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
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
    if (!response.ok) {
      // A proxy or server failure may answer in plain text: the error falls back to the generic message.
      const result = await response.json().catch(() => ({}));
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
    // A success always answers JSON: anything else stays an error instead of an empty result.
    return response.json();
  }
  /** Runs a request; an error goes to the toast, or to `onError` when a dialog shows it. */
  async function perform(action: () => Promise<unknown>, message?: string, onError?: (message: string) => void) {
    setBusy(true);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ["radar"] });
      if (message) setNotice({ message, error: false });
    } catch (e) {
      if (onError) onError((e as Error).message);
      else setNotice({ message: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }
  /** A WhatsApp number typed in the trip review, saved to the profile; the form then shows it. */
  async function saveWhatsapp(country: string, phone: string) {
    if (!data) return;
    await request("/profile", whatsappNumberBody(data.user, country, phone), "PUT");
    await queryClient.invalidateQueries({ queryKey: ["radar"] });
  }
  const askDelete = (target: SearchRecord) => {
    setDeleteError("");
    setDeleteTarget(target);
  };
  async function save(submitted?: Config, currencyReviewed = false, numberSaved = false) {
    const savingDraft = submitted || (modal === "new" ? creationDraft : draft);
    if (!savingDraft) return;
    if (modal !== "new" && search && savingDraft.currency !== search.config.currency && !currencyReviewed) {
      navigate({ view: "searches", searchId: search.id, editor: "edit", step: 2, leg: "outbound" });
      setNotice({ message: t("Revise os valores de alerta após trocar a moeda."), error: true });
      return;
    }
    await perform(async () => {
      let reused = false;
      if (modal === "new") {
        const r = await request("/searches", {
          ...savingDraft,
          language: getLanguage(),
        });
        setCreationDraft(null);
        setCreationProgress({step: 0, leg: "outbound", maxStep: 0});
        openSearch(r.id);
      } else if (search) {
        const result = await request(
          "/searches/" + search.id,
          { ...savingDraft, language: getLanguage() },
          "PUT",
        );
        reused = !!result.results_reused;
      }
      if (search && modal !== "new") drafts.current.delete(search.id);
      if (modal !== "new") navigate({ view: "searches", searchId: search?.id });
      setNotice({
        message:
          modal === "new"
            ? t("Monitoramento criado. Aguardando a primeira atualização.")
            : modal === "alerts"
              ? savingDraft.target_cents
                ? t("Alertas salvos. Avisaremos quando o preço chegar a {0}.", [formatMoney(savingDraft.target_cents, savingDraft.currency)])
                : t("Alertas salvos.")
              : reused
              ? t("Filtros salvos e aplicados aos voos já coletados.")
              : t("Busca salva. A próxima coleta usará os novos filtros."),
        error: false,
      });
    }, undefined, (message) => setNotice({ message: creationFailure(message, numberSaved), error: true }));
  }
  function newSearch() {
    if (!creationDraft)
      setCreationDraft({
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
          openSearch(sid, true);
        }
      },
      // Ending shows its state in the trip header ("Encerrado · Histórico preservado."): no toast repeats it.
      value === "archive" ? undefined : value === "pause" ? t("Monitoramento pausado.") : t("Monitoramento retomado."),
    );
  const action = (value: string) =>
    search && monitoringAction(search.id, value);
  const dirty =
    !!draft &&
    !!search &&
    JSON.stringify(draft) !== JSON.stringify(search.config);
  const previewing = dirty && modal !== "new";
  const previewCompatible =
    !!search && !!draft && canPreview(search.config, draft);
  const displayConfig =
    previewing && previewCompatible ? draft! : search?.config;
  const eligibleFlights = useMemo(
    () =>
      displayConfig ? filterFlights(data?.flights || [], displayConfig) : [],
    [data?.flights, displayConfig],
  );
  const flights = useMemo(
    () => eligibleFlights.filter((f) => f.direction === direction),
    [eligibleFlights, direction],
  );
  const bestOut = eligibleFlights.find((f) => f.direction === "outbound"),
    bestIn = eligibleFlights.find((f) => f.direction === "inbound");
  useEffect(
    () => setVisibleCount(40),
    [search?.id, search?.version, direction, draft],
  );
  const hasPendingDrafts = dirty || drafts.current.size > 0 || draftHasContent(creationDraft);
  useEffect(() => {
    if (!hasPendingDrafts) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasPendingDrafts]);
  const serverNow = data
    ? data.server_time + (Date.now() - receivedAt) / 1000
    : Date.now() / 1000;
  const tripEnded = !!search && !!data?.archived.some((item) => item.id === search.id);
  const configureAlerts = () => {
    setAlertPending(dirty);
    setModal("alerts");
  };
  /** Ended trips come back while their dates are ahead; past ones start a new trip from the same filters. */
  const restoreOrReuse = (target: SearchRecord) =>
    target.ends_at > serverNow
      ? perform(async () => {
          await request(`/searches/${target.id}/restore`, {});
          navigate({ view: "searches", searchId: target.id });
        }, t("Monitoramento retomado."))
      : (setCreationDraft({ ...clone(target.config), name: target.config.name }), setModal("new"));
  function discardDraft() {
    if (!search) return;
    drafts.current.delete(search.id);
    setDraft(clone(search.config));
    setNotice(null);
  }
  const title = search
    ? `${search.config.origins
        .map((a) => data?.airports.find((p) => p.code === a)?.city || a)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(
          " / ",
        )} ${search.config.inbound ? "↔" : "→"} ${search.config.destinations
        .map((a) => data?.airports.find((p) => p.code === a)?.city || a)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(" / ")}`
    : t("Suas próximas viagens");
  const nav = [
    { id: "home" as const, label: t("Viagens"), icon: House },
    { id: "alerts" as const, label: t("Alertas"), icon: Bell },
    { id: "history" as const, label: t("Histórico"), icon: History },
    { id: "settings" as const, label: t("Meu perfil"), icon: UserRound },
    ...(shell?.user.role === "admin"
      ? [{ id: "admin" as const, label: t("Administração"), icon: Shield }]
      : []),
  ];
  // Administration task pages (message detail, account forms) carry their own heading.
  const adminTask =
    view === "admin" &&
    data?.user.role === "admin" &&
    (route.section === "deliveries"
      ? !!route.deliveryId
      : route.section === "users" && !!route.userAction);
  // The task title also heads the page while the administration code loads.
  const adminTaskTitle = !adminTask
    ? ""
    : route.deliveryId
      ? t("Detalhes do envio")
      : route.userAction === "new"
        ? t("Novo usuário")
        : route.userAction === "edit"
          ? t("Editar cadastro")
          : route.userAction === "password"
            ? t("Redefinir senha")
            : t("Monitoramentos");
  // The save bar submits the filters form, which only the Voos tab renders.
  const pendingBar = view === "searches" && route.panel !== "alerts" && previewing && !modal && !tripEnded;
  // Bars over the content set the page's scroll padding (style.css, html.with-*),
  // so that focus and anchors never land under them.
  const accountForm =
    view === "admin" && route.section === "users" && !!route.userAction && route.userAction !== "monitorings";
  const saveBar = view === "settings" && profileDirty;
  useEffect(() => {
    const root = document.documentElement;
    const bars: [string, boolean][] = [
      ["with-pending-bar", pendingBar],
      ["with-form-bar", accountForm],
      ["with-save-bar", saveBar],
      ["with-editor-bar", !!route.editor],
    ];
    for (const [name, on] of bars) root.classList.toggle(name, on);
    return () => bars.forEach(([name]) => root.classList.remove(name));
  }, [pendingBar, accountForm, saveBar, route.editor]);
  const adminSections: Record<string, string> = {
    health: t("Saúde"),
    deliveries: t("Envios"),
    channels: t("Canais"),
    users: t("Usuários"),
    audit: t("Auditoria"),
    retention: t("Retenção"),
  };
  const adminSubtitles: Record<string, string> = {
    deliveries: t("Consulte a atividade e os bloqueios de envio."),
    channels: t("Configure os canais de envio de alertas."),
    users: t("Gerencie contas, contatos e limites."),
    audit: t("Consulte os acessos e as alterações de conta."),
    retention: t("Gerencie o prazo de armazenamento dos registros."),
    health: t("Acompanhe as consultas à fonte, a fila de coletas e os serviços."),
  };
  const tripName = search ? tripTitle(search.config).title : "";
  // The trip selector of a trip page: the history tab and an ended trip also
  // list the ended trips, in their own group (their history stays available).
  const switchEnded = tripPage && (view === "history" || tripEnded) ? data?.archived || [] : [];
  const tripOption = (item: SearchRecord) => (
    <option key={item.id} value={item.id}>
      {tripTitle(item.config).title}
    </option>
  );
  // Two trips or more: a selector over the trip header (on phones, the route title itself).
  const switchable = !!data && !!search && data.searches.length + switchEnded.length > 1;
  const switchTrip = (id: string) => {
    setDirection("outbound");
    navigate({ view, searchId: id, panel: route.panel });
  };
  const tripChoices =
    data && switchEnded.length ? (
      <>
        {data.searches.length > 0 && <optgroup label={t("Em acompanhamento")}>{data.searches.map(tripOption)}</optgroup>}
        <optgroup label={t("Encerradas")}>{switchEnded.map(tripOption)}</optgroup>
      </>
    ) : (
      data?.searches.map(tripOption)
    );
  usePageTitle(
    (route.editor === "new"
      ? [t("Nova viagem")]
      : route.editor
        ? [route.editor === "alerts" ? t("Alertas desta viagem") : t("Editar viagem"), tripName]
        : tripPage
          ? [view === "history" ? t("Histórico") : route.panel === "alerts" ? t("Alertas") : "", tripName]
          : view === "home"
            ? [t("Minhas viagens")]
            : view === "history"
              ? [t("Histórico de preços")]
              : view === "alerts"
                ? [t("Seus alertas")]
                : view === "settings"
                  ? [t("Meu perfil")]
                  : view === "admin"
                    ? [adminTaskTitle || adminSections[route.section || "health"], t("Administração")]
                    : [t("Página não encontrada")]
    )
      .filter(Boolean)
      .join(" · "),
  );
  const userPhone = shell ? (shell.user.phone_display ?? shell.user.phone) : "";
  // Errors inside an editor appear in its form; the session gate's errors come last.
  const ownToast = notice && !(notice.error && route.editor) ? notice : null;
  const toast = ownToast || (alert ? { message: alert, error: true } : null);
  const atHome = routePath(route) === routePath({ view: "home" });
  return (
    <div
      className={clsx(
        "app-shell",
        route.editor && "editor-mode",
        view === "admin" && "admin-mode",
        pendingBar && "has-pending-bar",
        saveBar && "has-save-bar",
      )}
    >
      <NavigationPrompt />
      <Modal open={discardCreation} onOpenChange={setDiscardCreation} title={t("Descartar rascunho?")} description={t("Somente o preenchimento da nova busca será descartado. Suas viagens salvas serão preservadas.")}>
        <div className="dialog-actions">
          <Button variant="outline" onClick={() => setDiscardCreation(false)}>{t("Continuar preenchendo")}</Button>
          <Button variant="danger" onClick={() => {
            assistantOpening.current.resumed = false;
            setCreationDraft({...blankConfig(), currency: suggestCurrency(shell?.user.country)});
            setCreationProgress({step: 0, leg: "outbound", maxStep: 0});
            setDiscardCreation(false);
            navigate({view: "home", editor: "new", step: 0}, true);
          }}>{t("Descartar rascunho")}</Button>
        </div>
      </Modal>
      <a className="skip-link" href="#main">
        {t("Pular para o conteúdo")}
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href={routePath({ view: "home" })}
          onClick={(e) => plainClick(e) && navigate({ view: "home" })}
          aria-label={t("Radar de Voos, início")}
        >
          <AppIcon />
          <span>{t("Radar de Voos")}</span>
        </a>
        <nav aria-label={t("Navegação principal")}>
          {nav.map((item) => (
            <a
              key={item.id}
              href={routePath({ view: item.id })}
              className={activeView === item.id ? "selected" : undefined}
              data-nav-group={item.id === "settings" || item.id === "admin" ? "account" : "main"}
              aria-current={activeView === item.id ? "page" : undefined}
              onClick={(e) => plainClick(e) && navigate({ view: item.id })}
            >
              <item.icon size={18} aria-hidden="true" />
              <span>{item.label}</span>
              {item.id === "alerts" && alertsBadge("")}
            </a>
          ))}
        </nav>
        {shell ? (
          <SidebarSearches
            searches={shell.searches}
            selectedId={tripPage ? route.searchId : undefined}
            limit={shell.user.search_limit ?? 5}
            pending={new Set(drafts.current.keys())}
            onSelect={(id) => {
              openSearch(id);
              setDirection("outbound");
            }}
            onNew={newSearch}
          />
        ) : (
          <div className="sidebar-searches" aria-hidden="true">
            <span className="skeleton skeleton-line" style={{ width: "70%" }} />
            <span className="skeleton skeleton-line" style={{ width: "86%" }} />
          </div>
        )}
        <div className="sidebar-bottom">
          {shell && (
            <div className="account-card">
              <Avatar name={shell.user.name} />
              <div>
                <strong>{shell.user.name}</strong>
                <span>{userPhone}</span>
              </div>
            </div>
          )}
          <div className="sidebar-meta">
            <QuickPreferences placement="up" />
            <SystemVersion />
          </div>
          <Button variant="ghost" onClick={() => void onLogout()}>
            <LogOut size={16} aria-hidden="true" />
            {t("Sair da conta")}
          </Button>
        </div>
      </aside>
      <header className="mobile-header">
        <a
          className="mobile-brand"
          href={routePath({ view: "home" })}
          onClick={(e) => plainClick(e) && navigate({ view: "home" })}
          aria-label={t("Radar de Voos, início")}
        >
          <AppIcon size="sm" />
          <strong>{t("Radar de Voos")}</strong>
        </a>
        {shell && (
          <ContextMenu
            className="account-menu"
            summaryClassName="mobile-profile"
            summaryLabel={`${t("Conta")}: ${shell.user.name}`}
            label={<Avatar name={shell.user.name} />}
          >
            <div className="menu-account">
              <strong>{shell.user.name}</strong>
              <span>{userPhone}</span>
            </div>
            <div className="menu-separator" />
            <a
              className="menu-item"
              href={routePath({ view: "settings" })}
              onClick={(e) => plainClick(e) && navigate({ view: "settings" })}
            >
              <UserRound size={18} aria-hidden="true" />
              {t("Meu perfil")}
            </a>
            {shell.user.role === "admin" && (
              <a
                className="menu-item"
                href={routePath({ view: "admin", section: "health" })}
                onClick={(e) => plainClick(e) && navigate({ view: "admin", section: "health" })}
              >
                <Shield size={18} aria-hidden="true" />
                {t("Administração")}
              </a>
            )}
            <button type="button" className="menu-item" onClick={() => void onLogout()}>
              <LogOut size={18} aria-hidden="true" />
              {t("Sair da conta")}
            </button>
          </ContextMenu>
        )}
      </header>
      <main id="main" className="main-content" tabIndex={-1}>
        <div className="main-inner">
        <ErrorBoundary
          scope="view"
          resetKey={routePath(route)}
          onHome={atHome ? undefined : () => navigate({ view: "home" })}
        >
        {!data ? (
          query.isError ? (
            <section className="view-error card" role="alert">
              <div className="empty-state">
                <CircleAlert aria-hidden="true" />
                <h2>{t("Não foi possível abrir esta página")}</h2>
                <p>{query.error?.message || t("Tente novamente em instantes.")}</p>
                <div className="view-error-actions">
                  <Button size="large" onClick={() => query.refetch()}>
                    {t("Tentar novamente")}
                  </Button>
                  {!atHome && (
                    <Button variant="ghost" size="large" onClick={() => navigate({ view: "home" })}>
                      {t("Voltar às viagens")}
                    </Button>
                  )}
                </div>
              </div>
            </section>
          ) : (
            <ViewSkeleton />
          )
        ) : (
        <>
        {!route.editor && !adminTask && !(tripPage && search) && (
          <header className="page-heading">
            <div>
              {view === "admin" && (
                // Phones and tablets hide the tab bar in the administration: the way back stays here.
                <a
                  className="page-back"
                  href={routePath({ view: "home" })}
                  onClick={(e) => plainClick(e) && navigate({ view: "home" })}
                >
                  <ChevronLeft size={18} aria-hidden="true" />
                  {t("Voltar às viagens")}
                </a>
              )}
              <h1 tabIndex={-1}>
                {view === "home"
                  ? t("Minhas viagens")
                  : tripPage
                    ? search
                      ? tripTitle(search.config).title
                      : title
                    : view === "history"
                      ? t("Histórico de preços")
                      : view === "alerts"
                        ? t("Seus alertas")
                        : view === "admin"
                          ? t("Administração")
                          : view === "notfound"
                            ? t("Página não encontrada")
                            : t("Meu perfil")}
              </h1>
              <p className="page-subtitle">
                {view === "home"
                  ? t("Suas viagens e oportunidades em um só lugar.")
                  : tripPage
                    ? ""
                    : view === "settings"
                      ? t(
                          "Gerencie seus dados e os contatos que recebem seus alertas.",
                        )
                      : view === "admin"
                        ? adminSubtitles[route.section || "health"]
                        : view === "alerts"
                          ? t("Avisos enviados e variações de preço das suas viagens.")
                          : view === "history"
                            ? t("Veja como os preços das suas viagens mudaram ao longo do tempo.")
                            : ""}
              </p>
            </div>
            {view === "home" && (
              <Button onClick={newSearch}>
                <Plus size={18} aria-hidden="true" />
                <span>{t("Nova viagem")}</span>
              </Button>
            )}
          </header>
        )}
        {route.editor && (
          <section className="search-page" aria-labelledby="editor-title">
            <header className="search-page-heading">
              <Button variant="ghost" className="search-page-back" onClick={closeEditor}>
                {modal === "new" ? (
                  <X size={18} aria-hidden="true" />
                ) : (
                  <ChevronLeft size={20} aria-hidden="true" />
                )}
                <span>{modal === "new" ? t("Fechar") : t("Voltar à viagem")}</span>
              </Button>
              <div className="search-page-title">
                <h1 id="editor-title" tabIndex={-1}>
                  {modal === "new"
                    ? t("Nova viagem")
                    : modal === "alerts"
                      ? t("Alertas desta viagem")
                      : t("Editar viagem")}
                </h1>
                <p>
                  {modal === "new"
                    ? t("Seu preenchimento é mantido ao voltar entre as etapas.")
                    : modal === "alerts"
                      ? t("Defina a meta de preço e como receber as oportunidades.")
                      : t("Revise as alterações antes de salvar.")}
                </p>
              </div>
            </header>
            <div className="search-page-body">
              {/* Errors from saving stay in the page, next to the form. */}
              {notice?.error && (
                <p className="form-error" role="alert">
                  <CircleAlert size={16} aria-hidden="true" />
                  <span>{notice.message}</span>
                </p>
              )}
              {(modal === "new" && creationDraft) || (modal !== "new" && draft) ? (
                // The heading above shows at once; the form's code may still be downloading.
                <Suspense fallback={<FormSkeleton steps={modal !== "alerts"} />}>
                  <Filters
                    key={modal}
                    config={(modal === "new" ? creationDraft : draft)!}
                    setConfig={updateDraft}
                    airports={data.airports}
                    emailRecipients={data.user.emails}
                    emailAvailable={data.email_available}
                    onManageContacts={() => navigate({ view: "settings" })}
                    whatsappAvailable={data.whatsapp_available}
                    whatsappRecipients={whatsappTargets(data.user)}
                    onSaveWhatsapp={saveWhatsapp}
                    defaultCountry={data.user.country}
                    lowest={modal === "new" ? undefined : { outbound: bestOut?.price_cents, inbound: bestIn?.price_cents }}
                    onSave={save}
                    savedCurrency={modal === "new" ? undefined : search?.config.currency}
                    saving={busy}
                    general={modal !== "alerts"}
                    editing={modal === "edit"}
                    alertsOnly={modal === "alerts"}
                    dirty={dirty}
                    draftSaved={modal === "new" && draftHasContent(creationDraft)}
                    journey={
                      modal !== "alerts"
                        ? {
                            step: route.step || 0,
                            direction: route.leg || "outbound",
                            maxStep: modal === "edit" ? 2 : creationProgress.maxStep,
                            onChange: (step, leg) => {
                              if (modal === "new") setCreationProgress((previous) => ({step, leg, maxStep: Math.max(previous.maxStep, step)}));
                              navigate((current) => ({ ...current, step, leg }));
                            },
                          }
                        : undefined
                    }
                  >
                    {modal === "new" && draftResumed && (
                      <div className="search-note draft-notice" role="status">
                        <span>
                          <Save size={16} aria-hidden="true" />
                          {t("Rascunho salvo neste navegador. Você pode continuar de onde parou.")}
                        </span>
                        <Button type="button" variant="ghost" size="small" onClick={() => setDiscardCreation(true)}>
                          {t("Começar do zero")}
                        </Button>
                      </div>
                    )}
                    {modal === "edit" && (
                      <div className="search-note editor-preview">
                        <span>
                          <Eye size={16} aria-hidden="true" />
                          {previewCompatible
                            ? plural(eligibleFlights.length, "{0} opção na prévia", "{0} opções na prévia")
                            : t("Nova coleta após salvar")}
                        </span>
                        <Button type="button" variant="ghost" size="small" onClick={closeEditor}>
                          {t("Ver resultados")}
                        </Button>
                      </div>
                    )}
                    {modal === "alerts" && alertPending && (
                      <p className="search-note is-warning" role="status">
                        <span>
                          <CircleAlert size={16} aria-hidden="true" />
                          {t("Salvar também aplica as alterações pendentes da busca.")}
                        </span>
                      </p>
                    )}
                  </Filters>
                </Suspense>
              ) : (
                <FormSkeleton steps={modal !== "alerts"} />
              )}
            </div>
          </section>
        )}
        {!route.editor && (
          <>
            {view === "notfound" && (
              <section className="card">
                <div className="empty-state">
                  <MapPinOff aria-hidden="true" />
                  <p>{t("Este endereço não está disponível.")}</p>
                  <Button size="large" onClick={() => navigate({ view: "home" })}>
                    {t("Voltar às viagens")}
                  </Button>
                </div>
              </section>
            )}
            {tripPage && search && (<>
                {switchable && (
                  <label className="trip-switcher">
                    <span>{t("Viagem")}</span>
                    <select value={search.id} onChange={(e) => switchTrip(e.target.value)}>
                      {tripChoices}
                    </select>
                  </label>
                )}
                <TripHero
                  search={search}
                  airports={data.airports}
                  routes={data.routes}
                  source={data.source}
                  serverTime={data.server_time}
                  serverNow={serverNow}
                  updatedAt={receivedAt}
                  connectionError={query.isError}
                  ended={tripEnded}
                  busy={busy}
                  onEdit={() => setModal("edit")}
                  onAlerts={configureAlerts}
                  onToggle={() => action(search.active ? "pause" : "resume")}
                  onEnd={() => {
                    setEndError("");
                    setEndTarget(search);
                  }}
                  onDelete={() => askDelete(search)}
                  onRestore={() => restoreOrReuse(search)}
                  listing={view === "searches" && route.panel !== "alerts" && !tripEnded}
                  switcher={switchable ? { value: search.id, onChange: switchTrip, options: tripChoices } : undefined}
                />
                <TripSections
                  searchId={search.id}
                  current={view === "history" ? "history" : route.panel === "alerts" ? "alerts" : "flights"}
                  ended={tripEnded}
                  navigate={navigate}
                />
            </>)}
            {view === "history" && !route.searchId && search && (
              <section className="card history-selector" aria-label={t("Viagem do histórico")}>
                <label className="history-select">
                  <span>{t("Viagem")}</span>
                  <select
                    value={search.id}
                    onChange={(e) => {
                      setSelectedId(e.target.value);
                      setDirection("outbound");
                    }}
                  >
                    <optgroup label={t("Em acompanhamento")}>
                      {data.searches.map((s) => (
                        <option key={s.id} value={s.id}>
                          {tripTitle(s.config).title}
                        </option>
                      ))}
                    </optgroup>
                    {data.archived.length > 0 && (
                      <optgroup label={t("Encerradas")}>
                        {data.archived.map((s) => (
                          <option key={s.id} value={s.id}>
                            {tripTitle(s.config).title}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </label>
                <div className="history-selector-actions">
                  {tripEnded ? (
                    <>
                      <Button variant="outline" size="small" disabled={busy} onClick={() => restoreOrReuse(search)}>
                        {search.ends_at > serverNow ? t("Voltar ao monitoramento") : t("Reutilizar com novas datas")}
                      </Button>
                      <Button variant="danger" size="small" disabled={busy} onClick={() => askDelete(search)}>
                        {t("Excluir")}
                      </Button>
                    </>
                  ) : (
                    <a
                      className="button button-ghost button-small"
                      href={routePath({ view: "searches", searchId: search.id })}
                      onClick={(e) => plainClick(e) && openSearch(search.id)}
                    >
                      {t("Ver voos")}
                      <ChevronRight size={15} aria-hidden="true" />
                    </a>
                  )}
                </div>
              </section>
            )}
            {query.isError && (
              <div role="status" className="banner warning">
                <CircleAlert size={17} />
                {t("Sem conexão. Exibindo a última atualização.")}
              </div>
            )}
            {view === "home" && (
              <>
                <SourceNotice source={data.source} now={serverNow} />
                <Home
                  searches={data.searches}
                  archived={data.archived}
                  airports={data.airports}
                  serverNow={serverNow}
                  onNew={newSearch}
                  onOpen={(id, history) => openSearch(id, history)}
                />
              </>
            )}
            {view === "searches" && search && route.panel === "alerts" && (
              <section className="trip-alerts-panel" aria-labelledby="trip-alerts-panel-title">
                <div className="card-heading">
                  <h2 id="trip-alerts-panel-title">{t("Alertas desta viagem")}</h2>
                  {!tripEnded && (
                    <Button variant="outline" onClick={configureAlerts}>
                      {t("Configurar alertas")}
                    </Button>
                  )}
                </div>
                {data.alerts.length ? (
                  <AlertDays
                    items={data.alerts}
                    now={serverNow}
                    level={3}
                    render={(item) => <AlertRow item={item} onManageContacts={() => navigate({ view: "settings" })} />}
                  />
                ) : (
                  <p className="card card-empty">{t("Nenhum alerta para esta viagem.")}</p>
                )}
              </section>
            )}
            {view === "searches" && search && draft && route.panel !== "alerts" && !tripEnded && (
              <TripFlights
                search={search}
                config={displayConfig!}
                user={data.user}
                flights={flights}
                bestOut={bestOut}
                bestIn={bestIn}
                direction={direction}
                onDirection={setDirection}
                visibleCount={visibleCount}
                onShowMore={() => setVisibleCount((n) => n + 40)}
                previewing={previewing}
                previewCompatible={previewCompatible}
                lastAlert={data.alerts[0]}
                serverNow={serverNow}
                onRefresh={() => perform(() => request(`/searches/${search.id}/action`, { action: "refresh" }), t("Atualização iniciada."))}
                onConfigureAlerts={configureAlerts}
                onShowAlerts={() => navigate({ view: "searches", searchId: search.id, panel: "alerts" })}
                onManageContacts={() => navigate({ view: "settings" })}
                whatsappAvailable={!!data.whatsapp_available}
                emailAvailable={data.email_available}
                whatsappTo={whatsappTargets(data.user)}
                pendingFilters={previewing && filtersLoaded}
                filters={
                  // A form that cannot load fails inside its card: the trip page stays.
                  <ErrorBoundary scope="section" resetKey={search.id + ":" + search.version}>
                    <Suspense fallback={<FormSkeleton compact />}>
                      <Filters
                        key={search.id + ":" + search.version}
                        config={draft}
                        setConfig={updateDraft}
                        airports={data.airports}
                        emailRecipients={data.user.emails}
                        emailAvailable={data.email_available}
                        onManageContacts={() => navigate({ view: "settings" })}
                        whatsappAvailable={data.whatsapp_available}
                        whatsappRecipients={whatsappTargets(data.user)}
                        onSave={save}
                        saving={busy}
                        dirty={dirty}
                      />
                    </Suspense>
                  </ErrorBoundary>
                }
              />
            )}
            {view === "searches" && !search && (
              <Card>
                <div className="empty-state">
                  <PlaneTakeoff aria-hidden="true" />
                  <h2>{t("Vamos acompanhar sua próxima viagem?")}</h2>
                  <p>{t("Escolha aeroportos, uma janela de saída e quanto quer pagar.")}</p>
                  <Button size="large" onClick={newSearch}>
                    <Plus size={20} aria-hidden="true" />
                    {t("Criar primeira busca")}
                  </Button>
                </div>
              </Card>
            )}
            {view === "history" && !search && (
              <section className="card">
                <div className="empty-state">
                  <History aria-hidden="true" />
                  <h2>{t("Seu histórico começa com uma viagem")}</h2>
                  <p>{t("Crie um monitoramento para acompanhar como os preços mudam ao longo do tempo.")}</p>
                  <Button size="large" onClick={newSearch}>
                    <Plus size={20} aria-hidden="true" />
                    {t("Nova viagem")}
                  </Button>
                </div>
              </section>
            )}
            {view === "history" && search && (
              <div className="history-page">
                <PriceChartCard search={search} />
                <PriceVariations history={data.history} />
              </div>
            )}
            {view === "alerts" && (
              <Activity
                searches={[...data.searches, ...data.archived]}
                serverNow={serverNow}
                onOpen={(id, history) => openSearch(id, history || data.archived.some((s) => s.id === id))}
                onManageContacts={() => navigate({ view: "settings" })}
              />
            )}
            {view === "settings" && (
              <Suspense fallback={<ViewSkeleton heading={false} />}>
                <Profile
                  user={data.user}
                  token={data.token}
                  onLogout={onLogout}
                  onSaved={() => queryClient.invalidateQueries({ queryKey: ["radar"] })}
                  onNotice={(message, error) => setNotice({ message, error })}
                  onAdmin={data.user.role === "admin" ? () => navigate({ view: "admin", section: "health" }) : undefined}
                  onDirtyChange={setProfileDirty}
                />
              </Suspense>
            )}
            {view === "admin" && data.user.role !== "admin" && (
              <section className="card">
                <div className="empty-state">
                  <Shield aria-hidden="true" />
                  <p>{t("Esta área é exclusiva de administradores.")}</p>
                  <Button size="large" onClick={() => navigate({ view: "home" })}>
                    {t("Voltar às viagens")}
                  </Button>
                </div>
              </section>
            )}
            {view === "admin" && data.user.role === "admin" && (
              <Suspense
                fallback={
                  adminTask ? (
                    <section className="task-page" aria-labelledby="admin-task-loading">
                      <header className="page-heading">
                        <div>
                          <h1 id="admin-task-loading" tabIndex={-1}>
                            {adminTaskTitle}
                          </h1>
                        </div>
                      </header>
                      <ViewSkeleton heading={false} />
                    </section>
                  ) : (
                    <ViewSkeleton heading={false} />
                  )
                }
              >
              <AdminPanel
                request={request}
                userId={data.user.id}
                route={route}
                navigate={navigate}
                source={data.source}
                serverNow={serverNow}
                whatsappAvailable={!!data.whatsapp_available}
                mail={{
                  google: data.google_mail,
                  smtp: data.smtp,
                  provider: data.mail_provider,
                  available: data.email_available,
                  testRecipient: data.mail_test_recipient || "",
                  defaultEmail: data.smtp?.username?.includes("@")
                    ? data.smtp.username
                    : data.user.emails[0] || "",
                }}
                onChanged={() => queryClient.invalidateQueries({ queryKey: ["radar"] })}
              />
              </Suspense>
            )}
            {search && view === "searches" && (
              <footer className="page-footer">
                <p>{t("Horários no fuso local de cada aeroporto.")}</p>
                {!tripEnded && (
                  <p>
                    {t("Encerramento automático:")} {formatDateTime(search.ends_at)} {t("· fim da última janela de partida.")}
                  </p>
                )}
              </footer>
            )}
            {pendingBar && (
              <aside
                className="pending-bar"
                aria-label={t("Alterações pendentes")}
              >
                <span role="status">
                  <strong>{t("Alterações pendentes")}</strong>{" "}
                  <span className="pending-bar-detail">{t("Salve para atualizar o monitoramento.")}</span>
                </span>
                <div>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={discardDraft}
                  >
                    {t("Descartar")}
                  </Button>
                  <Button form="monitor-filters" type="submit" disabled={busy}>
                    <Save size={16} />
                    {busy ? t("Salvando…") : t("Salvar")}
                  </Button>
                </div>
              </aside>
            )}
          </>
        )}
        </>
        )}
        </ErrorBoundary>
        </div>
      </main>
      <nav className="mobile-nav" aria-label={t("Navegação no celular")}>
        {nav
          .filter((item) => item.id !== "admin")
          .map((item) => (
            <a
              key={item.id}
              href={routePath({ view: item.id })}
              className={activeView === item.id ? "selected" : undefined}
              aria-current={activeView === item.id ? "page" : undefined}
              onClick={(e) => plainClick(e) && navigate({ view: item.id })}
            >
              <item.icon size={24} aria-hidden="true" />
              <span>{item.label}</span>
              {item.id === "alerts" && alertsBadge("tab-count")}
            </a>
          ))}
      </nav>
      {/* The only toast region; its live regions exist before any message. */}
      <div className="toast-region">
        <div className={clsx("toast", !toast && "is-empty", toast?.error && "error")}>
          {toast &&
            (toast.error ? (
              <CircleAlert size={20} aria-hidden="true" />
            ) : (
              <CheckCircle2 size={20} aria-hidden="true" />
            ))}
          <div className="toast-text">
            <p role="status" aria-live="polite" aria-atomic="true">
              {toast && !toast.error ? toast.message : ""}
            </p>
            <p role="alert" aria-live="assertive" aria-atomic="true">
              {toast?.error ? toast.message : ""}
            </p>
          </div>
          {toast && (
            <button
              type="button"
              aria-label={t("Dispensar mensagem")}
              onClick={() => (ownToast ? setNotice(null) : onDismissAlert?.())}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {/* A failed deletion keeps the dialog open and is announced inside it. */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (open) return;
          setDeleteTarget(null);
          setDeleteError("");
        }}
        title={t("Excluir monitoramento?")}
        description={t(
          "A exclusão remove esta busca, preços coletados, histórico e alertas locais. Não pode ser desfeita e não retira e-mails já enviados.",
        )}
        confirmLabel={t("Excluir definitivamente")}
        busy={busy}
        error={deleteError}
        onConfirm={() => {
          if (!deleteTarget) return;
          const target = deleteTarget;
          setDeleteError("");
          void perform(
            async () => {
              await request(`/searches/${target.id}`, {}, "DELETE");
              drafts.current.delete(target.id);
              deletedNotice.current = true;
              setDeleteTarget(null);
              setView("home");
            },
            undefined,
            setDeleteError,
          );
        }}
        onClosed={() => {
          // The toast waits for the dialog to leave, so it is announced.
          if (!deletedNotice.current) return;
          deletedNotice.current = false;
          setNotice({ message: t("Monitoramento excluído."), error: false });
        }}
      >
        <p>
          <strong>{deleteTarget ? tripTitle(deleteTarget.config).title : ""}</strong>
        </p>
      </ConfirmDialog>
      <Modal
        open={!!endTarget}
        onOpenChange={(open) => {
          if (open || busy) return;
          setEndTarget(null);
          setEndError("");
        }}
        title={t("Encerrar monitoramento?")}
        description={t(
          "O radar deixa de consultar preços e de enviar alertas desta viagem. O histórico de preços e os alertas continuam disponíveis, e você pode retomar o monitoramento enquanto as datas da viagem não passarem.",
        )}
      >
        <p>
          <strong>{endTarget ? tripTitle(endTarget.config).title : ""}</strong>
        </p>
        {/* The request runs with the dialog open: a failure is announced here. */}
        <Notice tone="error">{endError}</Notice>
        <div className="dialog-actions">
          <Button variant="outline" disabled={busy} onClick={() => setEndTarget(null)}>
            {t("Continuar monitorando")}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              if (!endTarget) return;
              const target = endTarget;
              setEndError("");
              void perform(
                async () => {
                  await request(`/searches/${target.id}/action`, { action: "archive" });
                  setEndTarget(null);
                  openSearch(target.id, true);
                },
                undefined,
                setEndError,
              );
            }}
          >
            {busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Archive size={16} aria-hidden="true" />}
            {t("Encerrar")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
