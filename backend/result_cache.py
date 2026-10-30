"""Reuse immutable source responses across compatible filter revisions."""
import json
import zlib
from .domain import Search

LEVEL = 6


def encode(value):
    """results.data as stored: the source response as JSON, zlib-compressed (BLOB)."""
    text = value if isinstance(value, str) else json.dumps(value)
    return zlib.compress(text.encode(), LEVEL)


def decode(value):
    """results.data as a dict: compressed BLOB, or JSON text in rows written before compression."""
    if isinstance(value, (bytes, bytearray, memoryview)):
        value = zlib.decompress(value)
    return json.loads(value)


def acquisition(config):
    """Match frontend canPreview: source-affecting fields only."""
    return (sorted(config.origins), sorted(config.destinations), config.adults,
            config.children, config.infants_in_seat, config.infants_on_lap,
            config.cabin, config.currency, config.checked_bags,
            config.outbound.start[:10], config.outbound.end[:10],
            (config.inbound.start[:10], config.inbound.end[:10]) if config.inbound else None)


def latest(c, row, valid_only=False):
    # UNION avoids duplicate rows when a response is both direct and referenced.
    return c.execute("""WITH pool AS (
      SELECT id,route_key,status FROM results WHERE search_id=? AND version=?
      UNION
      SELECT r.id,r.route_key,r.status FROM results r JOIN filter_result_refs f ON f.result_id=r.id
        WHERE f.search_id=? AND f.version=? AND r.search_id=f.search_id
    ) SELECT * FROM results WHERE id IN (
      SELECT MAX(id) FROM pool WHERE (?=0 OR status!='error') GROUP BY route_key
    )""", (row['id'], row['version'], row['id'], row['version'], int(valid_only))).fetchall()


def carry_forward(c, row, config):
    previous = Search.model_validate_json(row['config'])
    compatible = acquisition(previous) == acquisition(config)
    # Only current-version references are needed; old raw data and history stay untouched.
    ids = {r['id'] for valid in (False, True) for r in latest(c, row, valid)} if compatible else set()
    c.execute('DELETE FROM filter_result_refs WHERE search_id=?', (row['id'],))
    c.executemany('INSERT INTO filter_result_refs(search_id,version,result_id) VALUES(?,?,?)',
                  [(row['id'], row['version']+1, rid) for rid in ids])
    return len(ids)
