"""Check packaged dialogue reach against a captured RAM copy and native queries.

No game frame, renderer, frontend or emulator is run. The source state is read
only; native field-controller, target-grid and obstruction queries execute on
an isolated ARM946 CPU with the captured field data.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

from inspect_state import desmume_ram
from verify_terrain_state import state_ram, state_follower
from verify_packaged import *
from unicorn import UC_HOOK_CODE


def verify(path, expect_rejected=False):
    data = path.read_bytes()
    ram = desmume_ram(data) if data[:16] == b'DeSmuME SState\0\0' else state_ram(path)[1]
    debug = ram.find(b'FWDG')
    if debug < 0:
        raise ValueError('Follower diagnostics absent')
    actor, player, visible = struct.unpack_from('<III', ram, debug + 32)
    if not actor or not player or not visible:
        raise ValueError('Expected a visible follower and player')
    field = struct.unpack_from('<I', ram, debug + 56)[0]
    sidecar = state_follower(ram)
    dll = PACKAGE_BUILD / f'PokewebFollowingField{MODULE_SUFFIX}.dll'
    elf = PACKAGE_BUILD / f'PokewebFollowingField{MODULE_SUFFIX}.elf'
    _, _, _, _, functions, _ = audit(dll, elf)
    base, newbase, scratch, stack, stop = 0x02000000, 0x02c00000, 0x02ef0000, 0x02ef8000, 0x02efff00
    cpu = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
    cpu.ctl_set_cpu_model(UC_CPU_ARM_946)
    cpu.mem_map(base, 0x1000000)
    cpu.mem_write(base, ram)
    cpu.mem_map(0x04000000, 0x100000)
    cpu.mem_write(newbase, bytes(relocate(dll, newbase, {
        symbol_hash('FollowingCoreAPI'): stop, symbol_hash('FollowingEventsAPI'): stop,
    })))
    cpu.mem_write(scratch, ram[sidecar - base:sidecar - base + 1856])
    queries = []

    def observe(unit, pc, _size, _user):
        if pc in (0x02180578, 0x0219aacc, 0x0215e4f0):
            queries.append(hex(pc))

    cpu.hook_add(UC_HOOK_CODE, observe)
    cpu.reg_write(UC_ARM_REG_SP, stack)
    cpu.reg_write(UC_ARM_REG_LR, stop | 1)
    for register, value in zip((UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3),
                               (scratch, player, actor, field)):
        cpu.reg_write(register, value)
    cpu.emu_start((newbase + functions['fwt_reach'][0]) | 1, stop, count=500000)
    assert cpu.reg_read(UC_ARM_REG_PC) == stop, 'Dialogue reach did not return'
    accepted = bool(cpu.reg_read(UC_ARM_REG_R0))
    assert accepted != expect_rejected, ('Unexpected dialogue reach', accepted, queries)
    if accepted:
        # The native grid query also reads the field controller internally.
        assert queries[0] == '0x2180578' and queries[-1] == '0x215e4f0' and '0x219aacc' in queries, queries
    actors = {}
    for name, pointer in (('player', player), ('follower', actor)):
        offset = pointer - base
        actors[name] = {
            'facing': struct.unpack_from('<H', ram, offset + 24)[0],
            'grid': struct.unpack_from('<3h', ram, offset + 60),
            'world': struct.unpack_from('<3i', ram, offset + 68),
        }
        assert bytes(cpu.mem_read(pointer, 256)) == ram[offset:offset + 256], name
    assert path.read_bytes() == data, 'Source state changed'
    return {
        'stateSha256': hashlib.sha256(data).hexdigest(),
        'moduleSha256': hashlib.sha256(dll.read_bytes()).hexdigest(),
        'accepted': accepted, 'actors': actors, 'nativeQueries': queries,
        'positionsUnchanged': True, 'gameEmulatorRun': False,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('state', type=Path)
    parser.add_argument('--expect-rejected', action='store_true')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    result = json.dumps(verify(args.state, args.expect_rejected), indent=2) + '\n'
    if args.report:
        args.report.write_text(result)
    print(result)
