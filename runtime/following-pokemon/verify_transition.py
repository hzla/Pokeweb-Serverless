"""Exercise the packaged stock water handoff with isolated native-service spies.

This runs ARM946 code from the final DLL. It does not run a game emulator.
"""
import struct
import verify_interactions as h
from unicorn import UC_HOOK_CODE
from unicorn.arm_const import UC_ARM_REG_LR, UC_ARM_REG_PC, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3

native = {0x0201735c, 0x0201fe24, 0x0201ff34, 0x0201cd24, 0x0201cdd8,
          0x02017354, 0x02008538, 0x02018c64, 0x020175e4, 0x0216a2b4,
          0x0219a704, 0x0203df4c, 0x0219a610, 0x0219ab70, 0x0219a9d0,
          0x02180514, 0x021a2a10, 0x021a2a2c, 0x021a2c24, 0x021a2c50, 0x021a2cf0,
          0x021babd4, 0x0203a6fc, 0x021bac44, 0x021bac50, 0x02006254,
          0x02166ec8, 0x02166f0c, 0x02166f38, 0x02167098, 0x0219a6e0}
selected = h.SNAP + 0x500
task = h.EVENT + 0x300
task_work = h.EVENT + 0x400
transition = h.addr('transition')
hm = 1
surf_move = 57
species = 151
terrain = 0x20040
direction = 0
can_surf = 1
sound = []
commands = []
ended = []
deleted = []
move_done = 1
task_available = 1
player_mode = 0


def spy(u, pc, _size, _user):
    if pc not in native:
        return
    r0, r1, r2, r3 = (u.reg_read(reg) for reg in (UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3))
    result = 0
    if pc == 0x0201735c: result = h.PARTY if r0 == h.GAMEDATA else 0
    if pc == 0x0201fe24: result = 1
    if pc == 0x0201ff34: result = h.MON if r1 == 0 else 0
    if pc == 0x0201cd24:
        result = {5: species, 0: 123, 7: 456, 0x6f: 0, 0x6e: 0, 0x4c: 0,
                  0xa0: 100, 0x36: surf_move, 0x37: 0, 0x38: 0, 0x39: 0}.get(r1, 0)
    if pc == 0x02017354: result = h.BAG
    if pc == 0x02008538: result = hm if r0 == h.BAG and r1 == 422 else 0
    if pc == 0x02018c64: result = 1
    if pc == 0x0219a610: result = direction
    if pc == 0x0219a704: result = player_mode
    if pc == 0x0219ab70: result = can_surf
    if pc == 0x0219a9d0: u.mem_write(r2, struct.pack('<iii', 65536, 0, 65536))
    if pc == 0x02180514: result = h.BG
    if pc == 0x021a2a10: result = terrain
    if pc == 0x021a2a2c: result = r0 & 0xffff
    if pc == 0x021a2c24: result = int(r0 in (0x41, 0x44))
    if pc == 0x021a2c50: result = int(r0 == 0x40)
    if pc == 0x021a2cf0: result = int(r0 in (0x3d, 0x3e, 0x3f, 0x42, 0x43))
    if pc == 0x021babd4:
        assert r1 == direction
        assert struct.unpack('<H', u.mem_read(h.A + 24, 2))[0] == direction, 'The effect must start facing the pressed direction'
        result = task if task_available else 0
    if pc == 0x0203a6fc: result = task_work
    if pc == 0x021bac44: result = 1
    if pc == 0x021bac50: deleted.append(r0)
    if pc == 0x02006254: sound.append(r0)
    if pc == 0x02166ec8: commands.append((r0, r1))
    if pc == 0x02166f0c: result = move_done
    if pc == 0x02166f38: ended.append(r0)
    if pc == 0x02167098:
        previous = struct.unpack('<H', u.mem_read(r0 + 24, 2))[0]
        u.mem_write(r0 + 28, struct.pack('<H', previous))
        u.mem_write(r0 + 24, struct.pack('<H', r1))
    if pc == 0x0219a6e0:
        assert r0 == h.P
        assert h.u32(h.P + 4) == h.P + 0x400
        assert h.u32(h.P + 0x41c) == h.A
        result = h.A
    u.reg_write(UC_ARM_REG_R0, result)
    u.reg_write(UC_ARM_REG_PC, u.reg_read(UC_ARM_REG_LR))


