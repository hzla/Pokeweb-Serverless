"""Build profile-specific White 2 ROM-resident Surf appearance catalogs."""
import argparse
import hashlib
import json
import re
import struct
import zlib
from collections import Counter
from pathlib import Path

import ndspy.texture
from PIL import Image

HERE = Path(__file__).resolve().parent
WORKSPACE = HERE.parents[2]
SOURCE = WORKSPACE / "followersprites/Swimming/ARCEUS.png"
SOURCES = HERE / "surf-sources.json"
ASSETS = HERE.parents[1] / "src/assets/following"
OUTPUT = ASSETS / "surf-mounts.narc"
REGISTRY = ASSETS / "surf-registry.bin"
MANIFEST = ASSETS / "surf-mounts.json"
UPGRADE_ASSETS = ASSETS / "white2upgrade"
LATER_MANIFEST = UPGRADE_ASSETS / "later-followers.json"
NAMES = (HERE.parents[1] / "src/assets/data/vanilla_pokedex.txt").read_text().splitlines()
# Counts are the native BW2 personal-data form counts, including the base form.
FORM_COUNTS = {201: 28, 351: 4, 386: 4, 412: 3, 413: 3, 421: 2, 422: 2,
               423: 2, 479: 6, 487: 2, 492: 2, 493: 17, 550: 2, 555: 2,
               585: 4, 586: 4, 641: 2, 642: 2, 645: 2, 646: 3, 647: 2,
               648: 2, 649: 5}
FOLDERS = (("Swimming", 0), ("Levitates", 0), ("Swimming Shiny", 1), ("Levitates Shiny", 1))
ROWS = (3, 0, 1, 2)
KEY_ALIAS = {29: ("NIDORANFEMALEE", "NIDORANFE", "NIDORANF"),
             32: ("NIDORANMA", "NIDORANM")}


def _texture(frame: Image.Image, number: int, colors: list[tuple[int, int, int]], nearest: dict) -> bytes:
    indices = [nearest[tuple(c >> 3 for c in pixel[:3])] + 1 if pixel[3] else 0
               for pixel in frame.get_flattened_data()]
    packed = bytes(indices[i] | indices[i + 1] << 4 for i in range(0, len(indices), 2))
    words = [0] + [r | g << 5 | b << 10 for r, g, b in colors]
    palette = struct.pack("<16H", *(words + [0] * (16 - len(words))))
    size = frame.width
    exponent = {32: 2, 64: 3}[size]
    params = exponent << 4 | exponent << 7 | 3 << 10 | 0x2000
    texture = ndspy.texture.NSBTX()
    texture.textures.append((f"surf{number}", ndspy.texture.Texture(0, 0, params, size | size << 11, packed, b"")))
    texture.palettes.append(("surf", ndspy.texture.Palette(0, 0, 0, palette)))
    return texture.save()


def _narc(files: list[bytes]) -> bytes:
    payload = bytearray()
    ranges = []
    for file in files:
        start = len(payload)
        payload.extend(file)
        ranges.append((start, len(payload)))
        payload.extend(b"\0" * (-len(payload) % 4))
    fat = b"BTAF" + struct.pack("<IHH", 12 + 8 * len(files), len(files), 0)
    fat += b"".join(struct.pack("<II", start, end) for start, end in ranges)
    names = b"BTNF" + struct.pack("<I", 16) + bytes.fromhex("0400000000000100")
    image = b"GMIF" + struct.pack("<I", 8 + len(payload)) + payload
    body = fat + names + image
    return b"NARC" + struct.pack("<HHIHH", 0xfffe, 0x0100, 16 + len(body), 16, 3) + body


def _distance(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b))


