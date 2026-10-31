"""Compare emulated turn frames; optional read-only callback counts, no RAM writes."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
from melonds import MelonDS

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
parser.add_argument('--only')
parser.add_argument('--profile', action='store_true')
parser.add_argument('--turns', type=int, default=4)
args = parser.parse_args()
manifest = json.loads((args.directory / 'performance.json').read_text())
selected = set(args.only.split(',')) if args.only else None
for spec in manifest['cases']:
    if selected and spec['label'] not in selected:
        continue
    source = args.directory / spec['rom']
    assert hashlib.sha256(source.read_bytes()).hexdigest() == spec['sha256']
    with tempfile.TemporaryDirectory(prefix='ability-performance-') as temp:
        rom = Path(temp) / 'battle.nds'
        shutil.copyfile(source, rom)
        shutil.copyfile(args.directory / 'saves' / f"{spec['label']}.sav", rom.with_suffix('.sav'))
        emu = MelonDS()
        flow = 0
        menus = []
        counters = Counter()
        hooks = []
        code = 0
        errors = []
        selections = []
        execution = []

        def opening(cpu, address):
            global flow
            candidate = getattr(emu.memory.register_arm9, spec['flowRegister'])
            if 0x02000000 <= candidate < 0x02400000:
                flow = candidate

        def profile(name):
            def called(cpu, address):
                if menus:
                    mode = 'preview' if emu.memory.read_long(flow + 0x774) else 'live'
                    counters[f'{name}:{mode}'] += 1
            return called

        def move_event(cpu, address):
            regs = emu.memory.register_arm9
            if menus and selections and regs.r0 == flow and regs.r1 == 0x29 and not emu.memory.read_long(flow + 0x774):
                turn = len(menus) - 1
                if not any(v['turn'] == turn for v in execution):
                    execution.append({'turn': turn, 'frame': emu.frame_count})

        def command(cpu, address):
            global code
            try:
                if not flow:
                    return
                step = emu.memory.read_long(emu.memory.register_arm9.r1)
                if step:
                    return
                turn = emu.memory.read_long(flow + 16)
                if menus and menus[-1]['turn'] == turn:
                    return
                main = emu.memory.read_long(flow + 4)
                player = emu.memory.read_long(main + 0xcc)
                enemy = emu.memory.read_long(main + 0xe8)
                assert emu.memory.read_short(player + 0xc) == spec.get('speciesId', 321)
                assert emu.memory.read_short(player + 0x13c) == spec['ability']
                assert emu.memory.read_short(enemy + 0x13c) == spec['ability']
                assert emu.memory.read_short(player + 0x10) > 0
                if manifest.get('doubles'):
                    for offset in [0xcc, 0xd0, 0xe8, 0xec]:
                        mon = emu.memory.read_long(main + offset)
                        assert emu.memory.read_short(mon + 0x10) > 0
                        assert emu.memory.read_short(mon + 0x13c) == spec['ability']
                if not menus:
                    emu.screenshot().save(args.directory / f"{spec['label']}-first-menu.png")
                if not menus and spec['count']:
                    site = spec['hook'] + 2
                    high, low = emu.memory.read_short(site), emu.memory.read_short(site + 2)
                    assert high & 0xf800 == 0xf000 and low & 0xf800 == 0xf800
                    delta = ((high & 0x7ff) << 12) | ((low & 0x7ff) << 1)
                    if delta & 0x400000:
                        delta -= 0x800000
                    code = site + 4 + delta - spec['symbols']['AbilityDispatch']
                    assert 0x02000000 < code < 0x02400000
                    if args.profile:
                        tables = spec['symbols'].get('AbilityRuleEventTables')
                        if tables is not None:
                            table = emu.memory.read_long(code + tables + spec['ability'] * 4)
                            count = emu.memory.read_byte(code + spec['symbols']['AbilityRuleEventCounts'] + spec['ability'])
                            for i in range(count):
                                event = emu.memory.read_long(table + i * 8)
                                address = emu.memory.read_long(table + i * 8 + 4) & ~1
                                hooks.append(emu.memory.register_exec(address, profile(f'callback-{event:02x}')))
                        else:
                            for name, offset in spec['symbols'].items():
                                if name.startswith('AbilityEvent_'):
                                    hooks.append(emu.memory.register_exec(code + offset, profile('callback-' + name[13:])))
                menus.append({'turn': turn, 'frame': emu.frame_count,
                              'playerHp': emu.memory.read_short(player + 0x10),
                              'enemyHp': emu.memory.read_short(enemy + 0x10)})
            except Exception as error:
                errors.append(error)

        hooks.extend([emu.memory.register_exec(spec['opening'], opening),
                      emu.memory.register_exec(spec['command'], command),
                      emu.memory.register_exec(spec['probes']['BattleEvent_CallHandlersCore'], move_event)])
        if args.profile:
            for name, address in spec['probes'].items():
                hooks.append(emu.memory.register_exec(address, profile(name)))
        try:
            emu.open(rom)
            origin = emu.frame_count
            for _ in range(14000):
                frame = emu.frame_count
                if menus:
                    age = frame - menus[-1]['frame']
                    last_choice = 300 if manifest.get('doubles') else 140
                    emu.input.touch_release()
                    emu.input.keypad_update(1 if age > last_choice + 40 and age % 12 < 3 else 0)
                    if 60 <= age < 64 or manifest.get('doubles') and 220 <= age < 224:
                        emu.input.touch_set_pos(128, 85)
                    if 140 <= age < 144 or manifest.get('doubles') and 300 <= age < 304:
                        if last_choice <= age < last_choice + 4 and (not selections or selections[-1]['turn'] != len(menus) - 1):
                            selections.append({'turn': len(menus) - 1, 'frame': frame})
                        emu.input.touch_set_pos(64, 44)
                elif manifest['manualLaunch']:
                    age = frame - origin
                    emu.input.keypad_update(128 if 600 <= age < 602 else 1 if age % 12 < 3 else 0)
                emu.cycle()
                if errors:
                    raise errors[0]
                if len(menus) >= args.turns + 1:
                    break
            assert len(menus) >= args.turns + 1, menus
            result = {'case': spec['label'], 'rules': spec['count'], 'profiled': args.profile,
                      'romSha256': spec['sha256'], 'menus': menus,
                      'turnFrames': [b['frame'] - a['frame'] for a, b in zip(menus, menus[1:])],
                      'selections': selections, 'firstLiveTargetEvent': execution,
                      'selectionToTargetEventFrames': [v['frame'] - selections[v['turn']]['frame'] for v in execution],
                      'counts': dict(counters), 'moduleBase': code, 'passed': True}
            suffix = 'profile' if args.profile else 'timing'
            (args.directory / f"{spec['label']}-{suffix}.json").write_text(json.dumps(result, indent=2) + '\n')
            print(spec['label'], result['turnFrames'], flush=True)
        except Exception as error:
            emu.screenshot().save(args.directory / f"{spec['label']}-failure.png")
            (args.directory / f"{spec['label']}-failure.json").write_text(json.dumps({'error': repr(error), 'menus': menus}, indent=2))
            raise
        finally:
            for hook in hooks:
                hook.remove()
            emu.close()
