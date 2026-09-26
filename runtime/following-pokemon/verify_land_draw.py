"""Check packaged land-mount submission and restoration without a game run."""
import struct

from unicorn import UC_HOOK_CODE
from unicorn.arm_const import *

from verify_packaged import *

dll = PACKAGE_BUILD / "PokewebFollowingFieldW2.dll"
elf = PACKAGE_BUILD / "PokewebFollowingFieldW2.elf"
_, _, _, _, functions, _ = audit(dll, elf)
base, stop, stack = 0x02300000, 0x02008000, 0x023f0000
cpu = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
cpu.ctl_set_cpu_model(UC_CPU_ARM_946)
cpu.mem_map(0x02000000, 0x400000)
cpu.mem_write(base, bytes(relocate(dll, base, load_dependencies(cpu))))
land = module_exports(dll, base)[symbol_hash("land")]


def put(where, value):
    cpu.mem_write(where, struct.pack("<I", value & 0xffffffff))


def half(where, value):
    cpu.mem_write(where, struct.pack("<H", value & 0xffff))


def read(where):
    return struct.unpack("<I", cpu.mem_read(where, 4))[0]


def call(name, arguments):
    for register, value in zip((UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3), arguments):
        cpu.reg_write(register, value)
    for number, register in enumerate(range(UC_ARM_REG_R4, UC_ARM_REG_R11 + 1)):
        cpu.reg_write(register, 0x12340000 + number)
    for number, value in enumerate(arguments[4:]):
        put(stack + number * 4, value)
    cpu.reg_write(UC_ARM_REG_SP, stack)
    cpu.reg_write(UC_ARM_REG_LR, stop | 1)
    cpu.emu_start((base + functions[name][0]) | 1, stop, count=300000)
    assert cpu.reg_read(UC_ARM_REG_PC) == stop and cpu.reg_read(UC_ARM_REG_SP) == stack
    for number, register in enumerate(range(UC_ARM_REG_R4, UC_ARM_REG_R11 + 1)):
        assert cpu.reg_read(register) == 0x12340000 + number


actor_system, follower, player = 0x02210000, 0x02210100, 0x02210200
context, renderer, scene = 0x02210300, 0x02210400, 0x02210500
billboards, slots, camera, light, materials = 0x02210600, 0x02210700, 0x02210800, 0x02210900, 0x02210a00
for address in (actor_system, follower, player, context, renderer, scene, billboards, slots, camera, light, materials):
    cpu.mem_write(address, bytes(0x100))
put(actor_system + 0x28, context)
put(context + 4, renderer)
put(renderer + 4, scene)
put(renderer + 0x18, slots)
half(renderer + 0x1c, 2)
put(slots + 40, 1)
put(scene + 4, materials)
put(scene + 8, billboards)
half(scene + 12, 18)
half(scene + 14, 2)
native_light_colors = (0x4210, 0x2108, 0x1084, 0x0421)
for offset, color in zip((28, 30, 32, 34), native_light_colors):
    half(scene + offset, color)
# The supplied blackbox.mln state has a 64-pixel mount using material 16,
# with eight directional frames inside it. Material 17 is uninitialized.
half(materials + 16 * 40 + 4, 64)
half(materials + 16 * 40 + 6, 512)
cpu.mem_write(materials + 16 * 40 + 8, bytes((64, 64, 1, 8)))
for actor, index in ((follower, 0), (player, 1)):
    put(actor, 1)
    put(actor + 136, actor_system)
    half(actor + 196, index)
    cpu.mem_write(actor + 68, struct.pack("<3i", 100 * 4096, 0, 200 * 4096))
    at = billboards + index * 28
    cpu.mem_write(at + 4, struct.pack("<3i", 100 * 4096, 0, 200 * 4096))
    half(at + 18, 32 * 256)
    half(at + 20, 32 * 256)
    half(at + 24, 0x121f if index == 0 else 0x821f)
