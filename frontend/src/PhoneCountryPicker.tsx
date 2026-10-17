import { useId, useLayoutEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { getLocale, t } from "./i18n";
import { comboboxKeyDown, revealActive } from "./combobox";
import { filterPhoneCountries, phoneCountries } from "./phoneCountries";
import "./phone-field.css";

export function PhoneCountryPicker({ country, label, disabled, onChange }: {
  country: string;
  label: string;
  disabled: boolean;
  onChange: (country: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const countries = phoneCountries(getLocale());
  const selected = countries.find((option) => option.code === country)!;
  const matches = filterPhoneCountries(countries, query);
  const status = matches.length
    ? t(matches.length === 1 ? "{0} país encontrado" : "{0} países encontrados", [matches.length])
    : t("Nenhum país encontrado.");
  const choose = (code: string) => {
    onChange(code);
    setOpen(false);
  };
  useLayoutEffect(() => {
    if (open) revealActive(list.current);
  }, [open, active, query]);
  return <Popover.Root open={open} onOpenChange={(next) => {
    setOpen(next);
    if (next) {
      setQuery("");
      setActive(countries.findIndex((option) => option.code === country));
    }
  }}>
    <Popover.Trigger asChild>
      <button type="button" className="phone-country-trigger" disabled={disabled}
        aria-label={`${t("País e código internacional de {0}", [label])}: ${selected.name} +${selected.callingCode}`}>
        <span aria-hidden="true">{selected.flag}</span>
        <span className="phone-country-name">{selected.name}</span>
        <span className="phone-country-dial">+{selected.callingCode}</span>
        <ChevronDown size={17} aria-hidden="true" />
      </button>
    </Popover.Trigger>
    {/* The count is announced from outside the listbox, as in the other pickers. */}
    <p className="sr-only" role="status">{open ? status : ""}</p>
    <Popover.Portal>
      <Popover.Content className="phone-country-popover" sideOffset={6} collisionPadding={12} align="start"
        aria-label={t("Escolher país")}
        onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus(); }}>
        <div className="phone-country-search">
          <Search size={17} aria-hidden="true" />
          <input ref={input} type="search" role="combobox" autoComplete="off" spellCheck={false}
            aria-label={t("Buscar país ou DDI")} placeholder={t("Nome do país ou DDI (+55)")}
            aria-controls={id} aria-expanded={open} aria-autocomplete="list"
            aria-activedescendant={matches[active] ? `${id}-${matches[active].code}` : undefined}
            value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }}
            onKeyDown={(event) => {
              const used = comboboxKeyDown(event, {
                count: matches.length,
                active,
                open,
                setActive,
                choose: (index) => choose(matches[index].code),
                close: () => setOpen(false),
              });
              if (!used && event.key === "Enter") event.preventDefault();
            }} />
          <Popover.Close className="phone-country-close" aria-label={t("Fechar lista de países")}>
            <X size={17} aria-hidden="true" />
          </Popover.Close>
        </div>
        <p className="phone-country-count" aria-hidden="true">{status}</p>
        <div ref={list} id={id} role="listbox" aria-label={t("Países e códigos internacionais")} className="phone-country-list">
          {matches.map((option, index) => <div key={option.code} role="option" tabIndex={-1}
            id={`${id}-${option.code}`} aria-selected={index === active}
            className={option.code === country ? "combo-option is-current" : "combo-option"}
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => index !== active && setActive(index)}
            onClick={() => choose(option.code)}>
            <span aria-hidden="true">{option.flag}</span>
            <span className="phone-country-name">{option.name}</span>
            <span className="phone-country-code">+{option.callingCode}</span>
            {option.code === country && <Check size={16} aria-hidden="true" />}
          </div>)}
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
