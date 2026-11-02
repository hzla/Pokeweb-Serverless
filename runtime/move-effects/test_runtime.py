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
def effect(conditions=ALWAYS,value=8192,kind=1,phase=0,target=0,arg=0,secondary=0,parameters=(),chance=100):
 row=bytearray(bytes([kind,phase,target,secondary,chance,len(conditions)//8])+struct.pack('<HH',value&65535,arg)+bytes(22))
 for n,v in enumerate(parameters):struct.pack_into('<H',row,10+n*2,v)
 return bytes(row)+conditions
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
  self.blockedItem=False;self.itemGuard=False;self.knockCalls=0
  self.apiCount=self.symbols.get("MoveRuleApiEnd",0) or 64
  with elf.open('rb') as f:self.apiCount=next(s['st_size']//4 for s in ELFFile(f).get_section_by_name('.symtab').iter_symbols() if s.name=='MoveRuleApi')
  self.stats={};self.rawStats={};self.conditions={};self.items={};self.randomValue=0;self.pending=[];self.simulated=False;self.types={};self.species={};self.previous={};self.moves={};self.pps={};self.window=False;self.sideNodes={};self.nativeMatchup=2;self.matchupArguments=[];self.nativeSubstitute=1;self.thawArguments=[]
  for n in range(self.apiCount):self.put(self.symbols['MoveRuleApi']+n*4,STUB+n*4+1)
  self.put(self.symbols['MoveRuleData'],CONFIG)
  self.u.hook_add(UC_HOOK_CODE,self.hook)
 def put(self,p,v):self.u.mem_write(p,struct.pack('<I',v&0xffffffff))
 def hook(self,u,p,size,data):
  self.instructions+=1
  if p==STOP:u.emu_stop();return
  if p==STUB+0x400:
   self.put(u.reg_read(UC_ARM_REG_R0),1);u.reg_write(UC_ARM_REG_R0,FLOW+0x3000);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR));return
  if p==STUB+0x404:
   self.knockCalls+=1
   if not self.blockedItem and not self.itemGuard:self.items[self.vars[6]]=0
   u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR));return
  if STUB<=p<STUB+self.apiCount*4 and not (p-STUB)%4:
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
   elif index==5:value=self.stats.get(((a[0]-MON)//0x200,a[1]),{13:50,14:100,17:70}.get(a[1],6))
   elif index==6:
    one,two=self.types.get((a[0]-MON)//0x200,(11,3));value=one|(two<<8)
   elif index==7:value=a[1]in [a[0]&255,a[0]>>8]
   elif index==8:self.queries+=1;value=self.weather;assert self.queries<100,'Runaway weather queries'
   elif index==9:value=self.simulated
   elif index==10:value=FLOW+0x2000;self.u.mem_write(value,bytes(64));self.work.append((a[1],value));self.pending.append((a[1],a[2]))
   elif index==11:
    row=bytes(self.u.mem_read(a[1],32));self.popped.append(row);kind,owner=self.pending.pop()
    if kind==8:self.stats[(row[7],13)]=self.stats.get((row[7],13),50)+struct.unpack_from('<i',row,16)[0]
    if kind==11:self.conditions[(row[8],struct.unpack_from('<I',row,4)[0])]=False
    if kind==35:self.items[owner]=0
    if kind==12:self.conditions[(row[15],struct.unpack_from('<I',row,4)[0])]=True
    if kind==15:
     for n,stage in enumerate(row[5:12],1):self.stats[(row[4],n)]=stage
    if kind==17:
     for n in range(5):
      if row[15]&(1<<n):self.stats[(row[14],n+8)]=struct.unpack_from('<H',row,4+n*2)[0]
    if kind==7:self.stats[(row[6],13)]=max(0,self.stats.get((row[6],13),50)-struct.unpack_from('<H',row,4)[0])
    if kind==10:self.pps[(row[5],row[6])]=max(0,self.pps.get((row[5],row[6]),10)-row[4])
    if kind==14:
     stat=struct.unpack_from('<I',row,4)[0];delta=struct.unpack_from('<b',row,12)[0]
     for id in row[16:16+row[15]]:
      ability=self.stats.get((id,17),70);effective=-delta if ability==126 else delta*2 if ability==86 else delta
      self.stats[(id,stat)]=max(0,min(12,self.stats.get((id,stat),6)+effective))
   elif index==16:value=(a[0]<6)==(a[1]<6)
   elif index==18:value=a[1] in self.active
   elif index==19:value=(a[0]-MON)//0x200
   elif index==20:value=self.species.get((a[0]-MON)//0x200,1)
   elif index==22:assert a[1]==1;value=self.acted
   elif index==23:value=1
   elif index==17:value=self.conditions.get(((a[0]-MON)//0x200,a[1]),False)
   elif index==24:
    stage=self.stats.get(((a[0]-MON)//0x200,a[1]),6);delta=struct.unpack('<i',struct.pack('<I',a[2]))[0];value=stage<12 if delta>0 else stage>0
   elif index==31:value=1
   elif index==32:self.native+=1;value=123
   elif index==33:value=1
   elif index==34:value=1
   elif index==35:value=7
   elif index==36:value=8
   elif index==37:value=self.randomValue%a[0]
   elif index==38:value=self.items.get((a[0]-MON)//0x200,0)
   elif index==39:value=149<=a[0]<=212
   elif index==30:value=a[0]
   elif index==40:value=1 if a[0]<12 else 0
   elif index==41:value=0 if a[0]<12 else 1
   elif index==42:value=a[1]if a[1]<3 else a[1]-9
   elif index==43:value=self.rawStats.get(((a[0]-MON)//0x200,a[1]),self.stats.get(((a[0]-MON)//0x200,a[1]),6))
   elif index==44:value=self.previous.get((a[0]-MON)//0x200,0)
   elif index==45:value=self.moves.get(((a[0]-MON)//0x200,a[1]),0)
   elif index==46:value=self.pps.get(((a[0]-MON)//0x200,a[1]),0)
   elif index==47:self.window=True;self.put(a[3],1)
   elif index==48:self.window=False;self.put(a[3],0)
   elif index==49:self.vars[0x40]=0
   elif index==50:value=a[0]&255
   elif index==51:value=a[0]>>8
   elif index==52:value=a[0]|a[1]<<8
   elif index==53:value=self.sideNodes.get(a[1],0)
   elif index==54:self.u.mem_write(a[0]+0x1f2,bytes(2))
   elif index==55:value=0
   elif index in (56,57):pass
   elif index==58:self.u.mem_write(a[1]+0x1f2,bytes(2))
   elif index==59:
    self.matchupArguments.append((a[0],a[1],a[2],a[3],struct.unpack('<I',bytes(self.u.mem_read(u.reg_read(UC_ARM_REG_SP),4)))[0]));value=self.nativeMatchup
   elif index==60:value=self.nativeSubstitute
   elif index==61:self.thawArguments.append((a[0],bytes(self.u.mem_read(a[1],20)),a[2],a[3]))
   elif index==62:value=777
   elif index==63:self.u.mem_write(a[3]+6,bytes([13]))
   elif index==64:value=int(self.blockedItem)
   elif index==65:value=int(self.itemGuard)
   elif index==29:pass
   elif index==12:pass
   elif index==13:pass
   elif index in (14,15,28):self.vars[a[0]]=a[1]
   elif index not in (9,11,25,26,27):raise AssertionError(f'Unexpected native API {index}')
   u.reg_write(UC_ARM_REG_R0,value);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
 def install(self,count=1,conditions=ALWAYS,effects=None):self.u.mem_write(CONFIG,bytes(config(count,conditions,effects)))
 def call(self,name,owner=0,move=1,actor=None,missingMove=False):
  self.vars[2]=self.vars[3]=owner if actor is None else actor;self.vars[0x12]=move;self.vars[0x30]=40;self.powerWritten=False
  if missingMove:self.vars.pop(0x12)
  args=[0x02260000,FLOW,owner,FLOW+0x1000] if name.startswith('MoveEvent_') else [MON,move,0,0]
  if name=="MoveSheerForce":args=[move,0,0,0]
  if name=="MoveFlinchChance":args=[FLOW,move,MON,0]
  for reg,v in zip([UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3],args):self.u.reg_write(reg,v)
  self.u.reg_write(UC_ARM_REG_SP,STACK);self.u.reg_write(UC_ARM_REG_LR,STOP|1)
  before=self.instructions;self.u.emu_start(self.symbols[name]|1,STOP,count=50000)
  assert self.u.reg_read(UC_ARM_REG_PC)==STOP,'Runtime exceeded instruction budget'
  return self.instructions-before
 def matchup(self,defending=10,move=1,hook=False):
  for reg,v in zip([UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3],[FLOW,MON,MON+0x200,14]):self.u.reg_write(reg,v)
  self.u.reg_write(UC_ARM_REG_SP,STACK);self.put(STACK,defending);self.put(STACK+4,move)
  self.put(FLOW+0x500,move);self.u.reg_write(UC_ARM_REG_R5,FLOW+0x500);self.u.reg_write(UC_ARM_REG_LR,STOP|1)
  self.u.emu_start(self.symbols['MoveTypeMatchupHook' if hook else 'MoveTypeMatchup']|1,STOP,count=50000)
  assert self.u.reg_read(UC_ARM_REG_PC)==STOP
  return self.u.reg_read(UC_ARM_REG_R0)
 def substitute(self,move=1,hook=False):
  param=FLOW+0x500;self.put(param,move);self.u.reg_write(UC_ARM_REG_SP,STACK)
  for reg,v in zip([UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3],[MON+0x200,param,FLOW,MON]):self.u.reg_write(reg,v)
  self.put(STACK+0x20,param);self.put(STACK+0x14,FLOW);self.put(STACK+0x18,MON);self.u.reg_write(UC_ARM_REG_LR,STOP|1)
  self.u.emu_start(self.symbols['MoveDamagingSubstituteHook' if hook else 'MoveDamagingSubstitute']|1,STOP,count=50000)
  assert self.u.reg_read(UC_ARM_REG_PC)==STOP
  return self.u.reg_read(UC_ARM_REG_R0)
 def damage_weather(self,move=1,move_type=10,hook=False):
  param=FLOW+0x500;self.put(param,move);self.u.mem_write(param+6,bytes([move_type]));self.u.reg_write(UC_ARM_REG_SP,STACK)
  self.u.reg_write(UC_ARM_REG_R0,FLOW);self.u.reg_write(UC_ARM_REG_R1,param);self.u.reg_write(UC_ARM_REG_R4,param);self.u.reg_write(UC_ARM_REG_LR,STOP|1)
  self.u.emu_start(self.symbols['MoveDamageWeatherHook' if hook else 'MoveDamageWeather']|1,STOP,count=50000)
  assert self.u.reg_read(UC_ARM_REG_PC)==STOP
  return self.u.reg_read(UC_ARM_REG_R0)
 def thaw(self,move=1,move_type=4):
  param=FLOW+0x500;self.put(param,move);self.u.mem_write(param+6,bytes([move_type]));self.u.reg_write(UC_ARM_REG_SP,STACK)
  for reg,v in zip([UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3],[FLOW,param,MON,FLOW+0x600]):self.u.reg_write(reg,v)
  self.u.reg_write(UC_ARM_REG_LR,STOP|1);self.u.emu_start(self.symbols['MoveThawHitTargets']|1,STOP,count=50000)
  assert self.u.reg_read(UC_ARM_REG_PC)==STOP
  return self.u.mem_read(param+6,1)[0]
 def redirect(self,move=1,event=0x2a):
  self.vars[0x12]=move;self.u.reg_write(UC_ARM_REG_R0,FLOW);self.u.reg_write(UC_ARM_REG_R1,event);self.u.reg_write(UC_ARM_REG_SP,STACK);self.u.reg_write(UC_ARM_REG_LR,STOP|1)
  self.u.emu_start(self.symbols['MoveRedirectEvent']|1,STOP,count=50000);assert self.u.reg_read(UC_ARM_REG_PC)==STOP
 def attack_stat(self,move=1,original=8,critical=False,hook=False):
  param=FLOW+0x500;self.put(param,move);self.u.reg_write(UC_ARM_REG_SP,STACK);self.u.reg_write(UC_ARM_REG_R5,param);self.u.reg_write(UC_ARM_REG_R7,FLOW)
  args=[MON,original,param,FLOW] if critical else [FLOW,0x39,param,original]
  for reg,v in zip([UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3],args):self.u.reg_write(reg,v)
  self.u.reg_write(UC_ARM_REG_R4,original);self.u.reg_write(UC_ARM_REG_LR,STOP|1)
  name=('MoveCriticalStatHook' if hook else 'MoveCriticalAttackStat') if critical else ('MoveAttackStatHook' if hook else 'MoveAttackStatSelector')
  self.u.emu_start(self.symbols[name]|1,STOP,count=50000);assert self.u.reg_read(UC_ARM_REG_PC)==STOP
  return self.u.reg_read(UC_ARM_REG_R4 if hook and not critical else UC_ARM_REG_R0)
 def resolve_user_type(self,move=1,types=(11,3),roost=False):
  param=FLOW+0x500;self.u.mem_write(param,bytes(20));self.u.mem_write(MON+0xf8,bytes(types));self.conditions[(0,24)]=roost
  for reg,v in zip([UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3],[FLOW,move,MON,param]):self.u.reg_write(reg,v)
  self.u.reg_write(UC_ARM_REG_SP,STACK);self.u.reg_write(UC_ARM_REG_LR,STOP|1);self.u.emu_start(self.symbols['MoveResolveUserType']|1,STOP,count=50000);assert self.u.reg_read(UC_ARM_REG_PC)==STOP
  return self.u.mem_read(param+6,1)[0]

def run():
 h=Harness();h.install(effects=[effect(kind=41,phase=4,value=50)]);h.call('MoveEvent_03');h.vars[4]=12;h.vars[0x32]=60;h.stats[(12,17)]=64;h.call('MoveEvent_4b');h.vars[4]=13;h.vars[0x32]=27;h.call('MoveEvent_4b');h.call('MoveEvent_4d')
 assert [(struct.unpack_from('<H',p,4)[0],p[7]) for p in h.popped]==[(30,12),(13,13)],'Each hit drains with floor rounding, processing Liquid Ooze first'
 h.call('MoveEvent_4d');assert len(h.popped)==2,'Drain records cannot be applied twice'
 h=Harness();h.install(conditions=leaf(3,1),effects=[effect(kind=41,phase=4,value=50)]);h.call('MoveEvent_03');h.vars[4]=12;h.vars[0x32]=60;h.call('MoveEvent_4b');h.call('MoveEvent_4d');assert not h.popped and h.queries==1,'Only a relevant hit evaluates its conditions'
 h=Harness();h.install(effects=[effect(kind=40,phase=11,value=0)]);assert h.resolve_user_type(types=(11,3))==11 and h.calls.get(63)==1,'The user type runs after ordinary move parameter modifiers'
 assert h.resolve_user_type(types=(2,11),roost=True)==11 and h.resolve_user_type(types=(2,2),roost=True)==0,'Roost removes Flying and preserves the pure-Flying fallback'
 assert h.resolve_user_type(types=(17,17))==17 and h.resolve_user_type(move=2)==13,'Typeless and unconfigured moves retain their proper type'
 h.install(effects=[effect(kind=40,phase=11,value=1)]);assert h.resolve_user_type(types=(11,3))==3,'The second type is selectable'
 h=Harness();h.install(effects=[effect(kind=39,phase=1,value=2)]);assert h.attack_stat(hook=True)==9 and h.calls.get(29)==1,'Native attack events must precede the selected stat'
 h.stats[(0,2)]=4;h.rawStats[(0,9)]=140;h.stats[(0,9)]=70;assert h.attack_stat(original=9,critical=True,hook=True)==140,'Critical attacks ignore negative Defense stages'
 h.stats[(0,2)]=8;h.stats[(0,9)]=280;assert h.attack_stat(original=9,critical=True)==280,'Critical attacks preserve positive Defense stages'
 assert h.attack_stat(move=2,original=9,critical=True)==777,'Unconfigured moves retain the native critical reader'
 h=Harness();h.install(effects=[effect(kind=38,phase=11,value=1)]);h.redirect();assert h.calls.get(29,0)==0,'A configured move skips the redirection event'
 h.redirect(move=2);h.redirect(event=0x29);assert h.calls.get(29,0)==2,'Other moves and events keep native dispatch'
 h=Harness();h.install(conditions=leaf(3,1),effects=[effect(kind=38,phase=11,value=1)]);h.redirect();assert h.calls.get(29,0)==1 and h.queries==1
 h.redirect(move=2);assert h.calls.get(29,0)==2 and h.queries==1,'Unconfigured redirection does not query weather'
 h=Harness();h.install(effects=[effect(kind=37,phase=5,value=1)]);assert h.thaw()==4 and h.thawArguments[-1][1][6]==9,'Thaw uses a temporary Fire parameter without changing the move type'
 assert h.thaw(move=2)==4 and h.thawArguments[-1][1][6]==4,'An unconfigured move retains its original type'
 h=Harness();h.install(conditions=leaf(3,1),effects=[effect(kind=37,phase=5,value=1)]);assert h.thaw()==4 and h.thawArguments[-1][1][6]==4 and h.queries==1
 h=Harness();h.weather=1;h.install(conditions=leaf(3,1),effects=[effect(kind=36,phase=1,value=1,arg=2,parameters=(10,))]);assert h.damage_weather(hook=True)==2 and h.queries==1,'The native weather is queried once and reused for conditions'
 assert h.damage_weather(move_type=9)==1 and h.damage_weather(move=2)==1 and h.queries==3,'Wrong type and unconfigured moves retain the native weather'
 h.weather=0;assert h.damage_weather()==0 and h.queries==4,'Suppressed weather cannot activate the modifier'
 h=Harness();h.install(effects=[effect(kind=28,phase=11,value=1)]);assert h.substitute(hook=True)==0 and h.substitute(move=2)==1,'The hook must bypass only the configured move'
 h.nativeSubstitute=0;assert h.substitute()==0,'A missing Substitute stays absent'
 h=Harness();h.install(conditions=leaf(3,1),effects=[effect(kind=28,phase=11,value=1)]);assert h.substitute()==1 and h.queries==1
 assert h.substitute(move=2)==1 and h.queries==1,'Unconfigured moves do not query weather'
 h=Harness();h.install(effects=[effect(kind=35,phase=1,target=1,value=10,arg=4)])
 assert h.matchup(hook=True)==4 and h.matchupArguments[-1]==(FLOW,MON,MON+0x200,14,10),'Hook must preserve the native matchup arguments and override only the configured type'
 assert h.matchup(defending=3)==2 and h.matchup(move=2)==2,'Unmatched types and moves retain the native grade'
 h.nativeMatchup=0;assert h.matchup()==0,'Existing immunity is preserved'
 h=Harness();h.install(conditions=leaf(3,1),effects=[effect(kind=35,phase=1,target=1,value=10,arg=4)]);assert h.matchup()==2 and h.queries==1
 assert h.matchup(defending=3)==2 and h.queries==1,'Unmatched types do not query weather'
 h=Harness();h.vars[0x51]=0;h.install(effects=[effect(kind=34,phase=11,target=1,value=1,arg=2)])
 h.call('MoveEvent_30',missingMove=True);assert h.vars[0x51]==1,'An ally enters the native damage-to-recovery branch'
 h.call('MoveEvent_31',missingMove=True);assert h.work==[(5,FLOW+0x2000)] and struct.unpack_from('<H',h.popped[-1],4)[0]==50 and h.popped[-1][6]==1,'The accepted ally receives the requested HP fraction'
 h.call('MoveEvent_31',missingMove=True);assert len(h.work)==1,'The recovery marker is consumed'
 h=Harness();h.vars[4]=12;h.vars[0x51]=0;h.install(effects=[effect(kind=34,phase=11,target=1,value=1,arg=2)]);h.call('MoveEvent_30',missingMove=True);h.call('MoveEvent_31',missingMove=True);assert not h.vars[0x51] and not h.work,'Opponents remain on the damage path'
 h=Harness();h.vars[0x51]=0;h.install(conditions=leaf(3,1),effects=[effect(kind=34,phase=11,target=1,value=1,arg=2)]);h.call('MoveEvent_30',missingMove=True);h.call('MoveEvent_31',missingMove=True);assert not h.vars[0x51] and not h.work and h.queries==1,'A failed weather condition cannot trigger recovery or requery at recovery'
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
 # Costs and benefits go through actual compiled work-layout writes.
 h=Harness();h.install(effects=[effect(kind=14,phase=6,value=1,arg=31,parameters=(33,100))]);h.call('MoveEvent_a0')
 assert h.stats[(0,13)]==17 and [h.stats[(0,s)]for s in range(1,6)]==[7]*5
 assert [kind for kind,_ in h.work]==[8,14,14,14,14,14,33]
 h=Harness();h.stats[(0,13)]=33;h.install(effects=[effect(kind=14,phase=6,value=1,arg=31,parameters=(33,100))]);h.call('MoveEvent_a0');assert not h.work,'HP must remain strictly above the cost'
 h=Harness();h.stats.update({(0,s):12 for s in range(1,6)});h.install(effects=[effect(kind=14,phase=6,value=1,arg=31,parameters=(33,100))]);h.call('MoveEvent_a0');assert not h.work,'Capped benefits must not charge HP'
 h=Harness();h.stats[(0,17)]=126;h.install(effects=[effect(kind=14,phase=6,value=2,arg=21,parameters=(1,2))]);h.stats[(0,13)]=51;h.call('MoveEvent_a0');assert h.stats[(0,13)]==1 and [h.stats[(0,s)]for s in [1,3,5]]==[4]*3
 h=Harness();h.install(effects=[effect(kind=16,phase=6,target=1,value=1,arg=2)]);h.vars[5]=1;h.vars[6]=1;h.call('MoveEvent_a0');assert not h.work,'Purify must not heal without a cure'
 h.conditions[(1,4)]=True;h.call('MoveEvent_a0');assert [kind for kind,_ in h.work]==[11,5] and not h.conditions[(1,4)]
 h=Harness();h.items[0]=158;h.install(effects=[effect(kind=18,phase=6,value=2,arg=2)]);h.call('MoveEvent_a0');assert h.stats[(0,2)]==8 and h.items[0]==0 and [kind for kind,_ in h.work]==[14,35,34,59]
 assert h.popped[-2][0:4]==bytes([0,0,0,1])and struct.unpack_from('<H',h.popped[-2],6)[0]==158,'Forced use must receive the original Berry and fail-skip flag'
 h=Harness();h.items[0]=158;h.stats[(0,2)]=12;h.install(effects=[effect(kind=18,phase=6,value=2,arg=2)]);h.call('MoveEvent_a0');assert not h.work and h.items[0]==158,'Capped benefits must not consume the Berry'
 h=Harness();h.stats[(1,8)]=90;h.install(effects=[effect(kind=15,phase=6,target=1,value=1,arg=1,parameters=(1,))]);h.call('MoveEvent_a0');assert [k for k,_ in h.work]==[6,59]and struct.unpack_from('<H',h.popped[0],4)[0]==90 and h.popped[0][6:8]==bytes([0,1]) and h.calls[56]==h.calls[57]==1
 for draw,status in enumerate([1,2,5]):
  h=Harness();h.randomValue=draw;h.install(effects=[effect(kind=13,phase=4,target=1,value=19,secondary=1)]);h.vars[0x32]=10;h.call('MoveEvent_4b');assert struct.unpack_from('<I',h.popped[0],4)[0]==status and h.calls[37]==1,'Choose one enabled status without rerolling'
 h=Harness();h.install(effects=[effect(kind=19,phase=8,value=6,arg=1)]);h.call('MoveEvent_4d');assert h.work[0][0]==25 and struct.unpack_from('<II',h.popped[0],4)==(6,1)and h.popped[0][12]==1 and h.calls[56]==h.calls[57]==1
 h=Harness();node=FLOW+0x3000;h.sideNodes[0]=node;h.put(node+16,2);h.u.mem_write(node+0x38,bytes([6,0,0]));h.install(effects=[effect(kind=30,phase=6,value=1,arg=7)]);h.call('MoveEvent_a0');assert h.popped[0][4:8]==bytes([3,64,0,0]),'Side removal must use native flag layout'
 h=Harness();h.u.mem_write(MON+0x1f2,bytes([10,0]));h.install(effects=[effect(kind=30,phase=6,value=1,arg=0,parameters=(1,))]);h.call('MoveEvent_a0');assert h.calls.get(58)==1 and bytes(h.u.mem_read(MON+0x1f2,2))==bytes(2),'Substitute cleanup must use the native visual sequence'
 h=Harness();h.install(effects=[effect(kind=20,phase=9,target=1,value=22)]);h.call('MoveEvent_83');assert h.conditions[(1,22)]and struct.unpack_from('<I',h.popped[0],8)[0]==3 and h.calls[56]==h.calls[57]==1
 h=Harness();h.types[0]=(9,9);h.install(effects=[effect(kind=21,phase=10,value=9,arg=1)]);h.call('MoveEvent_25');assert struct.unpack_from('<H',h.popped[0],4)[0]==17|(17<<8),'Clean type removal must use native no-type'
 h=Harness();h.types[0]=(9,9);h.install(effects=[effect(kind=21,phase=10,value=9,arg=1)]);h.u.mem_write(CONFIG+3,bytes([18]));h.call('MoveEvent_25');assert struct.unpack_from('<H',h.popped[0],4)[0]==18|(18<<8),'Fairy type removal must use its own no-type'
 h=Harness();h.types[1]=(10,10);h.stats[(1,17)]=121;h.install(effects=[effect(kind=21,phase=6,target=1,value=13)]);h.call('MoveEvent_a0');assert not h.work,'Multitype prevents type replacement'
 h=Harness();h.types[1]=(13,13);h.install(effects=[effect(kind=21,phase=6,target=1,value=13)]);h.call('MoveEvent_a0');assert not h.work,'Replacing an identical type must not succeed'
 h=Harness();h.stats.update({(0,12):80,(1,12):140});h.install(effects=[effect(kind=22,phase=6,target=1,value=5)]);h.call('MoveEvent_a0');assert h.stats[(0,12)]==140 and h.stats[(1,12)]==80 and h.calls[56]==h.calls[57]==1
 h=Harness();h.stats[(1,1)]=9;h.stats[(1,2)]=4;h.stats[(0,17)]=126;h.install(effects=[effect(kind=23,phase=11,target=1,value=127)]);h.call('MoveEvent_46');assert h.stats[(1,1)]==6 and h.stats[(1,2)]==4 and h.stats[(0,1)]==3,'Steal only positive stages and honor the user’s Contrary'
 h=Harness();h.previous[1]=150;h.moves[(1,2)]=150;h.pps[(1,2)]=2;h.vars[0x32]=10;h.install(effects=[effect(kind=26,phase=4,target=1,value=3,secondary=1)]);h.call('MoveEvent_4b');assert h.pps[(1,2)]==0 and h.popped[0][4:7]==bytes([2,1,2])
 h=Harness();h.install(conditions=weather,effects=[effect(kind=27,phase=12,value=1)]);h.call('MoveEvent_03');assert h.window and h.queries==1;h.weather=2;h.call('MoveEvent_04');assert not h.window and h.queries==1,'Always close the native ability window after conditions change'
 h=Harness();h.install(conditions=weather,effects=[effect(kind=31,phase=13,value=1,arg=2,parameters=(0,0))]);h.call('MoveEvent_03');h.call('MoveEvent_25');h.call('MoveEvent_26');assert h.queries==0 and not h.work;h.call('MoveEvent_04');assert h.queries==1 and [k for k,_ in h.work]==[7];h.call('MoveEvent_04');assert len(h.work)==1,'Recoil must occur once per sequence'
 h=Harness();h.install(effects=[effect(kind=31,phase=13,value=1,arg=2,parameters=(1,1))]);h.call('MoveEvent_03');h.call('MoveEvent_25');h.call('MoveEvent_04');assert not h.work,'Hit-only recoil must not activate on an attempted attack';h.call('MoveEvent_03');h.call('MoveEvent_45');h.call('MoveEvent_04');assert [k for k,_ in h.work]==[7]
 h=Harness();h.simulated=True;h.vars[0x32]=10;h.install(effects=[effect(kind=13,phase=4,target=1,value=19,secondary=1)]);h.call('MoveEvent_4b');assert not h.work and not h.calls.get(37),'Preview must neither roll status selection nor apply effects'
 h=Harness();h.install(effects=[effect(kind=32,phase=11,target=1,value=1)]);h.put(FLOW+0x1000+24,1);h.call('MoveEvent_2d');assert not h.calls.get(38) and 0x40 not in h.vars,'Nested type-absorption checks must not re-run held-item eligibility'
 h.put(FLOW+0x1000+24,0);h.call('MoveEvent_2d');assert h.calls.get(38)==1 and h.vars[0x40]==1,'Actual target eligibility still fails without an item'
 h=Harness();h.items[1]=158;h.install(effects=[effect(kind=32,phase=11,target=1,value=1)]);h.call('MoveEvent_03');h.call('MoveEvent_2d');h.items[1]=0;h.call('MoveEvent_2d');h.call('MoveEvent_46');h.call('MoveEvent_46');assert [k for k,_ in h.work]==[4] and h.calls[56]==1 and h.calls[57]==2,'Announce the original item once, even after it is removed'
 counts=[]
 for count in [1,100]:
  h=Harness();h.install(count,weather);n=h.call('MoveEvent_37');counts.append(n);assert h.queries==1
 assert counts[1]<counts[0]+300,(counts,'Lookup must not scan installed recipes')
 h=Harness();h.install(100,weather);n=h.call('MoveDispatch',move=1000);assert h.native==1 and h.queries==0 and n<400
 print(json.dumps({'passed':True,'weatherQueriesForFourActors':4,'queriesForUnrelatedEvents':0,'queriesPerEvaluationWith16Effects':1,'instructionsFor1And100Definitions':counts,'unconfiguredDispatchInstructions':n}))
if __name__=='__main__':run()

# Modern Knock Off is a composed primary effect, with no per-battle observers.
if Harness().apiCount>=65:
 for held,blocked,ratio,wanted in [(0,False,6144,40),(234,False,6144,60),(234,True,6144,40),(234,False,10240,100)]:
  h=Harness();h.items[1]=held;h.nativeSubstitute=0;h.blockedItem=blocked;h.install(effects=[effect(kind=59,value=ratio,target=1)])
  h.call('MoveEvent_37');assert h.vars[0x30]==wanted,(held,blocked,ratio,h.vars)
  assert h.items.get(1,0)==held and h.queries==0
  h.put(h.symbols['MoveNativeIds'],282);h.put(h.symbols['MoveNativeGetters'],STUB+0x401)
  h.put(FLOW+0x3000,0x83);h.put(FLOW+0x3004,STUB+0x405)
  h.vars.update({5:1,6:1});h.call('MoveEvent_83')
  assert h.knockCalls==1 and h.items[1]==(held if blocked else 0)
 for sequence in [[effect(kind=1,value=8192),effect(kind=59,value=6144,target=1)],[effect(kind=59,value=6144,target=1),effect(kind=1,value=8192)]]:
  h=Harness();h.items[1]=234;h.nativeSubstitute=0;h.install(effects=sequence);h.call('MoveEvent_37');assert h.vars[0x30]==120
 h=Harness();h.items[1]=234;h.nativeSubstitute=0;h.install(count=100,effects=[effect(kind=59,value=6144,target=1)]);h.simulated=True;h.call('MoveEvent_37');assert h.vars[0x30]==60
 h.vars.update({5:1,6:1});h.call('MoveEvent_83');assert h.knockCalls==0 and h.items[1]==234
 print('Modern Knock Off: empty/blocked/removable items, adjusted power, ordering, preview and 100 definitions passed.')

if Harness().apiCount>=66:
 h=Harness();h.items[1]=234;h.nativeSubstitute=0;h.itemGuard=True;h.install(effects=[effect(kind=59,value=6144,target=1)]);h.call('MoveEvent_37');assert h.vars[0x30]==40
 print('Native item-change prevention also vetoes the bonus.')

if Harness().apiCount>=66:
 h=Harness();h.items[1]=234;h.install(effects=[effect(kind=59,value=6144,target=1)]);h.call('MoveEvent_37');assert h.vars[0x30]==40
 print('Substitute prevents the power bonus.')

if Harness().apiCount>=66:
 h=Harness();h.items[1]=234;h.nativeSubstitute=0;h.install(effects=[effect(kind=59,value=6144,target=1)]);h.call("MoveEvent_03");h.call("MoveEvent_37");h.stats[(1,13)]=0;h.vars.update({5:1,6:1})
 h.put(h.symbols['MoveNativeIds'],282);h.put(h.symbols['MoveNativeGetters'],STUB+0x401);h.put(FLOW+0x3000,0x83);h.put(FLOW+0x3004,STUB+0x405)
 h.call('MoveEvent_83');assert h.knockCalls==1 and h.items[1]==0
 print('Knockout recipients still use the native Knock Off callback.')

if Harness().apiCount>=66:
 for before,after,comparison,expected in [(100,50,3,True),(100,50,1,False)]:
  h=Harness();h.items[1]=234;h.nativeSubstitute=0;h.stats[(1,13)]=before
  h.install(effects=[effect(kind=59,value=6144,target=1,conditions=leaf(1,100 if comparison==3 else 50,subject=1,comparison=comparison))])
  h.put(h.symbols['MoveNativeIds'],282);h.put(h.symbols['MoveNativeGetters'],STUB+0x401);h.put(FLOW+0x3000,0x83);h.put(FLOW+0x3004,STUB+0x405)
  h.call('MoveEvent_03');h.call('MoveEvent_37');h.stats[(1,13)]=after;h.vars.update({5:1,6:1});h.call('MoveEvent_83')
  assert h.knockCalls==int(expected) and h.items[1]==(0 if expected else 234)
  h.items[1]=234;h.call('MoveEvent_04');h.call('MoveEvent_83');assert h.items[1]==234
 print('Knock Off freezes activation at power timing and clears it between actions.')
