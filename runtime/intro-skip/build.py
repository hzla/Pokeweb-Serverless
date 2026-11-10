"""Build the Skip Intro DLLs for US Black 2 and White 2.

    python3 runtime/intro-skip/build.py

Writes src/assets/codeinjection/IntroSkip{B2,W2}.dll and introSkipManifest.json.
"""
import hashlib
import json
import os
import re
import subprocess
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
HOOKS = ("demo", "init", "hide", "script", "spawn")


def tool(name):
    path = TOOLS / name
    return str(path) if path.exists() else name


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)


def build_game(game, profile, overlay, version):
    out = HERE / "build" / game
    out.mkdir(parents=True, exist_ok=True)
    hooks = profile["hooks"]
    lines = [f"#define {name.upper()}_HOOK THUMB_BRANCH_LINK_{overlay}_{hooks[name]['address']}" for name in HOOKS]
    lines += [f"#define {name} {address}u" for name, address in profile["bindings"].items()]
    (out / "intro_skip_addr.h").write_text("\n".join(lines) + "\n")
    obj, elf = out / "intro_skip.o", out / "intro_skip.elf"
    run(tool("arm-none-eabi-gcc"), *CFLAGS, "-I", out, "-c", HERE / "intro_skip.c", "-o", obj)
    run(tool("arm-none-eabi-ld"), "-r", obj, "-o", elf)
    unresolved = subprocess.check_output([tool("arm-none-eabi-nm"), "-u", str(elf)]).strip()
    if unresolved:
        raise RuntimeError(f"{game}: unresolved symbols {unresolved.decode()}")
    (out / "symbols.yml").write_text(
        "Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\n"
        f"  - ID: 1\n    Name: {overlay}\n    Type: OVERLAY\nSymbols: []\n")
    (out / "metadata.yml").write_text(f"PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: {version}\n")
    dll = out / f"IntroSkip{game}.dll"
    dll.unlink(missing_ok=True)
    run("java", "-cp", JAR, "rpm.cli.RPMTool", "-i", elf, "--fourcc", "DLXF", "-o", dll,
        "--esdb", out / "symbols.yml", "--meta", out / "metadata.yml", "--generate-relocations", "--strip")
    dump = subprocess.check_output(["java", "-cp", str(JAR), "rpm.cli.RPMDump", "--fourcc", "DLXF", "-i", str(dll)]).decode()
    (out / "dump.txt").write_text(dump)
    targets = sorted(t for t in re.findall(r"Target: (\S+) @ (\S+) :: (\S+)", dump) if t[1] != "base")
    expected = sorted(("THUMB_BRANCH_LINK", str(overlay), hooks[name]["address"]) for name in HOOKS)
    normalized = sorted((kind, segment, f"0x{int(address, 16):08x}") for kind, segment, address in targets)
    if normalized != expected:
        raise RuntimeError(f"{game}: unexpected hook targets {targets}")
    if "Import symbol" in dump:
        raise RuntimeError(f"{game}: unresolved imports")
    return dll


def main():
    manifest = json.loads((HERE / "games.json").read_text())
    overlay = manifest["overlay"]
    shipped = {"version": manifest["version"], "overlay": overlay, "games": {}}
    for game, profile in manifest["games"].items():
        dll = build_game(game, profile, overlay, manifest["version"])
        blob = dll.read_bytes()
        (REPO / "src/assets/codeinjection" / dll.name).write_bytes(blob)
        shipped["games"][game] = {"idCode": profile["idCode"], "fileName": dll.name,
                                  "sha256": hashlib.sha256(blob).hexdigest(), "hooks": profile["hooks"]}
        print(f"{dll.name}: {len(blob)} bytes")
    (REPO / "src/assets/codeinjection/introSkipManifest.json").write_text(json.dumps(shipped, indent=2) + "\n")


if __name__ == "__main__":
    main()
