"""Cold-boot each exported item fixture in DS-mode melonDS; no game stubs.

Requires the melonDS Python API and MELONDS_HEADLESS_LIB. All hooks observe the
native game; only normal keypad input changes emulated state. ROM/save inputs
are copied before use. Run verify_many.ts first.
"""
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from melonds import MelonDS


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('evidence', type=Path)
    parser.add_argument('--limit', type=int)
    parser.add_argument('--start', type=int, default=0)
    parser.add_argument('--max-frames', type=int, default=8000)
    args = parser.parse_args()
    if args.start < 0 or args.limit is not None and args.limit < 1 or args.max_frames < 1:
        parser.error('Start must be nonnegative; limit and frame bound must be positive.')
    manifest = json.loads((args.evidence / 'cases.json').read_text())
    rom = args.evidence / 'battle-100.nds'
    assert hashlib.sha256(rom.read_bytes()).hexdigest() == manifest['battleRomSha256']
    symbols = manifest['pmcSymbols']

    def symbol(fragment):
        matches = [value for name, value in symbols.items() if fragment in name]
        assert len(matches) == 1, fragment
        return matches[0]

    results = []
    selected = manifest['cases'][args.start:args.start + args.limit if args.limit else None]
    with tempfile.TemporaryDirectory(prefix='pokeweb-items-native-') as directory:
        copied = Path(directory) / 'battle.nds'
        if sys.platform != 'darwin' or subprocess.run(['cp', '-c', str(rom), str(copied)], stderr=subprocess.DEVNULL).returncode != 0:
            shutil.copyfile(rom, copied)
        for case in selected:
            save = args.evidence / 'saves' / f"{case['label']}.sav"
            save_hash = hashlib.sha256(save.read_bytes()).hexdigest()
            shutil.copyfile(save, copied.with_suffix('.sav'))
            emu = MelonDS()
            hooks, errors, menus = [], [], []
            flow_address = 0
            result = {'case': case['label'], 'itemId': case['itemId'], 'type': case['type'], 'divisor': case['divisor'],
                      'match': case['match'], 'expectedHp': case['expectedHp'], 'heapMinimumFree': {}}

            def heap_stats(fragment):
                heap = emu.memory.read_long(symbol(fragment))
                if not 0x02000000 <= heap < 0x02400000:
                    return None
                size = emu.memory.read_long(heap + 8)
                if size < 4096 or size > 1024 * 1024:
                    return None
                node, free, largest, seen = emu.memory.read_long(heap + 12), 0, 0, set()
                while node:
                    assert 0x02000000 <= node < 0x02400000 and node not in seen, 'Corrupt PMC free list'
                    seen.add(node)
                    amount = emu.memory.read_long(node)
                    assert amount <= size, 'Invalid PMC free block'
                    free += amount
                    largest = max(largest, amount)
                    node = emu.memory.read_long(node + 4)
                assert free <= size
                return {'capacity': size, 'freePayloadBytes': free, 'largestFreePayload': largest, 'freeBlocks': len(seen)}

            def sample_heaps():
                for name, fragment in [('system', 'g_MainAllocator'), ('bookkeeping', 'g_UserHeapArea')]:
                    stats = heap_stats(fragment)
                    if stats:
                        previous = result['heapMinimumFree'].get(name)
                        if previous is None or stats['freePayloadBytes'] < previous['freePayloadBytes']:
                            result['heapMinimumFree'][name] = stats

            def module_state(factory):
                node, states, shared = emu.memory.read_long(symbol('g_Modules')), [], []
                while node:
                    assert node not in states and len(states) < 1000, 'Corrupt PMC module chain'
                    states.append(node)
                    if emu.memory.read_long(node + 8) == factory - 32:
                        shared.append(node)
                    node = emu.memory.read_long(node + 24)
                assert len(shared) == 1, ('Expected one shared item module', states, shared, hex(factory))
                return {'totalPatchRecords': len(states), 'itemPatchRecords': len(shared)}

            def command(cpu, address):
                try:
                    flow, work = flow_address, emu.memory.register_arm9.r1
                    if not flow:
                        return
                    if emu.memory.read_long(work) != 0:
                        return
                    turn = emu.memory.read_long(flow + 16)
                    if menus and menus[-1]['turn'] == turn:
                        return
                    main = emu.memory.read_long(flow + 4)
                    poke = emu.memory.read_long(main + 0xc8 + 4)
                    current = {'turn': turn, 'frame': emu.frame_count, 'hp': emu.memory.read_short(poke + 0x10),
                               'maxHp': emu.memory.read_short(poke + 0xe), 'species': emu.memory.read_short(poke + 0xc)}
                    assert current['species'] == case['speciesId'], current
                    assert current['maxHp'] == case['maxHp'], current
                    if not menus:
                        assert current['hp'] == case['hp'], current
                        pointers = {emu.memory.read_long(row['address']) for row in manifest['assignments']}
                        assert len(pointers) == 1, 'Not all 100 assignments were linked to the shared factory'
                        factory = pointers.pop() & ~1
                        assert bytes(emu.memory.unsigned[factory:factory + 8]) == bytes.fromhex('0121016000487047')
                        table = emu.memory.read_long(factory + 8)
                        assert emu.memory.read_long(table) == 0x76
                        result['loader'] = module_state(factory)
                        result['factory'] = factory
                        result['battleHeaps'] = {name: heap_stats(fragment) for name, fragment in [('system', 'g_MainAllocator'), ('bookkeeping', 'g_UserHeapArea')]}
                    menus.append(current)
                except Exception as error:
                    errors.append(error)

            def opening(cpu, address):
                nonlocal flow_address
                flow_address = emu.memory.register_arm9.r6

            hooks += [emu.memory.register_exec(0x0219f5da, opening), emu.memory.register_exec(0x021cef18, command)]
            try:
                emu.open(copied)
                for _ in range(args.max_frames):
                    if menus:
                        emu.input.keypad_update(1 if emu.frame_count % 12 < 3 else 0)
                    emu.cycle()
                    if errors:
                        raise errors[0]
                    if emu.frame_count % 30 == 0:
                        sample_heaps()
                    if len(menus) >= 2:
                        break
                emu.input.keypad_update(0)
                assert len(menus) >= 2, f"No completed turn in {args.max_frames} frames: {menus}"
                assert menus[1]['hp'] == case['expectedHp'], menus
                assert result['heapMinimumFree']['bookkeeping']['capacity'] == 4096
                assert all(stats['freePayloadBytes'] > 0 for stats in result['heapMinimumFree'].values())
                result.update(passed=True, commandMenus=menus)
                if len(results) == 0 or case['type'] == 17 or not case['match'] or case['fullHp']:
                    emu.run_frames(20)
                    emu.screenshot().save(args.evidence / f"{case['label']}.png")
                assert hashlib.sha256(save.read_bytes()).hexdigest() == save_hash
                results.append(result)
                (args.evidence / f"{case['label']}-result.json").write_text(json.dumps(result, indent=2) + '\n')
                print(f"PASS {case['label']}: HP {menus[0]['hp']} -> {menus[1]['hp']}; {result['loader']['itemPatchRecords']} item module", flush=True)
            except Exception as error:
                emu.screenshot().save(args.evidence / f"{case['label']}-failure.png")
                result.update(passed=False, error=str(error), commandMenus=menus, pc=hex(emu.memory.register_arm9.pc))
                (args.evidence / f"{case['label']}-failure.json").write_text(json.dumps(result, indent=2) + '\n')
                raise
            finally:
                emu.destroy()
    report = {'passed': len(results), 'editedItemsInRom': 100, 'scope': 'Cold-boot DS-mode melonDS; native loader, item registration, turns and healing; no game-service stubs or hardware claim',
              'romSha256': manifest['battleRomSha256'], 'cases': results}
    target = args.evidence / f"emulator-{args.start}-{len(results)}.json"
    target.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: value for key, value in report.items() if key != 'cases'}), flush=True)


if __name__ == '__main__':
    main()
