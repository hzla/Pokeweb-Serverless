"""Inventory bundled modules and memory-bound candidates in their canonical sources.

This is an audit aid, not a proof that every patch works in DSi mode.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import sys

HERE = Path(__file__).resolve().parent
APP = HERE.parents[1]
WORKSPACE = APP.parent
ROOTS = {
    'pokeweb': APP,
    'w2u-runtime': Path(os.environ.get('W2U_RUNTIME_ROOT', WORKSPACE.parent / 'White2Upgrade-Original-pokeweb')),
    'weather-runtime': Path(os.environ.get('WEATHER_RUNTIME_ROOT', WORKSPACE / 'White2Upgrade')),
    'pmc': Path(os.environ.get('PMC_SOURCE_ROOT', WORKSPACE / 'PMC')),
}
sys.path.insert(0, str(APP / 'runtime/battle-type-hud'))
from rpm_read import read_rpm

BOUND = re.compile(r'0x0*(?:24[0-9a-f]{5}|23ff[0-9a-f]{3}|3fffff)|4194304|37748736|>>\s*22|lsrs?[^\n]*#(?:22|0x16)', re.I)
EXTENSIONS = {'.c', '.cpp', '.h', '.s', '.S'}


def audit():
    manifest = json.loads((APP / 'patch-sources/manifest.json').read_text())
    sources = set()
    for entry in [f for p in manifest['patches'] for f in p['files']] + manifest['sharedFiles']:
        if entry['kind'] == 'source' or Path(entry['origin']['path']).suffix in EXTENSIONS:
            sources.add((entry['origin']['repository'], entry['origin']['path']))
    # Include the monolithic upgrade and native loader even where source
    # snapshots intentionally omit them. Do not publish source contents.
    for folder in ('src', 'include'):
        for path in (ROOTS['w2u-runtime'] / folder).rglob('*'):
            if path.is_file() and path.suffix in EXTENSIONS:
                sources.add(('w2u-runtime', str(path.relative_to(ROOTS['w2u-runtime']))))
    for path in (APP / 'runtime/summary-stat-viewer').glob('*'):
        if path.suffix in EXTENSIONS:
            sources.add(('pokeweb', str(path.relative_to(APP))))
    for name in ('Framework', 'Interface', 'PrintService'):
        for path in (ROOTS['pmc'] / name).rglob('*'):
            if path.is_file() and path.suffix in EXTENSIONS:
                sources.add(('pmc', str(path.relative_to(ROOTS['pmc']))))
    candidates = []
    for repository, relative in sorted(sources):
        data = (ROOTS[repository] / relative).read_bytes()
        matches = [i for i, line in enumerate(data.decode('utf-8').splitlines(), 1) if BOUND.search(line)]
        if matches:
            candidates.append(dict(repository=repository, path=relative, lines=matches,
                                   sha256=hashlib.sha256(data).hexdigest()))
    paths = sorted(list((APP / 'src/assets/codeinjection').glob('*.dll')) +
                   list((APP / 'src/assets/codeinjection').glob('*.rpm')) +
                   list((APP / 'src/assets/following').rglob('*.dll')))
    artifacts = []
    for path in paths:
        raw = path.read_bytes()
        # The common executable structure is shared by DLL and loader RPM.
        module = read_rpm(b'DLXF' + raw[4:])
        code = module['code']
        literals = [dict(offset=i, value=f'0x{struct.unpack_from("<I", code, i)[0]:08x}')
                    for i in range(0, len(code) - 3, 4)
                    if struct.unpack_from('<I', code, i)[0] in (0x02400000, 0x023fff40, 0x003fffff, 0x00400000)]
        artifacts.append(dict(path=str(path.relative_to(APP)), sha256=hashlib.sha256(raw).hexdigest(),
                              codeBytes=len(code), bssBytes=module['bss'], boundaryLiteralCandidates=literals))
    return dict(format=1, scope='4 MiB pointer limits; source review and executable inventory, not game compatibility certification.',
                sourceFilesScanned=len(sources), artifactCount=len(artifacts), sourceCandidates=candidates, artifacts=artifacts)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = audit()
    output = json.dumps(result, indent=2) + '\n'
    destination = HERE / 'audit.json'
    if args.check:
        assert destination.read_text() == output, 'Audit inventory is stale; review changes and rerun audit.py.'
    else:
        destination.write_text(output)
    print(f'{result["artifactCount"]} bundled modules and {result["sourceFilesScanned"]} canonical source files inventoried; '
          f'{len(result["sourceCandidates"])} source files have boundary candidates requiring review.')