def _palette(frames):
    counts = Counter(tuple(c >> 3 for c in pixel[:3]) for frame in frames
                     for pixel in frame.get_flattened_data() if pixel[3])
    if not counts:
        raise ValueError("Surf appearance is entirely transparent")
    if any(r >= 30 and g <= 1 and b >= 30 for r, g, b in counts):
        raise ValueError("Visible sentinel magenta in Surf artwork")
    if len(counts) <= 15:
        colors = sorted(counts)
    else:
        # Deterministic weighted farthest-medoid selection; RGB555, no dithering.
        colors = [max(counts, key=lambda c: (counts[c], tuple(-v for v in c)))]
        while len(colors) < 15:
            candidate = max((c for c in counts if c not in colors),
                            key=lambda c: (min(_distance(c, chosen) for chosen in colors) * counts[c],
                                           counts[c], tuple(-v for v in c)))
            colors.append(candidate)
        colors.sort()
    nearest = {c: min(range(len(colors)), key=lambda i: (_distance(c, colors[i]), i)) for c in counts}
    return colors, nearest, len(counts)


def _later_sources():
    manifest = json.loads(LATER_MANIFEST.read_text())
    resources = {entry["member"]: entry for entry in manifest["resources"]}
    names, forms, form_art = {}, {}, {}
    for entry in manifest["appearances"]:
        species, form = entry["species"], entry["form"]
        if species < 650 or species > 1023:
            continue
        source = Path(resources[entry["member"]]["sourcePath"]).stem
        if form == 0 and not entry["shiny"]:
            names.setdefault(species, re.sub(r"[^A-Z0-9]", "", source.upper()))
        elif form:
            forms.setdefault(species, set()).add(form)
            if not entry["placeholder"] and resources[entry["member"]]["sourcePath"].startswith("Followers"):
                key = (species, form, entry["gender"], int(entry["shiny"]))
                form_art.setdefault(key, re.sub(r"[^A-Z0-9]", "", source.upper()))
    return names, forms, form_art


def _normal_name(species, later_names=None):
    if species in KEY_ALIAS:
        return KEY_ALIAS[species]
    if species >= 650:
        return (later_names[species],)
    return (re.sub(r"[^A-Z0-9]", "", NAMES[species].upper()),)


def _sources():
    result = {}
    for folder, shiny in FOLDERS:
        for path in sorted((WORKSPACE / "followersprites" / folder).glob("*.png")):
            key = re.sub(r"[^A-Z0-9]", "", path.stem.upper())
            bucket = result.setdefault(shiny, {})
            if key in bucket:
                # Source sets may contain spelling variants; use a stable choice.
                continue
            bucket[key] = path
    return result


def _find(sources, species, form, gender, shiny, later_names=None):
    names = _normal_name(species, later_names)
    suffixes = ("_female", "_f") if gender == 1 else ("",)
    for base in names:
        for suffix in suffixes:
            candidates = (f"{base}_{form}{suffix}", f"{base}{suffix}_{form}") if form else (f"{base}{suffix}",)
            for candidate in candidates:
                key = re.sub(r"[^A-Z0-9]", "", candidate.upper())
                if key in sources[shiny]:
                    return sources[shiny][key]
    return None


