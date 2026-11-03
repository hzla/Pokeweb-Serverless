"""Shipped ARM flag filters with isolated native services; not gameplay."""
import importlib.util,json,struct
from pathlib import Path
from unicorn.arm_const import UC_ARM_REG_R0,UC_ARM_REG_R1

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('compact',HERE/'test_compact.py')
compact=importlib.util.module_from_spec(spec);spec.loader.exec_module(compact)
compact.BUNDLES=json.loads((HERE.parents[1]/'src/assets/data/abilityRuleRuntimeNativeFlags.json').read_text())

class Runtime(compact.Runtime):
 def __init__(self,effects,slots=4,flags=0):
  self.flags=flags;self.flag_queries=[]
  super().__init__(effects,slots)
  # One explicit expanded Healing classification and the final custom ID.
  for name,address,mask in [('AbilityMoveClassData',0x313000,64),('AbilityCustomMoveFlagData',0x313100,242)]:
   self.vm.mem_write(address,struct.pack('<HHH',1,52,mask))
   self.vm.mem_write(compact.BASE+self.symbols[name],compact.u32(address))
 def service(self,vm,address,size,data):
  if address==compact.API+31*16:
   move,flag=[vm.reg_read(r)for r in (UC_ARM_REG_R0,UC_ARM_REG_R1)]
   assert move==52 and 0<=flag<14,(move,flag)
   self.flag_queries.append((move,flag));vm.reg_write(UC_ARM_REG_R0,int(bool(self.flags&(1<<flag))))
  else:super().service(vm,address,size,data)

def record(kind,flag,value=6144,bypass=False,at=1):
 e=bytearray(16);e[0]=kind;e[at]=flag;e[2:4]=struct.pack('<H',value);e[7]=2|int(bypass);e[6]=100
 return e

count=0
for slots in (4,8,16):
 for flag in range(14):
  for matches in (False,True):
   bits=(1<<flag)if matches else 0
   for kind,event in [(129,0x38),(130,0x47),(131,0x47),(134,0x11),(132,0x2d),(133,0x4b)]:
    e=record(kind,flag,value=3 if kind==134 else 1 if kind>=132 else 6144)
    if kind==133:e[8]=2
    r=Runtime([bytes(e)],slots,bits);r.values[3]=0 if kind in (129,130,134)else 1;r.event(event)
    result=r.mult if kind<=131 else r.rewrites if kind in (132,134)else r.works
    assert bool(result)==matches,(kind,flag,matches,result)
    assert r.flag_queries==[(52,flag)],r.flag_queries
    count+=1
   # Conversion and recipe-based ally/recipient matching share the same flag.
   for kind,at in [(135,1),(139,4),(153,1)]:
    e=record(kind,flag,at=at)
    if kind==135:e[4]=18;e[5]=9
    if kind==139:e[1]=1;e[5]=0;e[6]=0
    if kind==153:e[4]=0;e[5]=0;e[6]=1
    r=Runtime([bytes(e)],slots,bits);r.values[3]=0 if kind!=153 else 1;r.event(0x2d if kind==153 else 0x38)
    assert bool(r.rewrites if kind==153 else r.mult)==matches,(kind,flag,matches,r.mult,r.rewrites)
    assert r.flag_queries==[(52,flag)],r.flag_queries
    count+=1
   # A completed-move observer must use that move's flag, including indices
   # 9 and 10, whose numbers also name existing type/category filter modes.
   e=record(136,flag,value=1,at=10);e[1]=5;e[4]=2;e[5]=0;e[12]=0
   r=Runtime([bytes(e)],slots,bits);r.values[3]=0
   for event in (0x03,0x29,0x04):r.event(event)
   assert bool(r.works)==matches,(flag,matches,r.works)
   assert r.flag_queries==[(52,flag)],r.flag_queries
   count+=1
 for bypass in (False,True):
  e=record(131,12,bypass=bypass);r=Runtime([bytes(e)],slots,1<<12);r.skip=True;r.event(0x47)
  assert bool(r.mult)==(not bypass),(bypass,r.mult)
  assert len(r.flag_queries)==int(not bypass);count+=1
 # Two independent records consume two reads, without introducing nested
 # native events, weather queries or shared mutable move-class state.
 r=Runtime([bytes(record(129,12)),bytes(record(129,0))],slots,1<<12);r.values[3]=0;r.event(0x38)
 assert len(r.mult)==1 and r.flag_queries==[(52,12),(52,0)];count+=1
 for filter in (12,255):
  e=record(129,filter);e[7]=0
  r=Runtime([bytes(e)],slots,0);r.values[3]=0;r.event(0x38)
  assert len(r.mult)==1 and not r.flag_queries,(filter,r.mult,r.flag_queries);count+=1
print(f'{count} shipped ARM native-flag cases passed: all 14 flags, six library effects, conversion/ally/blocking/after-move recipes, match/nonmatch, independent Mold Breaker settings and zero weather queries.')
