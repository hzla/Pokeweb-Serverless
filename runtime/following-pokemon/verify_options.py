"""CPU-check the packaged Options sidecar with native menu services mocked."""
from __future__ import annotations

import struct
import json
import os
import sys
from pathlib import Path
import ndspy.rom
import ndspy.codeCompression
from unicorn import UC_HOOK_CODE
from unicorn.arm_const import UC_ARM_REG_LR, UC_ARM_REG_PC, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_SP, UC_CPU_ARM_946
from verify_packaged import (Uc, UC_ARCH_ARM, UC_MODE_THUMB, audit, module_exports,
                             read_module, relocate, symbol_hash, PACKAGE_BUILD,
                             MODULE_SUFFIX)

profile = os.environ.get("FOLLOWING_PROFILE", "stock")
if profile == "black2":
    from black2_port import port_address as port
elif profile == "white2italy":
    from italy_port import port_address as port
else:
    port = lambda address: address

if len(sys.argv) > 1:
    contract_name = "black2-contract.json" if profile == "black2" else "italy-contract.json" if profile == "white2italy" else "contract.json"
    sites = [site for site in json.loads((Path(__file__).parent / contract_name).read_text())["hooks"] if site["id"].startswith("options-")]
    rom = ndspy.rom.NintendoDSRom.fromFile(sys.argv[1])
    overlays = rom.loadArm9Overlays([140])
    overlay = overlays[140]
    for site in sites:
        expected = bytes.fromhex(site["expectedHex"])
        at = site["address"] - overlay.ramAddress
        if overlay.data[at:at + len(expected)] != expected:
            raise ValueError(f"Options hook site changed: {site['id']}")
    # These are the five retail setters used by the Options panel. Their
    # halfword read/modify/write masks leave bit 11 intact on every profile.
    # Check the actual decompressed ARM9 instructions, including Upgrade.
    arm9 = ndspy.codeCompression.decompress(rom.arm9)
    for stock_address, expected_hex in {
        0x02045840: "03490a682c214143501880687047", # BG screen buffer
        0x02044ea0: "03490a682c214143501880697047", # BG scroll Y
        0x02045698: "f0b585b000912c2141432248",     # BG row palette
    }.items():
        address = port(stock_address)
        expected = bytes.fromhex(expected_hex)
        at = address - rom.arm9RamAddress
        if arm9[at:at + len(expected)] != expected:
            raise ValueError(f"Options background adapter changed at {address:#x}")
    setters = {
        0x02008a1c: "03880f22090493430a0c0f2111401943",
        0x02008a38: "0904090c890703883022890e93431943",
        0x02008a54: "0904090cc90703888022090e93431943",
        0x02008a70: "0904090cc90703884022490e93431943",
        0x02008ad0: "0904090cc9070388024a890d1a401143",
    }
    for address, expected_hex in setters.items():
        at = address - rom.arm9RamAddress
        expected = bytes.fromhex(expected_hex)
        if arm9[at:at + len(expected)] != expected:
            raise ValueError(f"Options save-bit setter changed at {address:#x}")
    mask_at = 0x02008ae4 - rom.arm9RamAddress
    if struct.unpack_from("<I", arm9, mask_at)[0] & (1 << 11) == 0:
        raise ValueError("Retail Options setter may clear the Followers save bit")

BASE, STOP, STACK = 0x02300000, 0x02008000, 0x023f0000
SCROLL, UI, SAVE, PRE, NOW = 0x02200000, 0x02200100, 0x02200200, 0x02200300, 0x02200400
BG_TILES = 0x02210000
DLL = PACKAGE_BUILD / f"PokewebFollowingCore{MODULE_SUFFIX}.dll"
ELF = PACKAGE_BUILD / f"PokewebFollowingCore{MODULE_SUFFIX}.elf"
_, _, _, _, functions, _ = audit(DLL, ELF)
uc = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
uc.ctl_set_cpu_model(UC_CPU_ARM_946)
uc.mem_map(0x02000000, 0x400000)
uc.mem_write(BASE, bytes(relocate(DLL, BASE)))
exports = module_exports(DLL, BASE)
state = exports[symbol_hash("option")]
assert 0x02300000 <= state < 0x02310000

