"""Verify stock Surf conversion and packaged ARM hooks without running a game."""
import json
import struct
from pathlib import Path

import ndspy.narc
import ndspy.rom
import ndspy.texture
from PIL import Image
from unicorn import UC_HOOK_CODE
from unicorn.arm_const import *

from import_surf_mounts import ASSETS, SOURCE, FORM_COUNTS, build
from verify_packaged import *

data, registry, manifest = build()
assert data == (ASSETS / "surf-mounts.narc").read_bytes()
assert registry == (ASSETS / "surf-registry.bin").read_bytes()
assert manifest == json.loads((ASSETS / "surf-mounts.json").read_text())
count = struct.unpack_from("<H", registry, 8)[0]
assert struct.unpack_from("<IHHHHI", registry) == (0x4d535746, 2, 8, count, 649, count * 16)
assert 1298 <= count <= 2048 and len(registry) == 16 + count * 8
members = ndspy.narc.NARC(data).files
assert len(members) == count * 16
rows = [struct.unpack_from("<HBBBBH", registry, 16 + i * 8) for i in range(count)]
assert rows == sorted(rows, key=lambda r: r[:4])
assert len({r[:4] for r in rows}) == count
assert {r[5] for r in rows} == set(range(0, count * 16, 16))
assert all(r[4] in (32, 64) and r[5] + 16 <= len(members) for r in rows)
assert {r[4] for r in rows} == {32, 64}
assert all((species, 0, 255, shiny) in {r[:4] for r in rows}
           for species in range(1, 650) for shiny in (0, 1))
assert all(entry["sourceSha256"] and entry["memberBase"] % 16 == 0 for entry in manifest["entries"])
assert any(entry["quantized"] for entry in manifest["entries"])
assert not any(r[0] == 555 and r[1] > 0 for r in rows), "Later Darmanitan forms must be excluded"
assert not any(r[0] == 493 and r[1] > 16 for r in rows)
assert all(r[0] <= 649 for r in rows)

def choose(species, form=0, gender=2, shiny=0):
    for f in (form, 0) if form else (0,):
        for s in (shiny, 0) if shiny else (0,):
            for g in (gender, 255) if gender != 255 else (255,):
                match = next((r for r in rows if r[:4] == (species, f, g, s)), None)
                if match: return match
    return None
assert choose(493, 9, 2, 1)[:4] == (493, 9, 255, 0), "Normal same-form must beat shiny base"
assert choose(493, 10, 2, 0)[:4] == (493, 0, 255, 0)
assert choose(493, 0, 2, 1)[:4] == (493, 0, 255, 1)
assert choose(521, 0, 1, 0)[:4] == (521, 0, 1, 0)
azumarill = choose(184)
assert azumarill[4] == 32
azumarill_texture = ndspy.texture.NSBTX(members[azumarill[5]]).textures[0][1]
assert azumarill_texture.width == azumarill_texture.height == 32
azumarill_source = Image.open(ASSETS.parents[3] / "followersprites/Swimming/AZUMARILL.png").convert("RGBA")
azumarill_frame = azumarill_source.crop((0, 192, 64, 256)).resize((32, 32), Image.Resampling.NEAREST)
assert [bool(index) for byte in azumarill_texture.data1 for index in (byte & 15, byte >> 4)] == [bool(pixel[3]) for pixel in azumarill_frame.get_flattened_data()]

arceus = choose(493)
source = Image.open(SOURCE).convert("RGBA")
for direction, row in enumerate((3, 0, 1, 2)):
    for phase in range(4):
        btx = ndspy.texture.NSBTX(members[arceus[5] + direction * 4 + phase])
        texture = btx.textures[0][1]
        palette = btx.palettes[0][1].colors
        assert texture.width == texture.height == 64 and texture.isColor0Transparent
        actual = [index for byte in texture.data1 for index in (byte & 15, byte >> 4)]
        expected = source.crop((phase * 128, row * 128, (phase + 1) * 128, (row + 1) * 128))
        expected = expected.resize((64, 64), Image.Resampling.NEAREST)
        for pixel, index in zip(expected.get_flattened_data(), actual):
            assert bool(pixel[3]) == bool(index)
            if index:
                assert tuple(c >> 3 for c in pixel[:3]) == tuple(palette[index][:3])

