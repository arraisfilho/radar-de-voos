"""SMTP transport. Passwords are never returned by the API or logged."""
import json
import os
import re
import smtplib
import ssl
from email.message import EmailMessage
from pathlib import Path
from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Literal
from .store import DATA_DIR

SETTINGS_FILE = DATA_DIR / "smtp-private.json"


class SMTPSettings(BaseModel):
    enabled: bool = False
    host: str = Field(default="", max_length=200)
    port: int = Field(default=587, ge=1, le=65535)
    security: Literal["starttls", "ssl"] = "starttls"
    username: str = Field(default="", max_length=254)
    password: str = Field(default="", max_length=1000)
    sender: str = Field(default="", max_length=254)
    recipient: str = Field(default="", max_length=254)

    @field_validator("host", "username", "sender", "recipient")
    @classmethod
    def no_header_injection(cls, value):
        if any(char in value for char in "\r\n\x00"):
            raise ValueError("Campo contém caractere inválido")
        return value.strip()

    @model_validator(mode="after")
    def valid_enabled(self):
        if self.enabled:
            if not self.host or not self.sender or not self.recipient:
                raise ValueError("Informe servidor, remetente e destinatário")
            for address in (self.sender, self.recipient):
                if not re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+", address):
                    raise ValueError("Endereço de e-mail inválido")
        return self


def settings():
    if SETTINGS_FILE.exists():
        return json.loads(SETTINGS_FILE.read_text())
    return SMTPSettings().model_dump()


def public_settings():
    config = settings()
    return {**{k:v for k,v in config.items() if k != "password"}, "password_set": bool(config.get("password"))}


def save_settings(config):
    previous = settings()
    data = config.model_dump()
    if not data["password"]:
        if previous.get("password") and (data["host"] != previous["host"] or data["username"] != previous["username"]):
            raise ValueError("Ao mudar servidor ou usuário, informe novamente a senha SMTP")
        data["password"] = previous.get("password", "")
    DATA_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = Path(str(SETTINGS_FILE) + ".tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as file:
        json.dump(data, file)
    temp.replace(SETTINGS_FILE)
    os.chmod(SETTINGS_FILE, 0o600)


def delivery_settings():
    from . import google_mail
    google = google_mail.settings()
    config = settings()
    if google.get("refresh_token") or google.get("needs_reconnect"):
        return {**config,"provider":"google","enabled":not google.get("needs_reconnect",False),"sender":google.get("email","")}
    return {**config,"provider":"smtp"}


def available():
    return bool(delivery_settings()["enabled"])


def test_recipient():
    from .store import db
    with db() as c:
        row=c.execute("SELECT value FROM metadata WHERE key='mail_test_recipient'").fetchone()
        return row[0] if row else ''


def transmit(config, message_id, subject, body):
    if config.get("provider") == "google":
        from .google_mail import transmit as google_transmit
        return google_transmit(config,message_id,subject,body)
    message = EmailMessage()
    message["From"], message["To"], message["Subject"] = config["sender"], (", ".join(config["recipient"]) if isinstance(config["recipient"], list) else config["recipient"]), subject
    message["Message-ID"] = f"<radar-{message_id}@radar.local>"
    message.set_content(body)
    if config.get("body_html"):message.add_alternative(config["body_html"],subtype="html")
    context = ssl.create_default_context()
    if config["security"] == "ssl":
        client = smtplib.SMTP_SSL(config["host"], config["port"], timeout=15, context=context)
    else:
        client = smtplib.SMTP(config["host"], config["port"], timeout=15)
    try:
        client.ehlo()
        if config["security"] == "starttls":
            client.starttls(context=context)
            client.ehlo()
        if config["username"]:
            client.login(config["username"], config["password"])
        refused = client.send_message(message)
        if refused:
            raise RuntimeError("O servidor recusou o destinatário")
    finally:
        # A QUIT failure after DATA must not turn accepted mail into a retry.
        try:
            client.quit()
        except Exception:
            client.close()


def safe_error(exc):
    from .google_mail import GoogleMailError
    if isinstance(exc,GoogleMailError):
        return str(exc)
    # SMTP servers can echo addresses/tokens; never expose their raw reply.
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return "Autenticação SMTP recusada. Confira usuário e senha de aplicativo."
    if isinstance(exc, ssl.SSLError):
        return "Não foi possível validar a conexão TLS com o servidor SMTP."
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        return "Destinatário recusado pelo servidor SMTP."
    return "Envio SMTP não confirmado. Verifique servidor, porta e conexão; não foi marcado como entregue."
