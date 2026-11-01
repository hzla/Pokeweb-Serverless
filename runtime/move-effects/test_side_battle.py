"""Run a disposable side-effect fixture in native battles."""
import json,sys
from pathlib import Path
from melonds import MelonDS
root=Path(sys.argv[1]);data=json.loads((root/'fixture.json').read_text());emu=MelonDS();hooks=[];menus=[];flow=0;code=0;calls=[];loader={}
def dispatch_base():
 site=data['hook']+2;hi=emu.memory.read_short(site);lo=emu.memory.read_short(site+2)
 assert emu.memory.read_short(data['hook'])==0xb500 and hi&0xf800==0xf000 and lo&0xf800==0xf800
 delta=((hi&0x7ff)<<12)|((lo&0x7ff)<<1)
 if delta&0x400000:delta-=0x800000
 return site+4+delta-data['symbols']['MoveDispatch']
def opening(cpu,address):
 global flow
 candidate=emu.memory.register_arm9.r0 if data['game'] in ('IRBO','IRAO') else emu.memory.register_arm9.r6
 if not 0x02000000<=candidate<0x02400000:return
 main=emu.memory.read_long(candidate+4)
 if 0x02000000<=main<0x02400000 and emu.memory.read_long(main+8)==emu.memory.read_long(candidate):flow=candidate
def observed(name):
 def callback(cpu,address):calls.append(name)
 return callback
def command(cpu,address):
 global code,loader
 if not flow or emu.memory.read_long(emu.memory.register_arm9.r1):return
 turn=emu.memory.read_long(flow+16)
 if menus and menus[-1]['turn']==turn:return
 if not code:
  code=dispatch_base()
  if data['mode']=='capacity':
   ptr=emu.memory.read_long(code+data['symbols']['MoveRuleData']);assert emu.memory.read_short(ptr)==100
   head=next(value for name,value in data['pmcSymbols'].items() if 'g_Modules' in name);node=emu.memory.read_long(head);seen=set();count=0
   while node:
    assert node not in seen;seen.add(node);count+=emu.memory.read_long(node+8)==code-32;node=emu.memory.read_long(node+24)
   assert count==1;loader={'moveDlls':count,'recipes':100}
   head=next(value for name,value in data['pmcSymbols'].items() if 'g_MainAllocator' in name);heap=emu.memory.read_long(head)
   if 0x02000000<=heap<0x02400000:
    node=emu.memory.read_long(heap+12);seen=set();free=0
    while node:
     assert node not in seen and 0x02000000<=node<0x02400000;seen.add(node);free+=emu.memory.read_long(node);node=emu.memory.read_long(node+4)
    loader['freeHeap']=free
  for name in ('MoveRapidSpin','MoveDefog'):
   if name in data['symbols']:hooks.append(emu.memory.register_exec(code+data['symbols'][name],observed(name)))
 main=emu.memory.read_long(flow+8);own=emu.memory.read_long(main+0x84+4);enemy=emu.memory.read_long(main+0x84+13*4)
 web=code+data['symbols']['moveWeb'];row={'turn':turn,'frame':emu.frame_count,'ownWeb':emu.memory.read_byte(web),'enemyWeb':emu.memory.read_byte(web+4),'enemy13Speed':emu.memory.read_byte(enemy+0x100) if 0x02000000<=enemy<0x02400000 else 0,'enemy13Defense':emu.memory.read_byte(enemy+0xfd) if 0x02000000<=enemy<0x02400000 else 0,'enemy13Attack':emu.memory.read_byte(enemy+0xfc) if 0x02000000<=enemy<0x02400000 else 0,'own1Speed':emu.memory.read_byte(own+0x100) if 0x02000000<=own<0x02400000 else 0,'own1Hp':emu.memory.read_short(own+0x10) if 0x02000000<=own<0x02400000 else 0,'own1MaxHp':emu.memory.read_short(own+0xe) if 0x02000000<=own<0x02400000 else 0}
 if data['sideState']:
  base=data['sideState'];row['spikes0']=[emu.memory.read_long(base+6*16),emu.memory.read_long(base+6*16+12)];row['spikes1']=[emu.memory.read_long(base+(14+6)*16),emu.memory.read_long(base+(14+6)*16+12)];row['screen0']=[emu.memory.read_long(base),emu.memory.read_long(base+4),emu.memory.read_long(base+8),emu.memory.read_long(base+12)];row['screen1']=[emu.memory.read_long(base+14*16),emu.memory.read_long(base+14*16+4),emu.memory.read_long(base+14*16+8),emu.memory.read_long(base+14*16+12)]
 menus.append(row)
