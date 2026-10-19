import type { Flight } from "./types";

/**
 * Sorting and filtering of the collected flights on screen only. They never change what the
 * trip monitors, its alerts or the queries to the source.
 */
export type Sort = "price" | "duration" | "departure" | "departure-late" | "arrival";
export type StopsView = "any" | "direct" | "one";
export type Period = "dawn" | "morning" | "afternoon" | "evening";
export type FlightView = { sort: Sort; stops: StopsView; airlines: string[]; periods: Period[] };

export const SORTS: Sort[] = ["price", "duration", "departure", "departure-late", "arrival"];
export const PERIODS: Period[] = ["dawn", "morning", "afternoon", "evening"];
export const DEFAULT_VIEW: FlightView = { sort: "price", stops: "any", airlines: [], periods: [] };

/** Local hour of a "YYYY-MM-DDTHH:MM" time, read as written (the airport's own time). */
const hour = (time: string) => Number(time.slice(11, 13)) || 0;

export function periodOf(departure: string): Period {
  const h = hour(departure);
  return h < 6 ? "dawn" : h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}

/** Airlines on the list, most frequent first, for the chips. */
export function airlinesOf(flights: Flight[]): string[] {
  const count = new Map<string, number>();
  for (const flight of flights) for (const name of flight.airlines) count.set(name, (count.get(name) || 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
}

export function isFiltered(view: FlightView): boolean {
  return view.stops !== "any" || view.airlines.length > 0 || view.periods.length > 0;
}

/** "YYYY-MM-DDTHH:MM" strings order as text; no locale is involved. */
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const compare: Record<Sort, (a: Flight, b: Flight) => number> = {
  price: (a, b) => a.price_cents - b.price_cents,
  duration: (a, b) => a.duration_minutes - b.duration_minutes,
  departure: (a, b) => byText(a.departure, b.departure),
  "departure-late": (a, b) => byText(b.departure, a.departure),
  arrival: (a, b) => byText(a.arrival, b.arrival),
};

/** The flights the person asked to see, in their order; ties fall back to the lower price. */
export function applyView(flights: Flight[], view: FlightView): Flight[] {
  const kept = flights.filter(
    (flight) =>
      (view.stops === "any" || flight.stops <= (view.stops === "direct" ? 0 : 1)) &&
      (!view.airlines.length || flight.airlines.some((name) => view.airlines.includes(name))) &&
      (!view.periods.length || view.periods.includes(periodOf(flight.departure))),
  );
  return kept.sort((a, b) => compare[view.sort](a, b) || a.price_cents - b.price_cents);
}

const key = (searchId: string, direction: string) => `radar-view:${searchId}:${direction}`;

/** The view saved on this device for a trip leg, or the default one. */
export function loadView(searchId: string, direction: string): FlightView {
  try {
    const raw = JSON.parse(localStorage.getItem(key(searchId, direction)) || "null");
    if (!raw || typeof raw !== "object") return DEFAULT_VIEW;
    return {
      sort: SORTS.includes(raw.sort) ? raw.sort : "price",
      stops: ["any", "direct", "one"].includes(raw.stops) ? raw.stops : "any",
      airlines: Array.isArray(raw.airlines) ? raw.airlines.filter((name: unknown) => typeof name === "string") : [],
      periods: Array.isArray(raw.periods) ? raw.periods.filter((period: Period) => PERIODS.includes(period)) : [],
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

export function saveView(searchId: string, direction: string, view: FlightView) {
  try {
    if (!isFiltered(view) && view.sort === "price") localStorage.removeItem(key(searchId, direction));
    else localStorage.setItem(key(searchId, direction), JSON.stringify(view));
  } catch {
    /* Storage is optional: the view lasts for this visit. */
  }
}
