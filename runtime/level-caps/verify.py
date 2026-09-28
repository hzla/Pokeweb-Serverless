"""Exercise compiled BW2 cap code and the item trampoline in an ARM946 model.

Requires Unicorn (`python3 -m pip install unicorn`). Native game calls are
stubbed at the ELF relocation sites; all local compiled code runs unchanged.
"""
from pathlib import Path
import re
import struct
import subprocess

from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import (
    UC_CPU_ARM_946, UC_ARM_REG_LR, UC_ARM_REG_PC, UC_ARM_REG_R0, UC_ARM_REG_R1,
    UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_R4, UC_ARM_REG_R7, UC_ARM_REG_SP,
)

HERE = Path(__file__).resolve().parent
TOOLS = HERE.parents[2] / "toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin"
BASE = 0x02300020
PKM = 0x02310000
MON = 0x02311000
GAME = 0x02312000
BEACON = 0x02312500
EVENT = 0x02313000
CAP_PTR = 0x02314000
DAYCARE = 0x02315000
SAVE = 0x02316000
WORK = 0x02317000
STACK = 0x023f0000
STOP = 0x02008000
CONTINUE = 0x02008020


def command(name, *args):
    return subprocess.check_output([str(TOOLS / f"arm-none-eabi-{name}"), *map(str, args)], text=True)


def prepare(version):
    elf = HERE / f"build/HardLevelCaps{version}.elf"
    binary = HERE / f"build/HardLevelCaps{version}.text.bin"
    subprocess.run([str(TOOLS / "arm-none-eabi-objcopy"), "-O", "binary", "--only-section=.text", str(elf), str(binary)], check=True)
    code = bytearray(binary.read_bytes())
    symbols = {name: int(address, 16) for address, _kind, name in
               re.findall(r"^([0-9a-f]+) ([Tt]) (\S+)$", command("nm", "--defined-only", elf), re.M)}
    relocations = command("readelf", "--wide", "-r", elf)
    calls = [(int(offset, 16), name) for offset, name in
             re.findall(r"^([0-9a-f]{8})\s+\S+\s+R_ARM_THM_CALL\s+\S+\s+(\S+)$",
                        relocations, re.M)]
    externals = {offset: name for offset, name in calls if name not in symbols}
    for offset, name in calls:
        if name not in symbols:
            continue
        displacement = symbols[name] - offset - 4
        struct.pack_into("<HH", code, offset,
                         0xf000 | ((displacement >> 12) & 0x7ff),
                         0xf800 | ((displacement >> 1) & 0x7ff))
    assert len(externals) == 21, (version, externals)
    literal = int(re.search(r"^([0-9a-f]{8})\s+\S+\s+R_ARM_ABS32\s+\S+\s+PokeList_CanItemAfterPrologue$",
                            relocations, re.M).group(1), 16)
    struct.pack_into("<I", code, literal, CONTINUE | 1)
    return code, symbols, externals


def run(version, prepared, entry, cap, level, experience, item=622, gained=100, new_exp=1200, form=0, species=25):
    code, symbols, externals = prepared
    uc = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
    uc.ctl_set_cpu_model(UC_CPU_ARM_946)
    uc.mem_map(0x02000000, 0x400000)
    uc.mem_write(BASE, bytes(code))
    beacon = 0x02141800 if version == "B2" else 0x02141840
    uc.mem_write(beacon, struct.pack("<I", BEACON))
    uc.mem_write(BEACON + 4, struct.pack("<I", GAME))
    uc.mem_write(CAP_PTR, struct.pack("<H", cap))
    uc.mem_write(DAYCARE + 8, struct.pack("<I", SAVE))
    uc.mem_write(MON, struct.pack("<IIIHH", PKM, 0, experience, species, 0))
    uc.mem_write(MON + 24, bytes([level]))
    uc.mem_write(MON + 0x141, bytes([form]))
    uc.mem_write(WORK, struct.pack("<III", 100, 1, 2))
    uc.reg_write(UC_ARM_REG_SP, STACK)
    uc.reg_write(UC_ARM_REG_LR, STOP | 1)
    uc.reg_write(UC_ARM_REG_R0, gained if entry == "LevelCaps_ApplyBattleExp" else PKM if entry.startswith("THUMB_BRANCH_PokeList") else DAYCARE if entry == "THUMB_BRANCH_DayCare_CalcNewLevel" else PKM)
    uc.reg_write(UC_ARM_REG_R1, MON if entry == "LevelCaps_ApplyBattleExp" else item if entry.startswith("THUMB_BRANCH_PokeList") else 0)
    uc.reg_write(UC_ARM_REG_R2, WORK if entry == "LevelCaps_ApplyBattleExp" else 2)
    uc.reg_write(UC_ARM_REG_R3, 0x1234)
    uc.reg_write(UC_ARM_REG_R4, 0x12345678)
    recorded = []

    def intercept(emu, address, _size, _user):
        if address == CONTINUE:
            emu.emu_stop()
            return
        offset = address - BASE
        if offset not in externals:
            return
        name = externals[offset]
        r0 = emu.reg_read(UC_ARM_REG_R0)
        r1 = emu.reg_read(UC_ARM_REG_R1)
        r2 = emu.reg_read(UC_ARM_REG_R2)
        if name == "GameData_GetEventWork":
            assert r0 == GAME
            result = EVENT
        elif name == "EventWork_GetWkPtr":
            assert (r0, r1) == (EVENT, 16415)
            result = CAP_PTR
        elif name == "PassPower_ApplyEXP":
            result = r0 * 2
        elif name == "PML_UtilGetPkmLvExp":
            assert r0 == species and r1 == form
            result = {30: 1000, 100: 100000}[r2]
        elif name == "PokeParty_GetParam":
            assert r0 == PKM
            result = {0x05: species, 0x08: experience, 0x6F: form, 0x9E: level}[r1]
        elif name == "PokeParty_SetParam":
            recorded.append((name, r0, r1, r2))
            result = 0
        elif name == "DayCareSave_GetPkmStatus":
            assert r0 == SAVE
            result = 1
        elif name == "DayCareSave_GetPkm":
            assert r0 == SAVE
            result = PKM
        elif name == "DayCareSave_GetPkmStepCounter":
            assert r0 == SAVE
            result = 100
        elif name == "DayCare_CalcNewExp":
            result = r0 + 100
        elif name == "CalcLevelByExp":
            result = 30 if r2 >= 1000 else 29
        elif name == "DayCare_CommitPkmGrowth":
            recorded.append((name, r0, r1))
            result = 0
        else:
            raise AssertionError(name)
        emu.reg_write(UC_ARM_REG_R0, result)
        emu.reg_write(UC_ARM_REG_PC, (address + 4) | 1)

    uc.hook_add(UC_HOOK_CODE, intercept)
    if entry == "THUMB_BRANCH_LINK_DayCare_CommitPkmGrowth_0x58":
        uc.reg_write(UC_ARM_REG_R1, 8)
        uc.reg_write(UC_ARM_REG_R2, new_exp)
    if entry == "THUMB_BRANCH_LINK_DayCare_RemovePkm_0x28":
        uc.reg_write(UC_ARM_REG_R1, 100)
    if entry == "THUMB_BRANCH_PokeList_CanItemWithBattleStatsBeUsed":
        uc.reg_write(UC_ARM_REG_R7, MON)
    uc.emu_start((BASE + symbols[entry]) | 1, STOP, count=500)
    return uc, recorded


