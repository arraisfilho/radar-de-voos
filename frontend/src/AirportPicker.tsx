import { t } from "./i18n";
import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, Search, X } from "lucide-react";
import type { Airport } from "./types";
const cache = new Map<string, Airport>(),
  countries = new Intl.DisplayNames(["pt-BR"], { type: "region" });
export function AirportPicker({
  label,
  values,
  onChange,
  airports,
  onSelected,
  field,
  invalid,
  describedBy,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  airports: Airport[];
  onSelected?: () => void;
  field?: "origin" | "destination";
  invalid?: boolean;
  describedBy?: string;
}) {
  const id = useId(),
    input = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<Airport[]>([]),
    [open, setOpen] = useState(false),
    [index, setIndex] = useState(-1),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  airports.forEach((a) => cache.set(a.code, a));
  useEffect(() => {
    setIndex(-1);
    setResults([]);
    setError("");
    if (query.trim().length < 2 || values.length >= 3) {
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
        setResults(items.filter((a) => !values.includes(a.code)));
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : t("Falha na consulta"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, values.join(",")]);
  function choose(a: Airport) {
    onChange([...values, a.code]);
    setQuery("");
    setOpen(false);
    setIndex(-1);
    setAdding(false);
    requestAnimationFrame(() => onSelected?.());
  }
  return (
    <div
      className="airport-picker"
      data-airport={label}
      data-airport-field={field}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <label htmlFor={id}>{label}</label>
      {values.length > 0 && (
        <div className="selected-airports">
          {values.map((code) => (
            <span className="airport-tag" key={code}>
              <b>{code}</b>
              <span>{cache.get(code)?.city}</span>
              <button
                type="button"
                aria-label={t("Remover {0} de {1}", [code, label])}
                onClick={() => onChange(values.filter((v) => v !== code))}
              >
                <X size={16} />
              </button>
            </span>
          ))}
        </div>
      )}
      {(!values.length || adding) && (
        <div className="airport-combobox">
          <Search size={18} aria-hidden />
          <input
            ref={input}
            id={id}
            role="combobox"
            aria-autocomplete="list"
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            aria-expanded={open && query.trim().length >= 2}
            aria-controls={id + "-list"}
            aria-activedescendant={
              index >= 0 ? id + "-option-" + index : undefined
            }
            autoComplete="off"
            disabled={values.length >= 3}
            placeholder={
              values.length >= 3
                ? t("Limite de 3 aeroportos")
                : t("Cidade, aeroporto ou código IATA")
            }
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
                setIndex((i) => Math.min(i + 1, results.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              }
              if (e.key === "Enter") {
                e.preventDefault();
                if (open && index >= 0 && results[index])
                  choose(results[index]);
              }
            }}
          />
          {loading && (
            <LoaderCircle
              size={17}
              className="spin"
              aria-label={t("Consultando")}
            />
          )}
        </div>
      )}
      {values.length > 0 && values.length < 3 && !adding && (
        <button
          className="add-airport"
          type="button"
          onClick={() => {
            setAdding(true);
            requestAnimationFrame(() => input.current?.focus());
          }}
        >
          {label === t("Origem") ? t("Adicionar outra origem") : t("Adicionar outro destino")}
        </button>
      )}
      {adding && values.length > 0 && (
        <button
          className="cancel-airport"
          type="button"
          onClick={() => {
            setAdding(false);
            setQuery("");
            setOpen(false);
          }}
        >
          {t("Cancelar adição")}
        </button>
      )}
      {open && query.trim().length >= 2 && values.length < 3 && (
        <div className="airport-results">
          <div className="airport-result-status" role="status">
            {loading
              ? t("Buscando no catálogo mundial…")
              : error ||
                (!results.length
                  ? t(
                      "Nenhum aeroporto encontrado. Tente o nome local ou código IATA.",
                    )
                  : t("{0} aeroportos encontrados. Selecione uma opção.", [
                      results.length,
                    ]))}
          </div>
          <div
            id={id + "-list"}
            role="listbox"
            aria-label={t("Aeroportos de {0}", [label])}
          >
            {results.map((a, i) => (
              <button
                type="button"
                role="option"
                id={id + "-option-" + i}
                aria-selected={i === index}
                key={a.code}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(a)}
              >
                <b>{a.code}</b>
                <span>
                  <strong>
                    {a.city} <small>· {countries.of(a.country)}</small>
                  </strong>
                  <small>{a.name}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
