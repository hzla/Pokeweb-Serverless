"""Packaged field eligibility and event-chain handoff for every profile/variant."""
import os,struct
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_THUMB,UC_HOOK_CODE
from unicorn.arm_const import *
from verify_packaged import PACKAGE_BUILD,MODULE_SUFFIX,audit,load_dependencies,relocate,elf_functions
profile=os.environ.get('FOLLOWING_PROFILE','stock')
# Field/ARM9 adapters use the normal field mapping, not battle-overlay deltas.
if profile=='black2':
 from black2_port import port_address as a
elif profile=='white2italy':
 from italy_port import port_address as a
else:a=lambda address:address
uc=Uc(UC_ARCH_ARM,UC_MODE_THUMB);uc.ctl_set_cpu_model(UC_CPU_ARM_946);uc.mem_map(0x02000000,0x400000)
BASE=0x02300000;STOP=0x02008000;RECALL=STOP+4
F=0x02200000;SYS=F+0x1000;ACTOR=F+0x2000;FIELD=F+0x3000;GAME=F+0x4000
DATA=F+0x5000;EVENT=F+0x6000;CHILD=EVENT+0x100;SETUP=F+0x7000
PARTY=F+0x8000;BCOPY=PARTY+0x100;MON=PARTY+0x400;VM=F+0x9000;ENV=VM+0x100;PARAM=VM+0x200;SCRIPT=VM+0x300
path=PACKAGE_BUILD/f'PokewebFollowingField{MODULE_SUFFIX}'
audit(path.with_suffix('.dll'),path.with_suffix('.elf'))
uc.mem_write(BASE,bytes(relocate(path.with_suffix('.dll'),BASE,load_dependencies(uc))))
_,funcs=elf_functions(path.with_suffix('.elf'))
addr=lambda name:BASE+(funcs[name][0]&~1)
get=lambda x:struct.unpack('<I',uc.mem_read(x,4))[0]
def put(x,y):uc.mem_write(x,struct.pack('<I',y))
params={};mismatch=False;recalls=0;mounted=False
registers=[UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3]
services={a(x):x for x in (0x0201735c,0x0201fe24,0x0201ff34,0x0201cd24,0x02153ee0)}
def spy(u,pc,size,user):
 global recalls
 r=[u.reg_read(x) for x in registers];result=0
 if pc==RECALL:recalls+=1
 elif 'fwland_active' in funcs and pc==addr('fwland_active'):result=int(mounted)
 elif pc in services:
  fn=services[pc]
  if fn==0x0201735c:result=PARTY
  elif fn==0x0201fe24:result=2
  elif fn==0x0201ff34:result=MON+(4 if r[0]==BCOPY else 0)
  elif fn==0x0201cd24:result=params.get(r[1],0)+(1 if mismatch and r[0]==MON+4 and r[1]==0 else 0)
  elif fn==0x02153ee0:result=EVENT
 else:return
 assert u.reg_read(UC_ARM_REG_SP)%8==0
 u.reg_write(UC_ARM_REG_R0,result);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
uc.hook_add(UC_HOOK_CODE,spy)
def call(name,args=()):
 for reg,value in zip(registers,list(args)+[0]*4):uc.reg_write(reg,value)
 uc.reg_write(UC_ARM_REG_SP,0x023f0000);uc.reg_write(UC_ARM_REG_LR,STOP|1)
 uc.emu_start(addr(name)|1,STOP,count=100000)
 assert uc.reg_read(UC_ARM_REG_PC)==STOP,(name,hex(uc.reg_read(UC_ARM_REG_PC)))
 assert uc.reg_read(UC_ARM_REG_SP)==0x023f0000
 return uc.reg_read(UC_ARM_REG_R0)
