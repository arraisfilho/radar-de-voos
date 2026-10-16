"""Stable display numbers, independent of the existing internal UUIDs."""


def setup(c):
    for entity,reference in [('accounts','client_refs'),('searches','monitor_refs')]:
        c.execute(f'''CREATE TABLE IF NOT EXISTS {reference}(
          number INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_id TEXT NOT NULL UNIQUE REFERENCES {entity}(id) ON DELETE CASCADE)''')
        c.execute(f'''INSERT INTO {reference}(entity_id)
          SELECT id FROM {entity} WHERE id NOT IN (SELECT entity_id FROM {reference})
          ORDER BY created,id''')
        c.execute(f'''CREATE TRIGGER IF NOT EXISTS number_{entity}_insert
          AFTER INSERT ON {entity} BEGIN
          INSERT INTO {reference}(entity_id) VALUES(NEW.id);
          END''')