half(billboards, 16)
half(billboards + 16, 5)
put(land + 4, follower)
put(land + 8, player)
cpu.mem_write(land + 665, b"\1")  # Active flag after the twelve rider resources/materials.
cpu.mem_write(camera + 32, struct.pack("<3i", 100 * 4096, 100 * 4096, 300 * 4096))
cpu.mem_write(camera + 56, struct.pack("<3i", 100 * 4096, 0, 200 * 4096))

submissions = []
held = 0


def draw_spy(unit, pc, _size, _user):
    if pc == 0x0203df4c:
        unit.reg_write(UC_ARM_REG_R0, held)
    elif pc == 0x0204f684:
        assert not read(billboards + 28 + 24) & 0x0200, "Mounted native player body must be suppressed"
        assert read(billboards + 24) & 0x0200, "The follower mount must remain visible"
        assert struct.unpack("<H", unit.mem_read(billboards + 24, 2))[0] & 0xf000 == 0x8000
        material = struct.unpack("<H", unit.mem_read(billboards, 2))[0] & 0x3fff
        frame = struct.unpack("<H", unit.mem_read(billboards + 16, 2))[0]
        rows = unit.mem_read(materials + material * 40 + 11, 1)[0]
        assert material == 16 and frame < rows, (material, frame, rows)
        assert unit.mem_read(materials + 17 * 40 + 4, 4) == bytes(4), "Adjacent material must stay unused"
        submissions.append(("mount", struct.unpack("<3i", unit.mem_read(billboards + 4, 12)),
                            material, frame))
    elif pc == 0x0204ebdc:
        private_scene = unit.reg_read(UC_ARM_REG_R0)
        rider = read(private_scene + 8)
        assert struct.unpack("<H", unit.mem_read(private_scene + 14, 2))[0] == 1
        assert struct.unpack("<H", unit.mem_read(private_scene + 12, 2))[0] == 12
        assert struct.unpack("<H", unit.mem_read(rider + 24, 2))[0] & 0x0200
        assert struct.unpack("<H", unit.mem_read(rider + 24, 2))[0] & 0xf000 == 0x8000
        assert struct.unpack("<4H", unit.mem_read(private_scene + 28, 8)) == native_light_colors
        submissions.append(("rider", struct.unpack("<3i", unit.mem_read(rider + 4, 12)),
                            struct.unpack("<H", unit.mem_read(rider, 2))[0]))
    else:
        return
    unit.reg_write(UC_ARM_REG_PC, unit.reg_read(UC_ARM_REG_LR))


for address in (0x0203df4c, 0x0204f684, 0x0204ebdc):
    cpu.hook_add(UC_HOOK_CODE, draw_spy, begin=address, end=address)

original_mount = bytes(cpu.mem_read(billboards, 28))
original_body = bytes(cpu.mem_read(billboards + 28, 28))
for direction in range(4):
    half(player + 24, direction)
    half(billboards + 16, direction * 2 + 1)
    original_mount = bytes(cpu.mem_read(billboards, 28))
    submissions.clear()
    call("fwland_draw", [renderer, camera, light, follower, player, 0, direction + 1])
    expected = ["rider", "mount"] if direction == 1 else ["mount", "rider"]
    assert [item[0] for item in submissions] == expected, (direction, submissions)
    assert bytes(cpu.mem_read(billboards, 28)) == original_mount
    assert bytes(cpu.mem_read(billboards + 28, 28)) == original_body
    rider_pose = next(item[1] for item in submissions if item[0] == "rider")
    assert next(item[2] for item in submissions if item[0] == "rider") & 0x3fff == direction * 3
    mount_pose = next(item[1] for item in submissions if item[0] == "mount")
    depth = mount_pose[1] + mount_pose[2] - rider_pose[1] - rider_pose[2]
    assert depth >= 4 * 4096 if direction == 1 else depth <= -4 * 4096, (direction, depth)