def reset(wild=False):
 global params,mismatch,recalls,mounted
 call('fws_detach');uc.mem_write(F,bytes(0xa000));params={5:25,0x6f:0,0x4c:0,0xa0:100,0:123,7:456};mismatch=False;recalls=0;mounted=False
 put(F,2);put(F+20,1);put(F+24,ACTOR)
 # Normal automatic following leaves the manual slot override at -1.
 # The reported wild encounter used this value with a healthy slot-zero lead.
 uc.mem_write(F+28,struct.pack('<HBBBBHH2xII',25,0,0,0,0,100,100,123,456));uc.mem_write(F+48,b'\xff\1')
 put(ACTOR,1);put(ACTOR+136,SYS);put(SYS+64,FIELD);put(FIELD+4,GAME);put(FIELD+8,DATA)
 put(SETUP,int(not wild));put(SETUP+0x24,BCOPY)
 uc.mem_write(EVENT,struct.pack('<5I',0,a(0x021684fd if wild else 0x02168bed),0,EVENT+32,GAME))
 uc.mem_write(EVENT+32,struct.pack('<3I',GAME,SETUP if wild else DATA,0 if wild else SETUP))
 put(GAME+0x18,EVENT)
 assert call('fws_attach',[SYS,F,1,RECALL|1])==1
for wild in (False,True):
 for _ in range(100):
  reset(wild);assert call('fws_poll')==1 and get(SETUP+0x9c)==0x80000000 and recalls==0
  uc.mem_write(CHILD,struct.pack('<5I',EVENT,STOP+9,0,0,GAME));put(GAME+0x18,CHILD)
  assert call('fws_poll')==1 and call('fws_battle_entry')==1 and recalls==0
  put(CHILD,0);assert call('fws_poll')==2 and recalls==1 and get(SETUP+0x9c)==0
 # Explicit L/R selection of slot zero also qualifies.
 reset(wild);uc.mem_write(F+48,b'\0')
 assert call('fws_poll')==1 and get(SETUP+0x9c)==0x80000000 and recalls==0
 for mode in ('slot1','slot2','slot3','slot4','slot5','invalid_slot','hidden','absent','egg','fainted','identity','double','triple','rotation','replay','partner','network','facility','mounted'):
  if mode=='mounted' and 'fwland_active' not in funcs:continue
  reset(wild)
  if mode.startswith('slot'):uc.mem_write(F+48,bytes([int(mode[4:])]))
  elif mode=='invalid_slot':uc.mem_write(F+48,b'\xfe')
  elif mode=='hidden':put(ACTOR,5)
  elif mode=='absent':put(F+24,0)
  elif mode=='egg':params[0x4c]=1
  elif mode=='fainted':params[0xa0]=0
  elif mode=='identity':mismatch=True
  elif mode in ('double','triple','rotation'):put(SETUP+4,('double','triple','rotation').index(mode)+1)
  elif mode=='replay':put(SETUP+0x20,0x1000000)
  elif mode=='partner':put(SETUP+0x20,0x10000)
  elif mode=='network':put(SETUP+0x1c,1)
  elif mode=='facility':put(SETUP,2)
  elif mode=='mounted':mounted=True
  assert call('fws_poll')==2 and recalls==1 and get(SETUP+0x9c)==0,(wild,mode)
 # Free event clears the identity without following a freed setup pointer.
 reset(wild);assert call('fws_poll')==1
 call('fws_observe',[2,EVENT,0]) # FWE_FREE, before native deallocation.
 call('fws_detach');reset(wild);uc.mem_write(F+48,b'\1')
 assert call('fws_poll')==2 and not get(SETUP+0x9c)
# Conditional script admission must not weaken the ordinary command policy.
for opcode in (0x85,0x174,0x297):
 for slot in (-1,0,1,2,3,4,5):
  reset();uc.mem_write(F+48,bytes([slot&255]));put(GAME+0x18,0)
  put(VM+0x2c,ENV);put(ENV+0x20,PARAM);put(PARAM,SCRIPT)
  call('fws_observe',[3,VM,opcode])
  assert recalls==int(slot>0),(hex(opcode),slot,recalls)
print(f'{MODULE_SUFFIX}: field-to-battle handoff passed 200 automatic-selection cycles, explicit slot zero, later-slot/visibility/identity/HP/Egg gates, all non-single modes, cancellation, and script admission; no resident token or heap allocation.')
