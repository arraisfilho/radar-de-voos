import type { Airport } from "./types";

const SUFFIX = /\s+(?:International\s+|Intl\.?\s+)?Airport$/i;
const STORAGE = "radar-airports";

/**
 * Airports chosen in the pickers. `/api/state` only lists the airports of the
 * saved trips, so a new choice keeps its record here (and in this tab's
 * storage, next to the saved draft) for the summaries and chips.
 */
const chosen = new Map<string, Airport>();
let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(STORAGE) || "[]");
    if (Array.isArray(saved))
      for (const item of saved)
        if (item && typeof item.code === "string" && typeof item.city === "string" && typeof item.name === "string")
          chosen.set(item.code, item as Airport);
  } catch {
    /* Storage is optional, including in private browsing. */
  }
}

/** Keeps the records of airports the person picked (code, city, name and label). */
export function rememberAirports(list: Airport[]) {
  restore();
  for (const airport of list) if (airport?.code) chosen.set(airport.code, airport);
  try {
    // The most recent choices are enough for any draft.
    sessionStorage.setItem(STORAGE, JSON.stringify([...chosen.values()].slice(-24)));
  } catch {
    /* Keep the in-memory records when storage is unavailable. */
  }
}

/** The record of an airport: from the given list (state), else from the picked ones. */
export function findAirport(code: string, airports: Airport[] = []): Airport | undefined {
  const listed = airports.find((airport) => airport.code === code);
  if (listed) return listed;
  restore();
  return chosen.get(code);
}

/** Short airport name: the backend `label`, or `name` without the "Airport" suffixes. */
export function airportName(airport: Airport): string {
  return (airport.label || airport.name.replace(SUFFIX, "") || airport.name).trim();
}

/** "São Paulo · Congonhas"; only the city when the airport repeats it. */
export function airportLabel(airport: Airport): string {
  const name = airportName(airport),
    city = airport.city.trim();
  if (!city) return name;
  if (!name || name.toLocaleLowerCase() === city.toLocaleLowerCase()) return city;
  return `${city} · ${name}`;
}

/**
 * Place for a trip side: the airport label for one airport, the distinct
 * cities for several ("São Paulo, Campinas"). Unknown codes are skipped.
 */
export function placeLabel(codes: string[], airports: Airport[]): string {
  const known = codes
    .map((code) => findAirport(code, airports))
    .filter((airport): airport is Airport => !!airport);
  if (!known.length) return "";
  if (known.length === 1 && codes.length === 1) return airportLabel(known[0]);
  return [...new Set(known.map((airport) => airport.city.trim() || airport.code))].join(", ");
}
