"""Suite isolation, imported first by every test module.

Without RADAR_DATA_DIR, or with it pointing at the project's .data/ or a folder inside it,
the suite uses a temporary folder. Seeding is disabled and the application lifespan starts
an idle monitor instead of the collector and senders. Test cases still patch DATA_DIR.
"""
import atexit
import logging
import os
import shutil
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = (ROOT / '.data').resolve()


def private(path):
    """True for the project's .data/ folder and anything inside it."""
    path = Path(path).resolve()
    return path == PRIVATE or PRIVATE in path.parents


def temporary_data_dir():
    configured = os.environ.get('RADAR_DATA_DIR', '')
    if configured and not private(configured):
        return Path(configured).resolve()
    folder = Path(tempfile.mkdtemp(prefix='radar-tests-')).resolve()
    atexit.register(shutil.rmtree, folder, True)
    os.environ['RADAR_DATA_DIR'] = str(folder)
    return folder


DATA_DIR = temporary_data_dir()
os.environ['RADAR_NO_SEED'] = '1'
# The suite provokes failures on purpose: radar logs are dropped here unless a test captures
# them (assertLogs). Outside the suite they reach stderr (test_source_resilience.LogTests).
logging.getLogger('radar').addHandler(logging.NullHandler())

from backend import store, mail  # noqa: E402 - after the environment above
# Modules imported before this one keep import-time paths; point them here as well.
store.DATA_DIR = DATA_DIR
mail.DATA_DIR = DATA_DIR
mail.SETTINGS_FILE = DATA_DIR / 'smtp-private.json'

from backend import app as application  # noqa: E402
from backend.engine import HEARTBEAT_LIMITS  # noqa: E402


class IdleMonitor:
    """Replaces engine.Monitor in the lifespan: no source queries and no message sending.

    healthy=True reports live workers with fresh heartbeats, for health endpoint checks.
    """

    def __init__(self, healthy=False):
        self.healthy = healthy
        self.started = self.stopped = False

    def start(self):
        self.started = True

    def stop(self):
        self.stopped = True

    def status(self, now=None):
        return {name: {'alive': self.healthy, 'age': 0.0 if self.healthy else None, 'limit': limit}
                for name, limit in HEARTBEAT_LIMITS.items()}


application.monitor = IdleMonitor()


class SuiteIsolationTests(unittest.TestCase):
    def test_private_data_folder_is_never_the_default(self):
        self.assertFalse(private(store.DATA_DIR))
        self.assertFalse(private(os.environ['RADAR_DATA_DIR']))
        self.assertFalse(private(mail.SETTINGS_FILE.parent))
        self.assertEqual(os.environ['RADAR_NO_SEED'], '1')

    def test_folders_inside_the_private_data_folder_are_replaced(self):
        # Paths only: nothing under .data/ is read, listed or created.
        for configured in (PRIVATE, PRIVATE/'tests', PRIVATE/'nested'/'deeper', ROOT/'.data'/'..'/'.data'/'x'):
            with self.subTest(configured=configured), patch.dict(os.environ, {'RADAR_DATA_DIR': str(configured)}), \
                 patch.object(tempfile, 'mkdtemp', return_value=str(ROOT/'fixture-temporary')), patch.object(atexit, 'register'):
                self.assertEqual(temporary_data_dir(), (ROOT/'fixture-temporary').resolve())
        outside = Path(tempfile.gettempdir())/'radar-fixture-outside'
        for configured in (outside, ROOT/'.data-copy', ROOT/'backups'/'.data'):
            with self.subTest(configured=configured), patch.dict(os.environ, {'RADAR_DATA_DIR': str(configured)}):
                self.assertEqual(temporary_data_dir(), configured.resolve())

    def test_lifespan_sets_up_without_seed_collector_or_senders(self):
        from fastapi.testclient import TestClient
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            idle = IdleMonitor()
            with patch.object(store, 'DATA_DIR', folder), patch.object(mail, 'DATA_DIR', folder), \
                 patch.object(mail, 'SETTINGS_FILE', folder/'smtp.json'), patch.object(application, 'monitor', idle), \
                 patch('backend.engine.fetch', side_effect=AssertionError('tests never query the fare source')):
                with TestClient(application.app) as client:
                    self.assertTrue(idle.started)
                    self.assertEqual(client.get('/api/health').status_code, 503)
                    with store.db() as c:
                        self.assertEqual(c.execute('SELECT COUNT(*) FROM searches').fetchone()[0], 0)
                self.assertTrue(idle.stopped)
        names = {thread.name for thread in threading.enumerate()}
        self.assertFalse(names & {'radar-collector', 'radar-smtp', 'radar-whatsapp'})


if __name__ == '__main__':
    unittest.main()
