import json
from pathlib import Path
CATALOG=json.loads((Path(__file__).resolve().parents[1]/'frontend'/'src'/'messages.json').read_text())
def translate(text,language='pt'):
    return text if language=='pt' else CATALOG.get(text,{}).get(language if language in ('en','es') else 'en',text)
