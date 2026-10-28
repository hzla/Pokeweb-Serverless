"""Cold-boot native battles with keypad input and read-only observation hooks."""
import argparse,hashlib,json,shutil,subprocess,sys,tempfile
from pathlib import Path
from melonds import MelonDS

def main():
 p=argparse.ArgumentParser();p.add_argument('evidence',type=Path);p.add_argument('--start',type=int,default=0);p.add_argument('--limit',type=int);p.add_argument('--max-frames',type=int,default=14000);p.add_argument('--keep-going',action='store_true');a=p.parse_args()
 manifest=json.loads((a.evidence/'cases.json').read_text());selected=manifest['cases'][a.start:a.start+a.limit if a.limit else None];results=[]
 with tempfile.TemporaryDirectory(prefix='pokeweb-abilities-')as tmp:
  copies={}
  for name,digest in manifest['romHashes'].items():
   source=a.evidence/name;assert hashlib.sha256(source.read_bytes()).hexdigest()==digest;target=Path(tmp)/name
   if sys.platform!='darwin' or subprocess.run(['cp','-c',str(source),str(target)],stderr=subprocess.DEVNULL).returncode:shutil.copyfile(source,target)
   copies[name]=target
  for spec in selected:
   rom=copies[spec['rom']];shutil.copyfile(a.evidence/'saves'/f"{spec['label']}.sav",rom.with_suffix('.sav'))
   emu=MelonDS();flow=0;code=0;menus=[];multipliers=[];rewrites=[];errors=[];hooks=[];minimum={};healing=[];names=[];name_frame=0;name_captured=False;name_followups=set();native_chances=[];callback_priorities=[];damage_reactions=[];side_table=0;pending_damage=None;screen_removals=[];callback_owner=None;focus_work=[];move_end_items=[]
   result={'case':spec['label'],'abilityId':spec['abilityId'],'passed':False,'romSha256':manifest['romHashes'][spec['rom']]}
   def heap(fragment):
    address=next(value for name,value in manifest['pmcSymbols'].items()if fragment in name);value=emu.memory.read_long(address)
    if not 0x02000000<=value<0x02400000:return None
    capacity=emu.memory.read_long(value+8)
    if not 4096<=capacity<=1024*1024:return None
    node=emu.memory.read_long(value+12);seen=set();free=0
    while node:
     assert node not in seen and 0x02000000<=node<0x02400000;seen.add(node);size=emu.memory.read_long(node);assert size<=capacity;free+=size;node=emu.memory.read_long(node+4)
    assert free<=capacity;return {'capacity':capacity,'freePayloadBytes':free}
   def sample():
    for name,fragment in [('bookkeeping','g_UserHeapArea'),('system','g_MainAllocator')]:
     stats=heap(fragment)
     if stats and(name not in minimum or stats['freePayloadBytes']<minimum[name]['freePayloadBytes']):minimum[name]=stats
   def opening(cpu,address):
    nonlocal flow;flow=emu.memory.register_arm9.r6
   def command(cpu,address):
    nonlocal code,side_table
    try:
     if not flow or emu.memory.read_long(emu.memory.register_arm9.r1):return
     turn=emu.memory.read_long(flow+16)
     if menus and menus[-1]['turn']==turn:return
     main=emu.memory.read_long(flow+4);player=emu.memory.read_long(main+0xcc);enemy=emu.memory.read_long(main+0xcc+0x1c)
     state={'turn':turn,'frame':emu.frame_count,'hp':emu.memory.read_short(player+0x10),'maxHp':emu.memory.read_short(player+0xe),'item':emu.memory.read_short(player+0x12),'enemyHp':emu.memory.read_short(enemy+0x10),'enemyMaxHp':emu.memory.read_short(enemy+0xe),'ability':emu.memory.read_short(player+0x13c),'enemyAbility':emu.memory.read_short(enemy+0x13c),'stages':list(emu.memory.unsigned[player+0xfc:player+0x103]),'enemyStages':list(emu.memory.unsigned[enemy+0xfc:enemy+0x103]),'conditions':[emu.memory.read_long(player+0x1c+n*4)for n in range(36)],'enemyConditions':[emu.memory.read_long(enemy+0x1c+n*4)for n in range(36)]}
     state['focus']=bool(emu.memory.read_byte(player+0x156)&2)
     if'partyHpByTurn'in spec['checks']:state['partyHp']=[emu.memory.read_short(emu.memory.read_long(main+0xcc+slot*4)+0x10)for slot in range(len(spec['checks']['partyHpByTurn'][0]))]
     state['weather']=emu.memory.read_byte(manifest['weatherAddress'])if manifest.get('weatherAddress')else None
     ally_mon=emu.memory.read_long(main+0xd0)
     if spec.get('ally'):
      assert 0x02000000<=ally_mon<0x02400000
      state['allyFocus']=bool(emu.memory.read_byte(ally_mon+0x156)&2);state['allyHp']=emu.memory.read_short(ally_mon+0x10);state['allyMaxHp']=emu.memory.read_short(ally_mon+0xe);state['allyConditions']=[emu.memory.read_long(ally_mon+0x1c+n*4)for n in range(36)]
     for key,base in [('partyStages',main+0xcc),('enemyPartyStages',main+0xe8)]:
      if key in spec['checks']:
       state[key]=[]
       for slot in range(len(spec['checks'][key])):
        mon=emu.memory.read_long(base+slot*4);assert 0x02000000<=mon<0x02400000
        state[key].append(list(emu.memory.unsigned[mon+0xfc:mon+0x103]))
     if manifest.get('eventList'):
      node=emu.memory.read_long(manifest['eventList']+4);seen=set();registrations=[];side_items=[]
      while node:
       assert node not in seen and 0x02000000<=node<0x02400000;seen.add(node)
       if emu.memory.read_long(node+0x10)==4:registrations.append({'id':emu.memory.read_short(node+0x38),'owner':emu.memory.read_byte(node+0x3a),'priority':7-(emu.memory.read_long(node+0x14)>>24)})
       if emu.memory.read_long(node+0x10)==2:side_items.append({'node':node,'effect':emu.memory.read_short(node+0x38),'side':emu.memory.read_byte(node+0x3a),'condition':emu.memory.read_long(node+0x34)})
       node=emu.memory.read_long(node+4)
      state['abilityRegistrations']=registrations;state['sideItems']=side_items
      side_table=manifest.get('sideTableAddress',0)
      if side_table:
       for slot in side_items:assert emu.memory.read_long(side_table+(slot['side']*14+slot['effect'])*16)==slot['node']
      state['sideEffects']=[[emu.memory.read_long(side_table+(side*14+effect)*16+12)for effect in range(14)]for side in range(2)]if side_table else [[0]*14,[0]*14]

     assert emu.memory.read_short(player+0xc)==spec['speciesId'];assert state['maxHp']==spec['maxHp'];assert state['ability']==spec['abilityId']if not menus else True
     if not menus:
      site=manifest['hook']+2;hi=emu.memory.read_short(site);lo=emu.memory.read_short(site+2);assert emu.memory.read_short(manifest['hook'])==0xb500 and hi&0xf800==0xf000 and lo&0xf800==0xf800
      delta=((hi&0x7ff)<<12)|((lo&0x7ff)<<1)
      if delta&0x400000:delta-=0x800000
      code=site+4+delta-manifest['symbols']['AbilityDispatch'];assert 0x02000000<code<0x02400000;result['moduleCodeBase']=code
      data=emu.memory.read_long(code+manifest['symbols']['AbilityRuleData']);expected=bytes.fromhex(manifest['configHex']);actual=bytearray(emu.memory.unsigned[data:data+len(expected)])
      for offset in manifest['nativeOffsets']:
       ptr=int.from_bytes(actual[offset+8:offset+12],'little');assert code<=ptr<code+manifest['codeBytes'];assert 1<=actual[offset+14]<=16;actual[offset+8:offset+12]=bytes(4);actual[offset+14]=0
      assert bytes(actual)==expected,'Live configuration differs from export'
      node=emu.memory.read_long(next(v for n,v in manifest['pmcSymbols'].items()if'g_Modules'in n));states=[];ours=0
      while node:
       assert node not in states;states.append(node);ours+=emu.memory.read_long(node+8)==code-32;node=emu.memory.read_long(node+24)
      if spec['checks'].get('sharedItemModule'):
       site=manifest['itemHook']+2;hi=emu.memory.read_short(site);lo=emu.memory.read_short(site+2);delta=((hi&0x7ff)<<12)|((lo&0x7ff)<<1)
       if delta&0x400000:delta-=0x800000
       item_code=site+4+delta-manifest['itemDispatch'];item_records=sum(emu.memory.read_long(n+8)==item_code-32 for n in states);assert item_records==1;result['itemPatchRecords']=item_records
      assert ours==1;result['loader']={'totalPatchRecords':len(states),'abilityPatchRecords':ours,'liveRuleCount':manifest['editedAbilities']}
      for event in['38','3b','47','13']:
       if f'AbilityEvent_{event}'in manifest['symbols']:hooks.append(emu.memory.register_exec(code+manifest['symbols'][f'AbilityEvent_{event}'],recipe_callback))
      if'AbilityEvent_88'in manifest['symbols']:hooks.append(emu.memory.register_exec(code+manifest['symbols']['AbilityEvent_88'],move_end))
      if manifest.get('priorityRuntime'):hooks.append(emu.memory.register_exec(code+manifest['symbols']['AbilityEvent_4b'],contact_callback))
     menus.append(state)
    except Exception as error:errors.append(error)
   def scope():return code and menus and code<=(emu.memory.register_arm9.lr&~1)<code+manifest['codeBytes'] and flow and not emu.memory.read_long(flow+0x774)
   def multiplied(cpu,address):
    if scope():
     main=emu.memory.read_long(flow+4);mon=emu.memory.read_long(main+0xcc+(callback_owner if callback_owner is not None and callback_owner<12 else 7+(callback_owner-12 if callback_owner is not None else 0))*4)
     multipliers.append({'turnIndex':len(menus)-1,'key':emu.memory.register_arm9.r0,'value':emu.memory.register_arm9.r1,'owner':callback_owner,'suppressed':bool(emu.memory.read_long(mon+0x1c+16*4))if 0x02000000<=mon<0x02400000 else None})
   def rewritten(cpu,address):
    if scope():rewrites.append({'turnIndex':len(menus)-1,'key':emu.memory.register_arm9.r0,'value':emu.memory.register_arm9.r1})
   def pushed(cpu,address):
    if scope()and emu.memory.register_arm9.r1==26 and manifest.get('sideTableAddress'):screen_removals.append({'turnIndex':len(menus)-1,'screens':[[emu.memory.read_long(manifest['sideTableAddress']+(side*14+effect)*16+12)for effect in[0,1]]for side in range(2)]})
    if scope()and emu.memory.register_arm9.r1==5:healing.append({'turnIndex':len(menus)-1,'owner':emu.memory.register_arm9.r2})
   def popped(cpu,address):
    if flow and menus and not emu.memory.read_long(flow+0x774):
     work=emu.memory.register_arm9.r1
     if 0x02000000<=work<0x02400000 and emu.memory.read_byte(work)in[23,24]:focus_work.append({'turnIndex':len(menus)-1,'command':emu.memory.read_byte(work),'target':emu.memory.read_byte(work+8),'flag':emu.memory.read_long(work+4),'owned':bool(scope())})
   def named(cpu,address):
    nonlocal name_frame
    value=emu.memory.register_arm9.r2;names.append({'abilityId':value,'frame':emu.frame_count})
    if value==spec['abilityId'] and not name_frame:name_frame=emu.frame_count+14
   def rolled(cpu,address):
    if flow and menus and not emu.memory.read_long(flow+0x774):native_chances.append({'turnIndex':len(menus)-1,'chance':emu.memory.register_arm9.r1,'owned':bool(scope())})
   def move_end(cpu,address):
    owner=emu.memory.register_arm9.r2
    if flow and menus and owner==0 and not emu.memory.read_long(flow+0x774):
     mon=emu.memory.read_long(emu.memory.read_long(flow+4)+0xcc);move_end_items.append({'turnIndex':len(menus)-1,'item':emu.memory.read_short(mon+0x12)})
   def recipe_callback(cpu,address):
    nonlocal callback_owner
    callback_owner=emu.memory.register_arm9.r2
   def contact_callback(cpu,address):
    item=emu.memory.register_arm9.r0
    callback_priorities.append({'turnIndex':len(menus)-1,'owner':emu.memory.register_arm9.r2,'priority':7-(emu.memory.read_long(item+0x14)>>24)})
   def damaged(cpu,address):
    nonlocal pending_damage
    if flow and menus and not emu.memory.read_long(flow+0x774):
     regs=emu.memory.register_arm9;a=regs.r1;t=regs.r2
     pending_damage={'turnIndex':len(menus)-1,'attacker':emu.memory.read_byte(a+0x19),'target':emu.memory.read_byte(t+0x19)}
   def event_const(cpu,address):
    nonlocal pending_damage
    if pending_damage is not None:
     regs=emu.memory.register_arm9;key=regs.r0
     field={0x38:'effectiveness',0x32:'damage',0x45:'critical',0x46:'substitute'}.get(key)
     if field:pending_damage[field]=regs.r1
     if key==0x46:damage_reactions.append(pending_damage);pending_damage=None
   if manifest.get('damageReactionHook'):hooks.append(emu.memory.register_exec(manifest['damageReactionHook'],damaged))
   if manifest.get('eventConstHook'):hooks.append(emu.memory.register_exec(manifest['eventConstHook'],event_const))
   if manifest.get('nativeChanceHook'):hooks.append(emu.memory.register_exec(manifest['nativeChanceHook'],rolled))
   if manifest.get('nameLoader'):hooks.append(emu.memory.register_exec(manifest['nameLoader'],named))
   hooks.append(emu.memory.register_exec(manifest['api']['BattleHandler_PopWork'],popped))
   hooks += [emu.memory.register_exec(0x0219f5da,opening),emu.memory.register_exec(0x021cef18,command),emu.memory.register_exec(manifest['api']['BattleEventVar_MulValue'],multiplied),emu.memory.register_exec(manifest['api']['BattleEventVar_RewriteValue'],rewritten),emu.memory.register_exec(manifest['api']['BattleHandler_PushWork'],pushed)]
   try:
    emu.open(rom)
    for _ in range(a.max_frames):
     if menus:emu.input.keypad_update(1 if emu.frame_count%12<3 else 0)
     emu.cycle()
     if name_frame and not name_captured and emu.frame_count>=name_frame:
      emu.screenshot().save(a.evidence/f"{spec['label']}-ability-name.png");name_captured=True
     if spec['checks'].get('name') and name_frame:
      for delay in [15,30,45,60]:
       if delay not in name_followups and emu.frame_count>=name_frame+delay:
        emu.screenshot().save(a.evidence/f"{spec['label']}-ability-name-{delay+14}.png");name_followups.add(delay)
     if errors:raise errors[0]
     if emu.frame_count%30==0:sample()
     if len(menus)>=spec.get("menuCount",3):break
    emu.input.keypad_update(0);assert len(menus)>=spec.get('menuCount',3),f'No completed turns: {menus}'
    c=spec['checks'];hp=[s['hp']for s in menus]
    if c.get('someHolderSuppressed'):assert all(state['conditions'][16]or state.get('allyConditions',[0]*36)[16]for state in menus[1:]),menus
    if c.get('noSuppressedMultipliers'):assert all(v.get('owner')is not None and not v['suppressed']for v in multipliers if v['value']==5325),multipliers
    if'playerFocusByTurn'in c:assert[state['focus']for state in menus]==c['playerFocusByTurn'],menus
    if'partyHpByTurn'in c:assert[state['partyHp']for state in menus]==c['partyHpByTurn'],menus
    if'itemAtMoveEndFirstTurn'in c:assert any(v['turnIndex']==0 and v['item']==c['itemAtMoveEndFirstTurn']for v in move_end_items),move_end_items
    if c.get('noDamage'):assert all(s['hp']==spec['maxHp']for s in menus),menus
    if'itemByTurn'in c:assert[s['item']for s in menus]==c['itemByTurn'],menus
    for key,source,inverse in [('conditionAbsent','conditions',True),('conditionPresent','conditions',False),('enemyConditionPresent','enemyConditions',False),('allyConditionAbsent','allyConditions',True)]:
     if key in c:assert all(bool(state[source][c[key]])!=inverse for state in menus[1:]),menus
    if'weather'in c:assert menus[-1]['weather']==c['weather'],menus
    if'hazardLayers'in c:assert[state['sideEffects'][1][7]for state in menus]==c['hazardLayers'],menus
    if'allyHpByTurn'in c:assert[state['allyHp']for state in menus]==c['allyHpByTurn'],menus
    if c.get('screensCleared'):assert any(v['screens'][0][0]and v['screens'][1][0]for v in screen_removals)and all(not state['sideEffects'][side][effect]for state in menus for side in range(2)for effect in[0,1]),(menus,screen_removals)
    if c.get('retaliateExact'):assert hp[0]-hp[1]==menus[0]['enemyHp']and hp[1]-hp[2]==menus[1]['enemyHp'],menus
    if c.get('noEnemyCritical'):assert not any(hit['critical']for hit in damage_reactions if hit['target']==0),damage_reactions
    if'playerStagesFirstTurn'in c:assert menus[1]['stages']==c['playerStagesFirstTurn'],menus
    if'allyStatus'in c:assert all([n for n in range(1,6)if state['allyConditions'][n]]==([c['allyStatus']]if c['allyStatus']else[])for state in menus),menus
    if c.get('berryAfterStage'):assert menus[1]['item']==0 and menus[1]['stages'][2]>menus[0]['stages'][2],menus
    if c.get('allEnemyCritical'):
     hits=[hit for hit in damage_reactions if hit['target']==0];assert len(hits)>=2 and all(hit['critical']for hit in hits),damage_reactions
    if'effectiveness'in c:assert [hit['effectiveness']for hit in damage_reactions if hit['target']==0]==c['effectiveness'],damage_reactions
    if'item'in c:assert all(s['item']==c['item']for s in menus),menus
    if c.get('name'):assert any(n['abilityId']==spec['abilityId']for n in names),names
    if'heal'in c or'divisor'in c or'healPercent'in c:
     amount=c.get('heal',max(1,spec['maxHp']//c['divisor'])if'divisor'in c else max(1,int(spec['maxHp']*c.get('healPercent',0)/100)))
     assert hp==[spec['hp'],min(spec['maxHp'],spec['hp']+amount),min(spec['maxHp'],spec['hp']+amount*2)],(hp,amount)
    if'recoilPercent'in c:
     amount=max(1,int(spec['maxHp']*c['recoilPercent']/100));assert hp==[spec['hp'],spec['hp']-amount,spec['hp']-amount*2],hp
    if'multiplier'in c:assert any(v['value']==c['multiplier']for v in multipliers),(c,multipliers)
    if'allMultipliers'in c:assert all(any(v['value']==value for v in multipliers)for value in c['allMultipliers']),(c,multipliers)
    if'noMultiplierAfterFirstTurn'in c:assert all(v['value']!=c['noMultiplierAfterFirstTurn']for v in multipliers if v['turnIndex']>=1),(c,multipliers)
    if'noMultiplier'in c:assert all(v['value']!=c['noMultiplier']for v in multipliers),(c,multipliers)
    if'noMultiplier2'in c:assert all(v['value']!=c['noMultiplier2']for v in multipliers),(c,multipliers)
    if'rewrite'in c:assert any(v['key']==c['rewrite']['key']and v['value']==c['rewrite']['value']for v in rewrites),(c,rewrites)
    if'noRewrite'in c:assert not any(v['key']==c['noRewrite']['key']and v['value']==c['noRewrite']['value']for v in rewrites),(c,rewrites)
    for side,key in [('', 'status'),('enemy','enemyStatus')]:
     if key in c:
      for s in menus[1:]:
       conditions=s['enemyConditions'if side else'conditions'];actual=[n for n in range(1,7)if conditions[n]];assert actual==([c[key]]if c[key]else[]),(actual,c,menus)
    if'stages'in c:assert all(s['stages']==c['stages']for s in menus),menus
    if'hpByTurn'in c:assert hp==c['hpByTurn'],menus
    if c.get('hpIncreases'):assert all(hp[i+1]>hp[i]for i in range(len(hp)-1)),menus
    if'enemyStatusFirstTurn'in c:assert menus[1]['enemyConditions'][c['enemyStatusFirstTurn']],menus
    if'enemyStatusByTurn'in c:assert [[n for n in range(1,6)if s['enemyConditions'][n]]for s in menus]==[([v]if v else[])for v in c['enemyStatusByTurn']],menus
    if'enemyStages'in c:assert all(s['enemyStages']==c['enemyStages']for s in menus),menus
    for key in ['partyStages','enemyPartyStages']:
     if key in c:assert all(s[key]==c[key]for s in menus),menus
    if'playerStagesByTurn'in c:assert[s['stages']for s in menus]==c['playerStagesByTurn'],menus
    if'enemyStagesByTurn'in c:assert[s['enemyStages']for s in menus]==c['enemyStagesByTurn'],menus
    if'speedStages'in c:assert[s['stages'][4]for s in menus]==c['speedStages'],menus
    if'enemySpeedStages'in c:assert[s['enemyStages'][4]for s in menus]==c['enemySpeedStages'],menus
    if'suppressed'in c:assert all(s['conditions'][16]for s in menus[1:]),menus
    if'playerAbilities'in c:assert[s['ability']for s in menus]==c['playerAbilities'],menus
    if'enemyAbilities'in c:assert[s['enemyAbility']for s in menus]==c['enemyAbilities'],menus
    if c.get('enemyDamaged'):assert menus[1]['enemyHp']<menus[0]['enemyHp'],menus
    if c.get('healingObserved'):assert healing,healing
    if c.get('noWeatherDamage'):assert all(s['hp']==spec['maxHp']for s in menus),menus
    if c.get('weatherDamage'):assert menus[2]['hp']<menus[1]['hp']<menus[0]['hp'],menus
    if'nativeChance'in c:assert any(v['chance']==c['nativeChance'] and v['owned']==c.get('nativeChanceOwned',True) for v in native_chances),(c,native_chances)
    if c.get('noNativeChance'):assert not any(v['owned'] for v in native_chances),native_chances
    if c.get('priorityGroups'):
     for s in menus:
      for ability in [s['ability'],s['enemyAbility']]:
       actual=sorted(v['priority'] for v in s['abilityRegistrations'] if v['id']==ability)
       expected=[4,5] if 165<=ability<=173 else [4] if ability==143 else [5]
       assert actual==expected,(ability,actual,expected,s)
     if c.get('suppressed'):assert not callback_priorities,callback_priorities
     elif spec.get('move')==33 and spec['abilityId']!=143:assert {4,5}.issubset({v['priority']for v in callback_priorities}),callback_priorities
    result.update(passed=True,menus=menus,multipliers=multipliers,rewrites=rewrites,healing=healing,names=names,nativeChances=native_chances,callbackPriorities=callback_priorities,damageReactions=damage_reactions,focusWork=focus_work,moveEndItems=move_end_items,screenRemovals=screen_removals,minimumObservedFree=minimum)
    emu.run_frames(20);emu.screenshot().save(a.evidence/f"{spec['label']}.png");(a.evidence/f"{spec['label']}-result.json").write_text(json.dumps(result,indent=2)+'\n');results.append(result);print(f"PASS {spec['label']}: HP {hp}; abilities {[s['ability']for s in menus]}",flush=True)
   except Exception as error:
    result.update(error=repr(error),menus=menus,multipliers=multipliers,rewrites=rewrites,minimumObservedFree=minimum,pc=hex(emu.memory.register_arm9.pc),damageReactions=damage_reactions,focusWork=focus_work,moveEndItems=move_end_items);emu.screenshot().save(a.evidence/f"{spec['label']}-failure.png");(a.evidence/f"{spec['label']}-failure.json").write_text(json.dumps(result,indent=2)+'\n');results.append(result);print(f"FAIL {spec['label']}: {error!r}",flush=True)
    if not a.keep_going:raise
   finally:emu.destroy()
 (a.evidence/f'emulator-{a.start}-{len(results)}.json').write_text(json.dumps({'passed':sum(r['passed']for r in results),'cases':results,'scope':'DS-mode melonDS cold boots; native engine; keypad input; read-only hooks'},indent=2)+'\n')
if __name__=='__main__':main()
