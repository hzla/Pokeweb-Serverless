"""Execute the installed hooks with the US Gen 5 overlays in an ARM fixture."""
import json
from pathlib import Path
import struct

from unicorn import Uc, UC_ARCH_ARM, UC_HOOK_CODE, UC_MODE_THUMB
from unicorn.arm_const import (
    UC_ARM_REG_LR, UC_ARM_REG_PC, UC_ARM_REG_R0, UC_ARM_REG_R1,
    UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_SP,
)


HERE = Path(__file__).resolve().parent
CLIENT, PARTY, VM, CONTEXT = 0x02310000, 0x02311000, 0x02312000, 0x02313000
SEQ, STACK, STOP = 0x02314000, 0x0233f000, 0x0233f100
MONS = {slot: 0x02320000 + slot * 0x200 for slot in (0, 1, 3, 5)}
REGS = (UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3)

# Native callbacks reached by the fixture. Keys use the White 2 addresses
# passed to bind, and values are their White equivalents.
WHITE_CALLBACKS = {
    0x021b46b8: 0x021cf490, 0x021b9218: 0x021d3de4,
    0x0219bf14: 0x021b86d8, 0x021b4e38: 0x021cfc10,
    0x0219bdc0: 0x021b85a8, 0x0219d534: 0x021b9c20,
    0x0219d1c8: 0x021b98cc, 0x0219c638: 0x021b8dac,
    0x021bb3a8: 0x021d5b88, 0x021bbb04: 0x021d62e4,
    0x021bbb54: 0x021d6334, 0x021ce400: 0x021e8ba0,
    0x021badc4: 0x021d55a4, 0x021bb1f4: 0x021d59d4,
    0x021b4a64: 0x021cf83c, 0x021ab92c: 0x021c7dcc,
    0x021ab994: 0x021c7e34, 0x021bda60: 0x021d8218,
    0x0217fcfc: 0x021885dc, 0x021b476c: 0x021cf544,
}


