"""Execute the compiled toolbar with isolated native stubs; not a DS graphics test."""
import struct,subprocess
import ndspy.narc
from elftools.elf.elffile import ELFFile
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_THUMB,UC_HOOK_CODE
from unicorn.arm_const import *
from build import BUILD,TOOLS,APIS,NATIVE,untile
W=0x02200000;REQ=W+0x400;PARTY=W+0x600;MON=W+0x800;PROMPT=W+0x1100;WINDOW=W+0x1200;MAP=W+0x1800;STOP=0x023f8000;STACK=0x023f0000
class Harness:
 def __init__(self,game):
  self.u=Uc(UC_ARCH_ARM,UC_MODE_THUMB);self.u.ctl_set_cpu_model(UC_CPU_ARM_946);self.u.mem_map(0x02000000,0x400000);self.game=game;self.delta=64 if game=='B2' else 0;self.armdelta=44 if game=='B2' else 0
  elf=BUILD/f'{game}-test.elf';subprocess.run([str(TOOLS/'arm-none-eabi-g++'),'-nostdlib','-Wl,-Ttext=0x02300020,-Tbss=0x02320000,-ePaInit',str(BUILD/f'PartyQuickActions{game}.o'),'-o',str(elf)],check=True)
  with elf.open('rb') as f:
   e=ELFFile(f)
   for p in e.iter_segments():
    if p['p_type']=='PT_LOAD':self.u.mem_write(p['p_vaddr'],p.data()+bytes(p['p_memsz']-p['p_filesz']))
   self.symbols={s.name:s['st_value'] for s in e.get_section_by_name('.symtab').iter_symbols()}
  self.session=self.symbols['session'];self.functions={};self.touch=None;self.keys=self.pressed=0;self.native=0;self.subtractions=0;self.effects=0;self.redraws=0;self.partyCount=6;self.values={5:501,111:0,8:8000,76:0,158:20,160:10,161:20,157:0};self.alloc=0x02240000;self.owned=set();self.fail=False;self.enabled=True;self.failAt=0;self.allocCount=0;self.heapFree=65536;self.heapLargest=32768;self.vramFail=False;self.charHandles=set();self.palHandles=set();self.animHandles=set();self.uploads=0
  self.put(W,23,2);self.put(W+0x28c,REQ);self.put(REQ,PARTY);self.put(W+0x30,0);self.put(W+12,2,1);self.put(W+14,1,1)
  self.put(W+0x154,PROMPT);self.put(PROMPT+4,WINDOW)
  self.put(REQ+4,W+0x1400);self.hasCandy=True;self.actorVisibility={};self.put(W+0x1e8,W+0x1500);self.put(W+0x1ec,W+0x1600)
  for at,value in [(2,0),(3,1),(4,21),(7,21),(8,2)]:self.put(WINDOW+at,value,1)
  self.u.mem_write(MAP,struct.pack('<1024H',*range(1,1025)));self.mapUploads=0
  def add(a,f):self.functions[a-(self.delta if a>=0x2150000 else self.armdelta if a>=0x20191d8 else 0)]=f
  for a in APIS+NATIVE:add(a,lambda x:0)
  add(0x2199bc8,lambda x:1);add(0x2199ed0,lambda x:0);add(0x2199de8,lambda x:1);add(0x219bb48,self.original)
  self.sounds=[];self.paletteUploads=[];self.printed=[];self.nickname='Oshawott'
  self.members={};self.writes=[]
  self.hideFlag=0;self.configVersion=2;self.flagReads=[];self.nativePrompts=0
  self.flagWork=W+0x3000
  add(0x20191d8,self.flag);add(0x219f880,self.prompt)
  add(0x2017394,lambda x:self.flagWork);add(0x2034c80,lambda x:REQ)
  for i in range(6):self.put(W+0x164+i*4,W+0x2600+i*80)
  add(0x2006254,lambda x:self.sounds.append(x[0]));add(0x2048640,self.text)
  add(0x201fe24,lambda x:self.partyCount);add(0x201ff34,lambda x:MON+x[1]*220);add(0x201cd24,self.get);add(0x201cd48,self.set)
  add(0x201d5e0,lambda x:9261);add(0x204855c,lambda x:self.allocate([x[1],x[0]*2+8]));add(0x2048590,self.free);
  add(0x2008474,self.ownsCandy);add(0x204c150,self.showActor)
  add(0x203df28,lambda x:self.pressed);add(0x203df4c,lambda x:self.keys);add(0x203dab0,self.point)
  add(0x219b30c,self.candy);add(0x219e688,self.subtract);add(0x219f350,self.redraw);add(0x219f290,self.redraw)
  add(0x203a228,self.allocate);add(0x203a278,self.free);add(0x2070ecc,lambda x:1);add(0x204ab48,self.read);add(0x204ab38,self.free)
  add(0x215ba0c,lambda x:0);add(0x215c3e4,lambda x:0)
  sys=0x022a0000;chars=sys+0x200;palettes=sys+0xa00;animations=sys+0xe00
  self.put(0x214193c if game=='B2' else 0x214197c,sys)
  self.put(sys+0x10c,chars);self.put(sys+0x110,palettes);self.put(sys+0x114,animations)
  for offset in [0x118,0x11a,0x11c]:self.put(sys+offset,32,2)
  for i in range(32):self.put(chars+i*64+60,0x80000000);self.put(palettes+i*24+20,0x80000000);self.put(animations+i*20+16,1)
  add(0x2039f8c,lambda x:self.heapFree);add(0x2039fbc,lambda x:self.heapLargest);add(0x203cb14,lambda x:self.vramFail)
  add(0x204bbcc,lambda x:self.handle(self.palHandles));add(0x204bcfc,lambda x:self.release(self.palHandles,x[0]))
  add(0x204bd3c,self.uploadPalette)
  add(0x204be0c,lambda x:self.handle(self.animHandles));add(0x204be90,lambda x:self.release(self.animHandles,x[0]))
  add(0x204b8e8,lambda x:self.handle(self.charHandles));add(0x204b9b8,lambda x:self.release(self.charHandles,x[0]))
  add(0x204bf48,lambda x:self.allocate([0,2400]));add(0x204bfc4,self.free)
  add(0x204c06c,lambda x:self.allocate([0,228]));add(0x204c134,self.free)
  add(0x20056fc,lambda x:self.allocate([0,32]));add(0x203a6d4,self.free);add(0x204ba6c,self.upload)
  add(0x2045840,lambda x:MAP);add(0x2045ba8,self.queueMap)
  self.archive=ndspy.narc.NARC((BUILD.parents[2]/'src/assets/codeinjection/partyQuickActions.narc').read_bytes())
  self.u.hook_add(UC_HOOK_CODE,self.hook)
 def put(self,p,n,size=4):self.u.mem_write(p,n.to_bytes(size,'little'))
 def val(self,p,size=4):return int.from_bytes(self.u.mem_read(p,size),'little')
 def hook(self,u,a,n,_):
  if a==STOP:u.emu_stop();return
  if a in self.functions:
   args=[u.reg_read(r) for r in [UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3]];v=self.functions[a](args);u.reg_write(UC_ARM_REG_R0,v or 0);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
 def original(self,a):self.native+=1
 def prompt(self,a):self.nativePrompts+=1
 def flag(self,a):
  assert a[0]==self.flagWork and 1<=a[1]<=3059
  self.flagReads.append(a[1]);return bool(self.val(self.flagWork+0x35e+(a[1]>>3),1)&(1<<(a[1]&7)))
 def ownsCandy(self,a):assert a==[W+0x1400,622,1,23];return self.hasCandy
 def showActor(self,a):self.actorVisibility[a[0]]=bool(a[1])
 def queueMap(self,a):assert a[0]==0;self.mapUploads+=1
 def member(self,p):return self.members.get((p-MON)//220,self.values)
 def set(self,a):self.member(a[0])[a[1]]=a[2];self.writes.append(tuple(a[:3]))
 def get(self,a):
  if a[1]==0x74:
   self.u.mem_write(a[2],self.nickname[:10].encode('utf-16-le')+b'\xff\xff');return 1
  return self.member(a[0]).get(a[1],0)
 def text(self,a):
  chars=[]
  for i in range(32):
   c=self.val(a[1]+i*2,2)
   if c==0xffff:break
   chars.append(c)
  else:raise AssertionError('unterminated native string')
  self.printed.append(struct.pack('<'+'H'*len(chars),*chars).decode('utf-16-le'))
 def point(self,a):
  if self.touch:self.put(a[0],self.touch[0]);self.put(a[1],self.touch[1])
  return bool(self.touch)
 def candy(self,a):self.effects+=1;self.put(W+12,7,1)
 def subtract(self,a):self.subtractions+=1
 def redraw(self,a):self.redraws+=1
 def allocate(self,a):
  self.allocCount+=1
  if self.fail or self.allocCount==self.failAt:return 0
  p=self.alloc;self.alloc+=((a[1]+31)//32)*32;self.owned.add(p);return p
 def free(self,a):
  assert a[0] in self.owned,'duplicate/unowned free';self.owned.remove(a[0])
 def handle(self,handles):
  self.allocCount+=1
  if self.fail or self.allocCount==self.failAt:return 0xffffffff
  n=next(i for i in range(32) if i not in handles);handles.add(n);return n
 def release(self,handles,n):assert n in handles,'duplicate/unowned resource release';handles.remove(n)
 def upload(self,a):
  assert a[0] in self.charHandles;assert self.val(a[1]+16)==512;self.uploads+=1
 def uploadPalette(self,a):
  assert a[0] in self.palHandles and a[2]==0
  assert [self.val(a[1]+i*4) for i in range(3)]==[3,0,96]
  assert self.val(a[1]+12)==self.session+340,'queued palette data must remain owned until cleanup'
  self.paletteUploads.append(bytes(self.u.mem_read(self.val(a[1]+12),96)))
 def read(self,a):
  config=struct.pack('<6I',0x51415050,2,24,int(self.enabled),self.hideFlag,0x51415050^int(self.enabled)^self.hideFlag) if self.configVersion==2 else struct.pack('<5I',0x51415050,1,20,int(self.enabled),0x51415050^int(self.enabled))
  data=self.archive.files[a[1]] if a[1] else config
  p=self.allocate([0,len(data)])
  if p:self.u.mem_write(p,bytes(data))
  return p
 def call(self,name,*args):
  saved=list(range(UC_ARM_REG_R4,UC_ARM_REG_R11+1))
  for r in saved:self.u.reg_write(r,0x5000+r)
  self.u.reg_write(UC_ARM_REG_SP,STACK);self.u.reg_write(UC_ARM_REG_LR,STOP|1)
  for r,a in zip([UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3],args):self.u.reg_write(r,a)
  self.u.emu_start(self.symbols[name]|1,STOP,count=100000)
  assert self.u.reg_read(UC_ARM_REG_PC)==STOP and self.u.reg_read(UC_ARM_REG_SP)==STACK,(name,'stack/termination')
  for r in saved:assert self.u.reg_read(r)==0x5000+r,(name,'register',r)
  return self.u.reg_read(UC_ARM_REG_R0)
 def seed(self):
  self.put(self.session,0x53504150);self.put(self.session+4,W);self.put(self.session+76,0xffffffff);self.put(self.session+80,0xffffffff);self.put(self.session+334,255,1)
  for i in range(8):self.put(self.session+44+i*4,0xffffffff)
  self.put(self.session+444,0xffffffff)
 def art(self,i):return self.val(self.session+(440 if i==8 else 84+i*4))
 def frame(self,touch=None,keys=0,pressed=0):
  # Existing regression inputs name the previous centers. Keep confirmation
  # YES/NO regions unchanged; toolbar inputs follow the new nine-icon layout.
  if touch and not self.val(self.session+335,1) and touch[1]==180:
   old={18:13,40:53,62:73,84:93,106:113,128:133,150:153,172:173}
   touch=(old.get(touch[0],touch[0]),touch[1])
  self.touch=touch;self.keys=keys;self.pressed=pressed;self.call('PaTick',W);self.call('PaIdle',W)
def main():
 for g in ['W2','B2']:
  h=Harness(g);h.seed();h.frame((40,180));assert h.val(h.session+122,1)==1
  for y in range(32):
   for x in range(32):assert h.val(MAP+(y*32+x)*2,2)==(0 if 20<=y<24 and x<23 else y*32+x+1)
  assert h.mapUploads==1
  h.frame();assert h.mapUploads==1,'unchanged toolbar must not requeue map uploads'
  h.call('PaPrompt',W,PROMPT,10);h.put(W+14,2,1);h.frame();assert h.mapUploads==2
  assert bytes(h.u.mem_read(MAP,2048))==struct.pack('<1024H',*range(1,1025)),'native prompt frame not restored'
  h.call('PaPrompt',W,PROMPT,9);h.put(W+14,1,1);h.frame();assert h.mapUploads==3
  h.frame(None,0x20,0x20);assert h.values[160]==9
  for _ in range(30):h.frame(None,0x20)
  assert h.values[160]==0 and h.val(W+0x30)==0
  h.frame((170,40),0x40,0x40);assert h.val(W+0x30)==0 and h.values[160]==0
  for _ in range(40):h.frame(None,0x10)
  assert h.values[160]==20
  h.frame(None,1,1);assert h.val(h.session+122,1)==0
  for x,n in zip([84,106,128,150,172],[2,5,4,3,1]):
   h.frame();h.frame((x,180));assert h.values[157]==n
   h.frame();h.frame((x,180));assert h.values[157]==0,'second status tap must clear it'
   for _ in range(20):h.frame((x,180));assert h.values[157]==0,'held status touch must not reapply it'
  # A different status replaces the existing condition. A status tap also
  # leaves HP mode and targets its locked slot, without changing HP again.
  h.frame();h.frame((84,180));h.frame();h.frame((106,180));assert h.values[157]==5
  for x,n in zip([84,106,128,150,172],[2,5,4,3,1]):
   for current,expected in [(0,n),(n,0)]:
    h.values[157]=current;h.frame();h.frame((40,180));assert h.val(h.session+122,1)==1
    hp=h.values[160];h.put(W+0x30,3);h.frame();h.frame((x,180),0x10,0x10)
    assert h.val(h.session+122,1)==0 and h.values[157]==expected and h.val(W+0x30)==0 and h.values[160]==hp
  # EXP confirmation is owned, cancellable and cannot change level/stats/HP.
  h.frame();h.frame((62,180));assert h.val(h.session+335,1)==1 and h.values[8]==8000
  h.put(W+0x30,3);h.frame(None,2,2);assert h.values[8]==8000 and h.val(W+0x30)==0 and not h.owned
  h.frame();h.frame((62,180));h.frame(None,1,1);assert h.values[8]==9260 and h.values[158]==20 and h.val(h.session+335,1)==2
  assert h.printed[-1]=="Oshawott's xp was edged!"
  before=h.values.copy()
  h.frame(None,0x10,0x10);assert h.values==before and h.val(h.session+335,1)==2
  h.frame(None,1,1);assert h.val(h.session+335,1)==0 and not h.owned
  h.values[8]=8000;h.frame();h.frame((62,180));h.frame();h.frame((128,180));assert h.values[8]==8000 and not h.owned
  h.nickname='Éclair♀';h.frame();h.frame((62,180));h.frame();h.frame((75,180));assert h.values[8]==9260 and h.val(h.session+335,1)==2
  assert h.printed[-1]=="Éclair♀'s xp was edged!"
  for _ in range(20):h.frame((75,180))
  assert h.val(h.session+335,1)==2,'held YES cannot dismiss its success message'
  h.frame();h.frame((128,180));assert h.val(h.session+335,1)==0 and not h.owned
  h.values[158]=100;h.frame();h.frame((62,180));assert h.val(h.session+335,1)==0;h.values[158]=20
  # L locks the selected Pokémon and navigates all nine icons; A owns activation.
  h.frame(None,0x200,0x200);assert h.val(h.session+331,1)==1 and h.val(h.session+332,1)==0
  h.put(W+0x30,4);h.frame(None,0x10,0x10);assert h.val(W+0x30)==0 and h.val(h.session+332,1)==8 and h.sounds[-1]==1352
  h.frame(None,0x10,0x10);assert h.val(h.session+332,1)==1 and h.sounds[-1]==1352
  h.frame(None,1,1);assert h.val(h.session+122,1)==1 and h.sounds[-1]==1356
  h.frame(None,0x20,0x20);assert h.values[160]==19
  h.frame(None,1,1);assert h.val(h.session+122,1)==0
  h.frame(None,0x10,0x10);h.frame(None,1,1);assert h.val(h.session+335,1)==1
  h.frame(None,2,2);h.frame(None,0x10,0x10);h.frame(None,1,1);assert h.values[157]==2
  h.frame(None,1,1);assert h.values[157]==0
  h.frame(None,2,2);assert h.val(h.session+331,1)==0
  h.hasCandy=False;h.frame(None,0x200,0x200);assert h.val(h.session+332,1)==8
  h.frame(None,0x20,0x20);assert h.val(h.session+332,1)==7
  h.frame(None,0x10,0x10);assert h.val(h.session+332,1)==8
  h.frame(None,0x200,0x200);assert h.val(h.session+331,1)==0;h.hasCandy=True
  h.frame();h.frame((18,180));assert h.effects==1 and h.val(REQ+0x44)==5
  for _ in range(25):h.frame((18,180))
  assert h.effects==1
  h.call('PaSubtract',W,50);assert h.subtractions==0
  h.put(W+12,2,1);h.frame();assert h.val(REQ+0x44)==0
  h.call('PaSubtract',W,50);assert h.subtractions==1
  # Native targets and input edge cases cannot silently affect another slot.
  before=h.effects
  h.values[158]=100;h.frame();h.frame((18,180));assert h.effects==before
  h.values[158]=20;h.values[76]=1;h.frame();h.frame((18,180));assert h.effects==before
  h.values[76]=0;h.partyCount=0;h.frame();h.frame((18,180));assert h.effects==before
  h.partyCount=6;h.values[160]=0;before=h.values[157];h.frame();h.frame((84,180));assert h.values[157]==before
  h.values[157]=2;h.frame();h.frame((84,180));assert h.values[157]==0,'clearing an existing status must work at zero HP'
  h.values[160]=10;h.frame();h.frame((40,180));h.frame(None,2,2);assert h.val(h.session+122,1)==0
  h.frame((40,180));assert h.val(h.session+122,1)==1
  h.frame();h.frame((40,180));assert h.val(h.session+122,1)==0
  h.frame();h.frame((84,180));before=h.redraws
  for _ in range(20):h.frame((84,180))
  assert h.redraws==before
  assert h.actorVisibility[W+0x1500] is False
  assert h.actorVisibility[W+0x1600] is False
  before=h.native;h.frame((190,180));assert h.native==before,'removed checkmark touch must be inert'
  before=h.native;h.frame((214,180));assert h.native==before,'removed Cancel touch must be inert'
  before=h.native;h.frame((230,180));assert h.native==before+1
  before=h.effects;h.hasCandy=False;h.frame();h.frame((18,180));assert h.effects==before
  h.hasCandy=True;h.frame();h.frame((18,180));assert h.effects==before+1
  h.put(W+12,2,1);h.frame()
  # Every failed/disabled initialization restores native input and owns no heap data.
  h.enabled=False
  for fail in [True,False,True,False]:
   h.fail=fail;h.call('PaEnd',W);h.call('PaInit',W);assert not h.owned;h.frame();h.call('PaEnd',W);assert not h.owned
  # Optional saved flag gates initialization and the prompt suppression. It is
  # read-only, leaves native Cancel/input intact, and is rechecked on entry.
  for flag in [1,0x5ee,3059]:
   f=Harness(g);f.hideFlag=flag;assert f.call('PaRequest',W+0x3500,0,PARTY,4)==REQ;pos=f.flagWork+0x35e+(flag>>3)
   f.put(pos,255,1);before=bytes(f.u.mem_read(f.flagWork,0x4e0))
   f.call('PaPrompt',W,PROMPT,9);assert f.nativePrompts==1
   f.call('PaInit',W);assert not f.val(f.session+4) and not (f.owned or f.charHandles or f.palHandles or f.animHandles)
   f.frame((33,180),0x200,0x200);assert f.native==1 and not f.writes and W+0x1500 not in f.actorVisibility and W+0x1600 not in f.actorVisibility
   assert f.flagReads and set(f.flagReads)=={flag} and bytes(f.u.mem_read(f.flagWork,0x4e0))==before
   f.put(pos,255^(1<<(flag&7)),1);before=bytes(f.u.mem_read(f.flagWork,0x4e0))
   f.call('PaInit',W);f.frame();assert f.val(f.session+4)==W and f.actorVisibility[W+0x1500] is False
   f.call('PaEnd',W);assert bytes(f.u.mem_read(f.flagWork,0x4e0))==before and not f.owned
   assert not f.val(f.symbols['flagWork']) and not f.val(f.symbols['flagRequest']),'request references must clear at native teardown'
  for version in [1,2]:
   f=Harness(g);f.configVersion=version;f.put(f.flagWork+0x35e,255,1);f.call('PaInit',W)
   assert f.val(f.session+4)==W and not f.flagReads,'default/legacy configuration must remain on without a flag'
   f.call('PaEnd',W);assert not f.owned
  f=Harness(g);f.hideFlag=3060;f.call('PaInit',W);assert not f.val(f.session+4) and not f.flagReads and not f.owned
  f=Harness(g);f.hideFlag=1;f.call('PaInit',W);assert not f.val(f.session+4) and not f.owned,'uncaptured request must retain vanilla controls'
  f.call('PaRequest',W+0x3500,0,PARTY,4);f.put(f.symbols['flagWork'],0);f.call('PaInit',W);assert not f.val(f.session+4) and not f.owned,'missing save work must retain vanilla controls'
  # Real allocation paths, scheduled uploads, all partial-failure cleanup points.
  probe=Harness(g);probe.enabled=True;probe.call("PaInit",W);allocationSteps=probe.allocCount;probe.call("PaEnd",W)
  for failAt in range(1,allocationSteps+1):
   a=Harness(g);a.enabled=True;a.failAt=failAt;a.call('PaInit',W)
   if not a.val(a.session+4):
    n=a.nativePrompts;a.call('PaPrompt',W,PROMPT,9);assert a.nativePrompts==n+1,'failed initialization must keep later native prompts visible'
   if a.val(a.session+4):a.call('_Z6uploadPvS_',0,0)
   a.call('PaEnd',W);assert not (a.owned or a.charHandles or a.palHandles or a.animHandles),(g,failAt,'resource leak')
  a=Harness(g);a.enabled=True
  a.hasCandy=False;a.call('PaInit',W);a.frame();a.call('_Z6uploadPvS_',0,0)
  actors=[a.val(a.session+12+i*4)for i in range(8)]+[a.val(a.session+436)]
  assert not a.actorVisibility[actors[0]] and all(a.actorVisibility[p]for p in actors[1:]),'missing Candy must hide only its actor'
  before=a.allocCount;a.frame((18,180));assert a.effects==0 and a.allocCount==before
  a.hasCandy=True;a.frame();a.call('_Z6uploadPvS_',0,0);assert a.actorVisibility[actors[0]]
  # A single-pixel border keeps the icons intact. Only the three reserved
  # palette entries follow the native fade; idle frames do not upload art.
  basePal=bytes(a.u.mem_read(a.session+340,96))
  original=[bytes(a.u.mem_read(a.art(i),512)) for i in range(9)]
  a.put(W+0xac,0x4140,2)
  a.frame(None,0x200,0x200);a.frame();a.call('_Z6uploadPvS_',0,0)
  assert a.val(a.session+334,1)==0
  pixels=untile(a.u.mem_read(a.art(0),512),32);native=untile(original[0],32)
  for y in range(32):
   for x in range(32):
    edge=(x in (6,26) or y in (4,27)) and 6<=x<=26 and 4<=y<=27
    assert pixels[y][x]==(9 if edge else native[y][x]),'selector must be one pixel thick'
  before=a.allocCount
  chars=a.uploads
  for color in [0x4561,0x4dc3,0x5a66,0x66e7,0x7768,0x7be9,0x7768,0x66e7,0x5a66,0x4dc3,0x4561,0x4140]*6:
   a.put(W+0xac,color,2);a.frame();a.call('_Z6uploadPvS_',0,0)
   assert a.val(a.session+334,1)==0 and a.allocCount==before and a.uploads==chars
   uploaded=bytearray(a.paletteUploads[-1]);assert all(struct.unpack_from('<H',uploaded,o)[0]==color for o in (30,50,94))
   for o in (30,50,94):uploaded[o:o+2]=basePal[o:o+2]
   assert uploaded==basePal,'native icon/HP underline colors must stay fixed'
  a.frame(None,0x10,0x10);a.call('_Z6uploadPvS_',0,0)
  assert a.sounds[-1]==1352 and bytes(a.u.mem_read(a.val(a.session+84),512))==original[0]
  assert a.val(a.session+334,1)==8
  a.frame(None,0x10,0x10);a.call('_Z6uploadPvS_',0,0);assert a.val(a.session+334,1)==1
  a.frame(None,1,1);a.call('_Z6uploadPvS_',0,0);assert a.sounds[-1]==1356
  assert all(untile(a.u.mem_read(a.val(a.session+88),512),32)[y][x]==15 for y in (22,23) for x in range(8,24))
  a.frame(None,2,2);a.call('_Z6uploadPvS_',0,0)
  assert a.paletteUploads[-1]==basePal and a.val(a.session+334,1)==255
  assert all(bytes(a.u.mem_read(a.art(i),512))==original[i] for i in range(9))
  # Fade-in and fade-out must keep the blank native frame hidden.
  for fsm in [1,3,2]:
   a.put(W+12,fsm,1);a.frame();assert a.val(a.session+329,1)==1
  a.fail=True;a.frame((62,180));assert a.val(a.session+335,1)==0 and a.values[8]==8000;a.fail=False
  a.frame();a.frame((62,180));assert a.val(a.session+335,1)==1
  a.call('PaEnd',W);assert not (a.owned or a.charHandles or a.palHandles or a.animHandles),'confirmation shutdown leaked'
  a.call('PaInit',W);a.frame((62,180));a.frame(None,1,1);assert a.val(a.session+335,1)==2
  a.call('PaEnd',W);assert not (a.owned or a.charHandles or a.palHandles or a.animHandles),'success-message shutdown leaked'
  a.uploads=0
  for _ in range(3):
   a.call('PaInit',W);assert len(a.charHandles)==9 and a.val(a.session+4)==W
   a.call('_Z6uploadPvS_',0,0);assert a.uploads%9==0
   a.call('PaEnd',W);assert not (a.owned or a.charHandles or a.palHandles or a.animHandles)
  for free,largest,vram in [(100,32768,False),(65536,100,False),(65536,32768,True)]:
   a.heapFree=free;a.heapLargest=largest;a.vramFail=vram;a.call('PaInit',W);assert a.val(a.session+4)==0
   assert not (a.owned or a.charHandles or a.palHandles or a.animHandles)
  a.heapFree=65536;a.heapLargest=32768;a.vramFail=False
  pal=a.val(0x022a0000+0x110);a.put(pal+12,400);a.put(pal+20,64)
  a.call('PaInit',W);assert a.val(a.session+4)==0 and not a.owned,'occupied palette banks must preserve native UI'
  a.put(pal+20,0x80000000)
  # Healing requires an owned, cancellable prompt from touch or L/A.
  # Acceptance targets every non-fainted real party member without an item.
  h=Harness(g);h.seed();h.members={i:{**h.values,160:0 if i%2==0 else i,161:30+i*10,157:i+1,8:8000+i,62:3+i} for i in range(6)}
  h.frame((40,180));assert h.val(h.session+122,1)==1
  h.frame();before=[p.copy() for p in h.members.values()];h.hasCandy=False;h.put(W+0x30,3);h.frame((33,180))
  assert h.val(h.session+122,1)==0 and h.val(h.session+335,1)==3 and h.val(h.session+123,1)==0
  assert h.printed[-1]=='Heal Party? A:Yes B:No' and list(h.members.values())==before and 1391 not in h.sounds
  for _ in range(20):h.frame((33,180))
  assert h.val(h.session+335,1)==3 and list(h.members.values())==before,'held healing touch must not confirm'
  h.frame(None,2,2)
  assert not h.owned and h.val(h.session+335,1)==0 and h.val(h.session+329,1)==1 and list(h.members.values())==before,'B must cancel without healing'
  h.frame();h.frame((33,180));h.frame();h.frame((111,180))
  assert not h.owned and list(h.members.values())==before,'touch NO must not heal'
  h.frame();h.frame((33,180));h.frame(None,1,1)
  assert h.val(h.session+335,1)==0 and h.sounds[-1]==1391 and h.sounds.count(1391)==1 and h.subtractions==0 and not h.owned
  assert all(p==(before[i] if before[i][160]==0 else {**before[i],160:p[161],157:0}) for i,p in h.members.items())
  assert h.redraws==3 and all(h.val(W+0x2600+i*80+6,2)==0 for i in range(6)),'native reconstruction route must be used'
  n=len(h.sounds);writes=len(h.writes)
  for _ in range(20):h.frame(None,1)
  assert len(h.sounds)==n and len(h.writes)==writes,'held A must not activate healing twice'
  h.members[2][76]=1;h.members[2][160]=0;h.members[2][157]=5;egg=h.members[2].copy()
  h.put(W+0x30,2);h.frame();h.frame((33,180));assert h.val(h.session+335,1)==3,'selected Egg must not block the team prompt'
  h.frame();h.frame((95,180));assert h.members[2]==egg and h.val(h.session+335,1)==0,'Eggs must stay untouched even when selected'
  n=len(h.sounds);writes=len(h.writes)
  for _ in range(20):h.frame((95,180))
  assert len(h.sounds)==n and len(h.writes)==writes,'held YES must not activate another toolbar action'
  h.partyCount=2;h.members[4][160]=1;h.members[4][157]=1;outside=h.members[4].copy()
  h.frame();h.frame((33,180));h.frame(None,1,1);assert h.members[4]==outside,'only existing party members may change'
  h.partyCount=6;h.put(W+0x30,0);h.frame(None,0x200,0x200);assert h.val(h.session+332,1)==8
  h.members[5][160]=1;h.members[5][157]=4;before=[p.copy() for p in h.members.values()];h.frame(None,1,1)
  assert h.val(h.session+335,1)==3 and list(h.members.values())==before,'L/A must prompt before healing'
  h.frame(None,2,2);assert h.val(h.session+331,1)==1 and h.val(h.session+332,1)==8 and list(h.members.values())==before,'cancel must return to the selected toolbar icon'
  h.frame();h.frame(None,1,1);h.frame();h.frame(None,1,1)
  assert h.members[5][160]==h.members[5][161] and h.members[5][157]==0 and h.sounds[-1]==1391 and h.val(h.session+331,1)==1
  for p in h.members.values():p[160]=0
  before=[p.copy() for p in h.members.values()];h.frame();h.frame((33,180));h.frame(None,1,1);assert list(h.members.values())==before,'an all-fainted team must stay unchanged'
  h.frame();h.fail=True;h.frame((33,180));h.fail=False
  assert h.val(h.session+335,1)==0 and not h.owned and list(h.members.values())==before,'failed confirmation allocation must not heal or leak'
  h.frame();h.frame((33,180));assert h.val(h.session+335,1)==3
  h.call('PaEnd',W);assert not h.owned,'healing prompt shutdown leaked'
  h=Harness(g);h.seed();h.frame((18,180));h.put(REQ+0x50,5);h.call('PaEnd',W)
  field=W+0x1000;h.call('PaPartyReturn',field,REQ);assert h.call('PaEvolutionReturn',field)==4 and h.val(field+4)==0 and h.val(field+12)==0
  prior=ndspy.narc.NARC((BUILD.parents[2]/'src/test/fixtures/party-quick-actions-v0.1.2/partyQuickActions.narc').read_bytes())
  def colors(arc,i):
   count=struct.unpack_from('<H',arc.files[2],24)[0];bank=struct.unpack_from('<H',arc.files[2],52+count*16+i*8)[0]>>12
   pal=struct.unpack_from('<16H',arc.files[1],40+bank*32)
   return [[pal[v] if v else None for v in row] for row in untile(arc.files[4+i],32)]
  def occupied(rows):
   points=[(x,y,c)for y,row in enumerate(rows)for x,c in enumerate(row)if c is not None];xmin=min(x for x,y,c in points);ymin=min(y for x,y,c in points)
   return {(x-xmin,y-ymin):c for x,y,c in points}
  assert all(occupied(colors(prior,i))==occupied(colors(a.archive,i)) for i in range(8)),'palette remapping changed native graphics'
  restore=occupied(colors(a.archive,8));assert max(x for x,y in restore)<16 and max(y for x,y in restore)<16,'Full Restore must fit 16px'
  print(g,'register/stack, HP bounds/repeat/lock, Heal Team confirmation/cancellation/held-input/allocation failure preserving fainted/Egg/all-fainted members and count bounds, native recovery sound, status apply/clear and HP-mode exit, XP confirmation/cancel/level guard and nickname success message, L/A navigation with native move sound and one-pixel native-color fade, fixed icon/HP colors, save-flag gating with native input/prompt fallback and unchanged adjacent bits, fade-frame suppression, held touch, Candy/evolution ownership, nine uploads, repeated allocation/cleanup, palette conflicts and failure paths passed')
if __name__=='__main__':main()
