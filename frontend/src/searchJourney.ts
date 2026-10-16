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
