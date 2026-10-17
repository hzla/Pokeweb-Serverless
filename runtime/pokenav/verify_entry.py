"""Native entry/shoulder regression using copied full Route 19 fixtures.

Requires the same 56-species fixture and NAV button as benchmark.py. All input
ROM/save files are copied before boot; --out must be a new directory.
"""
from pathlib import Path
import sys,struct,json,argparse,tempfile,shutil
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('rom',type=Path);parser.add_argument('--save',type=Path,required=True)
parser.add_argument('--library',required=True);parser.add_argument('--bindings',required=True)
parser.add_argument('--out',type=Path,required=True);args=parser.parse_args()
folder=args.out;folder.mkdir(parents=True,exist_ok=False)
with args.rom.open('rb') as source:source.seek(12);code=source.read(4)
assert code in (b'IRDO',b'IREO'),'US B2/W2 required'
game='White2' if code==b'IRDO' else 'Black2'
sys.path.insert(0,args.bindings)
from melonds.core import MelonDS
private=tempfile.TemporaryDirectory(prefix='pokenav-entry-');fixture=Path(private.name)
shutil.copyfile(args.rom,fixture/(game+'.nds'));shutil.copyfile(args.save,fixture/(game+'.sav'))
e=MelonDS(args.library);e.open(fixture/(game+'.nds'))
def ram():
 b=e.savestate.save_buffer();at=16
 while at<len(b):
  n=struct.unpack_from("<I",b,at+4)[0]
  if b[at:at+4]==b"NDSG":return b[at+20:at+20+0x400000]
  at+=n
 raise RuntimeError("No main RAM")
def word(m,p):return struct.unpack_from("<I",m,p)[0]
def half(m,p):return struct.unpack_from("<H",m,p)[0]
def field(m):
 at=-1
 while (at:=m.find(b"CQAS",at+1))>=0:
  sub=word(m,at+4)-0x2000000
  if 0<=sub<len(m)-36 and m[at+733]<=8 and 0x2000000<=word(m,sub+32)<0x2400000:
   f=word(m,sub+20)-0x2000000;g=word(m,f+8)-0x2000000
   return at,word(m,g+0x194)-0x2000000
 raise RuntimeError("No C-Gear session")
def nav(m):
 at=-1;request=None
 while (at:=m.find(bytes.fromhex("4c53563103000401"),at+1))>=0:
  p=at-28
  if p>=0 and word(m,p+16)==0x2000000+p+168:request=p;break
 assert request is not None,"No Pokenav request"
 p=struct.pack("<I",request+0x2000000);at=-1;work=None
 while (at:=m.find(p,at+1))>=0:
  if at+0x228>=len(m):continue
  w=word(m,at+0x38)-0x2000000;font=word(m,at+0x60)-0x2000000
  if 0<=w<len(m)-16 and 0<=font<len(m)-16:work=at;break
 assert work is not None,"No window owner"
 species,form=struct.unpack_from("<HH",m,request+244);ptr=struct.pack("<I",work+0x2000000);at=-1
 while (at:=m.find(ptr,at+1))>=0:
  if at+360>=len(m) or half(m,at+4)!=species or half(m,at+6)!=form or m[at+10]!=1:continue
  text=[]
  for i in range(12):
   v=half(m,at+332+i*2)
   if v in (0,65535):break
   text.append(chr(v))
  if "".join(text)==str(m[at+8])+"%":return species,form,m[at+8]
 raise RuntimeError("No species/chance context")
def step(n=50):
 e.run_frames(n);assert e.memory.register_arm9.cpsr&31!=0x17,"Data abort"
def tap(x,y,n=70):e.input.touch_set_pos(x,y);step(4);e.input.touch_release();step(n)
def key(k,n=60):e.input.keypad_update(k);step(4);e.input.keypad_update(0);step(n)
trace=[]
def expect(name,species,chance,shot=True):
 m=ram();actual=nav(m);assert actual==(species,0,chance),(name,actual,species,chance)
 assert m[party:party+1328]==before,"Party changed"
 assert e.memory.read_short(0x400000c)==e.memory.read_short(0x400100c)==0x1f82
 if shot:e.screenshot().save(folder/(game+"-"+name+".png"))
 trace.append({"name":name,"context":actual,"frame":e.frame_count});print(game,name,actual,flush=True)
