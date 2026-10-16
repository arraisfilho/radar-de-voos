import { partyLabel, partyTotal, validParty } from "./passengers";
import { suggestedName, nextTripAction } from "./searchJourney";
import { t, getLocale } from "./i18n";
import { useId, useRef, useState } from "react";
import * as Slider from "@radix-ui/react-slider";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  ChevronRight,
  LoaderCircle,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import { currencies, currencyLabel } from "./currency";
import { DatePicker } from "./DatePicker";
import { AirlinePicker } from "./AirlinePicker";
import "./search-form.css";
import { AirportPicker } from "./AirportPicker";
import { Button } from "./ui";
import type { Config, Leg, State } from "./types";
const duration = (n: number) =>
  n < 60
    ? t("{0} min", [n])
    : t("{0} h{1}", [
        Math.floor(n / 60),
        n % 60 ? t(" {0} min", [n % 60]) : "",
      ]);
const windowStamp = (s: string) =>
  new Date(s + "Z").toLocaleString(getLocale(), {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
const wall = (s: string) => Date.parse(s + "Z"),
  stamp = (n: number) => new Date(n).toISOString().slice(0, 16);
const newLeg = (day: string): Leg => ({
  start: day + "T00:00",
  end: day + "T23:59",
  arrival_before: null,
  stops: [0, 1, 2],
  max_duration: null,
  max_layover: null,
  airlines: [],
});
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
  return (
    <div className={"number-range" + (timeInput ? " time-range" : "")}>
      <div className="range-heading">
        <label htmlFor={id}>{label}</label>
        {!timeInput && (
          <strong>{format ? format(value) : `${value} ${unit}`}</strong>
        )}
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
          <Slider.Thumb
            className="slider-thumb"
            aria-label={label}
            aria-valuetext={format ? format(value) : `${value} ${unit}`}
          />
        </Slider.Root>
        {timeInput ? (
          <div className="duration-inputs">
            <label>
              <input
                id={id}
                aria-label={t("{0}: horas", [label])}
                type="number"
                required
                min={0}
                max={Math.floor(max / 60)}
                step={1}
                value={Math.floor(value / 60)}
                onChange={(e) => {
                  if (e.target.value)
                    onChange(
                      Math.max(
                        min,
                        Math.min(
                          max,
                          Number(e.target.value) * 60 + (value % 60),
                        ),
                      ),
                    );
                }}
              />
              <span>h</span>
            </label>
            <label>
              <input
                aria-label={t("{0}: minutos", [label])}
                type="number"
                required
                min={0}
                max={59}
                step={1}
                value={value % 60}
                onChange={(e) => {
                  if (e.target.value)
                    onChange(
                      Math.max(
                        min,
                        Math.min(
                          max,
                          Math.floor(value / 60) * 60 + Number(e.target.value),
                        ),
                      ),
                    );
                }}
              />
              <span>min</span>
            </label>
          </div>
        ) : (
          <div className="number-with-unit">
            <input
              id={id}
              type="number"
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
}: {
  leg: Leg;
  onChange: (v: Partial<Leg>) => void;
  title?: string;
  onComplete?: (leg: Leg) => void;
}) {
  const id = useId(),
    [bounds, setBounds] = useState({
      start: leg.start.slice(0, 10),
      end: leg.end.slice(0, 10),
    });
  const pending = useRef(leg);
  const changed = useRef(false);
  pending.current = leg;
  const change = (part: Partial<Leg>) => {
    pending.current = { ...pending.current, ...part };
    changed.current = true;
    onChange(part);
  };
  const complete = () => {
    if (!changed.current) return;
    const value = pending.current;
    if (
      !Number.isFinite(wall(value.start)) ||
      !Number.isFinite(wall(value.end)) ||
      wall(value.end) <= wall(value.start) ||
      wall(value.end) - wall(value.start) > 10079 * 60000
    )
      return;
    changed.current = false;
    onComplete?.(value);
  };
  const base = wall(bounds.start + "T00:00"),
    max = Math.max(
      1439,
      Math.round((wall(bounds.end + "T23:59") - base) / 60000),
    ),
    values = [
      Math.max(0, Math.round((wall(leg.start) - base) / 60000)),
      Math.max(1, Math.round((wall(leg.end) - base) / 60000)),
    ];
  const label = (m: number) =>
    new Date(base + m * 60000).toLocaleString(getLocale(), {
      timeZone: "UTC",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <fieldset className="departure-window">
      <legend>{title || t("Quando você pode sair?")}</legend>
      <p className="help">
        {t("Datas e horários locais de cada aeroporto de partida.")}
      </p>
      <div className="window-grid">
        {(["start", "end"] as const).map((key, i) => (
          <div className="window-endpoint" key={key}>
            <label htmlFor={id + key}>{i ? t("Até") : t("A partir de")}</label>
            <DatePicker
              id={id + key}
              label={i ? t("Até") : t("A partir de")}
              value={leg[key].slice(0, 10)}
              onChange={(value) => {
                if (value) {
                  const changed = value + "T" + leg[key].slice(11, 16);
                  if (key === "start" && wall(changed) >= wall(leg.end)) {
                    const end = stamp(
                      wall(leg.end) + wall(changed) - wall(leg.start),
                    );
                    setBounds({ start: value, end: end.slice(0, 10) });
                    change({ start: changed, end });
                  } else {
                    setBounds({ ...bounds, [key]: value });
                    change({ [key]: changed });
                  }
                }
              }}
            />
            <input
              aria-label={
                i ? t("Horário limite de saída") : t("Horário inicial de saída")
              }
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
      </div>
      {values[1] > values[0] && max <= 10079 && (
        <>
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
          <div className="window-labels">
            <span>{label(values[0])}</span>
            <span>{label(values[1])}</span>
          </div>
        </>
      )}
      <p className="help">
        {t(
          "Para atravessar a meia-noite, escolha o dia seguinte em “Até”. Máximo de sete datas.",
        )}
      </p>
    </fieldset>
  );
}
type Props = {
  config: Config;
  setConfig: (v: Config) => void;
  airports: State["airports"];
  onSave: (submitted?: Config) => void;
  saving: boolean;
  general?: boolean;
  editing?: boolean;
  dirty?: boolean;
  emailRecipients?: string[];
  alertsOnly?: boolean;
  whatsappAvailable?: boolean;
  whatsappRecipients?: string[];
};
export function SearchForm({
  config,
  setConfig,
  airports,
  onSave,
  saving,
  general = false,
  editing = false,
  dirty = false,
  emailRecipients = [],
  alertsOnly = false,
  whatsappAvailable = false,
  whatsappRecipients = [],
}: Props) {
  const baggageId = useId();
  const returnTouched = useRef(false);
  const [direction, setDirection] = useState<"outbound" | "inbound">(
      "outbound",
    ),
    [step, setStep] = useState(editing ? 1 : 0),
    [error, setError] = useState(""),
    form = useRef<HTMLFormElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const autoAdvanced = useRef(false);
  const legDirection = config.inbound ? direction : "outbound";
  const leg =
    (legDirection === "inbound" ? config.inbound : config.outbound) ||
    config.outbound;
  const patch = (part: Partial<Leg>) => {
      if (legDirection === "inbound") returnTouched.current = true;
      setConfig({ ...config, [legDirection]: { ...leg, ...part } });
    },
    global = (part: Partial<Config>) => setConfig({ ...config, ...part });
  function validateTrip(outboundOnly = false, trip = config) {
    if (!validParty(trip))
      return t("Até nove passageiros, com um adulto por bebê no colo.");
    if (!trip.origins.length || !trip.destinations.length)
      return t("Selecione ao menos uma origem e um destino.");
    if (trip.origins.some((v) => trip.destinations.includes(v)))
      return t("Origem e destino precisam ser aeroportos diferentes.");
    for (const l of [trip.outbound, outboundOnly ? null : trip.inbound].filter(
      Boolean,
    ) as Leg[]) {
      if (
        !l.start ||
        !l.end ||
        !Number.isFinite(wall(l.start)) ||
        !Number.isFinite(wall(l.end)) ||
        wall(l.end) <= wall(l.start) ||
        wall(l.end) - wall(l.start) > 10079 * 60000
      )
        return t(
          "Cada janela deve ser crescente e abranger no máximo sete datas.",
        );
    }
    if (
      !outboundOnly &&
      trip.inbound &&
      trip.inbound.start < trip.outbound.start
    )
      return t("A volta precisa começar após o início da ida.");
    return "";
  }
  function completeOutbound(outbound: Leg) {
    if (
      !general ||
      editing ||
      step !== 0 ||
      legDirection !== "outbound" ||
      !config.inbound ||
      autoAdvanced.current
    )
      return;
    if (!form.current?.reportValidity()) return;
    const next = { ...config, outbound };
    const problem = validateTrip(true, next);
    if (problem) {
      setError(problem);
      return;
    }
    if (next.inbound!.start < outbound.start && !returnTouched.current) {
      next.inbound = newLeg(
        stamp(wall(outbound.end) + 4 * 86400000).slice(0, 10),
      );
    }
    setConfig(next);
    autoAdvanced.current = true;
    setDirection("inbound");
    setError("");
    requestAnimationFrame(() =>
      form.current
        ?.querySelector<HTMLInputElement>(
          ".departure-window [data-date-trigger]",
        )
        ?.focus({ preventScroll: true }),
    );
  }
  function move(next: number) {
    if (
      next > step &&
      step === 0 &&
      !editing &&
      nextTripAction(!!config.inbound, legDirection) === "return"
    ) {
      if (!form.current?.reportValidity()) return;
      const problem = validateTrip(true);
      if (problem) {
        setError(problem);
        return;
      }
      if (
        config.inbound &&
        config.inbound.start < config.outbound.start &&
        !returnTouched.current
      ) {
        global({
          inbound: newLeg(
            stamp(wall(config.outbound.end) + 4 * 86400000).slice(0, 10),
          ),
        });
      }
      autoAdvanced.current = true;
      setDirection("inbound");
      setError("");
      requestAnimationFrame(() =>
        form.current
          ?.querySelector<HTMLInputElement>(
            ".departure-window [data-date-trigger]",
          )
          ?.focus(),
      );
      return;
    }
    if (next > step) {
      if (!form.current?.reportValidity()) return;
      const problem = validateTrip();
      if (problem) {
        setError(problem);
        return;
      }
      if (
        !config.outbound.stops.length ||
        (config.inbound && !config.inbound.stops.length)
      ) {
        setError(t("Selecione ao menos uma categoria de escalas por trecho."));
        return;
      }
    }
    if (
      next > step &&
      step === 1 &&
      !editing &&
      config.inbound &&
      legDirection === "outbound"
    ) {
      setDirection("inbound");
      setError("");
      heading.current?.focus();
      return;
    }
    setError("");
    setStep(next);
    if (next === 1) setDirection("outbound");
    heading.current?.focus();
    form.current?.closest(".dialog-body")?.scrollTo({ top: 0 });
  }
  const directionTabs = config.inbound ? (
    <div className="tabs small-tabs" aria-label={t("Trecho a configurar")}>
      <button
        type="button"
        aria-pressed={direction === "outbound"}
        className={direction === "outbound" ? "active" : ""}
        onClick={() => setDirection("outbound")}
      >
        {t("Ida")}
      </button>
      {config.inbound && (
        <button
          type="button"
          aria-pressed={direction === "inbound"}
          className={direction === "inbound" ? "active" : ""}
          onClick={() => setDirection("inbound")}
        >
          {t("Volta")}
        </button>
      )}
    </div>
  ) : null;
  const baggage = (
    <fieldset className="baggage-field compact-baggage">
      <legend>{t("Bagagem despachada")}</legend>
      <label htmlFor={baggageId} className="sr-only">
        {t("Taxas a incluir na pesquisa")}
      </label>
      <select
        id={baggageId}
        aria-describedby={baggageId + "-help"}
        value={config.checked_bags || 0}
        onChange={(e) => global({ checked_bags: Number(e.target.value) })}
      >
        <option value={0}>{t("Não adicionar taxas de bagagem")}</option>
        <option value={1}>{t("Incluir 1 mala despachada")}</option>
        <option value={2}>{t("Incluir 2 malas despachadas")}</option>
      </select>
      <p id={baggageId + "-help"} className="help">
        {t("Taxas estimadas nos dois trechos; franquia e peso a confirmar.")}
      </p>
    </fieldset>
  );
  const connections = (
    <div className="details-content advanced-grid">
      <div className="arrival-setting">
        <label>
          {t("Chegar até (opcional)")}
          <input
            type="datetime-local"
            value={leg.arrival_before || ""}
            onChange={(e) => patch({ arrival_before: e.target.value || null })}
          />
        </label>
        <p className="help">{t("Horário local do destino.")}</p>
      </div>
      <div className="connection-setting">
        <label className="check-row">
          <input
            type="checkbox"
            checked={leg.max_layover !== null}
            onChange={(e) =>
              patch({ max_layover: e.target.checked ? 180 : null })
            }
          />
          {t("Limitar espera por conexão")}
        </label>
        {leg.max_layover !== null && (
          <NumberRange
            timeInput
            label={t("Máximo por conexão")}
            value={leg.max_layover}
            min={30}
            max={1440}
            step={15}
            unit="min"
            format={duration}
            onChange={(v) => patch({ max_layover: v })}
          />
        )}
      </div>
    </div>
  );
  const preferences = (
    <div className="preference-sheet">
      <div className="preference-basics">
        <fieldset className="stops-field">
          <legend>{t("Escalas permitidas")}</legend>
          <div className="stops-options">
            {[
              [0, t("Direto")],
              [1, t("1 escala")],
              [2, t("2 ou mais")],
            ].map(([value, label]) => (
              <label className="check-row stop-choice" key={value}>
                <input
                  type="checkbox"
                  checked={leg.stops.includes(Number(value))}
                  onChange={(e) =>
                    patch({
                      stops: e.target.checked
                        ? [...leg.stops, Number(value)].sort()
                        : leg.stops.filter((v) => v !== value),
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div
          className="duration-field"
          title={t("Inclui os voos e a espera nas conexões.")}
        >
          <label className="check-row duration-toggle">
            <input
              type="checkbox"
              checked={leg.max_duration != null}
              onChange={(e) =>
                patch({ max_duration: e.target.checked ? 2880 : null })
              }
            />
            {t("Limitar duração da viagem")}
          </label>
          {leg.max_duration == null ? (
            <p className="help">
              {t("Sem limite de duração, incluindo conexões.")}
            </p>
          ) : (
            <NumberRange
              timeInput
              label={t("Duração máxima da viagem")}
              value={leg.max_duration}
              min={60}
              max={2880}
              step={30}
              unit="min"
              format={duration}
              onChange={(v) => patch({ max_duration: v })}
            />
          )}
        </div>
      </div>
      <div
        className={general ? "preference-secondary" : "preference-airline-only"}
      >
        <AirlinePicker
          key={legDirection}
          values={leg.airlines}
          onChange={(airlines) => patch({ airlines })}
        />
        {general && baggage}
      </div>
      {general && (
        <details className="advanced-options">
          <summary>
            <SlidersHorizontal size={16} />
            {t("Chegada e conexões")}
            <ChevronRight size={15} />
          </summary>
          {connections}
        </details>
      )}
      {!general && baggage}
    </div>
  );
  const alerts = (
    <>
      <label>
        {t("Moeda da pesquisa")}
        <select
          value={config.currency || "BRL"}
          onChange={(e) =>
            global({
              currency: e.target.value,
              target_cents: null,
              min_drop_cents: 5000,
            })
          }
        >
          {currencies.map((code) => (
            <option key={code} value={code}>
              {currencyLabel(code)}
            </option>
          ))}
        </select>
      </label>
      <details className="currency-explanation">
        <summary>{t("Sobre a moeda e os preços")}</summary>{" "}
        <p className="help">
          {t(
            "A sugestão inicial usa região/idioma e fuso do navegador; não é sua localização exata. Escolha outra moeda se preferir. Ao trocar, a meta é limpa e a queda mínima volta a 50 na nova moeda. A compra segue as condições do vendedor.",
          )}
        </p>
      </details>
      <div className="two-fields">
        <label>
          {t("Meta por trecho (")}
          {config.currency || "BRL"})
          <input
            type="number"
            min={1}
            step="0.01"
            placeholder={t("Opcional")}
            value={config.target_cents == null ? "" : config.target_cents / 100}
            onChange={(e) =>
              global({
                target_cents: e.target.value
                  ? Math.round(Number(e.target.value) * 100)
                  : null,
              })
            }
          />
        </label>
        <label>
          {t("Queda mínima (")}
          {config.currency || "BRL"})
          <input
            required
            type="number"
            min={1}
            step="0.01"
            value={config.min_drop_cents / 100}
            onChange={(e) =>
              global({
                min_drop_cents: Math.round(Number(e.target.value) * 100),
              })
            }
          />
        </label>
      </div>
      <p className="help">
        {t("Preço total para {0}, por trecho.", [partyLabel(config)])}
      </p>

      <label className="check-row">
        <input
          type="checkbox"
          checked={config.notify_email || !!config.notify_whatsapp}
          onChange={(e) =>
            global(
              e.target.checked
                ? { notify_email: true }
                : { notify_email: false, notify_whatsapp: false },
            )
          }
        />
        {t("Enviar alertas")}
      </label>
      {(config.notify_email || config.notify_whatsapp) && (
        <fieldset className="channel-picker">
          <legend>{t("Como você quer receber?")}</legend>
          <div className="channel-options">
            {[
              { id: "email", label: t("E-mail"), ready: true },
              {
                id: "whatsapp",
                label: t("WhatsApp"),
                ready: whatsappAvailable,
              },
              { id: "telegram", label: t("Telegram"), ready: false },
            ].map((channel) => (
              <label
                key={channel.id}
                className={
                  "channel-option " + (!channel.ready ? "coming-soon" : "")
                }
              >
                <input
                  type="checkbox"
                  checked={
                    channel.id === "email"
                      ? config.notify_email
                      : channel.id === "whatsapp"
                        ? !!config.notify_whatsapp
                        : false
                  }
                  disabled={
                    !channel.ready &&
                    !(channel.id === "whatsapp" && config.notify_whatsapp)
                  }
                  onChange={(e) =>
                    global(
                      channel.id === "email"
                        ? { notify_email: e.target.checked }
                        : { notify_whatsapp: e.target.checked },
                    )
                  }
                />
                <span>
                  {channel.label}
                  {!channel.ready && (
                    <small>
                      {channel.id === "telegram"
                        ? t("Em breve")
                        : t("Indisponível")}
                    </small>
                  )}
                </span>
              </label>
            ))}
          </div>
          <p className="help">
            {config.notify_email &&
              (emailRecipients.length
                ? t("Enviar para: {0}", [emailRecipients.join(", ")])
                : t(
                    "Adicione até quatro e-mails em Meu perfil. Você não precisa configurar um servidor.",
                  ))}
          </p>
          {config.notify_whatsapp && (
            <p className="help">
              {whatsappRecipients.length
                ? t("WhatsApp para: {0}", [
                    [...new Set(whatsappRecipients)].join(", "),
                  ])
                : t("Cadastre o número WhatsApp em Meu perfil.")}
            </p>
          )}
          <p className="help">{t("Você pode selecionar mais de um canal.")}</p>
        </fieldset>
      )}
    </>
  );
  return (
    <form
      id={!general && !alertsOnly ? "monitor-filters" : undefined}
      ref={form}
      className={
        "filter-form " +
        (alertsOnly
          ? "alert-settings-form"
          : general
            ? "search-wizard" + (editing ? " compact-editor" : "")
            : "compact-filters")
      }
      onSubmit={(e) => {
        e.preventDefault();
        if (general && !editing && step < 2) {
          move(step + 1);
          return;
        }
        const problem = validateTrip();
        if (problem) {
          setError(problem);
          if (general) setStep(0);
          return;
        }
        for (const side of ["outbound", "inbound"] as const) {
          const selection = config[side];
          if (selection && !selection.stops.length) {
            setError(
              t("Selecione ao menos uma categoria de escalas por trecho."),
            );
            setDirection(side);
            if (general) setStep(1);
            requestAnimationFrame(() =>
              form.current
                ?.querySelector<HTMLInputElement>(".stops-options input")
                ?.focus(),
            );
            return;
          }
        }
        onSave({
          ...config,
          name: config.name.trim() || suggestedName(config),
        });
      }}
    >
      {general && !alertsOnly && (
        <>
          <ol
            className={editing ? "wizard-steps editor-tabs" : "wizard-steps"}
            aria-label={t("Etapas do cadastro")}
          >
            {[
              t("Viagem"),
              t("Preferências"),
              editing ? t("Alertas") : t("Concluir"),
            ].map((name, i) => (
              <li key={name} aria-current={step === i ? "step" : undefined}>
                <button
                  type="button"
                  disabled={!editing && i > step}
                  onClick={() => (editing ? setStep(i) : move(i))}
                >
                  {!editing && (
                    <span>{i < step ? <Check size={15} /> : i + 1}</span>
                  )}
                  {name}
                </button>
              </li>
            ))}
          </ol>
          {!editing && (
            <h3 className="wizard-title sr-only" tabIndex={-1} ref={heading}>
              {
                [
                  t("Sua próxima viagem"),
                  t("O que faz um voo servir para você?"),
                  t("Quando devemos avisar?"),
                ][step]
              }
            </h3>
          )}
        </>
      )}
      {!alertsOnly && general && step === 0 && (
        <div className="trip-fields">
          <div className="two-fields airport-fields">
            <AirportPicker
              label={t("Origem")}
              onSelected={() => {
                const destination =
                  form.current?.querySelector<HTMLInputElement>(
                    '[data-airport="Destino"] input',
                  );
                if (destination) destination.focus();
              }}
              values={config.origins}
              onChange={(v) => global({ origins: v })}
              airports={airports}
            />
            <AirportPicker
              label={t("Destino")}
              onSelected={() =>
                form.current
                  ?.querySelector<HTMLSelectElement>(".trip-fields select")
                  ?.focus()
              }
              values={config.destinations}
              onChange={(v) => global({ destinations: v })}
              airports={airports}
            />
          </div>
          <p className="help">
            {t(
              "Escolha de onde sair e para onde ir. Você pode adicionar outros aeroportos se quiser.",
            )}
          </p>
          <div className="trip-options-row">
            <label>
              {t("Tipo de viagem")}
              <select
                value={config.inbound ? "round" : "one"}
                onChange={(e) => {
                  global({
                    inbound:
                      e.target.value === "round"
                        ? newLeg(
                            stamp(
                              wall(config.outbound.end) + 4 * 86400000,
                            ).slice(0, 10),
                          )
                        : null,
                  });
                  setDirection("outbound");
                  returnTouched.current = false;
                  autoAdvanced.current = false;
                }}
              >
                <option value="one">{t("Somente ida")}</option>
                <option value="round">{t("Ida e volta")}</option>
              </select>
            </label>
            <label>
              {t("Adultos")}
              <select
                value={config.adults}
                onChange={(e) => global({ adults: Number(e.target.value) })}
              >
                {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => (
                  <option
                    key={n}
                    value={n}
                    disabled={!validParty({ ...config, adults: n })}
                  >
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Crianças")}
              <select
                value={config.children || 0}
                onChange={(e) => global({ children: Number(e.target.value) })}
              >
                {Array.from({ length: 9 }, (_, n) => (
                  <option
                    key={n}
                    value={n}
                    disabled={partyTotal({ ...config, children: n }) > 9}
                  >
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Cabine")}
              <select
                value={config.cabin}
                onChange={(e) => global({ cabin: e.target.value })}
              >
                <option value="economy">{t("Econômica")}</option>
                <option value="premium-economy">
                  {t("Econômica premium")}
                </option>
                <option value="business">{t("Executiva")}</option>
                <option value="first">{t("Primeira classe")}</option>
              </select>
            </label>
          </div>
          <details className="infant-options">
            <summary>
              {t("Bebês (opcional)")}
              {(config.infants_in_seat || 0) + (config.infants_on_lap || 0) >
                0 && (
                <span>
                  {(config.infants_in_seat || 0) + (config.infants_on_lap || 0)}
                </span>
              )}
            </summary>
            <div className="two-fields">
              {(["infants_in_seat", "infants_on_lap"] as const).map((key) => (
                <label key={key}>
                  {key === "infants_in_seat"
                    ? t("Bebês com assento")
                    : t("Bebês no colo")}
                  <select
                    value={config[key] || 0}
                    onChange={(e) => global({ [key]: Number(e.target.value) })}
                  >
                    {Array.from({ length: 9 }, (_, n) => (
                      <option
                        key={n}
                        value={n}
                        disabled={!validParty({ ...config, [key]: n })}
                      >
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <p className="help">
              {t(
                "Máximo de nove passageiros. Cada bebê no colo precisa de um adulto.",
              )}
            </p>
          </details>
          {directionTabs}
          <DepartureWindow
            key={legDirection}
            leg={leg}
            onChange={patch}
            title={
              legDirection === "inbound"
                ? t("Intervalo de saída da volta")
                : t("Intervalo de saída da ida")
            }
            onComplete={
              config.inbound &&
              !editing &&
              !autoAdvanced.current &&
              legDirection === "outbound"
                ? completeOutbound
                : undefined
            }
          />
        </div>
      )}
      {!alertsOnly && general && step === 1 && (
        <>
          {directionTabs}
          {preferences}
        </>
      )}
      {!alertsOnly && general && step === 2 && (
        <>
          <div className="search-review">
            <strong>
              {config.origins.join(" / ")} → {config.destinations.join(" / ")}
            </strong>
            <span>
              {config.inbound ? t("Ida e volta") : t("Só ida")} ·{" "}
              {partyLabel(config)} ·
              {config.checked_bags
                ? t("{0} mala(s) na pesquisa", [config.checked_bags])
                : t("Taxas de bagagem não adicionadas")}
            </span>
          </div>
          <label className="monitor-name">
            {t("Nome do monitoramento (opcional)")}
            <input
              maxLength={70}
              value={config.name}
              placeholder={suggestedName(config)}
              onChange={(e) => global({ name: e.target.value })}
            />
            <small>{t("Sem nome? Usaremos a rota e a data da viagem.")}</small>
          </label>
          {alerts}
        </>
      )}
      {!general && !alertsOnly && (
        <>
          {directionTabs}
          {preferences}
          <details className="flight-more-options">
            <summary>
              <SlidersHorizontal size={15} />
              {t("Horários e conexões")}
              <span className="quick-window-summary">
                {windowStamp(leg.start)} → {windowStamp(leg.end)}
                {leg.arrival_before ? " · " + t("Chegada definida") : ""}
                {leg.max_layover !== null
                  ? " · " + t("Conexão até {0}", [duration(leg.max_layover)])
                  : ""}
              </span>
              <ChevronRight size={15} />
            </summary>
            <div className="flight-more-grid">
              <DepartureWindow key={legDirection} leg={leg} onChange={patch} />
              <section>
                <h3>{t("Chegada e conexões")}</h3>
                {connections}
              </section>
            </div>
          </details>
        </>
      )}
      {alertsOnly && alerts}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {(general || alertsOnly) && (
        <div className="filter-footer">
          <div className="wizard-actions">
            {general &&
              !editing &&
              (step > 0 || (step === 0 && legDirection === "inbound")) && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    (step === 0 || step === 1) && legDirection === "inbound"
                      ? setDirection("outbound")
                      : move(step - 1)
                  }
                >
                  <ArrowLeft size={16} />
                  {t("Voltar")}
                </Button>
              )}
            <Button type="submit" disabled={saving} className="full">
              {saving ? (
                <LoaderCircle size={17} className="spin" />
              ) : general && !editing && step < 2 ? (
                <ArrowRight size={17} />
              ) : (
                <Save size={17} />
              )}{" "}
              {alertsOnly
                ? t("Salvar alertas")
                : general
                  ? !editing && step < 2
                    ? (step === 0 || step === 1) &&
                      config.inbound &&
                      legDirection === "outbound"
                      ? t("Continuar para a volta")
                      : t("Continuar")
                    : t("Salvar busca")
                  : t("Salvar filtros")}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
