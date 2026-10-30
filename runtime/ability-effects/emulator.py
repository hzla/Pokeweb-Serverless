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
   emu=MelonDS();flow=0;code=0;menus=[];multipliers=[];rewrites=[];errors=[];hooks=[];minimum={};healing=[];names=[];name_frame=0;name_captured=False;name_followups=set();native_chances=[];callback_priorities=[];damage_reactions=[];side_table=0;pending_damage=None;screen_removals=[];callback_owner=None;focus_work=[];move_end_items=[];combat_types=[];event_trace=[];native_stab=[]
   result={'case':spec['label'],'abilityId':spec['abilityId'],'passed':False,'romSha256':manifest['romHashes'][spec['rom']]}
   counter_callers=[];type_queries=[];client_traps=[];pending_client_trap=None;popups=[];popup_hooked=False;indirect_damage=[]
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
    nonlocal flow,code,popup_hooked;flow=emu.memory.register_arm9.r6
    if manifest.get('popupGateway')is not None and not popup_hooked:
     site=manifest['hook']+2;hi=emu.memory.read_short(site);lo=emu.memory.read_short(site+2)
     assert emu.memory.read_short(manifest['hook'])==0xb500 and hi&0xf800==0xf000 and lo&0xf800==0xf800
     delta=((hi&0x7ff)<<12)|((lo&0x7ff)<<1)
     if delta&0x400000:delta-=0x800000
     code=site+4+delta-manifest['symbols']['AbilityDispatch'];assert 0x02000000<code<0x02400000
     gateway=emu.memory.read_long(code+manifest['symbols']['AbilityRuleApi']+20*4)&~1
     assert gateway==code+manifest['popupGateway']
     hooks.append(emu.memory.register_exec(gateway,popup_run));popup_hooked=True
   def popup_run(cpu,address):
    regs=emu.memory.register_arm9
    if regs.r0==flow and regs.r1 in[2,3]and not emu.memory.read_long(flow+0x774):
     popups.append({'frame':emu.frame_count,'turnIndex':len(menus),'command':regs.r1,'owner':regs.r2})
   def command(cpu,address):
    nonlocal code,side_table
    try:
     if not flow or emu.memory.read_long(emu.memory.register_arm9.r1):return
     turn=emu.memory.read_long(flow+16)
     if menus and menus[-1]['turn']==turn:return
     main=emu.memory.read_long(flow+4);player=emu.memory.read_long(main+0xcc);enemy=emu.memory.read_long(main+0xcc+0x1c)
     state={'turn':turn,'frame':emu.frame_count,'hp':emu.memory.read_short(player+0x10),'maxHp':emu.memory.read_short(player+0xe),'item':emu.memory.read_short(player+0x12),'enemyHp':emu.memory.read_short(enemy+0x10),'enemyMaxHp':emu.memory.read_short(enemy+0xe),'ability':emu.memory.read_short(player+0x13c),'enemyAbility':emu.memory.read_short(enemy+0x13c),'stages':list(emu.memory.unsigned[player+0xfc:player+0x103]),'enemyStages':list(emu.memory.unsigned[enemy+0xfc:enemy+0x103]),'conditions':[emu.memory.read_long(player+0x1c+n*4)for n in range(36)],'enemyConditions':[emu.memory.read_long(enemy+0x1c+n*4)for n in range(36)]}
     state['types']=[emu.memory.read_byte(player+0xf8),emu.memory.read_byte(player+0xf9)]
     if'highestTargets'in spec['checks']or'knockoutSplash'in spec['checks']or'noSplash'in spec['checks']:
      state['rawStats']=[emu.memory.read_short(player+0xee+n*2)for n in range(5)];state['enemyParty']=[]
      for slot in range(spec.get('enemyCount',1)):
       mon=emu.memory.read_long(main+0xe8+slot*4);assert 0x02000000<=mon<0x02400000
       state['enemyParty'].append({'id':emu.memory.read_byte(mon+0x19),'hp':emu.memory.read_short(mon+0x10),'maxHp':emu.memory.read_short(mon+0xe),'rawStats':[emu.memory.read_short(mon+0xee+n*2)for n in range(5)],'stages':list(emu.memory.unsigned[mon+0xfc:mon+0x103])})
     state['focus']=bool(emu.memory.read_byte(player+0x156)&2)
     if'partyHpByTurn'in spec['checks']:state['partyHp']=[emu.memory.read_short(emu.memory.read_long(main+0xcc+slot*4)+0x10)for slot in range(len(spec['checks']['partyHpByTurn'][0]))]
     state['weather']=emu.memory.read_byte(manifest['weatherAddress'])if manifest.get('weatherAddress')else None
     ally_mon=emu.memory.read_long(main+0xd0)
     if spec.get('ally'):
      assert 0x02000000<=ally_mon<0x02400000
      state['allyItem']=emu.memory.read_short(ally_mon+0x12);state['allyStages']=list(emu.memory.unsigned[ally_mon+0xfc:ally_mon+0x103]);state['allyFocus']=bool(emu.memory.read_byte(ally_mon+0x156)&2);state['allyHp']=emu.memory.read_short(ally_mon+0x10);state['allyMaxHp']=emu.memory.read_short(ally_mon+0xe);state['allyConditions']=[emu.memory.read_long(ally_mon+0x1c+n*4)for n in range(36)]
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
      if spec['checks'].get('traceEvents'):hooks.append(emu.memory.register_exec(code+manifest['symbols']['AbilityRecipeHandlers'],trace_event))
      for event in['41','38','3b','3c','47','13','7f']:
       if f'AbilityEvent_{event}'in manifest['symbols']:hooks.append(emu.memory.register_exec(code+manifest['symbols'][f'AbilityEvent_{event}'],recipe_callback))
      if manifest.get('clientTrapStores'):
       hooks.append(emu.memory.register_exec(code+manifest['symbols']['AbilityClientTrapped'],client_trapped))
       for offset in manifest['clientTrapStores'].values():hooks.append(emu.memory.register_exec(code+offset,client_trap_store))
      if'AbilityEvent_88'in manifest['symbols']:hooks.append(emu.memory.register_exec(code+manifest['symbols']['AbilityEvent_88'],move_end))
      if manifest.get('priorityRuntime'):hooks.append(emu.memory.register_exec(code+manifest['symbols']['AbilityEvent_4b'],contact_callback))
     menus.append(state)
    except Exception as error:errors.append(error)
   def trace_event(cpu,address):
    if not flow or not menus or emu.memory.read_long(flow+0x774):return
    table=emu.memory.read_long(manifest['api']['BattleEventVar_GetValue']+0x2c);start=emu.memory.read_long(table);values={}
    for n in range(start,96):
     key=emu.memory.read_short(table+4+n*2)
     if not key:break
     if key in[2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,0x12,0x16,0x18,0x32,0x46]:values[hex(key)]=emu.memory.read_long(table+0xc4+n*4)
    main=emu.memory.read_long(flow+4);mon=emu.memory.read_long(main+0xcc)
    event_trace.append({'event':hex(emu.memory.register_arm9.r1),'values':values,'types':[emu.memory.read_byte(mon+0xf8),emu.memory.read_byte(mon+0xf9)]})
   def scope():return code and menus and code<=(emu.memory.register_arm9.lr&~1)<code+manifest['codeBytes'] and flow and not emu.memory.read_long(flow+0x774)
   def multiplied(cpu,address):
    if scope():
     main=emu.memory.read_long(flow+4);mon=emu.memory.read_long(main+0xcc+(callback_owner if callback_owner is not None and callback_owner<12 else 7+(callback_owner-12 if callback_owner is not None else 0))*4)
     multipliers.append({'turnIndex':len(menus)-1,'key':emu.memory.register_arm9.r0,'value':emu.memory.register_arm9.r1,'owner':callback_owner,'suppressed':bool(emu.memory.read_long(mon+0x1c+16*4))if 0x02000000<=mon<0x02400000 else None})
   def rewritten(cpu,address):
    if scope():rewrites.append({'turnIndex':len(menus)-1,'key':emu.memory.register_arm9.r0,'value':emu.memory.register_arm9.r1,'owner':callback_owner})
   def pushed(cpu,address):
    if scope()and emu.memory.register_arm9.r1==26 and manifest.get('sideTableAddress'):screen_removals.append({'turnIndex':len(menus)-1,'screens':[[emu.memory.read_long(manifest['sideTableAddress']+(side*14+effect)*16+12)for effect in[0,1]]for side in range(2)]})
    if scope()and emu.memory.register_arm9.r1==5:healing.append({'turnIndex':len(menus)-1,'owner':emu.memory.register_arm9.r2})
   def popped(cpu,address):
    if flow and menus and not emu.memory.read_long(flow+0x774):
     work=emu.memory.register_arm9.r1
     if 0x02000000<=work<0x02400000 and emu.memory.read_byte(work)in[23,24]:focus_work.append({'turnIndex':len(menus)-1,'command':emu.memory.read_byte(work),'target':emu.memory.read_byte(work+8),'flag':emu.memory.read_long(work+4),'owned':bool(scope())})
     if 0x02000000<=work<0x02400000 and emu.memory.read_byte(work)==7 and scope():indirect_damage.append({'turnIndex':len(menus)-1,'amount':emu.memory.read_short(work+4),'target':emu.memory.read_byte(work+6)})
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
    if flow and menus and address==code+manifest['symbols'].get('AbilityEvent_41',0)and callback_owner==0 and not emu.memory.read_long(flow+0x774):
     table=emu.memory.read_long(manifest['api']['BattleEventVar_GetValue']+0x2c);start=emu.memory.read_long(table);values={}
     for n in range(start,96):
      key=emu.memory.read_short(table+4+n*2)
      if not key:break
      values[key]=emu.memory.read_long(table+0xc4+n*4)
     if values.get(2)==0:native_stab.append({'turnIndex':len(menus)-1,'stab':bool(values.get(0x44)),'multiplier':values.get(0x35)})
    if flow and menus and address==code+manifest['symbols'].get('AbilityEvent_47',0)and not emu.memory.read_long(flow+0x774):
     main=emu.memory.read_long(flow+4);mon=emu.memory.read_long(main+0xcc);combat_types.append({'turnIndex':len(menus)-1,'owner':callback_owner,'types':[emu.memory.read_byte(mon+0xf8),emu.memory.read_byte(mon+0xf9)]})
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
   def counter_import(cpu,address):
    try:
     hi=emu.memory.read_short(address+2);lo=emu.memory.read_short(address+4)
     assert emu.memory.read_short(address)==0xb500 and hi&0xf800==0xf000 and lo&0xf800==0xf800,'Counter entry hook missing'
     delta=((hi&0x7ff)<<12)|((lo&0x7ff)<<1)
     if delta&0x400000:delta-=0x800000
     destination=address+6+delta;prefix=bytes.fromhex(manifest['counterPrefix'])
     assert bytes(emu.memory.unsigned[destination:destination+len(prefix)])==prefix,'Counter entry differs'
     counter_callers.append(emu.memory.register_arm9.lr&~1)
    except Exception as error:errors.append(error)
   def client_trapped(cpu,address):
    nonlocal pending_client_trap
    regs=emu.memory.register_arm9;lr=regs.lr&~1;trapper=regs.r2;ability=regs.r3;returned_hook=None
    observation={'frame':emu.frame_count,'trapperPtr':trapper,'abilityPtr':ability,'trapper':None,'ability':None};pending_client_trap=observation
    def returned(cpu,address):
     nonlocal pending_client_trap
     observation['result']=emu.memory.register_arm9.r0;client_traps.append(observation);pending_client_trap=None
     returned_hook.remove()
    returned_hook=emu.memory.register_exec(lr,returned);hooks.append(returned_hook)
   def client_trap_store(cpu,address):
    # The bus memory API bypasses ARM9 DTCM. Observe executed store operands
    # instead of reading mirrored main RAM at the stack's output addresses.
    if pending_client_trap is None:return
    regs=emu.memory.register_arm9
    if address==code+manifest['clientTrapStores']['trapper']:
     assert emu.memory.read_short(address)==0x7013 and regs.r2==pending_client_trap['trapperPtr']
     pending_client_trap['trapper']=regs.r3&255
    else:
     assert emu.memory.read_short(address)==0x801e and regs.r3==pending_client_trap['abilityPtr']
     pending_client_trap['ability']=regs.r6&65535
   def type_query(cpu,address):
    query={'type':emu.memory.register_arm9.r1,'caller':emu.memory.register_arm9.lr&~1};type_queries.append(query)
    returned_hook=None
    def returned(cpu,address):
     query['result']=emu.memory.register_arm9.r0
     returned_hook.remove()
    if 0x02000000<=query['caller']<0x02400000:
     returned_hook=emu.memory.register_exec(query['caller'],returned);hooks.append(returned_hook)
   if manifest.get('counterHook'):hooks.append(emu.memory.register_exec(manifest['counterHook'],counter_import))
   if manifest.get('typeQuery'):hooks.append(emu.memory.register_exec(manifest['typeQuery'],type_query))
   if manifest.get('damageReactionHook'):hooks.append(emu.memory.register_exec(manifest['damageReactionHook'],damaged))
   if manifest.get('eventConstHook'):hooks.append(emu.memory.register_exec(manifest['eventConstHook'],event_const))
   if manifest.get('nativeChanceHook'):hooks.append(emu.memory.register_exec(manifest['nativeChanceHook'],rolled))
   if manifest.get('nameLoader'):hooks.append(emu.memory.register_exec(manifest['nameLoader'],named))
   hooks.append(emu.memory.register_exec(manifest['api']['BattleHandler_PopWork'],popped))
   hooks += [emu.memory.register_exec(manifest.get('openingHook',0x0219f5da),opening),emu.memory.register_exec(manifest.get('commandHook',0x021cef18),command),emu.memory.register_exec(manifest['api']['BattleEventVar_MulValue'],multiplied),emu.memory.register_exec(manifest['api']['BattleEventVar_RewriteValue'],rewritten),emu.memory.register_exec(manifest['api']['BattleHandler_PushWork'],pushed)]
   try:
    emu.open(rom)
    for _ in range(a.max_frames):
     if menus or manifest.get('manualLaunch'):
      # The normal BW2 test save faces away from its NPC, which stands south.
      key=128 if manifest.get('manualLaunch')and 600<=emu.frame_count<602 else 1 if emu.frame_count%12<3 else 0
      emu.input.keypad_update(key)
     if menus and spec.get('turnMove'):
      age=emu.frame_count-menus[-1]['frame'];choice=spec['turnMove'][min(len(menus)-1,len(spec['turnMove'])-1)]
      emu.input.touch_release();emu.input.keypad_update(1 if age>180 and emu.frame_count%12<3 else 0)
      if 60<=age<64:emu.input.touch_set_pos(128,85)
      if 140<=age<144:emu.input.touch_set_pos(64 if choice%2==0 else 192,44 if choice<2 else 115)
     if menus and 'trapType'in spec['checks']:
      age=emu.frame_count-menus[0]['frame'];emu.input.touch_release()
      emu.input.keypad_update(0)
      if 120<=age<124:emu.input.touch_set_pos(210,165)
      if 260<=age<264:emu.input.touch_set_pos(180,40)
      if 340<=age<344:emu.input.touch_set_pos(165,74)
     emu.cycle()
     if manifest.get('manualLaunch')and emu.frame_count%1200==0 and not menus:
      emu.screenshot().save(a.evidence/f"{spec['label']}-launch-{emu.frame_count}.png")
      print(f"LAUNCH {spec['label']}: frame {emu.frame_count}, battle flow {hex(flow)}",flush=True)
     if name_frame and not name_captured and emu.frame_count>=name_frame:
      emu.screenshot().save(a.evidence/f"{spec['label']}-ability-name.png");name_captured=True
     if spec['checks'].get('name') and name_frame:
      for delay in [15,30,45,60]:
       if delay not in name_followups and emu.frame_count>=name_frame+delay:
        emu.screenshot().save(a.evidence/f"{spec['label']}-ability-name-{delay+14}.png");name_followups.add(delay)
     if errors:raise errors[0]
     # The battle loader's symbol addresses can be occupied by field overlays
     # before overlay 167 loads. Sample only after its live registry is checked.
     if menus and emu.frame_count%30==0:sample()
     trapped='trapType'not in spec['checks']or bool(menus and emu.frame_count-menus[0]['frame']>=500 and any(q['result']==0 and q['ability']==spec.get('enemyAbility') and q['frame']>=menus[0]['frame']+120 for q in client_traps))
     if len(menus)>=spec.get("menuCount",3)and trapped:break
    emu.input.keypad_update(0);assert len(menus)>=spec.get('menuCount',3),f'No completed turns: {menus}'
    c=spec['checks'];hp=[s['hp']for s in menus]
    if'popupsByTurn'in c:
     assert popup_hooked,'Native popup gateway was not observed'
     for command in[2,3]:assert[sum(v['command']==command and v['turnIndex']==i for v in popups)for i in range(len(menus))]==c['popupsByTurn'],popups
     opened={}
     for popup in popups:
      owner=popup['owner']
      if popup['command']==2:assert not opened.get(owner),popups;opened[owner]=True
      else:assert opened.get(owner),popups;opened[owner]=False
     assert not any(opened.values()),popups
    owned_counter_calls=sum(code<=caller<code+manifest['codeBytes']for caller in counter_callers)
    if c.get('counterImport'):assert owned_counter_calls,'No ability-to-counter import call observed'
    if c.get('counterPresent'):assert counter_callers,'No installed counter entry call observed'
    if'stabByTurn'in c:
     assert[len([v for v in native_stab if v['turnIndex']==i])for i in range(len(c['stabByTurn']))]==[1]*len(c['stabByTurn']),native_stab
     assert[v['stab']for v in native_stab]==c['stabByTurn'],native_stab
    if'combatTypesByTurn'in c:
     for i,types in enumerate(c['combatTypesByTurn']):assert any(v['turnIndex']==i and v['types']==types for v in combat_types),(combat_types,c)
    if'allyItemsByTurn'in c:assert[s['allyItem']for s in menus]==c['allyItemsByTurn'],menus
    if'playerTypesByTurn'in c:assert[s['types']for s in menus]==c['playerTypesByTurn'],menus
    if'playerTypesAfterFirstTurn'in c:assert all(state['types']==c['playerTypesAfterFirstTurn']for state in menus[1:]),menus
    if'trapType'in c:
     assert any(query.get('result')==1 and query['type']==c['trapType']and code<=query['caller']<code+manifest['codeBytes']for query in type_queries),type_queries
     assert any(q['result']==0 and q['ability']==spec.get('enemyAbility') and q['frame']>=menus[0]['frame']+120 for q in client_traps),client_traps
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
    if'highestTargets'in c:
     assert any(hit['target']==0 and hit['damage']>0 for hit in damage_reactions),damage_reactions
     for i,state in enumerate(menus):
      hits=sum(hit['target']==0 and hit['damage']>0 and not hit.get('substitute')and hit['turnIndex']<i for hit in damage_reactions)
      for target,initial in enumerate(menus[0]['enemyParty']):
       raw=initial['rawStats']if c['highestTargets']else menus[0]['rawStats'];highest=raw.index(max(raw));expected=[max(0,6-hits)if stat==highest else 6 for stat in range(7)]
       assert state['enemyParty'][target]['stages']==expected,(menus,damage_reactions)
    if'knockoutSplash'in c:
     config=c['knockoutSplash'];i=config.get('turn',0);before=menus[i]['enemyParty'];after={mon['id']:mon for mon in menus[i+1]['enemyParty']};defeated=next(mon for mon in before if mon['id']==12+config.get('defeated',1));recipient=next(mon for mon in before if mon['id']==12+config.get('recipient',0));assert defeated['hp']>0 and after[defeated['id']]['hp']==0,menus
     amount=max(1,(recipient if config['hpBasis']else defeated)['maxHp']*config['percent']//100)
     assert recipient['hp']-after[recipient['id']]['hp']==min(recipient['hp'],amount),(menus,indirect_damage)
     assert indirect_damage==[{'turnIndex':i,'amount':amount,'target':recipient['id']}],indirect_damage
    if c.get('noSplash'):assert not indirect_damage,indirect_damage
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
    if c.get('enemyWeatherDamage'):assert menus[2]['enemyHp']<menus[1]['enemyHp']<menus[0]['enemyHp'],menus
    if c.get('onlyMoveDamage'):
     hits=[hit for hit in damage_reactions if hit['target']==0]
     assert len(hits)==len(menus)-1 and all(hit['damage']>0 for hit in hits),damage_reactions
     for i in range(len(menus)-1):assert menus[i]['hp']-menus[i+1]['hp']==sum(hit['damage']for hit in hits if hit['turnIndex']==i),(menus,damage_reactions)
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
    result.update(passed=True,menus=menus,multipliers=multipliers,rewrites=rewrites,healing=healing,names=names,nativeChances=native_chances,callbackPriorities=callback_priorities,damageReactions=damage_reactions,focusWork=focus_work,moveEndItems=move_end_items,screenRemovals=screen_removals,minimumObservedFree=minimum,counterCalls=len(counter_callers),abilityCounterCalls=owned_counter_calls,typeQueries=type_queries,clientTraps=client_traps,popups=popups,combatTypes=combat_types,eventTrace=event_trace,nativeStab=native_stab,indirectDamage=indirect_damage)
    emu.run_frames(20);emu.screenshot().save(a.evidence/f"{spec['label']}.png");(a.evidence/f"{spec['label']}-result.json").write_text(json.dumps(result,indent=2)+'\n');results.append(result);print(f"PASS {spec['label']}: HP {hp}; abilities {[s['ability']for s in menus]}",flush=True)
   except Exception as error:
    result.update(error=repr(error),menus=menus,multipliers=multipliers,rewrites=rewrites,minimumObservedFree=minimum,pc=hex(emu.memory.register_arm9.pc),damageReactions=damage_reactions,focusWork=focus_work,moveEndItems=move_end_items,typeQueries=type_queries,clientTraps=client_traps,popups=popups,combatTypes=combat_types,eventTrace=event_trace,nativeStab=native_stab,indirectDamage=indirect_damage);emu.screenshot().save(a.evidence/f"{spec['label']}-failure.png");(a.evidence/f"{spec['label']}-failure.json").write_text(json.dumps(result,indent=2)+'\n');results.append(result);print(f"FAIL {spec['label']}: {error!r}",flush=True)
    if not a.keep_going:raise
   finally:emu.destroy()
 (a.evidence/f'emulator-{a.start}-{len(results)}.json').write_text(json.dumps({'passed':sum(r['passed']for r in results),'cases':results,'scope':'DS-mode melonDS cold boots; native engine; keypad input; read-only hooks'},indent=2)+'\n')
if __name__=='__main__':main()
