"""Run a disposable battle fixture and capture native history/power events."""
import json,sys
from pathlib import Path
from melonds import MelonDS
root=Path(sys.argv[1]);data=json.loads((root/'fixture.json').read_text());emu=MelonDS();hooks=[];menus=[];rewrites=[];history=[];protect=[];selections=[];transforms=[];passes=[];leave=[];multipliers=[];residual=[];types=[];blocks=[];critical=[];critrank=[];flow=0;code=0;fainted_at=None
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
def rewrite(cpu,address):
 r=emu.memory.register_arm9
 if r.r0 not in (0x30,0x16,0x41) or not code or not code<=(r.lr&~1)<code+data.get('codeBytes',0):return
 table=emu.memory.read_long(data['getter']+0x2c);start=emu.memory.read_long(table);values={}
 if start>=96:return
 for n in range(start,96):
  k=emu.memory.read_short(table+4+n*2)
  if not k:break
  values[k]=emu.memory.read_long(table+0xc4+n*4)
 if r.r0==0x41:blocks.append({'value':r.r1,'actor':values.get(2),'turn':emu.memory.read_long(flow+16) if flow else None})
 elif r.r0==0x16:
  row={'value':r.r1,'actor':values.get(2),'turn':emu.memory.read_long(flow+16) if flow else None};types.append(row);handle=None
  def returned(cpu,address):
   row['accepted']=bool(emu.memory.register_arm9.r0);handle.remove()
  handle=emu.memory.register_exec(r.lr&~1,returned);hooks.append(handle)
 else:rewrites.append({'value':r.r1,'actor':values.get(3),'turn':emu.memory.read_long(flow+16) if flow else None})
def multiply(cpu,address):
 r=emu.memory.register_arm9
 if data['kind']!='vulnerable' or r.r0!=0x35 or not code<=((r.lr)&~1)<code+data['codeBytes']:return
 table=emu.memory.read_long(data['getter']+0x2c);start=emu.memory.read_long(table);values={}
 if start>=96:return
 for n in range(start,96):
  k=emu.memory.read_short(table+4+n*2)
  if not k:break
  values[k]=emu.memory.read_long(table+0xc4+n*4)
 multipliers.append({'ratio':r.r1,'actor':values.get(3),'target':values.get(4)})
def popwork(cpu,address):
 r=emu.memory.register_arm9
 if data['kind'] not in ('residualDamage','powder') or not code<=((r.lr)&~1)<code+data['codeBytes']:return
 p=r.r1
 if 0x02000000<=p<0x02400000 and emu.memory.read_byte(p+6)==12:residual.append(emu.memory.read_short(p+4))
def focuscritical(cpu,address):
 r=emu.memory.register_arm9;table=emu.memory.read_long(data['getter']+0x2c);start=emu.memory.read_long(table);actor=None
 if start<96:
  for n in range(start,96):
   k=emu.memory.read_short(table+4+n*2)
   if not k:break
   if k==3:actor=emu.memory.read_long(table+0xc4+n*4)
 row={'actor':actor};critical.append(row);handle=None
 def returned(cpu,address):
  row['critical']=emu.memory.register_arm9.r0;handle.remove()
 handle=emu.memory.register_exec(r.lr&~1,returned);hooks.append(handle)
def rankcritical(cpu,address):
 r=emu.memory.register_arm9;mon=r.r0;row={'actor':emu.memory.read_byte(mon+0x19)};critrank.append(row);handle=None
 def returned(cpu,address):
  row['rank']=emu.memory.register_arm9.r0;handle.remove()
 handle=emu.memory.register_exec(r.lr&~1,returned);hooks.append(handle)
def selection(cpu,address):
 r=emu.memory.register_arm9;mon=r.r1;move=r.r2;message=r.r3
 if move!=33 or emu.memory.read_byte(mon+0x19)!=0:return
 record={'move':move,'turn':emu.memory.read_long(flow+16),'message':message};selections.append(record)
 lr=r.lr&~1;handle=None
 def returned(cpu,address):
  record['result']=emu.memory.register_arm9.r0
  if message and record['result']:record['messageId']=emu.memory.read_short(message)
  handle.remove()
 handle=emu.memory.register_exec(lr,returned);hooks.append(handle)
