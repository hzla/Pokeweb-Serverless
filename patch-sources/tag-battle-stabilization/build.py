"""Rebuild the symbol-stripped PMC asset; does not modify any ROM."""
import os
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
WORKSPACE = REPO.parent
TOOLS = Path(os.environ.get("ARM_TOOLCHAIN_BIN", WORKSPACE / "toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin"))
JAR = Path(os.environ.get("RPM_TOOL_JAR", WORKSPACE / "White2Upgrade/CTRMap.jar"))
ESDB = Path(os.environ.get("PMC_ESDB", WORKSPACE / "White2Upgrade/pmc/ESDB.yml"))
BUILD = HERE / "build"
BUILD.mkdir(exist_ok=True)

def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)

run(TOOLS / "arm-none-eabi-g++", "-mthumb", "-march=armv5t", "-mno-thumb-interwork",
    "-mno-long-calls", "-Os", "-Wall", "-Wextra", "-Werror", "-ffreestanding",
    "-fvisibility=hidden", "-fno-exceptions", "-fno-rtti", "-fno-unwind-tables",
    "-fno-asynchronous-unwind-tables", "-c", HERE / "serialized_ai.cpp",
    "-o", BUILD / "serialized_ai.o")
run(TOOLS / "arm-none-eabi-ld", "-r", BUILD / "serialized_ai.o", "-o", BUILD / "TagBattleStabilizationW2.elf")
undefined = subprocess.check_output([str(TOOLS / "arm-none-eabi-nm"), "-u", str(BUILD / "TagBattleStabilizationW2.elf")])
if undefined.strip():
    raise RuntimeError(f"Unresolved imports: {undefined.decode()}")
output = REPO / "src/assets/codeinjection/TagBattleStabilizationW2.dll"
run("java", "-cp", JAR, "rpm.cli.RPMTool", "-i", BUILD / "TagBattleStabilizationW2.elf",
    "--fourcc", "DLXF", "-o", output, "--esdb", ESDB, "--meta", HERE / "metadata.yml",
    "--generate-relocations", "--strip")
print(f"{output.name}: {output.stat().st_size} bytes")
