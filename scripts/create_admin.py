"""Create the first administrator interactively, without secrets in shell arguments."""
import getpass
import os
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi import Response,HTTPException
from pydantic import ValidationError
from backend import accounts,store

def main():
    os.umask(0o077)
    store.setup(seed=False)
    with store.db() as c:
        if c.execute("SELECT 1 FROM accounts WHERE role='admin'").fetchone():
            raise SystemExit('Já existe um administrador. Nenhuma conta foi alterada.')
    name=input('Nome do administrador: ').strip()
    country=input('País ISO (BR, US, PT...): ').strip().upper()
    phone=input('Telefone de acesso: ').strip()
    email=input('E-mail de contato (opcional): ').strip()
    password=getpass.getpass('Senha (mínimo 10 caracteres): ')
    if password!=getpass.getpass('Repita a senha: '):raise SystemExit('As senhas não coincidem.')
    try:
        data=accounts.Registration(name=name,country=country,phone=phone,password=password,emails=[email] if email else [])
        result=accounts.register(data,Response(),admin=True)
        # CLI bootstrap never keeps the unused HTTP session minted by register().
        with store.db() as c:c.execute('DELETE FROM sessions WHERE user_id=?',(result['id'],))
    except ValidationError:
        raise SystemExit('Dados inválidos. Confira nome, telefone, e-mail e tamanho da senha.')
    except HTTPException as exc:raise SystemExit(str(exc.detail))
    print('Administrador criado. Entre no site com o telefone e a senha informados.')

if __name__=='__main__':main()
