"""JSON lines on stderr. Callers pass identifiers only, never secrets, contacts or message bodies."""
import json
import logging
import os
import sys
from datetime import datetime, timezone

LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")
# Attributes every LogRecord has; anything else came from `extra=` and is emitted as a field.
# uvicorn's color_message repeats the message with ANSI escapes.
STANDARD = set(vars(logging.LogRecord("", 0, "", 0, "", (), None))) | {"message", "asctime", "taskName", "color_message"}


class JSONFormatter(logging.Formatter):
    def format(self, record):
        entry = {"time": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds"),
                 "level": record.levelname, "logger": record.name, "message": record.getMessage()}
        for key, value in vars(record).items():
            if key not in STANDARD and not key.startswith("_"):
                entry[key] = value
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False, default=str)


def level():
    value = os.environ.get("RADAR_LOG_LEVEL", "INFO").strip().upper()
    if value not in LEVELS:
        raise ValueError("RADAR_LOG_LEVEL deve ser DEBUG, INFO, WARNING, ERROR ou CRITICAL")
    return value


def configure(stream=None):
    """Route every logger (uvicorn included, when started with log_config=None) to one JSON handler."""
    value = level()
    handler = logging.StreamHandler(stream or sys.stderr)
    handler.setFormatter(JSONFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(value)
    return handler
