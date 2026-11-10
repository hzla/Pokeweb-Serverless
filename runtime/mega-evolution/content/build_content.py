"""Build the Mega Evolution content package (forms, Mega Stones, sprites, icons, animation, credits).

    python3 runtime/mega-evolution/content/build_content.py \
        --pokebw2-res <pokebw2>/res/w2u --identities <item_identities.json> \
        --w2u <White2Upgrade-w2-integration> --w2u-icons <dir from extract_w2u_icons.py>

Sources (all from the user's own projects):
- pokebw2 `res/w2u/mega_roster.json` (forms: stats, types, abilities, height, weight; only species 1-649 are used),
  `item_identities.json` (Mega Stone IDs 657-780 and names), `ability_text.json` (names of abilities above 164),
  `content_credits.json` (per-side sprite credits).
- Pokeweb's PWAN library (`src/assets/pwan/library/manifest.json`): animated sprites and icons for the Megas it has.
- White2Upgrade: `assets/pokeweb_pwan/<asset>_<side>.pwan` for the Megas or sides the library lacks (credited
  "Unknown"), their icons from the built ROM's `a/0/0/7` (extract_w2u_icons.py), `assets/item_icons` (Mega Stone
  icons), and Hibiki's transformation animation (`data/graphics/move_animations/5_00000622.bin` + the SPAs it loads).

Writes src/assets/data/megaContent.json and src/assets/mega/megaContent.zip.
"""
import argparse
import hashlib
import json
import zipfile
from pathlib import Path

from PIL import Image  # pip install pillow

REPO = Path(__file__).resolve().parents[3]
LIBRARY = REPO / "src/assets/pwan/library/manifest.json"
OUT_JSON = REPO / "src/assets/data/megaContent.json"
OUT_ZIP = REPO / "src/assets/mega/megaContent.zip"
MAX_SPECIES = 649
# White2Upgrade asset indices of the Megas the PWAN library does not carry (no credit record upstream).
SUPPLEMENT_ASSETS = {
    "MEGA_VENUSAUR": 724, "MEGA_BLASTOISE": 727, "MEGA_AERODACTYL": 742, "MEGA_SCEPTILE": 778,
    "MEGA_SHARPEDO": 787, "MEGA_CAMERUPT": 788, "MEGA_METAGROSS": 797,
}
ANIMATION_SCRIPT = 622
UNKNOWN = "Unknown"


def load(path):
    return json.loads(Path(path).read_text())


