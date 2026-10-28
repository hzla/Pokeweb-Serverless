"""Build the exact US White 2 Redux C-Gear adapter without changing its ROM.

The original repel DLL owns both encounter semantics and flag 0xBF7. The
adapter contributes no repel hooks; its button reads/toggles that same flag.
PC launches the unchanged Redux script. Native phenomenon edits stay intact.
"""
import argparse, copy, hashlib, json, shutil, struct, subprocess, sys
from pathlib import Path
import ndspy.rom, ndspy.narc, ndspy.codeCompression
from build import HERE, BUILD, WS, REPO, ASSETS, TOOLS, JAR, CALLS, WORDS, run

sys.path.insert(0, str(HERE.parent / 'battle-type-hud'))
from rpm_read import read_rpm

VERSION = '0.5.7-redux'
REPEL_SHA = '19154aa8ebb0941f21229e4121b9b4d902fb7a01d99e19718b16e6a2555d5adb'
PC_SHA = 'c1665e4652d9faac61d53a59fa8055398e160943e9d4c3f9115063640ed59751'

def sha(data): return hashlib.sha256(data).hexdigest()
def fingerprint(data):
    h = 0x811c9dc5
    for byte in data: h = ((h ^ byte) * 0x1000193) & 0xffffffff
    return f'{h:08x}'

