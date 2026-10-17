"""Search rules shared by the collector, API and tests."""
import json
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo
from pydantic import BaseModel, Field, field_validator, model_validator

ADAPTER_VERSION = "fast-flights-3.1.0-groups-2-3-worldwide-bags-v2"

from .airports import AIRPORTS

CURRENCIES=set(json.loads((Path(__file__).resolve().parents[1]/"config"/"currencies.json").read_text()))


class Leg(BaseModel):
    start: str
    end: str
    arrival_before: str | None = None
    stops: list[int] = Field(default_factory=lambda: [0, 1, 2])
    max_duration: int | None = Field(default=None, ge=60, le=2880)
    max_layover: int | None = Field(default=None, ge=30, le=1440)
    airlines: list[str] = Field(default_factory=list)

    @field_validator("airlines")
    @classmethod
    def clean_airlines(cls, values):
        values = list(dict.fromkeys(v.strip().upper() for v in values if v.strip()))
        if len(values) > 20 or any(not (len(v) == 2 and v.isascii() and v.isalnum()) for v in values):
            raise ValueError("Informe códigos IATA de companhias com dois caracteres, como LA, BA ou AA")
        return values

    @model_validator(mode="after")
    def check_window(self):
        start, end = datetime.fromisoformat(self.start), datetime.fromisoformat(self.end)
        if start.tzinfo or end.tzinfo:
            raise ValueError("Informe a janela no horário local, sem deslocamento de fuso")
        if end <= start or end - start > timedelta(days=6, hours=23, minutes=59):
            raise ValueError("A janela deve ser crescente e abranger no máximo sete datas")
        if not self.stops or any(s not in (0, 1, 2) for s in self.stops):
            raise ValueError("Selecione ao menos uma categoria de escalas")
        self.stops = sorted(set(self.stops))
        if self.arrival_before:
            arrival = datetime.fromisoformat(self.arrival_before)
            if arrival.tzinfo:
                raise ValueError("A chegada deve usar horário local do destino")
        return self


class Search(BaseModel):
    name: str = Field(default="Minha viagem", min_length=1, max_length=70)
    origins: list[str] = Field(min_length=1, max_length=3)
    destinations: list[str] = Field(min_length=1, max_length=3)
    outbound: Leg
    inbound: Leg | None = None
    adults: int = Field(default=1, ge=1, le=9)
    children: int = Field(default=0, ge=0, le=8)
    infants_in_seat: int = Field(default=0, ge=0, le=8)
    infants_on_lap: int = Field(default=0, ge=0, le=8)
    cabin: Literal["economy", "premium-economy", "business", "first"] = "economy"
    interval: Literal[300] = 300
    language: Literal["pt","en","es"] = "pt"
    currency: str = "BRL"
    checked_bags: int = Field(default=0, ge=0, le=2)
    target_cents: int | None = Field(default=None, ge=100, le=1000000000000)
    min_drop_cents: int = Field(default=5000, ge=100, le=1000000000000)
    notify_email: bool = True
    notify_whatsapp: bool = False

    @field_validator("currency")
    @classmethod
    def valid_currency(cls,value):
        value=value.upper()
        if value not in CURRENCIES:raise ValueError("Escolha uma moeda suportada pelo motor de busca")
        return value

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        value = value.strip()
        if not value or any(ord(char) < 32 for char in value):
            raise ValueError("Informe um nome sem quebras de linha")
        return value

    @field_validator("origins", "destinations")
    @classmethod
    def known_airports(cls, values):
        values = list(dict.fromkeys(v.strip().upper() for v in values))
        if any(v not in AIRPORTS for v in values):
            raise ValueError("Escolha um aeroporto com código IATA válido no catálogo mundial")
        return values

    @model_validator(mode="after")
    def valid_routes(self):
        if self.adults+self.children+self.infants_in_seat+self.infants_on_lap>9:
            raise ValueError("A pesquisa permite até nove passageiros no total")
        if self.infants_on_lap>self.adults:
            raise ValueError("Cada bebê no colo precisa estar acompanhado por um adulto")
        if set(self.origins) & set(self.destinations):
            raise ValueError("Um mesmo aeroporto não pode estar nos dois lados")
        if self.inbound and self.inbound.start < self.outbound.start:
            raise ValueError("A janela da volta deve começar após o início da ida")
        if len(jobs(self)) > 24:
            raise ValueError("Limite de 24 combinações entre aeroportos e datas por ciclo.")
        return self


def jobs(search):
    result = []
    for direction, leg, origins, destinations in (
        ("outbound", search.outbound, search.origins, search.destinations),
        ("inbound", search.inbound, search.destinations, search.origins),
    ):
        if leg is None:
            continue
        date = datetime.fromisoformat(leg.start).date()
        end = datetime.fromisoformat(leg.end).date()
        while date <= end:
            result.extend((direction, o, d, date.isoformat()) for o in origins for d in destinations)
            date += timedelta(days=1)
    return result


def local_instant(value, airport):
    return datetime.fromisoformat(value).replace(tzinfo=ZoneInfo(AIRPORTS[airport][2])).astimezone(timezone.utc)


def eligible(flight, leg):
    departure = datetime.fromisoformat(flight["departure"])
    if not datetime.fromisoformat(leg.start) <= departure <= datetime.fromisoformat(leg.end):
        return False
    if min(flight["stops"], 2) not in leg.stops or (leg.max_duration is not None and flight["duration_minutes"] > leg.max_duration):
        return False
    if leg.arrival_before and datetime.fromisoformat(flight["arrival"]) > datetime.fromisoformat(leg.arrival_before):
        return False
    if leg.max_layover is not None:
        layovers = flight.get("layovers")
        if layovers is None or any(m > leg.max_layover for m in layovers):
            return False
    if leg.airlines:
        codes = {"GOL": "G3", "GOL LINHAS AEREAS": "G3", "LATAM": "LA", "LATAM AIRLINES": "LA", "AZUL": "AD"}
        actual = set(flight.get("airline_codes", [])) or {codes.get(a.upper(), a.upper()) for a in flight["airlines"]}
        if not actual or not actual <= set(leg.airlines):
            return False
    return True


def validate_future(search, now=None):
    now = now or datetime.now(timezone.utc)
    for leg, origins in ((search.outbound, search.origins), (search.inbound, search.destinations)):
        if leg and any(local_instant(leg.end, a) <= now for a in origins):
            raise ValueError("A janela de viagem já terminou para um aeroporto selecionado")


def default_search():
    # Demonstration route from the user's brief; no fabricated fare data.
    start = (datetime.now(timezone.utc) + timedelta(days=14)).strftime("%Y-%m-%d")
    if datetime.now(timezone.utc).date().isoformat() <= "2026-11-05":
        start, end, back = "2026-11-05T22:00", "2026-11-06T06:00", "2026-11-09"
    else:
        back = (datetime.fromisoformat(start) + timedelta(days=4)).strftime("%Y-%m-%d")
        end = (datetime.fromisoformat(start) + timedelta(days=1)).strftime("%Y-%m-%dT06:00")
        start += "T22:00"
    return Search(name="São Paulo · novembro", origins=["THE"], destinations=["GRU", "CGH"],
                  outbound=Leg(start=start, end=end, stops=[0, 1], max_duration=480),
                  inbound=Leg(start=back+"T00:00", end=back+"T23:59", stops=[0, 1], max_duration=480),
                  interval=300, target_cents=120000)


def monitoring_deadline(search):
    leg=search.inbound or search.outbound
    origins=search.destinations if search.inbound else search.origins
    return max(local_instant(leg.end,a).timestamp() for a in origins)
