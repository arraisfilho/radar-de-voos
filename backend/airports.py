"""Bundled worldwide IATA catalog: airportsdata (MIT), no runtime network lookup."""
import unicodedata
import airportsdata

CATALOG = airportsdata.load("IATA")
AIRPORTS = {code: (a["city"] or a["name"], a["name"], a["tz"]) for code, a in CATALOG.items()}
ALIASES = {"sao paulo": "sao paulo", "nova york": "new york", "londres": "london", "lisboa": "lisbon", "roma": "rome", "toquio": "tokyo", "pequim": "beijing", "munique": "munich", "varsovia": "warsaw", "bruxelas": "brussels", "atenas": "athens"}


def normalize(value):
    return "".join(c for c in unicodedata.normalize("NFKD", value.casefold()) if not unicodedata.combining(c))


def airport_record(code):
    a = CATALOG[code]
    return {"code": code, "city": a["city"] or a["name"], "name": a["name"], "country": a["country"], "timezone": a["tz"]}


INDEX = [(code, normalize(" ".join(str(a[k]) for k in ("iata", "icao", "city", "name", "country", "subd")) )) for code, a in CATALOG.items()]


def search_airports(query, limit=20):
    query = normalize(query.strip())
    if len(query) < 2:
        return []
    query = ALIASES.get(query, query)
    words = query.split()
    found = [code for code, text in INDEX if all(word in text for word in words)]
    def rank(code):
        city = normalize(CATALOG[code]["city"])
        name = normalize(CATALOG[code]["name"])
        score = (0 if code.casefold() == query else 1 if code.casefold().startswith(query)
                 else 2 if city == query else 3 if city.startswith(query)
                 else 4 if query in name else 5)
        return score, city, code
    found.sort(key=rank)
    return [airport_record(code) for code in found[:limit]]
