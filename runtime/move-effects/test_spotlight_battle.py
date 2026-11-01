"""Cold boot a generated BW1 fixture and check native battle state."""
import json,sys
from pathlib import Path
from melonds import MelonDS
root=Path(sys.argv[1]);data=json.loads((root/'fixture.json').read_text());emu=MelonDS();hooks=[];menus=[];calls=[];weather=[];flow=0;code=0;loader={};redirects=[]
assert data['template'] in ('Spotlight','Dragon Cheer'), 'No battle oracle for this template'
delta=32 if data['game']=='IRAO' else 0
def dispatch_base():
 site=data['hook']+2;hi=emu.memory.read_short(site);lo=emu.memory.read_short(site+2)
 assert emu.memory.read_short(data['hook'])==0xb500 and hi&0xf800==0xf000 and lo&0xf800==0xf800
 distance=((hi&0x7ff)<<12)|((lo&0x7ff)<<1)
 if distance&0x400000:distance-=0x800000
 return site+4+distance-data['symbols']['MoveDispatch']
def opening(cpu,address):
 global flow
 candidate=emu.memory.register_arm9.r0 if data['game'] in ('IRBO','IRAO') else emu.memory.register_arm9.r6
 if not 0x02000000<=candidate<0x02400000:return
 main=emu.memory.read_long(candidate+4)
 if 0x02000000<=main<0x02400000 and emu.memory.read_long(main+8)==emu.memory.read_long(candidate):flow=candidate
def type_match(cpu,address):
 r=emu.memory.register_arm9;row={'moveType':r.r3};calls.append(row)
 lr=r.lr&~1;handle=None
 def returned(cpu,address):
  row['result']=emu.memory.register_arm9.r0;handle.remove()
 handle=emu.memory.register_exec(lr,returned)
 hooks.append(handle)
def substitute(cpu,address):
 row={};calls.append(row);lr=emu.memory.register_arm9.lr&~1;handle=None
 def returned(cpu,address):
  row['result']=emu.memory.register_arm9.r0;handle.remove()
 handle=emu.memory.register_exec(lr,returned);hooks.append(handle)
def user_type(cpu,address):
 r=emu.memory.register_arm9;param=r.r3;row={};calls.append(row);lr=r.lr&~1;handle=None
 def returned(cpu,address):
  row['type']=emu.memory.read_byte(param+6);handle.remove()
 handle=emu.memory.register_exec(lr,returned);hooks.append(handle)
def weather_query(cpu,address):
 if menus:
  lr=emu.memory.register_arm9.lr&~1;weather.append({'own':bool(code<=lr<code+data['codeBytes']),'turn':len(menus)-1})
def event_values():
 table=emu.memory.read_long(data['getter']+0x2c);start=emu.memory.read_long(table);values={}
 if start<96:
  for n in range(start,96):
   k=emu.memory.read_short(table+4+n*2)
   if not k:break
   values[k]=emu.memory.read_long(table+0xc4+n*4)
 return values
def redirect(cpu,address):
 r=emu.memory.register_arm9;before=event_values();row={'actor':before.get(3),'before':before.get(4)};redirects.append(row);handle=None
 def returned(cpu,address):
  row['after']=event_values().get(4);handle.remove()
 handle=emu.memory.register_exec(r.lr&~1,returned);hooks.append(handle)
