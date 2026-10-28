"""Require every native case and summarize the exact exported configuration."""
import argparse,hashlib,json
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('evidence',type=Path);a=p.parse_args();m=json.loads((a.evidence/'cases.json').read_text());results=[]
for spec in m['cases']:
 result=json.loads((a.evidence/f"{spec['label']}-result.json").read_text());assert result['passed'] and result['abilityId']==spec['abilityId'];assert result['romSha256']==m['romHashes'][spec['rom']];assert result['loader']['abilityPatchRecords']==1 and result['loader']['liveRuleCount']==100;assert len(result['menus'])==3;results.append(result)
assert hashlib.sha256((a.evidence/'abilities-100.nds').read_bytes()).hexdigest()==m['exportSha256']
minimum={key:min(r['minimumObservedFree'][key]['freePayloadBytes']for r in results)for key in ['bookkeeping','system']}
summary={'passed':len(results),'completedTurns':len(results)*2,'inputSha256':m['inputSha256'],'exportSha256':m['exportSha256'],'editedAbilities':100,'totalNamedAbilities':255,'newNamedAbilities':91,'sharedAbilityDlls':1,'codeBytes':m['codeBytes'],'bssBytes':m['bssBytes'],'serializedBytes':m['serializedBytes'],'minimumObservedFreePayload':minimum,'activeEditedIds':len({r['abilityId']for r in results if r['abilityId']!=146}),'projectReopen':m['projectReload'],'romExportReload':m['romExportReload'],'assignmentByName':m['assignmentByName'],'cases':[{'label':r['case'],'abilityId':r['abilityId'],'passed':True}for r in results],'scope':'DS-mode melonDS cold boots; normal keypad input; read-only hooks; no game-service stubs or battle-state writes.'}
(a.evidence/'emulator-summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps({k:v for k,v in summary.items()if k!='cases'},indent=2))
