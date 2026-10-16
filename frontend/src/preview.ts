import type { Config, Flight, Leg } from "./types";
// Filters operate on local airport wall times, matching backend.domain.eligible.
export function matchesLeg(flight: Flight, leg: Leg): boolean {
  const wall = (value: string) => Date.parse(value + "Z");
  if (
    wall(flight.departure) < wall(leg.start) ||
    wall(flight.departure) > wall(leg.end)
  )
    return false;
  if (
    !leg.stops.includes(Math.min(flight.stops, 2)) ||
    (leg.max_duration != null && flight.duration_minutes > leg.max_duration)
  )
    return false;
  if (leg.arrival_before && wall(flight.arrival) > wall(leg.arrival_before))
    return false;
  if (
    leg.max_layover !== null &&
    (!flight.layovers || flight.layovers.some((n) => n > leg.max_layover!))
  )
    return false;
  if (leg.airlines.length) {
    const names: Record<string, string> = {
      GOL: "G3",
      "GOL LINHAS AEREAS": "G3",
      LATAM: "LA",
      "LATAM AIRLINES": "LA",
      AZUL: "AD",
    };
    const codes = flight.airline_codes?.length
      ? flight.airline_codes
      : flight.airlines.map((a) => names[a.toUpperCase()] || a.toUpperCase());
    if (!codes.length || codes.some((c) => !leg.airlines.includes(c)))
      return false;
  }
  return true;
}
// A different acquisition needs a fresh source response. Never re-label old prices.
export function canPreview(saved: Config, draft: Config): boolean {
  const acquisition = (c: Config) => [
    c.origins,
    c.destinations,
    c.adults,
    c.children || 0,
    c.infants_in_seat || 0,
    c.infants_on_lap || 0,
    c.cabin,
    c.currency,
    c.checked_bags,
    c.outbound.start.slice(0, 10),
    c.outbound.end.slice(0, 10),
    c.inbound
      ? [c.inbound.start.slice(0, 10), c.inbound.end.slice(0, 10)]
      : null,
  ];
  return (
    JSON.stringify(acquisition(saved)) === JSON.stringify(acquisition(draft))
  );
}
export function filterFlights(pool: Flight[], config: Config): Flight[] {
  return pool.filter((f) => {
    const leg = f.direction === "outbound" ? config.outbound : config.inbound;
    return !!leg && matchesLeg(f, leg);
  });
}
