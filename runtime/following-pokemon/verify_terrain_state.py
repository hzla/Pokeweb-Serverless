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


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('state', type=Path)
    main(parser.parse_args().state)
