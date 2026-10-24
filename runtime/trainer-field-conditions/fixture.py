"""Build a test-only BW2 direct battle trigger using the existing harness source.

The B2 fixture retargets only the audited native entry points used by boot.c.
It is separate from the production White 2 battle-harness installer.
"""
from pathlib import Path
import argparse, os, re, subprocess
from profiles import PROFILES, WS

HERE = Path(__file__).resolve().parent
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--game', choices=PROFILES, required=True)
p.add_argument('--out', type=Path, required=True)
a = p.parse_args()
a.out.mkdir(parents=True, exist_ok=True)
tools = Path(os.environ.get('ARM_TOOLCHAIN_BIN', WS / 'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
jar = Path(os.environ.get('RPM_TOOL_JAR', WS / 'pw2-build-work/ctrmap/CTRMap.jar'))
harness = HERE.parent / 'battle-harness'
def retarget(match):
    value = int(match[0], 16)
    if a.game == 'B2':
        if value >= 0x02100000: value -= 64
        elif value >= 0x02018d68: value -= 44
    return f'0x{value:08x}'
for name in ['boot.c', 'boot.s']:
    (a.out/name).write_text(re.sub(r'0x02[0-9a-f]{6}', retarget, (harness/name).read_text()))
def run(*args): subprocess.run(list(map(str, args)), check=True)
run(tools/'arm-none-eabi-gcc', '-mthumb', '-mcpu=arm946e-s', '-Os', '-std=c11', '-ffreestanding', '-fvisibility=hidden',
    '-fno-builtin', '-fno-jump-tables', '-fno-unwind-tables', '-fno-asynchronous-unwind-tables', '-Wall', '-Wextra', '-Werror',
    '-DTRAINER_ID=2', '-DBATTLE_RULE=0', '-c', a.out/'boot.c', '-o', a.out/'boot.o')
run(tools/'arm-none-eabi-as', '-mthumb', '-march=armv5t', a.out/'boot.s', '-o', a.out/'hook.o')
run(tools/'arm-none-eabi-ld', '-r', a.out/'boot.o', a.out/'hook.o', '-o', a.out/'boot.elf')
meta = a.out/'metadata.yml'
meta.write_text(f'PMCGameID: {a.game}\nPMCModulePriority: 3\nPMCVersion: battle-harness-5\n')
run('java', '-cp', jar, 'rpm.cli.RPMTool', '-i', a.out/'boot.elf', '--fourcc', 'DLXF', '-o', a.out/f'BattleHarness{a.game}.dll',
    '--esdb', harness/'symbols.yml', '--meta', meta, '--generate-relocations', '--strip')
