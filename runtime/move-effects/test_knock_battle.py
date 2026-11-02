"""Cold-boot exported ROMs; keypad input plus read-only native state observation."""
import json,sys,shutil,tempfile,subprocess
from pathlib import Path
from melonds import MelonDS
root=Path(sys.argv[1]);manifest=json.loads((root/'knock-cases.json').read_text());results=[]
for data in manifest['cases']:
 if len(sys.argv)>2 and data['label'] not in sys.argv[2:]:continue
 emu=MelonDS();hooks=[];menus=[];powers=[];weather=[];flow=0;code=0;capacity={};removals=[];faints=[];knockCalls=[];firstEnemy=0
 def opening(cpu,address):
  global flow
  candidate=emu.memory.register_arm9.r0 if data['game'] in ('IRBO','IRAO') else emu.memory.register_arm9.r6
  if not 0x02000000<=candidate<0x02400000:return
  main=emu.memory.read_long(candidate+4)
  if 0x02000000<=main<0x02400000 and emu.memory.read_long(main+8)==emu.memory.read_long(candidate):flow=candidate
 def command(cpu,address):
  global code,capacity,firstEnemy
  if not flow or emu.memory.read_long(emu.memory.register_arm9.r1):return
  turn=emu.memory.read_long(flow+16)
  if menus and menus[-1]['turn']==turn:return
  main=emu.memory.read_long(flow+4);p=emu.memory.read_long(main+0xcc);e=emu.memory.read_long(main+0xe8)
  if not all(0x02000000<=x<0x02400000 for x in (p,e)):return
  menus.append({'turn':turn,'frame':emu.frame_count,'hp':emu.memory.read_short(p+0x10),'enemyHp':emu.memory.read_short(e+0x10),'enemyItem':emu.memory.read_short(e+0x12),'enemySubstitute':emu.memory.read_short(e+0x1f2)})
  if code:return
  firstEnemy=e
  site=data['hook']+2;hi=emu.memory.read_short(site);lo=emu.memory.read_short(site+2);assert emu.memory.read_short(data['hook'])==0xb500
  distance=((hi&0x7ff)<<12)|((lo&0x7ff)<<1)
  if distance&0x400000:distance-=0x800000
  code=site+4+distance-data['symbols']['MoveDispatch']
  assert emu.memory.read_short(emu.memory.read_long(code+data['symbols']['MoveRuleData']))==100
  if data.get('pmcSymbols'):
   head=next(v for n,v in data['pmcSymbols'].items() if 'g_Modules' in n);node=emu.memory.read_long(head);seen=set();count=0
   while node:
    assert node not in seen;seen.add(node);count+=emu.memory.read_long(node+8)==code-32;node=emu.memory.read_long(node+24)
   assert count==1;capacity['moveDlls']=count
   head=next(v for n,v in data['pmcSymbols'].items() if 'g_MainAllocator' in n);heap=emu.memory.read_long(head)
   if 0x02000000<=heap<0x02400000:
    node=emu.memory.read_long(heap+12);seen=set();free=0
    while node:
     assert node not in seen;seen.add(node);free+=emu.memory.read_long(node);node=emu.memory.read_long(node+4)
    capacity['freeHeap']=free
 def rewrite(cpu,address):
  r=emu.memory.register_arm9
  if not code or not flow or emu.memory.read_long(flow+0x774) or r.r0!=0x30 or not code<=(r.lr&~1)<code+data['codeBytes']:return
  powers.append(r.r1)
 def popped(cpu,address):
  if data['label'] not in ('knockout','native-knockout') or not flow or emu.memory.read_long(flow+0x774):return
  r=emu.memory.register_arm9;work=r.r1
  if r.r0!=flow or not 0x02000000<=work<0x02400000 or emu.memory.read_long(work)&0xffff!=32 or emu.memory.read_byte(work+6)!=12:return
  main=emu.memory.read_long(flow+4);mon=emu.memory.read_long(main+0xe8);row={'hp':emu.memory.read_short(mon+0x10),'oldItem':emu.memory.read_short(mon+0x12)};removals.append(row)
  lr=r.lr&~1;handle=None
  def returned(cpu,address):
   row['item']=emu.memory.read_short(mon+0x12);handle.remove()
  handle=emu.memory.register_exec(lr,returned);hooks.append(handle)
 def stats(cpu,address):
  if data['label'] not in ('knockout','native-knockout') or not firstEnemy or not flow or emu.memory.read_long(flow+0x774):return
  r=emu.memory.register_arm9
  if r.r0==firstEnemy and emu.memory.read_short(firstEnemy+0x10)==0 and not faints:faints.append({'hp':0,'item':emu.memory.read_short(firstEnemy+0x12)})
 def knocked(cpu,address):
  if firstEnemy and flow and not emu.memory.read_long(flow+0x774):knockCalls.append({'hp':emu.memory.read_short(firstEnemy+0x10),'item':emu.memory.read_short(firstEnemy+0x12)})
 def queried(cpu,address):
  if code and code<=(emu.memory.register_arm9.lr&~1)<code+data['codeBytes']:weather.append(emu.frame_count)
 if data['game'] in ('IRBO','IRAO'):
  delta=32 if data['game']=='IRAO' else 0;entry,menu=0x021bbb60+delta,0x021bacac+delta
 else:
  delta=64 if data['game']=='IREO' else 0;entry,menu=0x0219f5da-delta,0x021cef18-delta
 hooks+=[emu.memory.register_exec(entry,opening),emu.memory.register_exec(menu,command),emu.memory.register_exec(data['rewrite'],rewrite),emu.memory.register_exec(data['weather'],queried)]
 if data.get('stat'):hooks.append(emu.memory.register_exec(data['stat'],stats))
 if data.get('knockHandler'):hooks.append(emu.memory.register_exec(data['knockHandler'],knocked))
 if data.get('pop'):hooks.append(emu.memory.register_exec(data['pop'],popped))
 result={'case':data['label'],'game':data['game'],'passed':False}
 try:
  with tempfile.TemporaryDirectory(prefix='pokeweb-knock-')as tmp:
   rom=Path(tmp)/'battle.nds'
   if sys.platform!='darwin' or subprocess.run(['cp','-c',str(root/data['rom']),str(rom)],stderr=subprocess.DEVNULL).returncode:shutil.copyfile(root/data['rom'],rom)
   shutil.copyfile(root/f"{data['label']}.sav",rom.with_suffix('.sav'));emu.open(rom)
   for _ in range(14000):
    emu.input.keypad_update(128 if 600<=emu.frame_count<602 else 1 if emu.frame_count%12<3 else 0);emu.cycle()
    if len(menus)>=2:break
  assert len(menus)>=2,('No completed turn',menus,hex(emu.memory.register_arm9.pc))
  assert menus[0]['enemyItem']==data['item'],menus
  if data['label'] in ('knockout','native-knockout'):assert faints,(menus,removals)
  else:assert menus[1]['enemyItem']==(0 if data['removed'] else data['item']),menus
  if 'power' in data and data['label']!='condition-false':assert (not powers if data['power']==40 else data['power'] in powers),(powers,menus)
  if data['label']=='condition-false':assert not powers,powers
  if data['label'] in ('protect','ghost-immunity'):assert menus[0]['enemyHp']==menus[1]['enemyHp'],menus
  elif data['label']=='substitute':assert menus[1]['enemySubstitute']>0,menus
  elif data['label'] not in ('knockout','native-knockout'):assert menus[1]['enemyHp']<menus[0]['enemyHp'],menus
  if data['label']=='two-hits-one-removal':assert len(knockCalls)==1,knockCalls
  assert not weather,weather
  result.update(passed=True,menus=menus,powers=powers,ownWeatherQueries=len(weather),capacity=capacity,removals=removals,faints=faints,knockCalls=knockCalls)
  print('PASS',data['game'],data['label'],powers,flush=True)
 except Exception as e:
  result.update(error=repr(e),menus=menus,powers=powers,removals=removals,faints=faints,knockCalls=knockCalls);print('FAIL',data['game'],data['label'],repr(e),flush=True);emu.screenshot().save(root/f"{data['label']}-failure.png")
 finally:emu.destroy()
 results.append(result);(root/'knock-results.json').write_text(json.dumps(results,indent=2)+'\n')
ko=next((r for r in results if r['case']=='knockout'),None);native=next((r for r in results if r['case']=='native-knockout'),None)
if ko and native:assert ko['faints']==native['faints'] and ko['knockCalls']==native['knockCalls'],(ko,native)
assert all(r['passed'] for r in results),'Some native Knock Off cases failed'
