"""One bounded query per subprocess; stdout is machine-readable JSON only."""
import hashlib
import json
import re
import sys
import time
from datetime import datetime
from urllib.parse import urlsplit
import primp
from fast_flights import FlightQuery, Passengers, Query, create_query, fetch_flights_html
from fast_flights.integrations import FetchIntegration
# No public parser accepts the adapted groups below; pinned with ADAPTER_VERSION.
from fast_flights.parser import parse_js
from selectolax.lexbor import LexborHTMLParser
from .domain import local_instant, ADAPTER_VERSION

SOURCE_URL = "https://www.google.com/travel/flights"
# Safe, fixed texts per failure kind; raw provider/library messages are never returned.
MESSAGES = {
    "rate_limited": "A fonte limitou temporariamente as consultas",
    "blocked": "A fonte bloqueou temporariamente as consultas",
    "format": "Não foi possível processar a resposta da fonte",
    "timeout": "A fonte não respondeu a tempo",
    "network": "Não foi possível conectar à fonte de tarifas",
    "server": "A fonte de tarifas está indisponível no momento",
    "no_results": "A fonte não forneceu um bloco de voos interpretável",
    "unknown": "Consulta não concluída",
}
# Consent, captcha and "unusual traffic" pages replace the results page.
BLOCK_MARKERS = ("unusual traffic", "/sorry/index", "g-recaptcha", "captcha", "consent.google.com", "before you continue to google")
# The source's own error answer for one query (fast-flights reads it as "no flights found").
ERROR_STATUS = re.compile(r"\berrorHasStatus\s*:\s*true\b")


class SourceError(ValueError):
    def __init__(self, kind, message=None):
        super().__init__(message or MESSAGES[kind])
        self.kind = kind


def status_kind(status):
    return "rate_limited" if status == 429 else "blocked" if status == 403 else "server" if status >= 500 else "unknown"


def blocked_page(html):
    text = html[:500000].casefold()
    return any(marker in text for marker in BLOCK_MARKERS)


class CheckedFetch(FetchIntegration):
    """fast-flights' default browser request, keeping the HTTP status it discards."""

    def fetch_html(self, q):
        client = primp.Client(impersonate="chrome_145", impersonate_os="macos", referer=True, cookie_store=True, timeout=30)
        response = client.get(SOURCE_URL, params=q.params() if isinstance(q, Query) else {"q": q})
        if response.status_code != 200:
            raise SourceError(status_kind(response.status_code))
        final = urlsplit(str(response.url))
        if (final.hostname or "").startswith("consent.") or final.path.startswith("/sorry"):
            raise SourceError("blocked")
        return response.text


def classify(exc):
    """Failure kind and safe message for any exception raised by collect()."""
    if isinstance(exc, SourceError):
        return exc.kind, str(exc)
    if isinstance(exc, primp.StatusError):
        kind = status_kind(getattr(exc, "status_code", 0) or 0)
    elif isinstance(exc, (primp.TimeoutError, TimeoutError)):
        kind = "timeout"
    elif isinstance(exc, (primp.RequestError, ConnectionError, OSError)):
        kind = "network"
    else:
        # "format" (source-wide) is raised only by top_level() as a SourceError; any other
        # error concerns this query alone.
        kind = "unknown"
    return kind, MESSAGES[kind]


# Itineraries are read one at a time with empty metadata: an error then concerns that item only.
EMPTY_METADATA = [None, [[], []]]
ITEM_ERRORS = (KeyError, IndexError, TypeError, ValueError, AttributeError)


def top_level(text):
    """Raw itineraries of groups 2 and 3, and airline codes, from the embedded script.

    Only this structure is a format change ("format", source-wide): the data marker, its
    JSON, the group containers and, when there are itineraries, block 7 (alliances, airlines).
    """
    try:
        data = json.loads(text.split("data:", 1)[1].rsplit(",", 1)[0])
    except (IndexError, ValueError):
        raise SourceError("format") from None
    groups = {}
    for index in (2, 3):
        if not isinstance(data, list) or len(data) <= index:
            raise SourceError("format", "O formato da fonte mudou: grupo de voos ausente")
        group = data[index] or [None]
        if not isinstance(group, list) or not isinstance(group[0] or [], list):
            raise SourceError("format")
        groups[index] = group[0] or []
    codes = {}
    if any(groups.values()):
        try:
            alliances, airlines = data[7][1][0], data[7][1][1]
            for code, name in alliances:
                pass
            codes = {name.casefold(): code for code, name in airlines}
        except ITEM_ERRORS:
            raise SourceError("format") from None
    return groups, codes


def read_item(raw):
    """One itinerary through the pinned library parser, isolated from the others."""
    payload = [None, None, None, [[raw]], None, None, None, EMPTY_METADATA]
    return parse_js("data:" + json.dumps(payload) + ",")


def stamp(value):
    return datetime(*value.date, *value.time).isoformat(timespec="minutes")


def collect(options):
    origin, destination, date = options["origin"], options["destination"], options["date"]
    query = create_query(flights=[FlightQuery(date=date, from_airport=origin, to_airport=destination)],
                         seat=options["cabin"], trip="one-way", passengers=Passengers(adults=options["adults"],children=options.get("children",0),infants_in_seat=options.get("infants_in_seat",0),infants_on_lap=options.get("infants_on_lap",0)),
                         language={"pt":"pt-BR","en":"en-US","es":"es"}.get(options.get("language","pt"),"en-US"), currency=options.get("currency", "BRL"), checked_bags=options.get("checked_bags", 0))
    start = time.monotonic()
    html = fetch_flights_html(query, fetch_integration=CheckedFetch())
    script = LexborHTMLParser(html).css_first(r"script.ds\:1")
    # A missing flights block or an error status concerns this query only: the search backs
    # off, the global breaker is reserved for structural failures ("format").
    if script is None:
        if isinstance(html, str) and blocked_page(html):
            raise SourceError("blocked")
        raise SourceError("no_results")
    text = script.text()
    if ERROR_STATUS.search(text):
        raise SourceError("no_results")
    groups, airline_codes = top_level(text)
    items, flights, skipped = [], {}, {}
    for raw in groups[2]+groups[3]:
        try:
            items.extend(read_item(raw))
        except ITEM_ERRORS:
            # A malformed itinerary is skipped; the others are still read.
            skipped["malformed_itinerary"] = skipped.get("malformed_itinerary", 0) + 1
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
        except ITEM_ERRORS as exc:
            # An unsupported itinerary must not discard other usable fares.
            reason = "unsupported_airport" if isinstance(exc, KeyError) else "unsupported_itinerary"
            skipped[reason] = skipped.get(reason, 0) + 1
            continue
        if fid not in flights or total_cents < flights[fid]["price_cents"]:
            flights[fid] = flight
    # Itineraries were returned but none could be read or validated: this query only.
    if (groups[2] or groups[3]) and not flights:
        raise SourceError("no_results", "As ofertas retornadas não puderam ser validadas; nova tentativa será feita")
    return {"status": "ok" if flights else "empty", "skipped": skipped, "flights": sorted(flights.values(), key=lambda f:f["price_cents"]),
            "provider_groups": {str(index): len(groups[index]) for index in (2, 3)}, "elapsed_seconds": round(time.monotonic()-start, 2), "adapter": ADAPTER_VERSION}


if __name__ == "__main__":
    try:
        print(json.dumps(collect(json.load(sys.stdin)), ensure_ascii=False))
    except Exception as exc:
        kind, message = classify(exc)
        print(json.dumps({"status": "error", "error": message, "kind": kind, "flights": []}, ensure_ascii=False))
        sys.exit(1)
