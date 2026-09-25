"""Pin the IRDI PMC loader sites and imported native entry signatures."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from italy_port import HERE, ITALIAN_SHA256, US_SHA256, checked_rom, port_address, segments


def generate(us_path: Path, italian_path: Path):
    source = checked_rom(us_path, US_SHA256, b"IRDO")
    target = checked_rom(italian_path, ITALIAN_SHA256, b"IRDI")
    us_base, us_data = segments(source, set())["ARM9"]
    target_base, target_data = segments(target, set())["ARM9"]
    repo = HERE.parents[1]
    symbols = json.loads(subprocess.check_output(
        ["npx", "vite-node", "scripts/inspect-pmc.ts"], cwd=repo, text=True))
    hooks = []
    for item in symbols["external"]:
        old = item["target"]["address"]
        new = port_address(old)
        size = item["size"] if item["target"]["type"] == "FULL_COPY" else 4
        hooks.append({"id": item["source"], "address": new, "sourceAddress": old,
                      "kind": item["target"]["type"], "patchBytes": size,
                      "expectedHex": target_data[new-target_base:new-target_base+size].hex(),
                      "sourceHex": us_data[old-us_base:old-us_base+size].hex()})
    imports = []
    for item in symbols["imports"]:
        old = item["address"] & ~1
        if not us_base <= old < us_base + len(us_data):
            continue
        new = port_address(old)
        imports.append({"id": item["name"], "address": new, "sourceAddress": old,
                        "type": item["type"], "expectedHex": target_data[new-target_base:new-target_base+16].hex(),
                        "sourceHex": us_data[old-us_base:old-us_base+16].hex()})
    result = {"schemaVersion": 1, "target": {"gameCode": "IRDI", "revision": 0,
              "sha256": ITALIAN_SHA256}, "sourceSha256": US_SHA256, "pmcSourceVersion": symbols["metadata"]["PMCVersion"],
              "hooks": hooks, "imports": imports}
    output = HERE / "italy-pmc-contract.json"
    output.write_text(json.dumps(result, indent=2) + "\n")
    print(f"Pinned {len(hooks)} PMC hooks and {len(imports)} imported ARM9 entries")


if __name__ == "__main__":
    import sys
    generate(Path(sys.argv[1]), Path(sys.argv[2]))
