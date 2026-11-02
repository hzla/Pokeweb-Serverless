"""Generate classification facts from an explicit pokeemerald-expansion checkout."""
import json
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
output = Path(__file__).resolve().parents[2] / "src/assets/data/abilityMoveClassesExpanded.json"
expansion = json.loads((output.parent / "white2upgradeMoveExpansion.json").read_text())
text = (root / "src/data/moves_info.h").read_text()
records = list(re.finditer(r"\[(MOVE_[A-Z0-9_]+)\]\s*=\s*\{", text))
normalize = lambda name: re.sub(r"[^A-Z0-9]", "", name.upper().removeprefix("MOVE_"))
fields = ["bitingMove", "pulseMove", "ballisticMove", "slicingMove", "powderMove", "windMove", "healingMove"]
flags = {}
for index, match in enumerate(records):
    body = text[match.end():records[index + 1].start() if index + 1 < len(records) else len(text)]
    mask = 0
    for bit, field in enumerate(fields):
        value = re.search(r"\." + field + r"\s*=\s*([^,\n]+)", body)
        if value:
            # These seven flags use literals, or the reviewed modern healing
            # rule. Extrapolated flags are not automatically assumed.
            expression = value[1].strip()
            if expression == "TRUE" or expression == "B_HEAL_BLOCKING >= GEN_6" or re.fullmatch(r"B_UPDATED_MOVE_FLAGS >= GEN_[6-9]", expression): mask |= 1 << bit
            elif expression not in ["FALSE", "B_EXTRAPOLATED_MOVE_FLAGS"]: raise ValueError((match[1], field, expression))
    flags[normalize(match[1])] = mask
rows = []
for move in expansion["moves"]:
    name = normalize(move["name"])
    if name not in flags: raise ValueError("Missing move classification: " + move["name"])
    rows.append([move["sourceId"], move["name"], flags[name]])
output.write_text(json.dumps({"version": 1, "moves": rows}, separators=(",", ":")) + "\n")
print(f"{len(rows)} expanded moves classified; {sum(bool(row[2]) for row in rows)} have supplemental flags.")
