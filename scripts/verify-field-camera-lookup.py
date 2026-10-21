"""Execute the exported Thumb selector against actual camera archive member lengths.

Requires Unicorn. Native filesystem calls are intercepted, with their arguments
checked; the selector's branches, registers and stack run as ARM Thumb code.
"""
import json
import sys
from pathlib import Path
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R4, UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_PC

arm_path, lengths_path = map(Path, sys.argv[1:3])
arm = arm_path.read_bytes()
lengths = json.loads(lengths_path.read_text())
base, entry, stop, stack = 0x02004000, 0x02018e38, 0x02000100, 0x023f0000
prefix = int.from_bytes(arm[entry - base + 40:entry - base + 44], 'little')
uc = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
uc.mem_map(0x02000000, 0x400000)
uc.mem_write(base, arm)
remapped = None
calls = []
def native_call(cpu, address, size, _):
    if address == 0x020187ec:
        if remapped is not None:
            cpu.reg_write(UC_ARM_REG_R0, remapped)
    elif address == 0x0204a9e4:
        assert cpu.reg_read(UC_ARM_REG_R0) == 156
        cpu.reg_write(UC_ARM_REG_R0, len(lengths))
    elif address == 0x0204aa30:
        assert cpu.reg_read(UC_ARM_REG_R0) == 156
        index = cpu.reg_read(UC_ARM_REG_R1)
        assert 0 <= index < len(lengths), index
        calls.append(index)
        cpu.reg_write(UC_ARM_REG_R0, lengths[index])
    else:
        return
    cpu.reg_write(UC_ARM_REG_PC, cpu.reg_read(UC_ARM_REG_LR))
uc.hook_add(UC_HOOK_CODE, native_call)
checks = 0
for zone in [*range(2048), 65535]:
    for remapped in [None, 427]:
        calls.clear()
        uc.reg_write(UC_ARM_REG_R0, zone)
        uc.reg_write(UC_ARM_REG_R4, 0x12345678)
        uc.reg_write(UC_ARM_REG_SP, stack)
        uc.reg_write(UC_ARM_REG_LR, stop | 1)
        uc.emu_start(entry | 1, stop, count=100)
        index = prefix + (zone if remapped is None else remapped)
        expected = index if index < len(lengths) and lengths[index] else 65535
        assert uc.reg_read(UC_ARM_REG_R0) == expected, (zone, remapped, expected)
        assert uc.reg_read(UC_ARM_REG_R4) == 0x12345678
        assert uc.reg_read(UC_ARM_REG_SP) == stack
        assert calls == ([index] if index < len(lengths) else [])
        checks += 1
print(f'Thumb execution passed: {checks} zone/substitution cases; empty and out-of-range slots use native fallback; callee registers and stack preserved.')
