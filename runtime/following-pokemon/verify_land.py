"""Check the stock land-mount speed implementation and pinned source assets."""
import ctypes
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

import ndspy.narc
import ndspy.rom
import ndspy.texture
from import_land_riders import BIKE_SAMPLE_OFFSETS, COMPOSITE_SPLIT_Y, indexed_pixel

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def speed_checks():
    with tempfile.TemporaryDirectory() as directory:
        library = Path(directory) / "land_speed.dylib"
        subprocess.run(["cc", "-shared", "-fPIC", "-O2", str(HERE / "land_speed.c"), "-o", str(library)], check=True)
        native = ctypes.CDLL(str(library))
        native.fwl_step_code.argtypes = [ctypes.c_uint, ctypes.c_uint, ctypes.POINTER(ctypes.c_int32)]
        native.fwl_step_code.restype = ctypes.c_uint
        native.fwl_step_frames.argtypes = [ctypes.c_uint]
        native.fwl_step_frames.restype = ctypes.c_uint
        for speed in (0, 50, 100, 200, 233, 255):
            error = ctypes.c_int32(0)
            frames = []
            for step in range(8000):
                direction = step % 4
                command = native.fwl_step_code(speed, 0x58 + direction, ctypes.byref(error))
                assert command & 3 == direction
                frames.append(native.fwl_step_frames(command))
            expected = min(1, (100 + 3 * speed) / 800)
            actual = len(frames) / sum(frames)
            assert abs(actual - expected) < 0.0005, (speed, actual, expected)
            assert all(1 <= frame <= 8 for frame in frames)
            if speed == 100: assert set(frames) == {2}
            if speed == 255: assert set(frames) == {1}
        error = ctypes.c_int32(0)
        assert native.fwl_step_code(255, 0x4c, ctypes.byref(error)) == 0x4c
        assert native.fwl_step_code(255, 0x34, ctypes.byref(error)) == 0x34


def asset_checks():
    archive = ndspy.narc.NARC.fromFile(str(ROOT / "src/assets/following/land-riders.narc"))
    assert len(archive.files) == 24
    for member in archive.files:
        texture = ndspy.texture.NSBTX(member)
        assert len(texture.textures) == len(texture.palettes) == 1
        assert texture.textures[0][1].width == texture.textures[0][1].height == 32
    manifest = json.loads((ROOT / "src/assets/following/land-riders.json").read_text())
    assert manifest["members"] == 24 and manifest["framesPerDirection"] == 3
    assert manifest["bikeFrames"] == list(range(12)) and manifest["compositeSplitY"] == 18
    assert manifest["bikeSampleOffsets"] == {gender: [list(pair) for pair in offsets]
                                             for gender, offsets in BIKE_SAMPLE_OFFSETS.items()}
    assert manifest["bottomPixels"] == [28, 27, 27, 27]
    assert hashlib.sha256((ROOT / "src/assets/following/land-riders.narc").read_bytes()).hexdigest() == manifest["sha256"]
    source = ndspy.rom.NintendoDSRom.fromFile(str(ROOT.parent / "cleanwhite2.nds"))
    stock = ndspy.narc.NARC(source.getFileByName("a/0/4/8")).files
    for sex, (bike_index, seated_index) in enumerate(((210, 211), (219, 220))):
        gender = ("male", "female")[sex]
        bike, seated = (ndspy.texture.NSBTX(stock[index]) for index in (bike_index, seated_index))
        for direction in range(4):
            for phase in range(3):
                member = ndspy.texture.NSBTX(archive.files[sex * 12 + direction * 3 + phase])
                pixels = member.textures[0][1].data1
                upper = bike.textures[direction * 3 + phase][1].data1
                lower = seated.textures[direction][1].data1
                dx, dy = BIKE_SAMPLE_OFFSETS[gender][direction * 3 + phase]
                for y in range(32):
                    for x in range(32):
                        expected = (indexed_pixel(upper, x + dx, y + dy) if y < COMPOSITE_SPLIT_Y
                                    else indexed_pixel(lower, x, y))
                        assert indexed_pixel(pixels, x, y) == expected, (gender, direction, phase, x, y)


if __name__ == "__main__":
    speed_checks();asset_checks()
    print("Land mount speed curve, special-command preservation and rider archive passed; no game emulator run.")
