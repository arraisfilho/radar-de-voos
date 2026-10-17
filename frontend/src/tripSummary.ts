import { formatDateRange } from "./format";
import type { Config, Leg } from "./types";
export function tripRoute(c: Config) {
  return `${c.origins.join(" + ")} ${c.inbound ? "↔" : "→"} ${c.destinations.join(" + ")}`;
}
// Recognize the generated names already stored by earlier versions; never rename records.
export function tripTitle(c: Config) {
  const route = tripRoute(c),
    name = c.name.trim();
  const date = new Date(c.outbound.start.slice(0, 10) + "T12:00");
  const prefixes = [
    `${c.origins.join("/")} ${c.inbound ? "↔" : "→"} ${c.destinations.join("/")}`,
    route,
    `${c.origins.join("/")} → ${c.destinations.join("/")}`,
  ];
  const generated = prefixes.some(
    (p) =>
      name === p ||
      ["pt-BR", "en-US", "es-ES"].some(
        (locale) =>
          name ===
          (
            p +
            " · " +
            date.toLocaleDateString(locale, { day: "numeric", month: "short" })
          ).slice(0, 70),
      ),
  );
  return {
    title: !name || generated ? route : name,
    secondaryRoute: !!name && !generated ? route : null,
  };
}
/**
 * Departure dates of a leg in the current locale: "11 – 12 de dez. de 2026",
 * or compact "11/12 – 12/12" (with the year when the dates cross one).
 */
export function legDates(leg: Leg, compact = false) {
  const start = leg.start.slice(0, 10),
    end = (leg.end || leg.start).slice(0, 10);
  return formatDateRange(start, end, compact ? "numeric" : "medium");
}
