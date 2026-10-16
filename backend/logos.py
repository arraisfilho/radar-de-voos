"""Airline-code image lookup with a bounded private cache and no browser tracking URL."""
import re
import threading
import time
from urllib.request import urlopen
from . import store
LOCK=threading.Lock()

def airline_logo(code):
    if not re.fullmatch(r'[A-Z0-9]{2,3}',code):return None
    folder=store.DATA_DIR/'airline-logos';folder.mkdir(parents=True,exist_ok=True,mode=0o700)
    path=folder/(code+'.png');missing=folder/(code+'.missing')
    with LOCK:
        if path.exists() and time.time()-path.stat().st_mtime<7*86400:return path
        if missing.exists() and time.time()-missing.stat().st_mtime<86400:return None
        try:
            with urlopen('https://www.gstatic.com/flights/airline_logos/70px/'+code+'.png',timeout=4) as response:
                content=response.read(131073)
                if response.headers.get_content_type()!='image/png' or not content.startswith(b'\x89PNG\r\n\x1a\n') or len(content)>131072:raise ValueError('invalid logo')
            temporary=path.with_suffix('.tmp');temporary.write_bytes(content);temporary.replace(path)
            if missing.exists():missing.unlink()
        except (OSError,ValueError):
            missing.touch()
            for old in sorted(folder.iterdir(),key=lambda item:item.stat().st_mtime)[:-1000]:old.unlink(missing_ok=True)
            return path if path.exists() else None
        for old in sorted(folder.iterdir(),key=lambda item:item.stat().st_mtime)[:-1000]:old.unlink(missing_ok=True)
        return path
