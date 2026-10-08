"""Execute the shipped Thumb code and its PMC hook trampolines with Unicorn.

Native APIs are modeled at their Black 1 addresses. This is an isolated CPU
check, not a full DS boot or an in-game battle verification.
"""
import json
from pathlib import Path
import struct
import subprocess
import unittest
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_R4, UC_ARM_REG_R5, UC_ARM_REG_R6, UC_ARM_REG_R7, UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_PC

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
MODULE = json.loads(subprocess.check_output([
    "npm", "exec", "vite-node", "runtime/double-battle-fix/prepare-tests.ts"], cwd=REPO, text=True))
DATA, STACK, STOP = 0x03000000, 0x03008000, 0x02000000
FIELD, SYSTEM, ACTOR1, ACTOR2, EVENT, WORK, ENV, VM = [DATA + i * 0x100 for i in range(1, 9)]
REGS = [UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3]

class Harness:
    def __init__(self, battle_type=0, usable=2, partner=False, second=False, clash=True, pair2=False, actors=()):
        self.uc = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
        self.uc.mem_map(0x02000000, 0x00400000)
        self.uc.mem_map(DATA, 0x10000)
        self.uc.mem_write(MODULE["base"], bytes(MODULE["code"]))
        for hook in MODULE["hooks"]:
            self.uc.mem_write(hook["address"], bytes(hook["bytes"]))
        self.battle_type, self.usable = battle_type, usable
        self.partner, self.second, self.clash, self.pair2 = partner, second, clash, pair2
        self.actors = actors
        self.slots, self.events, self.initialized, self.variables = [], [], [], 0
        self.uc.hook_add(UC_HOOK_CODE, self.on_code)

    def read32(self, address): return struct.unpack("<I", self.uc.mem_read(address, 4))[0]
    def write32(self, address, value): self.uc.mem_write(address, struct.pack("<I", value))
    def setup(self, address, actor):
        self.uc.mem_write(address, struct.pack("<6I", actor, 0x12345678, 3, 3007, 7, 0xdeadbeef))

    def on_code(self, uc, address, _size, _data):
        if address == STOP:
            uc.emu_stop(); return
        args = [uc.reg_read(register) for register in REGS]
        result = None
        if address == 0x021ae1fc:
            assert args[0] == FIELD
            found = self.clash if not args[1] else self.second
            if found: self.setup(args[2], ACTOR1 if not args[1] else ACTOR2)
            result = int(found)
        elif address == 0x0215a4c8:
            assert args[0] == 7; result = self.battle_type
        elif address == 0x02188c80:
            assert args[0] == FIELD; result = SYSTEM
        elif address == 0x0218b6ac:
            assert args[0] == SYSTEM; result = self.usable
        elif address == 0x021ae8d4:
            assert args[:2] == [ACTOR1, 7]; result = ACTOR2 if self.partner else 0
        elif address == 0x021ae8b4:
            assert args[1:] == [ACTOR2, 0x12345678, 3]
            self.initialized.append(args[1]); self.setup(args[0], args[1]); result = 0
        elif address == 0x021ae930:
            assert args[:2] == [FIELD, ACTOR1]
            self.events.append(args[:2]); result = EVENT
        elif address == 0x0215a438:
            assert args[0] == EVENT
            self.slots.append((args[1], struct.unpack("<6I", uc.mem_read(args[2], 24)))); result = 0
        elif address == 0x0215a5f4:
            assert args[0] == ENV; result = WORK
        elif address == 0x02158f8c:
            assert args[0] == WORK; result = 3007
        elif address == 0x02159ae8:
            assert args[:2] == [VM, ENV]
            result = DATA + 0x1000 + self.variables * 2; self.variables += 1
        elif address == 0x0215a460:
            assert args[0] == 3007; result = 7
        elif address == 0x0215a4b4:
            assert args[0] == 7; result = int(self.battle_type == 1)
        elif address == 0x0215a4a0:
            assert args[0] == 3007; result = int(self.pair2)
        elif address == 0x0215a5ec:
            assert args[0] == ENV; result = SYSTEM
        elif address == 0x0216dd1c:
            assert args[0] == SYSTEM
            index = self.read32(args[2]); result = int(index < len(self.actors))
            if result:
                self.write32(args[1], DATA + 0x2000 + index * 0x100)
                self.write32(args[2], index + 1)
        elif address == 0x0216d5b8:
            index = (args[0] - DATA - 0x2000) // 0x100
            result = self.actors[index]
        if result is not None:
            uc.reg_write(UC_ARM_REG_R0, result)
            # Model caller-saved registers as clobbered to test the native ABI.
            for register in REGS[1:]: uc.reg_write(register, 0xa5a5a5a5)
            uc.reg_write(UC_ARM_REG_PC, uc.reg_read(UC_ARM_REG_LR))

    def call(self, address, *args):
        self.uc.reg_write(UC_ARM_REG_SP, STACK)
        self.uc.reg_write(UC_ARM_REG_LR, STOP | 1)
        saved = [UC_ARM_REG_R4, UC_ARM_REG_R5, UC_ARM_REG_R6, UC_ARM_REG_R7]
        for index, register in enumerate(saved): self.uc.reg_write(register, 0x11223300 + index)
        for register, arg in zip(REGS, args): self.uc.reg_write(register, arg)
        self.uc.emu_start(address | 1, STOP, count=10000)
        assert self.uc.reg_read(UC_ARM_REG_PC) == STOP, "Runtime did not return"
        assert self.uc.reg_read(UC_ARM_REG_SP) == STACK, "Stack not restored"
        for index, register in enumerate(saved): assert self.uc.reg_read(register) == 0x11223300 + index
        return self.uc.reg_read(UC_ARM_REG_R0)