def pass_effects(cpu,address):
 r=emu.memory.register_arm9;a=emu.memory.read_byte(r.r0+0x19);b=emu.memory.read_byte(r.r1+0x19)
 row={'dest':a,'source':b,'flag':emu.memory.read_byte(r.r1+0x156),'boost':emu.memory.read_byte(code+data['symbols']['moveCritBoost']+b),'pending':emu.memory.read_byte(code+data['symbols']['moveCritPending']+b)};passes.append(row);handle=None
 def returned(cpu,address):
  row['copied']=emu.memory.read_byte(code+data['symbols']['moveCritBoost']+a);handle.remove()
 handle=emu.memory.register_exec(r.lr&~1,returned);hooks.append(handle)
def leave_effects(cpu,address):
 vals={};table=emu.memory.read_long(data['getter']+0x2c);start=emu.memory.read_long(table)
 for n in range(start,96):
  k=emu.memory.read_short(table+4+n*2)
  if not k:break
  vals[k]=emu.memory.read_long(table+0xc4+n*4)
 i=vals.get(2,31)
 if i>=24:return
 leave.append({'id':i,'event':address-code,'boost':emu.memory.read_byte(code+data['symbols']['moveCritBoost']+i),'pending':emu.memory.read_byte(code+data['symbols']['moveCritPending']+i)})
def command(cpu,address):
 global code
 if not flow or emu.memory.read_long(emu.memory.register_arm9.r1):return
 turn=emu.memory.read_long(flow+16)
 if menus and menus[-1]['turn']==turn:return
 if not code:
  code=dispatch_base()
  if data['kind'] in ('critBoost','critTransform'):hooks.append(emu.memory.register_exec(code+data['symbols']['MoveCriticalRank'],rankcritical))
  if data['kind'] in ('focus','focusCombined'):hooks.append(emu.memory.register_exec(code+data['symbols']['MoveFocusedCritical'],focuscritical))
  if data['kind']=='critPass':
   hooks.append(emu.memory.register_exec(code+data['symbols']['MovePassEffects'],pass_effects))
   for sym in ('MoveHistoryEvent_54','MoveHistoryEvent_a3'):hooks.append(emu.memory.register_exec(code+data['symbols'][sym],leave_effects))
  if data['kind']=='transformHits':hooks.append(emu.memory.register_exec(code+data['symbols']['MoveHistoryTransform'],lambda cpu,address:transforms.append(True)))
  if data['kind']=='moveFailedProtect':hooks.append(emu.memory.register_exec(code+data['symbols']['MoveHistoryProtect'],lambda cpu,address:protect.append(True)))
  if data['kind'] in ('selectionGate','belchGate'):hooks.append(emu.memory.register_exec(code+data['symbols']['MoveHistorySelect'],selection))
 state=code+data['symbols']['moveHistory']
 player=emu.memory.read_long(emu.memory.read_long(flow+8)+0x84)
 enemy=emu.memory.read_long(emu.memory.read_long(flow+8)+0x84+12*4)
 menus.append({'turn':turn,'frame':emu.frame_count,'raised':emu.memory.read_long(state+4),'lowered':emu.memory.read_long(state+8),'berry':emu.memory.read_long(state),'failed':emu.memory.read_long(state+16),'hits':emu.memory.read_byte(state+28),'enemyHits':emu.memory.read_byte(state+40),'faints':emu.memory.read_byte(state+54),'selected':emu.memory.read_short(state+152),'playerTrap':emu.memory.read_long(player+0x1c+22*4),'enemyTrap':emu.memory.read_long(enemy+0x1c+22*4),'playerAttackStage':emu.memory.read_byte(player+0xfc),'playerSpeedStage':emu.memory.read_byte(player+0x100),'ability':emu.memory.read_short(player+0x13c),'suppressed':emu.memory.read_long(player+0x1c+16*4),'enemyAbility':emu.memory.read_short(enemy+0x13c),'enemyBurn':emu.memory.read_long(enemy+0x1c+4*4),'enemyHp':emu.memory.read_short(enemy+0x10),'enemyMaxHp':emu.memory.read_short(enemy+0xe),'enemySpeedStage':emu.memory.read_byte(enemy+0x100),'enemyDefenseStage':emu.memory.read_byte(enemy+0xfd),'enemySpDefStage':emu.memory.read_byte(enemy+0xff),'fieldLockTurns':emu.memory.read_byte(code+data['symbols']['moveFieldLockTurns']) if 'moveFieldLockTurns' in data['symbols'] else 0,'ownCritBoost':emu.memory.read_byte(code+data['symbols']['moveCritBoost']) if 'moveCritBoost' in data['symbols'] else 0,'passedCritBoost':emu.memory.read_byte(code+data['symbols']['moveCritBoost']+1) if 'moveCritBoost' in data['symbols'] else 0,'copiedCritBoost':emu.memory.read_byte(code+data['symbols']['moveCritBoost']+12) if 'moveCritBoost' in data['symbols'] else 0,'enemyCritFlag':bool(emu.memory.read_byte(enemy+0x156)&2)})