def prepare(path):
    rom = ndspy.rom.NintendoDSRom.fromFile(path)
    assert bytes(rom.idCode) == b'IRDO' and rom.version == 0, 'Expected US White 2 revision 0.'
    base = json.loads((ASSETS / 'cgearQuickActionsManifest.json').read_text())
    assert base['version'] == '0.5.7', 'Audit the adapter again after changing the base runtime.'
    profile = copy.deepcopy(base['games']['W2'])
    overlays = rom.loadArm9Overlays([12, 36, 79])
    arm = ndspy.codeCompression.decompress(rom.arm9)
    for signature in profile['signatures']:
        if signature['label'] == 'Native phenomenon generator':
            expected = bytearray.fromhex(signature['expectedHex'])
            for address, old, new in ((0x21a216a, '1dd0', 'c046'), (0x21a2184, '04d3', '04e0')):
                at = address - signature['address']
                assert expected[at:at + 2] == bytes.fromhex(old)
                expected[at:at + 2] = bytes.fromhex(new)
            signature['expectedHex'] = expected.hex()
        if signature['label'] in ('QaRepelStep', 'QaRepelDepleted'): signature['patchSize'] = 0
        overlay = overlays.get(int(signature['module'])) if signature['module'] != 'ARM9' else None
        address = rom.arm9RamAddress if overlay is None else overlay.ramAddress
        data = arm if overlay is None else overlay.data
        at = signature['address'] - address
        expected = bytes.fromhex(signature['expectedHex'])
        assert data[at:at + len(expected)] == expected, f'Native signature differs: {signature["label"]}'
    pc = bytes(ndspy.narc.NARC(rom.getFileByName('a/0/5/6')).files[1244])
    assert len(pc) == 3220 and sha(pc) == PC_SHA, 'Unknown Redux PC script.'
    assert struct.unpack_from('<I', pc)[0] + 4 == 66
    matches = [(name, bytes(rom.getFileByName('patches/' + name))) for name in rom.filenames.subfolder('patches').files
               if sha(rom.getFileByName('patches/' + name)) == REPEL_SHA]
    assert len(matches) == 1, 'Expected exactly one audited Redux repel runtime.'
    rpm = read_rpm(matches[0][1])
    types = ['NULL', 'VALUE', 'FUNCTION_ARM', 'FUNCTION_THM', 'SECTION']
    contract = dict(sha256=REPEL_SHA, codeHex=rpm['code'].hex(), bssSize=rpm['bss'],
        symbols=[dict(address=s['address'], size=s['size'], type=types[s['type']], attributes=s['attributes']) for s in rpm['symbols']],
        relocations=rpm['relocations'])
    result = dict(id='redux', version=VERSION, baseVersion=base['version'],
        assetFileName='CGearQuickActionsReduxW2.dll', repelFlag=3063, repelModule=contract,
        pcScript=dict(archive='a/0/5/6', member=1244, length=len(pc), fingerprint=fingerprint(pc), sha256=PC_SHA, entry=66),
        games={'W2': profile})
    (HERE / 'redux-profile.json').write_text(json.dumps(result, indent=2) + '\n')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom', type=Path, help='Regenerate the exact profile from the audited Redux ROM.')
    args = parser.parse_args()
    if args.rom: prepare(args.rom)
    manifest = json.loads((HERE / 'redux-profile.json').read_text())
    assert manifest['version'] == VERSION
    out = BUILD / 'redux'; out.mkdir(parents=True, exist_ok=True)
    # Shared generated declarations are deterministic and require no ROM.
    run(REPO / 'node_modules/.bin/vite-node', REPO / 'scripts/generate-system-shop-bindings.ts')
    shutil.copyfile(BUILD / 'shop_picker.generated.h', out / 'shop_picker.generated.h')
    (out / 'profiles.generated.h').write_text('#pragma once\ninline u32 nativeAddress(u32 a){return a;}\ninline u32 overlayAddress(u32 a){return a;}\n')
    base = json.loads((ASSETS / 'cgearQuickActionsManifest.json').read_text())
    for kind, prefix in [('pcScript', 'PC'), ('shopScript', 'SHOP')]:
        value = base[kind]
        header = f'#pragma once\nconstexpr u32 {prefix}_SCRIPT_SIZE={value["length"]},{prefix}_SCRIPT_HASH=0x{value["fingerprint"]};\n'
        if prefix == 'SHOP': header += f'constexpr u32 SHOP_SCRIPT_ENTRY={value["entry"]};\n'
        (out / f'{prefix.lower()}.generated.h').write_text(header)
    dial = json.loads((REPO / 'src/cgearButtons/dial.json').read_text())
    (out / 'dial.generated.h').write_text('#pragma once\nnamespace dial {\n' + ''.join(f'constexpr int {k}={v};\n' for k,v in dial.items() if k != 'atan')
        + 'constexpr u16 angles[]={' + ','.join(map(str,dial['atan'])) + '};\n}\n')
    asm = ['.syntax unified', '.thumb']
    for label, module, address, target, prep in CALLS:
        if label in ('QaRepelStep', 'QaRepelDepleted'): continue
        name = f'THUMB_BRANCH_LINK_{module}_0x{address:x}'
        asm += ['.balign 4', f'.global {name}', f'.type {name},%function', '.thumb_func', name + ':']
        if prep: asm.append(prep)
        asm += ['push {r3}', 'ldr r3,1f', 'mov ip,r3', 'pop {r3}', 'bx ip', '.balign 4', f'1: .word {label}', f'.size {name},.-{name}']
    for label, module, address, value in WORDS:
        name = f'FULL_COPY_{module}_0x{address:x}'
        asm += ['.balign 4', f'.global {name}', f'.type {name},%object', name + ':', f'.word {label}', f'.size {name},4']
    stem = 'CGearQuickActionsReduxW2'
    source = out / f'{stem}.s'; source.write_text('\n'.join(asm) + '\n')
    flags = ['-std=c++17','-mthumb','-march=armv5t','-mlong-calls','-Os','-Wall','-Wextra','-Werror',
        '-fno-jump-tables','-fvisibility=hidden','-fno-exceptions','-fno-rtti','-fno-unwind-tables',
        '-fno-asynchronous-unwind-tables','-ffreestanding','-fno-builtin','-DGAME_W2','-DCGEAR_REDUX','-I',out]
    run(TOOLS / 'arm-none-eabi-g++', *flags, '-c', HERE / 'quick_actions.cpp', '-o', out / f'{stem}.o')
    run(TOOLS / 'arm-none-eabi-as', '-mthumb', '-march=armv5t', source, '-o', out / 'hooks.o')
    extra = []
    for item in (HERE.parent / 'nuzlocke-encounters/runtime.cpp', HERE.parent / 'learnset-viewer/memory.cpp'):
        obj = out / f'{item.stem}.o'; run(TOOLS / 'arm-none-eabi-g++', *flags, '-c', item, '-o', obj); extra.append(obj)
    elf = out / f'{stem}.elf'
    run(TOOLS / 'arm-none-eabi-g++', '-nostdlib', '-Wl,-r', out / f'{stem}.o', out / 'hooks.o', *extra, '-o', elf)
    assert subprocess.check_output([str(TOOLS / 'arm-none-eabi-nm'), '-u', str(elf)]).decode().split() == ['U','PokewebBgmMute']
    meta = out / 'metadata.yml'; meta.write_text(f'PMCGameID: W2\nPMCModulePriority: 4\nPMCVersion: {VERSION}\n')
    esdb = out / 'symbols.yml'; esdb.write_text('Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n')
    for debug in (False, True):
        dll = out / (stem + ('.debug' if debug else '') + '.dll')
        arguments = ['java','-cp',JAR,'rpm.cli.RPMTool','-i',elf,'--fourcc','DLXF','-o',dll,'--esdb',esdb,'--meta',meta,'--generate-relocations']
        if not debug: arguments.append('--strip')
        run(*arguments)
    blob = (out / f'{stem}.dll').read_bytes(); rpm = read_rpm(blob)
    targets = [r for r in rpm['relocations'] if r['module'] != 'base']
    assert all(not (r['module'] == '36' and r['address'] in (0x21824bc,0x21a0b2c)) for r in targets)
    assert len(targets) == sum(bool(s['patchSize']) for s in manifest['games']['W2']['signatures'])
    manifest['games']['W2'].update(sha256=sha(blob), codeFingerprint=fingerprint(rpm['code']), bssSize=rpm['bss'])
    (ASSETS / 'cgearQuickActionsReduxManifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    shutil.copyfile(out / f'{stem}.dll', ASSETS / f'{stem}.dll')
    print(f'{stem}.dll: {len(blob)} bytes; {len(targets)} native patches; no repel hook ownership')

if __name__ == '__main__': main()
