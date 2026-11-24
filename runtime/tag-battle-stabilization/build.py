"""Build and fingerprint the stripped Gen V PMC modules from audited retail sites."""

import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import struct
import subprocess
from tempfile import TemporaryDirectory

from ndspy.codeCompression import decompress

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
WORKSPACE = REPO.parent
ASSETS = REPO / "src/assets/codeinjection"
VERSION = "1.0.0"
WHITE2_SHA256 = "7ed12b4c532f4156365510bb18106c62c39fa5bbf848f0ffbdd8ce01eadd4f2a"
ROUTINES = ("INIT", "THINK", "EXIT")
GAMES = {
    "B": ("IRBO", 93, 96, (0x021CD87E, 0x021D08FC, 0x021CD8F8), (0x02187F00, 0x02187FB0, 0x02188080)),
    "W": ("IRAO", 93, 96, (0x021CD89E, 0x021D091C, 0x021CD918), (0x02187F20, 0x02187FD0, 0x021880A0)),
    "B2": ("IREO", 167, 170, (0x021B1808, 0x021B5B52, 0x021B18A8), (0x0217F600, 0x0217F6B0, 0x0217F780)),
    "W2": ("IRDO", 167, 170, (0x021B1848, 0x021B5B92, 0x021B18E8), (0x0217F640, 0x0217F6F0, 0x0217F7C0)),
}


def read_at(stream, offset, length):
    stream.seek(offset)
    return stream.read(length)


def load_overlays(path, id_code, ids):
    with path.open("rb") as rom:
        if read_at(rom, 12, 4) != id_code.encode() or read_at(rom, 0x1e, 1) != b"\0":
            raise ValueError(f"Expected a US revision-0 {id_code} ROM")
        fat, _, table, length = struct.unpack("<4I", read_at(rom, 0x48, 16))
        overlays = {}
        for index, base, size, _, _, _, file_id, flags in struct.iter_unpack("<8I", read_at(rom, table, length)):
            if index in ids:
                start, end = struct.unpack("<2I", read_at(rom, fat + 8 * file_id, 8))
                payload = read_at(rom, start, end - start)
                data = decompress(payload) if flags & 0x01000000 else payload
                if len(data) != size:
                    raise ValueError(f"Invalid initialized size for overlay {index}")
                overlays[index] = (base, data)
        return overlays


def thumb_bl_target(address, data):
    high, low = struct.unpack_from("<2H", data)
    if high & 0xF800 != 0xF000 or low & 0xF800 != 0xF800:
        raise ValueError(f"Expected a Thumb BL at {address:#x}")
    displacement = ((high & 0x7ff) << 12) | ((low & 0x7ff) << 1)
    if displacement & 0x400000:
        displacement -= 0x800000
    return address + 4 + displacement


def rpm_code(data):
    header, = struct.unpack_from("<I", data, 8)
    relative_info, bss_size = struct.unpack_from("<2I", data, header + 8)
    code_at, code_size = struct.unpack_from("<2I", data, header + relative_info + 16)
    if bss_size != 4 or code_size != 92:
        raise ValueError("The compiled scheduler layout has changed")
    return data[code_at:code_at + code_size]


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)


def build_game(game, rom, build, tools, jar):
    id_code, battle, ai, hooks, targets = GAMES[game]
    overlays = load_overlays(rom, id_code, (battle, ai))

    def signature(overlay, address, length):
        base, data = overlays[overlay]
        offset = address - base
        if offset < 0 or offset + length > len(data):
            raise ValueError(f"{id_code} overlay {overlay} is missing {address:#x}")
        return {"overlayId": overlay, "address": address, "hex": data[offset:offset + length].hex()}

    calls = [signature(battle, address, 8) for address in hooks]
    entries = [signature(ai, address, 16) for address in targets]
    for call, entry, prologue in zip(calls, entries, ("f0b583b0", "f8b584b0", "38b5051c"), strict=True):
        if thumb_bl_target(call["address"], bytes.fromhex(call["hex"])) != entry["address"] or not entry["hex"].startswith(prologue):
            raise ValueError(f"{id_code} does not match the audited battle AI calls")

    bindings = []
    for name, address, target in zip(ROUTINES, hooks, targets, strict=True):
        bindings += [f"-DTAG_AI_{name}_HOOK=THUMB_BRANCH_LINK_{battle}_{address:#x}",
                     f"-DTAG_AI_{name}={target | 1:#x}"]
    obj = build / "serialized_ai.o"
    elf = build / f"TagBattleStabilization{game}.elf"
    symbols = build / "symbols.yml"
    symbols.write_text(f"Segments:\n  - ID: {battle}\n    Name: {battle}\n    Type: OVERLAY\nSymbols: []\n")
    metadata = build / "metadata.yml"
    metadata.write_text(f"PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: {VERSION}\n")
    run(tools / "arm-none-eabi-g++", "-mthumb", "-march=armv5t", "-mno-thumb-interwork", "-mno-long-calls",
        "-Os", "-Wall", "-Wextra", "-Werror", "-ffreestanding", "-fvisibility=hidden", "-fno-exceptions",
        "-fno-rtti", "-fno-unwind-tables", "-fno-asynchronous-unwind-tables",
        f"-ffile-prefix-map={REPO}=.", *bindings, "-c", HERE / "serialized_ai.cpp", "-o", obj)
    run(tools / "arm-none-eabi-ld", "-r", obj, "-o", elf)
    if subprocess.check_output([tools / "arm-none-eabi-nm", "-u", elf]).strip():
        raise ValueError("Unexpected unresolved runtime imports")
    output = elf.with_suffix(".dll")
    run("java", "-cp", jar, "rpm.cli.RPMTool", "-i", elf, "--fourcc", "DLXF", "-o", output,
        "--esdb", symbols, "--meta", metadata, "--generate-relocations", "--strip")
    blob = output.read_bytes()
    return {
        "idCode": id_code,
        "fileName": output.name,
        "codeSha256": sha256(rpm_code(blob)).hexdigest(),
        "calls": calls,
        "entries": entries,
    }, blob


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for title in ("black", "white", "black2", "white2"):
        parser.add_argument(f"--{title}", type=Path, required=True)
    parser.add_argument("--rpm-tool", type=Path, default=Path(os.environ.get(
        "RPM_TOOL_JAR", WORKSPACE / "pw2-build-work/ctrmap/CTRMap.jar")))
    parser.add_argument("--toolchain-bin", type=Path, default=Path(os.environ.get(
        "ARM_TOOLCHAIN_BIN", WORKSPACE / "toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin")))
    args = parser.parse_args()
    profiles, artifacts = {}, {}
    with TemporaryDirectory(prefix="tag-stabilization-") as directory:
        for game, path in zip(GAMES, (args.black, args.white, args.black2, args.white2), strict=True):
            profiles[game], artifacts[game] = build_game(game, path, Path(directory), args.toolchain_bin, args.rpm_tool)
    if sha256(artifacts["W2"]).hexdigest() != WHITE2_SHA256:
        raise ValueError("The White 2 build differs from the bundled runtime")
    for game, profile in profiles.items():
        (ASSETS / profile["fileName"]).write_bytes(artifacts[game])
    (ASSETS / "tagBattleStabilizationManifest.json").write_text(
        json.dumps({"version": VERSION, "games": profiles}, indent=2) + "\n")


if __name__ == "__main__":
    main()
