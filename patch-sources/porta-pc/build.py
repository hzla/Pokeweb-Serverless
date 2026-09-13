"""Compile ButtonScript.s into version-specific, symbol-stripped PMC DLLs."""
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

run(TOOLS / "arm-none-eabi-as", "-mthumb", "-march=armv5t", HERE / "ButtonScript.s", "-o", BUILD / "ButtonScript.o")
# These assembly constants/local labels are not required by any relocation.
# Keep the named hook and its native imports for RPMTool's automatic linking.
symbols = ["AButton", "BButton", "SelectButton", "StartButton", "DPadRight", "DPadLeft", "DPadUp", "DPadDown", "RButton", "LButton", "XButton", "PCScriptID", "call_script", "return"]
run(TOOLS / "arm-none-eabi-objcopy", *(f"--strip-symbol={name}" for name in symbols), BUILD / "ButtonScript.o", BUILD / "PortaPC.elf")
for version in ("W2", "B2"):
    output = REPO / f"src/assets/codeinjection/PortaPC{version}.dll"
    run("java", "-cp", JAR, "rpm.cli.RPMTool", "-i", BUILD / "PortaPC.elf", "--fourcc", "DLXF",
        "-o", output, "--esdb", HERE / f"symbols_{version.lower()}.yml",
        "--meta", HERE / f"metadata_{version.lower()}.yml", "--generate-relocations", "--strip")
    dump = subprocess.check_output(["java", "-cp", str(JAR), "rpm.cli.RPMDump", "--fourcc", "DLXF", "-i", str(output)])
    (BUILD / f"PortaPC{version}.dump.txt").write_bytes(dump)
    print(f"{output.name}: {output.stat().st_size} bytes")