class Battle:
    def __init__(self, game):
        fixture = json.loads((HERE / "build" / f"{game}-fixture.json").read_text())
        self.bw1 = len(game) == 1
        self.delta = {"B": 0x20, "B2": 0x40}.get(game, 0)
        self.dispatch_address = fixture["dispatchAddress"]
        client_shift = 8 if self.bw1 else 0
        self.return_offset = 0xe0 - client_shift
        self.cpu = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
        self.cpu.mem_map(0x02000000, 0x400000)
        for name in ("runtime", "battle", "ai"):
            self.cpu.mem_write(fixture[f"{name}Base"], bytes.fromhex(fixture["code" if name == "runtime" else name]))

        self.write(CLIENT + 0x120 - client_shift, PARTY)
        self.write(CLIENT + 0xf8 - client_shift, VM)
        self.cpu.mem_write(CLIENT + 0x124 - client_shift, b"\x01")
        self.write(CONTEXT + 0xb4, 0x02315000)
        self.write(CONTEXT + 0xb8, 0x02316000)
        for position, mon in MONS.items():
            self.cpu.mem_write(mon + 0x19, bytes([position]))
            self.cpu.mem_write(mon + 0x140, b"\x04")
            for index in range(4):
                self.cpu.mem_write(mon + 0x10a + 14 * index, struct.pack("<H", (position + 1) * 10 + index))

        self.events = [0x02330000 + 0x40 * i for i in range(4)]
        self.original_event_flags = (0x21, 0x61, 0x61, 0x21)
        self.write((0x021f3cd4 if self.bw1 else 0x021db1d8) - self.delta, self.events[0])
        for index, (address, pos) in enumerate(zip(self.events, (1, 3, 5, 0))):
            self.write(address + 4, self.events[index + 1] if index < 3 else 0)
            self.write(address + 0x10, 5 if index & 1 else 4)
            self.cpu.mem_write(address + 0x3b, bytes([pos]))
            self.cpu.mem_write(address + 0x1b, bytes([self.original_event_flags[index]]))

        self.damage = {move: move - 14 for move in self.moves()}
        self.status_moves = set()
        self.immune_moves = set()
        self.basic = {}
        self.expert = {}
        self.flags = 7
        self.legal = {position: (1, 1, 1, 1) for position in (1, 3, 5)}
        self.fainted = set()
        self.continuation = 0
        self.with_item = False
        self.style = 3
        self.yielded = set()
        self.script_calls = []
        self.damage_calls = []
        damaging = {"B": 0x0201c314, "W": 0x0201c330, "B2": 0x0202186c, "W2": 0x02021898}
        self.stubs = {
            (0x02011324 if self.bw1 else 0x020159dc): lambda _: CONTEXT,
            damaging[game]: lambda args: args[0] not in self.status_moves,
        }
        self.end = False
        if not self.bw1:
            self.bind(0x0219c9c8, lambda _: 0)  # Studio mode
        self.bind(0x021b46b8, lambda _: 0)  # Forced action
        self.bind(0x021b9218, lambda _: self.with_item)
        self.bind(0x0219bf14, lambda _: 1)
        self.bind(0x021b4e38, lambda _: 0)  # Reserve switch
        self.bind(0x0219bdc0, lambda _: self.style)
        self.bind(0x0219d534, lambda args: MONS.get(2 * args[1] + 1, 0))
        self.bind(0x0219d1c8, lambda args: MONS[args[1]])
        self.bind(0x0219c638, lambda args: args[2])
        self.bind(0x021bb3a8, lambda args: not args[0] or self.mon_id(args[0]) in self.fainted)
        self.bind(0x021bbb04, lambda args: args[0] == MONS[3] and args[1] == 25 and self.continuation != 0)
        self.bind(0x021bbb54, lambda _: self.continuation)
        self.bind(0x021ce400, lambda args: args[0])
        self.bind(0x021badc4, lambda _: 0)
        self.bind(0x021bb1f4, lambda args: 100 if args[:2] == (MONS[0], 13) else 0)
        self.bind(0x021b4a64, self.selectable)
        self.bind(0x021ab92c, lambda args: int(args[3] not in self.immune_moves) * 3)
        self.bind(0x021ab994, self.estimate)
        self.bind(0x021bda60, lambda _: 0)  # Automatic Struggle target
        self.bind(0x0217fcfc, self.run_scripts)
        # Native AI uses these ARM9 functions for VM bookkeeping and its final tie roll.
        arm9_calls = (0x0203f0c0, 0x020870e8, 0x0209c06c) if self.bw1 else (0x02043f58, 0x0207bb38, 0x0208d638)
        arm9_delta = {"B": 0x18, "B2": 0x2c}.get(game, 0)
        for addr in arm9_calls:
            self.stubs[addr - arm9_delta] = lambda _: 0
        self.cpu.hook_add(UC_HOOK_CODE, self.dispatch)

    @staticmethod
    def moves():
        return [move for position in (1, 3, 5) for move in range((position + 1) * 10, (position + 1) * 10 + 4)]

    def mon_id(self, mon):
        return self.cpu.mem_read(mon + 0x19, 1)[0]

    def read(self, address):
        return struct.unpack("<I", self.cpu.mem_read(address, 4))[0]

    def write(self, address, value):
        self.cpu.mem_write(address, struct.pack("<I", value))

    def bind(self, address, callback):
        base = WHITE_CALLBACKS[address] if self.bw1 else address
        self.stubs[base - self.delta] = callback

    def dispatch(self, uc, address, _size, _):
        if address == STOP:
            self.end = True
            uc.emu_stop()
            return
        stub = self.stubs.get(address)
        if stub:
            args = tuple(uc.reg_read(reg) for reg in REGS)
            result = stub(args)
            uc.reg_write(UC_ARM_REG_R0, result)
            uc.reg_write(UC_ARM_REG_R1, 0)
            uc.reg_write(UC_ARM_REG_PC, uc.reg_read(UC_ARM_REG_LR))

    def selectable(self, args):
        _, mon, ptr, _ = args
        legal = self.legal[self.mon_id(mon)]
        self.cpu.mem_write(ptr, bytes(legal))
        return next((index for index, allowed in enumerate(legal) if allowed), 4)

    def event_flags(self):
        return tuple(self.cpu.mem_read(address + 0x1b, 1)[0] for address in self.events)

    def assert_simulation(self, attacker):
        expected = tuple(0x21 if pos in (attacker, 0) else 0x61 for pos in (1, 3, 5, 0))
        assert self.event_flags() == expected, (attacker, self.event_flags(), expected)

    def estimate(self, args):
        flow, attacker, defender, move = args
        assert flow == 0x02315000
        self.assert_simulation(attacker)
        assert defender == 0
        sp = self.cpu.reg_read(UC_ARM_REG_SP)
        assert (self.read(sp), self.read(sp + 4)) == (1, 0)
        self.damage_calls.append(move)
        return self.damage[move]

    def run_scripts(self, args):
        _, context, _, _ = args
        assert context == CONTEXT
        attacker = self.cpu.mem_read(context + 0x94, 1)[0]
        assert self.cpu.mem_read(context + 0x95, 1) == b"\0"
        assert self.read(context + 0x40) == self.flags
        self.assert_simulation(attacker)
        script = self.cpu.mem_read(context + 0x45, 1)[0]
        assert script in (0, 2)
        self.script_calls.append((attacker, script))
        # Yield in a side Pokémon's Expert pass to exercise native VM continuation.
        if attacker == 3 and script == 2 and (attacker, script) not in self.yielded:
            self.yielded.add((attacker, script))
            self.cpu.mem_write(context + 0x44, b"\x10")
        else:
            effects = self.basic if script == 0 else self.expert
            for index in range(4):
                address = context + 4 + 4 * index
                move = (attacker + 1) * 10 + index
                self.write(address, max(0, self.read(address) + effects.get(move, 0)))
        return 0

    def run(self):
        self.write(CONTEXT + 0x40, self.flags)
        self.write(SEQ, 0)
        dispatch = self.read(self.dispatch_address)
        assert 0x02340000 <= dispatch < 0x02400000 and dispatch & 1
        for _ in range(24):
            self.end = False
            self.cpu.reg_write(UC_ARM_REG_R0, CLIENT)
            self.cpu.reg_write(UC_ARM_REG_R1, SEQ)
            self.cpu.reg_write(UC_ARM_REG_SP, STACK)
            self.cpu.reg_write(UC_ARM_REG_LR, STOP | 1)
            self.cpu.emu_start(dispatch, STOP + 2, count=50_000)
            assert self.end, "Callback did not return"
            assert self.cpu.reg_read(UC_ARM_REG_SP) == STACK
            assert self.event_flags() == self.original_event_flags
            if self.cpu.reg_read(UC_ARM_REG_R0):
                size = self.read(CLIENT + self.return_offset + 4)
                assert size in (4, 8)
                actions = self.read(CLIENT + self.return_offset)
                return tuple(self.read(actions + i) for i in range(0, size, 4))
        raise AssertionError("AI failed to finish")


