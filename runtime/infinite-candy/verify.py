"""Execute the compiled party hooks in an ARM946 CPU model (pip install unicorn)."""
from pathlib import Path
import struct

from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import (
    UC_CPU_ARM_946, UC_ARM_REG_CPSR, UC_ARM_REG_LR, UC_ARM_REG_PC,
    UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3,
    UC_ARM_REG_R7, UC_ARM_REG_SP,
)

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parents[1] / "src/assets/codeinjection"
CODE = 0x02300020
POKELIST = 0x02310000
PARTY = 0x02311000
BAG = 0x02312000
STACK = 0x023f0000
STOP = 0x02008000
SUB_ITEM = 0x0200842c


def thumb_bl(address, target):
    displacement = target - address - 4
    assert -(1 << 22) <= displacement < (1 << 22)
    return struct.pack("<HH", 0xf000 | ((displacement >> 12) & 0x7ff), 0xf800 | ((displacement >> 1) & 0x7ff))


def code_from_dll(version):
    data = (ASSETS / f"InfiniteCandy{version}.dll").read_bytes()
    u32 = lambda offset: struct.unpack_from("<I", data, offset)[0]
    header = u32(8)
    info = header + u32(header + 8)
    code = bytearray(data[u32(info + 16):u32(info + 16) + u32(info + 20)])
    assert len(code) == 56
    code[0x2a:0x2e] = thumb_bl(CODE + 0x2a, SUB_ITEM)
    return code


def machine(code):
    uc = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
    uc.ctl_set_cpu_model(UC_CPU_ARM_946)
    uc.mem_map(0x02000000, 0x400000)
    uc.mem_write(CODE, bytes(code))
    uc.reg_write(UC_ARM_REG_SP, STACK)
    uc.reg_write(UC_ARM_REG_LR, STOP | 1)
    return uc


for version in ("B2", "W2"):
    code = code_from_dll(version)
    for item_id in (638, 622, 50, 777):
        uc = machine(code)
        uc.reg_write(UC_ARM_REG_R7, item_id)
        uc.emu_start(CODE | 1, STOP, count=30)
        assert uc.reg_read(UC_ARM_REG_PC) == STOP
        assert bool(uc.reg_read(UC_ARM_REG_CPSR) & (1 << 30)) == (item_id in (638, 622))

    for item_id in (622, 50, 1):
        uc = machine(code)
        uc.mem_write(POKELIST, struct.pack("<H", 0x34))
        uc.mem_write(POKELIST + 0x28c, struct.pack("<I", PARTY))
        uc.mem_write(PARTY + 4, struct.pack("<I", BAG))
        uc.reg_write(UC_ARM_REG_R0, POKELIST)
        uc.reg_write(UC_ARM_REG_R1, item_id)
        calls = []

        def intercept(emu, address, _size, _user):
            if address != SUB_ITEM:
                return
            calls.append(tuple(emu.reg_read(reg) for reg in (UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3)))
            emu.reg_write(UC_ARM_REG_R0, 1)
            emu.reg_write(UC_ARM_REG_PC, emu.reg_read(UC_ARM_REG_LR))

        uc.hook_add(UC_HOOK_CODE, intercept)
        uc.emu_start((CODE + 0x14) | 1, STOP, count=60)
        assert uc.reg_read(UC_ARM_REG_PC) == STOP
        assert calls == ([] if item_id == 622 else [(BAG, item_id, 1, 0x34)])
        assert uc.reg_read(UC_ARM_REG_R0) == (0 if item_id == 622 else 1)
    print(f"{version}: party routing and reusable item hook passed")
