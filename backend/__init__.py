"""Local airfare monitoring service.

No handler is attached to the "radar" loggers: scripts/run.py and scripts/serve.py send them
to the JSON handler (backend/logs.py); in any other process, warnings and errors reach
Python's last-resort handler on stderr instead of being discarded.
"""
