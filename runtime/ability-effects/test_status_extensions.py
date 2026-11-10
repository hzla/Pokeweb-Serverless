"""Execute the compiled status adapter and redirection gate with ARM service doubles.
These tests cover the Thumb stack ABI and query counts; native battles are separate.
"""
import json,struct
from pathlib import Path
import test_compact as base
from unicorn import UC_HOOK_CODE
from unicorn.arm_const import UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3,UC_ARM_REG_R7,UC_ARM_REG_SP,UC_ARM_REG_LR
bundles=json.loads((Path(__file__).resolve().parents[2]/'src/assets/data/abilityRuleRuntimeStatusExtensions.json').read_text())
base.BUNDLES={'abilityRuleRuntimeRecipesActions.json':bundles['abilityRuleRuntimeRecipesGrouped.json']}
class Runtime(base.Runtime):
 def __init__(self,effect,slots):
  self.ability=165;self.types={3,8};self.native_result=2;self.original_calls=[];self.handlers=0
  super().__init__([effect],slots)
  self.values.update({3:0,4:6,0x12:85})
  for i in range(5):
   self.vm.mem_write(base.API+0x3000+i*16,bytes.fromhex('7047'))
   self.vm.mem_write(base.BASE+self.symbols['AbilityStatusApi']+i*4,base.u32(base.API+0x3000+i*16+1))
  self.vm.hook_add(UC_HOOK_CODE,self.service,begin=base.API+0x3000,end=base.API+0x304f)
 def service(self,vm,address,size,data):
  a,b,c=[vm.reg_read(r)for r in [UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2]]
  if address==base.API+0x3000:
   sp=vm.reg_read(UC_ARM_REG_SP);self.original_calls.append((a,b,c,struct.unpack('<I',vm.mem_read(sp,4))[0]));vm.reg_write(UC_ARM_REG_R0,self.native_result);return
  if address==base.API+3*16 and b==17:vm.reg_write(UC_ARM_REG_R0,self.ability);return
  if address==base.API+4*16:vm.reg_write(UC_ARM_REG_R0,a);return
  if address==base.API+5*16:vm.reg_write(UC_ARM_REG_R0,int(b in self.types));return
  if address==base.API+15*16:vm.reg_write(UC_ARM_REG_R0,(a-0x300000)//0x200);return
  if address==base.API+0x1000+22*16:self.handlers+=1;return
  return super().service(vm,address,size,data)
 def call(self,name,args,mode=0,source=0x300000):
  sp=base.STACK-16;self.vm.mem_write(sp,base.u32(mode)+bytes(12))
  for reg,value in zip([UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3],args):self.vm.reg_write(reg,value)
  for reg,value in [(UC_ARM_REG_R7,source),(UC_ARM_REG_SP,sp),(UC_ARM_REG_LR,base.STOP|1)]:self.vm.reg_write(reg,value)
  self.vm.emu_start(base.BASE+self.symbols[name]|1,base.STOP,count=100000)
  assert self.vm.reg_read(UC_ARM_REG_SP)==sp
  return self.vm.reg_read(UC_ARM_REG_R0)
def effect(kind,a=0,b=0,c=0):return bytes([kind,a,1,0,b,c,0,0,0,0,0,0,0,0,0,0])
count=0
for slots in (4,8,16):
 for status,native,ability,types,expected in [(5,2,165,{3,8},0),(5,2,0,{3},2),(4,2,165,{9},2),(5,1,165,{3},1),(5,3,165,{3},3),(5,0,165,{3},0)]:
  for mode in (0,1,2):
   r=Runtime(effect(176,5,3,8),slots);r.native_result=native;r.ability=ability;r.types=types
   assert r.call('AbilityStatusCheckSite',[base.FLOW,0x300c00,status,123],mode)==expected
   assert len(r.original_calls)==1 and r.original_calls[0][-1]==mode
   assert r.weather==0;count+=1
 r=Runtime(effect(176,5,8,18),slots);r.vm.mem_write(base.DATA+512,b'\2');r.vm.mem_write(base.DATA+536,effect(176,5,3,18));assert r.call('AbilityStatusCheckSite',[base.FLOW,0x300c00,5,1])==0;count+=1
 # Ignoring only Steel must retain the Poison half of a dual type's immunity.
 r=Runtime(effect(176,5,8,18),slots);assert r.call('AbilityStatusCheckSite',[base.FLOW,0x300c00,5,1])==2;count+=1
 for event in (0x29,0x2a,0x95):
  r=Runtime(effect(174),slots);r.call('AbilityRecipeHandlers',[base.FLOW,event,7,0]);assert r.handlers==int(event==0x95);assert r.weather==0;count+=1
 r=Runtime(effect(174),slots);r.ability=0;r.call('AbilityRecipeHandlers',[base.FLOW,0x29,7,0]);assert r.handlers==1;count+=1
print(f'{count} status/redirection ARM cases passed: source and stack forwarding, narrow type bypass, suppression, reflection and zero added weather queries.')
