"""Exercise the shipped strike adapters and nested scope with ARM code."""
import json,struct
from pathlib import Path
import test_compact as base
from unicorn import UC_HOOK_CODE
from unicorn.arm_const import UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3,UC_ARM_REG_R4,UC_ARM_REG_R7,UC_ARM_REG_SP,UC_ARM_REG_LR
ROOT=Path(__file__).resolve().parents[2]
base.BUNDLES=json.loads((ROOT/'src/assets/data/abilityRuleRuntimeStrikes.json').read_text())

def strike(ratio):return bytes([171,0])+struct.pack('<H',ratio)+bytes(12)
class Runtime(base.Runtime):
 def __init__(self,slots=4):
  self.ability=165;self.flag=0;self.targets=1;self.frames=[];self.countCalls=0;self.endCalls=[]
  super().__init__([strike(1024)],slots)
  for n in range(3):
   self.vm.mem_write(base.API+0x2000+n*16,bytes.fromhex('7047'))
   self.vm.mem_write(base.BASE+self.symbols['AbilityStrikeApi']+n*4,base.u32(base.API+0x2000+n*16+1))
  self.vm.hook_add(UC_HOOK_CODE,self.service,begin=base.API+0x2000,end=base.API+0x2030)
 def service(self,vm,address,size,data):
  a,b,c=[vm.reg_read(r)for r in [UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2]]
  if base.API+0x2000<=address<base.API+0x2030:
   n=(address-base.API-0x2000)//16
   if n==0:self.countCalls+=1
   elif n==1:
    sp=vm.reg_read(UC_ARM_REG_SP);self.endCalls.append(tuple(struct.unpack('<II',bytes(vm.mem_read(sp,8)))))
   elif n==2:vm.reg_write(UC_ARM_REG_R0,self.targets)
   return
  if address==base.API+3*16 and b==17:vm.reg_write(UC_ARM_REG_R0,self.ability);return
  if address==base.API+15*16:vm.reg_write(UC_ARM_REG_R0,0);return
  if address==base.API+31*16:vm.reg_write(UC_ARM_REG_R0,self.flag);return
  if address==base.API+0x1000+7*16:self.frames.append(dict(self.values));return
  if address==base.API+0x1000+9*16:self.values[a]=b;return
  if address==base.API+0x1000+8*16:self.values=self.frames.pop();return
  if address==base.API+0x1000+22*16:return
  return super().service(vm,address,size,data)
 def call(self,name,args,stack=(),r4=0,r7=0):
  sp=base.STACK-16
  self.vm.mem_write(sp,b''.join(base.u32(x)for x in stack)+bytes(16-4*len(stack)))
  for reg,value in zip([UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3],args):self.vm.reg_write(reg,value)
  for reg,value in [(UC_ARM_REG_R4,r4),(UC_ARM_REG_R7,r7),(UC_ARM_REG_SP,sp),(UC_ARM_REG_LR,base.STOP|1)]:self.vm.reg_write(reg,value)
  self.vm.emu_start(base.BASE+self.symbols[name]|1,base.STOP,count=200000)
  assert self.vm.reg_read(UC_ARM_REG_SP)==sp
 def start(self,move=33,category=1,target=0,hit=base.WORK+0x100,multi=False):
  param=base.WORK+0x200;p=bytearray(20);struct.pack_into('<H',p,0,move);p[6]=9;struct.pack_into('<II',p,8,category,target);self.vm.mem_write(param,bytes(p));self.vm.mem_write(hit,bytes([1,0,0,int(multi),0,0,0,0]));
  self.call('AbilityStrikeCountSite',[base.FLOW,0x300000,move,hit],r4=param,r7=0x300400)
  return hit
 def end(self):self.call('AbilityStrikeEndSite',[base.FLOW,0,0,0],[13,29])
 def damage(self,hit,index):
  self.vm.mem_write(hit+1,bytes([index]));self.values[3]=0;self.mult=[]
  self.call('AbilityRecipeHandlers',[base.FLOW,0x47,7,0]);return list(self.mult)
count=0
for slots in (4,8,16):
 for ratio in (512,1024,2048,4096,12288,32768):
  r=Runtime(slots);r.vm.mem_write(base.DATA+520,strike(ratio));hit=r.start();assert bytes(r.vm.mem_read(hit,4))==bytes([2,0,0,1]);assert r.damage(hit,0)==[];assert r.damage(hit,1)==[(0x35,ratio)];r.end();assert r.endCalls==[(13,29)];assert r.damage(hit,1)==[];assert r.weather==0;count+=1
 for name,setup in [('existing-multihit',lambda r:r.start(multi=True)),('status',lambda r:r.start(category=0)),('spread',lambda r:(setattr(r,'targets',2),r.start())[1]),('charge',lambda r:(setattr(r,'flag',1),r.start())[1]),('suppressed',lambda r:(setattr(r,'ability',0),r.start())[1]),('preview',lambda r:(setattr(r,'preview',True),r.start())[1])]:
  r=Runtime(slots);hit=setup(r);assert r.vm.mem_read(hit,1)==b'\1',(name,list(r.vm.mem_read(hit,4)));assert not r.damage(hit,1);r.end();count+=1
 for move in (12,32,90,120,153,165,205,248,253,283,301,329,353,374,515):
  r=Runtime(slots);hit=r.start(move=move);assert r.vm.mem_read(hit,1)==b'\1';r.end();count+=1
 r=Runtime(slots);outer=r.start(hit=base.WORK+0x100);inner=r.start(hit=base.WORK+0x110);assert r.damage(inner,1)==[(0x35,1024)];r.end();assert r.damage(outer,1)==[(0x35,1024)];r.end();assert not r.damage(outer,1);count+=1
print(f'{count} strike ARM cases passed: native call forwarding, scaling, exclusions, nested scopes and zero weather queries.')
