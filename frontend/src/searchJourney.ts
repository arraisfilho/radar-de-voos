import type { Config } from "./types";
import { getLocale } from "./i18n";
export function suggestedName(c: Config) {
  const route =
    c.origins.join("/") +
    (c.inbound ? " ↔ " : " → ") +
    c.destinations.join("/");
  const date = new Date(c.outbound.start.slice(0, 10) + "T12:00:00");
  const when = Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(getLocale(), { day: "numeric", month: "short" });
  return (route + " · " + when).slice(0, 70);
}
export function nextTripAction(roundTrip: boolean, direction: string) {
  return roundTrip && direction === "outbound" ? "return" : "preferences";
}
/** Calendar days of a window, "YYYY-MM-DD", start to end. */
function windowDays(start: string, end: string) {
  const days: string[] = [];
  for (let day = new Date(start.slice(0, 10) + "T00:00:00Z"); day.toISOString().slice(0, 10) <= end.slice(0, 10) && days.length < 8; day.setUTCDate(day.getUTCDate() + 1))
    days.push(day.toISOString().slice(0, 10));
  return days;
}
/**
 * Pairs of departure dates where the return is on an earlier day than the outbound: they cannot be
 * one trip, though each leg is searched. `total` counts every pair of the two windows.
 */
export function impossibleReturns(c: Pick<Config, "outbound" | "inbound">) {
  if (!c.inbound) return { impossible: 0, total: 0 };
  const out = windowDays(c.outbound.start, c.outbound.end),
    back = windowDays(c.inbound.start, c.inbound.end);
  return { impossible: out.reduce((sum, day) => sum + back.filter((other) => other < day).length, 0), total: out.length * back.length };
}
