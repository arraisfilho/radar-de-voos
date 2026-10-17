"""Turn off the administrator's second factor on the server, when the authenticator app and the
recovery codes are lost. The password stays the same; the account's sessions and login lock end."""
import os
import sqlite3
import sys
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend import accounts,audit,store,two_factor


def main():
    os.umask(0o077)
    # store.setup() is not called: it would also recover interrupted work of a running instance.
    if not (store.DATA_DIR/'radar.sqlite3').exists():raise SystemExit('Banco não encontrado. Nenhuma conta foi alterada.')
    try:
        with store.db() as c:
            row=c.execute("SELECT a.id,a.name,a.phone FROM accounts a JOIN two_factor t ON t.user_id=a.id WHERE a.role='admin' AND t.enabled IS NOT NULL").fetchone()
    except sqlite3.OperationalError:row=None
    if not row:raise SystemExit('A verificação em duas etapas não está ativa. Nenhuma conta foi alterada.')
    try:answer=input('Desativar a verificação em duas etapas de '+row['name']+'? Digite SIM para confirmar: ').strip()
    except (EOFError,KeyboardInterrupt):answer=''
    if answer!='SIM':raise SystemExit('Nenhuma conta foi alterada.')
    with store.db() as c:
        c.execute('BEGIN IMMEDIATE')
        if not two_factor.enabled(c,row['id']):raise SystemExit('A verificação em duas etapas já estava desativada. Nenhuma conta foi alterada.')
        two_factor.forget(c,row['id'])
        # A lost device may still hold a session, and wrong codes may have locked the password login.
        c.execute('DELETE FROM sessions WHERE user_id=?',(row['id'],))
        accounts.clear_login_failures(c,row['phone'])
        # No session and no address: the audit shows the change without an author.
        audit.record(SimpleNamespace(client=None,headers={}),'admin_2fa_disabled',row['id'],c=c)
    print('Verificação em duas etapas desativada e sessões da conta encerradas. Entre com a senha e ative de novo em Perfil > Segurança.')


if __name__=='__main__':main()
