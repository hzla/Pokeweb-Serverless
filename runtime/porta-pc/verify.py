"""Execute grid and rail hooks for both builds with Unicorn (pip install unicorn).

The model tests verify the DLL relocation tables; this harness applies those
checked BL sites and executes the compiled instructions through the native
function stubs and the caller's real stack frame/epilogue.
"""
from pathlib import Path
import struct
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import UC_CPU_ARM_946, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_R4, UC_ARM_REG_R5, UC_ARM_REG_R6, UC_ARM_REG_R7, UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_PC

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parents[1] / "src/assets/codeinjection"
CODE = 0x02300020
STACK = 0x023f0000
STOP = 0x02008000
REGS = [UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_R4, UC_ARM_REG_R5, UC_ARM_REG_R6, UC_ARM_REG_R7]

def bl(address, target):
    delta = target - address - 4
    assert -(1 << 22) <= delta < (1 << 22)
    return struct.pack("<HH", 0xf000 | ((delta >> 12) & 0x7ff), 0xf800 | ((delta >> 1) & 0x7ff))

for version, provider, hook, keys, heap, script in [
    ("W2", "grid", 0x0218188a, 0x0203df28, 0x02180500, 0x021536ac),
    ("W2", "rail", 0x02181ce8, 0x0203df28, 0x02180500, 0x021536ac),
    ("B2", "grid", 0x0218184a, 0x0203defc, 0x021804c0, 0x0215366c),
    ("B2", "rail", 0x02181ca8, 0x0203defc, 0x021804c0, 0x0215366c),
]:
    data = (ASSETS / f"PortaPC{version}.dll").read_bytes()
    u32 = lambda offset: struct.unpack_from("<I", data, offset)[0]
    header = u32(8)
    info = header + u32(header + 8)
    code = bytearray(data[u32(info + 16):u32(info + 16) + u32(info + 20)])
    assert len(code) == 48
    for offset, target in [(6, keys), (20, heap), (32, script)]:
        code[offset:offset+4] = bl(CODE + offset, target)
    for name, incoming_event, pressed in [
        ("no keys", 0, 0), ("other keys", 0, 0x401), ("Start", 0, 8),
        ("Start chord", 0, 0x208), ("existing event", 0x02201000, 8),
        ("existing event without Start", 0x02201000, 0),
    ]:
        uc = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
        uc.ctl_set_cpu_model(UC_CPU_ARM_946)
        uc.mem_map(0x02000000, 0x400000)
        uc.mem_write(CODE, bytes(code))
        uc.mem_write(hook, bl(hook, CODE))
        saved = [0x11110003 + i for i in range(5)] + [STOP | 1]
        uc.mem_write(STACK + 0x70, struct.pack("<6I", *saved))
        for i, reg in enumerate(REGS): uc.reg_write(reg, 0x22220000 + i)
        uc.reg_write(UC_ARM_REG_R0, incoming_event)
        uc.reg_write(UC_ARM_REG_SP, STACK)
        uc.reg_write(UC_ARM_REG_LR, 0x02009001)
        calls = []

        def intercept(emu, address, size, _):
            if address == STOP:
                emu.emu_stop()
                return
            if address not in (keys, heap, script): return
            assert emu.reg_read(UC_ARM_REG_SP) % 8 == 0, "Native call stack misaligned"
            calls.append(address)
            if address == keys:
                result = pressed
            elif address == heap:
                assert emu.reg_read(UC_ARM_REG_R0) == 0x22220004
                result = 0x2d
            else:
                assert [emu.reg_read(reg) for reg in REGS[:4]] == [0x22220005, 10090, 0, 0x2d]
                result = 0x02202000
            for reg in REGS[:4]: emu.reg_write(reg, 0xdeadbeef)
            emu.reg_write(UC_ARM_REG_R0, result)
            emu.reg_write(UC_ARM_REG_PC, emu.reg_read(UC_ARM_REG_LR))

        uc.hook_add(UC_HOOK_CODE, intercept)
        uc.emu_start(hook | 1, STOP, count=200)
        opens_pc = incoming_event == 0 and bool(pressed & 8)
        assert uc.reg_read(UC_ARM_REG_PC) == STOP
        assert uc.reg_read(UC_ARM_REG_R0) == (0x02202000 if opens_pc else incoming_event)
        assert uc.reg_read(UC_ARM_REG_SP) == STACK + 0x88
        assert [uc.reg_read(reg) for reg in REGS[3:8]] == saved[:5]
        assert calls == ([] if incoming_event else [keys, heap, script] if opens_pc else [keys])
        print(version, provider, name, "passed")
