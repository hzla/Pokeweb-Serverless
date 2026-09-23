"""Compiled field veneer ABI and retail save-exclusion checks (not a DS game test)."""
from pathlib import Path
import struct, subprocess, sys
sys.path.insert(0,str(Path(__file__).resolve().parent/'build/python'))
from elftools.elf.elffile import ELFFile
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_THUMB,UC_HOOK_CODE
from unicorn.arm_const import *
import ndspy.rom, ndspy.codeCompression
from build import BUILD,TOOLS
from verify import verify
if len(sys.argv)!=2:raise SystemExit('Expected pinned clean ROM path')
verify(sys.argv[1])
rom=ndspy.rom.NintendoDSRom.fromFile(sys.argv[1])
arm9=ndspy.codeCompression.decompress(rom.arm9)
uc=Uc(UC_ARCH_ARM,UC_MODE_THUMB);uc.ctl_set_cpu_model(UC_CPU_ARM_946);uc.mem_map(0x02000000,0x400000)
uc.mem_write(rom.arm9RamAddress,bytes(arm9))
BASE=0x02300000;STOP=0x02008000;STACK=0x023f0000
elfpath=BUILD/'field.linked.elf'
subprocess.run([str(TOOLS/'arm-none-eabi-ld'),'-Ttext',hex(BASE),'-Tdata',hex(BASE+0x8000),'-e','FollowingUpdate',str(BUILD/'PokewebFollowingFieldW2.elf'),str(BUILD/'PokewebFollowingEventsW2.elf'),str(BUILD/'PokewebFollowingCoreW2.elf'),'-o',str(elfpath)],check=True)
symbols={}
with elfpath.open('rb') as file:
 elf=ELFFile(file)
 for sec in elf.iter_sections():
  if sec['sh_flags']&2 and sec['sh_type']!='SHT_NOBITS':uc.mem_write(sec['sh_addr'],sec.data())
 for symbol in elf.get_section_by_name('.symtab').iter_symbols():
  if symbol.name and symbol['st_shndx']!='SHN_UNDEF':symbols[symbol.name]=symbol['st_value']
preserved=[UC_ARM_REG_R4,UC_ARM_REG_R5,UC_ARM_REG_R6,UC_ARM_REG_R7,UC_ARM_REG_R8,UC_ARM_REG_R9,UC_ARM_REG_R10,UC_ARM_REG_R11]
def call(address,args):
 for r,v in zip([UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3],list(args)+[0]*4):uc.reg_write(r,v)
 for i,r in enumerate(preserved):uc.reg_write(r,0x12340000+i)
 uc.reg_write(UC_ARM_REG_SP,STACK);uc.reg_write(UC_ARM_REG_LR,STOP|1)
 uc.emu_start(address|1,STOP,count=1000000)
 assert uc.reg_read(UC_ARM_REG_PC)==STOP
 assert uc.reg_read(UC_ARM_REG_SP)==STACK
 assert all(uc.reg_read(r)==0x12340000+i for i,r in enumerate(preserved))
 return uc.reg_read(UC_ARM_REG_R0)
# Native calls are spies here: reject missing configuration and ensure the original
# actor update still executes exactly once with an aligned stack and same argument.
updates=[];saved=[];draws=[]
def spy(u,address,size,user):
 if address in (0x02070ca8,0x02070ecc,0x021667b8,0x0200fb5c,0x0200fbe4,0x0204f684):
  assert u.reg_read(UC_ARM_REG_SP)%8==0,hex(address)
  if address==0x021667b8:updates.append(u.reg_read(UC_ARM_REG_R0))
  if address==0x0200fbe4:saved.append(u.reg_read(UC_ARM_REG_R0))
  if address==0x0204f684:draws.append([u.reg_read(r) for r in [UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2]])
  if address==0x02070ecc:u.reg_write(UC_ARM_REG_R0,0)
  u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
spy_hook=uc.hook_add(UC_HOOK_CODE,spy)
system=0x02200000;field=0x02201000;uc.mem_write(system,bytes(128));uc.mem_write(system+64,struct.pack('<I',field))
call(symbols['THUMB_BRANCH_LINK_36_0x02180078'],[system]);assert updates==[system]
call(symbols['THUMB_BRANCH_LINK_36_0x0218122e'],[0x2220000,0x2221000,0x2222000]);assert draws==[[0x2220000,0x2221000,0x2222000]]
call(symbols['THUMB_BRANCH_LINK_36_0x0218119a'],[0x2220000,0x2221000,0x2222000]);assert draws==[[0x2220000,0x2221000,0x2222000]]*2
# Exact absolute veneer, cleanup, and replayed prologue, followed by a stub of the
# original epilogue. The real continuation is separately exercised by DS scenarios.
uc.mem_write(0x021801e4,bytes(uc.mem_read(symbols['FULL_COPY_36_0x021801e4'],8)))
uc.mem_write(0x021801ec,bytes.fromhex('70bd'));uc.mem_write(field+0x38,struct.pack('<I',0x12345678))
assert call(0x021801e4,[0x02202000,field])==0x12345678
# Execute the retail save-loop and iterator. Spy on per-actor serialization to
# demonstrate that the new actor's NOT_SAVE bit actually excludes it.
pool=0x02210000;output=0x02220000
uc.mem_write(system+4,struct.pack('<H',3));uc.mem_write(system+0x1c,struct.pack('<I',pool))
for i,flag in enumerate([0,1<<20,0]):uc.mem_write(pool+i*256,struct.pack('<II',1,flag))
call(0x0200fb70,[system,output]);assert saved==[pool,pool+512],saved
print('Field checks passed: update/draw forwarding and ABI, unload veneer/prologue/ABI, retail NOT_SAVE exclusion.')
