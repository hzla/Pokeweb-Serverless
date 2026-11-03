"""Exercise shipped ARM status dispatch with isolated native-service doubles.

This is a fast runtime regression, separate from native DS gameplay tests.
Requires the local Python unicorn package; it makes no network requests.
"""
import json, sys
from pathlib import Path
import struct
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_LR, UC_ARM_REG_SP

ROOT = Path(__file__).resolve().parents[2]
BUNDLE = json.loads((ROOT / "src/assets/data/abilityRuleRuntimeStatSource.json").read_text())
if "--compact" in sys.argv:
    BUNDLE = {key: variants["4"] for key, variants in json.loads((ROOT / "src/assets/data/abilityRuleRuntimeCompact.json").read_text()).items()}
BASE, API, DATA, ITEM, FLOW, WORK, STACK, STOP = 0x100000, 0x200000, 0x312000, 0x310000, 0x311000, 0x314000, 0x410000, 0x20f000
TRIGGERS = [(0, 0x55), (1, 0x77), (2, 0x85), (3, 0x4b), (4, 0x4b), (5, 0x91)]
U32 = lambda value: struct.pack("<I", value)


def exercise(template, status, trigger=2, chance=30, success=False, existing=0, dead=False, immune_type=None, extra=False, suppressed_trigger=False):
    module = BUNDLE[template]
    vm = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
    for start, size in [(BASE, 0x10000), (API, 0x10000), (0x300000, 0x20000), (0x400000, 0x20000)]:
        vm.mem_map(start, size)
    vm.mem_write(BASE, bytes(module["code"]))
    symbols = {s["name"]: s["address"] for s in module["symbols"] if s.get("name")}
    for relocation in module["relocations"]:
        source = module["symbols"][relocation["sourceSymbolIndex"]]
        target = relocation["target"]
        assert target["module"] == "base"
        site, dest = BASE + target["address"], BASE + source["address"]
        if target["type"] == "OFFSET":
            vm.mem_write(site, U32(dest | (source["type"] == "FUNCTION_THM")))
        else:
            assert target["type"] == "THUMB_BRANCH_LINK"
            delta = dest - site - 4
            vm.mem_write(site, struct.pack("<HH", 0xf000 | ((delta >> 12) & 0x7ff), 0xf800 | ((delta >> 1) & 0x7ff)))
    event = TRIGGERS[trigger][1]
    target = 0 if trigger in [0, 1, 5] else 1
    values = {2: 0, 3: 0 if trigger == 2 else 1, 4: 1 if trigger == 2 else 0, 5: 1, 6: 1, 0x32: 0 if suppressed_trigger else 10, 0x46: 0}
    effect = bytes([10, 0, status, 0, trigger, 0 if target == 0 else 2 if trigger == 2 else 1, chance, 0, *([0] * 8)])
    # One AND condition with no leaves is always true.
    record = bytes([1 + int(extra), 1, 0, 0, 128, 0, 0, 0]) + effect
    if extra:
        record += bytes([10, 0, 6, 0, trigger, effect[5], 100, 0, *([0] * 8)])
    data = bytearray(512) + record
    struct.pack_into("<H", data, 165 * 2, 512)
    vm.mem_write(DATA, bytes(data))
    vm.mem_write(BASE + symbols["AbilityRuleData"], U32(DATA))
    vm.mem_write(ITEM + 0x14, U32(2 << 24))
    popups, works, rolls = [], [], []

    def service(cpu, address, size, _):
        index = (address - API) // 16
        a, b, c = [cpu.reg_read(r) for r in [UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2]]
        result = 0
        if index == 0:
            result = values.get(a, 0)
        elif index == 2:
            result = 0x300000 + b * 0x200
        elif index == 3:
            result = 0 if dead and a == 0x300000 + target * 0x200 else 100
        elif index == 4:
            result = a
        elif index == 5:
            result = int(a == 0x300000 + target * 0x200 and b == immune_type)
        elif index in [7, 8]:
            pass
        elif index == 9:
            vm.mem_write(WORK, bytes(64))
            vm.mem_write(WORK, U32(b))
            result = WORK
        elif index == 10:
            works.append(bytes(vm.mem_read(b, 32)))
        elif index == 13:
            result = 165
        elif index == 20:
            popups.append(b)
        elif index == 24:
            result = 0xa0 | a
        elif index == 25:
            result = 0xbaad
        elif index == 26:
            vm.mem_write(b, U32(values.get(a, 0)))
            result = int(a in values)
        elif index == 27:
            rolls.append(a)
            result = int(success)
        elif index == 30:
            result = int(a == 0x300000 + target * 0x200 and b == existing)
        elif index == 31:
            result = 1  # Contact move.
        else:
            raise AssertionError(f"Unexpected service {index}")
        cpu.reg_write(UC_ARM_REG_R0, result)

    for index in range(43):
        vm.mem_write(API + index * 16, bytes.fromhex("7047"))
        vm.mem_write(BASE + symbols["AbilityRuleApi"] + index * 4, U32(API + index * 16 + 1))
    vm.hook_add(UC_HOOK_CODE, service, begin=API, end=API + 43 * 16 - 1)
    for register, value in [(UC_ARM_REG_R0, ITEM), (UC_ARM_REG_R1, FLOW), (UC_ARM_REG_R2, 0), (UC_ARM_REG_R3, 0), (UC_ARM_REG_SP, STACK), (UC_ARM_REG_LR, STOP | 1)]:
        vm.reg_write(register, value)
    vm.emu_start(BASE + symbols[f"AbilityEvent_{event:02x}"] | 1, STOP, count=100000)
    assert vm.reg_read(UC_ARM_REG_SP) == STACK
    return popups, works, rolls


count = 0
for template in ["abilityRuleRuntimeGrouped.json", "abilityRuleRuntimeLibraryGrouped.json"]:
    for status in range(1, 8):
        for trigger, _ in TRIGGERS:
            for chance, success in [(1, False), (30, False), (30, True), (100, True)]:
                popups, works, rolls = exercise(template, status, trigger, chance, success)
                assert popups == ([2, 3] if success else []), (template, status, trigger, chance, popups)
                assert len(works) == int(success)
                assert rolls == ([] if chance == 100 else [chance]), rolls
                if success:
                    assert struct.unpack_from("<I", works[0], 4)[0] == (5 if status == 7 else status)
                    assert works[0][15] == (0 if trigger in [0, 1, 5] else 1)
                count += 1
        for existing in [status if status < 7 else 5, 4 if status <= 5 or status == 7 else 6]:
            assert exercise(template, status, existing=existing) == ([], [], [])
            count += 1
        assert exercise(template, status, dead=True) == ([], [], [])
        count += 1
    for status, immune in [(3, 14), (4, 9), (5, 3), (5, 8), (7, 3), (7, 8)]:
        assert exercise(template, status, immune_type=immune) == ([], [], [])
        count += 1
    for trigger in [2, 3, 4]:
        assert exercise(template, 4, trigger, suppressed_trigger=True) == ([], [], [])
        count += 1
    # A failed first effect must not mask a subsequent success; successes share a popup.
    for success in [False, True]:
        popups, works, rolls = exercise(template, 4, extra=True, success=success)
        assert popups == [2, 3] and len(works) == 1 + int(success) and rolls == [30]
        count += 1
print(f"{count} shipped ARM status dispatch cases passed: all statuses/timings, single rolls, rejection guards and grouped effects.")