for version in ("B2", "W2"):
    prepared = prepare(version)
    for cap, level, exp, expected in ((0, 29, 950, 200), (30, 29, 950, 50), (30, 30, 950, 0), (30, 29, 1005, 0)):
        uc, _ = run(version, prepared, "LevelCaps_ApplyBattleExp", cap, level, exp)
        assert uc.reg_read(UC_ARM_REG_R0) == expected, (version, cap, level, exp)
        if level >= (cap or 100):
            assert uc.mem_read(WORK, 12) == bytes(12)
        else:
            assert uc.mem_read(WORK, 12) == struct.pack("<III", 100, 1, 2)
    uc, _ = run(version, prepared, "LevelCaps_ApplyBattleExp", 30, 29, 950, form=2)
    assert uc.reg_read(UC_ARM_REG_R0) == 50
    for item, level, target in ((622, 30, STOP), (622, 29, CONTINUE), (50, 30, CONTINUE),
                                (622, 11, CONTINUE), (622, 20, STOP)):
        cap = 20 if level in (11, 20) else 30
        species = 519 if level in (11, 20) else 25
        uc, _ = run(version, prepared, "THUMB_BRANCH_PokeList_CanItemWithBattleStatsBeUsed", cap, level, 950, item, species=species)
        assert uc.reg_read(UC_ARM_REG_PC) == target, (version, item, level, hex(uc.reg_read(UC_ARM_REG_PC)), hex(target), hex(uc.reg_read(UC_ARM_REG_LR)), hex(uc.reg_read(UC_ARM_REG_SP)))
        assert uc.reg_read(UC_ARM_REG_R4) == 0x12345678
        if target == STOP:
            assert uc.reg_read(UC_ARM_REG_SP) == STACK and uc.reg_read(UC_ARM_REG_R0) == 0
        else:
            assert uc.reg_read(UC_ARM_REG_SP) == STACK - 48
            assert uc.reg_read(UC_ARM_REG_R0) == PKM and uc.reg_read(UC_ARM_REG_R1) == item
            assert uc.reg_read(UC_ARM_REG_R2) == 0x12340000 and uc.reg_read(UC_ARM_REG_R7) == 2
    uc, calls = run(version, prepared, "THUMB_BRANCH_LINK_DayCare_RemovePkm_0x28", 30, 30, 950)
    assert calls == []
    uc, calls = run(version, prepared, "THUMB_BRANCH_LINK_DayCare_RemovePkm_0x28", 30, 29, 950)
    assert calls == [("DayCare_CommitPkmGrowth", PKM, 100)]
    uc, calls = run(version, prepared, "THUMB_BRANCH_LINK_DayCare_CommitPkmGrowth_0x58", 30, 29, 950)
    assert calls == [("PokeParty_SetParam", PKM, 8, 1000)]
    uc, calls = run(version, prepared, "THUMB_BRANCH_DayCare_CalcNewLevel", 30, 29, 950)
    assert uc.reg_read(UC_ARM_REG_R0) == 30
    print(f"{version}: compiled EXP, candy, and Day Care cap behavior passed")
