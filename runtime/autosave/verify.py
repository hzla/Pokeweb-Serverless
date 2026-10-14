"""Execute both compiled profiles with controlled native event/save services."""
import struct,subprocess
from elftools.elf.elffile import ELFFile
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_THUMB,UC_HOOK_CODE
from unicorn.arm_const import *
from build import BUILD,TOOLS,address
SYS=0x02200000;FIELD=SYS+0x100;GAME=SYS+0x400;PLAYER=SYS+0x800;BG=SYS+0x1000;SUB=SYS+0x1500;EVENT=SYS+0x1800;WORK=SYS+0x1900;STRING=SYS+0x2000;WINDOW=SYS+0x2300;STOP=0x023f8000;STACK=0x023f0000
class Harness:
 def __init__(self,game):
  self.game=game;self.u=Uc(UC_ARCH_ARM,UC_MODE_THUMB);self.u.ctl_set_cpu_model(UC_CPU_ARM_946);self.u.mem_map(0x02000000,0x400000)
  elf=BUILD/f'{game}-test.elf';subprocess.run([str(TOOLS/'arm-none-eabi-g++'),'-nostdlib','-Wl,-Ttext=0x02300020,-Tbss=0x02320000,-eAutosaveRegister',str(BUILD/f'MapAutosave{game}.o'),'-o',str(elf)],check=True)
  with elf.open('rb')as f:
   e=ELFFile(f)
   for p in e.iter_segments():
    if p['p_type']=='PT_LOAD':self.u.mem_write(p['p_vaddr'],p.data()+bytes(p['p_memsz']-p['p_filesz']))
   self.symbols={s.name:s['st_value']for s in e.get_section_by_name('.symtab').iter_symbols()}
  self.functions={};self.nativeEvent=0;self.menu=0;self.overwrite=0;self.free=65536;self.wipe=1;self.ready=1;self.playerState=0;self.zoneChanged=0;self.saved=0;self.advances=0;self.saving=False;self.results=[];self.printed=[];self.allocated=set();self.failString=False;self.failWindow=False;self.failEvent=False;self.finishedPrint=1;self.closed=1
  def add(a,fn):self.functions[address(a,game)]=fn
  add(0x2153a28,lambda a:0);add(0x2016af0,lambda a:FIELD);add(0x2017750,lambda a:0)
  add(0x2016a80,lambda a:setattr(self,'callback',a[1])or 0)
  for n in(0x218189c,0x2181a68,0x2181cf0):add(n,lambda a:self.nativeEvent)
  add(0x2180b40,lambda a:self.zoneChanged)
  add(0x20178bc,lambda a:0);add(0x2027af8,lambda a:self.wipe);add(0x21983dc,lambda a:self.ready);add(0x219a6f8,lambda a:self.playerState)
  add(0x2017394,lambda a:GAME+0x80);add(0x21a0204,lambda a:self.menu);add(0x2017934,lambda a:GAME+0x40);add(0x200746c,lambda a:self.overwrite);add(0x2039fbc,lambda a:self.free)
  add(0x2016cb4,self.create);add(0x2016edc,lambda a:WORK);add(0x219a5d8,lambda a:0)
  add(0x2187c8c,lambda a:0);add(0x204855c,self.string);add(0x2048640,self.text);add(0x2187c3c,self.window);add(0x2187cb0,lambda a:self.finishedPrint);add(0x20095a0,lambda a:0)
  add(0x2017994,lambda a:GAME+0x60);add(0x201782c,self.save);add(0x2017850,self.advance)
  add(0x2188814,lambda a:0);add(0x2188834,lambda a:self.closed);add(0x2187c5c,self.freeWindow);add(0x2048590,self.freeString)
  self.put(FIELD+8,GAME);self.put(FIELD+0x24,SUB);self.put(FIELD+0x28,BG);self.put(FIELD+0x94,PLAYER);self.put(FIELD+0xd0,1);self.put(FIELD+0xe8,100,2);self.put(BG+0x15c,BG+0x300)
  self.u.hook_add(UC_HOOK_CODE,self.hook)
 def put(self,a,v,n=4):self.u.mem_write(a,int(v).to_bytes(n,'little'))
 def get(self,a,n=4):return int.from_bytes(self.u.mem_read(a,n),'little')
 def hook(self,u,a,size,user):
  if a not in self.functions:return
  args=[u.reg_read(r)for r in(UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3)]+[self.get(u.reg_read(UC_ARM_REG_SP)+i*4)for i in range(3)]
  v=self.functions[a](args);u.reg_write(UC_ARM_REG_R0,int(v or 0));u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
 def call(self,s,*args):
  a=self.symbols[s]if isinstance(s,str)else s
  self.u.reg_write(UC_ARM_REG_SP,STACK);self.u.reg_write(UC_ARM_REG_LR,STOP|1)
  for r,v in zip((UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3),args):self.u.reg_write(r,v)
  self.u.emu_start(a|1,STOP,count=100000);assert self.u.reg_read(UC_ARM_REG_PC)==STOP
  return self.u.reg_read(UC_ARM_REG_R0)
 def register(self,zone=100,callback=0x218189c):
  self.put(FIELD+0xe8,zone,2);self.call('AutosaveRegister',SYS,address(callback,self.game)|1,FIELD)
 def check(self):return self.call(self.callback,SYS,FIELD)
 def create(self,a):
  if self.failEvent:return 0
  assert a[0]==SYS and a[1]==0 and a[3]==24
  self.tick=a[2];return EVENT
 def string(self,a):
  if self.failString:return 0
  self.allocated.add(STRING);return STRING
 def text(self,a):
  chars=[]
  for i in range(64):
   v=self.get(a[1]+i*2,2)
   if v==65535:break
   chars.append(chr(v))
  self.printed.append(''.join(chars))
 def window(self,a):
  assert a[1]==0 and a[2:6]==[1,21,12,2]
  if self.failWindow:return 0
  self.allocated.add(WINDOW);return WINDOW
 def freeWindow(self,a):self.allocated.discard(a[0])
 def freeString(self,a):assert a[0]in self.allocated;self.allocated.remove(a[0])
 def save(self,a):assert a[0]==GAME;self.saved+=1;self.saving=True
 def advance(self,a):
  assert a[0]==GAME and self.saving,'native writer called after completion'
  self.advances+=1;result=self.results.pop(0)if self.results else 2
  if result>=2:self.saving=False
  return result
 def step(self):
  before=self.get(WORK+16);result=self.call(self.tick,EVENT,WORK+100,WORK)
  return result
 def finish(self):
  for i in range(200):
   if self.step():assert not self.allocated;return
  raise AssertionError('event did not complete')
