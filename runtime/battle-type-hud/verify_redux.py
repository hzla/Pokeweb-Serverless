"""Execute all adapted Redux HUD styles against the supplied ROM's panel art.

Native engine services use the existing ABI fixtures. This does not boot a game.
"""
from pathlib import Path
import argparse, hashlib, json, os, shutil
import ndspy.rom, ndspy.narc, ndspy.lz10

HERE = Path(__file__).resolve().parent

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    args = parser.parse_args()
    os.environ['BTH_W2_ROM'] = str(args.rom.resolve())
    import verify as v
    from panel_expansion import apply_edits
    profile = json.loads((HERE / 'redux-profile.json').read_text())
    rom = ndspy.rom.NintendoDSRom.fromFile(args.rom)
    assert bytes(rom.idCode) == b'IRDO' and rom.version == 0
    archive = ndspy.narc.NARC(rom.getFileByName(profile['graphicsArchive']))
    raw = {int(n): bytes(archive.files[int(n)]) for n in profile['resources']}
    raw = {n: ndspy.lz10.decompress(data) if data[0] == 0x10 else data for n, data in raw.items()}
    for n, data in raw.items():
        assert hashlib.sha256(data).hexdigest() == profile['resources'][str(n)]['nativeSha256']
    scratch = HERE / 'build/redux-fixtures'
    (scratch / 'build').mkdir(parents=True, exist_ok=True)
    shutil.copyfile(HERE / 'profile-W2.json', scratch / 'profile-W2.json')
    for n, data in raw.items():
        (scratch / 'build' / f'W2-resource-{n}.bin').write_bytes(data)
    for module in ('TypeIcons', 'TypeIconsCircular', 'TypeIconsSolid'):
        for suffix in ('.dll', '.debug.dll'):
            name = f'{module}ReduxW2{suffix}'
            shutil.copyfile(HERE / 'build' / name, scratch / 'build' / name)
    v.HERE = scratch
    v.transform = lambda data, unused: apply_edits(data, profile['panelExpansion']['438']['edits'])
    reports = {}
    for module, assets in (('TypeIcons', 'assets.json'), ('TypeIconsCircular', 'assets-circular.json'), ('TypeIconsSolid', 'assets-solid.json')):
        v.ASSETS = json.loads((HERE / assets).read_text())
        h = v.Harness('W2', module + 'Redux')
        # Redux reserves extra unused triple-enemy tiles. The unchanged NCER
        # displays only the original 72 tiles; include that entire visible area.
        h.raw[(2, 1)] = h.raw[(2, 1)][:2304]
        cases = 0
        for layout, pos in ((0, 0), (0, 1), (1, 2), (1, 3), (2, 2), (2, 3)):
            for typ in range(18):
                for pair in ((typ, typ), (typ, (typ + 1) % 18)):
                    h.add(pos, pair, layout)
                    h.check(pos, pair, layout)
                    h.invoke('Main', v.G)
                    h.check(pos, pair, layout)
                    cases += 1
            for condition in range(1, 7):
                h.invoke('Status', v.G, condition, pos)
                h.check(pos, pair, layout, status=True)
                h.invoke('Status', v.G, 0, pos)
                h.check(pos, pair, layout)
            for amount in (0, 8, 16):
                h.setfade(pos if pos < 2 else pos - 2, 0x7fff, amount)
                h.invoke('Main', v.G)
                h.check(pos, pair, layout)
            h.invoke('Del', v.G, pos)
        name = f'{module}ReduxW2.dll'
        reports[name] = dict(sha256=hashlib.sha256((HERE / 'build' / name).read_bytes()).hexdigest(),
            passed=True, typeAndLayoutCases=cases, statuses=6, fadeSteps=[0, 8, 16],
            exactImageComparison=True, abiRegistersAndStack=True, guardedVramWrites=True)
        print(f'{name}: {cases} type/layout cases, statuses, fades, repaint and teardown passed')
    report = dict(game='W2', profile='redux', gameplayTested=False, builds=reports)
    (HERE / 'build/redux-verification.json').write_text(json.dumps(report, indent=2) + '\n')

if __name__ == '__main__':
    main()
