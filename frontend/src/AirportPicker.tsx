import { getLocale, t } from "./i18n";
import { useEffect, useId, useRef, useState } from "react";
import { CircleAlert, LoaderCircle, Plus, Search, X } from "lucide-react";
import { clsx } from "clsx";
import { airportLabel, airportName, findAirport, rememberAirports } from "./airports";
import { comboboxKeyDown, revealActive } from "./combobox";
import { plural } from "./plural";
import type { Airport } from "./types";

const LIMIT = 3;
const cache = new Map<string, Airport>();
const regions = new Map<string, Intl.DisplayNames>();
/** Country name in the interface language. */
function countryName(code: string): string {
  const locale = getLocale();
  let names = regions.get(locale);
  if (!names) regions.set(locale, (names = new Intl.DisplayNames([locale], { type: "region" })));
  try {
    return names.of(code) || code;
  } catch {
    return code;
  }
}

/** IATA codes typed or pasted together ("GRU+CGH+VCP", "GRU, CGH"), or null for an ordinary search.
 * A separator is required: names such as "Rio Sul" stay a normal search. */
export function parseCodes(text: string): string[] | null {
  const parts = text.trim().toUpperCase().split(/\s*[+,;/]\s*/).filter(Boolean);
  if (parts.length < 2 || !parts.every((part) => /^[A-Z]{3}$/.test(part))) return null;
  return parts.filter((part, i) => parts.indexOf(part) === i);
}

/** Codes closed by a separator while typing ("GRU+", "GRU, CGH;", "GRU+camp") and the text still being
 * typed after them, or null. Names such as "São Paulo+" are left alone. */
export function typedCodes(text: string): { codes: string[]; rest: string } | null {
  const match = /^(.*)[+,;/]\s*([^+,;/]*)$/.exec(text);
  if (!match) return null;
  const parts = match[1].trim().toUpperCase().split(/\s*[+,;/]\s*/).filter(Boolean);
  if (!parts.length || !parts.every((part) => /^[A-Z]{3}$/.test(part))) return null;
  return { codes: parts.filter((part, i) => parts.indexOf(part) === i), rest: match[2] };
}

