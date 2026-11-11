#!/usr/bin/env python3
"""Give White's battle-code signatures the Fairy-patch variants Black's have.

    python3 runtime/fairy-bw1/white_binding_variants.py

The ability and move effect runtimes find the battle functions they hook by signature (abilityBindings{B,W}1.json,
moveRecipeBindings{B,W}1.json). Black's carry a second variant for each function the Fairy patch edits (type 17 -> 18
tests, the moved move-handler table's count). White's had none, so on a White ROM with the Fairy patch those
functions were "missing or ambiguous". The two games' signatures are the same code: they differ only in masked-out
(relocated) bytes. White's variant is White's own signature with Black's variant's changed bytes; each changed byte
must be checked by the mask and equal in both games' base signatures, so it is not a relocated word.
"""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / "src/assets/data"
PAIRS = [("abilityBindingsB1.json", "abilityBindingsW1.json"), ("moveRecipeBindingsB1.json", "moveRecipeBindingsW1.json")]


def white_variant(black, black_variant, white):
    bh, bm = bytes.fromhex(black["hex"]), bytes.fromhex(black["mask"])
    vh, vm = bytes.fromhex(black_variant["hex"]), bytes.fromhex(black_variant["mask"])
    wh, wm = bytes.fromhex(white["hex"]), bytes.fromhex(white["mask"])
    assert len(bh) == len(wh) == len(vh) and bm == wm == vm, "same code, same mask"
    out = bytearray(wh)
    for i, (base, variant) in enumerate(zip(bh, vh)):
        if base == variant:
            continue
        assert vm[i] == 0xFF and bh[i] == wh[i], f"byte {i} is not a plain code byte"
        out[i] = variant
    return {"hex": out.hex(), "mask": white["mask"]}


def main():
    for black_name, white_name in PAIRS:
        black = json.loads((DATA / black_name).read_text())
        path = DATA / white_name
        text = path.read_text()
        white = json.loads(text)
        added = 0
        for name, signature in black["functions"].items():
            if not signature.get("variants"):
                continue
            target = white["functions"][name]
            target["variants"] = [white_variant(signature, variant, target) for variant in signature["variants"]]
            added += 1
        path.write_text(json.dumps(white, separators=(",", ":"), ensure_ascii=False) + "\n")  # as stored
        print(white_name, added, "functions with the Fairy variant")


if __name__ == "__main__":
    main()
