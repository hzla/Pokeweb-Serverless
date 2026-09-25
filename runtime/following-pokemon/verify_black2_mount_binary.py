"""Audit IREO mount hook instructions against the exact White 2 and Black 2 ROMs."""
from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path

import capstone
import ndspy.rom
import ndspy.codeCompression
import ndspy.narc

from black2_port import BLACK2_SHA256, HERE, port_address

US_SHA256 = "3e50aec3db401332175a5d2b5fe2a68ac1a05ec63995dba9d1506b1b51837446"


def segments(path: Path, sha256: str):
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != sha256:
        raise ValueError(f"Unexpected binary: {path}")
    rom = ndspy.rom.NintendoDSRom(raw)
    overlays = rom.loadArm9Overlays([12, 36])
    out = {"ARM9": (rom.arm9RamAddress, ndspy.codeCompression.decompress(rom.arm9))}
    out.update({str(i): (overlays[i].ramAddress, overlays[i].data) for i in overlays})
    return rom, out


def verify(us_path: Path, b2_path: Path):
    us_rom, us = segments(us_path, US_SHA256)
    b2_rom, b2 = segments(b2_path, BLACK2_SHA256)
    source = json.loads((HERE / "contract.json").read_text())
    target = json.loads((HERE / "black2-contract.json").read_text())
    target_sites = {site["id"]: site for site in target["hooks"] + target["nativeAdapters"]}
    cs = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB)
    cs.detail = True
    audited = 0
    for site in source["hooks"] + source["nativeAdapters"]:
        if not site["id"].startswith(("surf-", "land-", "mounted-")):
            continue
        other = target_sites[site["id"]]
        old_at, new_at = site["address"], other["address"]
        if port_address(old_at) != new_at or site["segment"] != other["segment"]:
            raise ValueError(f"Black 2 mount address mismatch: {site['id']}")
        old, new = bytes.fromhex(site["expectedHex"]), bytes.fromhex(other["expectedHex"])
        old_base, old_data = us[site["segment"]]
        new_base, new_data = b2[site["segment"]]
        if len(old) != len(new) or old_data[old_at-old_base:old_at-old_base+len(old)] != old or new_data[new_at-new_base:new_at-new_base+len(new)] != new:
            raise ValueError(f"Black 2 mount signature mismatch: {site['id']}")
        mask = [a == b for a, b in zip(old, new)]
        for offset in range(len(old)-3):
            if (old_at + offset) & 3:
                continue
            before, after = struct.unpack_from("<I", old, offset)[0], struct.unpack_from("<I", new, offset)[0]
            if before != after and 0x02000000 <= before < 0x02400000 and port_address(before) == after:
                mask[offset:offset+4] = [True] * 4
        for offset in range(0, len(old)-3, 2):
            if all(mask[offset:offset+4]):
                continue
            before = list(cs.disasm(old[offset:offset+4], old_at+offset, count=1))
            after = list(cs.disasm(new[offset:offset+4], new_at+offset, count=1))
            if before and after and before[0].size == after[0].size == 4 and before[0].mnemonic in ("bl", "blx") and after[0].mnemonic == before[0].mnemonic:
                if port_address(before[0].operands[0].imm) == after[0].operands[0].imm:
                    mask[offset:offset+4] = [True] * 4
        if not all(mask):
            raise ValueError(f"Unexplained Black 2 mount instruction difference: {site['id']}")
        audited += 1
    source_art = ndspy.narc.NARC(us_rom.getFileByName("a/0/4/8")).files
    target_art = ndspy.narc.NARC(b2_rom.getFileByName("a/0/4/8")).files
    if any(source_art[index] != target_art[index] for index in (210, 211, 219, 220)):
        raise ValueError("Black 2 seated rider source art differs")
    print(f"Black 2: {audited} mount hooks/adapters and seated rider art audited; no game emulator run.")


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 3:
        raise SystemExit("Expected clean US White 2 and Black 2 ROM paths")
    verify(Path(sys.argv[1]), Path(sys.argv[2]))
