// Calendar dates stay local: UTC conversion can move the selected day in some zones.
export function calendarDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  if (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  )
    return date;
}
export function calendarValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function displayDate(value: string, locale: string): string {
  const date = calendarDate(value);
  return date
    ? date.toLocaleDateString(locale, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "";
}
export function typedDate(value: string, locale: string): string | undefined {
  const numbers = value.trim().split(/[\/\.\-\s]+/);
  if (numbers.length !== 3 || numbers.some((n) => !/^\d+$/.test(n))) return;
  const order = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
    .formatToParts(new Date(2000, 10, 22))
    .filter((p) => ["year", "month", "day"].includes(p.type));
  const parts = Object.fromEntries(order.map((p, i) => [p.type, numbers[i]]));
  if (parts.year.length !== 4) return;
  const iso = `${parts.year}-${parts.month.padStart(2, "0")}-${parts.day.padStart(2, "0")}`;
  return calendarDate(iso) ? iso : undefined;
}

/** Mask the localized numeric date while preserving the digit position of the caret. */
export function maskDateInput(
  raw: string,
  caret = raw.length,
): { text: string; caret: number } {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const before = Math.min(raw.slice(0, caret).replace(/\D/g, "").length, 8);
  const text =
    digits.slice(0, 2) +
    (digits.length >= 2 ? "/" : "") +
    digits.slice(2, 4) +
    (digits.length >= 4 ? "/" : "") +
    digits.slice(4);
  let position = 0,
    count = 0;
  while (position < text.length && count < before) {
    if (/\d/.test(text[position])) count++;
    position++;
  }
  if (text[position] === "/") position++;
  return { text, caret: position };
}
