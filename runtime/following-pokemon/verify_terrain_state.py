"""Replay stock grass attribute/effect calls from a supplied melonDS state.

This runs isolated ARM9 functions against a private RAM copy. It does not
advance a game frame, render a screen, or modify the state or ROM.
"""
import argparse
import hashlib
import struct
from pathlib import Path

from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import (
    UC_ARM_REG_LR, UC_ARM_REG_PC, UC_ARM_REG_R0, UC_ARM_REG_R1,
    UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_SP,
)

BASE = 0x02000000
STOP = 0x023EFF00
SCRATCH = 0x023EF000
STACK = 0x023EF800


def state_ram(path):
    data = path.read_bytes()
    if data[:4] != b'MELN' or struct.unpack_from('<H', data, 4)[0] != 14:
        raise ValueError('Expected melonDS v14 state')
    at = 16
    while at < len(data):
        size = struct.unpack_from('<I', data, at + 4)[0]
        if size < 16 or at + size > len(data):
            raise ValueError('Invalid state section')
        if data[at:at + 4] == b'NDSG':
            ram = data[at + 20:at + 20 + 0x1000000]
            if len(ram) != 0x1000000:
                raise ValueError('Truncated ARM9 RAM')
            return data, ram
        at += size
    raise ValueError('State has no ARM9 RAM')


def call(ram, target, args, observe=None):
    cpu = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
    cpu.mem_map(BASE, 0x1000000)
    cpu.mem_write(BASE, ram)
    cpu.mem_map(0x04000000, 0x100000)
    cpu.reg_write(UC_ARM_REG_SP, STACK)
    cpu.reg_write(UC_ARM_REG_LR, STOP | 1)
    for reg, value in zip((UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2,
                           UC_ARM_REG_R3), args):
        cpu.reg_write(reg, value)
    if observe is not None:
        cpu.hook_add(UC_HOOK_CODE, observe, begin=0x021A40EC,
                     end=0x021A40EC)
    cpu.emu_start(target | 1, STOP, count=500000)
    if cpu.reg_read(UC_ARM_REG_PC) != STOP:
        raise AssertionError('Native call did not return')
    return cpu


def state_follower(ram):
    """Find the bounded follower sidecar by its live actor and selected species."""
    debug = ram.find(b'FWDG')
    actor = struct.unpack_from('<I', ram, debug + 32)[0]
    species = struct.unpack_from('<I', ram, debug + 24)[0]
    token = struct.pack('<I', actor)
    matches = []
    at = 0
    while True:
        at = ram.find(token, at)
        if at < 0:
            break
        start = at - 24
        if start >= 0 and start + 1856 <= len(ram):
            state = struct.unpack_from('<I', ram, start)[0]
            head, count = struct.unpack_from('<HH', ram, start + 1848)
            if state in (2, 3, 6) and struct.unpack_from('<H', ram, start + 28)[0] == species and head < 64 and 2 <= count <= 64 and all(v <= 12 for v in ram[start + 1852:start + 1856]):
                matches.append(BASE + start)
        at += 4
    if len(matches) != 1:
        raise AssertionError(('Follower sidecar matches', matches))
    return matches[0]


def main(path):
    data, ram = state_ram(path)
    debug_at = ram.find(b'FWDG')
    if debug_at < 0:
        raise ValueError('Follower diagnostics absent')
    follower, player, visible = struct.unpack_from('<III', ram, debug_at + 32)
    if not visible or not follower or not player:
        raise ValueError('State must show a visible follower and player')
    attrs = []
    for actor in (player, follower):
        x, _, z = struct.unpack_from('<hhh', ram, actor - BASE + 60)
        y = struct.unpack_from('<i', ram, actor - BASE + 72)[0]
        scratch = bytearray(ram)
        struct.pack_into('<iiiI', scratch, SCRATCH - BASE,
                         x * 65536 + 32768, y, z * 65536 + 32768, 0)
        cpu = call(bytes(scratch), 0x0215E8E4,
                   (actor, SCRATCH, SCRATCH + 12))
        if cpu.reg_read(UC_ARM_REG_R0) != 1:
            raise AssertionError('Native grid attribute query failed')
        attrs.append(struct.unpack('<I', cpu.mem_read(SCRATCH + 12, 4))[0])
    if attrs[0] != attrs[1] or not ((attrs[1] >> 16) & 0x20):
        raise AssertionError(f'Player/follower grass attributes differ: {attrs!r}')
    observed = []

    def grass(cpu, _pc, _size, _user):
        observed.append(tuple(cpu.reg_read(reg) for reg in
                              (UC_ARM_REG_R0, UC_ARM_REG_R1,
                               UC_ARM_REG_R2, UC_ARM_REG_R3)))

    call(ram, 0x02194D8C, (follower, attrs[1]), grass)
    if len(observed) != 1 or observed[0][1:] != (follower, 1, 0):
        raise AssertionError(f'Native grass task was not reached: {observed!r}')
    print(f'Isolated state CPU check passed: SHA-256 {hashlib.sha256(data).hexdigest()}, '
          f'player/follower attribute {attrs[0]:#x}, native grass task reached '
          f'and returned for follower {follower:#x}. No game frame was run.')

