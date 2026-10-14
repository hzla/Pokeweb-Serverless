"""Check recorded retail DS runs before accepting the exact BW1 bundles."""
import hashlib,json,struct
from pathlib import Path
import ndspy.rom,ndspy.narc
from build import HERE,BUILD,ASSETS,fingerprint
from verify_bw1 import ORDERS,crypt

def read(run,name):return json.loads((BUILD/run/name).read_text())
def sha(data):return hashlib.sha256(data).hexdigest()
def evidence(game,suffix,toolbar,candy):
 run=f'{game}-final-{suffix}';meta=read(run,'run.json');rom=ndspy.rom.NintendoDSRom.fromFile(str(BUILD/run/'test.nds'))
 assert meta['toolbarSha256']==toolbar['sha256'] and meta['candySha256']==candy['sha256'],(run,'stale candidate')
 assert sha(rom.getFileByName(f'patches/{toolbar["fileName"]}'))==toolbar['sha256']
 assert sha(rom.getFileByName(f'patches/{candy["fileName"]}'))==candy['sha256']
 archive=ndspy.narc.NARC(rom.getFileByName('party-tools/ui.narc'))
 assert [fingerprint(v)for v in archive.files[1:]]==toolbar['graphicsFingerprints']
 traces=read(run,'trace.json');party=[v for v in read(run,'party-trace.json')if v['members']]
 return run,meta,traces,party

def decode_pk5(record):
 pid,flags,checksum=struct.unpack_from('<IHH',record);payload=bytearray(record[8:136]);tail=bytearray(record[136:])
 if not flags&2:crypt(payload,checksum)
 if not flags&1:crypt(tail,pid)
 order=ORDERS[(pid>>13)&31];body=b''.join(payload[order[n]*32:order[n]*32+32]for n in range(4))
 assert sum(struct.unpack('<64H',body))&65535==checksum
 return record[:8]+body+tail

def check():
 toolbar=json.loads((ASSETS/'partyQuickActionsBw1Manifest.json').read_text());candy=json.loads((ASSETS/'infiniteCandyBw1Manifest.json').read_text())
 result={'version':toolbar['version'],'hardwareAccepted':False,'dsiAccepted':False,'games':{}}
 for game in ('B','W'):
  t,c=toolbar['games'][game],candy['games'][game];rows=[]
  def case(suffix):
   run,meta,trace,party=evidence(game,suffix,t,c);rows.append({'run':run,'romSha256':meta['romSha256']});return trace,party
  hp,_=case('hp');assert {35,45,46}<=set(v['members'][0]['hp']for v in hp) and {v['slot']for v in hp}=={0}
  assert {0,1}==set(v['hpMode']for v in hp)
  heal,_=case('heal');first,last=heal[0]['members'],heal[-1]['members']
  assert 'Heal Party? A:Yes B:No'in {v.get('message')for v in heal}
  for i,(before,after)in enumerate(zip(first,last)):
   assert after['exp']==before['exp'] and after['pp']==before['pp'] and after['companionCounters']==[30,5]
   if not before['hp']or before['egg']:assert after==before,(game,i,'fainted/Egg changed')
   else:assert after['hp']==after['max']and after['status']==0
  status,_=case('status');assert set(v['members'][0]['condition']for v in status)==set(range(6))
  assert status[-1]['members'][0]['status']==0
  for raw in [3,8,16,32,64]:assert any(v['members'][0]['status']==raw and not v['hpMode']for v in status)
  xp,_=case('xp');assert xp[0]['members'][0]['exp']==2035 and xp[-1]['members'][0]['exp']==2534
  assert {"Edge XP? A:YES B:NO","Oshawott's xp was edged!"}<={v.get('message')for v in xp}
  assert any(v['nav']for v in xp)
  _,party=case('candy');assert {15,16,17}<={v['members'][0]['level']for v in party}
  trace,party=case('candy-replace');mon=party[-1]['members'][0]
  assert (mon['species'],mon['level'],mon['moves'][0])==(502,17,534)
  assert any(v['fsm'][0]==2 and v['mode']==0 for v in trace)
  trace,party=case('cancel');assert party[-1]['members'][0]['species']==501 and party[-1]['members'][0]['level']==17
  assert any(v['result']==9 for v in trace) and any(v['fsm'][0]==2 and v['mode']==0 for v in trace)
  hidden,_=case('hidden');assert not hidden and read(f'{game}-final-hidden','native-trace.json')
  hidden,_=case('all-hidden');assert hidden and {v['mask']for v in hidden}=={0} and not any(v['nav']for v in hidden)
  absent,_=case('no-candy');assert {v['mask']for v in absent}=={510}
  packed,_=case('packed-clean');assert {v['mask']for v in packed}=={249}
  bag,party=case('bag-accepted');assert not bag
  assert party[-1]['members'][0]['level']==16 and party[-1]['members'][1]['level']==21
  steps=read(f'{game}-final-bag-accepted','bag-steps.json');assert steps[-1]['stage']==6
  memory=(BUILD/f'{game}-final-bag-accepted/ram.bin').read_bytes()
  bag_at=struct.unpack_from('<I',memory,steps[0]['medicine']['request']+4)[0]-0x2000000
  assert struct.unpack_from('<HH',memory,bag_at+0x4d8)==(622,1)
  assert struct.unpack_from('<HH',memory,bag_at+0x7d8)==(50,1)
  saved,party=case('saved');assert min(v['members'][0]['hp']for v in saved)==35
  save=(BUILD/f'{game}-final-saved/saved.sav').read_bytes()
  for half in (0,0x24000):
   for member in range(6):
    at=half+0x18e08+member*220;mon=decode_pk5(save[at:at+220])
    assert [mon[67],mon[94]]==[30,5]
    if member==0:assert struct.unpack_from('<H',mon,142)[0]==35
  cold,_=case('cold-verified');assert cold[0]['members'][0]['hp']==35
  assert all(mon['checksumValid']and mon['companionCounters']==[30,5]for mon in cold[0]['members'])
  repeat,_=case('repeat');assert sum(v['fsm'][0]==1 for v in repeat)>=3
  assert not any(v['error']for v in repeat)and repeat[-1]['mode']==0 and repeat[-1]['fsm'][0]==2
  # Every recorded owned hidden frame must lack the standard white rectangle.
  for suffix in ['hp','status','heal','xp','all-hidden','no-candy']:
   run=f'{game}-final-{suffix}';counts={v['frame']:v['white']for v in read(run,'frame-checks.json')}
   for v in read(run,'trace.json'):
    if v['frameHidden']and (v['fsm'][0]in (1,19,20,21)or 5100<=v['logicalFrame']<5200)and v['frame']in counts:assert counts[v['frame']]<512,(run,v['frame'],'white prompt flash')
  for suffix in ['hp','status','heal','xp','candy-replace','cancel']:
   _,_,trace,party=evidence(game,suffix,t,c)
   for v in party:
    assert all(mon['checksumValid']for mon in v['members']),(game,suffix,v['frame'],'invalid PK5')
  result['games'][game]={'toolbarSha256':t['sha256'],'candySha256':c['sha256'],'archiveSha256':t['archiveSha256'],'runs':rows,'passed':True}
 (BUILD/'ds-acceptance-bw1.json').write_text(json.dumps(result,indent=2)+'\n')
 print('Both exact BW1 profiles passed the recorded DS acceptance checks, including Bag consumption, native saving/cold reload, packed visibility, companion counters and repeated entry/exit. Hardware and DSi remain untested.')
 return result
if __name__=='__main__':check()
