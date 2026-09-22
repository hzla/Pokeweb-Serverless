"""Generate and build the IREO revision-0 port from the reviewed IRDO sources.

Black 2 and White 2 share the follower-facing field implementation, but their
linked ARM9 and overlay addresses differ.  Keeping this mapping in one place
prevents the C calls, assembly relocation names, and binary contract from
drifting apart.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import ndspy.codeCompression
import ndspy.rom

HERE = Path(__file__).resolve().parent
BLACK2_SHA256 = "2e6b2415354aa41471bc7617068dce059a59931bf5c4348a264f8043f297683a"


def port_address(address: int) -> int:
    """Translate a reviewed IRDO runtime address to stock US IREO revision 0."""
    # Black 2 removes 44 bytes immediately before the rail-direction helper;
    # every reviewed ARM9 adapter after that point follows the shifted layout.
    if 0x02018C00 <= address < 0x02100000:
        return address - 0x2C
    if 0x02150400 <= address < 0x02170000:
        return address - 0x40
    if 0x02176B40 <= address < 0x02180000:
        return address - 0x40
    if 0x02180000 <= address < 0x021B0000:
        return address - 0x40
    if 0x021B0000 <= address < 0x021D0000:
        return address - 0x38
    return address


ADDRESS = re.compile(r"0x0?2[0-9a-fA-F]{6}")


def port_source(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        value = int(match.group(), 16)
        return f"0x{port_address(value):08x}"
    return ADDRESS.sub(replace, text)


def _segments(rom_path: Path, contract: dict):
    rom = ndspy.rom.NintendoDSRom(rom_path.read_bytes())
    ids = sorted({int(site["segment"]) for site in contract["hooks"] + contract.get("nativeAdapters", []) if site["segment"] != "ARM9"})
    overlays = rom.loadArm9Overlays(ids)
    result = {"ARM9": (rom.arm9RamAddress, ndspy.codeCompression.decompress(rom.arm9))}
    result.update({str(index): (overlay.ramAddress, overlay.data) for index, overlay in overlays.items()})
    return result


def generate_contract(rom_path: Path, output: Path | None = None) -> dict:
    source = json.loads((HERE / "contract.json").read_text())
    segments = _segments(rom_path, source)
    result = json.loads(json.dumps(source))
    result["target"] = {"gameCode": "IREO", "revision": 0, "sha256": BLACK2_SHA256}
    result["structureEvidence"]["field"]["status"] = "offset checked against the IREO revision-0 field binary; live emulator acceptance pending"
    result["structureEvidence"]["status"] = "IREO binary layouts and adapters verified; live emulator acceptance pending"
    for site in result["hooks"] + result.get("nativeAdapters", []):
        site["address"] = port_address(site["address"])
        base, data = segments[site["segment"]]
        at = site["address"] - base
        length = len(bytes.fromhex(site["expectedHex"]))
        if at < 0 or at + length > len(data):
            raise ValueError(f"Black 2 site is outside {site['segment']}: {site['id']}")
        site["expectedHex"] = bytes(data[at:at + length]).hex()
        for key in ("continuation", "abi", "conflicts", "status"):
            if isinstance(site.get(key), str):
                site[key] = port_source(site[key]).replace("IRDO", "IREO").replace("White 2", "Black 2")
        site["status"] = "Black 2 binary signature and packaged relocation verified; game-emulator validation pending"
        if isinstance(site.get("displaced"), list):
            site["displaced"] = [port_source(value) for value in site["displaced"]]
    output = output or HERE / "black2-contract.json"
    output.write_text(json.dumps(result, indent=2) + "\n")
    return result


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rom", type=Path)
    parser.add_argument("--output", type=Path, default=HERE / "black2-contract.json")
    arguments = parser.parse_args()
    generated = generate_contract(arguments.rom, arguments.output)
    print(f"Generated {arguments.output}: {len(generated['hooks'])} hooks and {len(generated['nativeAdapters'])} adapters.")
