"""Build the Fly-only destination hooks for retail US Black 2 and White 2."""
import os
from pathlib import Path
import re
import subprocess

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
TOOLS = Path(os.environ.get('ARM_TOOLCHAIN_BIN', REPO.parent / 'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
JAR = Path(os.environ.get('RPM_TOOL_JAR', REPO.parent / 'White2Upgrade/CTRMap.jar'))
BUILD = HERE / 'build'
VERSIONS = {
    'B2': (0x020190c9, 0x02178956, 0x0219d4ae),
    'W2': (0x020190f5, 0x02178996, 0x0219d4ee),
}


def run(*args):
    subprocess.run([str(a) for a in args], check=True)


def main():
    BUILD.mkdir(exist_ok=True)
    for version, (loader, call, remap) in VERSIONS.items():
        segments = 'Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\n'
        segments += '  - ID: 1\n    Name: 33\n    Type: OVERLAY\n  - ID: 2\n    Name: 144\n    Type: OVERLAY\n'
        esdb = BUILD / f'symbols_{version}.yml'
        esdb.write_text(segments + f'Symbols:\n  - Name: LoadZoneSpawnInfoCheckRail\n    Segment: 0\n    Address: 0x{loader:x}\n')
        metadata = BUILD / f'metadata_{version}.yml'
        metadata.write_text(f'PMCGameID: {version}\nPMCModulePriority: 4\nPMCVersion: 1.0.1\n' + segments)
        assembly = BUILD / f'hooks_{version}.s'
        assembly.write_text(f'''.syntax unified
.cpu arm946e-s
.thumb
.section .text
.balign 4
.global THUMB_BRANCH_LINK_33_0x{call:x}
.type THUMB_BRANCH_LINK_33_0x{call:x}, %function
.thumb_func
THUMB_BRANCH_LINK_33_0x{call:x}:
    push {{r3, lr}}
    bl Fly_LoadSpawn
    pop {{r3, pc}}
.size THUMB_BRANCH_LINK_33_0x{call:x}, .-THUMB_BRANCH_LINK_33_0x{call:x}
.balign 4
.global FULL_COPY_144_0x{remap:x}
.type FULL_COPY_144_0x{remap:x}, %object
FULL_COPY_144_0x{remap:x}:
    .hword 0x46c0, 0x46c0
.size FULL_COPY_144_0x{remap:x}, 4
''')
        obj, hooks = BUILD / 'fly.o', BUILD / f'hooks_{version}.o'
        run(TOOLS / 'arm-none-eabi-gcc', '-mthumb', '-mcpu=arm946e-s', '-Os', '-std=c11',
            '-ffreestanding', '-fno-builtin', '-fno-jump-tables', '-fno-unwind-tables',
            '-fno-asynchronous-unwind-tables', '-Wall', '-Wextra', '-Werror',
            '-c', HERE / 'fly_destinations.c', '-o', obj)
        run(TOOLS / 'arm-none-eabi-as', '-mthumb', '-march=armv5t', assembly, '-o', hooks)
        elf = BUILD / f'FlyDestinations{version}.elf'
        run(TOOLS / 'arm-none-eabi-ld', '-r', obj, hooks, '-o', elf)
        output = REPO / f'src/assets/codeinjection/FlyDestinations{version}.dll'
        run('java', '-cp', JAR, 'rpm.cli.RPMTool', '-i', elf, '--fourcc', 'DLXF', '-o', output,
            '--esdb', esdb, '--meta', metadata, '--generate-relocations')
        dump = subprocess.check_output(['java', '-cp', str(JAR), 'rpm.cli.RPMDump', '--fourcc', 'DLXF', '-i', str(output)]).decode()
        targets = {(kind, segment, int(address, 16)) for kind, segment, address in
                   re.findall(r'Target: (\S+) @ (\S+) :: (0x[0-9a-f]+)', dump) if segment != 'base'}
        expected = {('THUMB_BRANCH_LINK', '33', call), ('FULL_COPY', '144', remap)}
        if targets != expected or 'Import symbol' in dump or 'FlyDestinationConfig' not in dump:
            raise RuntimeError(f'{version}: invalid packaged hooks/config: {targets}')
        (BUILD / f'{version}.dump.txt').write_text(dump)
        print(f'{output.name}: {output.stat().st_size} bytes; two hooks verified; Town Map visuals unhooked')


if __name__ == '__main__':
    main()
