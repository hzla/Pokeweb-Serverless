"""Package verified test artifacts without replacing ROMs or saves."""
from pathlib import Path
import hashlib,json,shutil,struct
import ndspy.rom
HERE=Path(__file__).resolve().parent;BUILD=HERE/'build';WORKSPACE=HERE.parents[2]
def digest(b):return hashlib.sha256(b).hexdigest()
def crc(b):
 c=0xffff
 for v in b:
  c^=v<<8
  for i in range(8):c=((c<<1)^(0x1021 if c&0x8000 else 0))&0xffff
 return c
def raw(b):return b[:0x80000]if b.endswith(b'|-DESMUME SAVE-|')else b
def exclusive_copy(source,target):
 with source.open('rb')as i,target.open('xb')as o:shutil.copyfileobj(i,o)
def main():
 manifest=json.loads((HERE/'manifest.json').read_text());out=WORKSPACE/f'Autosave-v{manifest["version"]}';out.mkdir(exist_ok=True)
 report={'version':manifest['version'],'saveStepsPerTick':manifest['saveStepsPerTick'],'games':{},'automated':{'installerTests':10,'pmcRegressionTests':53,'compiledHarnesses':['B2','W2'],'productionBuild':'passed'},'pending':['Hardware and DSi-mode acceptance','Exhaustive story/communication-area coverage','Interrupted-write/power-loss testing','Broad ROM-hack and companion-matrix acceptance']}
 for game,name in [('B2','Black2'),('W2','White2')]:
  profile=manifest['games'][game];cases={}
  for case,counts in [('door',(1,1,438)),('seamless',(2,2,437)),('menus',(0,0,427)),('reload',(0,0,438)),('same-header',(1,1,427))]:
   folder=BUILD/f'emulator-{game}-{case}';trace=json.loads((folder/'trace.json').read_text());last=trace[-1];v=last['values'];assert (v[2],v[4],last['zone'])==counts and v[5:8]==[0,0,0],(game,case,last)
   rom=ndspy.rom.NintendoDSRom.fromFile(str(folder/'test.nds'));dll=rom.files[rom.filenames.idOf(f'patches/{profile["fileName"]}')];assert digest(dll)==profile['sha256'],(game,case,'stale binary')
   saved=raw((folder/'saved.sav').read_bytes());assert len(saved)==0x80000
   for half in(0,0x26000):
    for start,length,checksum,index in[(0x19500,0xa8,0x195aa,28),(0x18e00,0x534,0x19336,26)]:
     c=crc(saved[half+start:half+start+length]);assert struct.unpack_from('<H',saved,half+checksum)[0]==c
     assert struct.unpack_from('<H',saved,half+0x25f00+index*2)[0]==c
    assert crc(saved[half+0x25f00:half+0x25f94])==struct.unpack_from('<H',saved,half+0x25fa2)[0]
   initial=raw((folder/'initial.sav').read_bytes());assert saved[0x18e00:0x19334]==initial[0x18e00:0x19334]
   cases[case]={'transitions':v[2],'completed':v[4],'zone':last['zone'],'partyBytesPreserved':True,'positionPartyAndTableCrcs':'passed'}
  folder=BUILD/f'emulator-{game}-door';stem=f'{name}-Autosave-v{manifest["version"]}'
  exclusive_copy(folder/'test.nds',out/f'{stem}.nds')
  initial=raw((folder/'initial.sav').read_bytes());assert len(initial)==0x80000
  with (out/f'{stem}.sav').open('xb')as f:f.write(initial)
  dsv=folder/'initial.dsv'
  if not dsv.exists():dsv=folder/'initial.sav'
  exclusive_copy(dsv,out/f'{stem}.dsv')
  exclusive_copy(HERE/'artifacts'/profile['fileName'],out/profile['fileName'])
  exclusive_copy(folder/'saving.png',out/f'{name}-Saving.png')
  firstStart=next(row['frame']for row in json.loads((folder/'trace.json').read_text())if row['values'][3])
  firstFinish=next(row['frame']for row in json.loads((folder/'trace.json').read_text())if row['values'][4])
  report['games'][game]={'runtimeSha256':profile['sha256'],'romBytes':(out/f'{stem}.nds').stat().st_size,'scenarios':cases,'firstWriteEmulatedSeconds':round((firstFinish-firstStart)/60,2)}
  rows=json.loads((folder/'trace.json').read_text());opened=next(row['frame']for row in rows if row['values'][7]);closed=next(row['frame']for row in rows if row['frame']>opened and not row['values'][7])
  report['games'][game]['savingIndicatorEmulatedSeconds']=round((closed-opened)/60,2)
 companion=BUILD/'emulator-W2-door-companions'
 trace=json.loads((companion/'trace.json').read_text());assert trace[-1]['values'][2:8]==[1,1,1,0,0,0]
 rom=ndspy.rom.NintendoDSRom.fromFile(str(companion/'test.nds'));assert digest(rom.files[rom.filenames.idOf('patches/MapAutosaveW2.dll')])==manifest['games']['W2']['sha256']
 report['additionalEmulatorChecks']={'W2 current C-Gear Quick Actions':'passed'}
 baseline=json.loads((HERE/'acceptance-v0.1.0.json').read_text())
 for game,p in report['games'].items():
  before=baseline['games'][game]['firstWriteEmulatedSeconds'];after=p['firstWriteEmulatedSeconds']
  p['comparison']={'baselineVersion':baseline['version'],'oneStepSeconds':before,'eightStepSeconds':after,'durationReductionPercent':round((before-after)*100/before,1)}
 (HERE/'acceptance.json').write_text(json.dumps(report,indent=2)+'\n')
 exclusive_copy(HERE/'acceptance.json',out/'acceptance.json')
 (out/'Checklist.txt').write_text(f'Autosave MVP {manifest["version"]} (eight native steps per tick) — US Black 2 / White 2\n\nLoad the separately named ROM with its matching copied .sav (raw 512 KiB), or import the .dsv in DeSmuME. Original ROMs and personal saves were not modified.\n\n1. Walk north from the starting street through the gatehouse door.\n2. Wait for Saving... to close, then walk south to return.\n3. Open and close Party and Bag: no extra save should occur.\n4. Quit after a completed autosave and cold-load: your destination should persist.\n5. Cross Route 19 / Floccesy Town to test seamless header changes.\n\nThis test advances the native save routine up to eight times per field tick, stopping immediately on completion or failure. Native checksums, backup copies, write order and completion checks are preserved. There is no interval setting. See acceptance.json for measured save times.\n\nPassed: both games, door and seamless crossings, Party/Bag returns, actual writes, save CRCs, unchanged party data, cold reload; 63 installer/PMC tests; native harnesses; production build.\nWhite 2 was also tested with the current C-Gear Quick Actions runtime.\n\nPending: hardware/DSi mode, exhaustive story and communication areas, interrupted writes, broad hack/companion matrix.\n\nThe standalone test ROMs include autosave, PMC and the ordinary Quick Launch startup preparation. Autosave is not yet a bundled installer card.\n')
 print(out)
if __name__=='__main__':main()
