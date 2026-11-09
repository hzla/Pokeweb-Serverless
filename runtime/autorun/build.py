"""Build the Autorun movement DLLs for US Black, White, Black 2 and White 2.

    python3 runtime/autorun/build.py [--test]

--test builds copies that also record the player's grid position, for the
emulator check, into runtime/autorun/build/ without touching src/assets.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
WORKSPACE = REPO.parent
TOOLS = Path(os.environ.get(
    "ARM_TOOLCHAIN_BIN",
    WORKSPACE / "toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin",
))
JAR = Path(os.environ.get("RPM_TOOL_JAR", WORKSPACE / "pw2-build-work/ctrmap/CTRMap.jar"))
CFLAGS = ["-std=c11", "-mthumb", "-mcpu=arm946e-s", "-Os", "-ffreestanding", "-fno-builtin",
          "-fno-jump-tables", "-fno-unwind-tables", "-fno-asynchronous-unwind-tables",
          "-Wall", "-Wextra", "-Werror"]


def tool(name):
    path = TOOLS / name
    return str(path) if path.exists() else name


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)


def build_game(game, profile, version, testing):
    out = HERE / "build" / (game + ("-test" if testing else ""))
    out.mkdir(parents=True, exist_ok=True)
    overlay = profile["fieldOverlay"]
    hooks = profile["hooks"]
    lines = [f"#define GRID_HOOK THUMB_BRANCH_{overlay}_{hooks['grid']['address']}",
             f"#define NOGRID_HOOK THUMB_BRANCH_{overlay}_{hooks['nogrid']['address']}"]
    lines += [f"#define {name} {address}u" for name, address in profile["bindings"].items()]
    (out / "autorun_addr.h").write_text("\n".join(lines) + "\n")
    obj, elf = out / "autorun.o", out / "autorun.elf"
    run(tool("arm-none-eabi-gcc"), *CFLAGS, *(["-DAUTORUN_TEST"] if testing else []),
        "-I", out, "-c", HERE / "autorun.c", "-o", obj)
    run(tool("arm-none-eabi-ld"), "-r", obj, "-o", elf)
    unresolved = subprocess.check_output([tool("arm-none-eabi-nm"), "-u", str(elf)]).strip()
    if unresolved:
        raise RuntimeError(f"{game}: unresolved symbols {unresolved.decode()}")
    (out / "symbols.yml").write_text(
        "Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\n"
        f"  - ID: 1\n    Name: {overlay}\n    Type: OVERLAY\nSymbols: []\n")
    game_id = {"B": "B", "W": "W", "B2": "B2", "W2": "W2"}[game]
    (out / "metadata.yml").write_text(f"PMCGameID: {game_id}\nPMCModulePriority: 4\nPMCVersion: {version}\n")
    dll = out / f"Autorun{game}.dll"
    dll.unlink(missing_ok=True)
    run("java", "-cp", JAR, "rpm.cli.RPMTool", "-i", elf, "--fourcc", "DLXF", "-o", dll,
        "--esdb", out / "symbols.yml", "--meta", out / "metadata.yml", "--generate-relocations", "--strip")
    dump = subprocess.check_output(["java", "-cp", str(JAR), "rpm.cli.RPMDump", "--fourcc", "DLXF", "-i", str(dll)]).decode()
    (out / "dump.txt").write_text(dump)
    targets = sorted(t for t in re.findall(r"Target: (\S+) @ (\S+) :: (\S+)", dump) if t[1] != "base")
    expected = sorted(("THUMB_BRANCH", str(overlay), hooks[name]["address"]) for name in ("grid", "nogrid"))
    normalized = sorted((kind, segment, f"0x{int(address, 16):08x}") for kind, segment, address in targets)
    if normalized != expected:
        raise RuntimeError(f"{game}: unexpected hook targets {targets}")
    if "Import symbol" in dump:
        raise RuntimeError(f"{game}: unresolved imports")
    return dll


def main():
    testing = "--test" in sys.argv
    manifest = json.loads((HERE / "games.json").read_text())
    for game, profile in manifest["games"].items():
        dll = build_game(game, profile, manifest["version"], testing)
        blob = dll.read_bytes()
        if not testing:
            (REPO / "src/assets/codeinjection" / dll.name).write_bytes(blob)
            profile["sha256"] = hashlib.sha256(blob).hexdigest()
        print(f"{dll.name}: {len(blob)} bytes{' (test)' if testing else ''}")
    if not testing:
        shipped = {"version": manifest["version"], "configBit": manifest["configBit"],
                   "games": {game: {"idCode": p["idCode"], "fieldOverlay": p["fieldOverlay"], "fileName": f"Autorun{game}.dll",
                                    "sha256": p["sha256"], "hooks": p["hooks"]} for game, p in manifest["games"].items()}}
        (REPO / "src/assets/codeinjection/autorunManifest.json").write_text(json.dumps(shipped, indent=2) + "\n")


if __name__ == "__main__":
    main()
