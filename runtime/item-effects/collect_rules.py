"""Combine complete, hash-matched rule battle receipts without trusting logs."""
import argparse, hashlib, json
from pathlib import Path

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('evidence',type=Path)
a=p.parse_args()
manifest=json.loads((a.evidence/'cases.json').read_text())
assert manifest['editedItems']==100 and manifest['projectReload'] and manifest['romExportReload']
assert hashlib.sha256((a.evidence/'rules-100.nds').read_bytes()).hexdigest()==manifest['exportSha256']
for name,digest in manifest['romHashes'].items():
    assert hashlib.sha256((a.evidence/name).read_bytes()).hexdigest()==digest
cases=[]
for spec in manifest['cases']:
    result=json.loads((a.evidence/f"{spec['label']}-result.json").read_text())
    assert result['passed'] and result['case']==spec['label'] and result['itemId']==spec['itemId']
    assert result['romSha256']==manifest['romHashes'][spec['rom']]
    assert result['loader']['itemPatchRecords']==1 and result['loader']['liveRuleCount']==100
    assert len(result['menus'])==3 and result['menus'][0]['hp']==spec['hp']
    assert result['menus'][0]['item']==spec['itemId']
    assert result['minimumObservedFree']['bookkeeping']['capacity']==4096
    assert (a.evidence/f"{spec['label']}.png").is_file()
    cases.append(result)
assert len({case['case'] for case in cases})==len(manifest['cases'])
lifecycle=json.loads((a.evidence/'lifecycle.json').read_text())
assert lifecycle['removalExportReload'] and lifecycle['modifiedModuleRejected'] and lifecycle['lastRuleRetiresDll']
summary={
    'passed':len(cases),'completedBattleTurns':len(cases)*2,'editedItems':100,
    'distinctItemsExercised':len({case['itemId'] for case in cases}),'itemDlls':1,
    'sharedCodeAndDataBytes':manifest['codeBytes'],'inputSha256':manifest['inputSha256'],
    'exportSha256':manifest['exportSha256'],'battleRomHashes':manifest['romHashes'],
    'projectReload':True,'romExportReload':True,'lifecycle':lifecycle,
    'minimumObservedFreePayloadBytes':{name:min(case['minimumObservedFree'][name]['freePayloadBytes'] for case in cases) for name in ['bookkeeping','system']},
    'patchRecordCounts':sorted({case['loader']['totalPatchRecords'] for case in cases}),
    'scope':'DS-mode melonDS cold boots, normal keypad input and native battle engine; read-only hooks; no game-service stubs; no hardware or DSi claim',
    'cases':cases,
}
(a.evidence/'rule-emulator-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({key:value for key,value in summary.items() if key!='cases'},indent=2))
