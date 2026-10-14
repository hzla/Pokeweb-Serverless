"""Execute both compiled BW1 modules with allocation and native-request stubs.

This tests ARM/Thumb calls, ownership and portable behavior. Actual game/menu
transitions are checked separately in the DS emulator.
"""
import json,struct,subprocess
from pathlib import Path
import ndspy.narc,ndspy.codeCompression
from elftools.elf.elffile import ELFFile
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_THUMB,UC_HOOK_CODE
from unicorn.arm_const import *
from build_bw1 import HERE,BUILD,TOOLS
from configure_bw1 import configure
REGS=[UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3]
SAVED=[UC_ARM_REG_R4,UC_ARM_REG_R5,UC_ARM_REG_R6,UC_ARM_REG_R7,UC_ARM_REG_R8,UC_ARM_REG_R9,UC_ARM_REG_R10,UC_ARM_REG_R11]
STOP=0x23f8000;STACK=0x23f0000;SUB=0x2280000;FIELD=SUB+0x100;SYS=SUB+0x200;GAME=SUB+0x300;ETC=SUB+0x800;WORK=SUB+0x1000;CLSYS=SUB+0x3000;PARTY=SUB+0x9000
class Harness:
 def __init__(self,game):
  rom,p=configure(game);self.profile=p;self.native={k:v['entry']for k,v in p['functions'].items()}
  self.uc=Uc(UC_ARCH_ARM,UC_MODE_THUMB);self.uc.ctl_set_cpu_model(UC_CPU_ARM_946);self.uc.mem_map(0x2000000,0x400000);self.uc.mem_map(0x4000000,0x2000)
  self.uc.mem_write(rom.arm9RamAddress,bytes(ndspy.codeCompression.decompress(rom.arm9)))
  self.planeCache=0x2146a48 if game=='B'else 0x2146a68
  self.put(self.planeCache,0x17);self.put(0x4001000,0x11710)
  for o in rom.loadArm9Overlays([10,21,29]).values():self.uc.mem_write(o.ramAddress,bytes(o.data))
  elf=BUILD/f'{game}-bw1-harness.elf'
  subprocess.run([str(TOOLS/'arm-none-eabi-g++'),'-nostdlib','-Wl,-Ttext=0x02300020,-Tbss=0x02320000,-eQaCGearInit',str(BUILD/f'CGearQuickActions{game}.o'),'-o',str(elf)],check=True)
  with elf.open('rb')as f:
   e=ELFFile(f)
   for segment in e.iter_segments():
    if segment['p_type']=='PT_LOAD':self.uc.mem_write(segment['p_vaddr'],segment.data()+bytes(segment['p_memsz']-segment['p_filesz']))
   self.symbols={s.name:s['st_value']for s in e.get_section_by_name('.symtab').iter_symbols()}
  self.arc=ndspy.narc.NARC((HERE.parents[1]/'src/assets/codeinjection/cgearQuickActionsBw1.narc').read_bytes())
  self.functions={};self.allocations={};self.heap=0x2200000;self.attempts=0;self.fail=0;self.chars=set();self.actors=set();self.visibility={};self.uploads=[];self.inVblank=False;self.vblank=0
  self.touch=None;self.keys=0;self.nativeInputs=0;self.owned={442,450};self.flags=set();self.blocked=set();self.events=[];self.children=[];self.fieldItems=[];self.sounds=[];self.nativeEvent=0;self.maps=[];self.fly=True;self.moves={0:[19]};self.nativeTouches=[]
  self.write(SUB,struct.pack('<IIIHHIIIII',0,0,0,112,0,0,FIELD,0,0,WORK));self.put(FIELD+4,SYS);self.put(SYS+0x1c,GAME)
  self.put(WORK,self.native['GearIdle']);self.put(WORK+0x34,CLSYS+0x2000)
  for i in range(4):self.put(WORK+0x148+i*4,0x22a1000+i*228)
  self.nativePalettes=[];self.networkPositions=[];self.lastPalette=None
  self.put(0x2146a74 if game=='B'else 0x2146a94,CLSYS)
  self.put(CLSYS+0x10c,CLSYS+0x400);self.put(CLSYS+0x110,CLSYS+0xc00);self.put(CLSYS+0x114,CLSYS+0xe00);self.write(CLSYS+0x118,struct.pack('<HHH',16,8,8))
  for i in range(16):self.put(CLSYS+0x400+i*64+60,0x80000000)
  for i in range(8):self.put(CLSYS+0xc00+i*24+20,0x80000000);self.put(CLSYS+0xe00+i*20+16,1)
  self.put(CLSYS+0x2000,CLSYS+0x2400);self.write(CLSYS+0x200c,struct.pack('<H',78))
  def add(name,callback):self.functions[self.native[name]&~1]=callback
  for name in ['Init','Update','Exit','NoGearInit','FileInit','ArchiveInit','ActorAnimate','PaletteDelete','AnimationDelete','ActorPlace','GearDispose']:add(name,lambda a:0)
  add('ActorPalette',self.actorPalette)
  add('NetworkPosition',lambda a:self.networkPositions.append(a[:2]))
  for name,target in [('Game',GAME),('Save',GAME),('Etc',ETC),('Party',PARTY),('Player',GAME),('Bag',GAME),('Flags',GAME),('Field',FIELD),('FieldMessage',FIELD+0x20)]:add(name,lambda a,t=target:t)
  add('PlayerForm',lambda a:0);add('PartyCount',lambda a:len(self.moves));add('HasItem',lambda a:int(a[1]in self.owned));add('Flag',lambda a:int(a[1]in self.flags))
  add('GetMon',lambda a:PARTY+0x20+a[1]*256);add('MonGet',lambda a:self.moves.get((a[0]-PARTY-0x20)//256,[])[a[1]-0x36]if 0x36<=a[1]<0x36+len(self.moves.get((a[0]-PARTY-0x20)//256,[]))else 0)
  add('HeapFree',lambda a:65536);add('HeapLargest',lambda a:65536);add('Alloc',lambda a:self.allocate(a[1]));add('Free',lambda a:self.free(a[0]));add('FileOpen',lambda a:1);add('ArchiveClose',lambda a:self.free(a[0]))
  add('ArchiveSize',lambda a:len(self.arc.files[a[1]]));add('ArchiveRead',self.read);add('PaletteLoad',self.paletteLoad);add('AnimationLoad',lambda a:3)
  add('CharCreate',self.char);add('CharDelete',self.charDelete);add('VramInvalid',lambda a:0);add('ActorCreate',self.actor);add('ActorDelete',self.actorDelete)
  add('ActorVisible',lambda a:self.visibility.update({a[0]:bool(a[1])}));add('VBlank',self.task);add('TaskDelete',lambda a:self.free(a[0]));add('CharUpload',self.upload);add('PaletteUpload',self.paletteUpload)
  add('Keys',lambda a:self.keys);add('Touch',self.point);add('Event',lambda a:self.nativeEvent);add('NativeButtonInput',self.nativeInput);add('GearTouch',lambda a:self.nativeTouches.append(a[1]))
  add('ItemCheck',lambda a:int(a[0]not in self.blocked));add('ItemEvent',lambda a:self.fieldItems.append(a[0])or 0x22f2000);add('Sound',lambda a:self.sounds.append(a[0]))
  add('FlyInit',lambda a:self.write(a[1],bytes(20)));add('FlyCheck',lambda a:int(not self.fly));add('FieldHeap',lambda a:112)
  add('EventCreate',self.eventCreate);add('EventData',lambda a:self.word(a[0]+12));add('EventSystem',lambda a:SYS);add('EventChild',lambda a:self.children.append(a[:2]));add('Application',self.mapCreate)
  add('SubscreenMode',lambda a:0);add('TownMapReturn',lambda a:7);add('FlyUse',lambda a:0x22f1000)
  add('FieldEncounter',lambda a:0);add('SubscreenReady',lambda a:1)
  self.uc.hook_add(UC_HOOK_CODE,self.intercept)
 def write(self,a,b):self.uc.mem_write(a,bytes(b));return 0
 def put(self,a,v):self.write(a,struct.pack('<I',v&0xffffffff))
 def word(self,a):return struct.unpack('<I',self.uc.mem_read(a,4))[0]
 def byte(self,a):return self.uc.mem_read(a,1)[0]
 def allocate(self,n):
  self.attempts+=1
  if self.attempts==self.fail:return 0
  p=self.heap;self.heap+=(n+7)&~7;self.allocations[p]=n;self.write(p,bytes(n));return p
 def free(self,p):assert p in self.allocations,('invalid/double free',hex(p));del self.allocations[p];return 0
 def read(self,a):
  b=self.arc.files[a[1]];p=self.allocate(len(b))
  if p:self.write(p,b)
  return p
 def char(self,a):
  i=next(i for i in range(16)if i not in self.chars);self.chars.add(i);return i
 def charDelete(self,a):self.chars.remove(a[0]);return 0
 def actor(self,a):p=self.allocate(228);self.actors.add(p)if p else None;return p
 def actorDelete(self,a):self.actors.remove(a[0]);return self.free(a[0])
 def actorPalette(self,a):
  assert a[1:3]==[15,1]
  self.nativePalettes.append(a[0]);return 0
 def task(self,a):self.vblank=a[0];return self.allocate(16)
 def upload(self,a):
  assert self.inVblank
  source,size=self.word(a[1]+20),self.word(a[1]+16)
  assert size in [512,1024] and any(p<=source and source+size<=p+n for p,n in self.allocations.items())
  self.uploads.append(bytes(self.uc.mem_read(source,size)));return 0
 def paletteUpload(self,a):
  assert self.inVblank and self.word(a[1]+8)==288 and a[2]==9
  self.lastPalette=bytes(self.uc.mem_read(self.word(a[1]+12),288));return 0
 def paletteLoad(self,a):assert a[2:]==[1,32];return 2
 def point(self,a):
  if self.touch:self.put(a[0],self.touch[0]);self.put(a[1],self.touch[1]);return 1
  return 0
 def nativeInput(self,a):self.nativeInputs+=1;return 0
 def eventCreate(self,a):
  event=self.allocate(20)
  if not event:return 0
  data=self.allocate(a[3])
  if not data:self.free(event);return 0
  self.put(event+4,a[2]);self.put(event+12,data);self.events.append(event);return event
 def mapCreate(self,a):
  assert any(p<=a[0]and a[0]+64<=p+n for p,n in self.allocations.items()),'Request must have an owned lifetime'
  assert self.word(a[0]+12)in [0,2,7,8,11]
  child=self.eventCreate([SYS,0,0,116]);self.put(self.word(child+12)+24,a[0]);self.maps.append((a[0],child));return child
 def intercept(self,u,a,size,_):
  if a==STOP:u.emu_stop();return
  if a not in self.functions:return
  assert u.reg_read(UC_ARM_REG_SP)%8==0,('stack alignment',hex(a))
  args=[u.reg_read(r)for r in REGS];value=self.functions[a](args)
  for r in REGS:u.reg_write(r,0xdeadbeef)
  u.reg_write(UC_ARM_REG_R0,(value or 0)&0xffffffff);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
 def call(self,name,*args,thumb=True):
  address=self.symbols[name]if isinstance(name,str)else name;values=[0x11110000+i for i in range(8)]
  for r,v in zip(SAVED,values):self.uc.reg_write(r,v)
  for r,v in zip(REGS,args):self.uc.reg_write(r,v)
  self.uc.reg_write(UC_ARM_REG_SP,STACK);self.uc.reg_write(UC_ARM_REG_LR,STOP|1);self.uc.emu_start(address|int(thumb),STOP,count=300000)
  assert self.uc.reg_read(UC_ARM_REG_PC)==STOP,('did not return',name,hex(self.uc.reg_read(UC_ARM_REG_PC)))
  assert self.uc.reg_read(UC_ARM_REG_SP)==STACK and [self.uc.reg_read(r)for r in SAVED]==values
  return self.uc.reg_read(UC_ARM_REG_R0)
 def session(self):return self.symbols['_ZN12_GLOBAL__N_17sessionE']
 def rehash(self):
  h=bytearray(self.arc.files[0]);value=0x811c9dc5
  for b in h[:28]+h[32:]:value=((value^b)*0x1000193)&0xffffffff
  struct.pack_into('<I',h,28,value);self.arc.files[0]=h
 def configure(self,rows):
  h=bytearray(self.arc.files[0]);h[20]=len(rows);h[32:160]=bytes(128)
  for i,(id,action,item,check,x,y,mode,flag)in enumerate(rows):struct.pack_into('<HBBHHHBBB3x',h,32+i*16,id,action,mode,item,0,flag,x,y,check)
  h[45]=1;self.arc.files[0]=h;self.rehash()
 def start(self):self.call('QaCGearInit',SUB);self.call('QaCGearUpdate',SUB,1)
 def press(self,x,y):self.touch=(x,y);self.call('QaInput',0x22a0000)
 def release(self):self.touch=None;self.call('QaInput',0x22a0000)
 def vblankRun(self):self.inVblank=True;self.call(self.vblank,0,0);self.inVblank=False

def run(game):
 # Reproduce the reported startup: hardware has BG0 enabled, but the native
 # cache says it is off. Execute the retail ARM implementations for both calls.
 x=Harness(game);x.put(x.planeCache,0x10)
 x.call(x.native['BackgroundVisible'],4,0,thumb=False);assert x.word(0x4001000)==0x11710
 x.put(WORK,x.native['GearIdle']+2);x.call('QaCGearInit',SUB)
 assert x.word(0x4001000)==0x11610 and x.word(x.planeCache)==0x16
 x.put(0x4001000,0x11710);x.put(x.planeCache,0x10);x.call('QaCGearUpdate',SUB,1)
 assert x.word(0x4001000)==0x11610 and x.word(x.planeCache)==0x16
 x.put(WORK,x.native['GearIdle']);x.call('QaCGearUpdate',SUB,1)
 # An external native display change before VBlank is suppressed again.
 x.put(0x4001000,0x11f10);x.put(x.planeCache,0x10);x.vblankRun()
 assert x.word(0x4001000)==0x11e10 and x.word(x.planeCache)==0x1e
 x.call('QaCGearExit',SUB);assert x.word(0x4001000)==0x11f10 and not x.allocations
 # With the patch disabled, native startup visibility remains untouched.
 x=Harness(game);header=bytearray(x.arc.files[0]);struct.pack_into('<II',header,8,0,0x41475143);x.arc.files[0]=header;x.rehash();x.start()
 assert x.word(0x4001000)==0x11710 and not x.actors
 h=Harness(game);h.start();assert len(h.actors)==7 and len(h.chars)==7 and h.byte(h.session()+916)==0
 assert h.nativePalettes==[] and h.networkPositions[-1]==[256,192]
 h.vblankRun();assert len(h.uploads)==7
 # A skin changes only the native panel part. Pose changes use palette uploads.
 for gender in range(2):
  for design in range(5):
   h.write(WORK+0x458,bytes([design,gender]));h.call('QaCGearUpdate',SUB,1);h.vblankRun()
   shape=gender*5+design
   expected=h.arc.files[12][shape*512:(shape+1)*512]
   # uploadBuffer begins at session offset 868; actor 0's first 512 bytes are the panel.
   assert bytes(h.uc.mem_read(h.word(h.session()+868),512))==expected
 h.write(WORK+0x458,bytes([0,0]));h.call('QaCGearUpdate',SUB,1)
 # Native controls win overlaps and a held browse press cycles exactly once.
 h.press(218,14)
 for _ in range(8):h.press(218,14)
 assert h.nativeTouches==[5] and h.sounds==[1356];h.release()
 h.press(222,170);h.release();assert h.nativeTouches[-1]==6
 h.press(198,170);h.release();assert h.nativeTouches[-1]==2
 # Transparent corners pass through, while the native callout label is a target.
 h.press(44,100);h.call('QaCGearEvent',SUB,1);h.release();assert h.byte(ETC+172)==0
 def labelPoint(arc):
  data=arc.files[4][25*32:]
  for y in range(8):
   for x in range(32):
    n=(x//8)*32+y*4+x%8//2
    if data[n]>>((x%2)*4)&15:return 60+17+x,116-20+y
 label=labelPoint(h.arc)
 for preference in [1,0]:
  h.press(*label);h.call('QaCGearEvent',SUB,1);h.release();assert h.byte(ETC+172)==preference
 # Hidden communication regions never call the native button manager.
 for xy in [(128,60),(128,96),(128,132),(34,170),(104,170)]:h.press(*xy);h.release();assert h.call('QaCGearEvent',SUB,1)==0
 assert h.nativeInputs==0
 # One activation per press, even after a native screen is reconstructed.
 h.press(60,116);h.call('QaCGearEvent',SUB,1);assert h.byte(ETC+164+8)==1
 for _ in range(10):h.press(60,116);h.call('QaCGearEvent',SUB,1)
 assert h.byte(ETC+172)==1
 h.call('QaGearEnd',WORK);h.put(WORK,h.native['GearIdle']);h.put(WORK+0x34,CLSYS+0x2000);h.call('QaCGearUpdate',SUB,1)
 h.press(60,116);h.call('QaCGearEvent',SUB,1);assert h.byte(ETC+172)==1
 h.release();h.press(60,116);h.call('QaCGearEvent',SUB,1);assert h.byte(ETC+172)==0;h.release()
 # Starting a press during a blocked event never activates after it clears.
 h.put(WORK+0x214,1);h.press(60,116);h.put(WORK+0x214,0);h.call('QaCGearUpdate',SUB,1)
 h.press(60,116);h.call('QaCGearEvent',SUB,1);assert h.byte(ETC+172)==0;h.release()
 # A queued request is discarded if a native event wins the frame.
 h.press(60,116);h.nativeEvent=0x22f4000;assert h.call('QaCGearEvent',SUB,1)==h.nativeEvent
 h.nativeEvent=0;assert h.call('QaCGearEvent',SUB,1)==0 and h.byte(ETC+172)==0;h.release()
 # Native visibility, saved flags and temporary restrictions remain read-only.
 h.owned.remove(450);h.flags.add(1517);h.call('QaCGearUpdate',SUB,1)
 assert h.byte(h.session()+892+1)==0 and h.byte(h.session()+892+2)==0
 h.owned.add(450);h.flags.clear();h.blocked.add(0);h.call('QaCGearUpdate',SUB,1);h.press(88,152);assert h.call('QaCGearEvent',SUB,1)==0;h.release();assert not h.fieldItems
 h.blocked.clear();h.call('QaCGearUpdate',SUB,1);h.press(88,152);assert h.call('QaCGearEvent',SUB,1)==0x22f2000;h.release();assert h.fieldItems==[0]
 # Edit mode and reset preserve all adjacent native/reserved save bytes.
 h.write(ETC,bytes([0x5a])*164);h.write(ETC+212,bytes([0xa5])*40)
 h.press(174,170);h.release();h.press(60,116);h.touch=(80,100);h.call('QaInput',0);h.release()
 assert h.byte(ETC+178)==80 and h.byte(ETC+179)==100
 h.keys=0x300
 for _ in range(60):h.call('QaCGearUpdate',SUB,1)
 assert h.byte(ETC+178)==60 and h.byte(ETC+179)==116
 assert bytes(h.uc.mem_read(ETC,164))==bytes([0x5a])*164 and bytes(h.uc.mem_read(ETC+212,40))==bytes([0xa5])*40
 h.call('QaCGearExit',SUB);assert not h.actors and not h.chars and not h.allocations
 assert h.networkPositions[-1]==[218,14]
 # Application requests survive native C-Gear teardown until their parent
 # event completes. Cancelling map/party/bag never returns dangling stack data.
 for action,item,check,route in [(4,442,1,7),(5,442,1,7),(8,465,6,11),(9,437,2,8),(15,0,255,2),(16,0,255,0)]:
  x=Harness(game);x.owned.update([465,437]);x.configure([(10,action,item,check,80,80,0,0)]);x.start();x.press(80,80)
  event=x.call('QaCGearEvent',SUB,1);callback=x.word(event+4);sequence=0x22f0000;x.put(sequence,0)
  assert x.call(callback,event,sequence)==0 and x.word(sequence)==1
  request,child=x.maps[-1];assert x.word(request+12)==(0 if action==4 else route)
  x.call('QaCGearExit',SUB);assert request in x.allocations
  x.put(request+36,1);assert x.call(callback,event,sequence)==1
  for native_event in x.events:x.free(x.word(native_event+12));x.free(native_event)
  assert not x.allocations
 # Saved positions follow stable IDs after ordering/default/action edits.
 x=Harness(game);x.start();x.press(174,170);x.release();x.press(60,116);x.touch=(81,101);x.call('QaInput',0);x.release();x.call('QaCGearExit',SUB)
 x.configure([(2,15,0,255,200,80,0,0),(1,1,0,255,120,80,0,0)]);x.start()
 assert [x.byte(x.session()+144+i)for i in range(4)]==[68,60,81,101]
 x.call('QaCGearExit',SUB);assert not x.allocations
 # Dragging a callout preserves the offset from the panel center.
 x=Harness(game);x.start();x.press(174,170);x.release();x.press(*label)
 x.touch=(label[0]+20,label[1]-10);x.call('QaInput',0);x.release()
 assert [x.byte(x.session()+144+i)for i in range(2)]==[80,106]
 x.call('QaCGearExit',SUB);assert not x.allocations
 # A dimmed front layer consumes touch; hiding it reveals the underlying action.
 x=Harness(game);x.configure([(1,1,0,255,100,100,0,0),(2,3,450,0,100,100,2,200)])
 x.blocked.add(0);x.start();x.press(100,100);x.call('QaCGearEvent',SUB,1);x.release();assert x.byte(ETC+172)==0
 x.flags.add(200);x.call('QaCGearUpdate',SUB,1);x.press(100,100);x.call('QaCGearEvent',SUB,1);x.release();assert x.byte(ETC+172)==1
 x.call('QaCGearExit',SUB);assert not x.allocations
 # Eight authored actions plus browse are nine actors and at most 8.5 KiB.
 h=Harness(game);h.configure([(i+1,1,0,255,32+i%4*56,64+i//4*64,0,0)for i in range(8)]);h.start();assert len(h.actors)==9 and len(h.chars)==9;h.vblankRun();h.call('QaCGearExit',SUB);assert not h.allocations
 # Every owned allocation failure unwinds without leaving a partial screen.
 probe=Harness(game);probe.start();attempts=probe.attempts;probe.call('QaCGearExit',SUB)
 for fail in range(1,attempts+1):
  x=Harness(game);x.fail=fail;x.start();x.call('QaCGearExit',SUB);assert not x.actors and not x.chars and not x.allocations,('leak',game,fail,x.allocations)
  assert x.word(0x4001000)==0x11710
 print(game,'touch, visibility, held suppression, layouts, uploads, allocation failures and cleanup passed')

if __name__=='__main__':
 for game in ['B','W']:run(game)
