"""Build the regional forms content package: the Alolan, Galarian, Hisuian and Paldean forms of species 1-649.

    python3 runtime/regional-forms/content/build_content.py --w2u <White2Upgrade-w2-integration>

Sources (the user's own projects):
- White2Upgrade `data/pml`: each form's personal record (stats, types, abilities, held items, gender, egg data,
  colour, height, weight, TM and tutor compatibility; White2Upgrade keeps retail's TM and tutor layouts for species
  1-649), level-up learnset and evolutions, and `evolution_forms.bin` (the form an evolution gives). A species' form n
  is record `Form Data Offset + n - 1` of its base record; the records are numbered by `data/pml/meson.build`.
- White2Upgrade `data/text/system`: move names (403), ability names (374) and descriptions (375), for the moves and
  abilities newer than Gen 5.
- Pokeweb's PWAN library (src/assets/pwan/library/manifest.json): which forms there are (its "regional form" entries
  of species 1-649, by White2Upgrade's species and form numbers), their names, animated sprites and icons.

Evolutions: a target newer than Gen 5 (Perrserker, Sirfetch'd, Obstagoon ...) is left out, so that form does not
evolve. White2Upgrade's stand-ins for the Ice Stone (Alolan Vulpix and Sandshrew, Galarian Darumaka) are replaced by
the base species' own method; its Galarica stand-ins already are Slowpoke's. A target is the evolved species' regional
form when it has one (evolution_forms.bin, else the same form number), else the species.

Galarian Darmanitan keeps Zen Mode: the installer adds a battle runtime (runtime/regional-forms/build.py) that makes
Zen Mode switch it between its Galarian forms.

Writes src/assets/data/regionalForms.json.
"""
import argparse
import json
import re
import struct
import tomllib
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
LIBRARY = REPO / "src/assets/pwan/library/manifest.json"
OUT = REPO / "src/assets/data/regionalForms.json"
LAST_SPECIES = 649
LAST_MOVE = 559
LAST_ABILITY = 164
LAST_ITEM = 638
TYPES = ["NORMAL", "FIGHTING", "FLYING", "POISON", "GROUND", "ROCK", "BUG", "GHOST", "STEEL", "FIRE", "WATER", "GRASS",
         "ELECTRIC", "PSYCHIC", "ICE", "DRAGON", "DARK", "FAIRY"]
METHODS = {"METHOD_FRIENDSHIP": 1, "METHOD_LEVELUP": 4, "METHOD_TRADE": 5, "METHOD_TRADE_ITEM": 6, "METHOD_ITEM_USE": 8,
           "METHOD_ITEM_HELD_DAY": 19, "METHOD_ITEM_HELD_NIGHT": 20, "METHOD_LEVELUP_MOVE": 21}
# Forms whose evolution needs the Ice Stone (White2Upgrade used the Water Stone): the base species' method instead.
BASE_METHOD = {"REGIONAL_ALOLA_VULPIX", "REGIONAL_ALOLA_SANDSHREW", "REGIONAL_GALAR_DARUMAKA"}
REGIONS = {"ALOLA": "Alola", "GALAR": "Galar", "HISUI": "Hisui", "PALDEA": "Paldea"}


def toml(path):
    return next(iter(tomllib.loads(path.read_text()).values()))


def text_bank(path):
    """A White2Upgrade text bank: entry -> text (the lines joined, the trailing $ dropped)."""
    out = {}
    for m in re.finditer(r"\[msg\.section_0\.entries\.(\d+)\]\s*text = \[(.*?)\]", path.read_text(), re.S):
        lines = re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(2))
        out[int(m.group(1))] = "".join(lines).removesuffix("$").replace("\\\\n", "\\n")
    return out


