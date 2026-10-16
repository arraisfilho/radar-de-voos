"""Local reference names/codes; no runtime external lookup or logo URLs."""
import json
import re
from pathlib import Path
from .airports import normalize

RECORDS=json.loads((Path(__file__).resolve().parents[1]/'config'/'airlines.json').read_text())
CATALOG={r['code']:r for r in RECORDS}
INDEX=[(r,normalize(' '.join([r['code'],r['name'],*r['aliases']]))) for r in RECORDS]


def airline_record(code):
    code=code.strip().upper()
    if not re.fullmatch('[A-Z0-9]{2}',code):return None
    record=CATALOG.get(code)
    return {'code':code,'name':record['name'] if record else code,'custom':record is None}


def search_airlines(query,limit=12):
    query=normalize(query.strip())[:100]
    if len(query)<2:return []
    words=query.split()
    found=[r for r,text in INDEX if all(word in text for word in words)]
    found.sort(key=lambda r:(0 if r['code'].lower()==query else 1 if normalize(r['name']).startswith(query) else 2,normalize(r['name']),r['code']))
    items=[airline_record(r['code']) for r in found[:limit]]
    exact=airline_record(query)
    if exact and exact['custom']:items.insert(0,exact)
    return items[:limit]
