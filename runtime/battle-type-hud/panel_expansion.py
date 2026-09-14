"""Verified, reversible NCGR/NCER expansion; never ships native art bytes.

The existing regular player sprite gains a 32x16 piece at (-68,-12), using
eight appended transparent tiles. Singles paints it; doubles leaves it blank.
"""
import hashlib, json, struct
from pathlib import Path

HERE = Path(__file__).resolve().parent
def digest(raw): return hashlib.sha256(raw).hexdigest()

def apply_edits(raw, edits, undo=False):
    data = bytearray(raw)
    for edit in reversed(edits) if undo else edits:
        old, new = (bytes.fromhex(edit[key]) for key in (('new', 'old') if undo else ('old', 'new')))
        at = edit['offset']
        if data[at:at + len(old)] != old: raise ValueError('Player panel edit mismatch.')
        data[at:at + len(old)] = new
    return bytes(data)

def transform(raw, change, undo=False):
    target = 'originalSha256' if undo else 'patchedSha256'
    if digest(raw) == change[target]: return bytes(raw)
    if digest(raw) != change['originalSha256']:
        source = next((variant for variant in [change, *change.get('previous', [])]
                       if digest(raw) == variant['patchedSha256']), None)
        if source is None: raise ValueError('Unsupported player panel resource.')
        raw = apply_edits(raw, source['edits'], True)
        assert digest(raw) == change['originalSha256']
    result = bytes(raw) if undo else apply_edits(raw, change['edits'])
    assert digest(result) == change[target]
    return result

def generate():
    changes = {}
    for member in (438, 439):
        raw = (HERE / 'build' / f'W2-resource-{member}.bin').read_bytes()
        assert raw == (HERE / 'build' / f'B2-resource-{member}.bin').read_bytes()
        edits = []
        def edit(at, old, new):
            assert raw[at:at + len(old)] == old
            edits.append(dict(offset=at, old=old.hex(), new=new.hex()))
        def number(at, value, size=4):
            edit(at, raw[at:at + size], value.to_bytes(size, 'little'))
        if member == 438:
            assert len(raw) == 2096 and raw[:4] == b'RGCN'
            number(8, len(raw) + 256); number(20, 2080 + 256); number(40, 2048 + 256)
            edit(len(raw), b'', bytes(256))
        else:
            assert raw[0x30:0x38] == bytes.fromhex('0200110000000000')
            assert raw[0x38:0x44] == bytes.fromhex('f040c0c10000f04000c01000')
            number(8, len(raw) + 8); number(20, 52 + 8)
            number(0x30, 3, 2); number(0x32, 21, 2)
            edit(0x44, b'', struct.pack('<4H', 0x40f4, 0x81bc, 32, 0))
        data = apply_edits(raw, edits)
        change = dict(originalSha256=digest(raw), patchedSha256=digest(data), edits=edits, previous=[])
        if member == 439:
            old_edits = [dict(e) for e in edits]
            old_edits[-1]['new'] = struct.pack('<4H', 0x40f4, 0x81b0, 32, 0).hex()
            old = apply_edits(raw, old_edits)
            assert digest(old) == 'd2a0453433e548b2979d0a3df3b9c7fe54e3c6050eaa80d7d44aec6651637c91'
            change['previous'].append(dict(patchedSha256=digest(old), edits=old_edits))
            assert transform(old, change) == data and transform(old, change, True) == raw
        changes[str(member)] = change
        assert transform(data, change, undo=True) == raw
    (HERE / 'panel-expansion.json').write_text(json.dumps(changes, indent=2) + '\n')
    return changes

if __name__ == '__main__': generate()
