"""Build the US BW2 Infinite Candy PMC DLLs."""
import os
import json
import sys
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


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)


def write_manifest():
    sys.path.insert(0, str(REPO / "runtime/battle-type-hud"))
    from rpm_read import read_rpm
    manifest = {"games": {}}
    for game in ("B2", "W2"):
        rpm = read_rpm((REPO / f"src/assets/codeinjection/InfiniteCandy{game}.dll").read_bytes())
        offsets = [i for i in range(0, len(rpm["code"]) - 3, 4)
                   if rpm["code"][i:i + 4] == (622).to_bytes(4, "little")]
        assert len(offsets) == 2, "Both item-ID literals must be identified."
        manifest["games"][game] = dict(codeHex=rpm["code"].hex(), itemIdOffsets=offsets,
                                       relocations=rpm["relocations"], symbols=rpm["symbols"])
    (REPO / "src/assets/codeinjection/infiniteCandyBw2Manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


def main():
    BUILD.mkdir(exist_ok=True)
    obj = BUILD / "InfiniteCandy.o"
    run(TOOLS / "arm-none-eabi-as", "-mthumb", "-march=armv5t", HERE / "InfiniteCandy.s", "-o", obj)
    for version in ("b2", "w2"):
        output = REPO / f"src/assets/codeinjection/InfiniteCandy{version.upper()}.dll"
        run("java", "-cp", JAR, "rpm.cli.RPMTool", "-i", obj,
            "--fourcc", "DLXF", "-o", output,
            "--esdb", HERE / f"symbols_{version}.yml",
            "--meta", HERE / f"metadata_{version}.yml",
            "--generate-relocations", "--strip")
        dump = subprocess.check_output([
            "java", "-cp", str(JAR), "rpm.cli.RPMDump", "--fourcc", "DLXF", "-i", str(output),
        ]).decode()
        if "Target: THUMB_BRANCH_LINK @ 12 ::" not in dump or "Target: THUMB_BRANCH @ 165 ::" not in dump:
            raise RuntimeError(f"{output.name}: missing party or item-removal hook")
        if "Target: THUMB_BRANCH_LINK @ base ::" not in dump:
            raise RuntimeError(f"{output.name}: missing native BagSave_SubItem import")
        (BUILD / f"InfiniteCandy{version.upper()}.dump.txt").write_text(dump)
        print(f"{output.name}: {output.stat().st_size} bytes")
    write_manifest()


if __name__ == "__main__":
    main()
