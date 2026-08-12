#!/usr/bin/env python3
"""Build the safe move-expansion seed data from White2Upgrade source files."""

from __future__ import annotations

import argparse
import json
import sys
import tomllib
from pathlib import Path

sys.dont_write_bytecode = True

from generate_white2upgrade_move_reference import REFERENCE_FIELDS, build_record, read_enums


FIRST_SOURCE_MOVE_ID = 560
FIRST_TARGET_MOVE_ID = 680
TARGET_MOVE_COUNT = 1000


def parse_args() -> argparse.Namespace:
    default_source = Path(__file__).resolve().parents[3] / "White2Upgrade-Original-pokeweb"
    default_output = Path(__file__).resolve().parents[1] / "src/assets/data/white2upgradeMoveExpansion.json"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", type=Path, default=default_source, help="White2Upgrade source repository")
    parser.add_argument("--output", type=Path, default=default_output, help="Generated JSON path")
    return parser.parse_args()


def text_entries(path: Path) -> dict[str, dict[str, list[str]]]:
    return tomllib.loads(path.read_text())["msg"]["section_0"]["entries"]


def text_value(entries: dict[str, dict[str, list[str]]], entry_id: int) -> str:
    parts = entries[str(entry_id)]["text"]
    return "".join(parts).removesuffix("$")


def main() -> None:
    args = parse_args()
    source = args.source.resolve()
    move_dir = source / "data/pml/moves"
    text_dir = source / "data/text/system"
    enums = read_enums(source)
    names = text_entries(text_dir / "403.toml")
    uppercase_names = text_entries(text_dir / "488.toml")
    descriptions = text_entries(text_dir / "402.toml")

    moves: list[dict[str, object]] = []
    for path in sorted(move_dir.glob("*.toml"), key=lambda candidate: int(candidate.stem)):
        source_id = int(path.stem)
        if source_id < FIRST_SOURCE_MOVE_ID:
            continue
        document = tomllib.loads(path.read_text())
        data = build_record(next(iter(document.values())), enums)
        # Zero-PP entries are Z-Moves, Max Moves, or otherwise non-selectable
        # mechanics that are unsafe without their dedicated runtime handlers.
        if data[REFERENCE_FIELDS.index("pp")] <= 0:
            continue
        moves.append(
            {
                "sourceId": source_id,
                "name": text_value(names, source_id),
                "uppercaseName": text_value(uppercase_names, source_id),
                "description": text_value(descriptions, source_id),
                "data": data,
            }
        )

    capacity = TARGET_MOVE_COUNT - FIRST_TARGET_MOVE_ID
    if len(moves) > capacity:
        raise SystemExit(f"{len(moves)} selectable moves exceed the {capacity}-slot expansion capacity")

    payload = {
        "source": "White2Upgrade-Original-pokeweb/data/pml/moves and data/text/system",
        "fields": REFERENCE_FIELDS,
        "firstSourceMoveId": FIRST_SOURCE_MOVE_ID,
        "firstTargetMoveId": FIRST_TARGET_MOVE_ID,
        "targetMoveCount": TARGET_MOVE_COUNT,
        "moves": moves,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    print(f"Wrote {len(moves)} safe move definitions to {args.output}")


if __name__ == "__main__":
    main()
