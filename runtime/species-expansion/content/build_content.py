"""Build the species expansion content package: species 650-1023 (national numbers) for Black 2 / White 2.

    python3 runtime/species-expansion/content/build_content.py --w2u <White2Upgrade-w2-integration>

Sources (the user's own projects):
- White2Upgrade `data/pml`: each species' personal record, level-up learnset and evolutions (its base form, record =
  national number; the records are numbered by `data/pml/meson.build`). White2Upgrade's evolution methods 1-27 are
  retail's; a target past the package (> 1023) is left out.
- White2Upgrade `data/text/system`: species names (90), move names (403), ability names (374) and descriptions (375),
  and the Pokédex's texts: description (442), height (451), category (464) and weight (471), by national number.
- Pokeweb's PWAN library (src/assets/pwan/library/manifest.json): each species' "base species" entry (sprites, icon).

Each species also gets:
- a placeholder cry: the retail species (1-649) of the same primary type and evolution stage whose base stat total is
  closest (Pokeweb has no cry import yet);
- its baby species: the first species of its evolution line;
- `restricted`: legendary or mythical (PokeAPI's is_legendary / is_mythical): battle rules that ban retail's
  legendaries ban these too. Ultra Beasts and Paradox Pokémon are not restricted. `mythical`: left out of the
  national Pokédex's completion, as retail's mythical species are.

Writes src/assets/data/speciesExpansion.json. Pokeweb numbers a species national + 37 in the ROM (687 onwards).
"""
import argparse
import json
import re
import tomllib
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
LIBRARY = REPO / "src/assets/pwan/library/manifest.json"
OUT = REPO / "src/assets/data/speciesExpansion.json"
FIRST, LAST = 650, 1023
LAST_RETAIL = 649
LAST_MOVE = 559
LAST_ABILITY = 164
LAST_ITEM = 638
# Legendary and mythical Pokémon from 650 onwards (PokeAPI's is_legendary / is_mythical).
RESTRICTED = {716, 717, 718, 719, 720, 721, 772, 773, *range(785, 793), 800, 801, 802, 807, 808, 809, 888, 889, 890,
              891, 892, 893, 894, 895, 896, 897, 898, 905, 1001, 1002, 1003, 1004, 1007, 1008, 1014, 1015, 1016, 1017,
              1024, 1025}
MYTHICAL = {719, 720, 721, 801, 802, 807, 808, 809, 893, 1025}
TYPES = ["NORMAL", "FIGHTING", "FLYING", "POISON", "GROUND", "ROCK", "BUG", "GHOST", "STEEL", "FIRE", "WATER", "GRASS",
         "ELECTRIC", "PSYCHIC", "ICE", "DRAGON", "DARK", "FAIRY"]


def toml(path):
    return next(iter(tomllib.loads(path.read_text()).values()))


def text_bank(path):
    out = {}
    for m in re.finditer(r"\[msg\.section_0\.entries\.(\d+)\]\s*text = \[(.*?)\]", path.read_text(), re.S):
        lines = re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(2))
        out[int(m.group(1))] = "".join(lines).removesuffix("$").replace("\\\\n", "\\n").replace('\\"', '"')
    return out


