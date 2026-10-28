"""Combine completed, hash-matched native battle runs into one checked receipt."""
import argparse
import hashlib
import json
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('evidence', type=Path)
a = p.parse_args()
manifest = json.loads((a.evidence / 'cases.json').read_text())
expected = {case['label']: case for case in manifest['cases']}
assert len(expected) == 119
assert hashlib.sha256((a.evidence / 'battle-100.nds').read_bytes()).hexdigest() == manifest['battleRomSha256']
assert hashlib.sha256((a.evidence / 'items-100.nds').read_bytes()).hexdigest() == manifest['exportSha256']
cases = {}
for path in sorted(a.evidence.glob('emulator-*.json')):
    if path.name == 'emulator-summary.json':
        continue
    report = json.loads(path.read_text())
    if report.get('romSha256') != manifest['battleRomSha256']:
        continue
    for case in report['cases']:
        spec = expected[case['case']]
        assert case['passed'] and case['loader']['itemPatchRecords'] == 1
        for field in ['itemId', 'type', 'divisor', 'match', 'expectedHp']:
            assert case[field] == spec[field], (path, field)
        assert case['commandMenus'][0]['hp'] == spec['hp']
        assert case['commandMenus'][1]['hp'] == spec['expectedHp']
        assert case['heapMinimumFree']['bookkeeping']['capacity'] == 4096
        cases[case['case']] = case
assert cases.keys() == expected.keys(), f'Missing cases: {sorted(expected.keys() - cases.keys())}'
matching = [spec for spec in expected.values() if spec['match'] and not spec['fullHp']]
assert len({case['itemId'] for case in matching}) == 100
assert {case['type'] for case in matching} == set(range(18))
summary = {
    'passed': len(cases), 'editedItems': 100, 'matchingItems': 100, 'wrongTypeCases': 18, 'fullHpCases': 1,
    'itemDlls': 1, 'sharedCodeAndDataBytes': manifest['codeBytes'], 'sharedDllFileBytes': manifest['dllBytes'],
    'inputSha256': manifest['inputSha256'], 'exportSha256': manifest['exportSha256'], 'battleRomSha256': manifest['battleRomSha256'],
    'projectReload': manifest['projectReload'], 'romExportReload': manifest['romExportReload'],
    'minimumObservedFreePayloadBytes': {name: min(case['heapMinimumFree'][name]['freePayloadBytes'] for case in cases.values()) for name in ['bookkeeping', 'system']},
    'patchRecordCounts': sorted({case['loader']['totalPatchRecords'] for case in cases.values()}),
    'scope': 'DS-mode melonDS cold boots, native turns and HP changes; read-only hooks and normal keypad input; no game-service stubs; no hardware or DSi claim',
    'cases': [cases[label] for label in expected],
}
(a.evidence / 'emulator-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({key: value for key, value in summary.items() if key != 'cases'}, indent=2))
