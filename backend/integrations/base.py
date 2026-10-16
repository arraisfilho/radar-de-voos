from typing import Protocol


class IntegrationError(Exception):
    def __init__(self,message,uncertain=False):
        super().__init__(message);self.uncertain=uncertain


class WhatsAppProvider(Protocol):
    id: str
    name: str
    fields: list[dict]
    def normalize(self,values:dict)->dict: ...
    def check(self,values:dict)->dict: ...
    def send(self,values:dict,phone:str,text:str)->str: ...
