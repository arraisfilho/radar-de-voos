import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Dialog from "@radix-ui/react-dialog";
import { DayPicker } from "react-day-picker";
import { ptBR, enUS, es } from "react-day-picker/locale";
import { CalendarDays, CircleAlert, X } from "lucide-react";
import { clsx } from "clsx";
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

/**
 * Phones get the calendar as a bottom sheet; larger screens as a popover. A
 * window too short for the popover above or below a field (about 480 px of
 * calendar) gets the dialog too, which scrolls inside without cutting a control.
 */
const SHEET = "(max-width: 767px), (max-height: 560px)";
const sheetLayout = () =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(SHEET).matches;

export function DatePicker({
  id,
  value,
  onChange,
  label,
  min,
  allowed,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  /** Earliest date ("YYYY-MM-DD") that can be chosen or typed; earlier days are disabled. */
  min?: string;
  /** A date before `min` that stays available, such as the saved start of a trip in progress. */
  allowed?: string;
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(""),
    [error, setError] = useState(""),
    [field, setField] = useState<{ source: string; text: string } | null>(null),
    [fieldError, setFieldError] = useState(""),
    [sheet, setSheet] = useState(sheetLayout());
  const fieldInput = useRef<HTMLInputElement>(null);
  const inputId = useId(),
    errorId = id + "-error",
    locale = getLocale(),
    selected = calendarDate(value),
    now = new Date();
  /** Days before `min` cannot be chosen, except the one kept by `allowed`. */
  const tooEarly = (date: string) => !!min && date < min && date !== allowed;
  const earlyMessage = t("Escolha uma data a partir de hoje.");
  // A saved value before the limit (a draft from earlier days) shows its error in place.
  const valueTooEarly = !!value && tooEarly(value);
  useEffect(() => {
    fieldInput.current?.setCustomValidity(valueTooEarly ? earlyMessage : "");
    setField(null);
    setError("");
    setFieldError("");
  }, [value, locale, valueTooEarly]);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia(SHEET);
    const update = () => setSheet(media.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
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
      const early = !!next && tooEarly(next);
      input.setCustomValidity(!next ? t("Informe uma data válida.") : early ? earlyMessage : "");
      if (next) {
        // A complete date before the limit stays in the field with its error, unsaved.
        setFieldError(early ? earlyMessage : "");
        if (!early) {
          onChange(next);
          setField(null);
        }
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
    setFieldError("");
    onChange(calendarValue(date));
    setOpen(false);
  };
  const apply = () => {
    const next = typedDate(draft, locale);
    if (!next) {
      setError(t("Informe uma data válida."));
      return;
    }
    if (tooEarly(next)) {
      setError(earlyMessage);
      return;
    }
    fieldInput.current?.setCustomValidity("");
    setField(null);
    setError("");
    setFieldError("");
    onChange(next);
    setOpen(false);
  };
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (next) {
      setDraft(displayDate(value, locale));
      setError("");
    }
  };
  const shownError = fieldError || (valueTooEarly ? earlyMessage : "");
  const dateField = (trigger: ReactNode) => (
    <div className={clsx("date-field field-frame", shownError && "is-invalid")}>
      <input
        ref={fieldInput}
        id={id}
        type="text"
        inputMode="numeric"
        required
        data-date-trigger
        aria-label={label}
        aria-invalid={!!shownError || undefined}
        aria-describedby={shownError ? errorId : undefined}
        value={fieldText}
        maxLength={10}
        placeholder={displayDate("2026-12-31", locale)}
        onChange={(e) => updateText(e.currentTarget, true)}
        onBlur={(e) => {
          const typed = typedDate(e.currentTarget.value, locale);
          if (!typed) setFieldError(t("Informe uma data válida."));
          else if (tooEarly(typed)) setFieldError(earlyMessage);
        }}
        onKeyDown={(e) => {
          deletion(e, true);
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.reportValidity();
          }
        }}
      />
      {trigger}
    </div>
  );
  const calendarButton = (
    <button
      type="button"
      className="date-calendar-button"
      aria-label={t("Abrir calendário") + ": " + label}
    >
      <CalendarDays size={18} aria-hidden="true" />
    </button>
  );
  // The error stays next to the field it belongs to.
  const errorNote = shownError && (
    <p className="field-error" id={errorId}>
      <CircleAlert size={14} aria-hidden="true" />
      {shownError}
    </p>
  );
  // With a limit, the month list starts at the earliest date that can be seen.
  const limit = min ? calendarDate(allowed && allowed < min ? allowed : min) : undefined;
  const first = limit && selected && selected < limit ? selected : limit;
  const days = (
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
      startMonth={
        first
          ? new Date(first.getFullYear(), first.getMonth(), 1)
          : new Date(Math.min(now.getFullYear() - 1, year), 0, 1)
      }
      endMonth={new Date(Math.max(now.getFullYear() + 10, year), 11, 31)}
      disabled={min ? (date: Date) => tooEarly(calendarValue(date)) : undefined}
      onSelect={(date) => {
        if (date) choose(date);
      }}
    />
  );
  const manual = (
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
        <button type="button" className="button button-outline" onClick={apply}>
          {t("Aplicar")}
        </button>
      </div>
      {error && (
        <p id={inputId + "error"} className="field-error" role="alert">
          <CircleAlert size={14} aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
  if (sheet)
    return (
      <Dialog.Root open={open} onOpenChange={changeOpen}>
        {dateField(<Dialog.Trigger asChild>{calendarButton}</Dialog.Trigger>)}
        {errorNote}
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="dialog calendar-sheet"
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="calendar-top">
              <Dialog.Title className="calendar-title">{label}</Dialog.Title>
              <Dialog.Close className="calendar-close" aria-label={t("Fechar calendário")}>
                <X size={18} aria-hidden="true" />
              </Dialog.Close>
            </div>
            {days}
            {manual}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Anchor asChild>
        {dateField(<Popover.Trigger asChild>{calendarButton}</Popover.Trigger>)}
      </Popover.Anchor>
      {errorNote}
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
            <strong className="calendar-title">{label}</strong>
            <Popover.Close
              className="calendar-close"
              aria-label={t("Fechar calendário")}
            >
              <X size={18} aria-hidden="true" />
            </Popover.Close>
          </div>
          {days}
          {manual}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
