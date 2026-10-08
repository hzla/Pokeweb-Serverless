"""Verify BW1 compiled wrappers against retail Summary code and ARM/Thumb APIs.

This is isolated CPU verification, not DS gameplay or visual acceptance.
"""
import hashlib
import json
import os
from pathlib import Path
import struct
import ndspy.rom
import ndspy.codeCompression
from build import HERE, WORKSPACE
from build_bw1 import call_target
from verify import verify


def arm_branch(data, address):
    word = struct.unpack('<I', data)[0]
    assert word & 0xff000000 == 0xeb000000
    delta = (word & 0xffffff) << 2
    if delta & 0x2000000:
        delta -= 0x4000000
    return address + 8 + delta


def main():
    for game, default in [('B', WORKSPACE / 'cleanblack.nds'),
                          ('W', Path.home() / 'Downloads/cleanroms/cleanwhite.nds')]:
        path = os.environ.get(f'SUMMARY_{game}_ROM', default)
        profile = json.loads((HERE / f'profile-{game}.json').read_text())
        rom = ndspy.rom.NintendoDSRom.fromFile(path)
        assert bytes(rom.idCode).decode() == profile['idCode'] and rom.version == 0
        overlay = rom.loadArm9Overlays([131])[131]
        assert hashlib.sha256(overlay.data).hexdigest() == profile['overlaySha256']
        arm = ndspy.codeCompression.decompress(rom.arm9)
        addresses = {int(e['reference'], 16): int(e['address'], 16) for key in ('apis', 'native') for e in profile[key]}
        # Additional instrumentation targets come from the pinned native draw,
        # update and title routines, rather than extrapolating ARM9 offsets.
        anchors = {
            0x21b4e1c: 0x21da0b8, 0x2024200: 0x21da0e0,
            0x2024548: 0x21da0fc, 0x20242a0: 0x21da11a,
            0x21ba57c: 0x21da17c, 0x2048788: 0x21da370,
            0x20489b8: 0x21da378, 0x2021ca8: 0x21da3a0,
            0x2048590: 0x21da3a6, 0x2048800: 0x21da3ac,
            0x21b9804: 0x21d975e, 0x2021c48: 0x21d977e,
            0x2048270: 0x21d97a2, 0x2048298: 0x21d97a8,
            0x2048500: 0x21d97ae, 0x2045ba8: 0x21d97b2,
            0x21ba67c: 0x21d98da, 0x20457bc: 0x21d9e52,
            0x2044fbc: 0x21d9e6e, 0x2045080: 0x21d9e86,
        }
        for reference, site in anchors.items():
            site += 0x20 if game == 'W' else 0
            at = site - overlay.ramAddress
            addresses[reference] = call_target(overlay.data[at:at + 4], site)
        addresses[0x21b85e0] = 0x21d9741 if game == 'B' else 0x21d9761
        addresses[0x21b8ce4] = 0x21d9e45 if game == 'B' else 0x21d9e65
        sequence = addresses[0x204c4e4]
        site = sequence + 28
        addresses[0x204c56c] = arm_branch(arm[site - rom.arm9RamAddress:site - rom.arm9RamAddress + 4], site)
        # Enter the actual ARM rectangle scanner with explicit touch coordinates.
        hit = addresses[0x203da38]
        site = hit + 16
        predicate = arm_branch(arm[site - rom.arm9RamAddress:site - rom.arm9RamAddress + 4], site)
        site = predicate + 68
        scanner = arm_branch(arm[site - rom.arm9RamAddress:site - rom.arm9RamAddress + 4], site)
        verify(game, 0, 0, {'rom': path, 'addresses': addresses, 'touchScanner': scanner,
            'hooks': [(e['label'], int(e['address'], 16), int(e['target'], 16)) for e in profile['hooks']]})


if __name__ == '__main__':
    main()
