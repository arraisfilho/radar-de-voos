import { useEffect, useId, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { DayPicker } from "react-day-picker";
import { ptBR, enUS, es } from "react-day-picker/locale";
import { CalendarDays, X } from "lucide-react";
import { getLocale, t } from "./i18n";
import {
  calendarDate,
  calendarValue,
  displayDate,
  typedDate,
  maskDateInput,
} from "./calendarDate";
import "react-day-picker/style.css";
import "./date-picker.css";

export function DatePicker({
  id,
  value,
  onChange,
  label,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(""),
    [error, setError] = useState(""),
    [field, setField] = useState<{ source: string; text: string } | null>(null);
  const fieldInput = useRef<HTMLInputElement>(null);
  const inputId = useId(),
    locale = getLocale(),
    selected = calendarDate(value),
    now = new Date();
  useEffect(() => {
    fieldInput.current?.setCustomValidity("");
    setField(null);
    setError("");
  }, [value, locale]);
  const source = value + locale;
  const fieldText =
    field?.source === source ? field.text : displayDate(value, locale);
  const updateText = (
    input: HTMLInputElement,
    main = false,
    raw = input.value,
    caret = input.selectionStart ?? raw.length,
  ) => {
    const valid = typedDate(raw, locale);
    const normalized = valid ? displayDate(valid, locale) : raw;
    const masked = maskDateInput(
      normalized,
      normalized === raw ? caret : normalized.length,
    );
    if (main) setField({ source, text: masked.text });
    else setDraft(masked.text);
    setError("");
    if (main) {
      const next = typedDate(masked.text, locale);
      input.setCustomValidity(next ? "" : t("Informe uma data válida."));
      if (next) {
        onChange(next);
        setField(null);
      }
    }
    requestAnimationFrame(() =>
      input.setSelectionRange(masked.caret, masked.caret),
    );
  };
  const deletion = (e: React.KeyboardEvent<HTMLInputElement>, main = false) => {
    const input = e.currentTarget,
      start = input.selectionStart,
      end = input.selectionEnd;
    if (start == null || start !== end) return;
    if (e.key === "Backspace" && input.value[start - 1] === "/") {
      e.preventDefault();
      updateText(
        input,
        main,
        input.value.slice(0, start - 2) + input.value.slice(start),
        start - 2,
      );
    } else if (e.key === "Delete" && input.value[start] === "/") {
      e.preventDefault();
      updateText(
        input,
        main,
        input.value.slice(0, start) + input.value.slice(start + 2),
        start,
      );
    }
  };
  const year = selected?.getFullYear() || now.getFullYear();
  const choose = (date: Date) => {
    fieldInput.current?.setCustomValidity("");
    setField(null);
    setError("");
    onChange(calendarValue(date));
    setOpen(false);
  };
  const apply = () => {
    const next = typedDate(draft, locale);
    if (!next) {
      setError(t("Informe uma data válida."));
      return;
    }
    fieldInput.current?.setCustomValidity("");
    setField(null);
    setError("");
    onChange(next);
    setOpen(false);
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraft(displayDate(value, locale));
          setError("");
        }
      }}
    >
      <Popover.Anchor asChild>
        <div className="date-field">
          <input
            ref={fieldInput}
            id={id}
            type="text"
            inputMode="numeric"
            required
            data-date-trigger
            aria-label={label}
            value={fieldText}
            maxLength={10}
            placeholder={displayDate("2026-12-31", locale)}
            onChange={(e) => updateText(e.currentTarget, true)}
            onBlur={(e) => {
              if (!typedDate(e.currentTarget.value, locale))
                setError(t("Informe uma data válida."));
            }}
            onKeyDown={(e) => {
              deletion(e, true);
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.reportValidity();
              }
            }}
          />
          <Popover.Trigger asChild>
            <button
              type="button"
              className="date-calendar-button"
              aria-label={t("Abrir calendário") + ": " + label}
            >
              <CalendarDays size={18} aria-hidden="true" />
            </button>
          </Popover.Trigger>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          className="calendar-popover"
          sideOffset={8}
          collisionPadding={12}
          align="start"
          aria-label={label}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="calendar-top">
            <strong>{label}</strong>
            <Popover.Close
              className="calendar-close"
              aria-label={t("Fechar calendário")}
            >
              <X size={18} />
            </Popover.Close>
          </div>
          <DayPicker
            mode="single"
            required
            selected={selected}
            defaultMonth={selected}
            locale={
              locale.startsWith("pt")
                ? ptBR
                : locale.startsWith("es")
                  ? es
                  : enUS
            }
            captionLayout="dropdown"
            navLayout="around"
            fixedWeeks
            showOutsideDays
            autoFocus
            startMonth={new Date(Math.min(now.getFullYear() - 1, year), 0, 1)}
            endMonth={new Date(Math.max(now.getFullYear() + 10, year), 11, 31)}
            onSelect={(date) => {
              if (date) choose(date);
            }}
          />
          <div className="calendar-manual">
            <label htmlFor={inputId}>{t("Digitar data")}</label>
            <div>
              <input
                id={inputId}
                type="text"
                inputMode="numeric"
                value={draft}
                placeholder={displayDate("2026-12-31", locale)}
                aria-invalid={!!error}
                aria-describedby={error ? inputId + "error" : undefined}
                maxLength={10}
                onChange={(e) => updateText(e.currentTarget)}
                onKeyDown={(e) => {
                  deletion(e);
                  if (e.key === "Enter") {
                    e.preventDefault();
                    apply();
                  }
                }}
              />
              <button type="button" onClick={apply}>
                {t("Aplicar")}
              </button>
            </div>
            {error && (
              <p id={inputId + "error"} role="alert">
                {error}
              </p>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
