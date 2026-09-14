"""Read-only ROM inspection; generated disassembly stays in ignored build/."""
import argparse
from pathlib import Path
import subprocess
import ndspy.rom
import ndspy.codeCompression

HERE = Path(__file__).resolve().parent
WORKSPACE = HERE.parents[2]
parser = argparse.ArgumentParser()
parser.add_argument("rom", type=Path)
parser.add_argument("--overlay", type=int, default=258)
args = parser.parse_args()
rom = ndspy.rom.NintendoDSRom.fromFile(args.rom)
overlay = rom.loadArm9Overlays([args.overlay])[args.overlay] if args.overlay >= 0 else None
data = overlay.data if overlay else ndspy.codeCompression.decompress(rom.arm9)
base = overlay.ramAddress if overlay else rom.arm9RamAddress
build = HERE / "build"
build.mkdir(exist_ok=True)
binary = build / f"{rom.idCode.decode()}-ov{args.overlay}.bin"
binary.write_bytes(data)
objdump = WORKSPACE / "toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin/arm-none-eabi-objdump"
dump = subprocess.check_output([str(objdump), "-D", "-b", "binary", "-m", "arm", "-M", "force-thumb", f"--adjust-vma={base}", str(binary)])
output = binary.with_suffix(".txt")
output.write_bytes(dump)
print(output, hex(base), len(data))
