"""Shipped ARM consolidated effects with isolated services; not native gameplay."""
import json, struct, sys
from pathlib import Path
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3,UC_ARM_REG_SP,UC_ARM_REG_LR
ROOT=Path(__file__).resolve().parents[2]
BUNDLES=json.loads((ROOT/'src/assets/data/abilityRuleRuntimeCompact.json').read_text())
if '--current' in sys.argv:BUNDLES=json.loads((ROOT/'src/assets/data/abilityRuleRuntimeNativeFlags.json').read_text())
BASE,API,DATA,ITEM,FLOW,WORK,STACK,STOP=0x100000,0x200000,0x312000,0x310000,0x311000,0x314000,0x410000,0x20f000
u32=lambda x:struct.pack('<I',x&0xffffffff)

class Runtime:
 def __init__(self,effects,slots=4):
  module=BUNDLES['abilityRuleRuntimeRecipesActions.json'][str(slots)]
  self.vm=vm=Uc(UC_ARCH_ARM,UC_MODE_THUMB)
  for start,size in [(BASE,0x40000),(API,0x10000),(0x300000,0x40000),(0x400000,0x20000)]:vm.mem_map(start,size)
  vm.mem_write(BASE,bytes(module['code']));self.symbols={s['name']:s['address']for s in module['symbols']if s.get('name')}
  for r in module['relocations']:
   s=module['symbols'][r['sourceSymbolIndex']];t=r['target'];assert t['module']=='base';at=BASE+t['address'];dest=BASE+s['address']
   if t['type']=='OFFSET':vm.mem_write(at,u32(dest|int(s['type']=='FUNCTION_THM')))
   else:
    assert t['type']=='THUMB_BRANCH_LINK';d=dest-at-4;vm.mem_write(at,struct.pack('<HH',0xf000|((d>>12)&0x7ff),0xf800|((d>>1)&0x7ff)))
  data=bytearray(512)+bytes([len(effects),1,0,0,128,0,0,0])+b''.join(effects);struct.pack_into('<H',data,330,512)
  vm.mem_write(DATA,bytes(data));vm.mem_write(BASE+self.symbols['AbilityRuleData'],u32(DATA));vm.mem_write(ITEM+0x14,u32(2<<24))
  self.values={2:0,3:1,4:0,0x12:52,0x16:9,0x32:10,0x46:0};self.hp=100;self.preview=False;self.skip=False;self.roll=True;self.invalid=set();self.popups=[];self.works=[];self.rolls=[];self.mult=[];self.cures=[];self.rewrites=[];self.weather=0
  for name,count,base in [('AbilityRuleApi',43,API),('AbilityRecipeApi',24,API+0x1000)]:
   for n in range(count):vm.mem_write(base+n*16,bytes.fromhex('7047'));vm.mem_write(BASE+self.symbols[name]+n*4,u32(base+n*16+1))
  vm.hook_add(UC_HOOK_CODE,self.service,begin=API,end=API+0x1200)
 def service(self,vm,address,size,_):
  a,b,c=[vm.reg_read(r)for r in [UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2]];result=0
  if address>=API+0x1000:
   n=(address-API-0x1000)//16
   if n==10:result=int(a//6==b//6)
   elif n==11:result=int(b in (0,1,6,23))
   elif n==15:self.cures.append((b,c))
   else:raise AssertionError(('Recipe API',n,a,b,c))
  else:
   n=(address-API)//16
   if n==0:result=self.values.get(a,0)
   elif n==1:self.mult.append((a,b))
   elif n==2:result=0x300000+b*0x200
   elif n==3:result=self.hp if b==13 else 100
   elif n==5:result=1
   elif n==6:self.weather+=1
   elif n==7:result=int(self.preview)
   elif n==8:pass
   elif n==9:vm.mem_write(WORK,bytes(64));vm.mem_write(WORK,u32(b));result=WORK
   elif n==10:self.works.append(bytes(vm.mem_read(b,32)))
   elif n in (11,12):pass
   elif n==13:result=165
   elif n==17:result=1
   elif n==20:self.popups.append((b,c))
   elif n==23:result=int(b not in self.invalid)
   elif n==26:vm.mem_write(b,u32(self.values.get(a,0)));result=int(a in self.values)
   elif n==27:self.rolls.append(a);result=int(self.roll)
   elif n==28:self.rewrites.append((a,b));result=1
   elif n==30:pass
   elif n==32:result=int(self.skip)
   elif n==35:result=9
   else:raise AssertionError(('Rule API',n,a,b,c))
  vm.reg_write(UC_ARM_REG_R0,result)
 def event(self,event,owner=0):
  for reg,value in [(UC_ARM_REG_R0,ITEM),(UC_ARM_REG_R1,FLOW),(UC_ARM_REG_R2,owner),(UC_ARM_REG_R3,0),(UC_ARM_REG_SP,STACK),(UC_ARM_REG_LR,STOP|1)]:self.vm.reg_write(reg,value)
  self.vm.emu_start(BASE+self.symbols[f'AbilityEvent_{event:02x}']|1,STOP,count=200000)
  assert self.vm.reg_read(UC_ARM_REG_SP)==STACK
  assert self.weather==0

def guard(mask,scope=1,cure=0,bypass=1):return bytes([166,mask&255,1,0,mask>>8,scope,18,bypass,cure,0,0,0,0,0,0,0])
def group(changes,activation=0,chance=100,once=0,order=None):
 packed=sum((v&15)<<((stat-1)*4)for stat,v in changes);r=bytearray(16);r[0]=167;r[1]=activation|once<<3;r[2:6]=u32(packed);r[6]=chance;r[8]=50
 ordered=sum(stat<<(n*3)for n,stat in enumerate(order or [s for s,_ in changes]));r[12:15]=ordered.to_bytes(3,'little');return bytes(r)
count=0
conditions=[1,2,3,4,5,6,7,11,12,13,14,15,23];mental=[7,11,12,13,15,23];mask=sum(1<<conditions.index(c)for c in mental)
for slots in (4,8,16):
 for condition in conditions:
  for target in (0,1,6):
   r=Runtime([guard(mask)],slots);r.values.update({0x1d:condition,4:target,3:6});r.event(0x65);r.event(0x67)
   expected=condition in mental and target in (0,1)
   assert bool(r.rewrites)==expected,(condition,target,r.rewrites)
   assert r.popups==([(2,0),(3,0)]if expected else []),r.popups;count+=1
 r=Runtime([guard(mask,cure=1)],slots);r.event(0x55);assert r.cures==[(target,c)for target in (0,1)for c in mental];count+=1
 for changes in [[(1,1),(3,1),(5,1),(2,-1),(4,-1)],[(2,2),(5,-2)]]:
  for invalid in [set(),{2,5},set(range(1,8))]:
   r=Runtime([group(changes)],slots);r.invalid=invalid;r.event(0x55)
   actual=[(struct.unpack_from('<I',w,4)[0],struct.unpack('<b',w[12:13])[0])for w in r.works if int.from_bytes(w[:4],'little')==14]
   assert actual==[(s,v)for s,v in changes if s not in invalid],actual
   assert r.popups==([(2,0),(3,0)]if actual else []);count+=1
 for chance,roll in [(30,False),(30,True),(100,True)]:
  r=Runtime([group([(2,1),(5,-1)],chance=chance)],slots);r.roll=roll;r.event(0x55)
  assert r.rolls==([chance,chance]if chance<100 else []);assert len(r.works)==(2 if roll else 0);count+=1
 # Both changes must observe the same completed-move state.
 r=Runtime([group([(3,1),(5,-1)],activation=5)],slots);r.values[3]=0;r.event(0x03);r.event(0x29);r.event(0x04);assert len(r.works)==2;count+=1
 # Repeated records fit every slot, and the last owner/slot stays within BSS.
 r=Runtime([group([(2,1)])]*slots,slots);r.values[2]=23;r.event(0x55,owner=23);assert len(r.works)==slots;count+=1
 for move_type in (0,9,10,14,17):
  e=bytearray(16);e[0]=129;e[1]=9;e[2:4]=(6144).to_bytes(2,'little');e[10:13]=((1<<9)|(1<<10)).to_bytes(3,'little')
  r=Runtime([bytes(e)],slots);r.values[3]=0;r.values[0x16]=move_type;r.event(0x38);assert bool(r.mult)==(move_type in (9,10));count+=1
print(f'{count} shipped ARM compact cases passed: condition sets, scopes, cure, grouped order/chances/caps, after-move state, type sets, owner/slot boundaries and zero weather queries.')
