"""Execute BW1 move-preview candidates with retail mechanics/state readers.

Drawing, view-to-battler mapping, cached move records and Hidden Power inputs
are instrumented ABI fixtures. Native type chart, current types, conditions,
ability/item/field readers and the mode getter execute unchanged. This is
compiled coverage of DS/extended-RAM fixtures, not live DSi acceptance.
"""
from collections import UserDict
import hashlib
import json
import os
from pathlib import Path
import struct

from unicorn import Uc, UC_ARCH_ARM, UC_MODE_ARM, UC_HOOK_MEM_WRITE
from unicorn.arm_const import UC_CPU_ARM_946
from configure_bw1 import HERE, WORKSPACE, load
from rpm_read import read_rpm, thumb_bl
from verify import Harness as Bw2Harness, BASE
from verify_moves import test


class LiveTypes(UserDict):
    def __init__(self, cpu):
        self.cpu = cpu
        super().__init__()

    def __setitem__(self, mon, pair):
        self.cpu.mem_write(mon + 0xf8, bytes(pair))
        super().__setitem__(mon, pair)


class Harness:
    put = Bw2Harness.put
    get = Bw2Harness.get
    invoke = Bw2Harness.invoke

    def __init__(self, game, module, extended=False):
        self.profile = json.loads((HERE / f'profile-MoveEffectiveness-{game}.json').read_text())
        self.c = Uc(UC_ARCH_ARM, UC_MODE_ARM)
        self.c.ctl_set_cpu_model(UC_CPU_ARM_946)
        for base, length in [(0x02000000, 0x1000000), (0x04000000, 0x10000), (0x05000000, 0x1000)]:
            self.c.mem_map(base, length)
        default = WORKSPACE / 'cleanblack.nds' if game == 'B' else Path.home() / 'Downloads/cleanroms/cleanwhite.nds'
        _, segments = load(os.environ.get(f'BTH_{game}_ROM', default), b'IRBO' if game == 'B' else b'IRAO')
        for base, data in segments.values():
            self.c.mem_write(base, bytes(data))
        for sig in self.profile['signatures']:
            assert bytes(self.c.mem_read(sig['address'], len(bytes.fromhex(sig['bytes'])))).hex() == sig['bytes']
        rpm = read_rpm((HERE / 'build' / f'{module}{game}.dll').read_bytes())
        debug = read_rpm((HERE / 'build' / f'{module}{game}.debug.dll').read_bytes())
        assert rpm['code'] == debug['code'] and rpm['bss'] == debug['bss'] == 28
        assert all(not symbol['attributes'] & 2 for symbol in rpm['symbols'])
        self.c.mem_write(BASE, rpm['code'] + bytes(rpm['bss']))
        self.entries = {}
        for relocation in rpm['relocations']:
            symbol = rpm['symbols'][relocation['symbol']]
            target = symbol['address'] + (0 if symbol['attributes'] & 4 else BASE)
            if symbol['type'] == 3:
                target |= 1
            if relocation['module'] == 'base':
                assert relocation['type'] == 'OFFSET'
                self.put(BASE + relocation['address'], target)
            else:
                assert relocation['module'] == '94'
                hook = next(h for h in self.profile['hooks'] if h['address'] == relocation['address'])
                self.entries.setdefault(hook['name'], []).append((relocation['type'], relocation['address'], target))
                self.c.mem_write(relocation['address'], thumb_bl(relocation['address'], target))
        assert sum(map(len, self.entries.values())) == 5
        self.state = BASE + next(s['address'] for s in debug['symbols'] if s['name'] == 'gBattleMoveHud')
        mode = self.profile['functions']['IsDsi']
        mode_state = self.get(mode + 68)
        self.put(mode_state + 28, 1)
        self.put(mode_state + 4, int(extended))
        self.liveTypes = LiveTypes(self.c)
        self.c.hook_add(UC_HOOK_MEM_WRITE, self.palette_write, begin=0x05000000, end=0x05000fff)

    def palette_write(self, cpu, access, address, size, value, user):
        assert size == 2 and address in [0x05000400 + i * 2 for i in (219, 220, 221)]


def main():
    checks = []
    for game in ('B', 'W'):
        for extended in (False, True):
            factory = lambda g, m: Harness(g, m, extended)
            result = test(game, factory, 0x00600000 if extended else 0)
            checks.append({'game': game, 'extendedRam': extended, 'compiledPassed': True,
                           'dsGameplayAccepted': False, 'dsiGameplayAccepted': False,
                           'dllSha256': hashlib.sha256((HERE / 'build' / f'MoveEffectiveness{game}.dll').read_bytes()).hexdigest(),
                           'checks': result})
            print(f'{game}/{"extended" if extended else "DS"}: five wrappers and retail mechanics fixtures passed; gameplay pending')
    (HERE / 'build/move-verification-bw1.json').write_text(json.dumps({
        'checks': checks, 'writableStateBytes': 28,
        'fixtureLimitations': __doc__.strip()}, indent=2) + '\n')


if __name__ == '__main__':
    main()
