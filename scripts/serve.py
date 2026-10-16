"""Container entrypoint: one process/collector; trust only configured proxy IPs."""
import os
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from backend.network import public_mode,public_origin,lan_network
if public_mode():
    public_origin()
    trusted=os.environ.get('RADAR_TRUSTED_PROXY','')
    from ipaddress import ip_address
    try:ip_address(trusted)
    except ValueError:raise SystemExit('RADAR_TRUSTED_PROXY deve ser um único IP confiável.')
    if not trusted or '*' in trusted:
        raise SystemExit('Configure RADAR_TRUSTED_PROXY com o IP exato do proxy, nunca *.')
else:
    lan_network()
    trusted=''
os.umask(0o077)
import uvicorn
uvicorn.run('backend.app:app',host='0.0.0.0',port=8765,workers=1,proxy_headers=bool(trusted),forwarded_allow_ips=trusted,access_log=False)