def check_grass_draw(path, field_module):
    """Route captured grass through the real retail call sites; allocate no task."""
    from verify_packaged import relocate, symbol_hash, module_exports, install_hooks
    from unicorn.arm_const import UC_ARM_REG_R5, UC_CPU_ARM_946
    _, ram = state_ram(path)
    debug = ram.find(b'FWDG')
    follower, player = struct.unpack_from('<II', ram, debug + 32)
    field = struct.unpack_from('<I', ram, debug + 56)[0]
    sidecar = state_follower(ram)
    captured = ram[sidecar - BASE:sidecar - BASE + 1856]
    cpu = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
    cpu.ctl_set_cpu_model(UC_CPU_ARM_946)
    cpu.mem_map(BASE, 0x1000000); cpu.mem_write(BASE, ram)
    cpu.mem_map(0x04000000, 0x100000)
    def u32(at): return struct.unpack('<I', cpu.mem_read(at, 4))[0]
    def u16(at): return struct.unpack('<H', cpu.mem_read(at, 2))[0]
    def put(at, value): cpu.mem_write(at, struct.pack('<I', value))
    system = u32(follower + 136)
    renderer = u32(u32(system + 40) + 4)
    camera = u32(field + 0xb4)
    grass_renderer = u32(field + 0xc8)
    if grass_renderer == u32(field + 0xc4):
        raise AssertionError('Grass and shadow renderers unexpectedly coincide')
    def quad(renderer, slot):
        scene = u32(renderer + 4)
        return u32(scene + 8) + u32(u32(renderer + 24) + slot * 40) * 28
    body = quad(renderer, u16(follower + 196))
    player_body = quad(renderer, u16(player + 196))
    scene = u32(grass_renderer + 4)
    grass_quads = {}; owners = {}
    for slot in range(u16(grass_renderer + 28)):
        entry = u32(grass_renderer + 24) + slot * 40
        if u32(entry) >= u16(scene + 14):
            continue
        work = u32(entry + 36)
        if not BASE + 24 <= work < 0x023fff40:
            continue
        if u32(work - 20) == 1 and u32(work + 164) == 0x021a419d and u32(work + 172) == 0x021a428d and u32(work + 8) in (follower, player):
            at = quad(grass_renderer, slot)
            if u16(at) & 0x3fff != 0x3fff and u16(at + 24) & 0x0200:
                grass_quads[at] = bytes(cpu.mem_read(at, 28))
                owners[at] = body if u32(work + 8) == follower else player_body
    if not grass_quads:
        raise AssertionError('No captured active player/follower grass quad')
    # This private mapping replaces only follower-module data/code. Preserve
    # the captured native actors, camera, task pool, scene and all grass quads.
    base = 0x023a0000
    loaded = relocate(field_module, base, {symbol_hash('FollowingCoreAPI'): STOP,
                                          symbol_hash('FollowingEventsAPI'): STOP})
    cpu.mem_write(base, bytes(loaded))
    exports = module_exports(field_module, base)
    address = lambda name: exports[symbol_hash(name)]
    cpu.mem_write(address('fwfield_follower'), captured)
    put(address('fwfield_owner'), system); put(address('fwfield_player'), player)
    put(follower + 140, address('fwfield_moves'))
    install_hooks(cpu, field_module, base, {symbol_hash('FollowingCoreAPI'): STOP,
                                          symbol_hash('FollowingEventsAPI'): STOP})
    actor_before = bytes(cpu.mem_read(follower, 256)) + bytes(cpu.mem_read(player, 256))
    submissions = {}; handles = []
    def submit(cpu, _pc, _size, _user):
        handle = cpu.reg_read(UC_ARM_REG_R0); handles.append(handle)
        addresses = (body, player_body) if handle == renderer else tuple(grass_quads)
        for at in addresses:
            submissions[at] = (struct.unpack('<3i', cpu.mem_read(at + 4, 12)),
                               struct.unpack('<2h', cpu.mem_read(at + 18, 4)))
        cpu.reg_write(UC_ARM_REG_PC, cpu.reg_read(UC_ARM_REG_LR))
    cpu.hook_add(UC_HOOK_CODE, submit, begin=0x0204f684, end=0x0204f684)
    # Execute the game's unchanged argument-loading blocks and the final
    # packaged BL hooks. Calling fwr_effects_draw directly missed the fact
    # that alpha .84/.85 patched field+0xc4 instead of the grass pass at +0xc8.
    for start, stop in ((0x02181188, 0x0218119e), (0x0218119e, 0x021811b4)):
        cpu.reg_write(UC_ARM_REG_SP, STACK); cpu.reg_write(UC_ARM_REG_R5, field)
        cpu.emu_start(start | 1, stop, count=500000)
        if cpu.reg_read(UC_ARM_REG_PC) != stop or cpu.reg_read(UC_ARM_REG_SP) != STACK:
            raise AssertionError('Retail draw block did not return with intact SP')
    if handles != [renderer, grass_renderer]:
        raise AssertionError(('Draw pass routing', handles))
    eye = struct.unpack('<3i', cpu.mem_read(camera + 32, 12))
    target = struct.unpack('<3i', cpu.mem_read(camera + 56, 12))
    axis = [eye[i] - target[i] for i in range(3)]
    length = sum(v * v for v in axis) ** .5
    axis = [v / length for v in axis]
    # Native geometry type zero selects the inverse camera rotation at
    # 0x0204eeea: actor and grass vertices share camera-normal center depth.
    # Check both sides of the interval, rather than just feet coverage.
    from tests.test_render_math import Point, Pose, project
    local_eye = tuple(eye[i] - target[i] for i in range(3))
    def projected(position, scale):
        pose = Pose(Point(*(position[i] - target[i] for i in range(3))), *scale)
        return project(pose, local_eye, u32(camera) == 2)
    for at, original in grass_quads.items():
        owner = owners[at]; other = player_body if owner == body else body
        position, scale = submissions[at]
        reference = submissions[owner][0]; nearer = submissions[other][0]
        depth = sum((position[i] - reference[i]) * axis[i] for i in range(3))
        gap = sum((nearer[i] - reference[i]) * axis[i] for i in range(3))
        margin = min(4 * 4096, gap / 3) if gap > 0 else 4 * 4096
        if depth < margin - 128:
            raise AssertionError(('grass behind owner feet', hex(at), hex(owner), depth, gap))
        if gap > 0 and depth > gap - margin + 128:
            raise AssertionError(('grass covers nearer non-owner', hex(at), hex(other), depth, gap))
        before = projected(struct.unpack_from('<3i', original, 4), struct.unpack_from('<2h', original, 18))
        after = projected(position, scale)
        error = max(abs(a-b) for p,q in zip(before,after) for a,b in zip(p,q))
        if error > (64 if u32(camera) == 2 else .002 / 256):
            raise AssertionError(('Grass projected image moved', hex(at), error))
        if bytes(cpu.mem_read(at, 28)) != original:
            raise AssertionError('Native grass quad was not restored')
    if actor_before != bytes(cpu.mem_read(follower, 256)) + bytes(cpu.mem_read(player, 256)):
        raise AssertionError('Drawing changed native actor state')
    print(f'State CPU draw check passed: {len(grass_quads)} captured grass quads '
          'cover their owners without covering a nearer non-owner, through the actual terrain hook, and restore. '
          'No task was created, field frame or emulator run.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('state', type=Path)
    parser.add_argument('--field-module', type=Path)
    args = parser.parse_args()
    main(args.state)
    if args.field_module: check_grass_draw(args.state, args.field_module)
