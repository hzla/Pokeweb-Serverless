"""Bundle verified BW1 Learnset artifacts with hash-bound DS release gates."""
import hashlib
import json
from pathlib import Path
import struct
import sys

import ndspy.narc
import ndspy.rom
from configure_bw1 import HERE, PROFILES

sys.path.insert(0,str(HERE.parent/'battle-type-hud'))
from rpm_read import read_rpm
sys.path.insert(0,str(HERE.parent))
from bw1_release import ds_accepted

ASSETS=HERE.parents[1]/'src/assets/codeinjection'
TYPES=['NULL','VALUE','FUNCTION_ARM','FUNCTION_THM','SECTION']

def fingerprint(code):
    ranges=[]
    for magic,start,end in ((b'LSVMSG1\0',10,22),(b'PWUICFG1',10,18)):
        at=code.find(magic);assert at>=0 and code.count(magic)==1
        ranges.append((at+start,at+end))
    if b'LSVINF1\0' in code:
        at=code.index(b'LSVINF1\0');assert code.count(b'LSVINF1\0')==1
        count=struct.unpack_from('<H',code,at+10)[0]
        ranges.append((at+12,at+12+4*count))
    h=0x811c9dc5
    for i,b in enumerate(code):h=((h^(0 if any(start<=i<end for start,end in ranges) else b))*0x1000193)&0xffffffff
    return f'{h:08x}'

def main():
    manifest=json.loads((ASSETS/'learnsetViewerManifest.json').read_text())
    candidates=json.loads((HERE/'build/bw1-candidates.json').read_text())
    report={'scope':'Compiled artifact integrity; DS acceptance comes from the separate tested-build ledger; live DSi pending','games':{}}
    for game in ('B','W'):
        profile=candidates['games'][game]
        modules={}
        artifacts={}
        for output in profile['modules']:
            group=output['group'];data=(HERE/'build'/output['file']).read_bytes()
            digest=hashlib.sha256(data).hexdigest();assert digest==output['sha256']
            artifacts[output['file']]=data
            rpm=read_rpm(data);assert rpm['metadata']=={'PMCGameID':game,'PMCModulePriority':4,'PMCVersion':candidates['version']}
            assert all(s['name'] is None and not s['attributes']&2 for s in rpm['symbols'])
            overlays=(10,91) if group=='Menu' else (173,)
            expected=[h for h in profile['hooks'] if h['patchSize'] and h['overlayId'] in overlays]
            hooks=[r for r in rpm['relocations'] if r['module']!='base']
            assert len(hooks)==len(expected)==(3 if group=='Menu' else 25)
            for hook in expected:
                match=[r for r in hooks if r['module']==str(hook['overlayId']) and r['address']==hook['address'] and r['type']==hook['patchType']]
                assert len(match)==1
                if hook['patchType']=='FULL_COPY':assert rpm['symbols'][match[0]['symbol']]['size']==hook['patchSize']
            modules[group]={'fileName':output['file'],'sha256':digest,'codeFingerprint':fingerprint(rpm['code']),
                            'bssSize':rpm['bss'],'symbols':[{'address':s['address'],'type':TYPES[s['type']],'attributes':s['attributes']} for s in rpm['symbols']],
                            'relocations':rpm['relocations']}
            (ASSETS/output['file']).write_bytes(data)
        old=manifest['games'].get(game,{})
        previous=dict(old.get('previousBuilds',{}))
        if old.get('version') and old['version']!=candidates['version']:previous[old['version']]=old['modules']
        accepted=ds_accepted('learnset-viewer',game,profile,artifacts)
        manifest['games'][game]={**profile,'version':candidates['version'],'modules':modules,'previousBuilds':previous,'dsAccepted':accepted,'liveDsiAccepted':False}
        report['games'][game]={'modules':modules,'dsAccepted':accepted,'liveDsiAccepted':False}
    # Minimal native fixtures include only the profile's resource members.
    for path in sorted({r['archive'] for r in candidates['games']['B']['resources']}):
        rom=ndspy.rom.NintendoDSRom.fromFile(PROFILES['B']['default'])
        files=ndspy.narc.NARC(rom.getFileByName(path)).files
        resources=[r for r in candidates['games']['B']['resources'] if r['archive']==path]
        narc=ndspy.narc.NARC();narc.files=[b'\0']*(max(r['member'] for r in resources)+1)
        for r in resources:
            assert hashlib.sha256(files[r['member']]).hexdigest()==r['sha256']
            narc.files[r['member']]=files[r['member']]
        dest=HERE.parents[1]/'src/test/fixtures/learnset-viewer'/('bw1-'+path.replace('/','-')+'.narc')
        dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(narc.save())
    (ASSETS/'learnsetViewerManifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (HERE/'build/bw1-artifact-verification.json').write_text(json.dumps(report,indent=2)+'\n')
    print('Bundled BW1 Learnset companions; DS acceptance',{g:manifest['games'][g]['dsAccepted'] for g in ('B','W')})

if __name__=='__main__':main()
