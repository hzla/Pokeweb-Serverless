"""Validate White2Upgrade Surf resources, source hooks and packaged exports without emulation."""
import hashlib
import json
import os
import struct
import sys
from pathlib import Path

import ndspy.narc
import ndspy.rom
import ndspy.texture

from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_LR, UC_ARM_REG_PC, UC_ARM_REG_SP, UC_CPU_ARM_946

os.environ.setdefault("FOLLOWING_BUILD_DIR", str(Path(__file__).resolve().parent / "build/white2upgrade"))
from verify_packaged import audit, relocate, load_dependencies, module_exports, symbol_hash

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parents[1] / "src/assets/following/white2upgrade"
ROM = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parents[3] / "White2Upgrade.nds"
contract = json.loads((HERE / "upgrade-contract.json").read_text())
assert hashlib.sha256(ROM.read_bytes()).hexdigest() == contract["sourceRomSha256"]
manifest = json.loads((ASSETS / "surf-mounts.json").read_text())
registry = (ASSETS / "surf-registry.bin").read_bytes()
archive = (ASSETS / "surf-mounts.narc").read_bytes()
assert manifest["maxSpecies"] == 1023
assert hashlib.sha256(archive).hexdigest() == manifest["sha256"]
assert hashlib.sha256(registry).hexdigest() == manifest["registrySha256"]
count = struct.unpack_from("<H", registry, 8)[0]
assert struct.unpack_from("<IHHHHI", registry) == (0x4d535746, 2, 8, count, 1023, count * 16)
assert count == len(manifest["entries"]) and 1298 <= count <= 4095
assert len(registry) == 16 + count * 8
members = ndspy.narc.NARC(archive).files
assert len(members) == count * 16 and len(members) <= 65535
rows = [struct.unpack_from("<HBBBBH", registry, 16 + i * 8) for i in range(count)]
assert rows == sorted(rows, key=lambda row: row[:4])
assert len({row[:4] for row in rows}) == count
assert {row[5] for row in rows} == set(range(0, count * 16, 16))
keys = {row[:4] for row in rows}
for species in range(1, 650):
    for shiny in (0, 1):
        assert (species, 0, 255, shiny) in keys
later = {species for species, form, gender, shiny, *_ in rows
         if species >= 650 and form == 0 and gender == 255 and shiny == 0}
assert later == set(range(650, 1024)) - set(manifest["missingLaterBaseSpecies"])
assert any(species >= 650 and form > 0 for species, form, *_ in rows)
assert any(species >= 650 and gender == 1 for species, form, gender, *_ in rows)
assert all(1 <= species <= 1023 and size in (32, 64) and first + 16 <= len(members)
           for species, form, gender, shiny, size, first in rows)
for entry in manifest["entries"]:
    source = HERE.parents[2] / entry["source"]
    assert source.is_file() and hashlib.sha256(source.read_bytes()).hexdigest() == entry["sourceSha256"]