rom = ndspy.rom.NintendoDSRom.fromFile(str(ASSETS.parents[3] / "cleanwhite2.nds"))
personal = ndspy.narc.NARC(rom.getFileByName("a/0/1/6")).files
assert {species: personal[species][32] for species in range(1, 650) if personal[species][32] > 1} == FORM_COUNTS
assert all(form < max(1, personal[species][32]) for species, form, *_ in rows)
overlay = rom.loadArm9Overlays([36])[36]
assert overlay.data[0x021a4974 - overlay.ramAddress:0x021a4978 - overlay.ramAddress] == bytes.fromhex("1bf0c8fc")
assert overlay.data[0x021a497e - overlay.ramAddress:0x021a4982 - overlay.ramAddress] == bytes.fromhex("1bf0c3fc")
assert overlay.data[0x021a4d4a - overlay.ramAddress:0x021a4d4e - overlay.ramAddress] == bytes.fromhex("1bf0ddfa")
assert overlay.data[0x021a4d52 - overlay.ramAddress:0x021a4d56 - overlay.ramAddress] == bytes.fromhex("1bf0d9fa")

dll = PACKAGE_BUILD / "PokewebFollowingFieldW2.dll"
elf = PACKAGE_BUILD / "PokewebFollowingFieldW2.elf"
_, _, _, _, functions, _ = audit(dll, elf)
base, stop, stack = 0x02300000, 0x02008000, 0x023f0000
uc = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
uc.ctl_set_cpu_model(UC_CPU_ARM_946)
uc.mem_map(0x02000000, 0x400000)
uc.mem_write(base, bytes(relocate(dll, base, load_dependencies(uc))))
def addr(name): return base + functions[name][0]
def put(where, value): uc.mem_write(where, struct.pack("<I", value & 0xffffffff))
def half(where, value): uc.mem_write(where, struct.pack("<H", value & 0xffff))
def read(where): return struct.unpack("<I", uc.mem_read(where, 4))[0]
def call(name, args):
    for reg, value in zip((UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3), list(args) + [0] * 4):
        uc.reg_write(reg, value)
    for number, reg in enumerate(range(UC_ARM_REG_R4, UC_ARM_REG_R11 + 1)):
        uc.reg_write(reg, 0x12340000 + number)
    uc.reg_write(UC_ARM_REG_SP, stack)
    uc.reg_write(UC_ARM_REG_LR, stop | 1)
    uc.emu_start(addr(name) | 1, stop, count=300000)
    assert uc.reg_read(UC_ARM_REG_PC) == stop and uc.reg_read(UC_ARM_REG_SP) == stack
    for number, reg in enumerate(range(UC_ARM_REG_R4, UC_ARM_REG_R11 + 1)):
        assert uc.reg_read(reg) == 0x12340000 + number

forwarded, drawn, draw_order = [], [], []
def native_spy(u, pc, size, user):
    assert u.reg_read(UC_ARM_REG_SP) % 8 == 0
    if pc == 0x021c0308:
        forwarded.append((u.reg_read(UC_ARM_REG_R0), u.reg_read(UC_ARM_REG_R1)))
    elif pc == 0x0204f684:
        draw_order.append(("player", struct.unpack("<3i", u.mem_read(actor + 4, 12))))
    else:
        scene = u.reg_read(UC_ARM_REG_R0)
        mount_actor = read(scene + 8)
        assert struct.unpack("<4H", u.mem_read(scene + 28, 8)) == native_light_colors
        drawn.append((scene, mount_actor, struct.unpack("<H", u.mem_read(mount_actor, 2))[0],
                      struct.unpack("<H", u.mem_read(mount_actor + 24, 2))[0]))
        draw_order.append(("mount", struct.unpack("<3i", u.mem_read(mount_actor + 4, 12))))
    u.reg_write(UC_ARM_REG_PC, u.reg_read(UC_ARM_REG_LR))
