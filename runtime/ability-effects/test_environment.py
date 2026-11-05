"""Current shipped ARM entry/indirect-damage primitives with isolated native APIs.
These are CPU tests; the separate battle fixtures exercise native gameplay.
"""
import json, struct, subprocess
from pathlib import Path
from elftools.elf.elffile import ELFFile
import test_compact as base
from unicorn import UC_HOOK_CODE
from unicorn.arm_const import UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3,UC_ARM_REG_SP,UC_ARM_REG_LR
ROOT=Path(__file__).resolve().parents[2];BUILD=ROOT/'runtime/ability-effects/build'
base.BUNDLES=json.loads((ROOT/'src/assets/data/abilityRuleRuntimeStrikes.json').read_text())
TOOLS=ROOT.parent/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'
DRIVER=BUILD/'environment-test.c';ELF=BUILD/'environment-test.elf'
DRIVER.write_text('''typedef unsigned u32;typedef unsigned char u8;
u32 TestApi,TestAllowed,TestRewrite;u8 TestOwner;
void TestClamp(void*i,void*f,u8 owner,u32*w){(void)i;(void)f;(void)owner;(void)w;((u32(*)(u32,u32))TestRewrite)(0x32,1);}
u32 TestCheck(void*f,void*mon,u32 amount){(void)mon;(void)amount;TestAllowed=1;((void(*)(void*,void*,u8,u32*))TestApi)((void*)0x310000,f,TestOwner,(u32*)0);return TestAllowed;}
''')
subprocess.run([str(TOOLS/'arm-none-eabi-gcc'),'-mthumb','-mcpu=arm946e-s','-Os','-ffreestanding','-nostdlib','-Wl,-Ttext=0x180000,-Tbss=0x190000,-eTestCheck',str(DRIVER),'-o',str(ELF)],check=True)
class Runtime(base.Runtime):
 def __init__(self,effects,slots=4):
  self.fields=set();self.layers={};self.env_queries=0;super().__init__(effects,slots)
  self.vm.mem_map(0x180000,0x20000)
  with ELF.open('rb')as f:
   elf=ELFFile(f)
   for segment in elf.iter_segments():
    if segment['p_type']=='PT_LOAD':self.vm.mem_write(segment['p_vaddr'],segment.data()+bytes(segment['p_memsz']-segment['p_filesz']))
   self.driver={s.name:s['st_value']for s in elf.get_section_by_name('.symtab').iter_symbols()}
  self.put(self.driver['TestApi'],base.BASE+self.symbols['AbilityEvent_80']+1)
  for n in range(5):
   self.put(base.BASE+self.symbols['AbilityEnvironmentApi']+n*4,(self.driver['TestCheck']if n==4 else base.API+0x2000+n*16+1))
   self.vm.mem_write(base.API+0x2000+n*16,bytes.fromhex('7047'))
  self.vm.hook_add(UC_HOOK_CODE,self.service,begin=base.API+0x2000,end=base.API+0x2040)
 def put(self,at,value):self.vm.mem_write(at,base.u32(value))
 def service(self,vm,address,size,data):
  a,b,c=[vm.reg_read(r)for r in [UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2]]
  if base.API+0x2000<=address<=base.API+0x2040:
   n=(address-base.API-0x2000)//16;result=0
   if n==0:result=int(a in self.fields);self.env_queries+=1
   elif n==1:result=2|(a<<3)
   elif n==2:vm.mem_write(a,struct.pack('<HH',c,b))
   elif n==3:pass
   else:raise AssertionError(n)
   vm.reg_write(UC_ARM_REG_R0,result);return
  if address==base.API+0x1000+13*16:vm.reg_write(UC_ARM_REG_R0,int(a>=12));return
  if address==base.API+0x1000+23*16:vm.reg_write(UC_ARM_REG_R0,self.layers.get((b,c),0));return
  if address==base.API+28*16:
   self.values[a]=b
   if a==0x51:self.put(self.driver['TestAllowed'],b)
  super().service(vm,address,size,data)
 def indirect(self,message,owner=0,enabled=True):
  p=base.WORK+0x100;work=bytearray(64);work[6]=owner;struct.pack_into('<HH',work,12,message,2 if enabled else 0);self.vm.mem_write(p,bytes(work));self.values[4]=owner
  self.vm.mem_write(self.driver['TestOwner'],bytes([owner]))
  for reg,value in [(UC_ARM_REG_R0,base.FLOW),(UC_ARM_REG_R1,0x300000),(UC_ARM_REG_R2,10),(UC_ARM_REG_R3,p),(UC_ARM_REG_SP,base.STACK),(UC_ARM_REG_LR,base.STOP|1)]:self.vm.reg_write(reg,value)
  self.vm.emu_start(base.BASE+self.symbols['AbilityIndirectDamageCheck']|1,base.STOP,count=100000)
  assert self.vm.reg_read(UC_ARM_REG_SP)==base.STACK
  assert self.weather==0
  return self.vm.reg_read(UC_ARM_REG_R0)
