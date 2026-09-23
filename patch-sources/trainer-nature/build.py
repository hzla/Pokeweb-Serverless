"""Build the Black 2 and White 2 PMC trainer nature runtimes."""
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


for version in ("B2", "W2"):
    obj = BUILD / f"TrainerNature{version}.o"
    run(TOOLS / "arm-none-eabi-gcc", "-x", "assembler-with-cpp", "-mthumb", "-mcpu=arm946e-s",
        *( ["-DBLACK2"] if version == "B2" else [] ),
        "-c", HERE / "TrainerNature.S", "-o", obj)
    output = REPO / f"src/assets/codeinjection/TrainerNature{version}.dll"
    run("java", "-cp", JAR, "rpm.cli.RPMTool", "-i", obj, "--fourcc", "DLXF", "-o", output,
        "--esdb", HERE / f"symbols_{version.lower()}.yml",
        "--meta", HERE / f"metadata_{version.lower()}.yml", "--generate-relocations", "--strip")
    dump = subprocess.check_output(["java", "-cp", str(JAR), "rpm.cli.RPMDump", "--fourcc", "DLXF", "-i", str(output)])
    (BUILD / f"TrainerNature{version}.dump.txt").write_bytes(dump)
    print(f"{output.name}: {output.stat().st_size} bytes")
