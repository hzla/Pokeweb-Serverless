"""Build the Black 2 and White 2 background-music toggle DLLs."""
import os
import re
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
WORKSPACE = REPO.parent
TOOLS = Path(os.environ.get(
    "ARM_TOOLCHAIN_BIN",
    WORKSPACE / "toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin",
))
JAR = Path(os.environ.get("RPM_TOOL_JAR", WORKSPACE / "White2Upgrade/CTRMap.jar"))
BUILD = HERE / "build"
BUILD.mkdir(exist_ok=True)


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)


def main():
    obj = BUILD / "BgmToggle.o"
    buffer_obj = BUILD / "stream_buffer.o"
    mapping_obj = BUILD / "mapping.o"
    elf = BUILD / "BgmToggle.elf"
    run(TOOLS / "arm-none-eabi-as", "-mthumb", "-march=armv5t", HERE / "BgmToggle.s", "-o", obj)
    run(TOOLS / "arm-none-eabi-gcc", "-mthumb", "-mcpu=arm946e-s", "-Os",
        "-ffreestanding", "-fno-builtin", "-fno-unwind-tables", "-fno-asynchronous-unwind-tables",
        "-Wall", "-Wextra", "-Werror", "-c", HERE / "stream_buffer.c", "-o", buffer_obj)
    run(TOOLS / "arm-none-eabi-gcc", "-mthumb", "-mcpu=arm946e-s", "-Os",
        "-ffreestanding", "-fno-builtin", "-fno-unwind-tables", "-fno-asynchronous-unwind-tables",
        "-Wall", "-Wextra", "-Werror", "-c", HERE / "mapping.c", "-o", mapping_obj)
    run(TOOLS / "arm-none-eabi-ld", "-r", obj, buffer_obj, mapping_obj, "-o", elf)

    for version in ("B2", "W2"):
        output = REPO / f"src/assets/codeinjection/BgmToggle{version}.dll"
        run(
            "java", "-cp", JAR, "rpm.cli.RPMTool", "-i", elf,
            "--fourcc", "DLXF", "-o", output,
            "--esdb", HERE / f"symbols_{version.lower()}.yml",
            "--meta", HERE / f"metadata_{version.lower()}.yml",
            "--generate-relocations", "--strip",
        )
        dump = subprocess.check_output([
            "java", "-cp", str(JAR), "rpm.cli.RPMDump", "--fourcc", "DLXF", "-i", str(output),
        ])
        targets = re.findall(r"Target: \S+ @ (.*?) ::", dump.decode())
        if not targets or any(target not in ("base", "ARM9") for target in targets):
            raise RuntimeError(f"Unresolved runtime hook targets: {targets}")
        (BUILD / f"BgmToggle{version}.dump.txt").write_bytes(dump)
        print(f"{output.name}: {output.stat().st_size} bytes")


if __name__ == "__main__":
    main()
