import { partyLabel, validParty } from "./passengers";
import { suggestedName, nextTripAction, impossibleReturns } from "./searchJourney";
import { t } from "./i18n";
import { Fragment, lazy, Suspense, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import * as Slider from "@radix-ui/react-slider";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Check,
  CircleAlert,
  LoaderCircle,
  Mail,
  MessageCircle,
  Minus,
  Plus,
  SlidersHorizontal,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { clsx } from "clsx";
import { currencies, currencyLabel } from "./currency";
import { DatePicker } from "./DatePicker";
import { AirlinePicker } from "./AirlinePicker";
import { AirportPicker } from "./AirportPicker";
import { RouteCodes, RoutePlaces } from "./RouteSummary";
import { Button } from "./ui";
import { ChannelSummary, MaskedPhone } from "./AlertChannels";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import type { NumberDraft } from "./WhatsAppNumber";
import { InfoTip } from "./InfoTip";
import { currencySymbol, formatDateTime, formatDuration, formatMoney } from "./format";
import { plainClick, routePath } from "./navigation";
import { legDates } from "./tripSummary";
import type { Config, Leg, State } from "./types";
import "./search-form.css";
// The WhatsApp number field (phone library) downloads only for an account without a number.
const WhatsAppNumber = lazy(() => import("./WhatsAppNumber").then((module) => ({ default: module.WhatsAppNumber })));

type Side = "outbound" | "inbound";
const SIDES: Side[] = ["outbound", "inbound"];
// Departure windows are local wall-clock times: parsed and printed as UTC.
const wall = (s: string) => Date.parse(s + "Z"),
  stamp = (n: number) => new Date(n).toISOString().slice(0, 16);
/** This device's calendar day, "YYYY-MM-DD": no trip can start before it. */
const localDay = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
/** The longest window spans seven calendar dates. */
const MAX_WINDOW = 10079 * 60000;
/** Shown first in the currency list. */
const POPULAR_CURRENCIES = ["BRL", "USD", "EUR"];
const newLeg = (day: string): Leg => ({
  start: day + "T00:00",
  end: day + "T23:59",
  arrival_before: null,
  stops: [0, 1, 2],
  max_duration: null,
  max_layover: null,
  airlines: [],
});
/** Default return: a full day four days after the outbound window ends. */
const returnAfter = (outbound: Leg) =>
  newLeg(stamp(wall(outbound.end) + 4 * 86400000).slice(0, 10));
const badWindow = (leg: Leg) =>
  !leg.start ||
  !leg.end ||
  !Number.isFinite(wall(leg.start)) ||
  !Number.isFinite(wall(leg.end)) ||
  wall(leg.end) <= wall(leg.start) ||
  wall(leg.end) - wall(leg.start) > MAX_WINDOW;
const cabinName = (cabin: string) =>
  ({
    economy: t("Econômica"),
    "premium-economy": t("Econômica premium"),
    business: t("Executiva"),
    first: t("Primeira classe"),
  })[cabin] || cabin;
const stopsName = (stops: number) =>
  stops === 0 ? t("Direto") : stops === 1 ? t("1 escala") : t("2 ou mais");

/** A field that can carry an error, its stage and, for leg settings, its leg. */
type Field =
  | "origins"
  | "destinations"
  | "party"
  | "window"
  | "stops"
  | "target"
  | "min-drop"
  | "currency-review"
  | "channels";
type Problem = { field: Field; step: number; side?: Side; message: string };
const TRIP_FIELDS: Field[] = ["origins", "destinations", "party", "window"];
const ALERT_FIELDS: Field[] = ["target", "min-drop", "currency-review", "channels"];

/** Problems of the trip itself, in the order its fields appear. */
/**
 * Opens every <details> around an element (the trip filters card, "Horários e
 * conexões"), so that a field in a folded section shows its error and can
 * take the focus.
 */
function unfold(element: Element | null | undefined) {
  for (let fold = element?.closest("details"); fold; fold = fold.parentElement?.closest("details")) fold.open = true;
}
function tripProblems(trip: Config, outboundOnly = false): Problem[] {
  const list: Problem[] = [];
  if (!trip.origins.length)
    list.push({ field: "origins", step: 0, message: t("Escolha ao menos um aeroporto de origem.") });
  if (!trip.destinations.length)
    list.push({ field: "destinations", step: 0, message: t("Escolha ao menos um aeroporto de destino.") });
  else if (trip.origins.some((code) => trip.destinations.includes(code)))
    list.push({ field: "destinations", step: 0, message: t("Origem e destino precisam ser aeroportos diferentes.") });
  if (!validParty(trip))
    list.push({ field: "party", step: 0, message: t("Até nove passageiros, com um adulto por bebê no colo.") });
  const window = t("Cada janela deve ser crescente e abranger no máximo sete datas.");
  if (badWindow(trip.outbound)) list.push({ field: "window", step: 0, side: "outbound", message: window });
  if (!outboundOnly && trip.inbound) {
    if (badWindow(trip.inbound)) list.push({ field: "window", step: 0, side: "inbound", message: window });
    else if (trip.inbound.start < trip.outbound.start)
      list.push({ field: "window", step: 0, side: "inbound", message: t("A volta precisa começar após o início da ida.") });
  }
  return list;
}
function stopsProblems(trip: Config): Problem[] {
  return SIDES.filter((side) => trip[side] && !trip[side]!.stops.length).map((side) => ({
    field: "stops" as const,
    step: 1,
    side,
    message: t("Selecione ao menos uma categoria de escalas por trecho."),
  }));
}

function NumberRange({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  format,
  timeInput = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  timeInput?: boolean;
}) {
  const id = useId();
  const text = format ? format(value) : `${value} ${unit}`;
  return (
    <div className={"number-range" + (timeInput ? " time-range" : "")}>
      <div className="range-heading">
        <label htmlFor={id}>{label}</label>
        <strong aria-hidden="true">{text}</strong>
      </div>
      <div className="range-controls">
        <Slider.Root
          className="slider-root"
          min={min}
          max={max}
          step={step}
          value={[value]}
          onValueChange={(v) => onChange(v[0])}
        >
          <Slider.Track className="slider-track">
            <Slider.Range className="slider-range" />
          </Slider.Track>
          <Slider.Thumb className="slider-thumb" aria-label={label} aria-valuetext={text} />
        </Slider.Root>
        {timeInput ? (
          <div className="duration-inputs">
            <label>
              <input
                id={id}
                aria-label={t("{0}: horas", [label])}
                type="number"
                inputMode="numeric"
                required
                min={0}
                max={Math.floor(max / 60)}
                step={1}
                value={Math.floor(value / 60)}
                onChange={(e) => {
                  if (e.target.value)
                    onChange(Math.max(min, Math.min(max, Number(e.target.value) * 60 + (value % 60))));
                }}
              />
              <span aria-hidden="true">h</span>
            </label>
            <label>
              <input
                aria-label={t("{0}: minutos", [label])}
                type="number"
                inputMode="numeric"
                required
                min={0}
                max={59}
                step={1}
                value={value % 60}
                onChange={(e) => {
                  if (e.target.value)
                    onChange(Math.max(min, Math.min(max, Math.floor(value / 60) * 60 + Number(e.target.value))));
                }}
              />
              <span aria-hidden="true">min</span>
            </label>
          </div>
        ) : (
          <div className="number-with-unit">
            <input
              id={id}
              type="number"
              inputMode="numeric"
              required
              min={min}
              max={max}
              step={1}
              value={value}
              onChange={(e) => {
                if (e.target.value) onChange(Number(e.target.value));
              }}
            />
            <span>{unit}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function DepartureWindow({
  leg,
  onChange,
  title,
  onComplete,
  error,
  earliest,
  keepSaved = false,
}: {
  leg: Leg;
  onChange: (v: Partial<Leg>) => void;
  title?: string;
  onComplete?: (leg: Leg) => void;
  error?: string;
  /** First day that can be chosen ("YYYY-MM-DD"). */
  earliest?: string;
  /** Editing a saved trip: its dates stay available even after they pass. */
  keepSaved?: boolean;
}) {
  const id = useId(),
    [bounds, setBounds] = useState({
      start: leg.start.slice(0, 10),
      end: leg.end.slice(0, 10),
    });
  const pending = useRef(leg);
  const changed = useRef(false);
  // The dates this window opened with: a trip in progress keeps its past start.
  const saved = useRef({ start: leg.start.slice(0, 10), end: leg.end.slice(0, 10) });
  pending.current = leg;
  const change = (part: Partial<Leg>) => {
    pending.current = { ...pending.current, ...part };
    changed.current = true;
    onChange(part);
  };
  // Advancing to the return waits for a finished edit: blur, Enter or slider release.
  const complete = () => {
    if (!changed.current) return;
    const value = pending.current;
    if (badWindow(value)) return;
    changed.current = false;
    onComplete?.(value);
  };
  const base = wall(bounds.start + "T00:00"),
    max = Math.max(1439, Math.round((wall(bounds.end + "T23:59") - base) / 60000)),
    values = [
      Math.max(0, Math.round((wall(leg.start) - base) / 60000)),
      Math.max(1, Math.round((wall(leg.end) - base) / 60000)),
    ];
  const label = (m: number) => formatDateTime(stamp(base + m * 60000), "numeric");
  const errorId = id + "-error";
  return (
    <fieldset
      className="departure-window list-section"
      data-field="window"
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="list-section-title">{title || t("Quando você pode sair?")}</legend>
      <div className={clsx("list-group window-group", error && "is-invalid")}>
        {(["start", "end"] as const).map((key, i) => (
          <div className="window-row" key={key}>
            <label className="window-label" htmlFor={id + key}>
              {i ? t("Até") : t("A partir de")}
            </label>
            <div className="window-date">
              <DatePicker
                id={id + key}
                label={i ? t("Até") : t("A partir de")}
                min={earliest}
                allowed={keepSaved ? saved.current[key] : undefined}
                value={leg[key].slice(0, 10)}
                onChange={(value) => {
                  if (value) {
                    const next = value + "T" + leg[key].slice(11, 16);
                    if (key === "start" && wall(next) >= wall(leg.end)) {
                      const end = stamp(wall(leg.end) + wall(next) - wall(leg.start));
                      setBounds({ start: value, end: end.slice(0, 10) });
                      change({ start: next, end });
                    } else {
                      setBounds({ ...bounds, [key]: value });
                      change({ [key]: next });
                    }
                  }
                }}
              />
            </div>
            <input
              className="window-time"
              aria-label={i ? t("Horário limite de saída") : t("Horário inicial de saída")}
              type="time"
              onBlur={key === "end" ? complete : undefined}
              onKeyDown={(e) => {
                if (key === "end" && e.key === "Enter" && onComplete) {
                  e.preventDefault();
                  complete();
                }
              }}
              required
              value={leg[key].slice(11, 16)}
              onChange={(e) => {
                if (e.target.value)
                  change({
                    [key]: leg[key].slice(0, 10) + "T" + e.target.value,
                  });
              }}
            />
          </div>
        ))}
        {values[1] > values[0] && max <= 10079 && (
          <div className="window-slider-row">
            <Slider.Root
              className="slider-root window-slider"
              min={0}
              max={max}
              step={1}
              minStepsBetweenThumbs={1}
              value={values}
              onValueCommit={complete}
              onValueChange={(v) =>
                change({
                  start: stamp(base + v[0] * 60000),
                  end: stamp(base + v[1] * 60000),
                })
              }
            >
              <Slider.Track className="slider-track">
                <Slider.Range className="slider-range" />
              </Slider.Track>
              <Slider.Thumb
                className="slider-thumb"
                aria-label={t("Início da janela de saída")}
                aria-valuetext={label(values[0])}
              />
              <Slider.Thumb
                className="slider-thumb"
                aria-label={t("Fim da janela de saída")}
                aria-valuetext={label(values[1])}
              />
            </Slider.Root>
            <div className="window-labels" aria-hidden="true">
              <span>{label(values[0])}</span>
              <span>{label(values[1])}</span>
            </div>
          </div>
        )}
      </div>
      <p className="list-section-footer">
        {t("Datas e horários locais de cada aeroporto de partida.")}{" "}
        {t("Para atravessar a meia-noite, escolha o dia seguinte em “Até”. Máximo de sete datas.")}
      </p>
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </fieldset>
  );
}

function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p className="field-error" id={id}>
      <CircleAlert size={14} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** − n + stepper in a list row, labelled for assistive technology. */
function Counter({
  label,
  value,
  canDecrease,
  canIncrease,
  decreaseLabel,
  increaseLabel,
  onChange,
}: {
  label: string;
  value: number;
  canDecrease: boolean;
  canIncrease: boolean;
  decreaseLabel: string;
  increaseLabel: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  // aria-disabled keeps the focus on a button that reaches its limit.
  return (
    <div className="list-row counter-row">
      <span className="list-row-label" id={id}>
        {label}
      </span>
      <div className="counter" role="group" aria-labelledby={id}>
        <output className="counter-value">{value}</output>
        <span className="counter-buttons">
          <button
            type="button"
            className="counter-button"
            aria-label={decreaseLabel}
            aria-disabled={!canDecrease || undefined}
            onClick={() => canDecrease && onChange(value - 1)}
          >
            <Minus size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="counter-button"
            aria-label={increaseLabel}
            aria-disabled={!canIncrease || undefined}
            onClick={() => canIncrease && onChange(value + 1)}
          >
            <Plus size={18} aria-hidden="true" />
          </button>
        </span>
      </div>
    </div>
  );
}

/** Amount field with the currency sign as a prefix. Values travel in cents. */
function MoneyField({
  anchor,
  field,
  label,
  currency,
  cents,
  required = false,
  placeholder,
  error,
  describedBy,
  onChange,
}: {
  /** Target of the error summary links. */
  anchor: string;
  field: Field;
  label: string;
  currency: string;
  cents: number | null;
  required?: boolean;
  placeholder?: string;
  error?: string;
  describedBy: string;
  onChange: (cents: number | null) => void;
}) {
  const id = useId();
  return (
    <div className="field money" id={anchor} data-field={field}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className={clsx("field-frame money-field", error && "is-invalid")}>
        <span className="money-prefix" aria-hidden="true">
          {currencySymbol(currency)}
        </span>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={1}
          step="0.01"
          required={required}
          placeholder={placeholder}
          aria-invalid={!!error || undefined}
          aria-describedby={clsx(error && id + "-error", describedBy)}
          value={cents == null ? "" : cents / 100}
          onChange={(e) =>
            onChange(e.target.value === "" ? null : Math.round(Number(e.target.value) * 100))
          }
        />
      </div>
      {error && <FieldError id={id + "-error"}>{error}</FieldError>}
    </div>
  );
}

/**
 * One alert channel: icon, name, switch and the destination in small text. The name and the
 * destination toggle the switch too, a touch target as tall as the row.
 */
function ChannelRow({
  icon: Icon,
  label,
  detail,
  checked,
  disabled,
  invalid,
  action,
  onChange,
}: {
  icon: LucideIcon;
  label: string;
  detail: ReactNode;
  checked: boolean;
  disabled: boolean;
  invalid: boolean;
  /** Shown under the row: a link to the profile or the number field. */
  action?: ReactNode;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className={clsx("list-row channel-row", disabled && "is-disabled", invalid && "is-invalid")}>
      <span className="channel-icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <label className="channel-text" htmlFor={id}>
        <span className="channel-name" id={id + "-name"}>
          {label}
        </span>
        <small id={id + "-detail"}>{detail}</small>
      </label>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="switch"
        checked={checked}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-labelledby={id + "-name"}
        aria-describedby={id + "-detail"}
        onChange={(e) => onChange(e.target.checked)}
      />
      {action && <div className="channel-extra">{action}</div>}
    </div>
  );
}

type Props = {
  config: Config;
  setConfig: (v: Config) => void;
  airports: State["airports"];
  /** numberSaved: the WhatsApp number typed in the review went to the profile just before. */
  onSave: (submitted?: Config, currencyReviewed?: boolean, numberSaved?: boolean) => void;
  savedCurrency?: string;
  saving: boolean;
  general?: boolean;
  editing?: boolean;
  dirty?: boolean;
  emailRecipients?: string[];
  emailAvailable?: boolean;
  onManageContacts?: () => void;
  alertsOnly?: boolean;
  whatsappAvailable?: boolean;
  whatsappRecipients?: string[];
  /** Saves a WhatsApp number typed in the review to the profile (accounts without one). */
  onSaveWhatsapp?: (country: string, phone: string) => Promise<void>;
  /** The account's country, the starting country of that number. */
  defaultCountry?: string;
  /** Lowest fare collected now, per leg, shown under the target (alert settings of a saved trip). */
  lowest?: { outbound?: number; inbound?: number };
  journey?: {
    maxStep?: number;
    step: number;
    direction: "outbound" | "inbound";
    onChange: (step: number, direction: "outbound" | "inbound") => void;
  };
  /** Notes shown under the stepper (draft, preview), provided by the page. */
  children?: ReactNode;
  /** The page keeps this draft in the browser: the action bar says so, without moving the form. */
  draftSaved?: boolean;
};
/**
 * The trip form in three modes: the assistant (general: Viagem, Preferências,
 * Revisão e alertas, also for editing), the trip filters (compact, saved by the
 * page's pending bar) and the alert settings (alertsOnly).
 */
export function SearchForm({
  config,
  setConfig,
  airports,
  onSave,
  savedCurrency,
  saving,
  general = false,
  editing = false,
  emailRecipients = [],
  emailAvailable = true,
  onManageContacts,
  alertsOnly = false,
  whatsappAvailable = false,
  whatsappRecipients = [],
  onSaveWhatsapp,
  defaultCountry = "BR",
  lowest,
  journey,
  children,
  draftSaved = false,
}: Props) {
  const baggageId = useId();
  const errorId = useId();
  // Hook order matters to the tests: direction, step and error come first.
  // A return that is not the default after the outbound was chosen (a restored draft): never moved silently.
  const returnTouched = useRef(
    !!config.inbound &&
      (config.inbound.start !== returnAfter(config.outbound).start || config.inbound.end !== returnAfter(config.outbound).end),
  );
  const [localDirection, setLocalDirection] = useState<Side>("outbound"),
    [localStep, setLocalStep] = useState(editing ? 1 : 0),
    [error, setError] = useState(""),
    form = useRef<HTMLFormElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const autoAdvanced = useRef(false);
  const [currencyNeedsReview, setCurrencyNeedsReview] = useState(
    Boolean(savedCurrency && savedCurrency !== config.currency),
  );
  const uid = useId();
  // The WhatsApp number typed in the review (accounts without one): kept across stages, saved on creation.
  const [number, setNumber] = useState<NumberDraft>({ country: defaultCountry, phone: "", error: "", busy: false });
  const ids = {
    tripType: uid + "-type",
    passengers: uid + "-party-title",
    cabin: uid + "-cabin",
    currency: uid + "-currency",
    tabs: uid + "-leg",
    panel: uid + "-panel",
    name: uid + "-name",
    values: uid + "-values",
    arrival: uid + "-arrival",
  };
  const emailReady = emailAvailable && emailRecipients.length > 0;
  const whatsappReady = whatsappAvailable && whatsappRecipients.length > 0;
  // A new trip starts with WhatsApp on (as the API does) only where WhatsApp can send. Without a
  // number it is created without WhatsApp; a saved trip keeps its choice until changed here.
  const creating = general && !editing;
  const whatsappOn = !!config.notify_whatsapp && (whatsappAvailable || !creating);
  const maxStep = editing ? 2 : Math.max(journey?.maxStep || 0, journey?.step || 0);
  const direction = journey?.direction || localDirection,
    step = journey?.step ?? localStep;
  const go = (nextStep: number, nextDirection: Side = direction) => {
    if (journey) journey.onChange(nextStep, nextDirection);
    else {
      setLocalStep(nextStep);
      setLocalDirection(nextDirection);
    }
  };
  const setStep = (next: number) => go(next);
  const setDirection = (next: Side) => go(step, next);
  const legDirection: Side = config.inbound ? direction : "outbound";
  const leg =
    (legDirection === "inbound" ? config.inbound : config.outbound) ||
    config.outbound;
  const patch = (part: Partial<Leg>) => {
      if (legDirection === "inbound") returnTouched.current = true;
      setConfig({ ...config, [legDirection]: { ...leg, ...part } });
    },
    global = (part: Partial<Config>) => setConfig({ ...config, ...part });
  const currency = config.currency || "BRL";

  // ---- Validation: errors next to the fields, summarized when there are several.
  const alertProblems = (): Problem[] => {
    const list: Problem[] = [];
    const least = t("Informe um valor de pelo menos {0}.", [formatMoney(100, currency)]);
    if (config.target_cents != null && !(config.target_cents >= 100))
      list.push({ field: "target", step: 2, message: least });
    if (!(config.min_drop_cents >= 100)) list.push({ field: "min-drop", step: 2, message: least });
    if (currencyNeedsReview)
      list.push({ field: "currency-review", step: 2, message: t("Revise os valores de alerta após trocar a moeda.") });
    if ((config.notify_email && !emailReady) || (config.notify_whatsapp && !whatsappReady && !creating))
      list.push({
        field: "channels",
        step: 2,
        message: t("Selecione um canal disponível com destinatário cadastrado, ou desative os alertas."),
      });
    return list;
  };
  const allProblems = () => [
    ...tripProblems(config),
    ...stopsProblems(config),
    ...(general || alertsOnly ? alertProblems() : []),
  ];
  /** Fields this form shows at a stage. */
  const fieldsAt = (at: number): Field[] =>
    alertsOnly ? ALERT_FIELDS : !general ? ["window", "stops"] : at === 0 ? TRIP_FIELDS : at === 1 ? ["stops"] : ALERT_FIELDS;
  const shows = (problem: Problem, at: number, side: Side) =>
    fieldsAt(at).includes(problem.field) && (!problem.side || problem.side === side);
  // After a failed attempt, the errors follow the fields live until fixed.
  const live = error ? allProblems() : [];
  const visible = live.filter((problem) => shows(problem, step, legDirection));
  // The filters and the alert settings cannot show trip fields: their problems
  // are listed as text. The assistant moves to the stage that shows them.
  const offscreen = !general && !visible.length ? live.map((problem) => problem.message).join(" ") : "";
  const problemOf = (field: Field) => visible.find((problem) => problem.field === field)?.message;
  function focusField(field: Field) {
    // The first usable control of the field, in document order, out of any folded section.
    const box = `[data-field="${field}"]`;
    const control = form.current?.querySelector<HTMLElement>(
      `${box} input:not([disabled]), ${box} select:not([disabled]), ${box} button:not([disabled]), ${box} a[href]`,
    );
    unfold(control);
    control?.focus();
  }
  /** The browser's own check, after unfolding the section of the first invalid field so it can be shown. */
  function validate() {
    const root = form.current;
    if (!root) return false;
    unfold(root.querySelector("input:invalid, select:invalid, textarea:invalid"));
    return root.reportValidity();
  }
  /** Focuses the first usable control after the element with this id, as Tab would. */
  function focusAfter(id: string) {
    const root = form.current,
      anchor = root?.querySelector(`[id="${id}"]`);
    if (!root || !anchor) return;
    const controls = root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary',
    );
    for (const control of Array.from(controls)) {
      if (anchor.contains(control) || !(anchor.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      control.focus();
      if (document.activeElement === control) return;
    }
  }
  function report(list: Problem[]) {
    let here = list.filter((problem) => shows(problem, step, legDirection));
    if (!here.length && general && !alertsOnly && list.length) {
      // The first problem is on another stage or leg: show it there.
      const first = [...list].sort((a, b) => a.step - b.step)[0];
      const side = first.side || (first.step === step ? legDirection : "outbound");
      go(first.step, side);
      here = list.filter((problem) => shows(problem, first.step, side));
    }
    setError(list.map((problem) => problem.message).join(" "));
    requestAnimationFrame(() => {
      const root = form.current;
      if (!root) return;
      // The errors show next to their fields: folded sections around them open
      // (a collapsed trip filters card, "Horários e conexões").
      for (const problem of here) unfold(root.querySelector(`[data-field="${problem.field}"]`));
      if (here.length === 1) focusField(here[0].field);
      else {
        const summary = root.querySelector<HTMLElement>("[data-form-error]");
        unfold(summary);
        summary?.focus();
      }
    });
  }
  const focusHeading = () => requestAnimationFrame(() => heading.current?.focus());
  const focusReturnDate = (preventScroll = false) =>
    requestAnimationFrame(() =>
      form.current
        ?.querySelector<HTMLInputElement>(".departure-window [data-date-trigger]")
        ?.focus({ preventScroll }),
    );

  // ---- Stages
  function completeOutbound(outbound: Leg) {
    if (
      !general ||
      maxStep >= 1 ||
      editing ||
      step !== 0 ||
      legDirection !== "outbound" ||
      !config.inbound ||
      autoAdvanced.current
    )
      return;
    if (!validate()) return;
    const next = { ...config, outbound };
    const list = tripProblems(next, true);
    if (list.length) return report(list);
    if (next.inbound!.start.slice(0, 10) < outbound.end.slice(0, 10) && !returnTouched.current) next.inbound = returnAfter(outbound);
    setConfig(next);
    autoAdvanced.current = true;
    setDirection("inbound");
    setError("");
    focusReturnDate(true);
  }
  function move(next: number) {
    if (
      next > step &&
      step === 0 &&
      maxStep < 1 &&
      !editing &&
      nextTripAction(!!config.inbound, legDirection) === "return"
    ) {
      // First pass of a round trip: the return window comes before the preferences.
      const list = tripProblems(config, true);
      if (list.length) return report(list);
      if (!validate()) return;
      // An untouched return starting before the outbound window ends moves after it.
      if (config.inbound && config.inbound.start.slice(0, 10) < config.outbound.end.slice(0, 10) && !returnTouched.current)
        global({ inbound: returnAfter(config.outbound) });
      autoAdvanced.current = true;
      setDirection("inbound");
      setError("");
      focusReturnDate();
      return;
    }
    if (next > step) {
      const list = [...tripProblems(config), ...(next > 1 ? stopsProblems(config) : [])];
      if (list.length) return report(list);
      if (!validate()) return;
    }
    if (next > step && step === 1 && maxStep < 2 && !editing && config.inbound && legDirection === "outbound") {
      setDirection("inbound");
      setError("");
      focusHeading();
      return;
    }
    setError("");
    go(next, next === 1 ? "outbound" : direction);
    focusHeading();
  }
  const setTripType = (round: boolean) => {
    if (round === !!config.inbound) return;
    global({ inbound: round ? returnAfter(config.outbound) : null });
    setDirection("outbound");
    returnTouched.current = false;
    autoAdvanced.current = false;
  };

  // ---- Shared pieces
  const tabKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const target: Side | null =
      event.key === "ArrowRight" || event.key === "ArrowLeft"
        ? legDirection === "outbound"
          ? "inbound"
          : "outbound"
        : event.key === "Home"
          ? "outbound"
          : event.key === "End"
            ? "inbound"
            : null;
    if (!target) return;
    event.preventDefault();
    setDirection(target);
    requestAnimationFrame(() =>
      form.current?.querySelector<HTMLElement>(`[data-leg-tab="${target}"]`)?.focus(),
    );
  };
  // Ida | Volta switches the leg panel: ARIA tabs with arrow keys.
  const legTabs = config.inbound ? (
    <div
      className="segmented segmented-fill leg-tabs"
      role="tablist"
      aria-label={t("Trecho a configurar")}
      onKeyDown={tabKeys}
    >
      {SIDES.map((side) => (
        <button
          key={side}
          type="button"
          role="tab"
          id={`${ids.tabs}-${side}`}
          data-leg-tab={side}
          aria-selected={legDirection === side}
          aria-controls={ids.panel}
          tabIndex={legDirection === side ? 0 : -1}
          onClick={() => setDirection(side)}
        >
          {side === "outbound" ? t("Ida") : t("Volta")}
          <span className="leg-tab-dates">{legDates(config[side]!, true)}</span>
        </button>
      ))}
    </div>
  ) : null;
  const panel = config.inbound
    ? { role: "tabpanel", id: ids.panel, "aria-labelledby": `${ids.tabs}-${legDirection}` }
    : {};
  const baggage = (
    <fieldset className="baggage-field list-section">
      <legend>{t("Bagagem despachada")}</legend>
      <div className="list-group">
        <div className="list-row select-row">
          <label htmlFor={baggageId} className="sr-only">
            {t("Taxas a incluir na pesquisa")}
          </label>
          <select
            id={baggageId}
            className="row-select"
            aria-describedby={baggageId + "-help"}
            value={config.checked_bags || 0}
            onChange={(e) => global({ checked_bags: Number(e.target.value) })}
          >
            <option value={0}>{t("Não adicionar taxas de bagagem")}</option>
            <option value={1}>{t("Incluir 1 mala despachada")}</option>
            <option value={2}>{t("Incluir 2 malas despachadas")}</option>
          </select>
        </div>
      </div>
      <p id={baggageId + "-help"} className="list-section-footer">
        {t("Taxas estimadas nos dois trechos; franquia e peso a confirmar.")}
      </p>
    </fieldset>
  );
  const connections = (
    <div className="list-group connections-group">
      <div className="list-row field-row arrival-setting">
        <label className="field-label" htmlFor={ids.arrival}>
          {t("Chegar até (opcional)")}
        </label>
        <input
          id={ids.arrival}
          type="datetime-local"
          aria-describedby={ids.arrival + "-help"}
          value={leg.arrival_before || ""}
          onChange={(e) => patch({ arrival_before: e.target.value || null })}
        />
        <p className="field-help" id={ids.arrival + "-help"}>
          {t("Horário local do destino.")}
        </p>
      </div>
      <label className="list-row switch-row layover-toggle">
        <span>{t("Limitar espera por conexão")}</span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={leg.max_layover !== null}
          onChange={(e) => patch({ max_layover: e.target.checked ? 180 : null })}
        />
      </label>
      {leg.max_layover !== null && (
        <div className="list-row range-row">
          <NumberRange
            timeInput
            label={t("Máximo por conexão")}
            value={leg.max_layover}
            min={30}
            max={1440}
            step={15}
            unit="min"
            format={formatDuration}
            onChange={(v) => patch({ max_layover: v })}
          />
        </div>
      )}
    </div>
  );
  const stopsError = problemOf("stops");
  const preferences = (
    <div className="preference-sheet">
      <fieldset
        className="stops-field"
        id={`${uid}-stops`}
        data-field="stops"
        aria-describedby={stopsError ? errorId + "-stops" : undefined}
      >
        <legend className="field-label">{t("Escalas permitidas")}</legend>
        <div className="chip-group">
          {[0, 1, 2].map((value) => {
            const checked = leg.stops.includes(value);
            return (
              <label className={clsx("chip stop-choice", checked && "is-checked")} key={value}>
                <input
                  type="checkbox"
                  checked={checked}
                  aria-invalid={!!stopsError || undefined}
                  onChange={(e) =>
                    patch({
                      stops: e.target.checked
                        ? [...leg.stops, value].sort()
                        : leg.stops.filter((v) => v !== value),
                    })
                  }
                />
                {stopsName(value)}
              </label>
            );
          })}
        </div>
        {stopsError && <FieldError id={errorId + "-stops"}>{stopsError}</FieldError>}
      </fieldset>
      <div className="list-section duration-field">
        <div className="list-group">
          <label className="list-row switch-row duration-toggle">
            <span>{t("Limitar duração da viagem")}</span>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={leg.max_duration != null}
              onChange={(e) => patch({ max_duration: e.target.checked ? 2880 : null })}
            />
          </label>
          {leg.max_duration != null && (
            <div className="list-row range-row">
              <NumberRange
                timeInput
                label={t("Duração máxima da viagem")}
                value={leg.max_duration}
                min={60}
                max={2880}
                step={30}
                unit="min"
                format={formatDuration}
                onChange={(v) => patch({ max_duration: v })}
              />
            </div>
          )}
        </div>
        <p className="list-section-footer">
          {leg.max_duration == null
            ? t("Sem limite de duração, incluindo conexões.")
            : t("Inclui os voos e a espera nas conexões.")}
        </p>
      </div>
      <AirlinePicker key={legDirection} values={leg.airlines} onChange={(airlines) => patch({ airlines })} />
      {baggage}
      {general && (
        <details className="advanced-options">
          <summary>
            <SlidersHorizontal size={18} aria-hidden="true" />
            <span>{t("Chegada e conexões")}</span>
          </summary>
          {connections}
        </details>
      )}
    </div>
  );
  const contactLink = onManageContacts && (
    <a
      className="button button-outline button-small channel-action"
      href={routePath({ view: "settings" })}
      onClick={(event) => plainClick(event) && onManageContacts()}
    >
      <UserRound size={14} aria-hidden="true" />
      {t("Configurar contato")}
    </a>
  );
  // Every number in international format (the extra ones come raw), once, then masked.
  const international = (phone: string, country?: string) =>
    parsePhoneNumberFromString(phone, country as CountryCode)?.formatInternational() || phone;
  const whatsappTo = [...new Set(whatsappRecipients.map((phone) => international(phone)))];
  const asksNumber = !!onSaveWhatsapp && whatsappAvailable && !whatsappTo.length;
  const numberValid = !!parsePhoneNumberFromString(number.phone, number.country as CountryCode)?.isPossible();
  // A number typed and not saved yet, that creating this trip with WhatsApp would save.
  const typedNumber = creating && whatsappOn && asksNumber && !!number.phone;
  const focusNumber = () =>
    requestAnimationFrame(() => form.current?.querySelector<HTMLInputElement>('.whatsapp-inline input[type="tel"]')?.focus());
  /** Saves the typed number to the profile; false, with the error at the field, when it cannot. */
  async function saveNumber() {
    if (!numberValid) {
      setNumber({ ...number, error: t("Confira o código de área e a quantidade de dígitos para o país selecionado.") });
      focusNumber();
      return false;
    }
    setNumber({ ...number, busy: true, error: "" });
    try {
      await onSaveWhatsapp!(number.country, number.phone);
      setNumber((current) => ({ ...current, phone: "", busy: false }));
      return true;
    } catch (failure) {
      setNumber((current) => ({ ...current, busy: false, error: (failure as Error).message }));
      focusNumber();
      return false;
    }
  }
  const channelsError = problemOf("channels");
  const alerts = (
    <>
      <section className="alert-values" aria-labelledby={ids.values}>
        <h3 className="sr-only" id={ids.values}>
          {t("Meta e queda mínima")}
        </h3>
        <div className="two-fields">
          <MoneyField
            anchor={`${uid}-target`}
            field="target"
            label={t("Meta por trecho")}
            currency={currency}
            cents={config.target_cents}
            placeholder={t("Opcional")}
            error={problemOf("target")}
            describedBy={ids.values + "-help" + (lowest ? " " + ids.values + "-now" : "")}
            onChange={(target_cents) => global({ target_cents })}
          />
          <MoneyField
            anchor={`${uid}-min-drop`}
            field="min-drop"
            label={t("Queda mínima")}
            currency={currency}
            cents={config.min_drop_cents}
            required
            error={problemOf("min-drop")}
            describedBy={ids.values + "-help"}
            onChange={(cents) => global({ min_drop_cents: cents ?? 0 })}
          />
        </div>
        <p className="field-help" id={ids.values + "-help"}>
          {t("Valores em {0}. Altere a moeda na etapa Viagem.", [currency])}{" "}
          {t("Preço total para {0}, por trecho.", [partyLabel(config)])}
        </p>
        {lowest && (lowest.outbound != null || lowest.inbound != null) && (
          <p className="field-help lowest-now" id={ids.values + "-now"}>
            {t("Menor preço agora: {0}", [
              config.inbound
                ? [
                    lowest.outbound != null && `${t("Ida")} ${formatMoney(lowest.outbound, currency)}`,
                    lowest.inbound != null && `${t("Volta")} ${formatMoney(lowest.inbound, currency)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : formatMoney(lowest.outbound ?? lowest.inbound, currency),
            ])}
          </p>
        )}
        {currencyNeedsReview && (
          <div className="currency-review" id={`${uid}-currency-review`} data-field="currency-review">
            <label className="check-row">
              <input
                type="checkbox"
                required
                checked={false}
                aria-invalid={!!problemOf("currency-review") || undefined}
                onChange={() => setCurrencyNeedsReview(false)}
              />
              {t("Revisei os valores de alerta na nova moeda.")}
            </label>
            {problemOf("currency-review") && <FieldError>{problemOf("currency-review")}</FieldError>}
          </div>
        )}
      </section>
      <div className="list-section channels-field">
        <div className="list-section-head">
          <span className="list-section-title" id={`${uid}-channels-title`}>
            {t("Enviar alertas")}
          </span>
          <InfoTip label={t("Sobre os canais de alerta")}>
            <p>{t("Marque um ou mais canais. Os destinos vêm de Meu perfil.")}</p>
            {(!emailAvailable || !whatsappAvailable) && <p>{t("Canal indisponível depende da administração.")}</p>}
          </InfoTip>
        </div>
        <ChannelSummary
          whatsapp={whatsappOn && whatsappAvailable ? (typedNumber && numberValid ? [international(number.phone, number.country)] : whatsappTo) : []}
          email={config.notify_email && emailAvailable ? emailRecipients : []}
        />
        <div id={`${uid}-channels`} data-field="channels" className="channels-rows">
          <div role="group" aria-labelledby={`${uid}-channels-title`} className={clsx("list-group", channelsError && "is-invalid")}>
            <ChannelRow
              icon={MessageCircle}
              label={t("WhatsApp")}
              detail={
                !whatsappAvailable
                  ? t("Indisponível")
                  : whatsappTo.length
                    ? whatsappTo.map((phone, i) => (
                        <Fragment key={phone}>
                          {i > 0 && ", "}
                          <MaskedPhone phone={phone} />
                        </Fragment>
                      ))
                    : t("Sem número no perfil")
              }
              checked={whatsappOn}
              disabled={!whatsappAvailable && !whatsappOn}
              invalid={whatsappOn && !whatsappReady && !creating}
              action={
                whatsappAvailable && !whatsappTo.length
                  ? asksNumber
                    ? whatsappOn && (
                        <Suspense fallback={null}>
                          <WhatsAppNumber value={number} onChange={setNumber} onSave={() => void saveNumber()} />
                        </Suspense>
                      )
                    : contactLink
                  : undefined
              }
              onChange={(notify_whatsapp) => global({ notify_whatsapp })}
            />
            <ChannelRow
              icon={Mail}
              label={t("E-mail")}
              detail={
                !emailAvailable
                  ? t("Indisponível")
                  : emailRecipients.length
                    ? emailRecipients.join(", ")
                    : t("Sem e-mail no perfil")
              }
              checked={config.notify_email}
              disabled={!emailReady && !config.notify_email}
              invalid={config.notify_email && !emailReady}
              action={emailAvailable && !emailRecipients.length ? contactLink : undefined}
              onChange={(notify_email) => global({ notify_email })}
            />
          </div>
          {channelsError && <FieldError>{channelsError}</FieldError>}
        </div>
      </div>
    </>
  );

  // Return dates earlier than outbound dates: each leg is still searched, but those pairs are no trip.
  const returns = impossibleReturns(config);
  const returnWarning = returns.impossible > 0 && (
    <p className="return-warning" role="status">
      <CircleAlert size={16} aria-hidden="true" />
      <span>
        {t("Em {0} de {1} combinações de datas, a volta é antes da ida.", [returns.impossible, returns.total])}
      </span>
    </p>
  );

  // ---- Assistant chrome
  const stages = [t("Viagem"), t("Preferências"), t("Revisão e alertas")];
  const titles = [
    t("Sua próxima viagem"),
    t("O que faz um voo servir para você?"),
    t("Revise sua viagem e escolha os alertas"),
  ];
  const subtitles = [
    t("Escolha de onde sair e para onde ir. Você pode adicionar outros aeroportos se quiser."),
    t("Escalas, duração, companhias e bagagem de cada trecho."),
    t("Defina a meta de preço e como receber as oportunidades."),
  ];
  const toReturn = step <= 1 && !!config.inbound && legDirection === "outbound";
  const advancing = general && !editing && step < 2;
  const primary = saving
    ? t("Salvando…")
    : alertsOnly
      ? t("Salvar alertas")
      : editing
        ? t("Salvar alterações")
        : step < 2
          ? toReturn
            ? t("Continuar para a volta")
            : t("Continuar")
          : t("Criar monitoramento");
  const back =
    general && !editing && (step > 0 || legDirection === "inbound")
      ? () => (step <= 1 && legDirection === "inbound" ? setDirection("outbound") : move(step - 1))
      : undefined;
  const infants = (config.infants_in_seat || 0) + (config.infants_on_lap || 0);
  type PartyKey = "adults" | "children" | "infants_in_seat" | "infants_on_lap";
  const partyValue = (key: PartyKey) => config[key] || 0;
  const allowed = (key: PartyKey, n: number) =>
    n >= (key === "adults" ? 1 : 0) && validParty({ ...config, [key]: n });
  const counter = (key: PartyKey, label: string, decrease: string, increase: string) => (
    <Counter
      label={label}
      value={partyValue(key)}
      canDecrease={allowed(key, partyValue(key) - 1)}
      canIncrease={allowed(key, partyValue(key) + 1)}
      decreaseLabel={decrease}
      increaseLabel={increase}
      onChange={(n) => global({ [key]: n })}
    />
  );
  const today = localDay();
  const popular = POPULAR_CURRENCIES.filter((code) => currencies.includes(code));
  const others = currencies.filter((code) => !POPULAR_CURRENCIES.includes(code)).sort();
  const partyError = problemOf("party");
  return (
    <form
      id={!general && !alertsOnly ? "monitor-filters" : undefined}
      ref={form}
      noValidate
      className={clsx(
        "filter-form",
        alertsOnly ? "alert-settings-form" : general ? clsx("search-wizard", editing && "compact-editor") : "compact-filters",
      )}
      onSubmit={(e) => {
        e.preventDefault();
        if (general && !editing && step < 2) {
          move(step + 1);
          return;
        }
        const list = allProblems();
        if (list.length) {
          report(list);
          return;
        }
        if (!validate()) return;
        const submitted = {
          ...config,
          name: config.name.trim() || suggestedName(config),
          ...(creating && { notify_whatsapp: whatsappOn && whatsappReady }),
        };
        // A typed number goes to the profile first; an invalid one stops here, next to its field.
        if (!typedNumber) onSave(submitted, general && !currencyNeedsReview);
        else
          void saveNumber().then(
            (ok) => ok && onSave({ ...submitted, notify_whatsapp: true }, general && !currencyNeedsReview, true),
          );
      }}
    >
      {general && !alertsOnly && (
        <ol className="wizard-stepper" aria-label={t("Etapas do cadastro")}>
          {stages.map((name, i) => {
            const done = !editing && i < step;
            return (
              <li key={name} className={clsx(i === step && "is-current", done && "is-done") || undefined}>
                <button
                  type="button"
                  aria-current={i === step ? "step" : undefined}
                  disabled={!editing && i > Math.max(step, maxStep)}
                  onClick={() => (editing ? setStep(i) : move(i))}
                >
                  <span className="wizard-step-mark" aria-hidden="true">
                    {done ? <Check size={14} strokeWidth={3} /> : i + 1}
                  </span>
                  <span className="wizard-step-name">{name}</span>
                  {done && <span className="sr-only">, {t("concluída")}</span>}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {children}
      {general && !alertsOnly && (
        <header className="wizard-heading">
          <h2 className="wizard-title" tabIndex={-1} ref={heading}>
            {titles[step]}
          </h2>
          <p>{subtitles[step]}</p>
        </header>
      )}
      {visible.length > 1 && (
        <div className="form-summary" id={errorId} role="alert" tabIndex={-1} data-form-error>
          <p className="form-summary-title">
            <CircleAlert size={18} aria-hidden="true" />
            {t("Revise {0} campos para continuar.", [visible.length])}
          </p>
          <ul>
            {visible.map((problem) => (
              <li key={problem.field + (problem.side || "")}>
                <a
                  href={`#${uid}-${problem.field}`}
                  onClick={(event) => {
                    event.preventDefault();
                    focusField(problem.field);
                  }}
                >
                  {problem.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {offscreen && (
        <p className="form-error" id={errorId} role="alert" tabIndex={-1} data-form-error>
          <CircleAlert size={16} aria-hidden="true" />
          <span>{offscreen}</span>
        </p>
      )}
      {general && !alertsOnly && step === 0 && (
        <div className="wizard-stage trip-fields">
          <div className="field trip-type">
            <span className="field-label" id={ids.tripType}>
              {t("Tipo de viagem")}
            </span>
            <div className="segmented segmented-fill" role="group" aria-labelledby={ids.tripType}>
              <button type="button" aria-pressed={!config.inbound} onClick={() => setTripType(false)}>
                {t("Somente ida")}
              </button>
              <button type="button" aria-pressed={!!config.inbound} onClick={() => setTripType(true)}>
                {t("Ida e volta")}
              </button>
            </div>
          </div>
          <div className="route-fields">
            <div className="route-field" id={`${uid}-origins`}>
              <AirportPicker
                label={t("Origem")}
                field="origin"
                error={problemOf("origins")}
                onSelected={() => {
                  // On to the destination search, or past it when it is already filled.
                  const next = form.current?.querySelector<HTMLInputElement>('[data-airport-field="destination"] input');
                  if (next) next.focus();
                  else focusAfter(`${uid}-destinations`);
                }}
                values={config.origins}
                onChange={(v) => global({ origins: v })}
                airports={airports}
              />
            </div>
            <button
              type="button"
              className="swap-button"
              aria-label={t("Inverter origem e destino")}
              disabled={!config.origins.length && !config.destinations.length}
              onClick={() => global({ origins: config.destinations, destinations: config.origins })}
            >
              <ArrowLeftRight size={18} aria-hidden="true" />
            </button>
            <div className="route-field" id={`${uid}-destinations`}>
              <AirportPicker
                label={t("Destino")}
                field="destination"
                error={problemOf("destinations")}
                onSelected={() => focusAfter(`${uid}-destinations`)}
                values={config.destinations}
                onChange={(v) => global({ destinations: v })}
                airports={airports}
              />
            </div>
          </div>
          <section
            className="list-section passengers-field"
            id={`${uid}-party`}
            data-field="party"
            aria-labelledby={ids.passengers}
            aria-describedby={partyError ? errorId + "-party" : undefined}
          >
            <div className="list-section-heading">
              <h3 className="list-section-title" id={ids.passengers}>
                {t("Passageiros")}
              </h3>
              <span className="party-total">{partyLabel(config)}</span>
            </div>
            <div className={clsx("list-group", partyError && "is-invalid")}>
              {counter("adults", t("Adultos"), t("Diminuir adultos"), t("Aumentar adultos"))}
              {counter("children", t("Crianças"), t("Diminuir crianças"), t("Aumentar crianças"))}
              <details className="infant-options" open={infants > 0}>
                <summary className="list-row">
                  <span className="list-row-label">{t("Bebês (opcional)")}</span>
                  {infants > 0 && <span className="list-row-detail">{infants}</span>}
                </summary>
                {counter(
                  "infants_in_seat",
                  t("Bebês com assento"),
                  t("Diminuir bebês com assento"),
                  t("Aumentar bebês com assento"),
                )}
                {counter(
                  "infants_on_lap",
                  t("Bebês no colo"),
                  t("Diminuir bebês no colo"),
                  t("Aumentar bebês no colo"),
                )}
              </details>
            </div>
            <p className="list-section-footer">
              {t("Máximo de nove passageiros. Cada bebê no colo precisa de um adulto.")}
            </p>
            {partyError && <FieldError id={errorId + "-party"}>{partyError}</FieldError>}
          </section>
          <details className="advanced-options trip-options">
            <summary>
              <span className="trip-options-title">{t("Cabine e moeda")}</span>
              <span className="trip-options-value">
                {cabinName(config.cabin)} · {currency}
              </span>
            </summary>
          <div className="trip-options-row">
            <div className="field">
              <label className="field-label" htmlFor={ids.cabin}>
                {t("Cabine")}
              </label>
              <select id={ids.cabin} value={config.cabin} onChange={(e) => global({ cabin: e.target.value })}>
                {["economy", "premium-economy", "business", "first"].map((cabin) => (
                  <option key={cabin} value={cabin}>
                    {cabinName(cabin)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field-label" htmlFor={ids.currency}>
                {t("Moeda da pesquisa")}
              </label>
              <select
                id={ids.currency}
                value={currency}
                aria-describedby={ids.currency + "-help"}
                onChange={(e) => {
                  setCurrencyNeedsReview(true);
                  global({
                    currency: e.target.value,
                    target_cents: null,
                    min_drop_cents: 5000,
                  });
                }}
              >
                {popular.length > 0 && (
                  <optgroup label={t("Mais usadas")}>
                    {popular.map((code) => (
                      <option key={code} value={code}>
                        {currencyLabel(code)}
                      </option>
                    ))}
                  </optgroup>
                )}
                {others.length > 0 && (
                  <optgroup label={t("Todas as moedas")}>
                    {others.map((code) => (
                      <option key={code} value={code}>
                        {currencyLabel(code)}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <p className="field-help" id={ids.currency + "-help"}>
                {t("Ao trocar a moeda, a meta é limpa e a queda mínima volta a 50 na nova moeda.")}
              </p>
            </div>
          </div>
          </details>
          <div className="dates-field" id={`${uid}-window`}>
            {legTabs}
            <div className="leg-panel" {...panel}>
              <DepartureWindow
                key={legDirection}
                leg={leg}
                onChange={patch}
                error={problemOf("window")}
                earliest={today}
                keepSaved={editing}
                title={legDirection === "inbound" ? t("Intervalo de saída da volta") : t("Intervalo de saída da ida")}
                onComplete={
                  config.inbound && !editing && !autoAdvanced.current && legDirection === "outbound"
                    ? completeOutbound
                    : undefined
                }
              />
              {legDirection === "inbound" && returnWarning}
            </div>
          </div>
        </div>
      )}
      {general && !alertsOnly && step === 1 && (
        <div className="wizard-stage">
          {legTabs}
          <div className="leg-panel" {...panel}>
            {legDirection === "inbound" && (
              <Button
                type="button"
                variant="outline"
                size="small"
                className="copy-preferences"
                onClick={() =>
                  global({
                    inbound: {
                      ...leg,
                      stops: [...config.outbound.stops],
                      max_duration: config.outbound.max_duration,
                      max_layover: config.outbound.max_layover,
                      airlines: [...config.outbound.airlines],
                    },
                  })
                }
              >
                {t("Usar as preferências da ida")}
              </Button>
            )}
            {preferences}
          </div>
        </div>
      )}
      {general && !alertsOnly && step === 2 && (
        <div className="wizard-stage">
          <section className="review-summary" aria-label={t("Resumo da viagem")}>
            <RouteCodes config={config} className="review-codes" />
            <RoutePlaces config={config} airports={airports} className="review-places" />
            <ul className="review-chips">
              <li className="info-chip">{config.inbound ? t("Ida e volta") : t("Somente ida")}</li>
              <li className="info-chip">{partyLabel(config)}</li>
              <li className="info-chip">{cabinName(config.cabin)}</li>
              <li className="info-chip">
                {config.checked_bags
                  ? t(config.checked_bags === 1 ? "{0} mala na pesquisa" : "{0} malas na pesquisa", [
                      config.checked_bags,
                    ])
                  : t("Taxas de bagagem não adicionadas")}
              </li>
            </ul>
          </section>
          {SIDES.map((side) => {
            const selection = config[side];
            if (!selection) return null;
            return (
              <section className="list-section review-leg" key={side} aria-labelledby={`${uid}-review-${side}`}>
                <h3 className="list-section-title" id={`${uid}-review-${side}`}>
                  {side === "outbound" ? t("Ida") : t("Volta")} · {legDates(selection, true)}
                </h3>
                <dl className="list-group review-list">
                  <div className="list-row">
                    <dt>{t("Janela de saída")}</dt>
                    <dd>
                      {formatDateTime(selection.start, "numeric")} – {formatDateTime(selection.end, "numeric")}
                    </dd>
                  </div>
                  <div className="list-row">
                    <dt>{t("Escalas permitidas")}</dt>
                    <dd>{selection.stops.map(stopsName).join(" · ")}</dd>
                  </div>
                  <div className="list-row">
                    <dt>{t("Duração máxima da viagem")}</dt>
                    <dd>
                      {selection.max_duration == null ? t("Sem limite de duração") : formatDuration(selection.max_duration)}
                    </dd>
                  </div>
                  <div className="list-row">
                    <dt>{t("Companhia aérea")}</dt>
                    <dd>{selection.airlines.length ? selection.airlines.join(" / ") : t("Todas as companhias")}</dd>
                  </div>
                  <div className="list-row">
                    <dt>{t("Máximo por conexão")}</dt>
                    <dd>{selection.max_layover == null ? t("Sem limite") : formatDuration(selection.max_layover)}</dd>
                  </div>
                  {selection.arrival_before && (
                    <div className="list-row">
                      <dt>{t("Chegar até")}</dt>
                      <dd>{formatDateTime(selection.arrival_before, "numeric")}</dd>
                    </div>
                  )}
                </dl>
                <div className="review-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    size="small"
                    onClick={() => {
                      setError("");
                      go(0, side);
                    }}
                  >
                    {t("Editar viagem")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="small"
                    onClick={() => {
                      setError("");
                      go(1, side);
                    }}
                  >
                    {t("Editar preferências")}
                  </Button>
                </div>
              </section>
            );
          })}
          {returnWarning}
          <div className="field monitor-name">
            <label className="field-label" htmlFor={ids.name}>
              {t("Nome da viagem (opcional)")}
            </label>
            <input
              id={ids.name}
              maxLength={70}
              value={config.name}
              placeholder={suggestedName(config)}
              aria-describedby={ids.name + "-help"}
              onChange={(e) => global({ name: e.target.value })}
            />
            <p className="field-help" id={ids.name + "-help"}>
              {t("Sem nome? Usaremos a rota e a data da viagem.")}
            </p>
          </div>
          <h3 className="wizard-section-title">{t("Alertas")}</h3>
          {alerts}
        </div>
      )}
      {!general && !alertsOnly && (
        <>
          {legTabs}
          <div className="leg-panel" {...panel}>
            {preferences}
            <details className="flight-more-options">
              <summary>
                <SlidersHorizontal size={18} aria-hidden="true" />
                <span className="flight-more-title">
                  <strong>{t("Horários e conexões")}</strong>
                  <span className="quick-window-summary">
                    {formatDateTime(leg.start, "numeric")} – {formatDateTime(leg.end, "numeric")}
                    {leg.arrival_before ? " · " + t("Chegada definida") : ""}
                    {leg.max_layover !== null ? " · " + t("Conexão até {0}", [formatDuration(leg.max_layover)]) : ""}
                  </span>
                </span>
              </summary>
              <div className="flight-more-grid">
                <DepartureWindow
                  key={legDirection}
                  leg={leg}
                  onChange={patch}
                  error={problemOf("window")}
                  earliest={today}
                  keepSaved
                />
                <section className="list-section">
                  <h3 className="list-section-title">{t("Chegada e conexões")}</h3>
                  {connections}
                </section>
              </div>
            </details>
          </div>
        </>
      )}
      {alertsOnly && <div className="wizard-stage">{alerts}</div>}
      {(general || alertsOnly) && (
        <div className={clsx("wizard-footer", draftSaved && "has-note")}>
          {back && (
            <Button type="button" variant="outline" size="large" className="wizard-back" onClick={back}>
              <ArrowLeft size={18} aria-hidden="true" />
              {t("Voltar")}
            </Button>
          )}
          {draftSaved && (
            <span className="wizard-saved">
              <Check size={14} aria-hidden="true" />
              {t("Rascunho salvo neste navegador")}
            </span>
          )}
          <Button type="submit" size="large" disabled={saving || number.busy} className="wizard-next">
            {saving && <LoaderCircle size={18} className="spin" aria-hidden="true" />}
            <span>{primary}</span>
            {!saving && advancing && <ArrowRight size={18} aria-hidden="true" />}
          </Button>
        </div>
      )}
    </form>
  );
}
