"""Consistent SQLite backup plus private integration JSON files. No network access."""
import argparse
import datetime
import os
from pathlib import Path
import sqlite3
import tarfile
import tempfile
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.store import DATA_DIR


def backup(destination):
    os.umask(0o077)
    source=DATA_DIR/'radar.sqlite3'
    if not source.exists():raise ValueError('Banco não encontrado; nenhum backup foi criado.')
    destination=Path(destination).resolve()
    destination.mkdir(parents=True,exist_ok=True,mode=0o700)
    target=destination/('radar-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.tar.gz')
    with tempfile.TemporaryDirectory(dir=destination) as folder:
        snapshot=Path(folder)/'radar.sqlite3'
        with sqlite3.connect(source) as original,sqlite3.connect(snapshot) as output:original.backup(output)
        with sqlite3.connect(snapshot) as checked:
            if checked.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('Falha na integridade do banco.')
        with tarfile.open(target,'w:gz') as archive:
            archive.add(snapshot,arcname='radar.sqlite3')
            for file in sorted(DATA_DIR.glob('*.json')):
                if file.is_file() and not file.is_symlink():archive.add(file,arcname=file.name)
    target.chmod(0o600)
    return target


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination',type=Path,default=DATA_DIR/'backups')
    args=parser.parse_args()
    try:print(backup(args.destination))
    except (ValueError,OSError,sqlite3.Error) as exc:raise SystemExit(str(exc))
