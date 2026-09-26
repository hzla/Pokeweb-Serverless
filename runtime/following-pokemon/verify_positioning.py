"""Execute the packaged ROM positioning reader with bounded native FS spies."""
import struct

from unicorn import UC_HOOK_CODE
from unicorn.arm_const import UC_ARM_REG_LR, UC_ARM_REG_PC, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_SP
from verify_packaged import *

dll = PACKAGE_BUILD / "PokewebFollowingFieldW2.dll"
elf = PACKAGE_BUILD / "PokewebFollowingFieldW2.elf"
_, _, _, _, functions, _ = audit(dll, elf)
base, stop, stack, output = 0x02300000, 0x02008000, 0x023f0000, 0x02200000
cpu = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
cpu.ctl_set_cpu_model(UC_CPU_ARM_946)
cpu.mem_map(0x02000000, 0x400000)
cpu.mem_write(base, bytes(relocate(dll, base, load_dependencies(cpu))))

member = bytearray(24 + 2 * 12 + 3 * 8)
struct.pack_into("<IHHHBBIII", member, 0, 0x4f505746, 1, 2, 3, 12, 8, 0x12345678, 0x87654321, 0)
member[24:36] = bytes([1, 2, 3, 4, 9, 10, 11, 12, 13, 14, 15, 16])
member[36:48] = bytes([0, 0, 12, 12, 0, 1, 2, 3, 4, 5, 6, 7])
member[48:72] = bytes([0] * 8 + [255, 1, 254, 2, 253, 3, 252, 4] + [0] * 8)
archive = bytearray(struct.pack("<IHHIHH", 0x4352414e, 0xfeff, 1, 60 + len(member), 16, 3))
archive += struct.pack("<IIIII", 0x46415442, 20, 1, 0, len(member))
archive += struct.pack("<IIII", 0x464e5442, 16, 4, 0)
archive += struct.pack("<II", 0x46494d47, len(member) + 8) + member
assert len(archive) == 60 + len(member)
data = bytes(archive)
positions = {}


def file_spy(unit, pc, _size, _user):
    handle, arg1, amount = (unit.reg_read(reg) for reg in (UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2))
    result = 1
    if pc == 0x02070ca8:
        positions[handle] = 0
    elif pc == 0x02070ecc:
        assert bytes(unit.mem_read(arg1, 33)).split(b"\0", 1)[0] == b"rom:/following/positioning.narc"
        positions[handle] = 0
    elif pc == 0x02070dec:
        result = len(data)
    elif pc == 0x02070e54:
        result = int(amount == 0 and arg1 <= len(data))
        if result: positions[handle] = arg1
    elif pc == 0x02070e6c:
        start = positions[handle]
        chunk = data[start:start + amount]
        if chunk: unit.mem_write(arg1, chunk)
        positions[handle] += len(chunk)
        result = len(chunk)
    unit.reg_write(UC_ARM_REG_R0, result)
    unit.reg_write(UC_ARM_REG_PC, unit.reg_read(UC_ARM_REG_LR))


for address in (0x02070ca8, 0x02070ecc, 0x02070dec, 0x02070e54, 0x02070e6c, 0x02070de0):
    cpu.hook_add(UC_HOOK_CODE, file_spy, begin=address, end=address)


def call(name, *args):
    for register, value in zip((UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3), args):
        cpu.reg_write(register, value)
    cpu.reg_write(UC_ARM_REG_SP, stack)
    cpu.reg_write(UC_ARM_REG_LR, stop | 1)
    cpu.emu_start((base + functions[name][0]) | 1, stop, count=100000)
    assert cpu.reg_read(UC_ARM_REG_PC) == stop
    return cpu.reg_read(UC_ARM_REG_R0)


assert call("fwp_land", 0, 2, 0x12345678, output) == 1
assert bytes(cpu.mem_read(output, 12)) == member[24:36]
assert call("fwp_land", 1, 2, 0x12345678, output) == 1
assert bytes(cpu.mem_read(output, 12)) == member[36:48]
assert call("fwp_surf", 1, 3, output) == 1
assert bytes(cpu.mem_read(output, 8)) == member[56:64]
assert call("fwp_land", 0, 2, 0, output) == 0
assert call("fwp_surf", 3, 3, output) == 0
corrupt = bytearray(data); corrupt[60:64] = b"BAD!"; data = bytes(corrupt)
assert call("fwp_land", 0, 2, 0x12345678, output) == 0
assert call("fwp_surf", 1, 3, output) == 0
print("Packaged positioning reader passed direct land/Surf row lookup, catalog binding, bounds, and malformed-header rejection. Native FS mocked; no game emulator run.")
