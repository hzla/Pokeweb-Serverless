"""Exercise the packaged ARM9 forwarding layer before and after field teardown."""
import struct
from pathlib import Path
from unicorn.arm_const import UC_ARM_REG_LR, UC_ARM_REG_PC, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_SP, UC_CPU_ARM_946
from verify_packaged import (Uc, UC_ARCH_ARM, UC_MODE_THUMB, load_dependencies,
                             module_exports, read_module, symbol_hash, PACKAGE_BUILD, MODULE_SUFFIX)

core=PACKAGE_BUILD/f'PokewebFollowingCore{MODULE_SUFFIX}.dll'
events=PACKAGE_BUILD/f'PokewebFollowingEvents{MODULE_SUFFIX}.dll'
uc=Uc(UC_ARCH_ARM,UC_MODE_THUMB);uc.ctl_set_cpu_model(UC_CPU_ARM_946)
uc.mem_map(0x02000000,0x400000)
exports=load_dependencies(uc)
base_core=0x022d0000;base_events=0x022c0000
core_exports=module_exports(core,base_core)
event_exports=module_exports(events,base_events)
addr=lambda name:core_exports[symbol_hash(name)]
get=lambda p:struct.unpack('<I',uc.mem_read(p,4))[0]
put=lambda p,v:uc.mem_write(p,struct.pack('<I',v))
active=addr('active')
stop=0x02008000;stack=0x023f0000
def call(target,*args):
 for reg,value in zip((UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3),(*args,0,0,0,0)):
  uc.reg_write(reg,value)
 uc.reg_write(UC_ARM_REG_SP,stack)
 if len(args)>4:put(stack,args[4])
 uc.reg_write(UC_ARM_REG_LR,stop|1)
 uc.emu_start(target|1,stop,count=100000)
 assert uc.reg_read(UC_ARM_REG_PC)==stop and uc.reg_read(UC_ARM_REG_SP)==stack
 return uc.reg_read(UC_ARM_REG_R0)

# No field module is attached: all four ARM9 entries must forward natively.
uc.mem_write(0x020159e8,b'\x39\x20\x70\x47') # fetch returns 57
uc.mem_write(0x0203a278,b'\x58\x20\x70\x47') # VM destructor stub
uc.mem_write(0x02016d10,b'\x10\xbd') # native free continuation pops r4,pc
uc.mem_write(0x02201000,b'\x01\x20\x70\x47') # event callback returns 1
event=0x02202000
put(event+4,0x02201001);put(event+12,0x02203000)
assert call(addr('FollowingResidentOpcode'),event)==57
assert call(addr('FollowingResidentCallback'),event)==1
assert call(addr('FollowingResidentFree'),event)==0x02203000
assert call(addr('FollowingResidentVmFree'),event)==88

# The overlay-scoped bridge installs its callbacks only while bound to a
# field, then clears them on normal unbind and on module unload.
api=event_exports[symbol_hash('FollowingEventsAPI')]
bind=get(api+8);unbind=get(api+12)
assert call(bind,0x02204000,0x02205000,1,0x02206001,0)==1
assert all(get(active+offset)>=base_events for offset in (8,12,16,20))
call(unbind,0x02204000,1)
assert all(get(active+offset)==0 for offset in (8,12,16,20))
assert call(bind,0x02204000,0x02205000,2,0x02206001,0)==1
assert all(get(active+offset)>=base_events for offset in (8,12,16,20))
restore=0x02208000;restored=0x02208100
expected=struct.pack('<I',0x52535746)+bytes(range(4,60))
uc.mem_write(restore,expected)
call(get(api+16),0x02204000,2,restore)
if 'Base' not in MODULE_SUFFIX:
 put(0x02204000+8,0x02205000)
 mount=0x02208200;mounted=0x02208300
 expected_mount=struct.pack('<I',0x02205000)+bytes(range(4,44))
 uc.mem_write(mount,expected_mount)
 call(get(api+28),0x02204000,2,mount)
call(unbind,0x02204000,2)
assert call(event_exports[symbol_hash('DllMain')],0,0,1)==0
assert all(get(active+offset)==0 for offset in (8,12,16,20))
assert call(addr('FollowingResidentOpcode'),event)==57
# Field and event images may both unload while these transition snapshots
# remain in the core. Rebinding a fresh event bridge must recover them once.
event_code,event_bss,_,_=read_module(events)
uc.mem_write(base_events+len(event_code),bytes(event_bss))
assert call(bind,0x02204000,0x02205000,3,0x02206001,0)==1
assert call(get(api+20),restored)==1
assert uc.mem_read(restored,60)==expected
assert call(get(api+20),restored)==0
if 'Base' not in MODULE_SUFFIX:
 assert call(get(api+32),0x02205000,mounted)==1
 assert uc.mem_read(mounted,44)==expected_mount
 assert call(get(api+32),0x02205000,mounted)==0
call(unbind,0x02204000,3)
print(f'{MODULE_SUFFIX}: resident ARM9 forwarding, event unload and transition-token continuity passed; no game emulator run.')