h.native_addresses.difference_update(native)
h.uc.hook_add(UC_HOOK_CODE, spy)
h.uc.mem_write(selected, struct.pack('<HBBBBHHxxII', 151, 0, 0, 0, 0, 100, 100, 123, 456))
h.put(h.FIELD + 8, h.GAMEDATA)
h.put(h.FIELD + 0x94, h.P)
h.put(h.P + 4, h.P + 0x400)
h.put(h.P + 0x400 + 0x1c, h.A)
h.half(h.FIELD + 0xe0, 427)
h.half(h.A + 60, 100)
h.half(h.A + 64, 200)
h.put(h.A + 68, (100 << 16) | 0x8000)
h.put(h.A + 76, (200 << 16) | 0x8000)
h.uc.mem_write(transition + 28, b'\0')
direction_out, attr_out = h.SNAP + 0x540, h.SNAP + 0x544


def eligible():
    return h.call('fwtm_eligible', [h.GAMEDATA, h.FIELD, selected, 0, direction_out, attr_out])


for direction in range(4):
    for terrain_id in range(0x3d, 0x45):
        terrain = 0x20000 | terrain_id
        result = eligible()
        assert result == 1 and h.u32(direction_out) == direction and h.u32(attr_out) == terrain, (direction, terrain, result, h.u32(direction_out), h.u32(attr_out), h.calls[-20:])
terrain = 0x16003f
assert eligible() == 1 and h.u32(attr_out) == terrain, 'Humilau ocean packed attribute must qualify'
terrain = 0x160017
assert eligible() == 1 and h.u32(attr_out) == terrain, 'Water+Splash shallows with sand terrain must qualify'
for terrain_id in (0x17, 0x3f, 0x40, 0x41, 0x44):
    terrain = 0x100000 | terrain_id
    assert eligible() == 0, f'Splash-only terrain {terrain_id:#x} must remain land'
terrain = 0x30040
assert eligible() == 0, 'Blocked water must not trigger the custom handoff'
terrain = 0
assert eligible() == 0, 'A blocked non-water tile cannot trigger Surf'
terrain = 0x20040
hm = 0
assert eligible() == 0, 'HM03 is required'
hm = 1
surf_move = 0
assert eligible() == 0, 'The mounted party member itself must know Surf'
surf_move = 57
can_surf = 0
assert eligible() == 0, 'Native Surf frontage and height permission must pass'
can_surf = 1
h.put(h.A + 68, (100 << 16) | 0xa000)
assert eligible() == 0, 'Surf handoff must wait for an incomplete mounted step'
h.put(h.A + 68, (100 << 16) | 0x8000)
assert eligible() == 1, 'Centered mounted actor can begin Surf'

for direction in range(4):
  for old_face in range(4):
    h.half(h.A + 24, old_face)
    h.half(h.A + 28, old_face ^ 1)
    h.uc.mem_write(transition + 28, b'\0')
    h.uc.mem_write(task_work, bytes(24))
    assert eligible() == 1
    event = h.call('fwtm_enter', [h.GAME, h.FIELD, selected, 0, 151, direction, terrain])
    assert event == h.EVENT and sound[-1] == 1374, (direction, old_face, hex(event), sound[-1:] , hex(h.u32(h.P+4)),hex(h.u32(h.P+0x41c)), h.uc.mem_read(h.A+24,6).hex(), h.uc.mem_read(transition+28,4).hex(), h.calls[-12:])
    assert h.u32(transition + 20) == task and h.uc.mem_read(transition + 28, 1) == b'\1'
    assert h.call('FollowingSurfEntryStep', [h.P, 0x34 + old_face]) == 0
    assert commands[-1] == (h.P, 0x14 + direction)
    assert h.call('FollowingSurfEntryDone', [h.P]) == 1
    callback = h.u32(h.EVENT + 4)
    assert h.call(callback, [h.GAME, h.EVENT + 8, h.EVENT + 0x20]) == 1
    assert h.uc.mem_read(transition + 28, 1) == b'\2' and deleted[-1] == task
    h.put(h.EVENT + 4, 0x02182c39)
    h.put(h.EVENT + 12, h.EVENT + 0x20)
    h.half(h.EVENT + 0x20 + 4, direction)
    h.half(h.EVENT + 0x20 + 6, 1)
    h.put(h.EVENT + 0x20 + 12, h.FIELD)
    h.call('fwtm_observe_exit', [h.EVENT, h.GAME, h.FIELD])
    assert h.uc.mem_read(transition + 28, 1) == b'\3'
    h.call('FollowingSurfExitStep', [h.P, 0x38 + direction])
    assert commands[-1] == (h.P, 0x14 + direction)
    assert h.call('FollowingSurfExitDone', [h.P]) == 0
    assert commands[-1] == (h.P, 0x14 + direction) and ended[-1] == h.P
    # The finished two-grid shore movement can leave native collision one
    # tile behind the rendered actor. Reconcile only that exact directional
    # one-tile mismatch; ordinary positions must remain untouched.
    landing_x, landing_z = 110, 210
    delta_x, delta_z = ((0, -1), (0, 1), (-1, 0), (1, 0))[direction]
    h.half(h.P + 60, landing_x - delta_x)
    h.half(h.P + 64, landing_z - delta_z)
    h.put(h.P + 68, (landing_x << 16) | 0x8000)
    h.put(h.P + 76, (landing_z << 16) | 0x8000)
    assert h.call('FollowingSurfExitDone', [h.P]) == 1
    grid_x = struct.unpack('<H', h.uc.mem_read(h.P + 60, 2))[0]
    grid_z = struct.unpack('<H', h.uc.mem_read(h.P + 64, 2))[0]
    assert grid_x == landing_x and grid_z == landing_z, (direction, grid_x, grid_z)
    assert h.call('fwtm_return_ready', [h.GAMEDATA, selected]) == 1
    h.call('fwtm_return_done')
    assert h.uc.mem_read(transition + 28, 1) == b'\0'

