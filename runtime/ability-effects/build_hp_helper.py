"""Build the bounded max-HP percentage helper without changing the base runtime."""
import json, os, subprocess
from pathlib import Path
here = Path(__file__).resolve().parent
root = here.parents[1]
tools = Path(os.environ.get('ARM_TOOLCHAIN_BIN', root.parent/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
build = here/'build'; build.mkdir(exist_ok=True)
subprocess.run([str(tools/'arm-none-eabi-as'), '-mcpu=arm946e-s', '-mthumb', str(here/'hp_percent.s'), '-o', str(build/'hp_percent.o')], check=True)
for section, filename in [('AbilityHpPercent', 'hp_percent'), ('AbilityHpAtLeast', 'hp_at_least')]:
    subprocess.run([str(tools/'arm-none-eabi-objcopy'), '-O', 'binary', '--only-section', '.text.'+section, str(build/'hp_percent.o'), str(build/(filename+'.bin'))], check=True)
symbols = subprocess.check_output([str(tools/'arm-none-eabi-nm'), str(build/'hp_percent.o')], text=True)
offsets = {line.split()[2]: int(line.split()[0], 16) for line in symbols.splitlines() if len(line.split()) == 3}
(root/'src/assets/data/abilityHpPercentHelper.json').write_text(json.dumps({'code': list((build/'hp_percent.bin').read_bytes()), 'percentOffset': offsets['AbilityHpPercentValue'], 'minimumOffset': offsets['AbilityHpPercentMinimum'], 'atLeastCode': list((build/'hp_at_least.bin').read_bytes()), 'atLeastPercentOffset': offsets['AbilityHpAtLeastValue']}, separators=(',', ':'))+'\n')
