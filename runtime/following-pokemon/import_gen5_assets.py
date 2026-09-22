"""Build the White 2 Gen 5 follower bundle from hg-engine overworld sheets.

The source repository and ROM are read only. Output ordering is deterministic:
source graphic number, then normal/shiny palette, followed by sorted appearance
keys in the manifest.
"""
import argparse
import hashlib
import json
import re
import struct
from pathlib import Path

import ndspy.narc
import ndspy.rom
import ndspy.texture
from PIL import Image


def sentinel_magenta(color):
    return color[0] >= 248 and color[1] <= 8 and color[2] >= 248


def palette_colors(path):
    lines = path.read_text().splitlines()
    if lines[:2] != ["JASC-PAL", "0100"] or int(lines[2]) != 16:
        raise ValueError(f"Expected 16-color JASC palette: {path}")
    colors = [tuple(map(int, line.split())) for line in lines[3:19]]
    if len(colors) != 16 or any(len(c) != 3 or any(v < 0 or v > 255 for v in c) for c in colors):
        raise ValueError(f"Invalid palette: {path}")
    return colors


def palette(path, normal_path, used_indices, shiny):
    colors = palette_colors(path)
    repairs = []
    if shiny:
        normal = palette_colors(normal_path)
        for index in sorted(used_indices):
            if sentinel_magenta(colors[index]):
                colors[index] = normal[index]
                repairs.append(index)
    remaining = sorted(index for index in used_indices if sentinel_magenta(colors[index]))
    if remaining:
        raise ValueError(f"Visible sentinel-magenta palette entries in {path}: {remaining}")
    packed = struct.pack("<16H", *[(r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10) for r, g, b in colors])
    return packed, repairs


def resource(overworlds, gfx, shiny):
    stem = f"{gfx:04}"
    image = Image.open(overworlds / f"{stem}.png")
    metadata = json.loads((overworlds / f"{stem}.json").read_text())
    if image.mode != "P" or image.width not in (32, 64) or image.height != image.width * 8:
        raise ValueError(f"Unsupported follower sheet {stem}: {image.mode} {image.size}")
    records = list(metadata["frames"].values())
    if len(records) != 8 or [r["frame"] for r in records] != list(range(8)):
        raise ValueError(f"Unexpected frame metadata: {stem}")
    size = image.width
    # Source and White 2 controller order are both up, down, left, right.
    # Large sprites use the native mirrored side pair.
    indices = list(range(8)) if size == 32 else list(range(6))
    pixels = list(image.get_flattened_data() if hasattr(image, "get_flattened_data") else image.getdata())
    if max(pixels) >= 16:
        raise ValueError(f"Follower sheet exceeds I4 indices: {stem}")
    btx = ndspy.texture.NSBTX()
    exponent = {32: 2, 64: 3}[size]
    params = (exponent << 4) | (exponent << 7) | (3 << 10) | 0x2000
    frame_pixels = size * size
    for output, source in enumerate(indices):
        frame = pixels[source * frame_pixels:(source + 1) * frame_pixels]
        data = bytes(frame[i] | frame[i + 1] << 4 for i in range(0, len(frame), 2))
        btx.textures.append((f"following{output}", ndspy.texture.Texture(0, 0, params, size | size << 11, data, b"")))
    used_indices = {index for source in indices for index in pixels[source * frame_pixels:(source + 1) * frame_pixels]}
    used_indices.discard(0)  # The texture controller makes palette index zero transparent.
    pal, repairs = palette(overworlds / f"{stem}-tsure_poke{int(shiny)}.pal",
                           overworlds / f"{stem}-tsure_poke0.pal", used_indices, shiny)
    btx.palettes = [("following", ndspy.texture.Palette(0, 0, 0, pal))]
    return btx.save(), size, "pokemon-asymmetric" if size == 32 else "pokemon-mirrored", indices, repairs


def parse_sources(root):
    constants = {name: int(value) for name, value in re.findall(
        r"#define\s+SPECIES_([A-Z0-9_]+)\s+(\d+)",
        (root / "include/constants/species.h").read_text())}
    bases = {name: int(value) for name, value in re.findall(
        r"\[SPECIES_([A-Z0-9_]+)\s*\]\s*=\s*(\d+)",
        (root / "data/SpeciesToOWGfx.c").read_text())}
    tags = {int(tag): int(gfx) for tag, gfx in re.findall(
        r"\.tag\s*=\s*(\d+),\s*\.gfx\s*=\s*(\d+)",
        (root / "src/field/overworld_table.c").read_text())}
    return constants, bases, tags


