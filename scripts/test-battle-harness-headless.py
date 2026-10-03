"""Cold-boot a generated battle harness in headless melonDS without startup input.

Uses the melonDS Python API and MELONDS_HEADLESS_LIB supplied by the caller.
The ROM and save are copied to a temporary directory before starting the core.
Optional completion testing supplies A only after the battle opening.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile


def decode_mon(encrypted):
    data = bytearray(encrypted)
    pid, = struct.unpack_from('<I', data)
    checksum, = struct.unpack_from('<H', data, 6)
    def crypt(start, end, seed):
        for at in range(start, end, 2):
            seed = (seed * 0x41c64e6d + 0x6073) & 0xffffffff
            value, = struct.unpack_from('<H', data, at)
            struct.pack_into('<H', data, at, value ^ (seed >> 16))
    crypt(8, 136, checksum)
    crypt(136, 220, pid)
    blocks = bytes(data[8:136])
    # PK5's block-order numbering differs from lexicographic permutations.
    orders = ('ABCD ABDC ACBD ACDB ADBC ADCB BACD BADC CABD DABC CADB DACB '
              'BCAD BDAC CBAD DBAC CDAB DCAB BCDA BDCA CBDA DBCA CDBA DCBA').split()
    permutation = [ord(letter) - ord('A') for letter in orders[((pid >> 13) & 31) % 24]]
    data[8:136] = b''.join(blocks[i * 32:(i + 1) * 32] for i in permutation)
    assert sum(struct.unpack_from('<64H', data, 8)) & 0xffff == checksum, f'PK5 checksum mismatch (PID {pid:#x}, flags {data[4:6].hex()}, expected {checksum:#x}, header {bytes(encrypted[:20]).hex()})'
    return {
        'speciesId': struct.unpack_from('<H', data, 8)[0], 'form': data[0x40] >> 3,
        'level': data[0x8c], 'abilityId': data[0x15], 'itemId': struct.unpack_from('<H', data, 0xa)[0],
        'moves': list(struct.unpack_from('<4H', data, 0x28)), 'pp': list(data[0x30:0x34]),
        'currentHp': struct.unpack_from('<H', data, 0x8e)[0], 'maxHp': struct.unpack_from('<H', data, 0x90)[0],
        'status': struct.unpack_from('<I', data, 0x88)[0],
    }


def run(rom, report, maximum, finish_battle=False):
    from melonds import MelonDS
    if report.suffix != '.json' or report == rom.with_suffix('.json'):
        raise ValueError('--report must be a separate .json file, not the build manifest')
    if maximum < 1:
        raise ValueError('--max-frames must be positive')
    manifest = json.loads(rom.with_suffix('.json').read_text())
    config = manifest['config']
    save = rom.with_suffix('.sav').read_bytes()
    assert hashlib.sha256(rom.read_bytes()).hexdigest() == manifest['romSha256']
    assert hashlib.sha256(save).hexdigest() == manifest['saveSha256']
    result = {'trainerId': config['trainerId'], 'rule': manifest['rule'], 'buttonsPressed': 0,
              'fieldInitializationsBeforeBattle': 0, 'seasonBannerCallsBeforeBattle': 0,
              'romSha256': manifest['romSha256'], 'saveSha256': manifest['saveSha256']}
    with tempfile.TemporaryDirectory(prefix='pokeweb-battle-headless-') as directory:
        copy = Path(directory) / 'battle.nds'
        cloned = os.uname().sysname == 'Darwin' and subprocess.run(['cp', '-c', str(rom), str(copy)], stderr=subprocess.DEVNULL).returncode == 0
        if not cloned:
            shutil.copyfile(rom, copy)
        copy.with_suffix('.sav').write_bytes(save)
        emu = MelonDS()
        callbacks = []
        errors = []
        battle_pointer = 0
        native_party = 0
        screen = 0
        try:
            def setup(cpu, address):
                nonlocal battle_pointer, native_party
                # The queued native battle procedure receives its complete
                # setup as r3. No field event or DTCM stack access is needed.
                if emu.memory.register_arm9.r1 != 167:
                    return
                bp = emu.memory.register_arm9.r3
                if not 0x02000000 <= bp < 0x02400000:
                    return
                trainer = emu.memory.read_long(bp + 0x4c)
                if not trainer:
                    return
                actual = emu.memory.read_long(trainer)
                assert actual == config['trainerId'], (actual, config['trainerId'])
                assert emu.memory.read_long(bp) == 1, 'Not a trainer battle'
                assert emu.memory.read_long(bp + 4) == manifest['rule']
                if 'playerParty' not in result:
                    battle_pointer = bp
                    game = emu.memory.read_long(emu.memory.register_arm9.r0 + 0x10)
                    data = emu.memory.read_long(game + 0x1c)
                    native_party = emu.memory.read_long(data + 0x194)
                    result['battleFrame'] = emu.frame_count
                    for key, offset in [('playerParty', 0x24), ('trainerParty', 0x28)]:
                        party = emu.memory.read_long(bp + offset)
                        count = emu.memory.read_long(party + 4)
                        assert 1 <= count <= 6
                        raw = emu.memory.unsigned[party:party + 8 + count * 220]
                        try:
                            result[key] = [decode_mon(raw[8 + i * 220:8 + (i + 1) * 220]) for i in range(count)]
                        except AssertionError:
                            report.parent.mkdir(parents=True, exist_ok=True)
                            report.with_suffix(f'.{key}-failure.bin').write_bytes(raw)
                            raise
                result['battleProcedureCalls'] = result.get('battleProcedureCalls', 0) + 1
            def opening(cpu, address):
                nonlocal screen
                if 'playerParty' in result:
                    result.setdefault('openingFrame', emu.frame_count)
                    screen = emu.memory.register_arm9.r0
                    result.setdefault('openingProcedure', hex(emu.memory.read_long(screen + 0xe4)))
            def placed(cpu, address):
                if 'openingFrame' in result and 'openingFinishedFrame' not in result:
                    result.setdefault('openingPokemonViews', []).append(emu.memory.register_arm9.r1)
            def status(cpu, address):
                if screen and 'openingFinishedFrame' not in result:
                    result.setdefault('openingStatusPositions', []).append((emu.memory.register_arm9.r0-screen-0x48)//12)
            def trainer_model(cpu, address):
                if 'openingFrame' in result and 'openingFinishedFrame' not in result:
                    result['openingTrainerModels'] = result.get('openingTrainerModels', 0) + 1
            def finished_opening(cpu, address):
                if 'openingFrame' in result:
                    result.setdefault('openingFinishedFrame', emu.frame_count)
            def command(cpu, address):
                if 'openingFinishedFrame' in result and emu.memory.read_long(emu.memory.register_arm9.r1) == 0:
                    result.setdefault('commandFrame', emu.frame_count)
            def checked(callback):
                def invoke(cpu, address):
                    try:
                        callback(cpu, address)
                    except Exception as error:
                        errors.append(error)
                return invoke
            def field(cpu, address):
                if 'battleFrame' not in result:
                    result['fieldInitializationsBeforeBattle'] += 1
            def season(cpu, address):
                if 'battleFrame' not in result:
                    result['seasonBannerCallsBeforeBattle'] += 1
            def freed(cpu, address):
                if battle_pointer and emu.memory.register_arm9.r0 == battle_pointer:
                    result['battleResult'] = emu.memory.read_long(battle_pointer + 0xa8)
                    result['battleSetupFreed'] = result.get('battleSetupFreed', 0) + 1
            def ready(cpu, address):
                game = emu.memory.register_arm9.r0
                if result.get('battleSetupFreed') and emu.memory.register_arm9.r1 in (0x0218189d,0x02181a69,0x02181cf1) \
                        and emu.memory.read_long(game + 0x20) and not emu.memory.read_long(game + 0x18):
                    result.setdefault('fieldReadyFrame', emu.frame_count)
            callbacks += [emu.memory.register_exec(0x02016e38, checked(setup)),
                          emu.memory.register_exec(0x021d12e0, checked(opening)),
                          emu.memory.register_exec(0x021df85c, checked(placed)),
                          emu.memory.register_exec(0x021d39cc, checked(status)),
                          emu.memory.register_exec(0x021df8cc, checked(trainer_model)),
                          emu.memory.register_exec(0x021d132c, checked(finished_opening)),
                          emu.memory.register_exec(0x021cef18, checked(command)),
                          emu.memory.register_exec(0x0217c980, checked(field)),
                          emu.memory.register_exec(0x0217ee98, checked(season)),
                          emu.memory.register_exec(0x02017c84, checked(freed)),
                          emu.memory.register_exec(0x02016dcc, checked(ready))]
            emu.open(copy)
            for _ in range(maximum):
                emu.cycle()
                if errors:
                    raise errors[0]
                if 'commandFrame' in result and emu.frame_count >= result['commandFrame'] + 30 and 'battleUiVisible' not in result:
                    display = emu.memory.read_long(0x04001000)
                    bottom = emu.screenshot().crop((0, 192, 256, 384))
                    colors = bottom.getcolors(256 * 192) or []
                    result['subDisplayControl'] = hex(display)
                    result['subMasterBrightness'] = emu.memory.read_short(0x0400106c)
                    result['subScreenColors'] = len(colors)
                    assert (display >> 16) & 3 == 1 and not display & 0x80, 'Battle sub-screen display output is disabled'
                    assert len(colors) >= 8, 'Battle bottom screen is blank or has no rendered UI'
                    result['battleUiVisible'] = True
                if finish_battle and 'openingFrame' in result:
                    # Drive Fight/first move and advance native text. Input is
                    # deliberately limited to completion tests, after boot.
                    held = (emu.frame_count - result['openingFrame']) % 12 < 3
                    emu.input.keypad_update(1 if held else 0)
                    result['buttonsPressed'] += int(held)
                    if 'fieldReadyFrame' in result:
                        emu.input.keypad_update(0)
                        emu.run_frames(180)
                        break
                elif result.get('battleUiVisible'):
                    break
            if errors:
                raise errors[0]
            assert 'commandFrame' in result, f'Battle did not reach its command menu within {maximum} frames'
            if manifest['nativeVerification'].get('openingPresentation') == 'direct-placement':
                views = [1, 0] if manifest['rule'] == 0 else list(range(2, 6 if manifest['rule'] == 1 else 8))
                assert result.get('openingPokemonViews') == views, 'Initial active Pokemon were not placed directly'
                assert len(set(result.get('openingStatusPositions', []))) == len(views), 'Initial HP bars were not all shown'
                assert result.get('openingTrainerModels', 0) == 0, 'Trainer introduction still ran'
            assert result['fieldInitializationsBeforeBattle'] == 0, 'Field initialized before the battle'
            assert result['seasonBannerCallsBeforeBattle'] == 0, 'Season banner ran before the battle'
            assert result['battleProcedureCalls'] == 1, 'Battle process started more than once'
            assert result.get('battleUiVisible'), 'Battle bottom-screen UI was not verified'
            if finish_battle:
                assert 'fieldReadyFrame' in result, f'Battle did not return to an idle field within {maximum} frames'
                assert result.get('battleSetupFreed') == 1, result
                count = emu.memory.read_long(native_party + 4)
                assert 1 <= count <= 6, 'Invalid party count after returning from battle'
                raw = emu.memory.unsigned[native_party + 8:native_party + 8 + count * 220]
                result['returnedParty'] = [decode_mon(raw[i * 220:(i + 1) * 220]) for i in range(count)]
                result['completedBattle'] = True
            # Native battle setup copies the active saved party without healing
            # or rebuilding it. Compare all battle-relevant fields, allowing
            # the engine to pick either valid redundant party save block.
            candidates = []
            for half in (0, 0x26000):
                count = save[half + 0x18e04]
                if 1 <= count <= 6:
                    try:
                        candidates.append([decode_mon(save[half + 0x18e08 + i * 220:half + 0x18e08 + (i + 1) * 220]) for i in range(count)])
                    except AssertionError:
                        pass
            assert result['playerParty'] in candidates, 'Native battle party differs from the prepared save'
            if config.get('trainer', {}).get('team'):
                team = config['trainer']['team']
                assert len(result['trainerParty']) == len(team)
                for requested, actual in zip(team, result['trainerParty']):
                    for key in ('speciesId', 'form', 'level', 'abilityId', 'itemId'):
                        if key in requested:
                            assert actual[key] == requested[key], (key, actual, requested)
                    if 'moves' in requested:
                        assert actual['moves'] == requested['moves'] + [0] * (4 - len(requested['moves']))
            result['verified'] = True
            result['finalFrame'] = emu.frame_count
            report.parent.mkdir(parents=True, exist_ok=True)
            emu.screenshot().save(report.with_suffix('.png'))
        except Exception as error:
            result['verified'] = False
            result['error'] = str(error)
            report.parent.mkdir(parents=True, exist_ok=True)
            emu.screenshot().save(report.with_suffix('.png'))
            report.write_text(json.dumps(result, indent=2) + '\n')
            raise
        finally:
            emu.destroy()
    report.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--max-frames', type=int, default=2400)
    parser.add_argument('--finish-battle', action='store_true', help='After automatic boot, press A to play Fight/first move through a simple battle and verify field return')
    args = parser.parse_args()
    run(args.rom.resolve(), args.report.resolve(), args.max_frames, args.finish_battle)