def fight(move):
    return 1 | (move << 7)


def verify(game):
    case = Battle(game)
    assert case.run() == (0x36, fight(63))
    assert sorted(case.damage_calls) == case.moves()
    assert case.script_calls == [(1, 0), (1, 2), (3, 0), (3, 2), (3, 2), (5, 0), (5, 2)]

    case = Battle(game)
    case.damage[40] = 115
    case.status_moves.add(20)
    case.expert[20] = 3
    assert case.run() == (0x26, fight(40))
    case = Battle(game)
    case.damage[40] = 115
    case.status_moves.add(20)
    case.expert[20] = 5
    assert case.run() == (fight(20),)

    case = Battle(game)
    case.flags = 5
    case.damage[40] = 115
    case.status_moves.add(20)
    case.expert[20] = 3
    assert case.run() == (fight(20),)

    case = Battle(game)
    case.basic = {move: -10 for move in range(60, 64)}
    case.immune_moves.add(43)
    case.legal[3] = (1, 1, 0, 1)
    assert case.run() == (0x26, fight(41))
    assert 42 not in case.damage_calls and 43 not in case.damage_calls

    case = Battle(game)
    case.fainted.add(5)
    case.damage = dict.fromkeys(case.moves(), 30)
    assert case.run() == (fight(20),)
    assert set(case.damage_calls) == {20, 21, 22, 23, 40, 41, 42, 43}

    case = Battle(game)
    case.legal = dict.fromkeys(case.legal, (0, 0, 0, 0))
    assert case.run() == (fight(165),)

    case = Battle(game)
    case.continuation = 41
    case.legal = dict.fromkeys(case.legal, (0, 0, 0, 0))
    case.expert[41] = -100
    assert case.run() == (0x26, fight(41))
    assert case.damage_calls == [41]

    case = Battle(game)
    case.with_item = True
    assert case.run()[0] & 0xf == 2 and not case.script_calls

    case = Battle(game)
    case.style = 0
    case.legal = dict.fromkeys(case.legal, (0, 0, 0, 0))
    case.bind(0x021b476c, lambda _: 1)  # Native single-battle selection
    assert case.run() == (fight(165),) and not case.script_calls
    print(f"{game} installed ARM hooks passed selection, native action encoding, VM yield and event restoration checks.")


if __name__ == "__main__":
    for version in ("B", "W", "B2", "W2"):
        verify(version)
