import { getLocale } from "./i18n";
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
export function legDates(leg: Leg, compact = false) {
  const start = leg.start.slice(0, 10),
    end = (leg.end || leg.start).slice(0, 10);
  const format = (value: string) => {
    if (compact)
      return `${value.slice(8, 10)}/${value.slice(5, 7)}${start.slice(0, 4) !== end.slice(0, 4) ? "/" + value.slice(2, 4) : ""}`;
    return new Date(value + "T12:00").toLocaleDateString(getLocale(), {
      day: "numeric", month: "short", year: "numeric",
    });
  };
  if (!compact && start !== end) return new Intl.DateTimeFormat(getLocale(), {day: "numeric", month: "short", year: "numeric"}).formatRange(new Date(start + "T12:00"), new Date(end + "T12:00"));
  return format(start) + (start !== end ? "–" + format(end) : "");
}