delta=32 if data['game']=='IRAO' else 0
if data['game'] in ('IRBO','IRAO'):
 hooks.append(emu.memory.register_exec(0x021bbb60+delta,opening));hooks.append(emu.memory.register_exec(0x021bacac+delta,command))
else:
 delta=64 if data['game']=='IREO' else 0
 hooks.append(emu.memory.register_exec(0x0219f5da-delta,opening));hooks.append(emu.memory.register_exec(0x021cef18-delta,command))
hooks.append(emu.memory.register_exec(data['rewrite'],rewrite))
if data.get('multiply'):hooks.append(emu.memory.register_exec(data['multiply'],multiply))
if data.get('pop'):hooks.append(emu.memory.register_exec(data['pop'],popwork))
try:
 emu.open(root/'battle.nds')
 for _ in range(6500 if data['kind']=='critPass' else 8000 if data['kind']=='partyFaints' else 18000):
  key=128 if 600<=emu.frame_count<602 else 1 if emu.frame_count%12<3 else 0
  if data['kind'] in ('pluck','immuneFailure','missFailure','focus','focusCombined','critBoost','critPass') and menus:
   age=emu.frame_count-menus[-1]['frame'];emu.input.touch_release();key=1 if age>180 and emu.frame_count%12<3 else 0
   if 60<=age<64:emu.input.touch_set_pos(128,85)
   if 140<=age<144:emu.input.touch_set_pos(64 if len(menus)==1 else 192,44)
  if data['kind']=='critPass' and len(menus)>=2:
   age=emu.frame_count-menus[1]['frame']
   if age>300:
    key=1 if age>1300 and emu.frame_count%12<3 else 0
    emu.input.touch_release()
    if 1200<=age<1204:emu.input.touch_set_pos(190,30)
  emu.input.keypad_update(key);emu.cycle()
  if data['kind'] in ('partyFaints','faintPower') and ((data.get('mode','positive')=='positive' and any(r['value']==(90 if data['kind']=='faintPower' else 80) and r['actor']==(13 if data['kind']=='faintPower' else 0) for r in rewrites) and any(m['faints'] for m in menus)) or (data.get('mode','positive')!='positive' and len(menus)>=3)):break
  if data['kind']=='selectionGate' and len(menus)>=2 and any(s.get('result')==1 and s['turn']>=1 for s in selections):break
  if data['kind']=='belchGate' and (any(s.get('result')==0 for s in selections) if data.get('mode')=='positive' else any(s.get('result')==1 and s.get('messageId')==905 for s in selections)):break
  if data['kind'] not in ('partyFaints','faintPower','selectionGate','belchGate') and len(menus)>=(3 if data['kind'] in ('selectedMove','moveFailed','pluck','immuneFailure','missFailure','selfTrap','focus','focusCombined','critBoost','critPass','fieldLock') else 2):break
 need=1 if data['kind']=='belchGate' else 3 if data['kind'] in ('selectedMove','moveFailed','pluck','immuneFailure','missFailure','selfTrap','focus','focusCombined','critBoost','critPass','fieldLock') else 2
 if len(menus)<need:emu.screenshot().save(root/'failure.png')
 assert len(menus)>=need,('No completed turn',menus,hex(emu.memory.register_arm9.pc),fainted_at)
 powers=[r['value'] for r in rewrites if r['actor']==(13 if data['kind']=='faintPower' else 0) and (data['kind'] not in ('partyFaints','faintPower','selectedMove','moveFailed','pluck','immuneFailure','missFailure') or r['turn']==1)];mode=data.get('mode','positive')
 if data['kind']=='statLowered':assert menus[0]['lowered']&1,(menus,rewrites)
 if data['kind']=='ateBerry':assert menus[0]['berry']&1,(menus,rewrites)
 if data['kind']=='pluck':assert menus[1]['berry']&1 and not menus[1]['berry']&(1<<12),(menus,rewrites)
 if data['kind']=='selectedMove':assert menus[1]['selected']==33,(menus,rewrites)
 if data['kind']=='calledMove':assert menus[1]['selected']==214,(menus,rewrites)
 if data['kind'] in ('moveFailed','immuneFailure','missFailure'):assert menus[1]['failed']&1,(menus,rewrites)
 if data['kind']=='moveFailedProtect':assert protect and not menus[1]['failed']&1 and 80 not in powers,(menus,rewrites,protect)
 elif data['kind']=='fieldLock':assert [m['fieldLockTurns'] for m in menus[:3]]==[0,1,0],menus
 elif data['kind']=='critTransform':assert menus[1]['copiedCritBoost']==menus[1]['ownCritBoost'] and menus[1]['enemyCritFlag'],menus
 elif data['kind']=='critPass':assert menus[2]['passedCritBoost']==menus[1]['ownCritBoost'] and menus[2]['passedCritBoost']>0,(menus,passes,leave)
 elif data['kind']=='critBoost':assert any(c['actor']==0 and c.get('rank')==(2 if mode=='edited' else 1) for c in critrank),(menus,critrank)
 elif data['kind'] in ('focus','focusCombined'):assert (any(c['actor']==0 and c.get('critical')==1 for c in critical))==(mode!='negative'),(menus,critical)
 elif data['kind']=='soundBlock':assert menus[1]['playerAttackStage']==6 and (any(b['value']==1 and b['actor']==12 for b in blocks))==(mode!='negative'),(menus,blocks)
 elif data['kind']=='powder':assert (not residual if mode=='negative' else max(1,menus[0]['enemyMaxHp']//(5 if mode=='edited' else 4)) in residual),(menus,residual)
 elif data['kind']=='octolock':assert menus[1]['enemyTrap'] and menus[1]['enemyDefenseStage']==5 and menus[1]['enemySpDefStage']==5,menus
 elif data['kind']=='mutualTrap':assert bool(menus[1]['playerTrap']) and bool(menus[1]['enemyTrap'])==(mode!='negative'),menus
 elif data['kind']=='selfTrap':assert [m['playerSpeedStage'] for m in menus[:3]]==[6,7,7],menus
 elif data['kind'] in ('fieldType','fieldStatus','targetType'):assert (any(t['value']==12 and t['actor']==12 and t.get('accepted') for t in types))==(mode!='negative'),(menus,types)
 elif data['kind']=='residualDamage':assert (not residual if mode=='negative' else max(1,menus[0]['enemyMaxHp']//(5 if mode=='edited' else 4)) in residual),(menus,residual)
 elif data['kind']=='residualStat':assert menus[1]['enemySpeedStage']==menus[0]['enemySpeedStage']+(0 if mode=='negative' else 1 if mode=='contrary' else -2 if mode in ('edited','simple') else -1),menus
 elif data['kind']=='vulnerable':assert any(m['ratio']==(6144 if mode=='edited' else 8192) and m['target']==0 for m in multipliers),(menus,multipliers,rewrites)
 elif data['kind']=='transformHits':assert transforms and menus[1]['enemyHits']==0,(menus,rewrites,transforms)
 elif data['kind']=='selectionGate':assert any(s.get('result')==0 and s['turn']==0 for s in selections) and any(s.get('result')==1 and s['turn']>=1 for s in selections),(menus,selections)
 elif data['kind']=='belchGate':assert (any(s.get('result')==0 for s in selections) if mode=='positive' else any(s.get('result')==1 and s.get('messageId')==905 for s in selections)),(menus,selections)
 elif data['kind']=='historyBurn':assert bool(menus[1]['enemyBurn'])==(mode=='positive'),(menus,rewrites)
 elif data['kind']=='faintPower':assert 90 in powers,(menus,rewrites)
 elif data['kind']=='historyPower':assert (65 if mode=='edited' else 90) in powers,(menus,rewrites)
 elif data['kind']=='calledMove':assert 80 not in powers,(menus,rewrites)
 elif mode=='positive':assert 80 in powers,(menus,rewrites)
 else:assert 80 not in powers,(menus,rewrites)
 if data['kind'] in ('partyFaints','faintPower'):assert any(m['faints'] for m in menus),(menus,rewrites)
 if data['kind']=='suppression':assert menus[1]['suppressed'],(menus,rewrites)
 if data['kind']=='swap':assert menus[1]['ability']==50 and menus[1]['enemyAbility']==165,(menus,rewrites)
 print(json.dumps({'game':data['game'],'passed':True,'menus':menus,'powerWrites':rewrites,'selection':selections,'multipliers':multipliers,'residual':residual,'types':types,'blocks':blocks,'critical':critical,'critrank':critrank}))
finally:emu.destroy()
