"""Build the bounded BW1 startup budget helper from local tools only."""
from hashlib import sha256
from pathlib import Path
import json, os, subprocess
from tempfile import TemporaryDirectory
here = Path(__file__).resolve().parent
root = here.parents[1]
work = root.parent
tool = Path(os.environ.get('ARM_TOOLCHAIN_BIN', work / 'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))

def compile_budget(build, cap):
    obj = build / 'budget.o'
    binary = build / 'budget.bin'
    subprocess.run([str(tool/'arm-none-eabi-gcc'), '-std=c11', '-mthumb', '-mcpu=arm946e-s', '-Os',
                    '-Wall', '-Wextra', '-Werror', '-ffreestanding', '-fno-builtin', '-fno-unwind-tables',
                    '-fno-asynchronous-unwind-tables', f'-DPMC_HEAP_CAP_KIB={cap}u',
                    '-c', str(here/'budget.c'), '-o', str(obj)], check=True)
    subprocess.run([str(tool/'arm-none-eabi-objcopy'), '-O', 'binary', '-j', '.text', str(obj), str(binary)], check=True)
    code = binary.read_bytes()
    symbols = subprocess.check_output([str(tool/'arm-none-eabi-nm'), '-u', str(obj)], text=True)
    if symbols.strip() or len(code) > 256:
        raise SystemExit('Unexpected helper imports or size')
    return code


with TemporaryDirectory(prefix='pmc-heap-budget-') as temporary:
    build = Path(temporary)
    legacy = compile_budget(build, 200)
    compact = compile_budget(build, 220)
    # Exact machine code shipped in the legacy BW1 200 KiB release.
    if sha256(legacy).hexdigest() != '2bad6d965a3afcd6cb6423df769b82f951d67fe5bd07aaa8f960197b18715fb8':
        raise SystemExit('Legacy heap200 helper changed; installed BW1 loaders would fail upgrade verification')
    (root/'src/assets/data/pmcHeapBudgetRuntime.json').write_text(
        json.dumps({'code': list(legacy), 'compactCode': list(compact)}, separators=(',', ':')) + '\n'
    )
    print(f'Built startup budget helpers ({len(legacy)} legacy bytes, {len(compact)} compact bytes)')
