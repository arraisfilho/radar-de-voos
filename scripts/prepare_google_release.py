"""Maintainer-only: package a PUBLIC desktop client ID, never a web client secret."""
import argparse
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]


def public_client(document):
    installed=document.get('installed')
    if not isinstance(installed,dict):
        raise ValueError('Use uma credencial OAuth Desktop (installed). Credenciais Web não podem ser distribuídas.')
    client_id=installed.get('client_id','')
    if not client_id.endswith('.apps.googleusercontent.com') or any(c.isspace() for c in client_id):
        raise ValueError('Client ID Google inválido')
    return {'client_type':'desktop','client_id':client_id}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('credential_json',type=Path,help='JSON OAuth Desktop do mantenedor, fora do repositório')
    args=parser.parse_args()
    try:
        data=public_client(json.loads(args.credential_json.read_text()))
    except (ValueError,OSError) as exc:
        raise SystemExit(str(exc))
    target=ROOT/'config'/'google-oauth-public.json'
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(data,indent=2)+'\n')
    print('Identificador público Desktop preparado. Nenhum segredo ou token foi copiado.')
