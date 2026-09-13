#!/usr/bin/env python3
"""Translate one reviewed White 2 hook assembly source to clean-US IREO."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re


ADDRESS_RE = re.compile(r"0x[0-9a-fA-F]{6,8}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--aliases", type=Path, required=True)
    args = parser.parse_args()
    source = args.input.read_text(encoding="utf-8")
    aliases = json.loads(args.aliases.read_text(encoding="utf-8"))
    address_map = {int(source, 16): int(target, 16) for source, target in aliases["asmAddressMap"].items()}

    def replace(match: re.Match[str]) -> str:
        raw = match.group(0)
        value = int(raw, 16)
        translated = address_map.get(value, value)
        if translated == value and (0x02010000 <= value < 0x02200000):
            raise SystemExit(f"unreviewed Black 2 assembly address in {args.input}: {raw}")
        if translated == value:
            return raw
        width = len(raw) - 2
        return f"0x{translated:0{width}X}"

    result = ADDRESS_RE.sub(replace, source)
    # The upstream W2 source historically labels the Hall of Fame type table
    # as overlay 255 even though 0x0219B908 is in overlay 265.  Keep W2 byte
    # output untouched, but use the verified IREO owner for the B2 companion.
    result = result.replace("FULL_COPY_255_0x0219B8C8", "FULL_COPY_265_0x0219B8C8")
    banner = f"@ Generated from {args.input.name} for clean US Black 2 (IREO).\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(banner + result, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