# The supplied mounted Reuniclus state retains the player's shadow and hides
# the follower's own. A lowered mount must stay ahead of the player shadow,
# including when the rider is submitted on the opposite side of the mount.
put(player + 4, 0x4000)
for direction in range(4):
    half(player + 24, direction)
    original_mount = bytes(cpu.mem_read(billboards, 28))
    original_body = bytes(cpu.mem_read(billboards + 28, 28))
    submissions.clear()
    call("fwland_draw", [renderer, camera, light, follower, player, -5, 30 + direction])
    mount_pose = next(item[1] for item in submissions if item[0] == "mount")
    ground = struct.unpack("<3i", cpu.mem_read(player + 68, 12))
    assert ((mount_pose[1] - ground[1]) + (mount_pose[2] - ground[2])) / 2**0.5 >= 6 * 4096 - 64
    assert bytes(cpu.mem_read(billboards, 28)) == original_mount
    assert bytes(cpu.mem_read(billboards + 28, 28)) == original_body
put(player + 4, 0)
half(player + 24, 2)
half(billboards + 16, 5)
original_mount = bytes(cpu.mem_read(billboards, 28))
for tick, phase, rider_phase in ((10, 5, 2), (15, 4, 0), (20, 5, 1)):
    held = 2
    put(player + 68, 100 * 4096 + tick * 4096)
    submissions.clear()
    call("fwland_draw", [renderer, camera, light, follower, player, 0, tick])
    mount_submission = next(item for item in submissions if item[0] == "mount")
    assert mount_submission[2:] == (16, phase), mount_submission
    assert mount_submission[1][1] == (4096 if phase & 1 else 0), (tick, mount_submission)
    assert next(item[2] for item in submissions if item[0] == "rider") & 0x3fff == 2 * 3 + rider_phase
    assert bytes(cpu.mem_read(billboards, 28)) == original_mount
held = 0
put(player + 68, 130 * 4096)
submissions.clear()
call("fwland_draw", [renderer, camera, light, follower, player, 0, 25])
assert next(item[2:] for item in submissions if item[0] == "mount") == (16, 5)
submissions.clear()
call("fwland_draw", [renderer, camera, light, follower, player, 0, 26])
assert next(item[2] for item in submissions if item[0] == "rider") & 0x3fff == 2 * 3 + 2

# Ordinary mounted walking must now alternate the same two follower poses,
# with a one-pixel vertical lift shared by the mount and seated rider. The
# native actor billboards and player shadow position are restored afterward.
cpu.mem_write(land + 675, b"\0")
walk_rider_y = []
for tick, frame, lift in ((60, 5, 4096), (69, 5, 4096), (70, 4, 0), (80, 5, 4096)):
    put(player + 68, (150 + tick) * 4096)
    submissions.clear()
    original_mount = bytes(cpu.mem_read(billboards, 28))
    call("fwland_draw", [renderer, camera, light, follower, player, 0, tick])
    mount_submission = next(item for item in submissions if item[0] == "mount")
    rider_submission = next(item for item in submissions if item[0] == "rider")
    assert mount_submission[2:] == (16, frame) and mount_submission[1][1] == lift, (tick, mount_submission)
    walk_rider_y.append(rider_submission[1][1])
    assert bytes(cpu.mem_read(billboards, 28)) == original_mount
    assert bytes(cpu.mem_read(billboards + 28, 28)) == original_body
assert walk_rider_y[0] == walk_rider_y[1] == walk_rider_y[3] and abs(walk_rider_y[0] - walk_rider_y[2] - 4096) <= 128, walk_rider_y
submissions.clear()
call("fwland_draw", [renderer, camera, light, follower, player, 0, 81])
assert next(item[1][1] for item in submissions if item[0] == "mount") == 4096, "The mounted bounce continues at rest"
for tick, lift in ((90, 0), (100, 4096)):
    submissions.clear()
    call("fwland_draw", [renderer, camera, light, follower, player, 0, tick])
    assert next(item[1][1] for item in submissions if item[0] == "mount") == lift
    assert bytes(cpu.mem_read(billboards + 28, 28)) == original_body
