"""Pack native icon pixels and palettes from Pokeweb's bundled sprite library."""
from io import BytesIO
from pathlib import Path
from struct import pack
from zipfile import ZipFile

from PIL import Image

REPO = Path(__file__).resolve().parents[3]
NATURES = (
    "hardy lonely brave adamant naughty bold docile relaxed impish lax timid hasty serious jolly naive "
    "modest mild quiet bashful rash calm gentle sassy careful quirky"
).split()
NAMES = [f"{name}_mint" if name not in {"hardy", "docile", "bashful", "quirky"} else "serious_mint"
         for name in NATURES] + ["bottle_cap", "gold_bottle_cap", "ability_capsule", "ability_patch"]


def native_icon(png):
    image = Image.open(BytesIO(png)).convert("RGBA")
    width, height = image.size
    pixels = bytearray(512)
    palette = [0]
    colors = {}
    for y in range(height):
        for x in range(width):
            r, g, b, a = image.getpixel((x, y))
            if a < 128:
                continue
            value = (r >> 3) | (g >> 3) << 5 | (b >> 3) << 10
            if value not in colors:
                colors[value] = len(palette)
                palette.append(value)
            dx, dy = x + (32 - width) // 2, y + (32 - height) // 2
            offset = ((dy // 8) * 4 + dx // 8) * 32 + (dy % 8) * 4 + (dx % 8) // 2
            pixels[offset] |= colors[value] << (4 * (dx % 2))
    if len(palette) > 16:
        raise ValueError("Too many colors for a DS item sprite")
    return bytes(pixels) + pack("<16H", *palette, *([0] * (16 - len(palette))))


def main():
    with ZipFile(REPO / "public/data/item-sprite-library.zip") as archive:
        data = b"".join(native_icon(archive.read(f"emerald/{name}.png")) for name in NAMES)
    (REPO / "src/assets/codeinjection/trainingItemIcons.bin").write_bytes(data)


if __name__ == "__main__":
    main()
