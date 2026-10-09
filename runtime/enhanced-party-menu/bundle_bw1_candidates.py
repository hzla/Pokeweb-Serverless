"""Bundle BW1 party-menu builds after integrity and tested-build checks."""
import hashlib,json,os,sys,struct
from pathlib import Path
HERE=Path(__file__).resolve().parent
APP=HERE.parents[1]
SOURCE=Path(os.environ.get('W2U_RUNTIME_ROOT',APP.parents[1]/'White2Upgrade-Original-pokeweb'))
sys.path.insert(0,str(HERE.parent/'battle-type-hud'))
from rpm_read import read_rpm
sys.path.insert(0,str(HERE.parent))
from bw1_release import ds_accepted
TYPES=['NULL','VALUE','FUNCTION_ARM','FUNCTION_THM','SECTION']
manifest=json.loads((SOURCE/'work/bw1-menu-build/bw1-candidates.json').read_text())
out={'games':{}}
for game,p in manifest['games'].items():
 data=(SOURCE/'work/bw1-menu-build'/p['dllFilename']).read_bytes()
 assert hashlib.sha256(data).hexdigest()==p['sha256']
 rpm=read_rpm(data);assert not any(s['name'] or s['attributes']&2 for s in rpm['symbols'])
 header=struct.unpack_from('<I',data,8)[0];info=header+struct.unpack_from('<I',data,header+8)[0]
 assert struct.unpack_from('<II',data,info+24)==(0xffffffff,0xffffffff),'Unexpected static initializer/finalizer'
 assert rpm['metadata']=={'PMCGameID':game,'PMCModulePriority':4,'PMCVersion':p['version']}
 expected=sorted((str(h['overlayId']),h['address'],h['patchType']) for h in p['hooks'])
 assert sorted((r['module'],r['address'],r['type']) for r in rpm['relocations'] if r['module']!='base')==expected
 code=bytearray(rpm['code']);magic=b'MEVOMSG\0';at=code.index(magic);assert code.count(magic)==1
 code[at+10:at+18]=bytes(8)
 fingerprint=0x811c9dc5
 for value in code:fingerprint=((fingerprint^value)*0x1000193)&0xffffffff
 artifacts={p['dllFilename']:data}
 for suffix in ('BattleLog','BattleCounters','BattleLogSummary'):
  name={'B':'Black1','W':'White1'}[game]+suffix+'.dll'
  artifacts[name]=(APP/'src/assets/codeinjection'/name).read_bytes()
 accepted=ds_accepted('enhanced-party-menu',game,p,artifacts)
 p.update({'codeFingerprint':f'{fingerprint:08x}','bssSize':rpm['bss'],'symbols':[{'address':s['address'],'type':TYPES[s['type']],'attributes':s['attributes']} for s in rpm['symbols']],'relocations':rpm['relocations'],'dsAccepted':accepted,'liveDsiAccepted':False})
 (APP/'src/assets/codeinjection'/p['dllFilename']).write_bytes(data)
 out['games'][game]=p
(APP/'src/assets/codeinjection/menuEvolutionBw1Manifest.json').write_text(json.dumps(out,indent=2)+'\n')
print('Bundled BW1 Enhanced Party Menu; DS acceptance',{g:out['games'][g]['dsAccepted'] for g in ('B','W')})
