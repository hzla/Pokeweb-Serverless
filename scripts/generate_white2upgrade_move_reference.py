#!/usr/bin/env python3
"""Build the compact mastersheet move reference from White2Upgrade TOML data."""

from __future__ import annotations

import argparse
import ast
import json
import operator
import tomllib
from pathlib import Path
from typing import Any


REFERENCE_FIELDS = [
    "type",
    "effect_category",
    "category",
    "power",
    "accuracy",
    "pp",
    "priority",
    "hits",
    "result_effect",
    "effect_chance",
    "status",
    "min_turns",
    "max_turns",
    "crit",
    "flinch",
    "effect",
    "recoil",
    "healing",
    "target",
    "stat_1",
    "stat_2",
    "stat_3",
    "magnitude_1",
    "magnitude_2",
    "magnitude_3",
    "stat_chance_1",
    "stat_chance_2",
    "stat_chance_3",
    "flag",
    "properties",
]

ENUM_FILES = ["types", "btl_eff", "pss", "btl_inflict", "btl_stat", "btl_target", "status", "move_flags"]
BIN_OPS = {ast.BitOr: operator.or_, ast.LShift: operator.lshift, ast.RShift: operator.rshift, ast.Add: operator.add, ast.Sub: operator.sub}
UNARY_OPS = {ast.UAdd: operator.pos, ast.USub: operator.neg}


def parse_args() -> argparse.Namespace:
    default_source = Path(__file__).resolve().parents[3] / "White2Upgrade-Original"
    default_output = Path(__file__).resolve().parents[1] / "src/assets/data/white2upgradeMoves.json"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", type=Path, default=default_source, help="White2Upgrade source repository")
    parser.add_argument("--output", type=Path, default=default_output, help="Generated JSON path")
    return parser.parse_args()


def read_enums(source: Path) -> dict[str, int]:
    values: dict[str, int] = {}
    for name in ENUM_FILES:
        path = source / "tools/mkdata/enum" / f"{name}.toml"
        values.update({key: int(value) for key, value in tomllib.loads(path.read_text())["DEFINE"].items()})
    return values


def evaluate_expression(value: Any, enums: dict[str, int]) -> int | list[int]:
    if isinstance(value, int):
        return value
    if isinstance(value, list):
        return [int(evaluate_expression(item, enums)) for item in value]
    expression = ast.parse(str(value), mode="eval").body

    def evaluate(node: ast.AST) -> int:
        if isinstance(node, ast.Constant) and isinstance(node.value, int):
            return node.value
        if isinstance(node, ast.Name) and node.id in enums:
            return enums[node.id]
        if isinstance(node, ast.BinOp) and type(node.op) in BIN_OPS:
            return BIN_OPS[type(node.op)](evaluate(node.left), evaluate(node.right))
        if isinstance(node, ast.UnaryOp) and type(node.op) in UNARY_OPS:
            return UNARY_OPS[type(node.op)](evaluate(node.operand))
        raise ValueError(f"Unsupported move-data expression: {value!r}")

    return evaluate(expression)


def unsigned_byte(value: int) -> int:
    return value & 0xFF


def build_record(row: dict[str, Any], enums: dict[str, int]) -> list[int]:
    def scalar(name: str) -> int:
        value = evaluate_expression(row[name], enums)
        if isinstance(value, list):
            raise ValueError(f"Expected scalar field {name}")
        return value

    def vector(name: str) -> list[int]:
        value = evaluate_expression(row[name], enums)
        if not isinstance(value, list):
            raise ValueError(f"Expected vector field {name}")
        return value

    stats = vector("Status Change Stats")
    stages = vector("Status Change Stages")
    chances = vector("Status Change Chances")
    values = {
        "type": scalar("Type"),
        "effect_category": scalar("Quality"),
        "category": scalar("Category"),
        "power": scalar("Power"),
        "accuracy": scalar("Accuracy"),
        "pp": scalar("Base PP"),
        "priority": unsigned_byte(scalar("Priority")),
        "hits": scalar("Hit"),
        "result_effect": scalar("Inflict Status"),
        "effect_chance": scalar("Inflict Chance"),
        "status": scalar("Inflict Duration"),
        "min_turns": scalar("Turn (min)"),
        "max_turns": scalar("Turn (max)"),
        "crit": scalar("Critical Hit Stage"),
        "flinch": scalar("Flinch Rate"),
        "effect": scalar("Move Animation ID"),
        "recoil": unsigned_byte(scalar("Recoil")),
        "healing": unsigned_byte(scalar("Heal")),
        "target": scalar("Target"),
        "stat_1": unsigned_byte(stats[0]),
        "stat_2": unsigned_byte(stats[1]),
        "stat_3": unsigned_byte(stats[2]),
        "magnitude_1": unsigned_byte(stages[0]),
        "magnitude_2": unsigned_byte(stages[1]),
        "magnitude_3": unsigned_byte(stages[2]),
        "stat_chance_1": unsigned_byte(chances[0]),
        "stat_chance_2": unsigned_byte(chances[1]),
        "stat_chance_3": unsigned_byte(chances[2]),
        "flag": scalar("Padding"),
        "properties": scalar("Flags"),
    }
    return [values[field] for field in REFERENCE_FIELDS]


def main() -> None:
    args = parse_args()
    source = args.source.resolve()
    move_dir = source / "data/pml/moves"
    move_paths = sorted((path for path in move_dir.glob("*.toml") if path.stem.isdigit()), key=lambda path: int(path.stem))
    if not move_paths:
        raise SystemExit(f"No move TOML files found under {move_dir}")

    enums = read_enums(source)
    moves: list[list[int] | None] = [None] * (int(move_paths[-1].stem) + 1)
    for path in move_paths:
        document = tomllib.loads(path.read_text())
        moves[int(path.stem)] = build_record(next(iter(document.values())), enums)

    lines = [
        "{",
        '  "source": "White2Upgrade-Original/data/pml/moves",',
        f'  "fields": {json.dumps(REFERENCE_FIELDS, separators=(",", ":"))},',
        '  "moves": [',
        *[f"    {json.dumps(move, separators=(',', ':'))}{',' if index < len(moves) - 1 else ''}" for index, move in enumerate(moves)],
        "  ]",
        "}",
        "",
    ]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines))
    print(f"Wrote {len(moves)} move records to {args.output}")


if __name__ == "__main__":
    main()