class RuntimeTests(unittest.TestCase):
    def test_no_trainer(self):
        h = Harness(clash=False)
        self.assertEqual(h.call(0x021ae0cc, FIELD), 0)
        self.assertEqual(h.events, [])

    def test_single_npc_double(self):
        h = Harness(battle_type=1)
        self.assertEqual(h.call(0x021ae0cc, FIELD), EVENT)
        self.assertEqual([(slot, data[0], data[5]) for slot, data in h.slots], [(0, ACTOR1, 0)])
        self.assertEqual(h.initialized, [])

    def test_usable_party_gates_and_native_formats(self):
        cases = [(0, 1, False, 1, 0), (0, 2, True, 2, 2),
                 (1, 1, False, 0, None), (1, 2, False, 1, 0),
                 (1, 2, True, 2, 1), (2, 2, False, 0, None),
                 (2, 3, False, 1, 0), (3, 2, False, 0, None),
                 (3, 3, False, 1, 0), (4, 6, False, 0, None)]
        for battle_type, usable, paired, count, fmt in cases:
            with self.subTest(type=battle_type, usable=usable, paired=paired):
                h = Harness(battle_type, usable, partner=paired, second=paired)
                self.assertEqual(h.call(0x021ae0cc, FIELD), EVENT if count else 0)
                self.assertEqual(len(h.slots), count)
                self.assertEqual([data[5] for _, data in h.slots], [fmt] * count)

    def test_dialogue_types(self):
        cases = [(0, False, (), (0, 2, 24)), (1, False, (), (0, 2, 24)),
                 (1, False, (3007, 99), (0, 2, 24)),
                 (1, False, (3007, 99, 5007), (3, 5, 6)),
                 (1, True, (), (7, 9, 10)), (2, False, (), (0, 2, 24))]
        for battle_type, pair2, actors, expected in cases:
            with self.subTest(type=battle_type, pair2=pair2, actors=actors):
                h = Harness(battle_type=battle_type, pair2=pair2, actors=actors)
                self.assertEqual(h.call(0x021aebb0, VM, ENV), 0)
                self.assertEqual(struct.unpack("<3H", h.uc.mem_read(DATA + 0x1000, 6)), expected)

if __name__ == "__main__": unittest.main()