uc.hook_add(UC_HOOK_CODE, native_spy, begin=0x021c0308, end=0x021c0308)
uc.hook_add(UC_HOOK_CODE, native_spy, begin=0x0204ebdc, end=0x0204ebdc)
uc.hook_add(UC_HOOK_CODE, native_spy, begin=0x0204f684, end=0x0204f684)

control, objects = 0x02210000, 0x02210100
uc.mem_write(control, bytes(0x300))
half(control + 8, 0)  # This is not an object count; stock draw ignores it.
put(control + 12, objects)
put(objects, 1)
uc.mem_write(objects + 8, struct.pack("<3i", 100 * 4096, 0, 200 * 4096))
surf = module_exports(dll, base)[symbol_hash("surf")]
ready, active, tick, captured, has_mount = surf + 832, surf + 836, surf + 812, surf + 816, surf + 828
wrapper = "THUMB_BRANCH_LINK_36_0x021a4974"
entry_wrapper = "THUMB_BRANCH_LINK_36_0x021a4d4a"
call(wrapper, [control, 0])
assert forwarded == [(control, 0)] and not read(has_mount), (forwarded, read(has_mount))
put(surf, 0x02211000); half(surf + 820, 493); half(surf + 822, 0)
put(ready, 1); put(active, 1); put(tick, 10)
call(wrapper, [control, 0])
assert forwarded == [(control, 0)] and read(has_mount) == 2 and read(captured) == 10
call(wrapper, [control, 0])
assert forwarded == [(control, 0)] and read(has_mount) == 2
call(entry_wrapper, [control, 0])
assert forwarded == [(control, 0)] and read(has_mount) == 2
assert struct.unpack("<3i", uc.mem_read(surf + 800, 12)) == (100 * 4096, 0, 200 * 4096)
put(objects, 9)
call(wrapper, [control, 0])
call(entry_wrapper, [control, 0])
assert forwarded == [(control, 0)] * 3

system, player, field_billboards, billboards = 0x02211000, 0x02212000, 0x02213000, 0x02214000
scene, slots, actor, camera, light = 0x02215000, 0x02216000, 0x02217000, 0x02218000, 0x02219000
for pointer in (system, player, field_billboards, billboards, scene, slots, actor, camera, light):
    uc.mem_write(pointer, bytes(0x100))
put(surf, system); put(surf + 4, player)
half(surf + 824, 64)
put(system + 0x28, field_billboards); put(field_billboards + 4, billboards)
put(billboards + 4, scene); put(billboards + 0x18, slots); half(billboards + 0x1c, 1)
put(scene + 8, actor); half(scene + 14, 1)
native_light_colors = (0x4210, 0x2108, 0x1084, 0x0421)
for offset, color in zip((28, 30, 32, 34), native_light_colors): half(scene + offset, color)
put(player, 1); put(player + 136, system); half(player + 196, 0)
half(actor + 24, 0x821f); half(actor + 18, 8192); half(actor + 20, 8192)
uc.mem_write(camera + 32, struct.pack("<3i", 0, 200 * 4096, 140 * 4096))
for face in range(4):
    half(player + 24, face)
    before = len(drawn)
    call("fwsurf_draw", [billboards, camera, light, int(face == 1)])
    assert len(drawn) == before + 1 and drawn[-1][2] < 16, (face, before, drawn, read(active), read(has_mount), read(tick), read(captured))
    assert drawn[-1][1] == surf + 712
    assert drawn[-1][3] & 0x0200, "Retail renderer would skip the mount without its live-billboard flag"
    assert drawn[-1][3] & 0xf000 == 0x8000, "The mount must inherit the rider's map light selection"
    call("fwsurf_draw", [billboards, camera, light, int(face != 1)])
    assert len(drawn) == before + 1
