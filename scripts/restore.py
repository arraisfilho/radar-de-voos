"""Restore a trusted radar backup from stdin. Stop the application first."""
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tarfile
import tempfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.store import DATA_DIR


def restore(stream):
    os.umask(0o077)
    DATA_DIR.mkdir(parents=True,exist_ok=True,mode=0o700)
    with tempfile.TemporaryDirectory(dir=DATA_DIR) as folder:
        staging=Path(folder);names=set()
        with tarfile.open(fileobj=stream,mode='r|gz') as archive:
            for member in archive:
                name=member.name
                if (not member.isfile() or Path(name).name!=name or name in names
                    or not (name=='radar.sqlite3' or name.endswith('.json'))):
                    raise ValueError('Backup contém um arquivo inesperado.')
                names.add(name)
                source=archive.extractfile(member)
                with (staging/name).open('wb') as output:shutil.copyfileobj(source,output)
        if 'radar.sqlite3' not in names:raise ValueError('Backup sem banco de dados.')
        with sqlite3.connect('file:'+str(staging/'radar.sqlite3')+'?mode=ro',uri=True) as db:
            if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or db.execute('PRAGMA foreign_key_check').fetchall():
                raise ValueError('Backup inválido: integridade do banco.')
        # Validation completed before touching any live file. No running app may share this volume.
        for suffix in ('-wal','-shm'):(DATA_DIR/('radar.sqlite3'+suffix)).unlink(missing_ok=True)
        for old in DATA_DIR.glob('*.json'):old.unlink()
        for name in names:
            (staging/name).chmod(0o600)
            os.replace(staging/name,DATA_DIR/name)
    return len(names)


if __name__=='__main__':
    if sys.argv[1:]!=['--from-stdin']:raise SystemExit('Uso: python scripts/restore.py --from-stdin < backup.tar.gz (aplicação parada)')
    try:print('Backup restaurado:',restore(sys.stdin.buffer),'arquivos.')
    except (ValueError,OSError,sqlite3.Error,tarfile.TarError) as exc:raise SystemExit(str(exc))
