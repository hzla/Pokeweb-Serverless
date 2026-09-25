"""Exercise the packaged stock field-input wrappers with native event spies."""
import struct
import verify_conversation_return as regression
from unicorn import UC_HOOK_CODE
from unicorn.arm_const import UC_ARM_REG_LR, UC_ARM_REG_PC, UC_ARM_REG_R0, UC_ARM_REG_R3

h = regression.h
cpu = h.uc
start = h.addr("fwland_begin") & ~1
follow = h.addr("fwland_follow_player") & ~1
move_state = 0x0219a6f8
sound = 0x02006254
surf_eligible = h.addr("fwtm_eligible") & ~1
started = []
sounds = []
surf_slots = []
releases = []


def native_stub(unit, pc, _size, _user):
    if pc not in (start, follow, move_state, sound, surf_eligible, 0x02049560, 0x02049430):
        return
    if pc == start:
        started.append(1)
    if pc == sound:
        sounds.append(unit.reg_read(UC_ARM_REG_R0))
    if pc == surf_eligible:
        surf_slots.append(unit.reg_read(UC_ARM_REG_R3))
    if pc in (0x02049560, 0x02049430):
        releases.append((pc, unit.reg_read(UC_ARM_REG_R0)))
    unit.reg_write(UC_ARM_REG_R0, 1 if pc == start else 0)
    unit.reg_write(UC_ARM_REG_PC, unit.reg_read(UC_ARM_REG_LR))


cpu.hook_add(UC_HOOK_CODE, native_stub)
regression.setup()
regression.field_frame()
h.provider = h.FOREIGN
h.put(h.addr("fwfield_landToggleTick"), 0)


def grid(held, pressed):
    h.held, h.pressed = held, pressed
    h.put(h.SNAP + 0x300, 0)
    h.put(h.SNAP + 0x304, 0)
    return h.call("FollowingGridEvents", [h.GAME, h.FIELD, h.SNAP + 0x300, h.SNAP + 0x304])


assert grid(1, 1) == h.FOREIGN, "Ordinary A must reach the native event provider"
assert grid(0x13, 3) == h.FOREIGN, "Movement input must prevent mounting"
assert grid(0x100, 0x100) == h.FOREIGN, "L/R must remain outside the mount chord"
assert not started
assert grid(3, 1) == 0 and len(started) == 1, "B-held then A must mount while stopped"
assert grid(3, 1) == 0 and len(started) == 1, "A second provider in the same frame must not toggle again"
h.put(h.addr("fwfield_tick"), h.u32(h.addr("fwfield_tick")) + 1)
assert grid(3, 2) == 0 and len(started) == 2, "A-held then B must mount while stopped"
h.put(h.addr("fwfield_tick"), h.u32(h.addr("fwfield_tick")) + 1)
assert grid(3, 3) == 0 and len(started) == 3, "Simultaneous A+B must mount"
assert sounds == [1374, 1374, 1374], "Each mocked successful mount plays one stock bounce sound"
h.held, h.pressed = 3, 3
assert h.call("FollowingRailEvents", [h.GAME, h.FIELD]) == 0 and len(started) == 3
land = h.addr("land")
h.put(land, h.SYS)
h.put(land + 32, 0)
cpu.mem_write(land + 12, struct.pack("<H4BHH2xII", 25, 0, 0, 0, 0, 100, 100, 123, 456))
cpu.mem_write(land + 665, b"\1")
assert h.call("fwland_validate") == 1
assert h.call("fwland_slot") == 0
# Automatic lead selection leaves the follower slot unresolved. The land mount
# has already resolved it, and that concrete slot must reach Surf eligibility.
h.put(land + 4, h.A)
h.put(land + 8, h.P)
cpu.mem_write(h.F + 48, b"\xff")
h.provider = 0
assert grid(0x10, 0) == 0 and surf_slots == [0], surf_slots
cpu.mem_write(h.F + 48, b"\0")
cpu.mem_write(land + 12, struct.pack("<H", 26))
assert h.call("fwland_validate") == 0 and cpu.mem_read(land + 666, 1) == b"\1"
assert h.call("fwland_slot") == 0xffffffff

