#!/usr/bin/env python3
"""Execute exported native item callbacks with isolated game-service stubs.

Run verify-item-effects.ts first. Requires the Python unicorn package. This
checks the actual exported Thumb instructions and RPM relocations; it is not
a substitute for a complete game/emulator battle.
"""
import argparse
import json
from pathlib import Path

from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_PC


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('evidence', type=Path)
    args = parser.parse_args()
    report = json.loads((args.evidence / 'report.json').read_text())
    native = report['native']
    services = {address: name for name, address in native['calls'].items()}
    overlay = (args.evidence / 'overlay.bin').read_bytes()
    module = (args.evidence / 'type-healing.bin').read_bytes()
    cases = []

    def execute(kind, *, holder_type=5, hp=80, max_hp=160, category=1, owner=True, item_id=238):
        cpu = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
        cpu.mem_map(0x02000000, 0x400000)
        cpu.mem_write(native['base'], overlay)
        cpu.mem_write(native['moduleBase'], module)
        stop = 0x023FF000
        result = {'healing': [], 'multipliers': [], 'divisors': [], 'type_checks': [], 'queued': []}
        pending = []
        mon = 3
        param = 0x02303000

        def hook(uc, address, size, _):
            if address == stop:
                uc.emu_stop()
                return
            name = services.get(address)
            if name is None:
                return
            r0, r1 = uc.reg_read(UC_ARM_REG_R0), uc.reg_read(UC_ARM_REG_R1)
            value = 0
            if name == 'BattleEventVar_GetValue':
                value = (mon if owner else mon + 1) if r0 in (2, 3) else 33 if r0 == 0x12 else 0
            elif name == 'GetBattleMon':
                value = 0x02302000
            elif name == 'IsMonFullHP':
                value = int(hp == max_hp)
            elif name == 'BattleHandler_PushWork':
                pending.append(r1)
                result['queued'].append(r1)
                uc.mem_write(param, bytes(64))
                value = param
            elif name == 'BattleHandler_PopWork':
                work = pending.pop()
                if work == 5:
                    result['healing'].append(int.from_bytes(uc.mem_read(r1 + 4, 2), 'little'))
            elif name == 'DivideMaxHPZeroCheck':
                result['divisors'].append(r1)
                assert r1 != 0, 'Native callback supplied a zero divisor'
                value = max(1, max_hp // r1)
            elif name == 'PML_MoveGetCategory':
                value = category
            elif name == 'BattleEventVar_MulValue':
                result['multipliers'].append((r0, r1))
            elif name == 'GetPokeType':
                value = holder_type
            elif name == 'PokeTypePair_IsMatch':
                result['type_checks'].append(r1)
                value = int(r0 == r1)
            elif name == 'CommonGetItemParam':
                assert r1 == 2
                value = 16
            elif name == 'BattleEventItem_GetSubID':
                value = item_id
            uc.reg_write(UC_ARM_REG_R0, value)
            uc.reg_write(UC_ARM_REG_PC, uc.reg_read(UC_ARM_REG_LR))

        cpu.hook_add(UC_HOOK_CODE, hook)
        for register, value in [(UC_ARM_REG_R0, 0x02300000), (UC_ARM_REG_R1, 0x02300100),
                                (UC_ARM_REG_R2, mon), (UC_ARM_REG_R3, 0x02300200),
                                (UC_ARM_REG_SP, 0x023EF000), (UC_ARM_REG_LR, stop | 1)]:
            cpu.reg_write(register, value)
        cpu.emu_start(native[kind], stop, count=10000)
        assert cpu.reg_read(UC_ARM_REG_PC) == stop, 'Callback did not return cleanly'
        assert not pending
        if kind == 'factory':
            result['count'] = int.from_bytes(cpu.mem_read(0x02300000, 4), 'little')
            table = cpu.reg_read(UC_ARM_REG_R0)
            result['event'] = int.from_bytes(cpu.mem_read(table, 4), 'little')
            result['callback'] = int.from_bytes(cpu.mem_read(table + 4, 4), 'little')
        return result

    result = execute('factory')
    assert result['count'] == 1 and result['event'] == 0x76 and result['callback'] == native['typeHealing']
    cases.append('Relocated factory registers exactly its relocated healing callback')
    result = execute('leftovers')
    assert result['divisors'] == [8] and result['healing'] == [20]
    cases.append('Leftovers uses edited 1/8 HP divisor')
    assert execute('leftovers', hp=160)['healing'] == []
    assert execute('leftovers', owner=False)['healing'] == []
    cases.extend(['Full HP does not heal', 'Another battler does not heal'])
    assert execute('choiceBand')['multipliers'] == [(0x35, 7168)]
    assert execute('choiceBand', category=2)['multipliers'] == []
    assert execute('choiceBand', owner=False)['multipliers'] == []
    cases.extend(['Choice Band uses edited x1.75 multiplier', 'Special attacks bypass Choice Band', 'Another attacker bypasses Choice Band'])
    result = execute('typeHealing', holder_type=5)
    assert result['type_checks'] == [5] and result['divisors'] == [16] and result['healing'] == [10]
    cases.append('Relocated Rock-holder callback heals 1/16 HP')
    result = execute('typeHealing', holder_type=10)
    assert result['type_checks'] == [5] and result['queued'] == [] and result['healing'] == []
    cases.append('Non-Rock holder receives neither healing nor damage')
    assert execute('typeHealing', owner=False)['queued'] == []
    assert execute('typeHealing', max_hp=15)['healing'] == [1]
    cases.extend(['Another battler bypasses type healing', 'Small HP retains native minimum-one behavior'])
    for item_id in [639, 640, 0xffffffff]:
        result = execute('typeHealing', item_id=item_id)
        assert result['queued'] == [] and result['type_checks'] == []
        cases.append(f'Unconfigured/out-of-range item {item_id} bypasses the shared type matcher')
    output = {'passed': len(cases), 'cases': cases, 'scope': 'Exported native callbacks; game services stubbed; no full-game battle claim'}
    (args.evidence / 'native-result.json').write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps(output, indent=2))


if __name__ == '__main__':
    main()
