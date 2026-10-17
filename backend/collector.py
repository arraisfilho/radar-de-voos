"""One bounded query per subprocess; stdout is machine-readable JSON only."""
import hashlib
import json
import sys
import time
from datetime import datetime
from fast_flights import FlightQuery, Passengers, create_query
from fast_flights.fetcher import fetch_flights_html
from fast_flights.parser import parse_js
from selectolax.lexbor import LexborHTMLParser
from .domain import local_instant, ADAPTER_VERSION


def stamp(value):
    return datetime(*value.date, *value.time).isoformat(timespec="minutes")


def collect(options):
    origin, destination, date = options["origin"], options["destination"], options["date"]
    query = create_query(flights=[FlightQuery(date=date, from_airport=origin, to_airport=destination)],
                         seat=options["cabin"], trip="one-way", passengers=Passengers(adults=options["adults"],children=options.get("children",0),infants_in_seat=options.get("infants_in_seat",0),infants_on_lap=options.get("infants_on_lap",0)),
                         language={"pt":"pt-BR","en":"en-US","es":"es"}.get(options.get("language","pt"),"en-US"), currency=options.get("currency", "BRL"), checked_bags=options.get("checked_bags", 0))
    start = time.monotonic()
    script = LexborHTMLParser(fetch_flights_html(query)).css_first(r"script.ds\:1")
    if script is None:
        raise ValueError("A fonte não forneceu um bloco de voos interpretável")
    data = json.loads(script.text().split("data:", 1)[1].rsplit(",", 1)[0])
    items, groups, airline_codes = [], {}, {}
    for index in (2, 3):
        if len(data) <= index:
            raise ValueError("O formato da fonte mudou: grupo de voos ausente")
        if not data[index] or not data[index][0]:
            groups[str(index)] = 0
            continue
        adapted = list(data)
        adapted[3] = data[index]
        group = parse_js("data:" + json.dumps(adapted) + ",")
        groups[str(index)] = len(group)
        items.extend(group)
        airline_codes.update({a.name.casefold(): a.code for a in group.metadata.airlines})
    flights, skipped = {}, {}
    for item in items:
        try:
            segments = [{"origin": s.from_airport.code, "destination": s.to_airport.code,
                         "departure": stamp(s.departure), "arrival": stamp(s.arrival)} for s in item.flights]
            if not segments or segments[0]["origin"] != origin or segments[-1]["destination"] != destination:
                raise ValueError("Rota retornada não corresponde à solicitada")
            departure, arrival = segments[0]["departure"], segments[-1]["arrival"]
            if departure[:10] != date:
                raise ValueError("Data de partida retornada não corresponde à solicitada")
            duration = round((local_instant(arrival, destination) - local_instant(departure, origin)).total_seconds()/60)
            layovers = []
            for previous, following in zip(segments, segments[1:]):
                if previous["destination"] != following["origin"]:
                    raise ValueError("Conexão com troca de aeroporto não suportada.")
                layovers.append(round((local_instant(following["departure"], following["origin"]) - local_instant(previous["arrival"], previous["destination"])).total_seconds()/60))
            if duration <= 0 or any(v < 0 for v in layovers) or not isinstance(item.price, (int, float)) or item.price <= 0:
                raise ValueError("Horário ou preço inválido na fonte")
            # The query uses the whole passenger party: do not label total as per-adult.
            total_cents = round(item.price * 100)
            identity = json.dumps([item.airlines, segments], sort_keys=True)
            fid = hashlib.sha256(identity.encode()).hexdigest()[:20]
            flight = {"id": fid, "origin": origin, "destination": destination, "departure": departure,
                      "arrival": arrival, "duration_minutes": duration, "stops": len(segments)-1,
                      "layovers": layovers, "via": [s["destination"] for s in segments[:-1]],
                      "airlines": item.airlines, "airline_codes": [airline_codes.get(a.casefold(), a) for a in item.airlines], "segments": segments,
                      "price_cents": total_cents, "currency": options.get("currency", "BRL"), "price_scope": "party_per_leg",
                      "adults": options["adults"], "children": options.get("children",0), "infants_in_seat": options.get("infants_in_seat",0), "infants_on_lap": options.get("infants_on_lap",0), "search_url": query.url(), "baggage": "unknown", "checked_bags_requested": options.get("checked_bags", 0)}
        except (KeyError, ValueError, TypeError, IndexError) as exc:
            # An unsupported itinerary must not discard other usable fares.
            reason = "unsupported_airport" if isinstance(exc, KeyError) else "unsupported_itinerary"
            skipped[reason] = skipped.get(reason, 0) + 1
            continue
        if fid not in flights or total_cents < flights[fid]["price_cents"]:
            flights[fid] = flight
    if items and not flights:
        raise ValueError("As ofertas retornadas não puderam ser validadas; nova tentativa será feita")
    return {"status": "ok" if flights else "empty", "skipped": skipped, "flights": sorted(flights.values(), key=lambda f:f["price_cents"]),
            "provider_groups": groups, "elapsed_seconds": round(time.monotonic()-start, 2), "adapter": ADAPTER_VERSION}


if __name__ == "__main__":
    try:
        print(json.dumps(collect(json.load(sys.stdin)), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"status": "error", "error": str(exc)[:300], "flights": []}, ensure_ascii=False))
        sys.exit(1)
