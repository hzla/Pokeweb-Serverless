"""Rebuild Black 1's independent PMC DLL from source; does not modify ROMs."""
import os
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
WORKSPACE = REPO.parent
TOOLS = Path(os.environ.get("ARM_TOOLCHAIN_BIN", WORKSPACE / "toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin"))
JAR = Path(os.environ.get("RPM_TOOL_JAR", WORKSPACE / "White2Upgrade/CTRMap.jar"))
BUILD = HERE / "build"
BUILD.mkdir(exist_ok=True)

def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)

run(TOOLS / "arm-none-eabi-g++", "-mthumb", "-march=armv5t", "-mno-thumb-interwork",
    "-mno-long-calls", "-Os", "-Wall", "-Wextra", "-Werror", "-ffreestanding",
    "-fvisibility=hidden", "-fno-exceptions", "-fno-rtti", "-fno-unwind-tables",
    "-fno-asynchronous-unwind-tables", "-c", HERE / "black1.cpp", "-o", BUILD / "black1.o")
run(TOOLS / "arm-none-eabi-ld", "-r", BUILD / "black1.o", "-o", BUILD / "DoubleBattleFixB.elf")
undefined = subprocess.check_output([str(TOOLS / "arm-none-eabi-nm"), "-u", str(BUILD / "DoubleBattleFixB.elf")])
if undefined.strip():
    raise RuntimeError(f"Unresolved imports: {undefined.decode()}")
output = REPO / "src/assets/codeinjection/DoubleBattleFixB.dll"
run("java", "-cp", JAR, "rpm.cli.RPMTool", "-i", BUILD / "DoubleBattleFixB.elf",
    "--fourcc", "DLXF", "-o", output, "--esdb", HERE / "symbols.yml",
    "--meta", HERE / "metadata.yml", "--generate-relocations", "--strip")
print(f"{output.name}: {output.stat().st_size} bytes")
