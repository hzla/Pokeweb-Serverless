"""Pin BW1 Type Icons bindings independently in both US revision-0 games.

These profiles accompany disabled candidate DLLs. BW1 uses separate icon
pieces and private palette banks; gameplay acceptance remains pending.
"""
import hashlib
import json
import os
from pathlib import Path
import struct

import ndspy.codeCompression
import ndspy.lz10
import ndspy.narc
import ndspy.rom
from capstone import Cs, CS_ARCH_ARM, CS_MODE_ARM, CS_MODE_THUMB

HERE = Path(__file__).resolve().parent
WORKSPACE = HERE.parents[2]
# Addresses in Black were identified from retail callers and function bodies.
# White is independently matched below; no blanket address delta is applied.
# name: (segment, Black entry including instruction mode, pinned byte count)
BINDINGS = {
    'IsDsi': (0, 0x02085d3c, 76),
    'Add': (94, 0x022070c1, 80), 'AddPP': (94, 0x02207289, 80),
    'Main': (94, 0x02206eb5, 80), 'Del': (94, 0x02207961, 64),
    'Release': (94, 0x02206e29, 64), 'Status': (94, 0x02208815, 88),
    'NameDraw': (94, 0x022080f5, 80), 'SexDraw': (94, 0x02208269, 80),
    'LevelDraw': (94, 0x02208551, 80), 'GaugePosition': (94, 0x022079c1, 96),
    'GetPfd': (94, 0x021f86e1, 16), 'GetRule': (94, 0x021f8711, 16),
    'GetProxy': (0, 0x0204b7c8, 40), 'PalAddr': (0, 0x0204aef4, 52),
    'PaletteProxy': (0, 0x0204aec0, 52),
    'PPGet': (0, 0x02017e1d, 48), 'ViewSrc': (93, 0x021d5865, 24),
    'PersonalParam': (0, 0x02019c91, 16), 'PokemonBoxGetter': (0, 0x02018e35, 0x4c0),
    'EffectiveTypes': (93, 0x021d57fd, 24),
    'EffectiveTypesBody': (93, 0x021d57a9, 84), 'CheckSick': (93, 0x021d62c5, 20),
    'SpriteInit': (0, 0x0204cfdc, 108), 'CellInit': (0, 0x0204d158, 52),
    'CellSelect': (0, 0x0206419c, 84),
    'PalFree': (0, 0x0204ada4, 64), 'PaletteNarcLoad': (0, 0x0204ac18, 64),
    'PaletteReserveCore': (0, 0x0204dd08, 504),
    'PaletteNarcLoadSimple': (0, 0x0204acec, 64), 'CellResourceFree': (0, 0x0204afd8, 64),
    'CharAlloc': (0, 0x0204a7a0, 64), 'CharUpload': (0, 0x0204aa94, 64),
    'CharFree': (0, 0x0204a8d4, 64),
    'UnitAlloc': (0, 0x0204b100, 64), 'UnitFree': (0, 0x0204b1cc, 64),
    'ActorAlloc': (0, 0x0204b294, 140), 'ActorFree': (0, 0x0204b3b4, 64),
    'ActorPosition': (0, 0x0204b528, 20), 'ActorVisible': (0, 0x0204b3dc, 36),
}
# Literal pointers in GaugePosition, decoded as signed native coordinates.
TABLES = {
    'EnemyPositions': (0x02207b3c, (216, 120, 44, 40, 216, 98, 48, 28, 220, 128, 44, 54)),
    'EnemyTriplePositions': (0x02207b44, (216, 120, 44, 40, 216, 95, 48, 19, 220, 116, 44, 40, 224, 137, 40, 61)),
    'RotationPositions': (0x02207b48, (216, 120, 44, 40, 220, 116, 44, 40, 216, 95, 48, 19, 224, 137, 40, 61)),
}
HOOK_COUNTS = {'Add': 3, 'AddPP': 3, 'Main': 1, 'Del': 1, 'Release': 1,
               'Status': 2, 'NameDraw': 1, 'SexDraw': 1, 'LevelDraw': 2}


def load(path, code):
    rom = ndspy.rom.NintendoDSRom.fromFile(path)
    assert rom.idCode == code and rom.version == 0, 'Expected US revision 0'
    blobs = {n: (o.ramAddress, bytes(o.data)) for n, o in rom.loadArm9Overlays([93, 94]).items()}
    blobs[0] = (rom.arm9RamAddress, ndspy.codeCompression.decompress(rom.arm9))
    return rom, blobs