# Dismount hides the mount until the trail has a safe follower tile. That
# return must use the normal ball send-out instead of exposing the sprite at
# once when the player moves.
h.call("fwland_end")
regression.setup()
h.put(h.addr("fwfield_landToggleTick"), 0)
h.put(h.addr("fwfx") + 40, 1)  # Private ball resources were prepared while mounted.
h.put(h.addr("fwfx") + 44, 0)
h.put(land, h.SYS)
h.put(land + 4, h.A)
h.put(land + 8, h.P)
cpu.mem_write(land + 665, b"\1")
h.call("fwland_follow_player", [h.A, h.P])
send_outs = h.u32(h.addr("FollowingEffectsDebug") + 12)
h.call("move", [h.A])
assert h.u32(h.addr("fwfx") + 44) == 0 and h.u32(h.addr("FollowingEffectsDebug") + 12) == send_outs
assert grid(3, 1) == 0 and cpu.mem_read(land + 665, 1) == b"\0"
assert h.u32(h.A) & 4 and h.u32(h.F) == 1, "Unmount must hide the actor while its trail reseeds"
h.call("move", [h.A])
assert h.u32(h.addr("fwfx") + 44) == 0, "A stationary player must not spawn an overlapping follower"
h.put(h.P + 68, h.u32(h.P + 68) + 65536)
h.call("move", [h.A])
assert h.u32(h.addr("fwfx") + 44) == 1, "Dismount return must start the ball send-out"
assert h.u32(h.addr("FollowingEffectsDebug") + 12) == send_outs + 1
assert h.u32(h.A) & 4, "The follower must stay hidden for the first send-out frames"
h.call("fwfx_tick")
h.call("fwfx_tick")
h.call("move", [h.A])
assert not h.u32(h.A) & 4 and h.u32(h.addr("FollowingEffectsDebug") + 12) == send_outs + 1

# The Repel continuation's live script supervisor and choice child are a
# presentation pause, including when the follower is a land mount. A field
# update must neither set a recall reason nor tear down that mount.
regression.setup()
h.call("fwland_end")
h.put(land, h.SYS)
h.put(land + 4, h.A)
h.put(land + 8, h.P)
cpu.mem_write(land + 665, b"\1")
h.put(h.EVENT + 32, h.EVENT + 0x80)
h.half(h.EVENT + 0x84, 10144)
cpu.mem_write(h.EVENT, struct.pack("<5I", 0, 0x02153821, 0, h.EVENT + 32, h.GAME))
h.put(h.GAME + 0x18, h.EVENT)
h.held = h.pressed = 0
regression.field_frame()
assert h.call("fws_poll") == 1 and h.call("fwland_active") == 1
assert h.u32(h.addr("FollowingDebug") + 20) == 0 and h.u32(h.F + 24) == h.A
prompt = h.EVENT + 0x120
h.put(prompt + 16, h.EVENT + 0x80)
h.put(h.FOREIGN + 32, prompt)
cpu.mem_write(h.FOREIGN, struct.pack("<5I", h.EVENT, 0x021a82fd, 0, h.FOREIGN + 32, h.GAME))
h.put(h.GAME + 0x18, h.FOREIGN)
regression.field_frame()
assert h.call("fws_poll") == 1 and h.call("fwland_active") == 1
assert h.u32(h.addr("FollowingDebug") + 20) == 0 and h.u32(h.F + 24) == h.A
h.put(h.GAME + 0x18, h.EVENT)
vm, env, param, work = (h.EVENT + offset for offset in (0x300, 0x400, 0x500, 0x80))
h.put(vm + 0x2c, env)
h.put(env + 0x20, param)
h.put(param, work)
h.put(work + 20, h.EVENT)
h.call("fws_observe", [3, vm, 0x2c2])  # Yes: consume another Repel.
regression.field_frame()
assert h.call("fws_poll") == 1 and h.call("fwland_active") == 1
assert h.u32(h.addr("FollowingDebug") + 20) == 0 and h.u32(h.F + 24) == h.A

# Surf must not recycle a texture key while the preceding land draw is still
# queued. The handoff deactivates drawing immediately but retains the land
# allocation across two field ticks, then releases it exactly once.
h.call("fwland_end")
h.put(land + 36, h.SNAP + 0x600)
cpu.mem_write(land + 665, b"\1")
releases.clear()
h.call("fwland_handoff", [200])
assert h.call("fwland_active") == 0 and h.u32(land + 36) == h.SNAP + 0x600
h.call("fwland_tick", [200])
h.call("fwland_tick", [201])
assert h.u32(land + 36) == h.SNAP + 0x600 and not releases
h.call("fwland_tick", [202])
assert h.u32(land + 36) == 0 and [pc for pc, _ in releases] == [0x02049560, 0x02049430], (hex(h.u32(land + 36)), releases)
h.call("fwland_tick", [203])
assert len(releases) == 2
print("Packaged land-input checks passed: mount chord guards, dismount send-out, Repel Yes-branch retention, and delayed one-shot Surf texture release. No game emulator run.")