def icon_rgba(path):
    """A 24x24 item icon, centred on the 32x32 item sprite canvas, as raw RGBA."""
    icon = Image.open(path).convert("RGBA")
    canvas = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    canvas.paste(icon, ((32 - icon.width) // 2, (32 - icon.height) // 2))
    return canvas.tobytes()


def stone_description(base_name):
    return f"One of the mysterious Mega Stones.\\nHave {base_name} hold it, and it\\ncan Mega Evolve in battle."


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pokebw2-res", required=True, type=Path)
    parser.add_argument("--identities", type=Path, help="item_identities.json (defaults to --pokebw2-res)")
    parser.add_argument("--w2u", required=True, type=Path)
    parser.add_argument("--w2u-icons", required=True, type=Path)
    args = parser.parse_args()

    roster = load(args.pokebw2_res / "mega_roster.json")
    identities = load(args.identities or args.pokebw2_res / "item_identities.json")
    ability_text = {a["id"]: a for a in load(args.pokebw2_res / "ability_text.json")["abilities"]}
    credits = {(e["species"], e["form"]): e for e in load(args.pokebw2_res / "content_credits.json")["entries"]}
    library = load(LIBRARY)
    library_by_key = {e["key"]: e for e in library["entries"] if e.get("key")}
    bases = {b["species"]: b for b in roster["bases"]}
    stone_for = {form_key: item for item in identities["items"] if item["kind"] == "stone" for form_key in item["forms"]}

    zip_files = {}
    forms, stones = [], {}
    for form in roster["forms"]:
        if form["species"] > MAX_SPECIES:
            continue
        key = form["key"]
        base = bases[form["species"]]
        trigger = form["trigger"]
        entry = {
            "key": key,
            "name": form["name"],
            "species": form["species"],
            "baseName": base["name"],
            "stats": form["stats"],
            "types": form["types"],
            "abilities": form["intendedAbilities"],
            "abilityNames": {str(a): ability_text[a]["name"] for a in form["intendedAbilities"] if a in ability_text},
            "abilityDescriptions": {str(a): ability_text[a]["description"] for a in form["intendedAbilities"] if a in ability_text},
            "height": form["height"],
            "weight": form["weight"],
        }
        if "move" in trigger:
            entry["move"] = {"id": trigger["move"], "name": "Dragon Ascent"}
        else:
            stone = stone_for[key]
            entry["stone"] = stone["id"]
            stones.setdefault(stone["id"], {"id": stone["id"], "key": stone["key"], "name": stone["name"], "forms": [],
                                            "description": stone_description(base["name"])})["forms"].append(key)
        side_credits = {s["side"]: s["credits"] for s in credits.get((form["species"], form["form"]), {}).get("sides", [])}
        lib = library_by_key.get(key)
        sprites = {}
        if lib:
            entry["library"] = lib["id"]
            lib_sides = {s["side"]: s["credits"] for s in lib.get("spriteSources", [])}
            for side in ("front", "back"):
                if lib["hasFront" if side == "front" else "hasBack"]:
                    sprites[side] = {"source": "library", "credits": lib_sides.get(side) or side_credits.get(side) or lib["credits"]}
            asset = lib["assetIndex"]
        else:
            asset = SUPPLEMENT_ASSETS[key]
            for k in (0, 1):
                zip_files[f"icons/{asset}_{k}.bin"] = (args.w2u_icons / f"{asset}_{k}.bin").read_bytes()
            palettes = (args.w2u_icons / "pokeicon_palette_map.bin").read_bytes()[asset]
            entry["icon"] = {"male": f"icons/{asset}_0.bin", "female": f"icons/{asset}_1.bin",
                             "malePaletteId": palettes & 15, "femalePaletteId": palettes >> 4}
        for side in ("front", "back"):
            if side in sprites:
                continue
            path = args.w2u / "assets/pokeweb_pwan" / f"{asset}_{side}.pwan"
            if path.exists():
                name = f"pwan/{asset}_{side}.pwan"
                zip_files[name] = path.read_bytes()
                sprites[side] = {"source": name, "credits": side_credits.get(side) or UNKNOWN}
        entry["sprites"] = sprites
        forms.append(entry)

    icon_dir = args.w2u / "assets/item_icons/icons"
    for stone in stones.values():
        png = icon_dir / f"{stone['key'].lower()}.png"
        if png.exists():
            zip_files[f"items/{png.stem}.rgba"] = icon_rgba(png)
            stone["icon"] = f"items/{png.stem}.rgba"
    # Stones without their own icon (the Legends Z-A ones) use the Mega Ring's.
    generic = "items/mega_ring.rgba"
    zip_files[generic] = icon_rgba(icon_dir / "mega_ring.png")

    animation = args.w2u / "data/graphics/move_animations" / f"5_{ANIMATION_SCRIPT:08d}.bin"
    zip_files["animation/script.bin"] = animation.read_bytes()
    particles = [765, 767, 770, 771, 783]
    for particle in particles:
        zip_files[f"animation/spa_{particle}.bin"] = (args.w2u / "data/graphics/move_spas" / f"6_{particle:08d}.bin").read_bytes()

    OUT_ZIP.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUT_ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(zip_files):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, zip_files[name])
    content = {
        "format": "pokeweb-mega-content-v1",
        "credits": [
            {"name": "Dararo", "role": "Original Mega Evolution implementation"},
            {"name": "Hibiki", "role": "Battle UI and transformation animation"},
        ],
        "animation": {"script": "animation/script.bin", "particles": {str(p): f"animation/spa_{p}.bin" for p in particles},
                      "revealFrame": 244},
        "genericStoneIcon": generic,
        "forms": forms,
        "stones": sorted(stones.values(), key=lambda s: s["id"]),
        "zipSha256": hashlib.sha256(OUT_ZIP.read_bytes()).hexdigest(),
    }
    OUT_JSON.write_text(json.dumps(content, indent=1, ensure_ascii=False) + "\n")
    unknown = sorted({f["name"] for f in forms for s in f["sprites"].values() if s["credits"] == UNKNOWN})
    print(f"{len(forms)} forms, {len(stones)} stones, zip {OUT_ZIP.stat().st_size} bytes; Unknown credits: {', '.join(unknown)}")


if __name__ == "__main__":
    main()
