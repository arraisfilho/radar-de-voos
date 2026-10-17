import { Plane } from "lucide-react";
import { clsx } from "clsx";
import { placeLabel } from "./airports";
import type { Airport, Config } from "./types";

/** Boarding-pass route: large IATA codes joined by a flight path. */
export function RouteCodes({ config, className }: { config: Pick<Config, "origins" | "destinations" | "inbound">; className?: string }) {
  return (
    <span className={clsx("route-codes", className)}>
      <span className="route-code">{config.origins.join(" / ")}</span>
      <span className="route-path" aria-hidden="true">
        <span className="route-plane">
          <Plane />
        </span>
      </span>
      <span className="sr-only">{config.inbound ? " ↔ " : " → "}</span>
      <span className="route-code">{config.destinations.join(" / ")}</span>
    </span>
  );
}

/** "Cidade · Aeroporto" under each end of the route; nothing for unknown airports. */
export function RoutePlaces({ config, airports, className }: { config: Pick<Config, "origins" | "destinations">; airports: Airport[]; className?: string }) {
  const from = placeLabel(config.origins, airports),
    to = placeLabel(config.destinations, airports);
  if (!from && !to) return null;
  return (
    <p className={clsx("route-places", className)}>
      <span>{from || config.origins.join(" / ")}</span>
      <span className="sr-only"> → </span>
      <span>{to || config.destinations.join(" / ")}</span>
    </p>
  );
}