def guard(mask):return bytes([170,mask&255,1,0,mask>>8,0,0,0,0,0,0,0,0,0,0,0])
def field(condition=1,duration=5,toggle=0):return bytes([168,condition,1,0,duration,toggle,0,0,0,0,0,0,0,0,0,0])
def side(condition=4,scope=0,duration=4,layers=1):return bytes([169,condition,1,0,scope,duration,layers,0,0,0,0,0,0,0,0,0])
count=0
for slots in (4,8,16):
 for condition,bit in [(4,0),(5,1),(10,2),(8,3),(9,4),(35,13)]:
  for chosen in range(14):
   for target in (0,1):
    r=Runtime([guard(1<<chosen)],slots);r.values.update({2:target,0x1d:condition});r.event(0x6b)
    assert bool(r.rewrites)==(chosen==bit and target==0),(condition,bit,chosen,target,r.rewrites);count+=1
 for message,bit in [(0x262,8),(0x353,9),(0x356,9),(0x1ae,10),(0x1a8,10),(0x192,10),(0x3f5,11),(0x40e,11),(0x407,11),(0x1e4,12),(0x1c9,12),(0x17a,7),(777,13)]:
  for chosen in range(14):
   r=Runtime([guard(1<<chosen)],slots);assert r.indirect(message)==int(chosen!=bit),(message,bit,chosen,r.rewrites)
   r.rewrites=[];r.values[4]=0;r.event(0x80);assert not r.rewrites,'The source scope must not leak';count+=1
 for weather,bit in [(3,5),(4,6)]:
  for chosen in range(14):
   r=Runtime([guard(1<<chosen)],slots);r.values.update({0x39:weather});r.event(0x7f);assert bool(r.rewrites)==(chosen==bit);count+=1
 r=Runtime([guard(3)],slots);r.values.update({3:0,0x51:0});r.event(0x50);assert not r.rewrites;count+=1
 r=Runtime([guard(128)],slots);r.values.update({3:0,0x51:0});r.event(0x50);assert r.rewrites==[(0x41,1)];count+=1
 for condition in (1,2,4,5,6,7):
  for duration in (0,1,3,63):
   r=Runtime([field(condition,duration)],slots);r.event(0x55);assert len(r.works)==1 and r.works[0][0]==27;assert int.from_bytes(r.works[0][8:12],'little')==(1 if not duration else 2|(duration<<3));assert r.popups==[(2,0),(3,0)];count+=1
  r=Runtime([field(condition)],slots);r.fields.add(condition);r.event(0x55);assert not r.works and not r.popups;count+=1
  r=Runtime([field(condition,toggle=1)],slots);r.fields.add(condition);r.event(0x8a);assert r.works[0][0]==28;count+=1
 for condition,cap in [(4,1),(6,3),(7,2),(8,1)]:
  for initial in range(cap+1):
   r=Runtime([side(condition,1,layers=3)],slots);r.layers[(1,condition)]=initial;r.event(0x55);assert len(r.works)==cap-initial
   assert all(w[12]==1 for w in r.works);assert r.popups==([(2,0),(3,0)]if initial<cap else []);count+=1
 for reverse in (False,True):
  native=bytearray(16);native[0]=128;native[8:12]=base.u32(base.WORK+0x400);native[14]=1
  r=Runtime(([bytes(native),guard(1)]if reverse else [guard(1),bytes(native)]),slots)
  r.put(r.driver['TestRewrite'],base.API+28*16+1);r.vm.mem_write(base.WORK+0x400,struct.pack('<II',0x6b,r.driver['TestClamp']|1))
  r.values.update({2:0,0x1d:4});r.event(0x6b);assert r.values[0x32]==0,'Immunity must win over minimum-one modifiers regardless of card order';count+=1
 r=Runtime([field(),side()],slots);r.event(0x55);assert len(r.works)==2 and r.popups==[(2,0),(3,0)];count+=1
 r=Runtime([field()],slots);r.preview=True;r.event(0x55);assert not r.works and not r.popups;count+=1
print(f'{count} environment ARM cases passed: source isolation, source selection, native duration/layer payloads, entry/gain, no-op popups, grouping and zero weather queries.')
