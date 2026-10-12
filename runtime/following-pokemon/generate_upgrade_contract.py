"""Refresh Upgrade fingerprints only after the existing native contract passes.

This does not approve changes to native functions, hooks, or archive layouts.
Module hook ownership, packaged CPU tests, and installation/export tests are
separate required gates before committing a refreshed profile.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import struct

import ndspy.codeCompression
import ndspy.narc
import ndspy.rom

HERE = Path(__file__).resolve().parent
MODULE_PATHS = tuple(f"patches/{name}.dll" for name in (
    "White2Upgrade", "White2UpgradeField", "White2UpgradePokedex", "White2UpgradeUI"))


def audit_native_sites(rom, sites):
    overlays = rom.loadArm9Overlays(sorted({int(site["segment"]) for site in sites
                                          if site["segment"] != "ARM9"}))
    segments = {"ARM9": (rom.arm9RamAddress, ndspy.codeCompression.decompress(rom.arm9))}
    segments.update({str(i): (overlay.ramAddress, overlay.data) for i, overlay in overlays.items()})
    for site in sites:
        expected = bytes.fromhex(site["expectedHex"])
        base, data = segments[site["segment"]]
        at = site["address"] - base
        if not expected or at < 0 or at + len(expected) > len(data) or data[at:at + len(expected)] != expected:
            raise ValueError("Native signature mismatch: " + site["id"])
        if "patchBytes" in site and sum(site["instructionSizes"]) != site["patchBytes"]:
            raise ValueError("Partial instruction in hook: " + site["id"])


def audit_archives(rom, baseline, shared):
    registry = shared["registry"]
    rows = ndspy.narc.NARC(rom.getFileByName(registry["path"])).files
    if len(rows) != 1 or len(rows[0]) != 4 + registry["stockRows"] * registry["stride"] or struct.unpack_from("<I", rows[0])[0] != registry["stockRows"]:
        raise ValueError("Unexpected follower descriptor archive")
    resources = ndspy.narc.NARC(rom.getFileByName(shared["resources"]["path"])).files
    if len(resources) != shared["resources"]["stockMembers"]:
        raise ValueError("Unexpected follower resource archive")
    personal = ndspy.narc.NARC(rom.getFileByName("a/0/1/6")).files
    if len(personal) <= baseline["speciesMax"]:
        raise ValueError("Missing expanded personal data")


def refresh(data, baseline, shared):
    if baseline["schemaVersion"] != 1 or baseline["profile"] != "white2upgrade" or tuple(m["path"] for m in baseline["requiredModules"]) != MODULE_PATHS:
        raise ValueError("Unexpected trusted Upgrade profile")
    if data[12:16].decode("ascii", errors="replace") != baseline["gameCode"] or data[30] != baseline["revision"]:
        raise ValueError("Requires the audited game/revision")
    rom = ndspy.rom.NintendoDSRom(data)
    # Preserve and check EVERY existing adapter, including gift, shadow and
    # tile effects. Never sample changed bytes and silently bless them.
    audit_native_sites(rom, shared["hooks"] + shared["nativeAdapters"] + baseline["nativeAdapters"])
    audit_archives(rom, baseline, shared)
    value = deepcopy(baseline)
    value["sourceRomSha256"] = hashlib.sha256(data).hexdigest()
    value["requiredModules"] = [dict(path=path, sha256=hashlib.sha256(rom.getFileByName(path)).hexdigest()) for path in MODULE_PATHS]
    if value["sourceRomSha256"] != baseline["sourceRomSha256"]:
        value["previousSourceRomSha256"] = list(dict.fromkeys([
            *baseline.get("previousSourceRomSha256", []), baseline["sourceRomSha256"]]))
    # Historical hashes recognize owned receipts/workspaces only. They do not
    # authorize old DLLs or mixed module sets for installation or reenabling.
    return value


def generate(rom_path, output, baseline_path=HERE / "upgrade-contract.json"):
    baseline = json.loads(baseline_path.read_text())
    shared = json.loads((HERE / "contract.json").read_text())
    value = refresh(rom_path.read_bytes(), baseline, shared)
    # Validation finishes before any output is replaced.
    output.write_text(json.dumps(value, indent=2) + "\n")
    print(f"Native contract and archives passed; captured {len(value['requiredModules'])} module fingerprints. Separate RPM and runtime gates still required.")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("rom", type=Path)
    p.add_argument("--baseline", type=Path, default=HERE / "upgrade-contract.json")
    p.add_argument("--output", type=Path, default=HERE / "upgrade-contract.json")
    a = p.parse_args()
    generate(a.rom, a.output, a.baseline)
