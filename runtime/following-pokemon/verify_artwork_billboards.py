"""Execute retail frame-selector routines in isolation; never launch a game emulator.

Usage: python3 runtime/following-pokemon/verify_artwork_billboards.py CLEAN_BW2.nds
The texture upload/allocation call is a spy. Native size and material setup,
including their real tables, execute from the supplied revision-0 ROM.
"""
import hashlib
import json
from pathlib import Path
import struct
import sys

import ndspy.codeCompression
import ndspy.rom
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import *

rom = ndspy.rom.NintendoDSRom(Path(sys.argv[1]).read_bytes())
assert rom.idCode in (b"IREO", b"IRDO") and rom.version == 0
black = rom.idCode == b"IREO"
delta = 0 if black else 0x40
arm_delta = 0 if black else 0x2c
overlays = rom.loadArm9Overlays({12, 36})
field = overlays[36]
scale_address = 0x02193bd0 + delta
material_address = 0x0219465c + delta
assert hashlib.sha256(field.data[scale_address-field.ramAddress:scale_address-field.ramAddress+0x1c]).hexdigest() == "10a661eb1bab0b9115f04ecd963cd7e0fb28d6d7a20832c03ca37e3a653b9630"
expected_material = ("b5ba7d17b1d22e8449679a33e924f8a5f17f0bf55cce284445b2ff32c063cef8" if black else
                     "a489d03f81f326b6f467dd6d1d7d9ba0daced6e5fe8a1b6b763830b5d5080e2d")
assert hashlib.sha256(field.data[material_address-field.ramAddress:material_address-field.ramAddress+0x58]).hexdigest() == expected_material

uc = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
uc.ctl_set_cpu_model(UC_CPU_ARM_946)
uc.mem_map(0x02000000, 0x400000)
uc.mem_write(rom.arm9RamAddress, bytes(ndspy.codeCompression.decompress(rom.arm9)))
for overlay in overlays.values():
    uc.mem_write(overlay.ramAddress, bytes(overlay.data))
SCRATCH, STACK, STOP = 0x02380000, 0x023f0000, 0x02008000

def put(address, value):
    uc.mem_write(address, struct.pack("<I", value))

def call(address, args, stack_args=()):
    for register, value in zip((UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3), args):
        uc.reg_write(register, value)
    for index, register in enumerate(range(UC_ARM_REG_R4, UC_ARM_REG_R11 + 1)):
        uc.reg_write(register, 0x12340000 + index)
    for index, value in enumerate(stack_args):
        put(STACK + index * 4, value)
    uc.reg_write(UC_ARM_REG_SP, STACK)
    uc.reg_write(UC_ARM_REG_LR, STOP | 1)
    uc.emu_start(address | 1, STOP, count=1000)
    assert uc.reg_read(UC_ARM_REG_PC) == STOP and uc.reg_read(UC_ARM_REG_SP) == STACK
    for index, register in enumerate(range(UC_ARM_REG_R4, UC_ARM_REG_R11 + 1)):
        assert uc.reg_read(register) == 0x12340000 + index

materials = []

def upload_spy(machine, address, size, user):
    assert machine.reg_read(UC_ARM_REG_R2) == 1
    descriptor = bytes(machine.mem_read(machine.reg_read(UC_ARM_REG_R1), 12))
    assert struct.unpack_from("<I", descriptor)[0] == SCRATCH + 0x800
    materials.append(tuple(descriptor[6:8]))
    machine.reg_write(UC_ARM_REG_R0, 0)
    machine.reg_write(UC_ARM_REG_PC, machine.reg_read(UC_ARM_REG_LR))

upload = 0x0204f264 + arm_delta
uc.hook_add(UC_HOOK_CODE, upload_spy, begin=upload, end=upload)
results = []
for mode, pixels in ((0, 32), (1, 16), (2, 64)):
    uc.mem_write(SCRATCH + 228 + 7, bytes([mode]))
    call(scale_address, [SCRATCH, SCRATCH + 0x200, SCRATCH + 0x202])
    scales = struct.unpack("<2H", uc.mem_read(SCRATCH + 0x200, 4))
    assert scales == (pixels * 256, pixels * 256), (mode, scales)
    # Input is the real descriptor mode, native billboard format 21, private
    # texture pointer and normal (0) material type. Only allocation is mocked.
    call(material_address, [SCRATCH + 0x400, 0x37bc, mode, 21], [SCRATCH + 0x800, 0])
    assert materials[-1] == (pixels, pixels), (mode, materials[-1])
    results.append({"mode": mode, "quadScale": list(scales), "textureFramePixels": list(materials[-1])})

assert results[1]["textureFramePixels"] != [32, 32]  # Captured cropped-import regression.

# Execute the native animation update with real descriptor-selected tables.
# Reuse the same slot/quad across layout changes, as happens during L/R cycling.
animation_results = []
BL, SCENE, SLOTS, MATERIALS, QUAD = [SCRATCH + n for n in (0x1000, 0x1100, 0x1200, 0x1300, 0x1400)]
put(BL + 4, SCENE); put(BL + 12, MATERIALS); put(SCENE + 8, QUAD)
for selector, frame_count in ((14, 8), (13, 6), (14, 8), (13, 6)):
    call(0x02194650 + delta, [selector])
    animation_table = struct.unpack("<I", uc.mem_read(uc.reg_read(UC_ARM_REG_R0), 4))[0]
    for face in range(4):
        uc.mem_write(SLOTS, bytes(40)); put(SLOTS + 8, animation_table); put(SLOTS + 24, 1)
        uc.mem_write(SLOTS + 14, struct.pack("<H", face))
        seen = set()
        for tick in range(64):
            call(0x0204f50c + arm_delta, [BL, SLOTS])
            frame = struct.unpack("<H", uc.mem_read(QUAD + 16, 2))[0]
            flags = struct.unpack("<H", uc.mem_read(QUAD + 24, 2))[0]
            assert frame < frame_count, (selector, face, tick, frame)
            assert bool(flags & 0x400) == (frame_count == 6 and face == 3)
            seen.add(frame)
        expected = {4, 5} if frame_count == 6 and face == 3 else {face * 2, face * 2 + 1}
        assert seen == expected, (selector, face, seen)
        animation_results.append({"selector": selector, "face": face, "frames": sorted(seen), "mirror": frame_count == 6 and face == 3})
print(json.dumps({"game": rom.idCode.decode(), "nativeFrameModes": results,
                  "nativeAnimationLayouts": animation_results, "gameEmulatorRun": False}, indent=2))
