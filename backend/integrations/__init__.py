"""Transport registry: new WhatsApp providers implement the same small contract."""
from .openwa import OpenWA
WHATSAPP_PROVIDERS={provider.id:provider for provider in [OpenWA()]}


def catalog():
    return [{'id':p.id,'name':p.name,'fields':p.fields,'help':getattr(p,'help','')} for p in WHATSAPP_PROVIDERS.values()]