def _frames(path):
    with Image.open(path) as image:
        image = image.convert("RGBA")
        if image.width != image.height or image.width % 4 or image.width // 4 < 64 or image.width // 4 > 128 or image.width // 4 % 2:
            raise ValueError(f"Invalid four-by-four Surf sheet: {path}")
        cell = image.width // 4
        art_size = cell // 2
        texture_size = 32 if art_size <= 32 else 64
        frames = []
        for row in ROWS:
            for column in range(4):
                art = image.crop((column * cell, row * cell, (column + 1) * cell, (row + 1) * cell))
                art = art.resize((art_size, art_size), Image.Resampling.NEAREST)
                frame = Image.new("RGBA", (texture_size, texture_size))
                frame.paste(art, ((texture_size - art_size) // 2, texture_size - art_size))
                frames.append(frame)
    if any(pixel[3] not in (0, 255) for frame in frames for pixel in frame.get_flattened_data()):
        raise ValueError(f"Partial transparency cannot be represented: {path}")
    return frames, texture_size


def build(sources: Path = SOURCES) -> tuple[bytes, bytes, dict]:
    spec = json.loads(sources.read_text())
    max_species = spec.get("maxSpecies")
    if spec.get("schemaVersion") != 2 or max_species not in (649, 1023):
        raise ValueError("Expected White 2 Surf source specification v2")
    later_names, later_forms, later_form_art = _later_sources() if max_species == 1023 else ({}, {}, {})
    sources_by_shiny = _sources()
    files, records, metadata = [], [], []
    missing_later = []
    for species in range(1, max_species + 1):
        if species >= 650 and species not in later_names:
            raise ValueError(f"No audited later-generation name for species {species}")
        forms = range(FORM_COUNTS.get(species, 1)) if species <= 649 else (0, *sorted(later_forms.get(species, ())))
        for form in forms:
            # The numbered Darmanitan sheets are later Galarian appearances.
            if species == 555 and form:
                continue
            for gender in (255, 1) if species in (521, 592, 593, 668, 678, 902) else (255,):
                for shiny in (0, 1):
                    if species >= 650 and form:
                        native_gender = 1 if gender == 1 else 0
                        stem = later_form_art.get((species, form, native_gender, shiny))
                        if stem is None and gender == 255:
                            stem = later_form_art.get((species, form, 2, shiny)) or later_form_art.get((species, form, 1, shiny))
                        # Only use a native-form sheet when the audited land
                        # appearance maps that form to the same named artwork.
                        path = sources_by_shiny[shiny].get(stem) if stem and stem != later_names[species] else None
                    else:
                        path = _find(sources_by_shiny, species, form, gender, shiny, later_names)
                    if not path:
                        if species <= 649 and form == 0 and gender == 255:
                            raise ValueError(f"Missing base Surf appearance for species {species}, shiny {shiny}")
                        if species >= 650 and form == 0 and gender == 255 and shiny == 0:
                            missing_later.append(species)
                        continue
                    frames, frame_size = _frames(path)
                    colors, nearest, source_colors = _palette(frames)
                    base = len(files)
                    files.extend(_texture(frame, i, colors, nearest) for i, frame in enumerate(frames))
                    rel = path.relative_to(WORKSPACE).as_posix()
                    records.append((species, form, gender, shiny, frame_size, base))
                    metadata.append({"species": species, "form": form, "gender": gender, "shiny": shiny,
                                     "source": rel, "sourceSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                                     "directionRows": list(ROWS), "frameSize": frame_size, "visibleColors": source_colors,
                                     "quantized": source_colors > 15, "memberBase": base})
    if len(records) > 4095 or len(files) > 65535:
        raise ValueError("Surf catalog exceeds validated ROM index bounds")
    records.sort(key=lambda record: record[:4])
    metadata.sort(key=lambda entry: (entry["species"], entry["form"], entry["gender"], entry["shiny"]))
    data = _narc(files)
    registry = struct.pack("<IHHHHI", 0x4d535746, 2, 8, len(records), max_species, len(files))
    registry += b"".join(struct.pack("<HBBBBH", *record) for record in records)
    manifest = {"schemaVersion": 2, "entries": metadata, "framesPerDirection": 4,
                "directionOrder": ["up", "down", "left", "right"], "members": len(files),
                "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                "registryBytes": len(registry), "registrySha256": hashlib.sha256(registry).hexdigest(),
                "crc32": zlib.crc32(data)}
    if max_species == 1023:
        manifest.update(maxSpecies=max_species, missingLaterBaseSpecies=sorted(set(missing_later)))
    return data, registry, manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", choices=("stock", "white2upgrade"), default="stock")
    args = parser.parse_args()
    source = SOURCES if args.profile == "stock" else HERE / "surf-sources-upgrade.json"
    data, registry, manifest = build(source)
    output_dir = ASSETS if args.profile == "stock" else UPGRADE_ASSETS
    (output_dir / "surf-mounts.narc").write_bytes(data)
    (output_dir / "surf-registry.bin").write_bytes(registry)
    (output_dir / "surf-mounts.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Surf mounts: {len(manifest['entries'])} appearances, {len(data)} archive bytes, {len(registry)} index bytes")