native_y = 0
native_pose = (100 * 4096, native_y, 200 * 4096)
uc.mem_write(actor + 4, struct.pack("<3i", *native_pose))
uc.mem_write(player + 68, struct.pack("<3i", *native_pose))
uc.mem_write(camera + 32, struct.pack("<3i", 100 * 4096, 100 * 4096, 300 * 4096))
uc.mem_write(camera + 56, struct.pack("<3i", 100 * 4096, 0, 200 * 4096))
put(stack, player); put(stack + 4, 0)  # Fifth/sixth AAPCS arguments.
for face in range(4):
    half(player + 24, face)
    draw_order.clear()
    call("fwsurf_draw_scene", [billboards, camera, light, 0])
    expected = ["player", "mount"] if face == 1 else ["mount", "player"]
    assert [kind for kind, _ in draw_order] == expected, (face, draw_order)
    rider_pose = next(pose for kind, pose in draw_order if kind == "player")
    mount_pose = next(pose for kind, pose in draw_order if kind == "mount")
    assert rider_pose == (native_pose[0], native_y + 10 * 4096, native_pose[2])
    depth_delta = mount_pose[1] + mount_pose[2] - rider_pose[1] - rider_pose[2]
    assert depth_delta >= 4 * 4096 if face == 1 else depth_delta <= -4 * 4096, (face, depth_delta)
    assert read(actor + 8) == native_y, "Rider billboard must be restored after submission"
put(surf + 884, read(tick))
draw_order.clear()
call("fwsurf_draw_scene", [billboards, camera, light, 0])
assert draw_order == [("player", native_pose)], "The upload frame must not draw newly recycled Surf texture VRAM"
put(surf + 884, 0)
put(active, 0)
draw_order.clear()
call("fwsurf_draw_scene", [billboards, camera, light, 0])
assert draw_order == [("player", native_pose)]
assert read(surf + 876) == 1, "The preceding land frame must cache a billboard template"
put(active, 1)
half(player + 196, 0xffff)
put(tick, 11); put(captured, 11)
draw_order.clear()
call("fwsurf_draw_scene", [billboards, camera, light, 0])
assert any(kind == "mount" for kind, _ in draw_order), "Surf entry must draw after the player billboard slot is removed"
half(player + 196, 0)
put(tick, 12)
draw_order.clear()
call("fwsurf_draw_scene", [billboards, camera, light, 0])
assert any(kind == "mount" for kind, _ in draw_order), "One-frame-old mount transform should still draw"
assert next(pose for kind, pose in draw_order if kind == "player")[1] == native_y + 10 * 4096
put(tick, 13)
draw_order.clear()
call("fwsurf_draw_scene", [billboards, camera, light, 0])
assert draw_order == [("player", native_pose)], "A vanished mount must not leave its rider floating during disembark"
assert read(actor + 8) == native_y, "Dismount must keep the native player pose"