def command(cpu,address):
 global code,loader
 if not flow or emu.memory.read_long(emu.memory.register_arm9.r1):return
 turn=emu.memory.read_long(flow+16)
 if menus and menus[-1]['turn']==turn:return
 main=emu.memory.read_long(flow+4) if data['game'] in ('IRBO','IRAO') else emu.memory.read_long(flow+8);p=emu.memory.read_long(main+0xcc) if data['game'] in ('IRBO','IRAO') else emu.memory.read_long(main+0x84);e=emu.memory.read_long(main+0xe8) if data['game'] in ('IRBO','IRAO') else emu.memory.read_long(main+0x84+12*4)
 if not all(0x02000000<=x<0x02400000 for x in (p,e)):return
 ally=emu.memory.read_long(main+0xd0 if data['game'] in ('IRBO','IRAO') else main+0x88)
 menus.append({'allyCritBoost':emu.memory.read_byte(code+data['symbols']['moveCritBoost']+1) if code and 'moveCritBoost' in data['symbols'] else 0,'allyCritFlag':bool(emu.memory.read_byte(ally+0x156)&2) if ally else False,'turn':turn,'frame':emu.frame_count,'playerHp':emu.memory.read_short(p+0x10),'playerMaxHp':emu.memory.read_short(p+0xe),'playerAbility':emu.memory.read_short(p+0x13c),'playerSpeed':emu.memory.read_short(p+0xf6),'playerStages':list(emu.memory.unsigned[p+0xfc:p+0x103]),'enemyHp':emu.memory.read_short(e+0x10),'enemyMaxHp':emu.memory.read_short(e+0xe),'enemyAbility':emu.memory.read_short(e+0x13c),'enemySpeed':emu.memory.read_short(e+0xf6),'enemySuppressed':emu.memory.read_long(e+0x1c+16*4),'enemyPP':emu.memory.read_byte(e+0x10c),'enemySubstitute':emu.memory.read_short(e+0x1f2),'enemyTypes':[emu.memory.read_byte(e+0xf8),emu.memory.read_byte(e+0xf9)]})
 if len(menus)==1:
  code=dispatch_base()
  if 'recipeCount' in data:
   ptr=emu.memory.read_long(code+data['symbols']['MoveRuleData']);assert emu.memory.read_short(ptr)==data['recipeCount']
   head=next(value for name,value in data['pmcSymbols'].items() if 'g_Modules' in name);node=emu.memory.read_long(head);seen=set();count=0
   while node:
    assert node not in seen;seen.add(node);count+=emu.memory.read_long(node+8)==code-32;node=emu.memory.read_long(node+24)
   assert count==1;loader={'moveDlls':count,'recipeCount':data['recipeCount']}
   head=next(value for name,value in data['pmcSymbols'].items() if 'g_MainAllocator' in name);heap=emu.memory.read_long(head)
   if 0x02000000<=heap<0x02400000:
    node=emu.memory.read_long(heap+12);seen=set();free=0
    while node:
     assert node not in seen and 0x02000000<=node<0x02400000;seen.add(node);free+=emu.memory.read_long(node);node=emu.memory.read_long(node+4)
    loader['freeHeap']=free
  if data['template']=='Spotlight':hooks.append(emu.memory.register_exec(code+data['symbols']['MoveSpotlightRedirect'],redirect))
  if data['template']=='Freeze-Dry':hooks.append(emu.memory.register_exec(code+data['symbols']['MoveTypeMatchup'],type_match))
  if data['template']=='Torch Song':hooks.append(emu.memory.register_exec(code+data['symbols']['MoveDamagingSubstitute'],substitute))
  if data['template']=='Revelation Dance':hooks.append(emu.memory.register_exec(code+data['symbols']['MoveResolveUserType'],user_type))
if data['game'] in ('IRBO','IRAO'):
 hooks.append(emu.memory.register_exec(0x021bbb60+delta,opening));hooks.append(emu.memory.register_exec(0x021bacac+delta,command))
else:
 delta=64 if data['game']=='IREO' else 0
 hooks.append(emu.memory.register_exec(0x0219f5da-delta,opening));hooks.append(emu.memory.register_exec(0x021cef18-delta,command))
if data.get('weatherService'):hooks.append(emu.memory.register_exec(data['weatherService'],weather_query))
try:
 emu.open(root/'battle.nds')
 for _ in range(14000):
  key=128 if 600<=emu.frame_count<602 else 1 if emu.frame_count%12<3 else 0
  emu.input.keypad_update(key)
  emu.cycle()
  if len(menus)>=2:break
 assert len(menus)>=2,('No completed turn',menus,hex(emu.memory.register_arm9.pc))
 if data['template'] not in ('Doodle','Speed Swap','Spotlight','Dragon Cheer'):assert menus[1]['enemyHp']<menus[0]['enemyHp'],menus
 if data['template']=='Freeze-Dry':
  assert menus[0]['enemyTypes']==[10,2],menus
  if data.get('doubles'):
   assert any(row.get('moveType')==14 and row.get('result')==4 for row in calls),(calls,menus)
  else:assert len(calls)>=2 and [row.get('result') for row in calls[:2]]==data['expected'] and all(row.get('moveType')==14 for row in calls[:2]),calls
 if data['template']=='Torch Song':
  assert menus[1]['playerStages'][2]==menus[0]['playerStages'][2]+1,menus
  assert menus[1]['enemySubstitute']>0 and menus[1]['enemyHp']<menus[1]['enemyMaxHp']*3//4,menus
  assert any(row.get('result')==0 for row in calls),calls
 if data['template']=='Revelation Dance':assert any(row.get('type')==11 for row in calls),calls
 if data['template']=='Steel Beam':assert menus[1]['playerHp']==menus[0]['playerHp']-menus[0]['playerMaxHp']//2,menus
 if data['template']=='Eerie Spell':assert menus[1]['enemyPP']==menus[0]['enemyPP']-4,menus
 if data['template']=='Core Enforcer':assert menus[1]['enemySuppressed'],menus
 if data['template']=='Doodle':assert menus[0]['playerAbility']==50 and menus[1]['playerAbility']==165,menus
 if data['template']=='Speed Swap':assert menus[1]['playerSpeed']==menus[0]['enemySpeed'] and menus[1]['enemySpeed']==menus[0]['playerSpeed'],menus
 if data['template']=='Spotlight':assert any(r['actor'] in (12,13) and r['before']!=r.get('after') and r.get('after')==1 for r in redirects),(menus,redirects)
 if data['template']=='Dragon Cheer':assert menus[1]['allyCritFlag'] and menus[1]['allyCritBoost']==data['expectedBoost'],menus
 print(json.dumps({'redirects':redirects,'game':data['game'],'passed':True,'menus':menus,'typeCalls':calls,'loader':loader,'weatherQueries':len(weather),'ownWeatherQueries':sum(row['own'] for row in weather)}))
finally:emu.destroy()