def u32(at): return struct.unpack("<I", uc.mem_read(at, 4))[0]
def put(at, value): uc.mem_write(at, struct.pack("<I", value & 0xffffffff))
def sidecar(row, staged=0, original=0):
    put(state, SCROLL)
    put(state + 4, SAVE)
    uc.mem_write(state + 28, bytes([1, staged, original, row, 255, 255, 255, 0]))

saved = []
calls = []
palette_calls = []
screen_loads = []
scroll_y = -20
native_main = {port(address) for address in (0x0219e0e0, 0x0219e0a0, 0x0219dfe0)}
native_save = {port(address) for address in (0x0219e8ec, 0x0219e8ac, 0x0219e7ec)}
native_init = {port(address) for address in (0x0219e054, 0x0219e014, 0x0219df54)}
native_noop = {port(address) for address in (0x02044cc4, 0x0219db98,
               0x0219db58, 0x0219da98, 0x02006254, 0x02070ca8, 0x02070ecc)}

def native(u, pc, size, user):
    result = 0
    if pc in native_main:
        input_kind = u32(UI)
        selection = u32(SCROLL + 4)
        if input_kind in (4, 10): selection = 6 if selection == 0 else selection - 1
        if input_kind in (5, 11): selection = 0 if selection == 6 else selection + 1
        if input_kind == 6 and selection == 5: selection = 6
        if input_kind == 7 and selection == 6: selection = 5
        if input_kind == 3: selection = 5
        put(SCROLL + 4, selection)
    elif pc in native_save:
        saved.append(u.reg_read(UC_ARM_REG_R0))
    elif pc in native_init:
        put(SCROLL + 4, 0)
        put(SCROLL + 52, 36)
    elif pc == port(0x02045840):
        result = BG_TILES
    elif pc == port(0x02044ea0):
        result = scroll_y & 0xffffffff
    elif pc == port(0x02045698):
        sp = u.reg_read(UC_ARM_REG_SP)
        frame, x, y, width = (u.reg_read(register) for register in (UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3))
        height, palette = struct.unpack("<II", u.mem_read(sp, 8))
        palette_calls.append((frame, x, y, width, height, palette))
        if frame == 2:
            for row in range(y, y + height):
                for col in range(x, x + width):
                    address = BG_TILES + (row * 32 + col) * 2
                    tile = struct.unpack("<H", u.mem_read(address, 2))[0]
                    u.mem_write(address, struct.pack("<H", (tile & 0x0fff) | palette << 12))
    elif pc == port(0x02045ba8):
        screen_loads.append(u.reg_read(UC_ARM_REG_R0))
    elif pc not in native_noop:
        return
    calls.append(pc)
    u.reg_write(UC_ARM_REG_R0, result)
    u.reg_write(UC_ARM_REG_PC, u.reg_read(UC_ARM_REG_LR))

uc.hook_add(UC_HOOK_CODE, native)
put(SCROLL, (2 << 16) | 1)

def call(name, *args):
    for reg, value in zip((UC_ARM_REG_R0, UC_ARM_REG_R1), (*args, 0, 0)):
        uc.reg_write(reg, value)
    uc.reg_write(UC_ARM_REG_SP, STACK)
    uc.reg_write(UC_ARM_REG_LR, STOP | 1)
    uc.emu_start((BASE + functions[name][0]) | 1, STOP, count=100000)
    assert uc.reg_read(UC_ARM_REG_PC) == STOP
    assert uc.reg_read(UC_ARM_REG_SP) == STACK
    return uc.reg_read(UC_ARM_REG_R0)

uc.mem_write(PRE, b"\x01\x02\x03\x04\x05")
uc.mem_write(NOW, b"\x01\x02\x03\x04\x05")
sidecar(5)
assert call("FollowingOptionsCompare", PRE, NOW) == 1
uc.mem_write(state + 29, b"\x01")
assert call("FollowingOptionsCompare", PRE, NOW) == 0
uc.mem_write(NOW + 4, b"\x06")
assert call("FollowingOptionsCompare", PRE, NOW) == 0
uc.mem_write(NOW + 4, b"\x05")