for game in('B2','W2'):
 h=Harness(game);h.register();assert not h.check()and not h.saved
 h.register();assert not h.check() # Bag/Party reconstruction
 h.register(101);h.nativeEvent=0x2222222;assert h.check()==h.nativeEvent and not h.saved
 h.nativeEvent=0;h.wipe=0;assert not h.check();h.wipe=1;h.playerState=1;assert not h.check();h.playerState=3
 assert h.check()==EVENT;h.results=[0,0,1,2];h.finishedPrint=0;h.step();h.step();assert h.saved==0
 h.finishedPrint=1;h.finish();assert h.saved==1 and h.printed==['Saving...'];assert not h.check()
 for n in range(20):h.register(102+n);assert h.check()==EVENT;h.finish()
 assert h.saved==21
 # Native seamless-header hook; repeat native checks never produce duplicates.
 h.put(FIELD+0xe8,140,2);h.zoneChanged=1;assert h.call('AutosaveZone',FIELD)==1;h.zoneChanged=0
 h.call('AutosaveZone',FIELD);assert h.check()==EVENT;h.finish();assert not h.check()
 for menu in(1,4,5):
  h.menu=menu;h.register(150+menu);assert not h.check();h.menu=0;assert not h.check()
 h.menu=6;h.register(159);assert h.check()==EVENT;h.finish();h.menu=0
 h.register(158);h.call('AutosaveSnapshot',GAME);assert not h.check()
 h.overwrite=1;h.register(160);assert not h.check();h.overwrite=0;assert not h.check()
 for attr in('failEvent','failString','failWindow'):
  setattr(h,attr,True);h.register(h.get(FIELD+0xe8,2)+1);event=h.check()
  if event:h.finish()
  assert not h.allocated;setattr(h,attr,False);assert not h.check()
 h.register(169);h.call('AutosaveArrival',SYS,4);assert h.check()==EVENT;h.finish();h.register(169);assert not h.check()
 h.register(170);assert h.check()==EVENT;h.results=[3];h.finish();assert h.printed[-1]=='Save failed.'
 # Eight continuation steps per event tick, with unfinished work retained.
 h.register(171);assert h.check()==EVENT
 while h.get(WORK+16)!=2:h.step()
 h.results=[0]*17+[2];before=h.advances
 h.step();assert h.advances-before==8 and h.get(WORK+16)==2
 h.step();assert h.advances-before==16 and h.get(WORK+16)==2
 h.step();assert h.advances-before==18 and h.get(WORK+16)==3
 h.finish()
 # Both terminal results stop the batch immediately at every possible step.
 for result in(2,3):
  for terminal in range(1,9):
   h.register(h.get(FIELD+0xe8,2)+1);assert h.check()==EVENT
   while h.get(WORK+16)!=2:h.step()
   h.results=[0]*(terminal-1)+[result];before=h.advances
   h.step();assert h.advances-before==terminal and not h.results and not h.saving
   h.finish();assert h.advances-before==terminal
 print(game,'compiled native harness passed: eight-step bound, terminal handling, transitions, native priority, deferral, save/error lifecycle, ownership, repeated cleanup')
