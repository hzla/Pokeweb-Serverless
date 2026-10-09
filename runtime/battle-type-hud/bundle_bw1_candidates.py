"""Bundle BW1 builds; changed profiles or DLLs require fresh DS acceptance."""
import hashlib
import json
import argparse
import sys
from pathlib import Path

import ndspy.narc
from configure_bw1 import HERE
from rpm_read import read_rpm
sys.path.insert(0, str(HERE.parent))
from bw1_release import ds_accepted

ASSETS = HERE.parents[1] / 'src/assets/codeinjection'
VARIANTS = [('letters', '', 'Hexagonal letters'), ('circular', 'Circular', 'Circular icons'),
            ('solid', 'Solid', 'Angular HUD wedges')]


def bundle_moves():
    manifest = json.loads((ASSETS / 'battleTypeHudManifest.json').read_text())
    verification = json.loads((HERE / 'build/move-verification-bw1.json').read_text())
    types = ['NULL', 'VALUE', 'FUNCTION_ARM', 'FUNCTION_THM', 'SECTION']
    for game in ('B', 'W'):
        profile = json.loads((HERE / f'profile-MoveEffectiveness-{game}.json').read_text())
        name = f'MoveEffectiveness{game}.dll'
        data = (HERE / 'build' / name).read_bytes()
        rpm = read_rpm(data)
        debug = read_rpm((HERE / 'build' / f'MoveEffectiveness{game}.debug.dll').read_bytes())
        assert rpm['bss'] == 28 and all(not s['attributes'] & 2 for s in rpm['symbols'])
        assert len([r for r in rpm['relocations'] if r['module'] != 'base']) == 5
        assert all(r['module'] in ('base', '94') for r in rpm['relocations'])
        digest = hashlib.sha256(data).hexdigest()
        for extended in (False, True):
            result = next(v for v in verification['checks'] if v['game'] == game and v['extendedRam'] == extended)
            assert result['compiledPassed'] and result['dllSha256'] == digest
        color = next(s for s in debug['symbols'] if s['name'] == 'gMovePreviewColors')
        at = color['address']
        assert color['size'] == 6 and rpm['code'][at:at + 6] == bytes.fromhex('5e2bb3621f21')
        assert all(r['module'] != 'base' or not at <= r['address'] < at + 6 for r in rpm['relocations'])
        builds = dict(manifest['moveGames'].get(game, {}).get('builds', {}))
        version = rpm['metadata']['PMCVersion']
        builds[version] = {'codeHex': rpm['code'].hex(), 'relocations': rpm['relocations'],
                           'bssSize': rpm['bss'], 'colorOffset': at, 'symbols': [
            {'address': s['address'], 'type': types[s['type']], 'attributes': s['attributes']}
            for s in rpm['symbols']]}
        accepted = ds_accepted('move-effectiveness', game, profile, {name: data})
        profile.update(version=version, dllSha256=digest, builds=builds, dsAccepted=accepted,
                       liveDsiAccepted=False, implementation='BW1 DS accepted; live DSi pending' if accepted else 'BW1 candidate; DS gameplay acceptance pending')
        manifest['moveGames'][game] = profile
        (ASSETS / name).write_bytes(data)
    (ASSETS / 'battleTypeHudManifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (HERE / 'reports/bw1-move-verification.json').write_text(json.dumps(verification, indent=2) + '\n')
    (HERE / 'reports/bw1-move-memory.json').write_bytes((HERE / 'build/memory-report-bw1-moves.json').read_bytes())
    print('Bundled BW1 Move Effectiveness; DS acceptance', {g: manifest['moveGames'][g]['dsAccepted'] for g in ('B', 'W')})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--moves', action='store_true', help='Bundle verified move candidates instead of type icons.')
    if parser.parse_args().moves:
        bundle_moves()
        return
    manifest = json.loads((ASSETS / 'battleTypeHudManifest.json').read_text())
    types = ['NULL', 'VALUE', 'FUNCTION_ARM', 'FUNCTION_THM', 'SECTION']
    verification = json.loads((HERE / 'build/verification-bw1-candidates.json').read_text())
    for game in ('B', 'W'):
        profile = json.loads((HERE / f'profile-TypeIcons-{game}.json').read_text())
        native_profile = dict(profile)
        profile['overlay_id'] = 94
        profile['graphicsArchive'] = 'a/0/1/1'
        old = manifest['games'].get(game, {})
        builds = dict(old.get('builds', {}))
        variants = {}
        artifacts = {}
        for variant, suffix, label in VARIANTS:
            name = f'TypeIcons{suffix}{game}.dll'
            data = (HERE / 'build' / name).read_bytes()
            rpm = read_rpm(data)
            assert rpm['bss'] == 796 and all(not s['attributes'] & 2 for s in rpm['symbols'])
            assert len([r for r in rpm['relocations'] if r['module'] != 'base']) == 17
            assert all(r['module'] in ('base', '94') for r in rpm['relocations'])
            version = rpm['metadata']['PMCVersion']
            digest = hashlib.sha256(data).hexdigest()
            artifacts[name] = data
            for extended in (False, True):
                report = next(v for v in verification['checks'] if v['game'] == game and
                              v['module'] == f'TypeIcons{suffix}' and v['extendedRam'] == extended)
                assert report['compiledPassed'] and report['dllSha256'] == digest
            builds[version] = {'codeHex': rpm['code'].hex(), 'relocations': rpm['relocations'],
                               'bssSize': rpm['bss'], 'symbols': [
                {'address': s['address'], 'type': types[s['type']], 'attributes': s['attributes']}
                for s in rpm['symbols']]}
            variants[variant] = {'label': label, 'version': version, 'dllSha256': digest}
            (ASSETS / name).write_bytes(data)
        profile.update(builds=builds, variants=variants, version=variants['letters']['version'],
                       dllSha256=variants['letters']['dllSha256'])
        accepted = ds_accepted('type-icons', game, native_profile, artifacts)
        profile.update(dsAccepted=accepted, liveDsiAccepted=False,
                       implementation='BW1 DS accepted; live DSi pending' if accepted else 'BW1 candidate; DS gameplay acceptance pending')
        manifest['games'][game] = profile
    for game in ('B2', 'W2'):
        for key in ('games', 'moveGames'):
            manifest[key][game].update(overlay_id=168, graphicsArchive='a/0/1/1', revision=0)
    (ASSETS / 'battleTypeHudManifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    changes = json.loads((ASSETS / 'battleTypeHudPanelExpansion.json').read_text())
    bw1 = json.loads((HERE / 'panel-expansion-bw1.json').read_text())
    for change in bw1.values(): change.setdefault('previous', [])
    changes.update(bw1)
    (ASSETS / 'battleTypeHudPanelExpansion.json').write_text(json.dumps(changes, indent=2) + '\n')
    # Native fixture contains only profile-checked members, never a whole ROM.
    narc = ndspy.narc.NARC()
    narc.files = [b'\0' for _ in range(189)]
    for member in range(162, 189):
        narc.files[member] = (HERE / 'build' / f'B-resource-{member}.bin').read_bytes()
        assert narc.files[member] == (HERE / 'build' / f'W-resource-{member}.bin').read_bytes()
    (HERE.parents[1] / 'src/test/fixtures/battle-type-hud/bw1-graphics.narc').write_bytes(narc.save())
    (HERE / 'reports/bw1-candidate-verification.json').write_text(json.dumps(verification, indent=2) + '\n')
    (HERE / 'reports/bw1-candidate-memory.json').write_bytes((HERE / 'build/memory-report-bw1.json').read_bytes())
    print('Bundled BW1 Type Icons and reversible resources; DS acceptance', {g: manifest['games'][g]['dsAccepted'] for g in ('B', 'W')})


if __name__ == '__main__':
    main()