def u32(value):
    return value & 0xFFFFFFFF


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--w2u", required=True, type=Path)
    args = parser.parse_args()
    pml = args.w2u / "data/pml"
    meson = (pml / "meson.build").read_text()

    def listing(name):
        return re.findall(r"'([^']+)'", re.search(name + r" = \[(.*?)\]", meson, re.S).group(1))
    folders = [path.split("/")[0] for path in listing("personal_sources")]
    species_of = {}  # SPECIES_X -> species ID
    for record, folder in enumerate(folders[:LAST_SPECIES + 1]):
        species_of[next(iter(tomllib.loads((pml / folder / "personal.toml").read_text())))] = record
    move_ids = {}
    for path in (pml / "moves").glob("*.toml"):
        move_ids[path.read_text().split("\n", 1)[0].strip("[]")] = int(path.stem)
    move_names = text_bank(args.w2u / "data/text/system/403.toml")
    ability_names = text_bank(args.w2u / "data/text/system/374.toml")
    ability_descriptions = text_bank(args.w2u / "data/text/system/375.toml")
    table = {}
    blob = (pml / "evolution_forms.bin").read_bytes()
    for at in range(0, len(blob), 8):
        species, new_species, form, new_form, _ = struct.unpack_from("<HHBBH", blob, at)
        if not species:
            break
        table[(species, form, new_species)] = new_form

    def record_of(species, form):
        if form == 0:
            return species
        return toml(pml / folders[species] / "personal.toml")["Form Data Offset"] + form - 1

    # Families: the first stage of each species' evolution line (species 1-649, base forms).
    previous = {}
    for species in range(1, LAST_SPECIES + 1):
        for row in toml(pml / folders[species] / "evolutions.toml").values():
            target = species_of.get(row["Target Species"]) if isinstance(row, dict) else None
            if target and target <= LAST_SPECIES and row["Method"] != "METHOD_NONE":
                previous.setdefault(target, species)

    def family(species):
        while species in previous:
            species = previous[species]
        return species

    library = json.loads(LIBRARY.read_text())
    entries = sorted((e for e in library["entries"] if e["kind"] == "regional form" and e["speciesId"] <= LAST_SPECIES),
                     key=lambda e: (e["speciesId"], e["formIndex"]))
    by_form = {(e["speciesId"], e["formIndex"]): e for e in entries}

    def evolutions(entry, record):
        rows = []
        source = record
        if entry["key"] in BASE_METHOD:
            source = entry["speciesId"]  # the base species' record
        for row in toml(pml / folders[source] / "evolutions.toml").values():
            if not isinstance(row, dict) or row["Method"] == "METHOD_NONE":
                continue
            target = species_of.get(row["Target Species"])
            if target is None or target > LAST_SPECIES:
                continue
            form = table.get((entry["speciesId"], entry["formIndex"], target), entry["formIndex"])
            regional = by_form.get((target, form))
            method = METHODS[row["Method"]]
            rows.append({"method": method, "param": row["Parameter"], "species": target,
                         **({"form": regional["key"]} if regional else {})})
        return rows

    forms = []
    for entry in entries:
        record = record_of(entry["speciesId"], entry["formIndex"])
        p = toml(pml / folders[record] / "personal.toml")
        abilities = [p["Primary Ability"], p["Secondary Ability"], p["Hidden Ability"]]
        learnset = []
        for row in toml(pml / folders[record] / "learnset.toml").values():
            if not isinstance(row, dict) or row["MOVE"] == 65535:
                continue
            move = move_ids[row["MOVE"]]
            learnset.append([row["LEVEL"], move] + ([move_names[move]] if move > LAST_MOVE else []))
        region = REGIONS[entry["key"].split("_")[1]]
        # Showdown-style form names: the region, then a breed or mode ("Paldea-Combat", "Galar-Zen").
        extra = re.search(r"(\w+) (?:Breed|Mode)$", entry["name"])
        suffix = region + (f"-{extra.group(1)}" if extra else "")
        items = [p["Wild Item (50%)"], p["Wild Item (5%)"], p["Wild Item (1%)"]]
        forms.append({
            "key": entry["key"],
            "name": entry["name"],
            "species": entry["speciesId"],
            "family": family(entry["speciesId"]),
            "w2uForm": entry["formIndex"],
            "suffix": suffix,
            "library": entry["id"],
            "credits": {s["side"]: s["credits"] for s in entry.get("spriteSources", [])},
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
                "tm": [u32(p[f"TM HM {n}"]) for n in range(1, 5)],
                "typeTutors": u32(p["Type Tutors"]), "tutors": [u32(t) for t in p["Special Tutors"]],
            },
            "abilities": abilities,
            "abilityNames": {str(a): ability_names[a] for a in abilities if a > LAST_ABILITY},
            "abilityDescriptions": {str(a): ability_descriptions[a] for a in abilities if a > LAST_ABILITY},
            "learnset": learnset,
            "evolutions": evolutions(entry, record),
        })
    out = {"format": "pokeweb-regional-forms-v1", "source": "White2Upgrade data/pml; PWAN library sprites and icons",
           "forms": forms}
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"{len(forms)} forms -> {OUT.relative_to(REPO)}")


if __name__ == "__main__":
    main()
