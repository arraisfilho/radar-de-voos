"""Run the built local app with the selected Python environment."""
import os
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
os.chdir(ROOT)
if not (ROOT/'frontend'/'dist'/'index.html').exists():
    raise SystemExit('Build ausente: execute npm ci e npm run build dentro de frontend/.')
from backend.network import lan_network
network=lan_network()
host=os.environ.get('RADAR_HOST','127.0.0.1')
if host not in ('127.0.0.1','localhost') and not (network and host == '0.0.0.0'):
    raise SystemExit('Para acesso na rede local use RADAR_HOST=0.0.0.0 e RADAR_LAN_CIDR com a sub-rede privada autorizada.')
import uvicorn
uvicorn.run('backend.app:app',host=host,port=int(os.environ.get('RADAR_PORT','8765')),access_log=False,proxy_headers=False)
