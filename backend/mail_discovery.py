"""Identify Google mail from the address/domain, without reading a mailbox."""
import dns.resolver
from pydantic import BaseModel, Field, field_validator
from typing import Literal
from .accounts import clean_emails


class MailAccount(BaseModel):
    email: str = Field(min_length=3,max_length=254)
    provider: Literal['auto','google'] = 'auto'

    @field_validator('email')
    @classmethod
    def valid_email(cls,value):
        return clean_emails([value])[0]


def identify(email):
    domain=email.rsplit('@',1)[1].lower()
    if domain in ('gmail.com','googlemail.com'):
        return 'google'
    try:
        records=dns.resolver.resolve(domain,'MX',lifetime=4)
        hosts=[str(r.exchange).lower().rstrip('.') for r in records]
    except dns.exception.DNSException:
        return 'unknown'
    if any(h=='smtp.google.com' or h=='aspmx.l.google.com' or h.endswith('.l.google.com') or h.endswith('.googlemail.com') for h in hosts):
        return 'google'
    return 'other' if hosts else 'unknown'
