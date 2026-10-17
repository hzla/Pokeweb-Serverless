"""Cold-boot checks on copied Route 19 fixtures, with caught flags changed only in emulator RAM.

The source ROM and battery save are copied before boot. The temporary caught-state
fixtures exercise released/absent family members without changing user saves.
"""
from pathlib import Path
import sys,struct,json,argparse,tempfile,shutil
from elftools.elf.elffile import ELFFile
HERE=Path(__file__).resolve().parent
p=argparse.ArgumentParser(description=__doc__);p.add_argument('rom',type=Path);p.add_argument('--save',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--library',required=True);p.add_argument('--bindings',required=True);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=False)
sys.path.insert(0,a.bindings)
from melonds.core import MelonDS
with a.rom.open('rb') as f:f.seek(12);code=f.read(4)
game='W2' if code==b'IRDO' else 'B2';delta=64 if game=='B2' else 0
private=tempfile.TemporaryDirectory(prefix='nuzlocke-emulator-');q=Path(private.name);shutil.copyfile(a.rom,q/'test.nds');shutil.copyfile(a.save,q/'test.sav')
e=MelonDS(a.library);e.open(q/'test.nds');r=e.memory.register_arm9
hooks=[];dex=[None];phase=[None];trace=[]
def ram():
 b=e.savestate.save_buffer();at=16
 while at<len(b):
  n=struct.unpack_from('<I',b,at+4)[0]
  if b[at:at+4]==b'NDSG':return b[at+20:at+20+0x400000]
  at+=n
 raise RuntimeError('No main RAM')
def cpu_bytes(address,length):
 # Bus reads bypass ARM9's DTCM. Native EFP/output buffers live on that stack.
 b=e.savestate.save_buffer();at=16
 while at<len(b):
  n=struct.unpack_from('<I',b,at+4)[0]
  if b[at:at+4]==b'CP15':
   setting=struct.unpack_from('<I',b,at+20)[0];base=setting&0xffffc000
   if base<=address<base+0x4000:
    start=at+16+12+0x8000+(address&0x3fff);return b[start:start+length]
  at+=n
 return bytes(e.memory.read_byte(address+i) for i in range(length))
def u32(m,p):return struct.unpack_from('<I',m,p)[0]
def field(m):
 at=-1
 while (at:=m.find(b'CQAS',at+1))>=0:
  sub=u32(m,at+4)-0x2000000
  if 0<=sub<len(m)-36 and m[at+733]<=8 and 0x2000000<=u32(m,sub+32)<0x2400000:
   f=u32(m,sub+20)-0x2000000;g=u32(m,f+8)-0x2000000
   return u32(m,g+0x194)-0x2000000
 raise RuntimeError('No C-Gear session')
def caught_hook(*_):
 dex[0]=r.r0
 if phase[0] is not None:
  data=bytearray(84)
  for i in phase[0]:data[(i-1)//8]|=1<<((i-1)&7)
  for i,b in enumerate(data):e.memory.write_byte(dex[0]+8+i,b)
  phase[0]=None
hooks.append(e.memory.register_exec(0x200d660,caught_hook))
def step(n):
 e.run_frames(n);assert r.cpsr&31!=0x17,('Data abort',hex(r.pc))
def tap(x,y,n=100):e.input.touch_set_pos(x,y);step(4);e.input.touch_release();step(n)
def key(k,n=100):e.input.keypad_update(k);step(4);e.input.keypad_update(0);step(n)
def nav(m):
 # The shared information context contains its selected species/form/chance.
 at=-1
 while (at:=m.find(bytes.fromhex('4c53563103000401'),at+1))>=0:
  request=at-28
  if request<0 or u32(m,request+16)!=0x2000000+request+168:continue
  species,form=struct.unpack_from('<HH',m,request+244);marker=struct.pack('<HHBB',species,form,0,0)
  for chance in range(101):
   needle=struct.pack('<HHB',species,form,chance);start=-1
   while (start:=m.find(needle,start+1))>=0:
    if start<4 or start+352>=len(m) or m[start+6]!=1:continue
    text=[]
    for i in range(5):
     v=struct.unpack_from('<H',m,start-4+332+i*2)[0]
     if v in (0,65535):break
     text.append(chr(v))
    if ''.join(text)==str(chance)+'%':return species,form,chance
 raise RuntimeError('No information context')
def expect(label,species,chance):
 m=ram();e.screenshot().save(a.out/(label+'.png'));(a.out/'last-ram.bin').write_bytes(m);actual=nav(m);assert actual==(species,0,chance),(label,actual)
 assert m[party:party+1328]==before,'Party changed';e.screenshot().save(a.out/(label+'.png'));trace.append({'label':label,'context':actual,'frame':e.frame_count});print(game,label,actual,flush=True)
step(960);m=ram();party=field(m);before=m[party:party+1328];e.screenshot().save(a.out/'field.png')
with (HERE/'build'/f'NuzlockeStyleEncounters{game}.elf').open('rb') as f:
 elf=ELFFile(f);symbols={s.name:s for s in elf.get_section_by_name('.symtab').iter_symbols()};s=symbols['NuzlockeGenerate'];pattern=elf.get_section(s['st_shndx']).data()[s['st_value']&~1:(s['st_value']&~1)+24]
positions=[i for i in range(len(m)) if m.startswith(pattern,i)];assert len(positions)==1,positions;generate=0x2000000+positions[0];events=[];pending=[]
def enter(*_):
 parameters=cpu_bytes(r.r0,44)
 pending.append({'out':r.r2,'return':r.lr&~1,'frame':e.frame_count,'slots':parameters[20],'kind':struct.unpack_from('<I',parameters,16)[0]})
def returned(*_):
 if pending:
  event=pending.pop();event['result']=r.r0;event['species']=struct.unpack('<H',cpu_bytes(event['out'],2))[0]&2047 if r.r0 else None;events.append(event)
generate_hook=[e.memory.register_exec(generate,enter)]
hooks.append(e.memory.register_exec(0x21a0ca4-delta,returned))
def refresh_hook():
 m=ram();at=m.find(pattern);assert at>=0,'No reloaded encounter module'
 generate_hook[0].remove();generate_hook[0]=e.memory.register_exec(0x2000000+at,enter)
 print(game,'encounter module',hex(0x2000000+at),flush=True)

phase[0]=[1];tap(60,116);expect('bulbasaur-dupe',1,0)
assert dex[0];saved_caught=bytes(e.memory.read_byte(dex[0]+8+i) for i in range(84))
raw=bytes(e.memory.read_byte(0x6200000+((y>>3)*32+(x>>3))*64+(y&7)*8+(x&7)) for y in range(104,136) for x in range(12,44))
assert any(80<=b<128 for b in raw) and not any(160<=b<208 for b in raw),'Dupe icon was not gray'
tap(148,120);expect('charmander-reweighted',4,20)
key(0x100);expect('shoulder-doubles',13,20);key(0x200);expect('remembered-grass',4,20)
key(2,150);field(ram());assert bytes(e.memory.read_byte(dex[0]+8+i) for i in range(84))==saved_caught
refresh_hook()
# Trigger one eligible encounter by ordinary movement, then restore the temporary
# field state before testing an entirely caught table.
checkpoint=e.savestate.save_buffer();(a.out/'field-checkpoint.mln').write_bytes(checkpoint)
for k in [0x10]+[0x40,0x80]*24:
 e.input.keypad_update(k);step(80);e.input.keypad_update(0);step(2)
 if events:break
e.screenshot().save(a.out/'walk-eligible.png');(a.out/'walk-ram.bin').write_bytes(ram())
assert events and events[-1]['result']==1 and events[-1]['species'] in range(4,13) and events[-1]['slots']==12 and events[-1]['kind']==0,events
step(140)
for _ in range(30):
 shot=e.screenshot()
 if len(shot.convert('RGB').getcolors(maxcolors=65536) or [])>30:break
 step(30)
shot=e.screenshot();shot.save(a.out/'eligible-battle.png');assert len(shot.convert('RGB').getcolors(maxcolors=65536) or [])>30,'Battle transition stayed blank'
trace.append({'label':'eligible-field-encounter','events':list(events)})
print(game,'eligible battle',events,flush=True)
e.savestate.load_buffer(checkpoint);pending.clear();events.clear();refresh_hook()
# Same map, new caught-family snapshot; no battery-save reload required.

phase[0]=list(range(1,650));tap(60,116);expect('all-dupe-zero',1,0);key(2,150);field(ram());refresh_hook()
# Walk Route 19 while all families are caught. Every native encounter attempt
# must be refused before entering battle. Record actual field-triggered calls.
for k in [0x10]+[0x40,0x80]*24:
 e.input.keypad_update(k);step(80);e.input.keypad_update(0);step(2)
 if len(events)>=12:break
e.screenshot().save(a.out/'walk-all-dupe.png');(a.out/'walk-all-ram.bin').write_bytes(ram())
assert len(events)>=3,('No live encounter attempts',len(events));assert all(v['result']==0 for v in events),events
assert ram()[party:party+1328]==before
trace.append({'label':'all-dupe-field-attempts','events':events});e.screenshot().save(a.out/'no-battle-after-walking.png')
generate_hook[0].remove()
for h in hooks:h.remove()
e.destroy();private.cleanup();(a.out/'trace.json').write_text(json.dumps({'game':game,'ramCaughtFixtures':True,'trace':trace},indent=2));print(game,'PASSED live cold boot, gray icons, adjusted chances, shoulders, repeat entry/exit and prevented encounter attempts',len(events),flush=True)
