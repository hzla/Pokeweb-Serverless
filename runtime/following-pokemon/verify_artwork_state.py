"""Diagnose the supplied six/eight-frame cycling corruption from saved data only.

Usage: python3 runtime/following-pokemon/verify_artwork_state.py ROM.nds STATE.dst
No game frame, renderer, emulator application, state file or ROM is modified.
"""
import hashlib
import json
from pathlib import Path
import struct
import sys
import zlib

import ndspy.narc
import ndspy.rom
import ndspy.texture
from inspect_state import desmume_ram, diagnostics

rom_path, state_path = map(Path, sys.argv[1:3])
data = state_path.read_bytes()
ram = desmume_ram(data)
debug = diagnostics(ram)
actor = debug["FWDG"]["values"][8]
assert debug["FWDG"]["values"][10] and debug["FWFX"]["values"][2] == 0
BASE = 0x02000000

def read(address, fmt="I"):
    return struct.unpack_from("<" + fmt, ram, address - BASE)[0]

descriptor = ram[actor - BASE + 228:actor - BASE + 256]
resource_id = struct.unpack_from("<H", descriptor, 16)[0]
bl = read(read(read(actor + 136) + 40) + 4)
slot = read(bl + 24) + read(actor + 196, "H") * 40
scene = read(bl + 4)
quad = read(scene + 8) + read(slot) * 28
material = read(scene + 4) + (read(quad, "H") & 0x3fff) * 40
frame = read(quad + 16, "H")
rom = ndspy.rom.NintendoDSRom(rom_path.read_bytes())
resources = ndspy.narc.NARC(rom.getFileByName("a/0/4/8")).files
texture = ndspy.texture.NSBTX(resources[resource_id])
poses = [item for _, item in texture.textures]
size = poses[0].width
assert size in (32, 64) and len(poses) == 6 and descriptor[9] == 14 and frame in (6, 7)

payload = data[32:] if struct.unpack_from("<I", data, 28)[0] == 0xffffffff else zlib.decompress(data[32:])
at = 0
while at + 8 <= len(payload):
    kind, length = struct.unpack_from("<II", payload, at); at += 8
    if kind == 4:
        memory = payload[at:at + length]; break
    at += length
else:
    raise AssertionError("Memory chunk missing")
records, at = {}, 0
while at + 12 <= len(memory):
    tag, unit, count = struct.unpack_from("<4sII", memory, at); at += 12
    records[tag] = memory[at:at + unit * count]; at += unit * count
lcd, registers = records[b"LCDM"], records[b"9REG"]

def texture_bytes(address, length):
    out = bytearray()
    for pos in range(address, address + length):
        banks = [bank for bank in range(4) if registers[0x240 + bank] & 0x87 == 0x83
                 and (registers[0x240 + bank] >> 3 & 3) == pos // 0x20000]
        assert len(banks) == 1, (hex(pos), banks)
        out.append(lcd[banks[0] * 0x20000 + pos % 0x20000])
    return bytes(out)

base = read(material + 12)
stride = size * size // 2
for index, pose in enumerate(poses):
    assert texture_bytes(base + index * stride, stride) == pose.data1
sampled = texture_bytes(base + frame * stride, stride)
workspace = json.loads(rom.getFileByName("following/assets.json"))
matches = set()
for entry in workspace["registry"]["entries"]:
    if entry["animationProfile"] != "pokemon-asymmetric" or entry["size"] != size:
        continue
    candidate = ndspy.texture.NSBTX(resources[entry["resourceId"]])
    if candidate.textures[frame][1].data1 == sampled:
        matches.add(entry["key"]["species"])
assert 502 in matches, ("Expected captured stale Brionne pixels over species 502", matches)
# In this capture bank G supplies the selected texture palette at slot zero.
assert registers[0x246] & 0x9f == 0x83
palette_address = read(material + 16)
colors = texture.palettes[0][1].colors
expected = [color.r | color.g << 5 | color.b << 10 for color in colors]
assert palette_address + len(expected) * 2 <= 0x4000
actual = struct.unpack_from("<" + "H" * len(expected), lcd, 0x94000 + palette_address)
assert [color & 0x7fff for color in actual] == expected
print(json.dumps({"stateSha256": hashlib.sha256(data).hexdigest(), "species": debug["FWDG"]["values"][6],
    "resourceId": resource_id, "textureFrames": len(poses), "animationSelector": descriptor[9],
    "requestedFrame": frame, "sampledBeyondTexture": True, "stalePixelsMatchSpecies": sorted(matches),
    "loadedSixPosesMatchSelectedResource": True, "paletteMatchesSelectedResource": True,
    "recallAlreadyFinished": True, "gameEmulatorRun": False}, indent=2))
