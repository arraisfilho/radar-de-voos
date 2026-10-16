"""Inspect staged blobs, never printing suspected secret values."""
import re
import subprocess
from pathlib import PurePosixPath

RULES={
    'private key':rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'Google OAuth secret':rb'GOCSPX-[A-Za-z0-9_-]{20,}',
    'Google API key':rb'AIza[A-Za-z0-9_-]{35}',
    'GitHub token':rb'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})',
    'AWS access key':rb'AKIA[0-9A-Z]{16}',
}

def main():
    names=subprocess.check_output(['git','diff','--cached','--name-only','--diff-filter=ACMR','-z']).decode().split('\0')
    issues=[]
    for name in filter(None,names):
        parts=PurePosixPath(name).parts
        if (('.env'==parts[-1] or parts[-1].endswith('.env') or '-private.' in parts[-1]
             or parts[-1].endswith(('.sqlite3','.db','.pem','.key'))
             or any(p in ('.data','node_modules','backups') for p in parts))):
            issues.append((name,'private runtime file'))
        blob=subprocess.check_output(['git','show',':'+name])
        for label,pattern in RULES.items():
            if re.search(pattern,blob):issues.append((name,label))
    for name,label in issues:print(name+': '+label)
    if issues:return 1
    print('Staged file checks passed; no runtime data or recognized credentials found.')
    return 0

if __name__=='__main__':raise SystemExit(main())
