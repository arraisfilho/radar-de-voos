import { getLocale } from "./i18n";

/**
 * A Date as is, a Unix epoch in seconds (as the backend sends it) or a local
 * "YYYY-MM-DD", "YYYY-MM-DDTHH:mm" or "YYYY-MM-DDTHH:mm:ss".
 */
export type DateValue = Date | number | string;
type DateStyle = "numeric" | "short" | "medium" | "long";

const EMPTY = "—";
const DAY = 86_400_000;
const LOCAL_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const DATE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  numeric: { day: "2-digit", month: "2-digit" },
  short: { day: "numeric", month: "short" },
  medium: { day: "numeric", month: "short", year: "numeric" },
  long: { weekday: "long", day: "numeric", month: "long", year: "numeric" },
};
const NUMERIC_WITH_YEAR: Intl.DateTimeFormatOptions = {
  ...DATE_OPTIONS.numeric,
  year: "2-digit",
};

// Building an Intl formatter is costly: keep one per locale and options. The
// locale is part of the key because the language can change at runtime.
function memo<Options extends object, Formatter>(
  create: (locale: string, options: Options) => Formatter,
): (options: Options) => Formatter {
  const formatters = new Map<string, Formatter>();
  return (options) => {
    const locale = getLocale();
    const key = locale + JSON.stringify(options);
    let formatter = formatters.get(key);
    if (!formatter) formatters.set(key, (formatter = create(locale, options)));
    return formatter;
  };
}
const dateFormat = memo(
  (locale: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, options),
);
const numberFormat = memo(
  (locale: string, options: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat(locale, options),
);
const relativeFormat = memo(
  (locale: string, options: Intl.RelativeTimeFormatOptions) =>
    new Intl.RelativeTimeFormat(locale, options),
);
const listFormat = memo(
  (locale: string, options: Intl.ListFormatOptions) =>
    new Intl.ListFormat(locale, options),
);

const isValid = (date: Date) => !Number.isNaN(date.getTime());
// Local calendar day as a whole number of days, unaffected by DST changes.
const dayNumber = (date: Date) =>
  Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY;
// Half away from zero, so the past and the future round alike.
const round = (value: number) =>
  Math.sign(value) * Math.round(Math.abs(value));

// Two-digit hours on 24-hour clocks ("09:05"), plain hours on 12-hour clocks
// ("9:05 AM").
function clock(): Intl.DateTimeFormatOptions {
  const twelveHour = dateFormat({ hour: "numeric" }).resolvedOptions().hour12;
  return { hour: twelveHour ? "numeric" : "2-digit", minute: "2-digit" };
}

function formatWith(
  value: DateValue,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = toDate(value);
  return isValid(date) ? dateFormat(options).format(date) : EMPTY;
}

/**
 * number: Unix epoch in seconds. "YYYY-MM-DD": that local day at noon, which
 * no DST change can move to another day. "YYYY-MM-DDTHH:mm[:ss]": that local
 * wall-clock time, without time zone conversion. Any other string, including
 * impossible dates such as "2026-02-30", gives an invalid Date.
 */
export function toDate(value: DateValue): Date {
  if (typeof value === "number") return new Date(value * 1000);
  if (typeof value !== "string")
    return value instanceof Date ? value : new Date(NaN);
  const match = LOCAL_DATE.exec(value);
  if (!match) return new Date(NaN);
  const [, y, mo, d, h = "12", mi = "0", s = "0"] = match;
  const [year, month, day, hour, minute, second] = [y, mo, d, h, mi, s].map(
    Number,
  );
  const valid =
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= new Date(Date.UTC(year, month, 0)).getUTCDate() &&
    hour < 24 &&
    minute < 60 &&
    second < 60;
  return valid
    ? new Date(year, month - 1, day, hour, minute, second)
    : new Date(NaN);
}

/**
 * "numeric": "11/12" (pt-BR), "12/11" (en-US). "short": "11 de dez.".
 * "medium" (default): "11 de dez. de 2026".
 * "long": "sexta-feira, 11 de dezembro de 2026".
 */
export function formatDate(
  value: DateValue,
  style: DateStyle = "medium",
): string {
  return formatWith(value, DATE_OPTIONS[style]);
}

/**
 * A single calendar day (or no end) prints as formatDate. "numeric" adds a
 * 2-digit year when the years differ: "30/12/26 – 02/01/27".
 */
export function formatDateRange(
  start: DateValue,
  end?: DateValue | null,
  style: DateStyle = "medium",
): string {
  if (end == null) return formatDate(start, style);
  let from = toDate(start),
    to = toDate(end);
  if (!isValid(from) || !isValid(to)) return EMPTY;
  // Older engines throw a RangeError for a reversed range.
  if (from.getTime() > to.getTime()) [from, to] = [to, from];
  if (dayNumber(from) === dayNumber(to)) return formatDate(from, style);
  const options =
    style === "numeric" && from.getFullYear() !== to.getFullYear()
      ? NUMERIC_WITH_YEAR
      : DATE_OPTIONS[style];
  return dateFormat(options).formatRange(from, to);
}

/** Hours and minutes, no seconds: "22:05" (pt-BR), "10:05 PM" (en-US). */
export function formatTime(value: DateValue): string {
  return formatWith(value, clock());
}

/**
 * "medium" (default): "11 de dez. de 2026, 22:05".
 * "numeric": "11/12, 22:05".
 */
export function formatDateTime(
  value: DateValue,
  style: "numeric" | "medium" = "medium",
): string {
  return formatWith(value, { ...DATE_OPTIONS[style], ...clock() });
}

/**
 * Compact date and time for lists and tables: "11/12, 22:05" within the
 * current year, "11/12/25, 22:05" in any other (pt-BR), so an old record or a
 * trip next year never reads as this year's. `now` defaults to this instant.
 */
export function formatDateTimeCompact(value: DateValue, now?: DateValue): string {
  const date = toDate(value),
    reference = now == null ? new Date() : toDate(now);
  if (!isValid(date)) return EMPTY;
  const thisYear = isValid(reference) && reference.getFullYear() === date.getFullYear();
  return dateFormat({ ...(thisYear ? DATE_OPTIONS.numeric : NUMERIC_WITH_YEAR), ...clock() }).format(date);
}

/**
 * A departure window without the year: "12 de dez., 08:00 – 14 de dez., 23:59",
 * or "12 de dez. 08:00 – 23:59" within one day (pt-BR).
 */
export function formatDateTimeRange(start: DateValue, end: DateValue): string {
  let from = toDate(start),
    to = toDate(end);
  if (!isValid(from) || !isValid(to)) return EMPTY;
  // Older engines throw a RangeError for a reversed range.
  if (from.getTime() > to.getTime()) [from, to] = [to, from];
  return dateFormat({ ...DATE_OPTIONS.short, ...clock() }).formatRange(from, to);
}

/**
 * Day heading for lists: "Hoje", "Ontem", otherwise the long date
 * ("Sexta-feira, 11 de dezembro de 2026"), always capitalized.
 */
export function formatDay(value: DateValue, now?: DateValue): string {
  const date = toDate(value),
    reference = now == null ? new Date() : toDate(now);
  if (!isValid(date) || !isValid(reference)) return EMPTY;
  const days = dayNumber(date) - dayNumber(reference);
  const text =
    days === 0 || days === -1
      ? relativeFormat({ numeric: "auto", style: "long" }).format(days, "day")
      : formatDate(date, "long");
  return text.charAt(0).toLocaleUpperCase(getLocale()) + text.slice(1);
}

/** Local calendar day of a value as "YYYY-MM-DD", to group lists by day. */
export function dayKey(value: DateValue): string {
  const date = toDate(value);
  if (!isValid(date)) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * "agora", "há 5 min.", "há 3 h", "ontem", "em 5 min." (pt-BR, "short").
 * A week or more away falls back to formatDate(value, "medium"). `now`
 * follows DateValue (number = seconds) and defaults to the current instant.
 */
export function formatRelative(
  value: DateValue,
  now?: DateValue,
  style: "long" | "short" | "narrow" = "short",
): string {
  const date = toDate(value),
    reference = now == null ? new Date() : toDate(now);
  if (!isValid(date) || !isValid(reference)) return EMPTY;
  const seconds = (date.getTime() - reference.getTime()) / 1000,
    distance = Math.abs(seconds);
  if (distance >= 7 * 86_400) return formatDate(date, "medium");
  const relative = relativeFormat({ numeric: "auto", style });
  if (distance < 45) return relative.format(0, "second");
  if (distance < 45 * 60)
    return relative.format(round(seconds / 60), "minute");
  if (distance < 22 * 3600)
    return relative.format(round(seconds / 3600), "hour");
  // Calendar days, so that any time yesterday reads "ontem".
  return relative.format(dayNumber(date) - dayNumber(reference), "day");
}

/**
 * Amount in cents: "R$ 1.108" when the cents are zero, "R$ 1.108,50"
 * otherwise. Missing or non-finite amounts and unknown currencies give "—".
 */
export function formatMoney(
  cents: number | null | undefined,
  currency = "BRL",
): string {
  if (cents == null || !Number.isFinite(cents)) return EMPTY;
  // Whole cents; `|| 0` also turns -0 into 0, which would print as "-R$ 0".
  const amount = Math.round(cents) || 0;
  const digits =
    amount % 100 === 0
      ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
      : {};
  try {
    return numberFormat({ style: "currency", currency, ...digits }).format(
      amount / 100,
    );
  } catch {
    return EMPTY;
  }
}

/**
 * The sign the current locale writes for a currency, for a field prefix:
 * "R$", "US$" or "€" (pt-BR). Unknown codes give the code itself.
 */
export function currencySymbol(currency: string): string {
  try {
    return (
      numberFormat({ style: "currency", currency })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value || currency
    );
  } catch {
    return currency;
  }
}

/** Plain number in the current locale: formatNumber(0.1123, 2) → "0,11" (pt-BR). */
export function formatNumber(value: number, maximumFractionDigits = 0): string {
  return Number.isFinite(value) ? numberFormat({ maximumFractionDigits }).format(value) : EMPTY;
}

/**
 * Minutes: "45 min", "2 h", "2 h 30 min" (pt-BR). Negative or non-finite
 * values give "—".
 */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return EMPTY;
  const total = Math.round(minutes) || 0,
    hours = Math.floor(total / 60),
    rest = total % 60;
  const unit = (name: "hour" | "minute", amount: number) =>
    numberFormat({ style: "unit", unit: name, unitDisplay: "short" }).format(
      amount,
    );
  const parts = hours ? [unit("hour", hours)] : [];
  if (rest || !hours) parts.push(unit("minute", rest));
  return listFormat({ type: "unit", style: "narrow" }).format(parts);
}
