"""Cold-boot and exercise the Redux adapter using copied test ROM/save files."""
from pathlib import Path
import argparse, hashlib, json, shutil, struct, sys, tempfile
import ndspy.rom, ndspy.narc

HERE = Path(__file__).resolve().parent

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('fixture', type=Path)
    parser.add_argument('--library', required=True)
    parser.add_argument('--bindings', required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir()
    sys.path.insert(0, args.bindings)
    sys.path.insert(0, str(HERE.parent / 'battle-type-hud'))
    from melonds import MelonDS
    from rpm_read import read_rpm
    rom = ndspy.rom.NintendoDSRom.fromFile(args.fixture / 'test.nds')
    dll = bytes(rom.getFileByName('patches/CGearQuickActionsW2.dll'))
    rpm = read_rpm(dll)
    debug = read_rpm((HERE / 'build/redux/CGearQuickActionsReduxW2.debug.dll').read_bytes())
    assert debug['code'] == rpm['code']
    metadata = json.loads(ndspy.narc.NARC(rom.getFileByName('quick-actions/ui.narc')).files[13])
    buttons = metadata['applied']['buttons']
    points = {b['action']: (b['x'], b['y']) for b in buttons}
    source = next(r for r in rpm['relocations'] if r['module'] == '36' and r['address'] == 0x21cfa10)
    init_symbol = next(s for s in debug['symbols'] if s['name'] == 'QaCGearInit')
    session_symbol = next(s for s in debug['symbols'] if s['name'] == '_ZN12_GLOBAL__N_17sessionE')
    report = dict(game='W2', profile='redux', dllSha256=hashlib.sha256(dll).hexdigest(), wireless=False)
    with tempfile.TemporaryDirectory(prefix='redux-cgear-test-') as folder:
        target = Path(folder) / 'test.nds'
        shutil.copyfile(args.fixture / 'test.nds', target)
        shutil.copyfile(args.fixture / 'test.sav', target.with_suffix('.sav'))
        emu = MelonDS(args.library)
        def run(frames):
            emu.run_frames(frames)
            assert emu.memory.register_arm9.cpsr & 31 != 0x17, 'ARM9 data abort'
        def screen(name): emu.screenshot().save(args.out / (name + '.png'))
        def tap(point, wait=120):
            emu.input.touch_set_pos(*point); run(4); emu.input.touch_release(); run(wait)
        def key(value, wait=100):
            emu.input.keypad_update(value); run(4); emu.input.keypad_update(0); run(wait)
        def read(address, size): return emu.memory.unsigned[address:address + size]
        def session():
            pointer = emu.memory.read_long(source['address'])
            base = (pointer & ~1) - (init_symbol['address'] & ~1)
            assert 0x02000000 <= base < 0x02400000, 'Redux C-Gear hook is not installed'
            state = base + session_symbol['address']
            assert emu.memory.read_long(state) == 0x53415143, 'C-Gear session is not active'
            assert emu.memory.read_byte(state + 735) == 0, 'C-Gear runtime reported a failure'
            return state
        def active():
            state = session()
            assert emu.memory.read_byte(state + 160), 'C-Gear has not returned'
            sub = emu.memory.read_long(state + 4)
            field = emu.memory.read_long(sub + 20)
            system = emu.memory.read_long(field + 4)
            # Verified native Field_HasEvent -> System_HasEvent checks. The
            # C-Gear stays visible behind PC text while its inputs are blocked.
            assert not emu.memory.read_long(system + 0x18) and not emu.memory.read_byte(system + 0x35), 'Native field event is still running'
            return state
        try:
            emu.open(target); run(960)
            state = active()
            assert emu.memory.read_byte(state + 733) == len(buttons)
            sub = emu.memory.read_long(state + 4); field = emu.memory.read_long(sub + 20)
            game = emu.memory.read_long(field + 8); flag_work = emu.memory.read_long(game + 0x1ac)
            party = emu.memory.read_long(game + 0x194); before_party = read(party, 1328)
            flag = flag_work + 0x35e + (3063 >> 3); mask = 1 << (3063 & 7)
            before_flag = emu.memory.read_byte(flag)
            screen('cgear')
            for cycle in range(2):
                tap(points['repel'], 40)
                assert emu.memory.read_byte(flag) == before_flag ^ mask
                tap(points['repel'], 40)
                assert emu.memory.read_byte(flag) == before_flag
            report['repelToggleCycles'] = 2
            print('Repel button toggles the original Redux flag in game.', flush=True)
            for cycle in range(2):
                tap(points['pokenav'], 180)
                screen(f'pokenav-{cycle}')
                assert emu.memory.read_short(0x400100c) == 0x1f82, 'Pokenav did not enter its native screen'
                assert read(party, 1328) == before_party
                if cycle == 0: key(128, 20); key(64, 20)
                key(2, 180)
                active()
                assert read(party, 1328) == before_party
            report['pokenavOpenCloseCycles'] = 2
            report['partyUnchanged'] = True
            print('Pokenav opens, navigates and exits twice with unchanged party memory.', flush=True)
            tap(points['pc'], 150); screen('pc-entry')
            key(1, 100); screen('pc-menu')
            key(1, 150); screen('pc-storage-menu')
            for attempt in range(10):
                key(2, 90)
                try:
                    active()
                    break
                except AssertionError:
                    if attempt == 9: raise
            screen('pc-return'); report['pcOpenedAndReturned'] = True
            print('Redux PC menu opens and returns to C-Gear.', flush=True)
            # The original Redux menu's fourth entry toggles the same flag.
            tap(points['pc'], 150); key(1, 240)
            for _ in range(3): key(128, 50)
            screen('pc-repel-selected'); key(1, 240)
            # Redux changes its flag after the native explanation is dismissed.
            key(1, 100)
            assert emu.memory.read_byte(flag) == before_flag ^ mask, 'Redux PC toggle did not change the shared flag'
            for attempt in range(10):
                key(2, 90)
                try:
                    state = active()
                    break
                except AssertionError:
                    if attempt == 9: raise
            index = next(i for i, button in enumerate(buttons) if button['action'] == 'repel')
            pose = emu.memory.read_byte(state + 136 + index) >> 4
            assert pose == int(bool((before_flag ^ mask) & mask)), 'C-Gear did not reflect the native PC toggle'
            screen('repel-from-native-pc')
            tap(points['repel'], 40)
            assert emu.memory.read_byte(flag) == before_flag
            report['nativePcRepelSharesState'] = True
            print('Native Redux PC toggle and C-Gear repel state agree in both directions.', flush=True)
            tap(points['pokenav'], 180)
            assert emu.memory.read_short(0x400100c) == 0x1f82
            key(2, 180); active()
            assert read(party, 1328) == before_party
            report.update(pokenavAfterPc=True, runtimeFailure=0, frame=emu.frame_count, passed=True)
        except Exception as error:
            report.update(passed=False, error=str(error), frame=emu.frame_count)
            screen('failure')
            raise
        finally:
            emu.destroy()
            (args.out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')

if __name__ == '__main__': main()
