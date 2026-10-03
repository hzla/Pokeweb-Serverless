"""Build a test-only, once-per-boot trainer battle trigger for US White 2."""
import argparse
import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import shutil

HERE = Path(__file__).resolve().parent
WORKSPACE = HERE.parents[2]

def build(trainer, rule, output):
    tools = Path(os.environ.get('ARM_TOOLCHAIN_BIN', WORKSPACE / 'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
    jar = Path(os.environ.get('RPM_TOOL_JAR', WORKSPACE / 'White2Upgrade/CTRMap.jar'))
    output.mkdir(parents=True, exist_ok=True)
    def run(*args):
        subprocess.run(list(map(str, args)), check=True)
    run(tools / 'arm-none-eabi-gcc', '-mthumb', '-mcpu=arm946e-s', '-Os', '-std=c11',
        '-ffreestanding', '-fvisibility=hidden', '-fno-builtin', '-fno-jump-tables', '-fno-unwind-tables',
        '-fno-asynchronous-unwind-tables', '-Wall', '-Wextra', '-Werror',
        f'-DTRAINER_ID={trainer}', f'-DBATTLE_RULE={rule}', '-c', HERE / 'boot.c', '-o', output / 'boot.o')
    run(tools / 'arm-none-eabi-as', '-mthumb', '-march=armv5t', HERE / 'boot.s', '-o', output / 'hooks.o')
    run(tools / 'arm-none-eabi-ld', '-r', output / 'boot.o', output / 'hooks.o', '-o', output / 'boot.elf')
    meta = output / 'metadata.yml'
    meta.write_text('PMCGameID: W2\nPMCModulePriority: 3\nPMCVersion: battle-harness-5\n')
    dll = output / 'BattleHarnessW2.dll'
    dll.unlink(missing_ok=True)
    run('java', '-cp', jar, 'rpm.cli.RPMTool', '-i', output / 'boot.elf', '--fourcc', 'DLXF',
        '-o', dll, '--esdb', HERE / 'symbols.yml', '--meta', meta, '--generate-relocations', '--strip')
    verification = json.loads(subprocess.check_output([sys.executable, str(HERE / 'test.py'), str(dll), str(output / 'boot.elf'), str(trainer), str(rule)], text=True))
    (output / 'verification.json').write_text(json.dumps(verification, indent=2) + '\n')
    print(json.dumps(verification))
    return dll

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--trainer', required=True, type=int)
    parser.add_argument('--rule', type=int, default=0, choices=range(4))
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--bundle', action='store_true', help='Refresh the browser template and source/verification receipt')
    args = parser.parse_args()
    if not 1 <= args.trainer <= 65535:
        parser.error('Trainer ID must be 1..65535')
    dll = build(args.trainer, args.rule, args.out)
    if args.bundle:
        destination = HERE.parents[1] / 'src/assets/testbattle'
        shutil.copyfile(dll, destination / dll.name)
        receipt = {'version': 5, 'dllSha256': hashlib.sha256(dll.read_bytes()).hexdigest(),
                   'sources': {name: hashlib.sha256((HERE / name).read_bytes()).hexdigest() for name in ('boot.c', 'boot.s', 'symbols.yml', 'build.py', 'test.py')},
                   'verification': json.loads((args.out / 'verification.json').read_text())}
        (destination / 'BattleHarnessW2.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(dll)
