"""Generate a separate packaged-memory audit for the Italian follower build."""
import argparse
import json
from pathlib import Path

from audit_memory import audit

HERE = Path(__file__).resolve().parent


def generate(rom: Path):
    result = audit("white2italy", rom)
    output = HERE / "build" / "white2italy"
    output.mkdir(parents=True, exist_ok=True)
    (output / "memory-audit.json").write_text(json.dumps(result, indent=2) + "\n")
    print(f"Italian packaged fixed payload {result['fixedPayloadBytes']} bytes; no game emulator run.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rom", type=Path)
    generate(parser.parse_args().rom)
