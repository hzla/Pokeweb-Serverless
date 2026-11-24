"""Exercise each bundled Thumb scheduler through its three patched call sites."""

from hashlib import sha256
import json
import struct

from unicorn import UC_ARCH_ARM, UC_HOOK_CODE, UC_MODE_THUMB, Uc
from unicorn.arm_const import UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_SP

from build import ASSETS, GAMES, rpm_code


def word(value):
    return struct.pack("<I", value)


def branch_link(source, target):
    displacement = target - (source + 4)
    assert displacement % 2 == 0 and -0x400000 <= displacement < 0x400000
    return struct.pack("<HH", 0xF000 | ((displacement >> 12) & 0x7FF),
                       0xF800 | ((displacement >> 1) & 0x7FF))


def check(profile, hooks, targets):
    code = bytearray(rpm_code((ASSETS / profile["fileName"]).read_bytes()))
    assert sha256(code).hexdigest() == profile["codeSha256"]
    code_base = 0x02200020
    owner_address = code_base + len(code)
    for offset in (0x14, 0x3C, 0x58):
        assert struct.unpack_from("<I", code, offset)[0] == len(code) + 0x20
        code[offset:offset + 4] = word(owner_address)
    for offset, target in zip((0x18, 0x40, 0x54), targets, strict=True):
        assert struct.unpack_from("<I", code, offset)[0] == (target | 1)
    m = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
    m.mem_map(0x02000000, 0x400000)
    m.mem_write(code_base, bytes(code))
    for hook, offset in zip(hooks, (0, 0x1C, 0x44), strict=True):
        m.mem_write(hook, branch_link(hook, code_base + offset))
    for target in targets:
        m.mem_write(target, b"\x70\x47")  # bx lr

    regs = (UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3)
    stack = 0x023F8000
    client_a, client_b = 0x02281000, 0x02281040
    calls = []
    busy = {client_a: 1, client_b: 1}

    def owner():
        return struct.unpack("<I", m.mem_read(owner_address, 4))[0]

    def native(vm, address, _size, _data):
        if address not in targets:
            return
        r0 = vm.reg_read(UC_ARM_REG_R0)
        sp = vm.reg_read(UC_ARM_REG_SP)
        assert sp % 8 == 0
        calls.append((address, r0, owner()))
        if address == targets[0]:
            assert owner() == 0
            assert tuple(vm.reg_read(reg) for reg in regs) == (1, 2, 3, 4)
            assert bytes(vm.mem_read(sp, 4)) == word(5)
            vm.reg_write(UC_ARM_REG_R0, client_a)
        elif address == targets[1]:
            assert owner() == r0
            vm.reg_write(UC_ARM_REG_R0, busy[r0])

    m.hook_add(UC_HOOK_CODE, native)

    def invoke(index, *arguments):
        padded_arguments = arguments + (0,) * (len(regs) - len(arguments))
        for reg, arg in zip(regs, padded_arguments, strict=True):
            m.reg_write(reg, arg)
        m.reg_write(UC_ARM_REG_SP, stack)
        m.mem_write(stack, word(5))
        hook = hooks[index]
        m.emu_start(hook | 1, hook + 4, count=200)
        assert m.reg_read(UC_ARM_REG_SP) == stack
        return m.reg_read(UC_ARM_REG_R0)

    assert invoke(0, 1, 2, 3, 4) == client_a
    assert invoke(1, client_a) == 1 and owner() == client_a
    for _ in range(4):
        assert invoke(1, client_b) == 1 and owner() == client_a
        assert invoke(1, client_a) == 1 and owner() == client_a
    assert all(address != targets[1] or client != client_b for address, client, _ in calls)
    busy[client_a] = 0
    assert invoke(1, client_a) == 0 and owner() == 0
    assert invoke(1, client_b) == 1 and owner() == client_b
    invoke(2, client_b)
    assert calls[-1] == (targets[2], client_b, client_b) and owner() == 0
    assert invoke(1, client_b) == 1 and owner() == client_b
    assert invoke(0, 1, 2, 3, 4) == client_a and owner() == 0
    busy[client_b] = 0
    assert invoke(1, client_b) == 0 and owner() == 0
    invoke(2, client_b)
    assert calls[-1] == (targets[2], client_b, 0) and owner() == 0


def main():
    manifest = json.loads((ASSETS / "tagBattleStabilizationManifest.json").read_text())
    for game, (_, _, _, hooks, targets) in GAMES.items():
        check(manifest["games"][game], hooks, targets)
        print(f"{game}: native call ABI, yielding, script ownership, teardown and next-battle reset passed")


if __name__ == "__main__":
    main()
