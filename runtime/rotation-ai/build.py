"""Build the Gen 5 PMC modules and their native layout fingerprints."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess

from ndspy.codeCompression import decompress


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
BUILD = HERE / "build"
ASSETS = REPO / "src/assets/codeinjection"
VERSION = "1.0.0"
GAMES = {
    "B": ("IRBO", 0x20, 0x021f3cb4, 0x0201c314),
    "W": ("IRAO", 0, 0x021f3cd4, 0x0201c330),
    "B2": ("IREO", 0x40, 0x021db198, 0x0202186c),
    "W2": ("IRDO", 0, 0x021db1d8, 0x02021898),
}
# White and White 2 baseline addresses. Each Black overlay is shifted by the
# version's fixed delta above. The ARM9 damage helper has its own mapping.
BW1_HOOKS = [(0x021f0034, "OFFSET"), (0x021d0858, "THUMB_BRANCH_LINK")]
BW2_HOOKS = [(0x021d70d8, "OFFSET"), (0x021b5ace, "THUMB_BRANCH_LINK")]
BW1_SIGNATURES = [
    (93, 0x021f0034, 4),   # AI command callback
    (93, 0x021d0790, 16),  # Callback prologue and sequence dispatch
    (93, 0x021d084c, 22),  # Rotation branch, client register and picker call
    (93, 0x021d0994, 8),   # Callback frame cleanup
    (93, 0x021cf83c, 12),  # Native legal move mask
    (93, 0x021c7e34, 12),  # Native damage estimator
    (93, 0x021d7424, 0x34), # Event list and sleeping flag layout
    (96, 0x021880dc, 44),  # Scoring setup
    (96, 0x0218816c, 16),  # Native scoring and frame yields
]
BW2_SIGNATURES = [
    (167, 0x021d70d8, 4),
    (167, 0x021b59ec, 16),
    (167, 0x021b5ac2, 22),
    (167, 0x021b5c20, 8),
    (167, 0x021b4a64, 12),
    (167, 0x021ab994, 12),
    (167, 0x021bcc54, 0x34),
    (170, 0x0217f7fc, 44),
    (170, 0x0217f88c, 16),
]


def read_at(stream, offset, length):
    stream.seek(offset)
    return stream.read(length)


def load_overlays(path, game, ids):
    with path.open("rb") as rom:
        if read_at(rom, 12, 4) != game.encode() or read_at(rom, 0x1e, 1) != b"\0":
            raise ValueError(f"Expected a US revision-0 {game} ROM")
        fat, _, table, size = struct.unpack("<4I", read_at(rom, 0x48, 16))
        overlays = {}
        for index, address, size_ram, _, _, _, file_id, flags in struct.iter_unpack("<8I", read_at(rom, table, size)):
            if index not in ids:
                continue
            start, end = struct.unpack("<2I", read_at(rom, fat + file_id * 8, 8))
            payload = read_at(rom, start, end - start)
            data = decompress(payload) if flags & 0x01000000 else payload
            if len(data) != size_ram:
                raise ValueError(f"Unexpected initialized size for overlay {index}")
            overlays[index] = (address, data)
        return overlays


def run(*command):
    subprocess.run([str(x) for x in command], check=True)


def build(game, path, tools, jar):
    id_code, delta, event_head, damaging = GAMES[game]
    bw1 = len(game) == 1
    battle, ai = (93, 96) if bw1 else (167, 170)
    hooks = BW1_HOOKS if bw1 else BW2_HOOKS
    signatures = BW1_SIGNATURES if bw1 else BW2_SIGNATURES
    selector, event_literal = (0x021d0790, 0x021d7454) if bw1 else (0x021b59ec, 0x021bcc84)
    picker_call = "fff746ff" if bw1 else "fff739ff"
    overlays = load_overlays(path, id_code, (battle, ai))

    def native_bytes(overlay_id, address, length):
        base, data = overlays[overlay_id]
        offset = address - base
        if offset < 0 or offset + length > len(data):
            raise ValueError(f"{game} overlay {overlay_id} is missing address {address:#x}")
        return data[offset:offset + length]

    # Pin the layout even when the source ROM uses a different padding size.
    callback = native_bytes(battle, hooks[0][0] - delta, 4)
    picker = native_bytes(battle, hooks[1][0] - delta, 4)
    if callback != struct.pack("<I", (selector | 1) - delta) or picker != bytes.fromhex(picker_call):
        raise ValueError(f"{game} does not have the expected stock rotation callback")
    if native_bytes(battle, selector - delta, 6) != bytes.fromhex("f8b584b00d1c"):
        raise ValueError(f"{game} AI callback has a different stack frame")
    if native_bytes(battle, event_literal - delta, 4) != struct.pack("<I", event_head - 4):
        raise ValueError(f"{game} battle event list has moved")

    main = BUILD / f"{game}.o"
    entry = BUILD / f"{game}-entry.o"
    elf = BUILD / f"{game}.elf"
    meta = BUILD / f"{game}.yml"
    meta.write_text(f"PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: {VERSION}\nPokewebRotationAI: 1\n")
    symbols = BUILD / "symbols.yml"
    symbols.write_text(f"Segments:\n  - ID: {battle}\n    Name: {battle}\n    Type: OVERLAY\nSymbols: []\n")
    flags = ["-mthumb", "-mcpu=arm946e-s", f"-ffile-prefix-map={REPO}=."]
    if bw1:
        flags.append("-DBW1")
    run(tools / "arm-none-eabi-gcc", *flags, "-std=c11", "-Os", "-Wall", "-Wextra", "-Werror",
        "-ffreestanding", "-fno-unwind-tables", "-fno-asynchronous-unwind-tables",
        f"-DVERSION_DELTA={delta}", f"-DEVENT_LIST_HEAD={event_head}", f"-DDAMAGING_ADDRESS={damaging}",
        f"-DDISPATCH_HOOK=OFFSET_{battle}_{hooks[0][0] - delta:#x}", "-c", HERE / "runtime.c", "-o", main)
    run(tools / "arm-none-eabi-gcc", *flags, f"-DROTATION_HOOK=THUMB_BRANCH_LINK_{battle}_{hooks[1][0] - delta:#x}",
        "-c", HERE / "entry.S", "-o", entry)
    run(tools / "arm-none-eabi-ld", "-r", "-z", "noexecstack", main, entry, "-o", elf)
    if subprocess.check_output([tools / "arm-none-eabi-nm", "-u", elf]).strip():
        raise ValueError("Unexpected unresolved runtime imports")

    output = ASSETS / f"RotationBattleAI{game}.dll"
    run("java", "-cp", jar, "rpm.cli.RPMTool", "-i", elf, "--fourcc", "DLXF", "-o", output,
        "--esdb", symbols, "--meta", meta, "--generate-relocations", "--strip")
    return {
        "idCode": id_code,
        "fileName": output.name,
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "hooks": [{"overlay": battle, "address": address - delta, "type": kind} for address, kind in hooks],
        "signatures": [
            {"overlay": overlay, "address": address - delta,
             "hex": native_bytes(overlay, address - delta, length).hex()}
            for overlay, address, length in signatures
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--black", type=Path)
    parser.add_argument("--white", type=Path)
    parser.add_argument("--black2", type=Path)
    parser.add_argument("--white2", type=Path)
    parser.add_argument("--rpm-tool", type=Path, default=os.environ.get("RPM_TOOL_JAR"), required=not os.environ.get("RPM_TOOL_JAR"))
    parser.add_argument("--toolchain-bin", type=Path, default=Path(os.environ.get("ARM_TOOLCHAIN_BIN", "")))
    args = parser.parse_args()
    requested = {"B": args.black, "W": args.white, "B2": args.black2, "W2": args.white2}
    inputs = {game: path for game, path in requested.items() if path is not None}
    if not inputs:
        parser.error("Supply at least one retail ROM")
    BUILD.mkdir(exist_ok=True)
    manifest = ASSETS / "rotationBattleAiManifest.json"
    profiles = {}
    if manifest.exists():
        previous = json.loads(manifest.read_text())
        if previous["version"] != VERSION and inputs.keys() != GAMES.keys():
            parser.error("A version change requires rebuilding all supported games")
        profiles.update(previous["games"])
    for game, path in inputs.items():
        profiles[game] = build(game, path, args.toolchain_bin, args.rpm_tool)
    manifest.write_text(json.dumps({
        "version": VERSION,
        "games": {game: profiles[game] for game in GAMES if game in profiles},
    }, indent=2) + "\n")


if __name__ == "__main__":
    main()
