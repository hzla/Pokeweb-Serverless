"""Build the bounded BW1 startup budget helper from local tools only."""
from pathlib import Path
import json, os, subprocess
here = Path(__file__).resolve().parent
root = here.parents[1]
work = root.parent
tool = Path(os.environ.get('ARM_TOOLCHAIN_BIN', work / 'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
build = here / 'build'; build.mkdir(exist_ok=True)
obj = build / 'budget.o'
subprocess.run([str(tool/'arm-none-eabi-gcc'), '-std=c11', '-mthumb', '-mcpu=arm946e-s', '-Os', '-Wall', '-Wextra', '-Werror', '-ffreestanding', '-fno-builtin', '-fno-unwind-tables', '-fno-asynchronous-unwind-tables', '-c', str(here/'budget.c'), '-o', str(obj)], check=True)
subprocess.run([str(tool/'arm-none-eabi-objcopy'), '-O', 'binary', '-j', '.text', str(obj), str(build/'budget.bin')], check=True)
code = (build/'budget.bin').read_bytes()
symbols = subprocess.check_output([str(tool/'arm-none-eabi-nm'), '-u', str(obj)], text=True)
if symbols.strip() or len(code) > 256: raise SystemExit('Unexpected helper imports or size')
(root/'src/assets/data/pmcHeapBudgetRuntime.json').write_text(json.dumps({'code':list(code)}, separators=(',',':'))+'\n')
print(f'Built {len(code)}-byte startup budget helper')