# Exercise the packaged load path. The native initializer encodes texture
# dimensions in argument 3; a 64-pixel frame with 0x22 silently has zero atlas
# columns/rows even when the resource and VRAM key allocation both succeed.
field, field_player = 0x0221a000, 0x0221a200
uc.mem_write(field, bytes(0x200))
put(system + 64, field); put(field + 0x94, field_player)
half(system + 10, 21)
materials_seen = []
next_resource = [0]
def load_spy(u, pc, size, user):
    r0, r1, r2, r3 = (u.reg_read(reg) for reg in (UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3))
    result = 0
    if pc == 0x0219a6e0:
        assert r0 == field_player
        result = player
    elif pc == 0x0203a2d4:
        assert r0 == 21
        result = 65536
    elif pc == 0x020493f0:
        assert bytes(u.mem_read(r0, len(b"rom:/following/surf-mounts.narc"))) == b"rom:/following/surf-mounts.narc"
        assert r1 < len(members)
        result = 0x0221b000 + next_resource[0] * 0x100
        next_resource[0] += 1
    elif pc == 0x0204e598:
        assert r1 == 0 and r3 in (32, 64)
        frame_height = read(u.reg_read(UC_ARM_REG_SP))
        assert frame_height == r3
        width = 1 << (((r2 >> 4) & 7) + 3)
        height = 1 << ((r2 & 7) + 3)
        half(r0 + 4, width); half(r0 + 6, height)
        u.mem_write(r0 + 8, bytes((r3, frame_height, width // r3, height // frame_height)))
        materials_seen.append((r2, r3, width, height, width // r3, height // frame_height))
    elif pc == 0x0204e55c:
        put(r0, r1); put(r0 + 32, 1); put(r0 + 36, 1)
    else:
        assert pc in (0x02049560, 0x02049430), hex(pc)
    u.reg_write(UC_ARM_REG_R0, result)
    u.reg_write(UC_ARM_REG_PC, u.reg_read(UC_ARM_REG_LR))
for native_address in (0x0219a6e0, 0x0203a2d4, 0x020493f0, 0x0204e598, 0x0204e55c, 0x02049560, 0x02049430):
    uc.hook_add(UC_HOOK_CODE, load_spy, begin=native_address, end=native_address)

# The supplied opposite-facing handoff state had a provisional water mount
# before the native effect appeared; its later effect position was two tiles
# north of the rider. Exercise both frames with the packaged stock DLL.
transition = module_exports(dll, base)[symbol_hash("transition")]
uc.mem_write(transition + 28, b"\1")
put(surf, system); put(surf + 4, player)
half(surf + 820, 493); half(surf + 822, 0); half(surf + 824, 64)
put(ready, 1); put(active, 0); put(has_mount, 0)
put(surf + 840, 1); put(surf + 844, 40)
half(player + 24, 3)
call("fwsurf_update", [system, 493, 0, 41])
assert read(has_mount) == 0, "No speculative water sprite before the native effect supplies a mount"
draw_order.clear()
call("fwsurf_draw_scene", [billboards, camera, light, 0])
assert [kind for kind, _ in draw_order] == ["player"], draw_order
uc.mem_write(objects + 8, struct.pack("<3i", 101 * 4096, 0, 198 * 4096))
put(objects, 1)
call(entry_wrapper, [control, 0])
assert read(has_mount) == 2
assert struct.unpack("<3i", uc.mem_read(surf + 800, 12)) == (101 * 4096, 0, 198 * 4096)
draw_order.clear()
call("fwsurf_draw_scene", [billboards, camera, light, 0])
mount_pose = next(pose for kind, pose in draw_order if kind == "mount")
rider_pose = next(pose for kind, pose in draw_order if kind == "player")
assert abs(mount_pose[0] - rider_pose[0]) < 4096 and abs(mount_pose[2] - rider_pose[2]) < 4096, (mount_pose, rider_pose)
assert struct.unpack("<3i", uc.mem_read(surf + 800, 12)) == (101 * 4096, 0, 198 * 4096), ("Entry alignment must not rewrite the native effect", struct.unpack("<3i", uc.mem_read(surf + 800, 12)), mount_pose, rider_pose)
uc.mem_write(transition + 28, b"\0")
uc.mem_write(objects + 8, struct.pack("<3i", 100 * 4096, 0, 200 * 4096))

for frame_size, expected_dimensions, species in ((64, 0x33, 493), (32, 0x22, 1)):
    if read(ready):
        call("fwsurf_destroy", [])
    put(surf, system)
    half(surf + 820, species); half(surf + 822, 0); half(surf + 824, frame_size)
    before = len(materials_seen)
    call("fwsurf_update", [system, species, 0, 20])
    assert read(ready) == 0 and read(active) == 0, "A land follower must not keep Surf textures resident"
    put(objects, 1)
    before_forwarded = len(forwarded)
    call(wrapper, [control, 0])
    assert len(forwarded) == before_forwarded and read(surf + 840) == 1, "Ordinary Surf draw can precede the mode-2 field update"
    call(entry_wrapper, [control, 0])
    assert len(forwarded) == before_forwarded and read(surf + 840) == 1, "Early Surf mount must be suppressed before mode 2"
    call("fwsurf_update", [system, species, 0, 21])
    assert read(ready) == 1 and read(active) == 1
    assert read(has_mount) == 2 and read(captured) == 20
    assert struct.unpack("<3i", uc.mem_read(surf + 800, 12)) == (100 * 4096, 0, 200 * 4096)
    call("fwsurf_update", [system, species, 1, 22])
    assert read(surf + 840) == 0 and read(active) == 1, "Native Surf mode takes over the armed entry"
    assert materials_seen[before:] == [(expected_dimensions, frame_size, frame_size, frame_size, 1, 1)] * 16
    for member in range(16):
        material = surf + 72 + member * 40
        assert uc.mem_read(material + 8, 4) == bytes((frame_size, frame_size, 1, 1))
party_base, mon_base, game = 0x0221c000, 0x0221d000, 0x0221e000
party = []
def party_spy(u, pc, size, user):
    r0, r1 = u.reg_read(UC_ARM_REG_R0), u.reg_read(UC_ARM_REG_R1)
    result = 0
    if pc == 0x0201735c: result = party_base if r0 == game else 0
    elif pc == 0x0201fe24: result = len(party)
    elif pc == 0x0201ff34: result = mon_base + r1 * 0x100 if r1 < len(party) else 0
    elif pc == 0x0201cd24:
        index = (r0 - mon_base) // 0x100
        mon = party[index]
        result = {5: mon[0], 0x4c: mon[1], 0xa0: mon[2], 0x6f: mon[3], 0x6e: mon[4],
                  0: mon[7], 7: mon[8],
                  **{0x36 + i: move for i, move in enumerate(mon[6])}}.get(r1, 0)
    elif pc == 0x0201cdd8: result = party[(r0 - mon_base) // 0x100][5]
    u.reg_write(UC_ARM_REG_R0, result)
    u.reg_write(UC_ARM_REG_PC, u.reg_read(UC_ARM_REG_LR))
for native_address in (0x0201735c, 0x0201fe24, 0x0201ff34, 0x0201cd24, 0x0201cdd8):
    uc.hook_add(UC_HOOK_CODE, party_spy, begin=native_address, end=native_address)
def mon(species, moves, egg=0, hp=10, form=0, gender=0, shiny=0, personality=0, trainer=0):
    return (species, egg, hp, form, gender, shiny, moves, personality, trainer)
party[:] = [mon(493, (57, 0, 0, 0), egg=1), mon(521, (0, 0, 0, 57), hp=0, gender=1, shiny=1),
            mon(493, (57, 0, 0, 0))]
call("FollowingSurfPartyAppearance", [game])
assert uc.reg_read(UC_ARM_REG_R0) == 521 | (1 << 18) | (1 << 26)
for move_slot in range(4):
    moves = [0] * 4; moves[move_slot] = 57
    party[:] = [mon(493, tuple(moves), form=9, gender=2, shiny=1)]
    call("FollowingSurfPartyAppearance", [game])
    assert uc.reg_read(UC_ARM_REG_R0) == 493 | (9 << 10) | (2 << 18) | (1 << 26)
party[:] = [mon(493, (0, 0, 0, 0)), mon(650, (57, 0, 0, 0))]
call("FollowingSurfPartyAppearance", [game])
assert uc.reg_read(UC_ARM_REG_R0) == 0
party[:] = [mon(493, (57, 0, 0, 0)), mon(521, (57, 0, 0, 0))]
call("FollowingSurfPartyAppearance", [game])
assert uc.reg_read(UC_ARM_REG_R0) == 493
follower = module_exports(dll, base)[symbol_hash("fwfield_follower")]
def selected(species, slot, form=0, gender=0, shiny=0, personality=0, trainer=0):
    uc.mem_write(follower + 28, struct.pack("<HBBBBHH2xII", species, form, gender, shiny, 0,
                                           10, 10, personality, trainer))
    uc.mem_write(follower + 48, struct.pack("<bB", slot, 1))
party[:] = [mon(493, (57, 0, 0, 0), personality=11),
            mon(521, (0, 57, 0, 0), shiny=1, personality=22)]
selected(521, 1, shiny=1, personality=22)
call("FollowingSurfPartyAppearance", [game])
assert uc.reg_read(UC_ARM_REG_R0) == 521 | (1 << 26), "The selected follower must beat the earlier Surf knower"
party[1] = mon(521, (0, 0, 0, 0), shiny=1, personality=22)
call("FollowingSurfPartyAppearance", [game])
assert uc.reg_read(UC_ARM_REG_R0) == 493, "A follower without Surf must fall back to party order"
party[1] = mon(521, (0, 57, 0, 0), shiny=1, personality=23)
call("FollowingSurfPartyAppearance", [game])
assert uc.reg_read(UC_ARM_REG_R0) == 493, "A replaced follower must not be preferred"
party[:] = [mon(493, (57, 0, 0, 0), personality=11), mon(25, (57, 0, 0, 0)),
            mon(521, (0, 57, 0, 0), shiny=1, personality=22)]
call("FollowingSurfPartyAppearance", [game])
assert uc.reg_read(UC_ARM_REG_R0) == 521 | (1 << 26), "Party reorder must follow identity, not the old slot"
uc.mem_write(follower + 49, b"\0")
call("FollowingSurfPartyAppearance", [game])
assert uc.reg_read(UC_ARM_REG_R0) == 493
file_positions = {}
catalog = registry
def file_spy(u, pc, size, user):
    r0, r1, r2 = (u.reg_read(reg) for reg in (UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2))
    result = 1
    if pc == 0x02070ca8: file_positions[r0] = 0
    elif pc == 0x02070ecc:
        path = bytes(u.mem_read(r1, 64)).split(b"\0", 1)[0]
        if path == b"rom:/following/positioning.narc": result = 0 # Missing sidecar uses zero offsets.
        else:
            assert path == b"rom:/following/surf-registry.bin"
            file_positions[r0] = 0
    elif pc == 0x02070dec: result = len(catalog)
    elif pc == 0x02070e54:
        assert r2 == 0 and r1 <= len(catalog)
        file_positions[r0] = r1
    elif pc == 0x02070e6c:
        at = file_positions[r0]
        chunk = catalog[at:at + r2]
        u.mem_write(r1, chunk)
        file_positions[r0] += len(chunk)
        result = len(chunk)
    u.reg_write(UC_ARM_REG_R0, result)
    u.reg_write(UC_ARM_REG_PC, u.reg_read(UC_ARM_REG_LR))
for native_address in (0x02070ca8, 0x02070ecc, 0x02070dec, 0x02070e54, 0x02070e6c, 0x02070de0):
    uc.hook_add(UC_HOOK_CODE, file_spy, begin=native_address, end=native_address)
for species, form, gender, shiny in ((493, 9, 2, 1), (493, 0, 2, 1), (521, 0, 1, 0), (555, 1, 0, 1)):
    appearance = species | (form << 10) | (gender << 18) | (shiny << 26)
    call("fwsurf_destroy", [])
    call("fwsurf_update", [system, appearance, 0, 100])
    assert struct.unpack("<H", uc.mem_read(surf + 822, 2))[0] == choose(species, form, gender, shiny)[5]
catalog = b"BAD!" + registry[4:]
call("fwsurf_destroy", [])
call("fwsurf_update", [system, 493, 0, 101])
assert struct.unpack("<H", uc.mem_read(surf + 822, 2))[0] == 0xffff
catalog = registry
for cycle in range(20):
    stamp = 200 + cycle * 10
    call("fwsurf_destroy", [])
    call("fwsurf_update", [system, 493, 0, stamp])
    put(objects, 1)
    call(entry_wrapper, [control, 0])
    call("fwsurf_update", [system, 493, 0, stamp + 1])
    assert read(ready) == 1 and read(active) == 1
    call("fwsurf_update", [system, 493, 1, stamp + 2])
    assert read(active) == 1
    call("fwsurf_update", [system, 493, 0, stamp + 3])
    assert read(active) == 0 and read(ready) == 0 and all(read(surf + 8 + i * 4) == 0 for i in range(16))
call("fwsurf_update", [system, 493, 1, 400])
put(active, 1); put(ready, 1)
call("fwsurf_update", [system, 0, 1, 401])  # Saved Followers Off; keep native Surf active.
assert read(surf) == 0 and read(active) == 0 and read(ready) == 0
forwarded.clear()
put(objects, 1)
call(wrapper, [control, 0])
assert forwarded == [(control, 0)], "An active Surf ride must return to the retail model when following turns Off"
print("Surf catalog coverage/variants, party order and all Surf move slots, both entry hooks, cached jump rendering, rider priority/lift and teardown passed; no game emulator run.")
