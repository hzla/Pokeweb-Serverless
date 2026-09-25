"""Verify IRDI follower and PMC address equivalence against both exact ROMs.

Every changed signature byte must be accounted for by a translated literal
pointer or a Thumb call whose resolved destination translates to the same
native routine. This is a binary audit, not game-emulator acceptance.
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

import capstone
import ndspy.narc

from italy_port import HERE, ITALIAN_SHA256, US_SHA256, checked_rom, port_address, segments


def verify(us_path: Path, italian_path: Path):
    us = checked_rom(us_path, US_SHA256, b"IRDO")
    italy = checked_rom(italian_path, ITALIAN_SHA256, b"IRDI")
    contract = json.loads((HERE / "italy-contract.json").read_text())
    policy = json.loads((HERE / "event-policy.json").read_text())
    pmc = json.loads((HERE / "italy-pmc-contract.json").read_text())
    sites = contract["hooks"] + contract["nativeAdapters"]
    ids = {int(site["segment"]) for site in sites if site["segment"] != "ARM9"}
    source_segments, target_segments = segments(us, ids), segments(italy, ids)
    source_riders = ndspy.narc.NARC(us.getFileByName("a/0/4/8")).files
    target_riders = ndspy.narc.NARC(italy.getFileByName("a/0/4/8")).files
    if any(source_riders[index] != target_riders[index] for index in (210, 211, 219, 220)):
        raise ValueError("Italian seated rider source art differs")
    cs = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB)
    cs.detail = True
    counts = {"sites": 0, "identicalSites": 0, "translatedPointers": 0, "translatedThumbCalls": 0}
    by_id = {}
    for site in sites:
        old_at = site["address"] - site["addressDelta"]
        if port_address(old_at) != site["address"]:
            raise ValueError(f"Italian address mapping drift: {site['id']}")
        old = bytes.fromhex(site["usExpectedHex"])
        new = bytes.fromhex(site["expectedHex"])
        if len(old) != len(new):
            raise ValueError(f"Italian signature length drift: {site['id']}")
        source_base, source = source_segments[site["segment"]]
        target_base, target = target_segments[site["segment"]]
        if source[old_at-source_base:old_at-source_base+len(old)] != old or target[site["address"]-target_base:site["address"]-target_base+len(new)] != new:
            raise ValueError(f"Binary signature drift: {site['id']}")
        mask = [a == b for a, b in zip(old, new)]
        if all(mask):
            counts["identicalSites"] += 1
        for offset in range(len(old)-3):
            if (old_at + offset) & 3:
                continue
            before = struct.unpack_from("<I", old, offset)[0]
            after = struct.unpack_from("<I", new, offset)[0]
            if before != after and 0x02000000 <= before < 0x02400000 and port_address(before) == after:
                mask[offset:offset+4] = [True]*4
                counts["translatedPointers"] += 1
        for offset in range(0, len(old)-3, 2):
            if all(mask[offset:offset+4]):
                continue
            before = list(cs.disasm(old[offset:offset+4], old_at+offset, count=1))
            after = list(cs.disasm(new[offset:offset+4], site["address"]+offset, count=1))
            if not before or not after or before[0].size != 4 or after[0].size != 4:
                continue
            if before[0].mnemonic not in ("bl", "blx") or after[0].mnemonic != before[0].mnemonic:
                continue
            if port_address(before[0].operands[0].imm) == after[0].operands[0].imm:
                mask[offset:offset+4] = [True]*4
                counts["translatedThumbCalls"] += 1
        if not all(mask):
            raise ValueError(f"Unexplained Italian instruction/data difference: {site['id']}: {[i for i, ok in enumerate(mask) if not ok]}")
        counts["sites"] += 1
        by_id[site["id"]] = site
    for name in ("events-script-normal-table", "events-cleanup-table"):
        site = by_id[name]
        old = bytes.fromhex(site["usExpectedHex"])
        new = bytes.fromhex(site["expectedHex"])
        for offset in range(0, len(old), 4):
            if port_address(struct.unpack_from("<I", old, offset)[0]) != struct.unpack_from("<I", new, offset)[0]:
                raise ValueError(f"Italian script table target drift: {name} entry {offset//4}")
    for group, table in (("commands", "events-script-normal-table"), ("finishers", "events-cleanup-table")):
        raw = bytes.fromhex(by_id[table]["expectedHex"])
        for rule in policy[group]:
            index = rule["opcode"] if group == "commands" else rule["index"]
            if struct.unpack_from("<I", raw, index*4)[0] != port_address(rule["handler"]):
                raise ValueError(f"Italian safe-scene command mismatch: {group} {index}")
    arm_base, arm = target_segments["ARM9"]
    for site in pmc["hooks"] + pmc["imports"]:
        expected = bytes.fromhex(site["expectedHex"])
        if arm[site["address"]-arm_base:site["address"]-arm_base+len(expected)] != expected:
            raise ValueError(f"Italian PMC signature drift: {site['id']}")
    # The lone changed imported call targets are the translated native
    # functions; all other true imports have identical 16-byte entry shapes.
    for site in pmc["imports"]:
        if site["id"] == "*ABS*0x200400d":
            continue
        old, new = bytes.fromhex(site["sourceHex"]), bytes.fromhex(site["expectedHex"])
        if old == new:
            continue
        if site["id"] == "romfs_fclose":
            if old[:8] != new[:8] or port_address(struct.unpack_from("<I", old, 8)[0]) != struct.unpack_from("<I", new, 8)[0]:
                raise ValueError("Italian PMC romfs_fclose veneer differs")
        elif site["id"] == "GFLAppInit":
            a = [ins for ins in cs.disasm(old, site["sourceAddress"]) if ins.mnemonic == "bl"]
            b = [ins for ins in cs.disasm(new, site["address"]) if ins.mnemonic == "bl"]
            if len(a) != len(b) or any(port_address(x.operands[0].imm) != y.operands[0].imm for x, y in zip(a, b)):
                raise ValueError("Italian PMC GFLAppInit calls differ")
        else:
            raise ValueError(f"Unreviewed Italian PMC import difference: {site['id']}")
    result = {**counts, "scriptTableEntries": 755, "safeCommands": len(policy["commands"]),
              "safeFinishers": len(policy["finishers"]), "pmcHooks": len(pmc["hooks"]),
              "pmcImports": len(pmc["imports"]), "gameEmulatorTested": False}
    return result


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("us_rom", type=Path)
    parser.add_argument("italian_rom", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = verify(args.us_rom, args.italian_rom)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
