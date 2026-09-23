"""Port reviewed US White 2 follower addresses to Italian IRDI revision 0.

The translation is deliberately segmented.  The Italian binary has independent
link-layout changes in ARM9 and each overlay; treating the region as a single
delta would put both hooks and native calls into unrelated instructions.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import ndspy.codeCompression
import ndspy.rom

HERE = Path(__file__).resolve().parent
ITALIAN_SHA256 = "04c7ae9f697b09f0558c9a508fc8960531c6429e5341bd699955f5ff925d600a"
US_SHA256 = "3e50aec3db401332175a5d2b5fe2a68ac1a05ec63995dba9d1506b1b51837446"
ADDRESS = re.compile(r"0x0?2[0-9a-fA-F]{6}")


def port_address(address: int) -> int:
    """Translate a reviewed IRDO address, preserving instruction state bits."""
    # Six cross-segment veneers in safe script commands moved independently.
    veneers = {
        0x020244e1: 0x02024471, 0x020244ed: 0x0202447d,
        0x020243fd: 0x020243ad, 0x02024461: 0x02024411,
        0x020246c1: 0x02024649, 0x020246f1: 0x02024679,
    }
    if address in veneers:
        return veneers[address]
    if 0x02024800 <= address < 0x02091A00:
        return address - 0x80
    if 0x02091A00 <= address < 0x02099000:
        return address - 0x108
    if 0x02099000 <= address < 0x020A0000:
        return address - 0x100
    if 0x02150300 <= address < 0x02158750:
        return address - 0x100
    if 0x02158750 <= address < 0x0216E000:
        return address - 0x110
    if 0x0216E000 <= address < 0x02170000:
        return address - 0x100
    if 0x02170000 <= address < 0x021AF000:
        return address - (0xE8 if address >= 0x021AD840 else 0x100)
    if 0x021AF000 <= address < 0x021C5A40:
        return address - 0xE8
    if 0x021C5A40 <= address < 0x021D4C40:
        return address - 0xE4
    if 0x021D4C40 <= address < 0x021F0000:
        return address - 0xE0
    return address


def port_source(source: str) -> str:
    return ADDRESS.sub(lambda m: f"0x{port_address(int(m.group(), 16)):08x}", source)


def checked_rom(path: Path, expected_sha: str, code: bytes) -> ndspy.rom.NintendoDSRom:
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected_sha or data[12:16] != code or data[30] != 0:
        raise ValueError(f"Unexpected baseline ROM: {path}")
    return ndspy.rom.NintendoDSRom(data)


def segments(rom: ndspy.rom.NintendoDSRom, ids: set[int]):
    overlays = rom.loadArm9Overlays(sorted(ids))
    out = {"ARM9": (rom.arm9RamAddress, ndspy.codeCompression.decompress(rom.arm9))}
    out.update({str(i): (overlay.ramAddress, overlay.data) for i, overlay in overlays.items()})
    return out


def generate_contract(us_path: Path, italian_path: Path, output: Path | None = None) -> dict:
    contract = json.loads((HERE / "contract.json").read_text())
    us = checked_rom(us_path, US_SHA256, b"IRDO")
    italy = checked_rom(italian_path, ITALIAN_SHA256, b"IRDI")
    sites = contract["hooks"] + contract["nativeAdapters"]
    ids = {int(site["segment"]) for site in sites if site["segment"] != "ARM9"}
    source_segments, target_segments = segments(us, ids), segments(italy, ids)
    result = json.loads(json.dumps(contract))
    result["target"] = {"gameCode": "IRDI", "revision": 0, "sha256": ITALIAN_SHA256}
    result["structureEvidence"]["status"] = "Italian binary contract; emulator acceptance pending"
    result["structureEvidence"]["field"]["status"] = "Italian overlay-36 layout requires separate verification"
    for site in result["hooks"] + result["nativeAdapters"]:
        original = site["address"]
        source_base, source = source_segments[site["segment"]]
        old = bytes.fromhex(site["expectedHex"])
        at = original - source_base
        if at < 0 or bytes(source[at:at + len(old)]) != old:
            raise ValueError(f"US source contract drift: {site['id']}")
        site["address"] = port_address(original)
        target_base, target = target_segments[site["segment"]]
        at = site["address"] - target_base
        if at < 0 or at + len(old) > len(target):
            raise ValueError(f"Italian site outside segment: {site['id']}")
        site["expectedHex"] = bytes(target[at:at + len(old)]).hex()
        site["usExpectedHex"] = old.hex()
        site["addressDelta"] = site["address"] - original
        for key in ("continuation", "abi", "conflicts"):
            if isinstance(site.get(key), str):
                site[key] = port_source(site[key]).replace("IRDO", "IRDI")
        if isinstance(site.get("displaced"), list):
            site["displaced"] = [port_source(value) for value in site["displaced"]]
        site["status"] = "Italian target bytes pinned; instruction/ABI audit and emulator acceptance pending"
    output = output or HERE / "italy-contract.json"
    output.write_text(json.dumps(result, indent=2) + "\n")
    return result


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("us_rom", type=Path)
    p.add_argument("italian_rom", type=Path)
    p.add_argument("--output", type=Path)
    args = p.parse_args()
    result = generate_contract(args.us_rom, args.italian_rom, args.output)
    print(f"Pinned {len(result['hooks'])} Italian hooks and {len(result['nativeAdapters'])} adapters.")
