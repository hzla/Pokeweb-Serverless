"""Build the three independent White 2 PMC modules; never edits a ROM/save."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
ROOT = REPO.parent
TOOLS = Path(os.environ.get('ARM_TOOLCHAIN_BIN', ROOT / 'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
JAR = Path(os.environ.get('RPM_TOOL_JAR', ROOT / 'White2Upgrade/CTRMap.jar'))
sys.path.insert(0, str(HERE.parent / 'battle-type-hud'))
from rpm_read import read_rpm

PROFILES = {
    'walk-through-walls': {
        'file': 'WalkThroughWallsW2.dll',
        'sources': [HERE / 'walk_through_walls.c', HERE / 'walk_hooks.s'],
        'symbols': {
            'GCTX_HIDGetInstance': ('ARM9', 0x0203d305),
            'GFL_HIDGetKeypadManager': ('ARM9', 0x0203d301),
            'GCTX_HIDGetPressedKeys': ('ARM9', 0x0203df29),
            'FieldInputSnapshot': ('36', 0x02181d15),
            'PlayerMoveCollCheck': ('36', 0x0219c8cd),
            'PlayerMoveCollCheckCatwalk': ('36', 0x0219cd05),
        },
        'hooks': [('36', 0x02181d44, 'THUMB_BRANCH_LINK'), ('36', 0x0219c966, 'THUMB_BRANCH_LINK'), ('36', 0x0219cd22, 'THUMB_BRANCH_LINK')],
    },
    'instant-victory': {
        'file': 'InstantBattleVictoryW2.dll',
        'sources': [HERE / 'instant_victory.c', HERE / 'victory_hooks.s'],
        'symbols': {
            'GCTX_HIDGetHeldKeys': ('ARM9', 0x0203df4d),
            'BattleProcessMain': ('167', 0x02199c49),
            'BattleView_ForceQuitInputNotify': ('167', 0x021d0a59),
            'BattleView_ForceQuitInputWait': ('167', 0x021d0a69),
            'BattleView_Update': ('167', 0x021ce909),
        },
        'hooks': [('167', 0x02199c58, 'THUMB_BRANCH_LINK')],
    },
    'instant-fast-text': {
        'file': 'InstantFastTextW2.dll',
        'sources': [HERE.parent / 'instant-text' / 'instant_text.c'],
        'symbols': {
            'SaveData_GetConfig': ('ARM9', 0x02008ddd),
            'Config_GetTextSpeed': ('ARM9', 0x02008a15),
            'TextSpeed_GetWait': ('ARM9', 0x02017bcd),
            'TextSpeed_Convert': ('ARM9', 0x02017c51),
        },
        'hooks': [('ARM9', 0x02017be0, 'THUMB_BRANCH_LINK'), ('ARM9', 0x02017c50, 'THUMB_BRANCH')],
    },
}

def run(*args):
    subprocess.run([str(a) for a in args], check=True)

def fingerprint(rpm):
    return {
        'codeHex': rpm['code'].hex(), 'bss': rpm['bss'],
        'relocations': sorted(f"{r['module']}:{r['address']:x}:{r['type']}:{rpm['symbols'][r['symbol']]['address']:x}:{rpm['symbols'][r['symbol']]['type']}:{rpm['symbols'][r['symbol']]['attributes']}" for r in rpm['relocations']),
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--only', choices=PROFILES)
    args = parser.parse_args()
    for key, profile in PROFILES.items():
        if args.only and args.only != key: continue
        build = HERE / 'build' / key
        build.mkdir(parents=True, exist_ok=True)
        segments = {name: i for i, name in enumerate(dict.fromkeys(s[0] for s in profile['symbols'].values()))}
        esdb = build / 'symbols.yml'
        esdb.write_text('Segments:\n' + ''.join(f'  - ID: {i}\n    Name: {name}\n    Type: {"EXECUTABLE" if name == "ARM9" else "OVERLAY"}\n' for name, i in segments.items()) + 'Symbols:\n' + ''.join(f'  - Name: {name}\n    Segment: {segments[segment]}\n    Address: 0x{address:08x}\n' for name, (segment, address) in profile['symbols'].items()))
        meta = build / 'metadata.yml'
        meta.write_text('PMCGameID: W2\nPMCModulePriority: 4\nPMCVersion: 0.1.0\n')
        objects = []
        for source in profile['sources']:
            obj = build / (source.stem + '.o')
            if source.suffix == '.s':
                run(TOOLS / 'arm-none-eabi-as', '-mthumb', '-march=armv5t', source, '-o', obj)
            else:
                run(TOOLS / 'arm-none-eabi-gcc', '-mthumb', '-mcpu=arm946e-s', '-Os', '-std=c11', '-ffreestanding', '-fno-builtin', '-fno-jump-tables', '-fno-unwind-tables', '-fno-asynchronous-unwind-tables', '-Wall', '-Wextra', '-Werror', '-c', source, '-o', obj)
            objects.append(obj)
        elf = build / profile['file'].replace('.dll', '.elf')
        run(TOOLS / 'arm-none-eabi-ld', '-r', *objects, '-o', elf)
        output = REPO / 'src/assets/codeinjection' / profile['file']
        run('java', '-cp', JAR, 'rpm.cli.RPMTool', '-i', elf, '--fourcc', 'DLXF', '-o', output, '--esdb', esdb, '--meta', meta, '--generate-relocations', '--strip')
        rpm = read_rpm(output.read_bytes())
        hooks = {(r['module'], r['address'], r['type']) for r in rpm['relocations'] if r['module'] != 'base'}
        if hooks != set(profile['hooks']) or any(s['attributes'] & 2 for s in rpm['symbols']):
            raise RuntimeError(f'{key}: unexpected hooks or unresolved imports')
        target = HERE.parent / 'instant-text' if key == 'instant-fast-text' else HERE
        (target / f'{key}-runtime.json').write_text(json.dumps(fingerprint(rpm), indent=2) + '\n')
        dump = subprocess.check_output(['java', '-cp', str(JAR), 'rpm.cli.RPMDump', '--fourcc', 'DLXF', '-i', str(output)])
        (build / 'dump.txt').write_bytes(dump)
        print(f'{output.name}: {output.stat().st_size} bytes; code {len(rpm["code"])}; BSS {rpm["bss"]}; SHA256 {hashlib.sha256(output.read_bytes()).hexdigest()}')

if __name__ == '__main__': main()
