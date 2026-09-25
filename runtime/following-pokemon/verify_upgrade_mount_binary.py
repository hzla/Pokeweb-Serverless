"""Check every land/Surf hook and rider source asset in the pinned Upgrade ROM."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import ndspy.codeCompression
import ndspy.narc
import ndspy.rom

HERE = Path(__file__).resolve().parent


def verify(path: Path):
    raw = path.read_bytes()
    upgrade = json.loads((HERE / "upgrade-contract.json").read_text())
    if hashlib.sha256(raw).hexdigest() != upgrade["sourceRomSha256"]:
        raise ValueError("Unexpected White2Upgrade ROM")
    rom = ndspy.rom.NintendoDSRom(raw)
    overlays = rom.loadArm9Overlays([12, 36])
    segments = {"ARM9": (rom.arm9RamAddress, ndspy.codeCompression.decompress(rom.arm9))}
    segments.update({str(i): (overlay.ramAddress, overlay.data) for i, overlay in overlays.items()})
    contract = json.loads((HERE / "contract.json").read_text())
    audited = 0
    for site in contract["hooks"] + contract["nativeAdapters"]:
        if not site["id"].startswith(("surf-", "land-", "mounted-")):
            continue
        base, data = segments[site["segment"]]
        expected = bytes.fromhex(site["expectedHex"])
        at = site["address"] - base
        if at < 0 or data[at:at+len(expected)] != expected:
            raise ValueError(f"White2Upgrade mount signature differs: {site['id']}")
        audited += 1
    clean = ndspy.rom.NintendoDSRom((HERE.parents[2] / "cleanwhite2.nds").read_bytes())
    source_art = ndspy.narc.NARC(clean.getFileByName("a/0/4/8")).files
    target_art = ndspy.narc.NARC(rom.getFileByName("a/0/4/8")).files
    if any(source_art[index] != target_art[index] for index in (210, 211, 219, 220)):
        raise ValueError("White2Upgrade seated rider source art differs")
    print(f"White2Upgrade: {audited} mount hooks/adapters and seated rider art audited; no game emulator run.")


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 2:
        raise SystemExit("Expected pinned White2Upgrade ROM path")
    verify(Path(sys.argv[1]))
