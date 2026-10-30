"""Return the free space of the SQLite database to the disk (VACUUM). Stop the application first."""
import os
from pathlib import Path
import shutil
import sqlite3
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.store import DATA_DIR

BUSY='Banco em uso: pare a aplicação antes de compactar (docker compose ... stop app).'
WARNING=('Aviso: o script só detecta a aplicação enquanto ela mantém o banco aberto. '
         'Confirme com "docker compose ... ps" que o serviço app está parado.')


def size(path):
    return sum(Path(str(path)+suffix).stat().st_size for suffix in ('','-wal') if Path(str(path)+suffix).exists())


def megabytes(value):
    return f'{value/1024/1024:.1f} MB'.replace('.',',')


def compact(path=None,timeout=2):
    """Sizes in bytes (database plus WAL) before and after."""
    path=Path(path or DATA_DIR/'radar.sqlite3')
    if not path.exists():raise ValueError('Banco não encontrado.')
    before=size(path)
    connection=sqlite3.connect(path,timeout=timeout,isolation_level=None)
    try:
        # Exclusive locking mode: any other open connection, even idle, refuses the lock below,
        # and the lock is then held until close, so nothing writes during VACUUM.
        connection.execute('PRAGMA locking_mode=EXCLUSIVE')
        try:connection.execute('BEGIN EXCLUSIVE');connection.execute('COMMIT')
        except sqlite3.OperationalError as exc:
            if exc.sqlite_errorname in ('SQLITE_BUSY','SQLITE_LOCKED'):raise ValueError(BUSY) from exc
            raise
        # The temporary copy and the WAL each take up to the pages in use (free pages are dropped);
        # with SQLITE_TMPDIR above, both land on the data volume.
        used=connection.execute('SELECT (page_count-freelist_count)*page_size FROM pragma_page_count,pragma_freelist_count,pragma_page_size').fetchone()[0]
        free=shutil.disk_usage(path.parent).free
        if free<2.1*used:
            raise ValueError(f'Espaço livre insuficiente em {path.parent}: {megabytes(free)} livres, são necessários '
                             f'{megabytes(2.1*used)} (duas vezes os dados do banco, {megabytes(used)}). Nada foi alterado.')
        connection.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        connection.execute('VACUUM')
        # In WAL mode VACUUM writes the new pages to the WAL; the checkpoint shrinks the file.
        connection.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    finally:
        connection.close()
    return before,size(path)


if __name__=='__main__':
    # VACUUM builds the new database in a temporary file. SQLite reads this variable before the
    # process's first connection; without it the file goes to /tmp, a 64 MB tmpfs in the Compose files.
    os.environ.setdefault('SQLITE_TMPDIR',str(DATA_DIR))
    print(WARNING,file=sys.stderr)
    try:before,after=compact()
    except (ValueError,OSError,sqlite3.Error) as exc:raise SystemExit(str(exc))
    print('Antes:',megabytes(before))
    print('Depois:',megabytes(after))
