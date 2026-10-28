"""Execute the Redux adapter's compiled repel and PC paths in the native ABI fixture.

Uses the existing native engine stubs; this is separate from emulator evidence.
"""
from pathlib import Path
import argparse, hashlib, json, shutil, struct, sys, types
import ndspy.rom, ndspy.codeCompression, ndspy.narc
from build import HERE, BUILD, TOOLS

sys.path.insert(0, str(HERE.parent / 'battle-type-hud'))
from rpm_read import read_rpm, thumb_bl

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    args = parser.parse_args()
    # Reuse the fixture definitions without executing its unrelated B2/W2 matrix.
    path = HERE / 'verify.py'
    prefix, marker, _ = path.read_text().partition('\nfor game in ("W2", "B2"):')
    assert marker, 'Native fixture entry point changed; audit the reusable prefix.'
    fixture = types.ModuleType('cgear_native_fixture'); fixture.__file__ = str(path)
    exec(compile(prefix, str(path), 'exec'), fixture.__dict__)
    out = BUILD / 'redux'; scratch = out / 'cpu'; scratch.mkdir(exist_ok=True)
    for name, source in [('CGearQuickActionsW2.o','CGearQuickActionsReduxW2.o'), ('runtimeW2.o','runtime.o'), ('memoryW2.o','memory.o')]:
        shutil.copyfile(out / source, scratch / name)
    fixture.BUILD = scratch
    rom = ndspy.rom.NintendoDSRom.fromFile(args.rom)
    arc = ndspy.narc.NARC(rom.getFileByName('a/0/5/6'))
    fixture.retailImages = lambda game: (rom.arm9RamAddress, bytes(ndspy.codeCompression.decompress(rom.arm9)),
        tuple((o.ramAddress, bytes(o.data)) for o in rom.loadArm9Overlays([12,36,79]).values()), bytes(arc.files[1244]), bytes(arc.files[1247]))
    h = fixture.Harness('W2')
    # The native constructor selects entry 0 from Redux's sixteen-entry script.
    create = h.scriptCreate
    def redux_script_create(arguments):
        event = create(arguments)
        if event and arguments[1] == 10090:
            scripts, vm, code, _ = h.pcOwned[event]
            h.put(vm + 32, code + 66)
        return event
    h.functions[h.ov(0x21536ac)] = redux_script_create
    h.configure([(60000,1,0,0,255,60,116,0,0), (60001,2,0,0,255,196,116,0,0)])
    h.call('QaCGearInit', fixture.SUB); h.call('QaCGearUpdate', fixture.SUB, 1)
    flag, getter, pointer = 3063, 0x20191d8, 0x2019278
    assert h.call(getter, h.flagWork, flag) == 0
    byte = h.call(pointer, h.flagWork, flag)
    before = bytes(h.uc.mem_read(byte - 8, 17))
    options = bytes(h.uc.mem_read(fixture.CONFIG, 4))
    # Link and call the original Redux hook, retaining its r4 game-data ABI.
    repel = read_rpm(rom.getFileByName('patches/ToggleRepel.dll'))
    code = bytearray(repel['code']); base = 0x02378000; wrapper = base + 256
    for relocation in repel['relocations']:
        if relocation['module'] == 'base':
            at = relocation['address']; target = repel['symbols'][relocation['symbol']]['address']
            code[at:at + 4] = thumb_bl(base + at, target)
    h.write(base, bytes(code))
    h.write(wrapper, bytes.fromhex('10b5041c') + thumb_bl(wrapper + 4, base) + bytes.fromhex('10bd'))
    assert h.call(wrapper, fixture.GAME) == 1
    for _ in range(4):
        h.press(60,116); h.call('QaCGearEvent', fixture.SUB, 1); h.release()
        assert h.call(getter, h.flagWork, flag) == 1
        assert h.call(wrapper, fixture.GAME) == 0
        after = bytearray(before); after[8] ^= 1 << (flag & 7)
        assert bytes(h.uc.mem_read(byte - 8, 17)) == after
        assert bytes(h.uc.mem_read(fixture.CONFIG, 4)) == options
        # Redux's own script/native flag setter is reflected by the next draw.
        h.call(0x201922c, h.flagWork, flag)
        h.call('QaCGearUpdate', fixture.SUB, 1)
        assert h.call(getter, h.flagWork, flag) == 0 and h.call(wrapper, fixture.GAME) == 1
    # Verify the PC invocation retains all 3220 source bytes and the entry PC.
    for _ in range(10):
        h.press(196,116); event = h.call('QaCGearEvent', fixture.SUB, 1); h.release()
        assert event
        scripts, vm, code, _ = h.pcOwned[event]
        assert h.word(vm + 32) == code + 66
        assert bytes(h.uc.mem_read(code, len(h.pcScript))) == h.pcScript
        h.call('QaCGearExit', fixture.SUB)
        assert code in h.allocations
        h.eventDelete(event)
        assert not h.allocations
        h.call('QaCGearInit', fixture.SUB); h.call('QaCGearUpdate', fixture.SUB, 1)
    h.call('QaCGearExit', fixture.SUB)
    assert not h.allocations
    # C-Gear disable/removal does not clear Redux's independently owned toggle.
    h.call(0x2019204, h.flagWork, flag)
    assert h.call(wrapper, fixture.GAME) == 0
    blob = (out / 'CGearQuickActionsReduxW2.dll').read_bytes(); rpm = read_rpm(blob)
    assert all(not (r['module']=='36' and r['address'] in (0x21824bc,0x21a0b2c)) for r in rpm['relocations'])
    report = dict(game='W2', profile='redux', dllSha256=hashlib.sha256(blob).hexdigest(),
        passed=True, sharedRepelFlag=flag, toggleCycles=4, originalReduxHookExecuted=True,
        unrelatedFlagBitsPreserved=True, optionsUnchanged=True, pcOpenCloseCycles=10,
        entireReduxPcScriptPreserved=True, allocationsReleased=True, abiRegistersAndStack=True,
        ownsRepelHooks=False, gameplayTested=False)
    (out / 'verification.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))

if __name__ == '__main__': main()
