"""Generate a separate packaged-memory audit for the Italian follower build."""
import argparse
import json
from pathlib import Path

from audit_memory import audit

HERE = Path(__file__).resolve().parent


def generate(rom: Path):
    result = audit("white2italy", rom)
    (HERE / "ITALY-MEMORY-AUDIT.json").write_text(json.dumps(result, indent=2) + "\n")
    modules = result["modules"]
    lines = ["# Italian White 2 follower memory audit", "",
             f"Version: {result['version']}. Generated from packaged W2I DLLs and the exported ROM.", "",
             "| Module | Code and initialized data | BSS | Combined payload |", "|---|---:|---:|---:|"]
    for module in modules:
        lines.append(f"| {module['name']} | {module['codeAndInitializedData']:,} B | {module['bss']:,} B | {module['codePlusBss']:,} B |")
    lines += ["", f"Total fixed module payload: **{result['fixedPayloadBytes']:,} B**.",
              f"Species index: {result['indexBytes']:,} B; page cache: {result['pageBytes']:,} B; movement trail: 64 records.",
              f"Generic dialogue buffer: {result['conversationCapacity']:,} B; shared contextual/gift scratch: {result['contextualCapacity']:,} B.",
              "The language record is loaded only on a Bag-full response into the existing scratch buffer.",
              "These values exclude loader metadata, native graphics allocations, stack and VRAM. No steady-state hardware heap measurement has been made.", ""]
    (HERE / "ITALY-MEMORY-AUDIT.md").write_text("\n".join(lines))
    print(f"Italian packaged fixed payload {result['fixedPayloadBytes']} bytes; no game emulator run.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rom", type=Path)
    generate(parser.parse_args().rom)
