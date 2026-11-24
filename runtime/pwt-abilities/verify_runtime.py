"""Exercise the generated Thumb hooks with stand-ins for the retail functions."""
import json
from pathlib import Path
import struct

from unicorn import Uc, UC_ARCH_ARM, UC_HOOK_CODE, UC_MODE_THUMB
from unicorn.arm_const import (
    UC_ARM_REG_LR, UC_ARM_REG_PC, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R4, UC_ARM_REG_SP,
)

HERE = Path(__file__).resolve().parent
RUNTIME = 0x02300000
WORK = 0x02310000
RETURN = RUNTIME + 0x1000
SOURCE, DATA, PARTY, STACK = (WORK + offset for offset in (0, 0x100, 0x200, 0xff0))


def check(game, runtime, archive, slot, personal_ability):
    shift = 0 if game == "W2" else -0x40
    arm_shift = 0 if game == "W2" else -0x2c
    read_set = 0x021627f0 + shift
    make_pokemon = 0x02162688 + shift
    get_ability = 0x0201ef48 + arm_shift
    set_hidden = 0x0201dac0 + arm_shift
    emu = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
    for address in (RUNTIME, RETURN, WORK, read_set & ~0xfff, get_ability & ~0xfff, set_hidden & ~0xfff):
        emu.mem_map(address, 0x1000)
    emu.mem_write(RUNTIME, bytes.fromhex(runtime["codeHex"]))
    original = bytearray(60)
    struct.pack_into("<H", original, 0, 479 | (2 << 11))
    struct.pack_into("<I", original, 0x10, 0x10203040)
    original[0x20] = 11
    emu.mem_write(SOURCE, bytes(original))

    calls = []

    def ret(result=0):
        emu.reg_write(UC_ARM_REG_R0, result)
        emu.reg_write(UC_ARM_REG_PC, emu.reg_read(UC_ARM_REG_LR))

    def intercept(_emu, address, _size, _data):
        r0, r1, r2 = (emu.reg_read(reg) for reg in (UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2))
        if address == read_set:
            assert (r0, r1, r2) == (archive, DATA, 7)
            calls.append("read")
            emu.mem_write(DATA + 10, bytes([(slot << 6) | 0x29]))
            ret()
        elif address == get_ability:
            assert (r0, r1, r2) == (479, 2, 25 + slot)
            calls.append("personal")
            ret(personal_ability)
        elif address == make_pokemon:
            assert (r1, r2) == (PARTY, 50)
            actual = bytearray(emu.mem_read(r0, len(original)))
            expected = original.copy()
            if archive in (250, 253, 256, 257):
                expected[0x39] = slot
                if slot in (1, 2) and 0 < personal_ability <= 255:
                    expected[0x20] = personal_ability
                    struct.pack_into("<I", expected, 0x10, 0x10203040 | ((slot - 1) << 16))
            assert actual == expected
            calls.append("make")
            ret()
        elif address == set_hidden:
            assert (r0, r1, r2) == (PARTY, 479, 2)
            calls.append("hidden")
            ret()

    emu.hook_add(UC_HOOK_CODE, intercept)
    for entry, arguments in zip(runtime["entries"], ((archive, DATA, 7), (SOURCE, PARTY, 50))):
        for reg, value in zip((UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R4), (*arguments, SOURCE)):
            emu.reg_write(reg, value)
        emu.reg_write(UC_ARM_REG_LR, RETURN | 1)
        emu.reg_write(UC_ARM_REG_SP, STACK)
        emu.emu_start((RUNTIME + entry) | 1, RETURN, count=1000)
        assert emu.reg_read(UC_ARM_REG_SP) == STACK
    marked = archive in (250, 253, 256, 257) and slot != 0
    assert calls == ["read", *(["personal"] if marked else []), "make",
                     *(["hidden"] if marked and slot == 3 and 0 < personal_ability <= 255 else [])]


for game, runtime in json.loads(HERE.joinpath("runtimes.json").read_text()).items():
    for archive in (211, 250, 253, 256, 257):
        for slot in range(4):
            for ability in (0, 59, 256):
                check(game, runtime, archive, slot, ability)
    print(f"{game}: 60 Thumb cases passed")
