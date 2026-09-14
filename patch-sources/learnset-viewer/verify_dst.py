"""Read-only diagnosis of the missing-command 1.0.0 capture. No game execution.

Usage: python3 runtime/learnset-viewer/verify_dst.py CAPTURE.dst
The capture remains private; only module/header diagnostics are printed.
"""
from pathlib import Path
import json
import struct
import sys
import zlib

HERE = Path(__file__).resolve().parent
RAM = 0x02000000

def word(data, offset):
    return struct.unpack_from('<I', data, offset)[0]

def read_ram(path):
    raw = path.read_bytes()
    assert raw[:16] == b'DeSmuME SState\0\0' and word(raw, 16) == 12
    data = raw[32:] if word(raw, 28) == 0xffffffff else zlib.decompress(raw[32:])
    offset = 0
    while offset < len(data):
        kind = word(data, offset)
        offset += 4
        if kind == 0xffffffff:
            break
        size = word(data, offset)
        offset += 4
        assert size <= len(data)-offset
        if kind == 4:
            end = offset+size
            while offset < end:
                tag, size, count = struct.unpack_from('<4sII', data, offset)
                offset += 12
                assert size*count <= end-offset
                if tag == b'WRAM':
                    assert size*count == 0x400000
                    return data[offset:offset+size*count]
                offset += size*count
            break
        offset += size
    raise ValueError('No 4 MiB ARM9 memory in capture')

def matches(data, pattern):
    offset = 0
    while (offset := data.find(pattern, offset)) >= 0:
        yield offset
        offset += 1

def diagnose(ram):
    layout = json.loads((HERE.parents[1]/'src/assets/codeinjection/learnsetViewerManifest.json').read_text())['games']['W2']
    for hook in layout['hooks']:
        if hook['label'] in ('MenuCreate', 'MenuSelect', 'Dispatch'):
            offset = hook['address']-RAM
            assert ram[offset:offset+8] == bytes.fromhex(hook['expectedHex'])[:8], 'This is not the unhooked 1.0.0 capture'
    assert b'LSVMSG1\0' not in ram, 'A Learnset companion is already loaded'
    records = []
    # Bundled PMC uses short enums: FileID 8, handle 4, priority/start 1 each,
    # padding 2, extern-list 4, overlay-list 4, next/previous 4 each.
    for overlays in ((165, 12), (258,)):
        pattern = struct.pack('<'+'I'*(len(overlays)+1), len(overlays), *overlays)
        for entry in matches(ram, pattern):
            for ref in matches(ram, struct.pack('<I', RAM+entry)):
                state = ref-20
                if state < 0 or state+32 > len(ram) or state & 3:
                    continue
                if ram[state+12] == 5 and ram[state+13] == 0 and word(ram, state+8) == 0 and word(ram, state+16) == 0:
                    records.append(dict(overlays=list(overlays), priority=5, started=False, handle=0))
    assert len(records) == 2, records
    # Captured expanded menu: summary, switch, item, relearn, cancel. Five
    # commands leave three slots, so the capacity guard is not the failure.
    menus = list(matches(ram, struct.pack('<BB5H', 5, 0, 0, 3, 4, 7, 6)))
    assert menus
    return dict(companions=records, original_menu_hooks_unchanged=True,
                expanded_menu_count=5, pmc_supported_priorities=[0, 1, 2, 3, 4],
                diagnosis='Both companions are outside the PMC activation priority range')

if __name__ == '__main__':
    print(json.dumps(diagnose(read_ram(Path(sys.argv[1]))), indent=2))