step(960);m=ram();_,party=field(m);before=m[party:party+1328]
e.screenshot().save(folder/(game+"-field.png"))
def open_nav(entry):
 e.input.touch_set_pos(60,116)
 seen_black=False;opening=[];first_visible=None
 for frame in range(160):
  step(1)
  if frame==4:e.input.touch_release()
  shot=e.screenshot();blank=all(high==0 for low,high in shot.convert('RGB').getextrema())
  if blank:seen_black=True
  if seen_black and not blank and first_visible is None:
   first_visible=frame
   assert e.memory.read_short(0x400000c)==e.memory.read_short(0x400100c)==0x1f82, 'Native/unfinished screen became visible during loading'
   raw=bytes(e.memory.read_byte(0x6200000+((y>>3)*32+(x>>3))*64+(y&7)*8+(x&7)) for x,y in [(13,97),(12,103)])
   assert raw==bytes([16,31]),('Incomplete first bottom frame',frame,raw)
   shot.save(folder/(game+'-first-visible-'+str(entry)+'.png'))
  opening.append({'frame':frame,'blank':blank,'bg':[e.memory.read_short(p) for p in [0x400000c,0x400100c]]})
 assert first_visible is not None and seen_black
 (folder/(game+'-opening-'+str(entry)+'.json')).write_text(json.dumps(opening,indent=2))
open_nav(0)
expect('full',1,20)
# L/R switches only the currently selected encounter section from icon focus.
tap(228,157);expect('shoulders-grass-selection',12,1)
key(0x100);expect('shoulder-doubles',13,20)
key(0x100);expect('shoulder-special',25,20)
key(0x100);expect('shoulder-endpoint',25,20,False)
key(0x200);key(0x200);expect('shoulder-remembered-grass',12,1)
key(0x200);expect('shoulder-left-endpoint',12,1,False)
tap(24,28);tap(40,56);expect('shoulder-water-start',37,60)
for species in (42,47,52):key(0x100);expect('shoulder-water-'+str(species),species,60 if species<47 else 40)
key(0x100);expect('shoulder-water-endpoint',52,40,False)
for species in (47,42,37):key(0x200);expect('shoulder-water-back-'+str(species),species,60 if species<47 else 40)
key(0x200);expect('shoulder-water-left-endpoint',37,60,False)
tap(25,90);tap(28,120)
a=e.screenshot();step(24);b=e.screenshot();assert a.crop((0,24,4,134)).tobytes()!=b.crop((0,24,4,134)).tobytes(),"Grid did not move"
tap(228,157);expect("one-percent",12,1)
key(0x40);expect("nearest-column",6,10,False)
key(0x10);expect("row-endpoint",6,10,False)
key(0x40);key(0x10);expect("doubles",13,20)
key(0x10);expect("special",25,20)
key(0x10);expect("method-endpoint",25,20,False)
key(0x20);key(0x20);expect("remembered-grass",6,10,False)
for name,x,s in [("surf",24,37),("surf-special",80,42),("rod",148,47),("rod-special",210,52)]:
 tap(x,28);expect(name,s,60 if s<47 else 40)
tap(216,56);expect("eevee-page-1",133,1)
key(1);expect("eevee-page-2",133,1)
# Rapid input coalesces to the last encounter; leaving during a pending
# preview remains safe and does not perform a stale load after cleanup.
tap(25,90)
for x in (28,68,108,148,188):
 e.input.touch_set_pos(x,120);step(1);e.input.touch_release();step(1)
step(4);tap(228,155,20);expect("rapid-last-selection",12,1)
e.input.touch_set_pos(68,120);step(1);e.input.touch_release()
# B, native red X, native blue back, then B again.
for i,action in enumerate([lambda:key(2,150),lambda:tap(206,184,150),lambda:tap(238,184,150),lambda:key(2,150)]):
 action();m=ram();assert m[party:party+1328]==before;field(m)
 assert e.memory.read_short(0x400000c)!=0x1f82
 e.screenshot().save(folder/(game+"-return-"+str(i)+".png"));print(game,"returned",i,flush=True)
 if i<3:open_nav(i+1);expect("reopen-"+str(i),1,20)
(folder/(game+"-trace.json")).write_text(json.dumps(trace,indent=2))
e.destroy();private.cleanup();print(game,"PASSED cold boot, all seven methods, memory, 1%, A paging, four entries/exits, B/X/back and unchanged party",flush=True)
