"""Price history as CSV for spreadsheets: UTF-8 with BOM, ';' between fields, decimal comma."""
import csv
import io
import json
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

HEADERS = ("Coletado em", "Trecho", "Origem", "Destino", "Partida", "Companhia", "Preço", "Moeda", "Versão dos filtros")


def safe(value):
    """A cell starting with = + - @ (also after spaces or line breaks) would run as a formula in a
    spreadsheet: it stays text."""
    text = "" if value is None else str(value)
    return "'"+text if text[:1] in ("\t", "\r") or text.lstrip(" \t\r\n")[:1] in ("=", "+", "-", "@") else text


def zone_of(name):
    try:return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):return ZoneInfo("UTC")


def file_name(config, extension, zone="UTC", now=None):
    """radar-GRU-LIS-2026-10-17.csv: the route by airport codes and the day of the export."""
    day = datetime.fromtimestamp(now or time.time(), timezone.utc).astimezone(zone_of(zone)).strftime("%Y-%m-%d")
    return "radar-"+"+".join(config.origins)+"-"+"+".join(config.destinations)+"-"+day+"."+extension


def history_csv(rows, zone="UTC"):
    """Snapshots (oldest first) as CSV text; times on the account's clock, departures in local airport time."""
    tz = zone_of(zone)
    out = io.StringIO()
    writer = csv.writer(out, delimiter=";", lineterminator="\r\n")
    writer.writerow(HEADERS)
    for row in rows:
        flight = json.loads(row["flight"]) if row["flight"] else {}
        cents = row["price"]
        writer.writerow([safe(value) for value in (
            datetime.fromtimestamp(row["collected"], timezone.utc).astimezone(tz).strftime("%Y-%m-%d %H:%M"),
            "Ida" if row["direction"] == "outbound" else "Volta",
            flight.get("origin"), flight.get("destination"),
            (flight.get("departure") or "").replace("T", " "),
            " / ".join(flight.get("airlines") or []),
            f"{cents//100},{cents%100:02d}",
            flight.get("currency") or "BRL",
            row["version"])])
    return "﻿"+out.getvalue()