SPECIAL_FORMS = {
    "BASCULIN": lambda tag, tags: [tags[tag], tags[tag + 1]],
    "DARMANITAN": lambda tag, tags: [tags[tag], tags[tag + 2]],
    "DEERLING": lambda tag, tags: [tags[tag + i] for i in range(4)],
    "SAWSBUCK": lambda tag, tags: [tags[tag + i] for i in range(4)],
    "TORNADUS": lambda tag, tags: [tags[tag], tags[tag + 1]],
    "THUNDURUS": lambda tag, tags: [tags[tag], tags[tag + 1]],
    "LANDORUS": lambda tag, tags: [tags[tag], tags[tag + 1]],
    "KYUREM": lambda tag, tags: [tags[tag], 1290, 1291],
    "KELDEO": lambda tag, tags: [tags[tag], 1357],
    "MELOETTA": lambda tag, tags: [tags[tag], tags[tag + 1]],
    "GENESECT": lambda tag, tags: [tags[tag]] * 5,
}
FEMALE_GFX = {"UNFEZANT", "FRILLISH", "JELLICENT"}


def build(rom_path, engine_root, output):
    rom = ndspy.rom.NintendoDSRom.fromFile(rom_path)
    personal = ndspy.narc.NARC(rom.getFileByName("a/0/1/6")).files
    names = (Path(__file__).parents[2] / "src/assets/data/vanilla_pokedex.txt").read_text().splitlines()
    constants, bases, tags = parse_sources(engine_root)
    overworlds = engine_root / "data/graphics/overworlds"
    mapped = []
    for species in range(494, 650):
        name = re.sub(r"[^A-Z0-9]+", "_", names[species].upper()).strip("_")
        internal = constants[name]
        tag = bases[name] + (0x1E4 if internal > constants["SNOVER"] else 0x1AC)
        forms = max(1, personal[species][32])
        graphics = SPECIAL_FORMS.get(name, lambda value, table: [table[value]])(tag, tags)
        if len(graphics) != forms:
            raise ValueError(f"Form mapping mismatch for {species} {name}: {forms} vs {graphics}")
        ratio = personal[species][18]
        genders = [2] if ratio == 255 else [1] if ratio == 254 else [0] if ratio == 0 else [0, 1]
        for form, base_gfx in enumerate(graphics):
            for gender in genders:
                gfx = tags[tag + 1] if name in FEMALE_GFX and gender == 1 else base_gfx
                for shiny in (False, True):
                    mapped.append({"species": species, "form": form, "gender": gender, "shiny": shiny, "gfx": gfx})
    unique = sorted({(entry["gfx"], entry["shiny"]) for entry in mapped})
    resources = []
    resource_rows = []
    members = {}
    for gfx, shiny in unique:
        data, size, profile, indices, repairs = resource(overworlds, gfx, shiny)
        member = len(resources)
        resources.append(data)
        members[(gfx, shiny)] = (member, size, profile)
        resource_rows.append({"member": member, "gfx": gfx, "shiny": shiny, "size": size,
                              "profile": profile, "sourceFrameIndices": indices,
                              "paletteRepairs": repairs,
                              "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    for entry in mapped:
        member, size, profile = members[(entry.pop("gfx"), entry["shiny"])]
        entry.update(member=member, size=size, profile=profile)
    archive = ndspy.narc.NARC()
    archive.files = resources
    archive_bytes = archive.save()
    output.mkdir(parents=True, exist_ok=True)
    (output / "gen5-followers.narc").write_bytes(archive_bytes)
    manifest = {"schemaVersion": 1, "speciesMin": 494, "speciesMax": 649,
                "appearances": mapped, "resources": resource_rows,
                "archiveSha256": hashlib.sha256(archive_bytes).hexdigest()}
    (output / "gen5-followers.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Generated {len(mapped)} Gen 5 appearances using {len(resources)} normal/shiny resources ({len(archive_bytes)} bytes).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rom", type=Path)
    parser.add_argument("engine", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).parents[2] / "src/assets/following")
    args = parser.parse_args()
    build(args.rom, args.engine, args.output)
