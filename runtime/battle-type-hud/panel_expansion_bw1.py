"""Reversible BW1 gauge expansion, retaining every native art byte.

Two transparent 16x16 OBJ pieces follow each native gauge. Their palettes are
selected by the runtime; no native palette entries or HP/EXP pixels change.
"""
import hashlib
import json
from pathlib import Path
import struct

from panel_expansion import apply_edits, transform

HERE = Path(__file__).resolve().parent
PAIRS = ((165, 166), (168, 169), (171, 172), (174, 175))


def generate():
    changes = {}
    for char, cell in PAIRS:
        for member in (char, cell):
            raw = (HERE / 'build' / f'B-resource-{member}.bin').read_bytes()
            assert raw == (HERE / 'build' / f'W-resource-{member}.bin').read_bytes()
            edits = []

            def edit(at, old, new):
                assert raw[at:at + len(old)] == old
                edits.append({'offset': at, 'old': old.hex(), 'new': new.hex()})

            def number(at, value, size=4):
                edit(at, raw[at:at + size], value.to_bytes(size, 'little'))

            if member == char:
                assert raw[:4] == b'RGCN' and len(raw) in (2096, 2352)
                number(8, len(raw) + 256)
                number(20, struct.unpack_from('<I', raw, 20)[0] + 256)
                number(40, struct.unpack_from('<I', raw, 40)[0] + 256)
                edit(len(raw), b'', bytes(256))
            else:
                assert raw[:4] == b'RECN' and struct.unpack_from('<H', raw, 24)[0] == 1
                count, flags, offset = struct.unpack_from('<HHI', raw, 48)
                assert count == (3 if char == 171 else 2)
                assert flags == (21 if count == 3 else 17) and offset == 0
                # Native 1D-64K OBJ mapping uses 64-byte character units.
                tiles = (len((HERE / 'build' / f'B-resource-{char}.bin').read_bytes()) - 48) // 64
                number(8, len(raw) + 16)
                number(20, struct.unpack_from('<I', raw, 20)[0] + 16)
                number(48, count + 2, 2)
                number(50, flags | 4, 2)
                # Offscreen until the runtime validates/binds the palette.
                # Stored cell OAM is six bytes per piece; the bank is padded.
                attrs = struct.pack('<6H', 0x00c0, 0x4000, tiles,
                                     0x00c0, 0x4000, tiles + 2)
                # Lower OAM indices draw in front at equal priority. Keep
                # private pieces first, with native attributes byte-identical.
                native_attrs = raw[56:56 + 6 * count]
                edit(56, native_attrs, attrs + native_attrs + bytes(4))
            patched = apply_edits(raw, edits)
            change = {'originalSha256': hashlib.sha256(raw).hexdigest(),
                      'patchedSha256': hashlib.sha256(patched).hexdigest(), 'edits': edits}
            assert transform(patched, change, True) == raw
            changes[str(member)] = change
    (HERE / 'panel-expansion-bw1.json').write_text(json.dumps(changes, indent=2) + '\n')
    print('BW1: eight reversible resources; two OBJ pieces and 256 char bytes per panel; native art unchanged')
    return changes


if __name__ == '__main__':
    generate()