if data['game'] in ('IRBO','IRAO'):
 delta=32 if data['game']=='IRAO' else 0;hooks.append(emu.memory.register_exec(0x021bbb60+delta,opening));hooks.append(emu.memory.register_exec(0x021bacac+delta,command))
else:
 delta=64 if data['game']=='IREO' else 0;hooks.append(emu.memory.register_exec(0x0219f5da-delta,opening));hooks.append(emu.memory.register_exec(0x021cef18-delta,command))
try:
 emu.open(root/'battle.nds')
 for _ in range(9000):
  key=128 if 600<=emu.frame_count<602 else 1 if emu.frame_count%12<3 else 0
  if menus:
   age=emu.frame_count-menus[-1]['frame'];emu.input.touch_release();key=1 if age>180 and emu.frame_count%12<3 else 0
   if 60<=age<64:emu.input.touch_set_pos(128,85)
   if 140<=age<144:emu.input.touch_set_pos(64 if len(menus)==1 or data['kind']=='courtSwitch' and len(menus)>=3 else 192,100 if data['kind']=='courtSwitch' and len(menus)>=3 else 44)
   if data['kind']=='courtSwitch' and len(menus)>=3 and age>300:
    key=1 if age>1300 and emu.frame_count%12<3 else 0
    if 1200<=age<1204:emu.input.touch_set_pos(190,30)
  emu.input.keypad_update(key);emu.cycle()
  if len(menus)>=(4 if data['kind']=='courtSwitch' else 2 if data['kind']=='spin' or data['mode']=='bounce' else 3):break
 if len(menus)<(4 if data['kind']=='courtSwitch' else 2 if data['kind']=='spin' or data['mode']=='bounce' else 3):emu.screenshot().save(root/'failure.png')
 assert len(menus)>=(4 if data['kind']=='courtSwitch' else 2 if data['kind']=='spin' or data['mode']=='bounce' else 3),(menus,calls,hex(emu.memory.register_arm9.pc))
 assert menus[1]['enemyWeb']==(0 if data['kind']=='spin' or data['mode']=='bounce' else 1),(menus,calls)
 if data['mode']=='bounce':assert menus[1]['ownWeb']==1,(menus,calls)
 if data['kind']=='spin':assert 'MoveRapidSpin' in calls,(menus,calls)
 if data['kind']=='tidy':assert menus[2]['enemyWeb']==0,(menus,calls)
 if data['kind']=='defog':assert menus[2]['enemyWeb']==0 and 'MoveDefog' in calls,(menus,calls)
 if data['kind'] in ('court','courtSwitch'):assert menus[1]['spikes1'][1]==(2 if data['mode']=='layered' else 1) and menus[2]['ownWeb']==1 and not menus[2]['enemyWeb'] and menus[2]['spikes0'][1]==(2 if data['mode']=='layered' else 1) and not menus[2]['spikes1'][0] and menus[1]['screen0'][0] and menus[2]['screen1'][0]==menus[1]['screen0'][0] and menus[2]['screen1'][1]==menus[1]['screen0'][1] and menus[2]['screen1'][2]==menus[1]['screen0'][2]+1 and not menus[2]['screen0'][0],(menus,calls)
 if data['kind']=='courtSwitch':assert menus[3]['own1Speed']==5 and 0<menus[3]['own1Hp']<menus[3]['own1MaxHp'],(menus,calls)
 if data['kind']=='web' and data['mode']!='bounce':
  expected=6 if data['mode'] in ('negative','clear','levitate') else 7 if data['mode']=='contrary' else 4 if data['mode'] in ('simple','edited') else 5
  assert menus[2]['enemy13Defense' if data['mode']=='edited' else 'enemy13Speed']==expected,(menus,calls)
  if data['mode']=='defiant':assert menus[2]['enemy13Attack']==8,(menus,calls)
 print(json.dumps({'game':data['game'],'kind':data['kind'],'mode':data['mode'],'passed':True,'menus':menus,'calls':calls,'loader':loader}))
finally:emu.destroy()