/** Up to three airports for one side of the trip, searched in the world catalog. */
export function AirportPicker({
  label,
  values,
  onChange,
  airports,
  onSelected,
  field,
  error,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  airports: Airport[];
  onSelected?: () => void;
  field: "origin" | "destination";
  /** Shown under the field, which is then marked invalid. */
  error?: string;
}) {
  const id = useId(),
    input = useRef<HTMLInputElement>(null),
    list = useRef<HTMLDivElement>(null),
    box = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState(false),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<Airport[]>([]),
    [open, setOpen] = useState(false),
    [index, setIndex] = useState(-1),
    [loading, setLoading] = useState(false),
    [failure, setFailure] = useState(""),
    // The first option is highlighted on its own, so Enter picks it; arrows or the pointer browse.
    [browsing, setBrowsing] = useState(false),
    [batch, setBatch] = useState(false),
    [batchError, setBatchError] = useState("");
  // The latest choice, for additions that finish after a catalog lookup.
  const latest = useRef(values),
    // Only the latest addition may reopen or refocus the field.
    generation = useRef(0);
  latest.current = values;
  airports.forEach((a) => cache.set(a.code, a));
  const full = values.length >= LIMIT;
  const codes = parseCodes(query);
  useEffect(() => {
    setIndex(-1);
    setBrowsing(false);
    setResults([]);
    setFailure("");
    if (query.trim().length < 2 || full || parseCodes(query)) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const r = await fetch("/api/airports?q=" + encodeURIComponent(query), {
          signal: controller.signal,
        });
        if (!r.ok) throw new Error(t("Não foi possível consultar o catálogo."));
        const items: Airport[] = await r.json();
        items.forEach((a) => cache.set(a.code, a));
        const found = items.filter((a) => !values.includes(a.code));
        setResults(found);
        setIndex(found.length ? 0 : -1);
      } catch (e) {
        if (!controller.signal.aborted)
          setFailure(e instanceof Error ? e.message : t("Falha na consulta"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, values.join(",")]);
  useEffect(() => revealActive(list.current), [index]);
  const expanded = open && query.trim().length >= 2 && !full;
  const labelId = id + "-label",
    errorId = id + "-error";
  const status = batchError
    ? batchError
    : codes
    ? batch
      ? t("Buscando no catálogo mundial…")
      : t("Pressione Enter para adicionar {0}.", [codes.join(", ")])
    : loading
    ? t("Buscando no catálogo mundial…")
    : failure ||
      (results.length
        ? plural(
            results.length,
            "{0} aeroporto encontrado. Selecione uma opção.",
            "{0} aeroportos encontrados. Selecione uma opção.",
          )
        : t("Nenhum aeroporto encontrado. Tente o nome local ou código IATA."));
  function choose(a: Airport) {
    // The trip summary and the chips name the airport even when the state does not list it.
    rememberAirports([a]);
    onChange([...values, a.code]);
    setQuery("");
    setOpen(false);
    setIndex(-1);
    setAdding(false);
    // The search field leaves with the choice: the focus moves on to the next
    // field (onSelected) or, without one, stays with the chosen airports.
    requestAnimationFrame(() => {
      onSelected?.();
      const active = document.activeElement;
      if (active && active !== document.body) return;
      box.current?.querySelector<HTMLElement>(".airport-add, .airport-chip:last-child button")?.focus();
    });
  }
  /** Adds every code of a "GRU+CGH+VCP" entry that the catalog knows, up to the limit. */
  /** With keep, the field stays open and focused for the next airport (codes typed with "+"). */
  async function addCodes(list: string[], keep = false) {
    const run = ++generation.current,
      wanted = list.filter((code) => !latest.current.includes(code));
    // Typing goes on while a "+" code is looked up; only Enter and paste lock the field.
    if (!keep) setBatch(true);
    setBatchError("");
    try {
      const found: Airport[] = [],
        missing: string[] = [];
      for (const code of wanted) {
        let airport = cache.get(code);
        if (!airport) {
          const r = await fetch("/api/airports?q=" + encodeURIComponent(code));
          if (!r.ok) throw new Error(t("Não foi possível consultar o catálogo."));
          const items: Airport[] = await r.json();
          items.forEach((a) => cache.set(a.code, a));
          airport = items.find((a) => a.code === code);
        }
        if (airport) found.push(airport);
        else missing.push(code);
      }
      const current = latest.current,
        fresh = found.filter((a) => !current.includes(a.code)),
        room = Math.max(0, LIMIT - current.length),
        added = fresh.slice(0, room),
        problems = [
          missing.length ? t("Não encontrado: {0}.", [missing.join(", ")]) : "",
          fresh.length > room ? t("Máximo de {0} aeroportos.", [LIMIT]) : "",
        ].filter(Boolean);
      if (added.length) {
        rememberAirports(added);
        latest.current = [...current, ...added.map((a) => a.code)];
        onChange(latest.current);
      }
      if (problems.length) {
        if (run !== generation.current) return;
        // The field stays open with the codes that were left out and why; text typed meanwhile is kept.
        setAdding(added.length < room);
        if (!keep || added.length >= room) {
          setQuery(added.length >= room ? "" : [...fresh.slice(room).map((a) => a.code), ...missing].join("+"));
        }
        setOpen(true);
        setBatchError(problems.join(" "));
        return;
      }
      if (run !== generation.current) return;
      if (keep && current.length + added.length < LIMIT) {
        setAdding(true);
        setOpen(true);
        requestAnimationFrame(() => input.current?.focus());
        return;
      }
      setQuery("");
      setOpen(false);
      setAdding(false);
      requestAnimationFrame(() => {
        onSelected?.();
        const active = document.activeElement;
        if (active && active !== document.body) return;
        box.current?.querySelector<HTMLElement>(".airport-add, .airport-chip:last-child button")?.focus();
      });
    } catch (e) {
      if (run !== generation.current) return;
      setOpen(true);
      setBatchError(e instanceof Error ? e.message : t("Falha na consulta"));
    } finally {
      if (!keep) setBatch(false);
    }
  }
  /** After a removal the focus goes to the next chip, "Adicionar outro…", the previous chip or the search field. */
  function remove(code: string) {
    const at = values.indexOf(code),
      rest = values.filter((value) => value !== code);
    onChange(rest);
    requestAnimationFrame(() => {
      const root = box.current;
      const chip = (value?: string) =>
        value ? root?.querySelector<HTMLElement>(`[data-airport="${value}"] button`) : null;
      const target =
        chip(rest[at]) || root?.querySelector<HTMLElement>(".airport-add") || chip(rest[at - 1]) || input.current;
      target?.focus();
    });
  }
  return (
    <div
      ref={box}
      className={clsx("airport-picker", error && "is-invalid")}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={error ? errorId : undefined}
      data-airport-field={field}
      data-field={field === "origin" ? "origins" : "destinations"}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <label className="field-label" id={labelId} htmlFor={!values.length || adding ? id : undefined}>
        {label}
      </label>
      {values.length > 0 && (
        <ul className="airport-chips">
          {values.map((code) => {
            // "Cidade · Aeroporto" for every chosen airport, listed in the state or not.
            const record = cache.get(code) || findAirport(code);
            return (
              <li className="airport-chip" key={code} data-airport={code}>
                <b>{code}</b>
                {/* A long name is cut to the column; the full name stays in the text and the tooltip. */}
                {record && <span title={airportLabel(record)}>{airportLabel(record)}</span>}
                <button
                  type="button"
                  aria-label={t("Remover {0} de {1}", [code, label])}
                  onClick={() => remove(code)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {(!values.length || adding) && (
        <div className="combo-anchor">
          <div className={clsx("field-frame combo-field", error && "is-invalid")}>
            <Search size={18} aria-hidden="true" />
            <input
              ref={input}
              id={id}
              role="combobox"
              aria-autocomplete="list"
              aria-invalid={!!error || undefined}
              aria-describedby={error ? errorId : undefined}
              aria-expanded={expanded}
              aria-controls={expanded && results.length ? id + "-list" : undefined}
              aria-activedescendant={expanded && index >= 0 ? `${id}-option-${index}` : undefined}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={full}
              readOnly={batch}
              placeholder={full ? t("Limite de 3 aeroportos") : t("Cidade, aeroporto ou código IATA")}
              value={query}
              onFocus={() => setOpen(true)}
              onChange={(e) => {
                setBatchError("");
                const closed = batch ? null : typedCodes(e.target.value);
                // "GRU+" becomes a chip and the field is cleared for the next airport.
                setQuery(closed ? closed.rest : e.target.value);
                if (closed) void addCodes(closed.codes, true);
                setOpen(true);
              }}
              onPaste={(e) => {
                const pasted = parseCodes(e.clipboardData.getData("text"));
                if (!pasted || batch) return;
                e.preventDefault();
                setQuery(pasted.join("+"));
                void addCodes(pasted);
              }}
              onKeyDown={(e) => {
                if (codes && e.key === "Enter") {
                  e.preventDefault();
                  if (!batch) void addCodes(codes);
                  return;
                }
                const used = comboboxKeyDown(e, {
                  count: results.length,
                  active: index,
                  open: expanded,
                  browsing,
                  setActive: (next) => {
                    setIndex(next);
                    setBrowsing(true);
                  },
                  choose: (i) => choose(results[i]),
                  close: () => setOpen(false),
                  reopen: () => setOpen(true),
                });
                // Enter in the search field never submits the form.
                if (!used && e.key === "Enter") e.preventDefault();
              }}
            />
            {(loading || batch) && <LoaderCircle size={17} className="spin" aria-hidden="true" />}
          </div>
          {expanded && (
            <div className="combo-popup">
              <p className="combo-status" aria-hidden="true">
                {status}
              </p>
              {results.length > 0 && (
                <div
                  ref={list}
                  id={id + "-list"}
                  role="listbox"
                  aria-label={t("Aeroportos de {0}", [label])}
                  className="combo-list"
                >
                  {results.map((a, i) => (
                    <div
                      role="option"
                      tabIndex={-1}
                      id={`${id}-option-${i}`}
                      aria-selected={i === index}
                      key={a.code}
                      className="combo-option airport-option"
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseMove={() => {
                        if (i === index) return;
                        setIndex(i);
                        setBrowsing(true);
                      }}
                      onClick={() => choose(a)}
                    >
                      <span className="airport-option-code">{a.code}</span>
                      <span className="airport-option-text">
                        <span className="airport-option-place">
                          {a.city} <span>· {countryName(a.country)}</span>
                        </span>
                        <span className="airport-option-name">{airportName(a)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {/* The count and errors are announced from outside the listbox. */}
      <p className="sr-only" role="status">
        {expanded ? status : batchError}
      </p>
      {values.length > 0 && !full && !adding && (
        <button
          className="button button-ghost button-small airport-add"
          type="button"
          onClick={() => {
            setAdding(true);
            requestAnimationFrame(() => input.current?.focus());
          }}
        >
          <Plus size={16} aria-hidden="true" />
          {field === "origin" ? t("Adicionar outra origem") : t("Adicionar outro destino")}
        </button>
      )}
      {full && (
        <p className="field-help airport-limit">{batchError || t("Máximo de {0} aeroportos.", [LIMIT])}</p>
      )}
      {adding && values.length > 0 && (
        <button
          className="button button-ghost button-small airport-add"
          type="button"
          onClick={() => {
            setAdding(false);
            setQuery("");
            setOpen(false);
            // This button leaves with the search field: "Adicionar outro…" takes the focus.
            requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(".airport-add")?.focus());
          }}
        >
          {t("Cancelar adição")}
        </button>
      )}
      {error && (
        <p className="field-error" id={errorId}>
          <CircleAlert size={14} aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}
