"""Install the separate White 2 save-menu PMC module into a new ROM file."""
import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

import ndspy.rom

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "battle-type-hud"))
from rpm_read import read_rpm  # noqa: E402

TARGET_SHA = "6aab8eeff93ff966fce3c2a44162bfa10052511f3b7f69e000815852af05d1c9"
SKIP_SHA = "cd1da75cfb740ee1e5b9d3abacd23bf8209e3b6f536cbdd7bc336995518ca67f"
HOOK = 0x0219D9E4
HOOK_BYTES = bytes.fromhex("38b519251c1c2d016159201c8a000849")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def hook_size(module, relocation):
    if relocation["type"] == "FULL_COPY":
        return module["symbols"][relocation["symbol"]]["size"]
    if relocation["type"] in {"OFFSET", "OFFSET_REL31", "THUMB_BRANCH_LINK", "ARM_BRANCH_LINK", "ARM_BRANCH"}:
        return 4
    return 32


def install(source: Path, output: Path, dll: Path):
    source = source.resolve()
    output = output.resolve()
    if source == output or output.exists():
        raise ValueError("Choose a new output filename; the input ROM will not be overwritten.")
    if digest(source.read_bytes()) != TARGET_SHA:
        raise ValueError("ROM hash differs from the inspected Following Pokemon 0.7.16 alpha build.")
    rom = ndspy.rom.NintendoDSRom.fromFile(source)
    original_files = list(rom.files)
    if bytes(rom.idCode) != b"IRDO":
        raise ValueError("This patch requires English White 2.")
    overlay = rom.loadArm9Overlays([162])[162]
    at = HOOK - overlay.ramAddress
    if overlay.data[at:at + len(HOOK_BYTES)] != HOOK_BYTES:
        raise ValueError("Save-menu hook signature differs from the inspected build.")
    module_bytes = dll.read_bytes()
    module = read_rpm(module_bytes)
    hooks = [r for r in module["relocations"] if r["module"] != "base"]
    if len(hooks) != 1 or hooks[0]["module"] != "162" or hooks[0]["address"] != HOOK or hooks[0]["type"] != "FULL_COPY" or hook_size(module, hooks[0]) != 16:
        raise ValueError("The save-menu DLL does not have the expected single 16-byte hook.")
    patch_dir = rom.filenames.subfolder("patches")
    if patch_dir is None or "MainMenuSkip(1).dll" not in patch_dir.files or "SaveMenuW2.dll" in patch_dir.files:
        raise ValueError("The inspected PMC patch directory is missing or already contains this menu patch.")
    old_id = patch_dir.firstID
    names = list(patch_dir.files)
    payloads = [bytes(rom.files[old_id + i]) for i in range(len(names))]
    conflicts = []
    for name, payload in zip(names, payloads):
        if payload[:4] != b"DLXF":
            raise ValueError(f"Cannot audit PMC module {name}.")
        parsed = read_rpm(payload)
        for relocation in parsed["relocations"]:
            if relocation["module"] != "162":
                continue
            start = relocation["address"] & ~1
            if start < HOOK + 16 and HOOK < start + hook_size(parsed, relocation):
                conflicts.append(name)
    if conflicts:
        raise ValueError("Save-menu hook conflicts with: " + ", ".join(conflicts))
    skip_index = names.index("MainMenuSkip(1).dll")
    skip = bytearray(payloads[skip_index])
    if digest(skip) != SKIP_SHA or struct.unpack_from("<I", skip, 280)[0] != 1:
        raise ValueError("Main Menu Skip differs from the inspected build.")
    # Remove its one external ARM9 hook. Its internal relocation stays intact.
    struct.pack_into("<I", skip, 280, 0)
    if any(r["module"] != "base" for r in read_rpm(skip)["relocations"]):
        raise ValueError("Could not disable the original startup skip hook.")
    payloads[skip_index] = bytes(skip)
    rom.files[old_id + skip_index] = bytes(skip)
    # FNT directories require contiguous IDs. Alias the original patch payloads
    # at the end of FAT so every original non-patch file ID remains unchanged.
    patch_dir.firstID = len(rom.files)
    rom.files.extend(payloads)
    patch_dir.files.append("SaveMenuW2.dll")
    rom.files.append(module_bytes)
    output.parent.mkdir(parents=True, exist_ok=True)
    rom.saveToFile(output)
    built = ndspy.rom.NintendoDSRom.fromFile(output)
    for file_id, original in enumerate(original_files):
        expected = bytes(skip) if file_id == old_id + skip_index else original
        if built.files[file_id] != expected:
            raise ValueError(f"Output changed original file ID {file_id} unexpectedly.")
    if built.getFileByName("patches/SaveMenuW2.dll") != module_bytes:
        raise ValueError("Output verification failed for the new PMC DLL.")
    if built.getFileByName("patches/MainMenuSkip(1).dll") != bytes(skip):
        raise ValueError("Output verification failed for the disabled skip module.")
    report = {
        "source": str(source), "source_sha256": TARGET_SHA,
        "output": str(output), "output_sha256": digest(output.read_bytes()),
        "dll_sha256": digest(module_bytes), "hook": hex(HOOK),
        "conflicts": conflicts, "non_patch_file_ids_preserved": True,
        "source_unchanged": digest(source.read_bytes()) == TARGET_SHA,
    }
    output.with_suffix(".install.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--dll", type=Path, default=HERE.parents[1] / "src" / "assets" / "codeinjection" / "SaveMenuW2.dll")
    args = parser.parse_args()
    try:
        print(json.dumps(install(args.source, args.output, args.dll), indent=2))
    except Exception as exc:
        raise SystemExit("INSTALLATION REFUSED: " + str(exc))
