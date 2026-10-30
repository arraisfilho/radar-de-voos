"""Account-scoped revisions for conditional state polling."""
import hashlib
import json


def setup(c):
    c.execute('CREATE TABLE IF NOT EXISTS account_revisions(user_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, revision INTEGER NOT NULL DEFAULT 0)')
    c.execute('INSERT OR IGNORE INTO account_revisions(user_id) SELECT id FROM accounts')
    for operation in ('INSERT','UPDATE'):
        c.execute(f'''CREATE TRIGGER IF NOT EXISTS revision_accounts_{operation.lower()} AFTER {operation} ON accounts BEGIN
          INSERT INTO account_revisions(user_id,revision) VALUES(NEW.id,1) ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
        END''')
    tables=['filter_result_refs','searches','results','cycles','snapshots','baselines','alerts','outbox']
    # Compressing results.data (retention.compress_legacy) keeps the response: no new revision.
    # Older databases have this trigger on any column.
    c.execute('DROP TRIGGER IF EXISTS revision_results_update')
    for table in tables:
        for operation in ('INSERT','UPDATE','DELETE'):
            refs=['NEW'] if operation=='INSERT' else ['OLD'] if operation=='DELETE' else ['OLD','NEW']
            event='UPDATE OF cycle_id,search_id,version,direction,route_key,collected,status' if (table,operation)==('results','UPDATE') else operation
            if table=='searches':
                owners='SELECT id FROM accounts WHERE id IN ('+','.join(ref+'.owner_id' for ref in refs)+')'
            else:
                ids=','.join(ref+'.search_id' for ref in refs)
                owners='SELECT id FROM accounts WHERE id IN (SELECT owner_id FROM searches WHERE id IN ('+ids+'))'
                if table=='outbox':owners+=' OR (role=\'admin\' AND ('+' OR '.join(ref+'.search_id IS NULL' for ref in refs)+'))'
            c.execute(f'''CREATE TRIGGER IF NOT EXISTS revision_{table}_{operation.lower()} AFTER {event} ON {table} BEGIN
              UPDATE account_revisions SET revision=revision+1 WHERE user_id IN ({owners});
            END''')


def token(c,user_id,secret,context):
    row=c.execute('SELECT revision FROM account_revisions WHERE user_id=?',(user_id,)).fetchone()
    value=[secret,user_id,row[0] if row else 0,context]
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
