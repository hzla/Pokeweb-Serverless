"""Install a BW2 save-menu module into a new ROM with PMC already present."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import ndspy.rom

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from compatibility import audit  # noqa: E402
sys.path.insert(0, str(HERE.parent / "battle-type-hud"))
from rpm_read import read_rpm  # noqa: E402


def digest(data):
    return hashlib.sha256(data).hexdigest()


def hook_size(module, relocation):
    if relocation["type"] == "FULL_COPY":
        return module["symbols"][relocation["symbol"]]["size"]
    if relocation["type"] in {"OFFSET", "OFFSET_REL31", "THUMB_BRANCH_LINK", "ARM_BRANCH_LINK", "ARM_BRANCH"}:
        return 4
    return 32


def install(source: Path, output: Path, dll: Path | None):
    source = source.resolve()
    output = output.resolve()
    if source == output or output.exists():
        raise ValueError("Choose a new output filename; the input ROM will not be overwritten.")
    source_sha = digest(source.read_bytes())
    rom = ndspy.rom.NintendoDSRom.fromFile(source)
    original_files = list(rom.files)
    game_code = bytes(rom.idCode)
    version = {b'IRDO': 'W2', b'IREO': 'B2'}.get(game_code)
    if not version:
        raise ValueError('This patch requires compatible English Black 2 or White 2.')
    target = audit(rom, version)
    hook = target['hook']
    dll = dll or HERE.parents[1] / 'src' / 'assets' / 'codeinjection' / f'SaveMenu{version}.dll'
    module_bytes = dll.read_bytes()
    module = read_rpm(module_bytes)
    hooks = [r for r in module["relocations"] if r["module"] != "base"]
    if len(hooks) != 1 or hooks[0]["module"] != "162" or hooks[0]["address"] != hook or hooks[0]["type"] != "FULL_COPY" or hook_size(module, hooks[0]) != 16:
        raise ValueError("The save-menu DLL does not have the expected single 16-byte hook.")
    patch_dir = rom.filenames.subfolder("patches")
    dll_name = f'SaveMenu{version}.dll'
    if patch_dir is None or len(rom.arm9OverlayTable) < 345 * 32:
        raise ValueError('PMC is missing. Use Pokeweb to install PMC and the save menu together.')
    if any(name in patch_dir.files for name in ('SaveMenuB2.dll', 'SaveMenuW2.dll')):
        raise ValueError('A save-menu module is already in this ROM; update it in Pokeweb.')
    old_id = patch_dir.firstID
    names = list(patch_dir.files)
    payloads = [bytes(rom.files[old_id + i]) for i in range(len(names))]
    conflicts = []
    for name, payload in zip(names, payloads):
        if not name.lower().endswith('.dll'):
            continue
        if payload[:4] != b"DLXF":
            raise ValueError(f"Cannot audit PMC module {name}.")
        parsed = read_rpm(payload)
        if name.lower().startswith('mainmenuskip') and any(r['module'] != 'base' for r in parsed['relocations']):
            raise ValueError(f'{name} is active and would bypass the save menu. Remove that debug patch first.')
        for relocation in parsed["relocations"]:
            if relocation["module"] != "162":
                continue
            start = relocation["address"] & ~1
            if start < hook + 16 and hook < start + hook_size(parsed, relocation):
                conflicts.append(name)
    if conflicts:
        raise ValueError("Save-menu hook conflicts with: " + ", ".join(conflicts))
    # FNT directories require contiguous IDs. Alias the original patch payloads
    # at the end of FAT so every original non-patch file ID remains unchanged.
    patch_dir.firstID = len(rom.files)
    rom.files.extend(payloads)
    patch_dir.files.append(dll_name)
    rom.files.append(module_bytes)
    output.parent.mkdir(parents=True, exist_ok=True)
    rom.saveToFile(output)
    built = ndspy.rom.NintendoDSRom.fromFile(output)
    for file_id, original in enumerate(original_files):
        if built.files[file_id] != original:
            raise ValueError(f"Output changed original file ID {file_id} unexpectedly.")
    if built.getFileByName(f'patches/{dll_name}') != module_bytes:
        raise ValueError("Output verification failed for the new PMC DLL.")
    report = {
        "source": str(source), "source_sha256": source_sha, "version": version,
        "output": str(output), "output_sha256": digest(output.read_bytes()),
        "dll_sha256": digest(module_bytes), "hook": hex(hook),
        "conflicts": conflicts, "non_patch_file_ids_preserved": True,
        "source_unchanged": digest(source.read_bytes()) == source_sha,
    }
    output.with_suffix(".install.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--dll", type=Path, help="Version-matched DLL; defaults to the bundled file")
    args = parser.parse_args()
    try:
        print(json.dumps(install(args.source, args.output, args.dll), indent=2))
    except Exception as exc:
        raise SystemExit("INSTALLATION REFUSED: " + str(exc))
