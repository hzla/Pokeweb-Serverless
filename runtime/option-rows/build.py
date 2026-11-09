"""Build the shared Options rows modules (PokewebOptionRows{B,W,B2,W2}.dll).

    python3 runtime/option-rows/build.py

Each module hooks the seven Options call sites listed in games.json with tail
veneers (the native stack arguments and return address are kept) and carries
an empty row table that Pokeweb fills at install time.
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
TARGETS = {"init": "OptionRowsInit", "exit": "OptionRowsExit", "main": "OptionRowsMain", "select": "OptionRowsSelect",
           "compareExit": "OptionRowsCompare", "compareCancel": "OptionRowsCompare", "commit": "OptionRowsCommit"}


def tool(name):
    path = TOOLS / name
    return str(path) if path.exists() else name


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)


def build_game(game, profile, version):
    out = HERE / "build" / game
    out.mkdir(parents=True, exist_ok=True)
    overlay = profile["optionsOverlay"]
    (out / "option_rows_addr.h").write_text("".join(
        f"#define OR_{name} {address}u\n" for name, address in sorted(profile["bindings"].items())))
    asm = [".syntax unified", ".cpu arm946e-s", ".thumb", ".text", ".balign 4"]
    for hook, entry in profile["hooks"].items():
        symbol = f"THUMB_BRANCH_LINK_{overlay}_{entry['address']}"
        # Tail veneer: keeps the call site's stack arguments and return address.
        asm += [f".global {symbol}", f".type {symbol},%function", ".thumb_func", f"{symbol}:",
                " push {r3}", " ldr r3,1f", " mov ip,r3", " pop {r3}", " bx ip", " .balign 4",
                f"1: .word {TARGETS[hook]}", f".size {symbol},.-{symbol}", ".balign 4"]
    (out / "hooks.s").write_text("\n".join(asm) + "\n")
    run(tool("arm-none-eabi-gcc"), *CFLAGS, "-I", out, "-c", HERE / "option_rows.c", "-o", out / "option_rows.o")
    run(tool("arm-none-eabi-as"), "-mthumb", "-march=armv5t", out / "hooks.s", "-o", out / "hooks.o")
    elf = out / "option_rows.elf"
    run(tool("arm-none-eabi-ld"), "-r", out / "option_rows.o", out / "hooks.o", "-o", elf)
    unresolved = subprocess.check_output([tool("arm-none-eabi-nm"), "-u", str(elf)]).strip()
    if unresolved:
        raise RuntimeError(f"{game}: unresolved symbols {unresolved.decode()}")
    (out / "symbols.yml").write_text(
        "Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\n"
        f"  - ID: 1\n    Name: {overlay}\n    Type: OVERLAY\nSymbols: []\n")
    (out / "metadata.yml").write_text(f"PMCGameID: {game}\nPMCModulePriority: 3\nPMCVersion: {version}\n")
    dll = out / f"PokewebOptionRows{game}.dll"
    dll.unlink(missing_ok=True)
    run("java", "-cp", JAR, "rpm.cli.RPMTool", "-i", elf, "--fourcc", "DLXF", "-o", dll,
        "--esdb", out / "symbols.yml", "--meta", out / "metadata.yml", "--generate-relocations", "--strip")
    dump = subprocess.check_output(["java", "-cp", str(JAR), "rpm.cli.RPMDump", "--fourcc", "DLXF", "-i", str(dll)]).decode()
    (out / "dump.txt").write_text(dump)
    targets = sorted((kind, segment, f"0x{int(address, 16):08x}")
                     for kind, segment, address in re.findall(r"Target: (\S+) @ (\S+) :: (\S+)", dump) if segment != "base")
    expected = sorted(("THUMB_BRANCH_LINK", str(overlay), entry["address"]) for entry in profile["hooks"].values())
    if targets != expected:
        raise RuntimeError(f"{game}: unexpected hook targets {targets}")
    if "Import symbol" in dump:
        raise RuntimeError(f"{game}: unresolved imports")
    blob = dll.read_bytes()
    if blob.count(b"PWOR") != 1:
        raise RuntimeError(f"{game}: row table magic must appear once")
    return dll


def main():
    manifest = json.loads((HERE / "games.json").read_text())
    shipped = {"version": manifest["version"], "textIds": manifest["textIds"], "games": {}}
    for game, profile in manifest["games"].items():
        dll = build_game(game, profile, manifest["version"])
        blob = dll.read_bytes()
        (REPO / "src/assets/codeinjection" / dll.name).write_bytes(blob)
        shipped["games"][game] = {"idCode": profile["idCode"], "optionsOverlay": profile["optionsOverlay"], "fileName": dll.name,
                                  "sha256": hashlib.sha256(blob).hexdigest(), "hooks": profile["hooks"]}
        print(f"{dll.name}: {len(blob)} bytes")
    (REPO / "src/assets/codeinjection/optionRowsManifest.json").write_text(json.dumps(shipped, indent=2) + "\n")


if __name__ == "__main__":
    main()