def u32(value):
    return value & 0xFFFFFFFF


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--w2u", required=True, type=Path)
    args = parser.parse_args()
    pml = args.w2u / "data/pml"
    meson = (pml / "meson.build").read_text()
    folders = [p.split("/")[0] for p in re.findall(r"'([^']+)'", re.search(r"personal_sources = \[(.*?)\]", meson, re.S).group(1))]
    species_of = {next(iter(tomllib.loads((pml / folders[n] / "personal.toml").read_text()))): n for n in range(1, LAST + 1)}
    move_ids = {path.read_text().split("\n", 1)[0].strip("[]"): int(path.stem) for path in (pml / "moves").glob("*.toml")}
    text = args.w2u / "data/text/system"
    names, move_names = text_bank(text / "90.toml"), text_bank(text / "403.toml")
    ability_names, ability_descriptions = text_bank(text / "374.toml"), text_bank(text / "375.toml")
    dex_banks = {key: text_bank(text / f"{bank}.toml") for key, bank in
                 (("description", 442), ("height", 451), ("category", 464), ("weight", 471))}
    personal = {n: toml(pml / folders[n] / "personal.toml") for n in range(1, LAST + 1)}

    previous = {}
    for n in range(1, LAST + 1):
        for row in toml(pml / folders[n] / "evolutions.toml").values():
            target = species_of.get(row["Target Species"]) if isinstance(row, dict) else None
            if target and row["Method"] != "METHOD_NONE":
                previous.setdefault(target, n)

    def root(n):
        while n in previous:
            n = previous[n]
        return n

    def bst(p):
        return sum(p[k] for k in ("Base HP", "Base Attack", "Base Defense", "Base Speed", "Base Special Attack", "Base Special Defense"))

    def cry(n):
        p = personal[n]
        pool = [s for s in range(1, LAST_RETAIL + 1) if personal[s]["Primary Type"] == p["Primary Type"]
                and personal[s]["Evolution Stage"] == p["Evolution Stage"]] or \
               [s for s in range(1, LAST_RETAIL + 1) if personal[s]["Primary Type"] == p["Primary Type"]]
        return min(pool, key=lambda s: (abs(bst(personal[s]) - bst(p)), s))

    library = json.loads(LIBRARY.read_text())
    entries = {e["speciesId"]: e for e in library["entries"] if e["kind"] == "base species" and FIRST <= e["speciesId"] <= LAST}
    # Minior's form 0 (Red Meteor) is an "alternate form" entry; Goodra has none yet (its previous stage's stands in).
    for e in library["entries"]:
        if e["kind"] == "alternate form" and e.get("formIndex") == 0 and FIRST <= e["speciesId"] <= LAST:
            entries.setdefault(e["speciesId"], e)
    stand_ins = {}
    for n in range(FIRST, LAST + 1):
        if n not in entries and previous.get(n) in entries:
            entries[n] = entries[previous[n]]
            stand_ins[n] = previous[n]
    out = []
    for n in range(FIRST, LAST + 1):
        p = personal[n]
        entry = entries.get(n)
        abilities = [p["Primary Ability"], p["Secondary Ability"], p["Hidden Ability"]]
        learnset = []
        for row in toml(pml / folders[n] / "learnset.toml").values():
            if not isinstance(row, dict) or row["MOVE"] == 65535:
                continue
            move = move_ids[row["MOVE"]]
            learnset.append([row["LEVEL"], move] + ([move_names[move]] if move > LAST_MOVE else []))
        evolutions = []
        for row in toml(pml / folders[n] / "evolutions.toml").values():
            if not isinstance(row, dict) or row["Method"] == "METHOD_NONE":
                continue
            target = species_of.get(row["Target Species"])
            if target is None:
                continue
            param = row["Parameter"]
            evo = {"method": METHODS[row["Method"]], "param": param, "species": target}
            if row["Method"] == "METHOD_LEVELUP_MOVE":
                param = move_ids.get(param, param) if isinstance(param, str) else param
                evo["param"] = param
                if param > LAST_MOVE:
                    evo["moveName"] = move_names[param]
            evolutions.append(evo)
        items = [p["Wild Item (50%)"], p["Wild Item (5%)"], p["Wild Item (1%)"]]
        out.append({
            "national": n,
            "name": names[n],
            "family": root(n),
            "library": entry["id"] if entry else None,
            **({"spriteStandIn": stand_ins[n]} if n in stand_ins else {}),
            "credits": {s["side"]: s["credits"] for s in (entry or {}).get("spriteSources", [])},
            "cry": cry(n),
            **({"restricted": True} if n in RESTRICTED else {}),
            **({"mythical": True} if n in MYTHICAL else {}),
            "personal": {
                "stats": [p["Base HP"], p["Base Attack"], p["Base Defense"], p["Base Speed"], p["Base Special Attack"],
                          p["Base Special Defense"]],
                "types": [TYPES.index(p["Primary Type"].removeprefix("TYPE_")), TYPES.index(p["Secondary Type"].removeprefix("TYPE_"))],
                "catchRate": p["Capture Rate"], "stage": p["Evolution Stage"], "evs": p["EV Yield"],
                "items": [item if item <= LAST_ITEM else 0 for item in items],
                "gender": p["Gender Probability"], "hatchCycles": p["Egg Happiness"], "happiness": p["Base Happiness"],
                "growth": p["Experience Group"], "eggGroups": [p["Egg Group 1"], p["Egg Group 2"]],
                "flee": p["Escape Rate"], "color": p["Color"], "baseExp": p["Base Experience"],
                "height": round(p["Height (cm)"] / 10), "weight": p["Weight (cg)"],
                "tm": [u32(p[f"TM HM {k}"]) for k in range(1, 5)],
                "typeTutors": u32(p["Type Tutors"]), "tutors": [u32(t) for t in p["Special Tutors"]],
            },
            "abilities": abilities,
            "abilityNames": {str(a): ability_names[a] for a in abilities if a > LAST_ABILITY},
            "abilityDescriptions": {str(a): ability_descriptions[a] for a in abilities if a > LAST_ABILITY},
            "learnset": learnset,
            "evolutions": evolutions,
            "dex": {key: bank.get(n, "") for key, bank in dex_banks.items()},
        })
    missing = [s["national"] for s in out if not s["library"]] + [f"{n} uses {m}'s" for n, m in stand_ins.items()]
    OUT.write_text(json.dumps({"format": "pokeweb-species-expansion-v1", "first": FIRST, "last": LAST,
                               "source": "White2Upgrade data/pml; PWAN library sprites and icons", "species": out},
                              indent=1, ensure_ascii=False) + "\n")
    print(f"{len(out)} species -> {OUT.relative_to(REPO)}; without library sprites: {missing}")


METHODS = {"METHOD_FRIENDSHIP": 1, "METHOD_FRIENDSHIP_DAY": 2, "METHOD_FRIENDSHIP_NIGHT": 3, "METHOD_LEVELUP": 4,
           "METHOD_TRADE": 5, "METHOD_TRADE_ITEM": 6, "METHOD_TRADE_MONS_SPECIFIC": 7, "METHOD_ITEM_USE": 8,
           "METHOD_LEVELUP_ATK_OVER_DEF": 9, "METHOD_LEVELUP_ATK_EQU_DEF": 10, "METHOD_LEVELUP_DEF_OVER_ATK": 11,
           "METHOD_LEVELUP_RANDOM_1": 12, "METHOD_LEVELUP_RANDOM_2": 13, "METHOD_LEVELUP_NINJASK": 14,
           "METHOD_LEVELUP_SHEDINJA": 15, "METHOD_BEAUTY": 16, "METHOD_ITEM_USE_MALE": 17, "METHOD_ITEM_USE_FEMALE": 18,
           "METHOD_ITEM_HELD_DAY": 19, "METHOD_ITEM_HELD_NIGHT": 20, "METHOD_LEVELUP_MOVE": 21,
           "METHOD_LEVELUP_PARTY_MEMBER": 22, "METHOD_LEVELUP_MALE": 23, "METHOD_LEVELUP_FEMALE": 24,
           "METHOD_LOCATION_ELEC": 25, "METHOD_LOCATION_MOSS": 26, "METHOD_LOCATION_ICE": 27}

if __name__ == "__main__":
    main()