def unique_binding(source, target, entry, length, arm_callee=None):
    base, data = source
    at = (entry & ~1) - base
    pattern = data[at:at + length]
    assert len(pattern) == length
    mask = bytearray([255] * length)
    mode = CS_MODE_THUMB if entry & 1 else CS_MODE_ARM
    md = Cs(CS_ARCH_ARM, mode)
    md.skipdata = True
    for ins in md.disasm(pattern, entry & ~1):
        off = ins.address - (entry & ~1)
        if ins.mnemonic in ('bl', 'blx'):
            mask[off:off + ins.size] = bytes(ins.size)
    # Absolute main-RAM literals are independently relocated between games.
    for off in range(0, length - 3, 4):
        value = struct.unpack_from('<I', pattern, off)[0]
        if 0x02000000 <= value < 0x03000000:
            mask[off:off + 4] = bytes(4)
    tb, td = target
    step = 2 if entry & 1 else 4
    fixed = [i for i, n in enumerate(mask) if n]
    hits = [tb + j for j in range(0, len(td) - length + 1, step)
            if td[j:j + 2] == pattern[:2] and all(td[j + i] == pattern[i] for i in fixed)]
    if arm_callee:
        offset, expected = arm_callee
        matched = []
        for hit in hits:
            word = struct.unpack_from('<I', td, hit - tb + offset)[0]
            assert word & 0xff000000 == 0xeb000000
            delta = (word & 0xffffff) << 2
            if delta & 0x2000000:
                delta -= 0x4000000
            if hit + offset + 8 + delta == expected:
                matched.append(hit)
        hits = matched
    assert len(hits) == 1, (hex(entry), list(map(hex, hits)))
    return hits[0] | (entry & 1)


def thumb_calls(base, data, target):
    hits = []
    for at in range(0, len(data) - 3, 2):
        lo, hi = struct.unpack_from('<HH', data, at)
        if lo & 0xf800 != 0xf000 or hi & 0xf800 != 0xf800:
            continue
        delta = ((lo & 2047) << 12) | ((hi & 2047) << 1)
        if delta & 0x400000:
            delta -= 0x800000
        if base + at + 4 + delta == (target & ~1):
            hits.append(base + at)
    return hits


