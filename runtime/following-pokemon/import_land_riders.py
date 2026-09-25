"""Build bicycle-free animated land riders from the stock field textures."""
from pathlib import Path
import copy
import hashlib
import json

import ndspy.narc
import ndspy.rom
import ndspy.texture
from import_surf_mounts import _narc

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SOURCE = ROOT.parent / "cleanwhite2.nds"
DEST = ROOT / "src/assets/following/land-riders.narc"
MANIFEST = ROOT / "src/assets/following/land-riders.json"
SOURCE_SHA256 = "3e50aec3db401332175a5d2b5fe2a68ac1a05ec63995dba9d1506b1b51837446"
# These exact pixel registrations were reviewed against the seated originals.
# Each pair tells the converter where to sample the native moving bike frame
# for one pixel of the seated 32x32 canvas. Direction order is up/down/left/right.
BIKE_SAMPLE_OFFSETS = {
    "male": ((0, -2), (1, -2), (-1, -1), (0, -1), (-1, -1), (1, 0),
             (0, -2), (0, -3), (0, -1), (0, -2), (0, -3), (0, -1)),
    "female": ((0, -3), (1, -3), (-1, -2), (0, -1), (1, -1), (-1, 0),
               (1, -2), (1, -3), (1, -1), (-1, -2), (-1, -3), (-1, -1)),
}
COMPOSITE_SPLIT_Y = 18


def indexed_pixel(data: bytes, x: int, y: int) -> int:
    if not (0 <= x < 32 and 0 <= y < 32):
        return 0
    at = y * 32 + x
    return (data[at // 2] >> ((at & 1) * 4)) & 15


def build(source: Path = SOURCE, dest: Path = DEST) -> dict:
    if hashlib.sha256(source.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise ValueError("Rider extraction requires the pinned stock White 2 ROM")
    rom = ndspy.rom.NintendoDSRom.fromFile(str(source))
    source_members = ndspy.narc.NARC(rom.getFileByName("a/0/4/8")).files
    members = []
    inputs = {}
    bottom_pixels = [0, 0, 0, 0]
    for gender, bike_index, seat_index in (("male", 210, 211), ("female", 219, 220)):
        bike_raw, seat_raw = source_members[bike_index], source_members[seat_index]
        inputs[gender] = {"bike": hashlib.sha256(bike_raw).hexdigest(),
                          "seated": hashlib.sha256(seat_raw).hexdigest()}
        bike, seated = ndspy.texture.NSBTX(bike_raw), ndspy.texture.NSBTX(seat_raw)
        if (len(bike.textures) != 16 or len(seated.textures) != 4 or
            len(bike.palettes) != 1 or len(seated.palettes) != 1):
            raise ValueError("Unexpected bicycle/seated rider texture layout")
        if bike.palettes[0][1].colors != seated.palettes[0][1].colors:
            raise ValueError("Bicycle and seated rider palettes differ")
        for direction in range(4):
            lower = seated.textures[direction][1]
            for phase in range(3):
                upper = bike.textures[direction * 3 + phase][1]
                if any(art.format != 3 or not art.isColor0Transparent or
                       art.width != 32 or art.height != 32 for art in (upper, lower)):
                    raise ValueError("Unexpected rider pixel format")
                # The native moving frames shift one or more pixels relative
                # to the seated art. Register their heads before taking only
                # the top 18 rows; the seated face/neck/torso below the cut
                # remain continuous. Handles, wheels and bike stop poses
                # 12–15 never enter this archive.
                dx, dy = BIKE_SAMPLE_OFFSETS[gender][direction * 3 + phase]
                art = copy.copy(upper)
                pixels = bytearray(32 * 32 // 2)
                for y in range(32):
                    for x in range(32):
                        value = (indexed_pixel(upper.data1, x + dx, y + dy) if y < COMPOSITE_SPLIT_Y
                                 else indexed_pixel(lower.data1, x, y))
                        offset = (y * 32 + x) // 2
                        pixels[offset] |= value << (4 * (x & 1))
                art.data1 = pixels
                visible = [pixel // 32 for byte_index, byte in enumerate(art.data1)
                           for pixel, index in ((byte_index * 2, byte & 15), (byte_index * 2 + 1, byte >> 4)) if index]
                if not visible:
                    raise ValueError("Rider direction has no opaque pixels")
                bottom_pixels[direction] = max(bottom_pixels[direction], max(visible))
                image = ndspy.texture.NSBTX()
                image.textures = [(f"rider{direction}_{phase}", art)]
                image.palettes = bike.palettes
                members.append(image.save())
    data = _narc(members)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    result = {"version": 2, "members": 24, "framesPerDirection": 3,
              "directions": ["up", "down", "left", "right"],
              "bikeFrames": list(range(12)), "compositeSplitY": COMPOSITE_SPLIT_Y,
              "bikeSampleOffsets": BIKE_SAMPLE_OFFSETS, "bottomPixels": bottom_pixels,
              "sourceSha256": inputs, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    MANIFEST.write_text(json.dumps(result, indent=2) + "\n")
    return result


if __name__ == "__main__":
    print(json.dumps(build(), indent=2))
