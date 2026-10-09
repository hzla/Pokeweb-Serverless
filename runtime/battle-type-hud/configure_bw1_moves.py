"""Independently pin US revision-0 BW1 move-preview native bindings.

This creates disabled candidate profiles. Compiled fixtures and gameplay
acceptance must be verified before enabling a BW1 move DLL.
"""
import hashlib
import json
import os
from pathlib import Path

from configure_bw1 import HERE, WORKSPACE, BINDINGS as ICON_BINDINGS, load, unique_binding, thumb_calls

BINDINGS = {name: ICON_BINDINGS[name] for name in
            ('IsDsi', 'PPGet', 'ViewSrc', 'EffectiveTypes', 'EffectiveTypesBody', 'CheckSick')}
BINDINGS.update({
    'MoveDraw': (94, 0x02204cc1, 0x760),
    'MoveClear': (94, 0x022056b5, 0xe0),
    'MoveKey': (94, 0x02206141, 0x420),
    'CreateScreen': (94, 0x0220270d, 0x48),
    'GetMainModule': (94, 0x021f8755, 16),
    'ViewToBattle': (93, 0x021b8ed9, 48),
    'FrontBattler': (93, 0x021b98ad, 48),
    'TypeAffinity': (93, 0x021d799d, 48),
    'MoveParam': (0, 0x0201bd29, 192),
    'MoveFlag': (0, 0x0201beb9, 164),
    'HiddenPower': (0, 0x02018791, 64),
    'FlushBitmap': (0, 0x02045334, 80),
    'BattleStat': (93, 0x021d59b5, 292),
    'SickCont': (93, 0x021d6315, 16),
    'HeldItem': (93, 0x021d5b41, 12),
    'FieldSim': (93, 0x021ba08d, 8),
    'FieldEffect': (93, 0x021efce5, 12),
})


def main():
    inputs = {'B': os.environ.get('BTH_B_ROM', WORKSPACE / 'cleanblack.nds'),
              'W': os.environ.get('BTH_W_ROM', Path.home() / 'Downloads/cleanroms/cleanwhite.nds')}
    _, reference = load(inputs['B'], b'IRBO')
    for game, code in [('B', b'IRBO'), ('W', b'IRAO')]:
        _, segments = load(inputs[game], code)
        functions, signatures = {}, []
        for name, (segment, entry, length) in BINDINGS.items():
            address = unique_binding(reference[segment], segments[segment], entry, length)
            functions[name] = address
            base, data = segments[segment]
            signatures.append({'name': name, 'segment': segment, 'address': address & ~1,
                               'bytes': data[(address & ~1) - base:(address & ~1) - base + length].hex()})
        base, data = segments[94]
        hooks = []
        for name in ('MoveDraw', 'MoveKey'):
            sites = thumb_calls(base, data, functions[name])
            assert len(sites) == 2, (game, name, sites)
            for address in sites:
                hooks.append({'kind': 'THUMB_BRANCH_LINK', 'name': name, 'address': address,
                              'bytes': data[address - base:address - base + 4].hex()})
        clear = (functions['CreateScreen'] & ~1) + 10
        assert clear in thumb_calls(base, data, functions['MoveClear'])
        hooks.append({'kind': 'THUMB_BRANCH_LINK', 'name': 'MoveClear', 'address': clear,
                      'bytes': data[clear - base:clear - base + 4].hex()})
        old_path = HERE / f'profile-MoveEffectiveness-{game}.json'
        old = json.loads(old_path.read_text()) if old_path.exists() else {}
        profile = {'game': game, 'rom_code': code.decode(), 'revision': 0, 'dsAccepted': False,
                   'overlay_id': 94, 'overlay_base': base, 'graphicsArchive': 'a/0/1/1',
                   'implementation': 'BW1 candidate native bindings; DS gameplay acceptance pending',
                   'functions': functions, 'signatures': signatures, 'hooks': hooks, 'resources': {},
                   'reference_segments': {str(n): hashlib.sha256(d).hexdigest() for n, (_, d) in segments.items()},
                   'layout': {'rule': 0x50, 'screen': 0x58, 'state': 0x68, 'pfd': 0x64,
                              'window': 0x228, 'bitmap': 0x22c, 'selectedActive': 0x27c,
                              'selectedSlots': 0x244, 'moveArray': 0x26c, 'rotationMons': 0x2a4,
                              'targetEntries': 'BW1 key rows can repeat target IDs; distinct IDs determine the single-target fallback. A Black live triple capture recorded four copies of ID 3.',
                              'verification': 'Retail creation/clear/key instructions and scoped DS input captures; full gameplay pending'},
                   'mechanics': {
                       'battlePokemon': {'heldItem': 0x12, 'conditionRecords': 0x1c,
                                         'conditionRecordBytes': 4, 'currentTypes': 0xf8, 'ability': 0x13c},
                       'abilityQuery': 17,
                       'conditions': {'abilitySuppressed': 16, 'typeRevealed': 17, 'embargo': 19,
                                      'ingrain': 21, 'roost': 24, 'magnetRise': 30, 'smackDown': 31, 'telekinesis': 32},
                       'fieldSimulation': {'mainOffset': 0x2bc, 'effectsOffset': 0x148,
                                           'effectBytes': 4, 'gravity': 2, 'magicRoom': 7},
                       'verification': 'Pinned native reader instructions; compiled retail-reader tests required. Full native battle mechanics/gameplay acceptance pending',
                       'customMechanicsFallback': 'Neutral for unknown abilities and existing excluded variable-type moves'}}
        old_path.write_text(json.dumps(profile, indent=2) + '\n')
        lines = ['// Generated from independently checked retail BW1 native entries.', '#pragma once']
        lines += [f'constexpr unsigned Native{name} = 0x{address:08x};' for name, address in functions.items()]
        lines += [f'constexpr unsigned Move{key[0].upper() + key[1:]} = 0x{value:x};'
                  for key, value in profile['layout'].items() if isinstance(value, int)]
        (HERE / 'build' / f'addresses-MoveEffectiveness-{game}.h').write_text('\n'.join(lines) + '\n')
        signatures = {'MoveDraw': 'void* b, const unsigned short* p', 'MoveClear': 'void* b, unsigned t',
                      'MoveKey': 'void* b, void* tp, const signed char* k, const void* m, int h, unsigned f'}
        arguments = {'MoveDraw': 'b,p', 'MoveClear': 'b,t', 'MoveKey': 'b,tp,k,m,h,f'}
        wrappers = [f'extern "C" {"int" if h["name"] == "MoveKey" else "void"} '
                    f'{h["kind"]}_94_0x{h["address"]:X}({signatures[h["name"]]}) '
                    f'{{ return Hud{h["name"]}({arguments[h["name"]]}); }}' for h in hooks]
        (HERE / 'build' / f'hooks-MoveEffectiveness-{game}.h').write_text('\n'.join(wrappers) + '\n')
        print(game, len(functions), 'native bindings and five independent move hooks pinned; port pending')


if __name__ == '__main__':
    main()
