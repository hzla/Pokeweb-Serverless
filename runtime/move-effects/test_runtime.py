"""Execute compiled Thumb code with counted native services; no ROM or DS gameplay claim."""
from pathlib import Path
import json
import struct
import subprocess
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import *
HERE=Path(__file__).resolve().parent
TOOLS=HERE.parents[2]/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'
CODE=0x02300000; CONFIG=0x02200000; MON=0x02240000; FLOW=0x02250000; STOP=0x023f8000; STACK=0x023f0000; STUB=0x02000000
elf=HERE/'build/test.elf'
subprocess.run([str(TOOLS/'arm-none-eabi-gcc'),'-nostdlib','-Wl,-Ttext=0x02300000,-Tbss=0x02320000,-eMoveDispatch',str(HERE/'build/rules.o'),'-o',str(elf)],check=True)
def leaf(code,value=0,subject=0,comparison=0):return bytes([code,subject,comparison,0])+struct.pack('<H',value&65535)+bytes(2)
def group(mode,*children):return bytes([128 if mode=='all' else 129,len(children),0,0,0,0,0,0])+b''.join(children)
ALWAYS=group('all')
def effect(conditions=ALWAYS,value=8192,kind=1,phase=0,target=0,arg=0,secondary=0):
 return bytes([kind,phase,target,secondary,100,len(conditions)//8])+struct.pack('<HH',value,arg)+bytes(22)+conditions
def config(count,conditions=ALWAYS,effects=None):
 effects=effects or [effect()];rows=bytearray(struct.pack('<HH',count,1)+bytes(count*16))
 for move in range(1,count+1):
  at=len(rows);struct.pack_into('<HHIII',rows,4+(move-1)*16,move,1,at,0,0)
  rows+=bytes([len(effects),len(conditions)//8,1,0,0,0,0,0])+conditions+ALWAYS+b''.join(effects)
 return rows
class Harness:
 def __init__(self):
  self.u=Uc(UC_ARCH_ARM,UC_MODE_THUMB);self.u.ctl_set_cpu_model(UC_CPU_ARM_946);self.u.mem_map(0x02000000,0x400000)
  with elf.open('rb') as f:
   e=ELFFile(f)
   for p in e.iter_segments():
    if p['p_type']=='PT_LOAD':self.u.mem_write(p['p_vaddr'],p.data()+bytes(p['p_memsz']-p['p_filesz']))
   self.symbols={s.name:s['st_value'] for s in e.get_section_by_name('.symtab').iter_symbols()}
  self.powerWritten=False;self.vars={3:0,4:1,0x12:1,0x30:40};self.queries=0;self.weather=3;self.acted=False;self.instructions=0;self.native=0;self.calls={};self.work=[];self.popped=[];self.active={0,1,12,13}
  for n in range(37):self.put(self.symbols['MoveRuleApi']+n*4,STUB+n*4+1)
  self.put(self.symbols['MoveRuleData'],CONFIG)
  self.u.hook_add(UC_HOOK_CODE,self.hook)
 def put(self,p,v):self.u.mem_write(p,struct.pack('<I',v&0xffffffff))
 def hook(self,u,p,size,data):
  self.instructions+=1
  if p==STOP:u.emu_stop();return
  if STUB<=p<STUB+37*4 and not (p-STUB)%4:
   index=(p-STUB)//4;self.calls[index]=self.calls.get(index,0)+1
   a=[u.reg_read(r) for r in [UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3]];value=0
   if index==0:
    assert a[0] in self.vars,f'Unexpected event variable {a[0]:x}';value=self.vars[a[0]]
   elif index==1:
    value=int(a[0] in self.vars)
    if value:self.put(a[1],self.vars[a[0]])
   elif index==2:
    if a[0]==0x30:
     assert not self.powerWritten,'Native power variable is writable once';self.powerWritten=True
    self.vars[a[0]]=a[1]
   elif index==3:self.vars[a[0]]=self.vars[a[0]]*a[1]//4096
   elif index==4:value=MON+a[1]*0x200
   elif index==5:value={13:50,14:100,17:70}.get(a[1],6)
   elif index==8:self.queries+=1;value=self.weather;assert self.queries<100,'Runaway weather queries'
   elif index==10:value=FLOW+0x2000;self.u.mem_write(value,bytes(64));self.work.append((a[1],value))
   elif index==11:self.popped.append(bytes(self.u.mem_read(a[1],32)))
   elif index==16:value=(a[0]<6)==(a[1]<6)
   elif index==18:value=a[1] in self.active
   elif index==19:value=(a[0]-MON)//0x200
   elif index==22:assert a[1]==1;value=self.acted
   elif index==23:value=1
   elif index==24:value=1
   elif index==31:value=1
   elif index==32:self.native+=1;value=123
   elif index==33:value=1
   elif index==34:value=1
   elif index==35:value=7
   elif index==36:value=8
   elif index not in (9,11,17,25,26,27):raise AssertionError(f'Unexpected native API {index}')
   u.reg_write(UC_ARM_REG_R0,value);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
 def install(self,count=1,conditions=ALWAYS,effects=None):self.u.mem_write(CONFIG,bytes(config(count,conditions,effects)))
 def call(self,name,owner=0,move=1,actor=None,missingMove=False):
  self.vars[3]=owner if actor is None else actor;self.vars[0x12]=move;self.vars[0x30]=40;self.powerWritten=False
  if missingMove:self.vars.pop(0x12)
  args=[0x02260000,FLOW,owner,FLOW+0x1000] if name.startswith('MoveEvent_') else [MON,move,0,0]
  if name=="MoveSheerForce":args=[move,0,0,0]
  if name=="MoveFlinchChance":args=[FLOW,move,MON,0]
  for reg,v in zip([UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3],args):self.u.reg_write(reg,v)
  self.u.reg_write(UC_ARM_REG_SP,STACK);self.u.reg_write(UC_ARM_REG_LR,STOP|1)
  before=self.instructions;self.u.emu_start(self.symbols[name]|1,STOP,count=50000)
  assert self.u.reg_read(UC_ARM_REG_PC)==STOP,'Runtime exceeded instruction budget'
  return self.instructions-before

def run():
 h=Harness();weather=leaf(3,3)
 h.install(conditions=group('all',weather,weather),effects=[effect(weather) for _ in range(16)])
 h.call('MoveEvent_37');assert h.calls.get(4,0)==0,'Weather leaves must not look up Pokemon';assert h.queries==1,(h.queries,'One weather snapshot per evaluation')
 h.weather=2;h.call('MoveEvent_37');assert h.queries==2 and h.vars[0x30]==40,'Fresh weather on next callback'
 h=Harness();h.install(conditions=group('all',leaf(1,10,comparison=0),weather));h.call('MoveEvent_37');assert h.queries==0 and h.vars[0x30]==40,'Short circuit AND'
 h.install(conditions=group('any',leaf(1,90,comparison=0),weather));h.call('MoveEvent_37');assert h.queries==0 and h.vars[0x30]==80,'Short circuit OR'
 h=Harness();h.install(conditions=weather)
 for name in ['MoveEvent_6e','MoveEvent_70','MoveEvent_7a','MoveEvent_47','MoveEvent_32']:h.call(name)
 h.call('MoveEvent_37',owner=6,actor=0);h.call('MoveEvent_37',move=2)
 assert h.queries==0,'Reject irrelevant events, owner and move before queries'
 h=Harness();h.install(effects=[effect(),effect(weather,kind=10,phase=1,value=1)]);h.call('MoveEvent_37');assert h.queries==0,'Mixed recipes must not evaluate another primitive at the wrong timing'
 h=Harness();h.install(conditions=weather,effects=[effect(kind=3,phase=2,value=1)]);h.call('MoveEvent_32',missingMove=True);assert h.queries==1 and h.vars[0x51]==1,'Retail accuracy frame has no move ID'
 h=Harness();h.install(conditions=weather,effects=[effect(kind=10,phase=1,value=1)]);h.call('MoveEvent_3a',missingMove=True);assert h.queries==1 and h.vars[0x51]==1;h.call('MoveEvent_33',missingMove=True);assert h.queries==2 and h.vars[0x4b]==1
 h=Harness();h.install(conditions=weather);h.call('MoveEvent_37',missingMove=True);assert h.queries==0,'Other frames still require the actual move ID'
 h=Harness();h.install(conditions=weather)
 for actor in [0,1,12,13]:
  h.call('MoveEvent_37',owner=actor)
  # Native weather observers cannot reactivate the power primitive.
  for observer in [0,1,12,13]:h.call('MoveEvent_6e',owner=observer);h.call('MoveEvent_70',owner=observer);h.call('MoveEvent_7a',owner=observer)
 assert h.queries==4,'Doubles must remain linear in active evaluations'
 h=Harness();h.install(effects=[effect(kind=5,phase=5,value=1) for _ in range(16)]);h.call('MoveEvent_84');assert h.calls.get(18,0)==16,'Self effects must not scan 24 battlers'
 h=Harness();h.install(effects=[effect(kind=5,phase=5,target=4,value=1) for _ in range(16)]);h.call('MoveEvent_84');assert h.calls.get(18,0)==24+16*4,'All-battler effects share a single active-battler snapshot'
 h=Harness();h.install(conditions=leaf(9,0,subject=1));h.call('MoveEvent_37');assert h.vars[0x30]==80;h.acted=True;h.call('MoveEvent_37');assert h.vars[0x30]==40,'Action-done flag must be checked at each hit'
 h=Harness();h.install(effects=[effect(value=32768) for _ in range(16)]);h.call('MoveEvent_37');assert h.vars[0x30]==65535,'Power compositions must saturate instead of overflowing'
 h=Harness();h.install(effects=[effect(kind=4,phase=6,target=4,value=1,arg=2)]);h.call('MoveEvent_a0');assert len(h.popped)==1 and h.popped[0][15]==4 and set(h.popped[0][16:20])=={0,1,12,13},'Batch one stat effect across eligible battlers'
 h=Harness();h.install(effects=[effect(leaf(11,1,subject=1)) for _ in range(16)]);h.call('MoveEvent_37');assert h.calls.get(26,0)==1,'Grounding queries must share a recipient snapshot'
 h=Harness();h.install(effects=[effect(kind=12,phase=4,value=0,secondary=1)]);h.call('MoveSheerForce');assert h.u.reg_read(UC_ARM_REG_R0)==0;h.call('MoveFlinchChance');assert h.u.reg_read(UC_ARM_REG_R0)==8
 h.install(effects=[effect(kind=12,phase=4,value=100,secondary=1)]);h.call('MoveSheerForce');assert h.u.reg_read(UC_ARM_REG_R0)==1;h.call('MoveFlinchChance');assert h.u.reg_read(UC_ARM_REG_R0)==0
 counts=[]
 for count in [1,100]:
  h=Harness();h.install(count,weather);n=h.call('MoveEvent_37');counts.append(n);assert h.queries==1
 assert counts[1]<counts[0]+300,(counts,'Lookup must not scan installed recipes')
 h=Harness();h.install(100,weather);n=h.call('MoveDispatch',move=1000);assert h.native==1 and h.queries==0 and n<400
 print(json.dumps({'passed':True,'weatherQueriesForFourActors':4,'queriesForUnrelatedEvents':0,'queriesPerEvaluationWith16Effects':1,'instructionsFor1And100Definitions':counts,'unconfiguredDispatchInstructions':n}))
if __name__=='__main__':run()