for direction in range(4):
    half(player + 24, direction)
    half(billboards + 16, direction * 2 + 1)
    cpu.mem_write(land + 675, b"\0")
    put(player + 68, (240 + direction) * 4096)
    submissions.clear()
    original_mount = bytes(cpu.mem_read(billboards, 28))
    call("fwland_draw", [renderer, camera, light, follower, player, 0, 100 + direction])
    assert [item[0] for item in submissions] == (["rider", "mount"] if direction == 1 else ["mount", "rider"])
    assert next(item[1][1] for item in submissions if item[0] == "mount") == 4096 - (8192 if direction == 0 else 0)
    assert bytes(cpu.mem_read(billboards, 28)) == original_mount
    assert bytes(cpu.mem_read(billboards + 28, 28)) == original_body

# Mirrored small art has six frames: the right-facing pose shares the left
# frame pair and is flipped by native billboard flags.
cpu.mem_write(materials + 16 * 40 + 8, bytes((32, 32, 1, 6)))
half(billboards + 16, 5)
half(billboards + 18, 32 * 256)
half(billboards + 20, 32 * 256)
half(player + 24, 3)
cpu.mem_write(land + 675, b"\0")
held = 2
for tick, frame in ((30, 5), (35, 4), (40, 5)):
    put(player + 68, 140 * 4096 + tick * 4096)
    submissions.clear()
    original_mount = bytes(cpu.mem_read(billboards, 28))
    call("fwland_draw", [renderer, camera, light, follower, player, 0, tick])
    assert next(item[2:] for item in submissions if item[0] == "mount") == (16, frame)
    assert bytes(cpu.mem_read(billboards, 28)) == original_mount

# A calculated party Speed of 240 must not affect the flat-step command: the
# cached Personal base Speed is the only input to the capped travel curve.
field, game, party, mon, model = (0x02212000, 0x02212100, 0x02212200, 0x02212300, 0x02212400)
for address in (field, game, party, mon, model):
    cpu.mem_write(address, bytes(0x100))
put(actor_system + 64, field)
put(field + 8, game)
put(land, actor_system)
put(land + 32, 0)
cpu.mem_write(land + 12, struct.pack("<H4BHH2xII", 25, 0, 0, 0, 0, 100, 100, 123, 456))
cpu.mem_write(land + 665, b"\1")
step_codes = []


def step_spy(unit, pc, _size, _user):
    r1 = unit.reg_read(UC_ARM_REG_R1)
    if pc == 0x0201735c:
        result = party
    elif pc == 0x0201fe24:
        result = 1
    elif pc == 0x0201ff34:
        result = mon
    elif pc == 0x0201cd24:
        assert r1 != 0xa4, "Calculated party Speed must not be read"
        result = {5: 25, 0: 123, 7: 456, 0x6f: 0, 0x6e: 0, 0x4c: 0, 0xa0: 100}.get(r1, 0)
    elif pc == 0x0201cdd8:
        result = 0
    elif pc == 0x02166ec8:
        step_codes.append(r1)
        result = 0
    else:
        return
    unit.reg_write(UC_ARM_REG_R0, result)
    unit.reg_write(UC_ARM_REG_PC, unit.reg_read(UC_ARM_REG_LR))


for address in (0x0201735c, 0x0201fe24, 0x0201ff34, 0x0201cd24, 0x0201cdd8, 0x02166ec8):
    cpu.hook_add(UC_HOOK_CODE, step_spy, begin=address, end=address)
for speed, expected in ((50, 0x50), (100, 0x14), (255, 0x54)):
    cpu.mem_write(land + 667, bytes((speed,)))
    put(land + 660, 0)
    call("FollowingLandStep", [model, 0x58])
    assert step_codes[-1] == expected, (speed, step_codes[-1], expected)
    debug = module_exports(dll, base)[symbol_hash("FollowingLandDebug")]
    assert read(debug + 28) == speed
print("Packaged land rendering and base-Speed checks passed: four-direction priority, player-shadow separation, native body suppression, billboard restoration, walking/running and stationary two-pose stride with one-pixel paired bounce, Personal base Speed instead of calculated party Speed, three-frame animated rider. GPU draw is a spy; no game emulator run.")