put(SAVE, 0x1234 & ~(1 << 11))
call("FollowingOptionsCommit", PRE)
assert saved == [PRE] and u32(SAVE) & 0xffff == (0x1234 | (1 << 11))
assert uc.mem_read(state + 30, 1) == b"\x01"
uc.mem_write(state + 29, b"\x00")
call("FollowingOptionsCommit", PRE)
assert len(saved) == 2 and u32(SAVE) & 0xffff == (0x1234 & ~(1 << 11))

for row, expected in ((5, 4), (6, 5), (7, 6)):
    sidecar(row)
    assert call("FollowingOptionsSelect", SCROLL) == expected

def step(row, kind, x=0, y=0, staged=0, object_y=36):
    sidecar(row, staged)
    put(SCROLL + 4, min(row, 6))
    put(SCROLL + 52, object_y)
    put(UI, kind)
    put(UI + 4, x)
    put(UI + 8, y)
    call("FollowingOptionsMain", SCROLL, UI)
    return uc.mem_read(state + 31, 1)[0], uc.mem_read(state + 29, 1)[0]

assert step(4, 5)[0] == 5
assert step(5, 0)[0] == 5
assert step(5, 5)[0] == 6
assert step(6, 0)[0] == 6
assert step(6, 7)[0] == 6
assert step(6, 6)[0] == 7
assert step(6, 5)[0] == 7
assert step(7, 0)[0] == 7
assert step(7, 4)[0] == 6
assert step(5, 4)[0] == 4
assert step(5, 6)[1] == 1
assert step(5, 7, staged=1)[1] == 0
assert step(4, 3, x=200, y=150)[1] == 1
assert step(4, 3, x=130, y=150, staged=1)[1] == 0
assert step(4, 3, x=200, y=126, object_y=12)[1] == 1
assert step(4, 3, x=200, y=150, object_y=12)[1] == 0
assert calls and len(saved) == 2

# Copy the complete native row art, then style its palette after scrolling.
fifth_row = struct.pack("<96H", *(0x2000 | (index & 0x0fff) for index in range(96)))
uc.mem_write(BG_TILES + 14 * 32 * 2, fifth_row)
uc.mem_write(BG_TILES + 17 * 32 * 2, bytes(len(fifth_row)))
call("extend_background", SCROLL)
assert uc.mem_read(BG_TILES + 17 * 32 * 2, len(fifth_row)) == fifth_row
assert screen_loads[-1] == 2
uc.mem_write(BG_TILES + 17 * 32 * 2, struct.pack("<H", 0x5020))
scroll_y = -20
call("restyle_background", SCROLL, 0)
assert palette_calls[-1] == (2, 0, 17, 32, 3, 3)
assert screen_loads[-1] == 2
assert struct.unpack("<H", uc.mem_read(BG_TILES + 17 * 32 * 2, 2))[0] == 0x3020
loads = len(screen_loads)
call("restyle_background", SCROLL, 0)
assert len(screen_loads) == loads
call("restyle_background", SCROLL, 1)
assert palette_calls[-1] == (2, 0, 17, 32, 3, 7)
scroll_y = 28 # The sixth row becomes the fourth visible list item.
call("restyle_background", SCROLL, 0)
assert palette_calls[-1] == (2, 0, 17, 32, 3, 1)

uc.mem_write(BG_TILES + 17 * 32 * 2, struct.pack("<H", 0x5001))
sidecar(5)
call("FollowingOptionsInit", SCROLL, 1)
assert uc.mem_read(state + 28, 1) == b"\x00" # ROM-wide master switch hides the row.
assert uc.mem_read(BG_TILES + 17 * 32 * 2, 2) == struct.pack("<H", 0x5001)
print(f"{MODULE_SUFFIX}: packaged Options staging, Confirm commit, navigation, touch, marker and background style pass; native UI mocked.")
