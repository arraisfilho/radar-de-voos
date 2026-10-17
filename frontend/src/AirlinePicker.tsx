import { useEffect, useId, useRef, useState } from "react";
import { CircleAlert, LoaderCircle, Search, X } from "lucide-react";
import { clsx } from "clsx";
import { t, useLanguage } from "./i18n";
import { comboboxKeyDown, revealActive } from "./combobox";
import { plural } from "./plural";

type Airline = { code: string; name: string; custom: boolean };
const LIMIT = 20;
const cache = new Map<string, Airline>();

/** Airlines allowed on one leg; with none selected, every airline counts. */
export function AirlinePicker({
  values,
  onChange,
}: {
  values: string[];
  onChange: (codes: string[]) => void;
}) {
  const language = useLanguage(),
    id = useId(),
    input = useRef<HTMLInputElement>(null),
    list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<Airline[]>([]),
    [open, setOpen] = useState(false),
    [index, setIndex] = useState(0),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(""),
    [, refresh] = useState(0),
    [unfinished, setUnfinished] = useState(false);
  useEffect(() => {
    const missing = values.filter((code) => !cache.has(code));
    if (!missing.length) return;
    const controller = new AbortController();
    fetch("/api/airlines?codes=" + encodeURIComponent(missing.join(",")), { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw Error();
        const items: Airline[] = await r.json();
        if (controller.signal.aborted) return;
        items.forEach((item) => cache.set(item.code, item));
        refresh((n) => n + 1);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [values.join(",")]);
  // Text left in the field must be chosen from the list or cleared before saving.
  useEffect(() => {
    input.current?.setCustomValidity(
      query.trim() ? t("Selecione uma companhia da lista ou limpe o campo.") : "",
    );
    if (!query.trim()) setUnfinished(false);
  }, [query, language]);
  useEffect(() => {
    setResults([]);
    setIndex(0);
    setFailure("");
    if (query.trim().length < 2 || values.length >= LIMIT) {
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const r = await fetch("/api/airlines?q=" + encodeURIComponent(query.trim()), { signal: controller.signal });
        if (!r.ok) throw Error(t("Não foi possível buscar as companhias."));
        const items: Airline[] = await r.json();
        if (controller.signal.aborted) return;
        items.forEach((item) => cache.set(item.code, item));
        setResults(items.filter((item) => !values.includes(item.code)));
      } catch (e) {
        if (!controller.signal.aborted) setFailure((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, values.join(",")]);
  useEffect(() => revealActive(list.current), [index, results]);
  function choose(item: Airline) {
    if (values.includes(item.code) || values.length >= LIMIT) return;
    cache.set(item.code, item);
    onChange([...values, item.code]);
    setQuery("");
    input.current?.setCustomValidity("");
    setUnfinished(false);
    setOpen(false);
    setIndex(0);
    input.current?.focus();
  }
  const full = values.length >= LIMIT;
  const expanded = open && query.trim().length >= 2 && !full;
  const helpId = id + "-help",
    errorId = id + "-error";
  const status = busy
    ? t("Buscando…")
    : failure
      ? failure
      : results.length
        ? plural(results.length, "{0} companhia encontrada", "{0} companhias encontradas")
        : t("Nenhuma companhia encontrada. Tente o nome ou a sigla.");
  const name = (code: string) => cache.get(code)?.name || code;
  return (
    <div
      className="airline-picker"
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setOpen(false);
        if (query.trim()) setUnfinished(true);
      }}
    >
      <label className="field-label" htmlFor={id}>
        {t("Companhia aérea")} <span className="field-optional">{t("Opcional")}</span>
      </label>
      {!full && (
        <div className="combo-anchor">
          <div className={clsx("field-frame combo-field", unfinished && "is-invalid")}>
            <Search size={18} aria-hidden="true" />
            <input
              ref={input}
              id={id}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={expanded}
              aria-controls={expanded && results.length ? id + "-list" : undefined}
              aria-activedescendant={expanded && results[index] ? `${id}-${results[index].code}` : undefined}
              aria-invalid={unfinished || undefined}
              aria-describedby={clsx(unfinished && errorId, helpId)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder={t("Nome ou sigla: LATAM, LA…")}
              value={query}
              onFocus={() => setOpen(true)}
              onClick={() => setOpen(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onKeyDown={(e) => {
                const used = comboboxKeyDown(e, {
                  count: results.length,
                  active: index,
                  open: expanded,
                  setActive: setIndex,
                  choose: (n) => choose(results[n]),
                  close: () => setOpen(false),
                  reopen: () => setOpen(true),
                });
                // Enter never submits half-typed text: it asks for a choice instead.
                if (!used && e.key === "Enter" && query.trim()) {
                  e.preventDefault();
                  setUnfinished(true);
                }
              }}
            />
            {busy && <LoaderCircle className="spin" size={16} aria-hidden="true" />}
          </div>
          {expanded && (
            <div className="combo-popup">
              <p className="combo-status" aria-hidden="true">
                {status}
              </p>
              {!busy && results.length > 0 && (
                <div
                  ref={list}
                  className="combo-list"
                  id={id + "-list"}
                  role="listbox"
                  aria-label={t("Companhias encontradas")}
                >
                  {results.map((item, n) => (
                    <div
                      role="option"
                      aria-selected={index === n}
                      tabIndex={-1}
                      id={`${id}-${item.code}`}
                      key={item.code}
                      className="combo-option airline-option"
                      onMouseMove={() => n !== index && setIndex(n)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(item)}
                    >
                      <span>{item.custom ? t("Usar sigla informada") : item.name}</span>
                      <b>{item.code}</b>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <p className="sr-only" role="status">
        {expanded ? status : ""}
      </p>
      {unfinished && (
        <p className="field-error" id={errorId}>
          <CircleAlert size={14} aria-hidden="true" />
          {t("Selecione uma companhia da lista ou limpe o campo.")}
        </p>
      )}
      {values.length > 0 && (
        <div className="airline-tokens">
          <ul className="token-list">
            {values.map((code) => (
              <li key={code} className="token">
                <span className="token-label" title={name(code)}>
                  {name(code)}
                </span>
                <b>{code}</b>
                <button
                  type="button"
                  aria-label={t("Remover companhia {0}", [name(code)])}
                  onClick={() => onChange(values.filter((v) => v !== code))}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={() => {
              onChange([]);
              setQuery("");
              setOpen(false);
            }}
          >
            {t("Limpar")}
          </button>
        </div>
      )}
      <p id={helpId} className="field-help">
        {full
          ? t("Até 20 companhias por trecho.")
          : values.length
            ? t("A busca usará somente as companhias selecionadas.")
            : t("Sem seleção, todas as companhias.")}
      </p>
    </div>
  );
}
