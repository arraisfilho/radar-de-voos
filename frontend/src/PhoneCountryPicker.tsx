import { useId, useLayoutEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { getLocale, t } from "./i18n";
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
  const choose = (code: string) => {
    onChange(code);
    setOpen(false);
  };
  useLayoutEffect(() => {
    if (open && active >= 0) list.current?.querySelectorAll<HTMLElement>('[role="option"]')[active]?.scrollIntoView({ block: "nearest" });
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
        aria-label={t("País e código internacional de {0}", [label])}>
        <span aria-hidden="true">{selected.flag}</span>
        <span className="phone-country-name">{selected.name}</span>
        <span>+{selected.callingCode}</span>
        <ChevronDown size={17} aria-hidden="true" />
      </button>
    </Popover.Trigger>
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
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setActive((current) => Math.max(0, Math.min(matches.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))));
              }
              if (event.key === "Enter") {
                event.preventDefault();
                if (matches[active]) choose(matches[active].code);
              }
            }} />
          <Popover.Close className="phone-country-close" aria-label={t("Fechar lista de países")}>
            <X size={17} aria-hidden="true" />
          </Popover.Close>
        </div>
        <p className="phone-country-count" role="status">{matches.length ? t(matches.length === 1 ? "{0} país encontrado" : "{0} países encontrados", [matches.length]) : t("Nenhum país encontrado.")}</p>
        <div ref={list} id={id} role="listbox" aria-label={t("Países e códigos internacionais")} className="phone-country-list">
          {matches.map((option, index) => <button key={option.code} type="button" role="option" tabIndex={-1}
            id={`${id}-${option.code}`} aria-selected={option.code === country} data-active={index === active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(option.code)}>
            <span aria-hidden="true">{option.flag}</span>
            <span className="phone-country-name">{option.name}</span>
            <span className="phone-country-code">+{option.callingCode}</span>
            {option.code === country && <Check size={16} aria-hidden="true" />}
          </button>)}
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