for row in (rows[0], rows[len(rows) // 2], rows[-1]):
    for member in members[row[5]:row[5] + 16]:
        texture = ndspy.texture.NSBTX(member)
        assert texture.textures[0][1].width == texture.textures[0][1].height == row[4]

rom = ndspy.rom.NintendoDSRom.fromFile(str(ROM))
personal = ndspy.narc.NARC(rom.getFileByName("a/0/1/6")).files
assert all(form < max(1, personal[species][32]) for species, form, *_ in rows)
overlay = rom.loadArm9Overlays([36])[36]
for address, expected in ((0x021a4974, "1bf0c8fc"), (0x021a497e, "1bf0c3fc"),
                          (0x021a4d4a, "1bf0ddfa"), (0x021a4d52, "1bf0d9fa")):
    actual = overlay.data[address - overlay.ramAddress:address - overlay.ramAddress + 4]
    assert actual == bytes.fromhex(expected), f"White2Upgrade Surf hook changed at {address:#x}"
build_dir = Path(os.environ["FOLLOWING_BUILD_DIR"])
dll = build_dir / "PokewebFollowingFieldW2.dll"
elf = build_dir / "PokewebFollowingFieldW2.elf"
_, _, _, _, functions, _ = audit(dll, elf)
for symbol in ("FollowingSurfPartyAppearance", "FollowingSurfMountDraw", "FollowingSurfEntryMountDraw"):
    assert symbol in functions, f"Missing packaged Surf export: {symbol}"
uc = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
uc.ctl_set_cpu_model(UC_CPU_ARM_946)
uc.mem_map(0x02000000, 0x400000)
base, stop, stack = 0x02300000, 0x02008000, 0x023f0000
uc.mem_write(base, bytes(relocate(dll, base, load_dependencies(uc))))
game, party_base, mon_base = 0x0221e000, 0x0221c000, 0x0221d000
party = []
def native_party(u, pc, size, user):
    r0, r1 = u.reg_read(UC_ARM_REG_R0), u.reg_read(UC_ARM_REG_R1)
    if pc == 0x0201735c: result = party_base if r0 == game else 0
    elif pc == 0x0201fe24: result = len(party)
    elif pc == 0x0201ff34: result = mon_base + r1 * 0x100 if r1 < len(party) else 0
    elif pc == 0x0201cdd8: result = party[(r0 - mon_base) // 0x100][4]
    else:
        species, egg, form, gender, shiny, moves, personality, trainer = party[(r0 - mon_base) // 0x100]
        result = {5: species, 0x4c: egg, 0x6f: form, 0x6e: gender,
                  0: personality, 7: trainer,
                  **{0x36 + i: move for i, move in enumerate(moves)}}.get(r1, 0)
    u.reg_write(UC_ARM_REG_R0, result)
    u.reg_write(UC_ARM_REG_PC, u.reg_read(UC_ARM_REG_LR))
for address in (0x0201735c, 0x0201fe24, 0x0201ff34, 0x0201cd24, 0x0201cdd8):
    uc.hook_add(UC_HOOK_CODE, native_party, begin=address, end=address)
def select():
    uc.reg_write(UC_ARM_REG_R0, game)
    for register in (UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3): uc.reg_write(register, 0)
    uc.reg_write(UC_ARM_REG_SP, stack)
    uc.reg_write(UC_ARM_REG_LR, stop | 1)
    uc.emu_start(base + functions["FollowingSurfPartyAppearance"][0] | 1, stop, count=100000)
    assert uc.reg_read(UC_ARM_REG_PC) == stop and uc.reg_read(UC_ARM_REG_SP) == stack
    return uc.reg_read(UC_ARM_REG_R0)
def mon(species, moves, egg=0, form=0, gender=0, shiny=0, personality=0, trainer=0):
    return (species, egg, form, gender, shiny, moves, personality, trainer)
party[:] = [mon(493, (57, 0, 0, 0), egg=1), mon(650, (0, 0, 0, 57), shiny=1),
            mon(1023, (57, 0, 0, 0))]
assert select() == 650 | (1 << 26)
for slot in range(4):
    moves = [0] * 4; moves[slot] = 57
    party[:] = [mon(1023, tuple(moves), form=2, gender=2, shiny=1)]
    assert select() == 1023 | (2 << 10) | (2 << 18) | (1 << 26)
party[:] = [mon(1023, (0, 0, 0, 0))]
assert select() == 0
follower = module_exports(dll, base)[symbol_hash("fwfield_follower")]
def selected(species, slot, form=0, gender=0, shiny=0, personality=0, trainer=0):
    uc.mem_write(follower + 28, struct.pack("<HBBBBHH2xII", species, form, gender, shiny, 0,
                                           10, 10, personality, trainer))
    uc.mem_write(follower + 48, struct.pack("<bB", slot, 1))
party[:] = [mon(650, (57, 0, 0, 0), personality=11),
            mon(1023, (0, 57, 0, 0), shiny=1, personality=22)]
selected(1023, 1, shiny=1, personality=22)
assert select() == 1023 | (1 << 26), "The later-generation follower must beat the earlier Surf knower"
party[1] = mon(1023, (0, 0, 0, 0), shiny=1, personality=22)
assert select() == 650, "A follower without Surf must fall back to party order"
party[1] = mon(1023, (0, 57, 0, 0), shiny=1, personality=23)
assert select() == 650, "A replaced follower must not be preferred"
party[:] = [mon(650, (57, 0, 0, 0), personality=11), mon(25, (57, 0, 0, 0)),
            mon(1023, (0, 57, 0, 0), shiny=1, personality=22)]
assert select() == 1023 | (1 << 26), "Party reorder must use the follower identity"
uc.mem_write(follower + 49, b"\0")
assert select() == 650
print(f"White2Upgrade Surf: {count} appearances, {len(later)} later species, {len(members)} texture members; source hooks and packaged exports pass. No emulator run.")