def main():
    inputs = {'B': os.environ.get('BTH_B_ROM', WORKSPACE / 'cleanblack.nds'),
              'W': os.environ.get('BTH_W_ROM', Path.home() / 'Downloads/cleanroms/cleanwhite.nds')}
    loaded = {g: load(p, b'IRBO' if g == 'B' else b'IRAO') for g, p in inputs.items()}
    build = HERE / 'build'
    build.mkdir(exist_ok=True)
    for game, (rom, blobs) in loaded.items():
        found, signatures, hooks = {}, [], []
        for name, (seg, black, length) in BINDINGS.items():
            # The adjacent alternate actor constructor has the same wrapper
            # instructions but initializes a different sprite type. Decode
            # its actual call to the independently matched regular initializer.
            callee = (0x80, found['SpriteInit']) if name == 'ActorAlloc' else None
            entry = unique_binding(loaded['B'][1][seg], blobs[seg], black, length, callee)
            found[name] = entry
            base, data = blobs[seg]
            at = (entry & ~1) - base
            signatures.append({'name': name, 'segment': seg, 'address': entry & ~1,
                               'mode': 'THUMB' if entry & 1 else 'ARM', 'bytes': data[at:at + length].hex()})
        base, data = blobs[94]
        for name, count in HOOK_COUNTS.items():
            calls = thumb_calls(base, data, found[name])
            assert len(calls) == count, (game, name, list(map(hex, calls)))
            for site in calls:
                hooks.append({'name': name, 'kind': 'THUMB_BRANCH_LINK', 'address': site,
                              'bytes': data[site - base:site - base + 4].hex()})
            if name in ('Del', 'Status'):
                pointer = struct.pack('<I', found[name])
                sites = [base + at for at in range(0, len(data) - 3, 4) if data[at:at + 4] == pointer]
                assert len(sites) == 1, (game, name, sites)
                hooks.append({'name': name, 'kind': 'OFFSET', 'address': sites[0], 'bytes': pointer.hex()})
        coordinates = {}
        for name, (black_site, values) in TABLES.items():
            pattern = struct.pack('<' + 'h' * len(values), *values)
            hits = [base + at for at in range(0, len(data) - len(pattern) + 1, 2) if data[at:at + len(pattern)] == pattern]
            assert len(hits) == 1, (game, name, hits)
            body = data[(found['GaugePosition'] & ~1) - base:(found['GaugePosition'] & ~1) - base + 396]
            assert struct.pack('<I', hits[0]) in body
            if game == 'B':
                assert struct.unpack_from('<I', data, black_site - base)[0] == hits[0]
            coordinates[name] = list(values)
            signatures.append({'name': name, 'segment': 94, 'address': hits[0], 'bytes': pattern.hex()})
        # Pin complete creation and position bodies, including panel stride,
        # resource IDs, HP-number actor binding, and the coordinate references.
        for name, entry, length in [('GaugeCreation', 0x02207431, 0x36c), ('GaugePositionBody', 0x022079c1, 0x178)]:
            hit = unique_binding(loaded['B'][1][94], blobs[94], entry, length) & ~1
            signatures.append({'name': name, 'segment': 94, 'address': hit, 'bytes': data[hit - base:hit - base + length].hex()})
        narc = ndspy.narc.NARC(rom.getFileByName('a/0/1/1'))
        resources = {}
        for n in range(162, 189):
            raw = narc.files[n]
            if raw[0] == 16:
                raw = ndspy.lz10.decompress(raw)
            resources[str(n)] = hashlib.sha256(raw).hexdigest()
            (build / f'{game}-resource-{n}.bin').write_bytes(raw)
        profile = {'game': game, 'rom_code': bytes(rom.idCode).decode(), 'revision': 0,
                   'overlay_id': 94, 'overlay_base': base, 'dsAccepted': False,
                   'implementation': 'BW1 renderer candidate; DS gameplay acceptance pending',
                   'functions': found, 'signatures': signatures, 'hooks': hooks,
                   'layout': {'panelBase': 64, 'panelStride': 128, 'panelFlags': 112,
                              'gaugeFlags': 1088, 'currentCell': 164, 'proxyWords': 9,
                              'hasPokestar': False},
                   'coordinates': coordinates, 'resources': resources}
        arm_base, arm_data = blobs[0]
        context_literal = found['PaletteProxy'] + 48
        context_slot = struct.unpack_from('<I', arm_data, context_literal - arm_base)[0]
        assert 0x02000000 <= context_slot < 0x02400000
        profile['spriteContextSlot'] = context_slot
        profile['paletteRegistry'] = {'records': 272, 'count': 282, 'stride': 24,
                                      'flags': 20, 'unusedMask': 0x80000000}
        profile['reference_segments'] = {str(n): hashlib.sha256(d).hexdigest() for n, (_, d) in blobs.items()}
        (HERE / f'profile-TypeIcons-{game}.json').write_text(json.dumps(profile, indent=2) + '\n')
        lines = ['// Generated by configure_bw1.py; explicit ARM/Thumb entry modes.', '#pragma once']
        lines += [f'constexpr unsigned Native{name} = 0x{entry:08x};' for name, entry in found.items()]
        lines += [f'constexpr unsigned NativeSpriteContextSlot = 0x{context_slot:08x};']
        (build / f'addresses-{game}.h').write_text('\n'.join(lines) + '\n')
        signatures_by_hook = {
            'Add': ('void* g, void* m, void* b, unsigned t, unsigned p', 'g,m,b,t,p'),
            'AddPP': ('void* g, void* m, void* b, unsigned t, unsigned p', 'g,m,b,t,p'),
            'Main': ('void* g', 'g'), 'Del': ('void* g, unsigned p', 'g,p'),
            'Release': ('void* g', 'g'), 'Status': ('void* g, unsigned s, unsigned p', 'g,s,p'),
            'NameDraw': ('void* g, void* p, void* pp', 'g,p,pp'),
            'SexDraw': ('void* g, void* p', 'g,p'), 'LevelDraw': ('void* g, void* p', 'g,p'),
        }
        wrappers = []
        for hook in hooks:
            sig, args = signatures_by_hook[hook['name']]
            wrappers.append(f'extern "C" void {hook["kind"]}_94_0x{hook["address"]:X}({sig}) {{ Hud{hook["name"]}({args}); }}')
        (build / f'hooks-TypeIcons-{game}.h').write_text('\n'.join(wrappers) + '\n')
        print(game, len(found), 'native bindings;', len(hooks), 'hooks; BW1 gameplay acceptance pending')


if __name__ == '__main__':
    main()
