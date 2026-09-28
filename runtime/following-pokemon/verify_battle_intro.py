"""Execute the packaged singles wrappers and original native opening procedures.

Only graphics/audio/UI services are spies. No game emulator is launched.
"""
import os,struct,sys
from pathlib import Path
import ndspy.rom
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_THUMB,UC_HOOK_CODE
from unicorn.arm_const import *
from verify_packaged import PACKAGE_BUILD,MODULE_SUFFIX,audit,install_hooks,relocate,module_exports,symbol_hash,read_module
from battle_port import port_address

profile=os.environ.get('FOLLOWING_PROFILE','stock')
a=lambda address:port_address(address,profile)
rom=ndspy.rom.NintendoDSRom.fromFile(sys.argv[1])
overlays=rom.loadArm9Overlays([167,168])
dll=PACKAGE_BUILD/f'PokewebFollowingBattle{MODULE_SUFFIX}.dll'
elf=PACKAGE_BUILD/f'PokewebFollowingBattle{MODULE_SUFFIX}.elf'
audit(dll,elf)
code,bss,syms,rels=read_module(dll)
assert bss==0 and not any(s[4]&2 for s in syms)
assert {r[0] for r in rels if r[1]!=255}=={a(0x21d12b4),a(0x21d12b8)}
uc=Uc(UC_ARCH_ARM,UC_MODE_THUMB);uc.ctl_set_cpu_model(UC_CPU_ARM_946);uc.mem_map(0x02000000,0x400000)
for overlay in overlays.values():uc.mem_write(overlay.ramAddress,bytes(overlay.data))
BASE=0x02300000;WORK=0x02280000;SETUP=WORK+0x400;MAIN=WORK+0x800;CON=WORK+0x900
BPP0=WORK+0x1000;BPP1=WORK+0x1100;SEQ=WORK+0x2000;STOP=0x02008000
uc.mem_write(BASE,bytes(relocate(dll,BASE)));install_hooks(uc,dll,BASE)
exports=module_exports(dll,BASE)
get=lambda addr:struct.unpack('<I',uc.mem_read(addr,4))[0]
def put(addr,value):uc.mem_write(addr,struct.pack('<I',value))
regs=[UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3]
trace=[];slot=0;busy=False;hidden=True
services={0x219c784,0x219d1c8,0x21bac80,0x21bb0a4,0x21d3758,0x21d37d8,0x21df85c,
 0x21df39c,0x21d1338,0x21df828,0x21d15d8,0x21d4f00,0x21d2e60,0x21d2f1c,
 0x21d39cc,0x219bf14,0x21df308,0x219c690,0x219d978,0x21df8cc,0x21dfa28,
 0x21d40cc,0x21dfc54,0x21dfc78,0x219c8a0,0x21dfc94,0x21d45d0}
translated={a(x):x for x in services}
def spy(u,pc,size,user):
 if pc not in translated:return
 assert u.reg_read(UC_ARM_REG_SP)%8==0,hex(pc)
 fn=translated[pc];r=[u.reg_read(x) for x in regs];out=0
 if fn==0x219c784:out=r[1]
 elif fn==0x219d1c8:out=BPP0 if r[1]==0 else BPP1
 elif fn==0x21bac80:out=slot if r[0]==BPP0 else 6
 elif fn==0x21bb0a4:out=r[0]+0x40
 elif fn==0x21d37d8:out=int(hidden)
 elif fn==0x21df828:out=int(busy)
 elif fn==0x21d2f1c:out=1
 elif fn==0x21d15d8:out=2
 elif fn==0x21df85c:trace.append(('mon',r[1],get(SEQ)))
 elif fn==0x21df39c:trace.append(('effect',r[1]))
 elif fn==0x21df308:trace.append(('effect',r[0]))
 elif fn==0x21d4f00:trace.append(('message',r[1]))
 elif fn==0x21d39cc:trace.append(('status',(r[0]-WORK-0x48)//12))
 elif fn==0x21df8cc:trace.append(('trainer',r[1]))
 elif fn==0x21dfc54:trace.append(('gauge',get(SEQ)))
 u.reg_write(UC_ARM_REG_R0,out);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
uc.hook_add(UC_HOOK_CODE,spy)
def call(target):
 uc.reg_write(UC_ARM_REG_SP,0x023f0000);uc.reg_write(UC_ARM_REG_LR,STOP|1)
 uc.reg_write(UC_ARM_REG_R0,SEQ);uc.reg_write(UC_ARM_REG_R1,WORK)
 uc.emu_start(target|1,STOP,count=100000)
 assert uc.reg_read(UC_ARM_REG_PC)==STOP,hex(uc.reg_read(UC_ARM_REG_PC))
 assert uc.reg_read(UC_ARM_REG_SP)==0x023f0000
 return uc.reg_read(UC_ARM_REG_R0)
def reset(trainer,flag=0):
 trace.clear();uc.mem_write(WORK,bytes(0x3000));put(WORK+0x134,MAIN);put(WORK+0x138,CON)
 put(MAIN,SETUP);put(SETUP,int(trainer));put(SETUP+0x9c,flag|0x42)
 put(SEQ,0)
def run(target):
 for _ in range(40):
  if call(target):return tuple(trace)
 raise AssertionError(('opening stalled',get(SEQ),trace))
checks=0
for trainer in (False,True):
 original=a(0x21d1639 if trainer else 0x21d1445)
 wrapper=get(a(0x21d12b8 if trainer else 0x21d12b4))
 assert wrapper==exports[symbol_hash('FollowingBattleTrainer' if trainer else 'FollowingBattleWild')]
 reset(trainer);baseline=run(original)
 reset(trainer);assert run(wrapper)==baseline # Exact retail trace with no handshake.
 for _ in range(100):
  reset(trainer,0x80000000);custom=run(wrapper)
  assert ('mon',0,0) in custom and sum(x[:2]==('mon',0) for x in custom)==1
  assert ('effect',562) not in custom and ('effect',564) not in custom and ('message',11) not in custom
  assert ('effect',567 if trainer else 561) in custom
  if trainer:assert ('effect',568) in custom and ('effect',569) in custom and ('gauge',6) not in custom
  assert ('status',0) in custom and ('status',1) in custom and get(SETUP+0x9c)==0x42
  checks+=1
 for off,value in [(4,1),(4,2),(4,3),(0x1c,1),(0x20,1),(0x20,0x10000),(0x20,0x1000000),(0,3)]:
  reset(trainer,0x80000000);put(SETUP+off,value);retail=run(original)
  reset(trainer,0x80000000);put(SETUP+off,value);assert run(wrapper)==retail
  checks+=1
 slot=1;reset(trainer,0x80000000);assert run(wrapper)==baseline and get(SETUP+0x9c)==0x42;slot=0
 # Wait on opponent effects and message closure before advancing.
 reset(trainer,0x80000000)
 while get(SEQ)!=(6 if trainer else 5):assert call(wrapper)==0
 busy=True;assert call(wrapper)==0 and get(SEQ)==(6 if trainer else 5);busy=False
 hidden=False;assert call(wrapper)==0 and get(SEQ)==(6 if trainer else 5);hidden=True
 assert run(wrapper)
print(f'Battle opening: {checks} repeated/eligibility cases; native opponent flow, retail fallback, no player throw, HP bars, waits and flag consumption passed. Module code/data {len(code)} bytes; BSS {bss}; no allocations/imports. Visual/audio acceptance pending.')