assert sound == [1374] * 16
for failed_stage in ('task', 'event'):
    h.uc.mem_write(transition + 28, b'\0')
    h.half(h.A + 24, 3)
    h.half(h.A + 28, 2)
    direction = 0
    task_available = int(failed_stage != 'task')
    h.fail = 'event' if failed_stage == 'event' else ''
    assert h.call('fwtm_enter', [h.GAME, h.FIELD, selected, 0, 151, direction, terrain]) == 0
    assert struct.unpack('<H', h.uc.mem_read(h.A + 24, 2))[0] == 3
    assert struct.unpack('<H', h.uc.mem_read(h.A + 28, 2))[0] == 2
    assert h.uc.mem_read(transition + 28, 1) == b'\0'
task_available = 1
h.fail = ''
assert eligible() == 1
assert h.call('fwtm_enter', [h.GAME, h.FIELD, selected, 0, 151, 0, terrain]) == h.EVENT
callback = h.u32(h.EVENT + 4)
assert h.call(callback, [h.GAME, h.EVENT + 8, h.EVENT + 0x20]) == 1
h.put(h.EVENT + 4, 0x02182c39)
h.put(h.EVENT + 12, h.EVENT + 0x20)
h.put(h.EVENT + 0x20 + 12, h.FIELD)
species = 25
h.call('fwtm_observe_exit', [h.EVENT, h.GAME, h.FIELD])
assert h.uc.mem_read(transition + 28, 1) == b'\0', 'A changed party member must clear the shore-remount token'
species = 151
assert h.call('FollowingShoreSpan', [0x17, 0x16]) == 0, 'Ordinary Surf must keep retail shore rules'
assert h.call('FollowingShoreSpan', [0x41, 0x16]) == 1, 'Retail shoreline terrain remains supported'
h.uc.mem_write(transition + 28, b'\2')
assert h.call('FollowingShoreSpan', [0x17, 0x16]) == 1, 'Water-flagged Humilau sand spans two tiles'
assert h.call('FollowingShoreSpan', [0x33, 0x12]) == 1, 'Other water-flagged frontier values use the same native final-tile checks'
assert h.call('FollowingShoreSpan', [0x17, 0x11]) == 0, 'Hitch frontage is never bypassed'
assert h.call('FollowingShoreSpan', [0x17, 0x10]) == 0, 'Dry frontage keeps its one-tile exit'
mount = h.SNAP + 0x580
player_mode = 2
assert h.call('fwtm_menu_snapshot', [h.FIELD, mount]) == 1
assert h.u32(mount) == h.GAMEDATA and h.uc.mem_read(mount + 18, 1) == b'\0'
h.call('fwtm_cancel')
assert h.call('fwtm_menu_restore', [h.FIELD, mount]) == 1
assert h.uc.mem_read(transition + 28, 1) == b'\2'
h.call('fwtm_cancel')
species = 25
assert h.call('fwtm_menu_restore', [h.FIELD, mount]) == 0, 'Edited party identity cannot restore a mount'
species = 151
player_mode = 0
assert h.call('fwtm_menu_restore', [h.FIELD, mount]) == 0, 'Dismounted player cannot restore the token'
print('Packaged land-to-water and shore-return guards, centered-step entry guard, Water-versus-Splash and Blocked flags, flagged-water sand, directional two-tile shore-grid reconciliation, shore span, menu snapshot/restore, all sixteen old/new facing pairs, failed-event face rollback, native handoff, no-hop commands and once-only sound passed. No game emulator run.')
