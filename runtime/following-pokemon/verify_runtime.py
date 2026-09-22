"""Execute the compiled core and veneers on ARM946 emulation, not the game."""
from pathlib import Path
import json
import struct
import subprocess
import zlib
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent/"build/python"))
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB
from unicorn.arm_const import UC_CPU_ARM_946, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_R4, UC_ARM_REG_R5, UC_ARM_REG_R6, UC_ARM_REG_R7, UC_ARM_REG_R8, UC_ARM_REG_R9, UC_ARM_REG_R10, UC_ARM_REG_R11, UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_PC
from build import HERE, BUILD, TOOLS
regs=[UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3]
preserved=[UC_ARM_REG_R4,UC_ARM_REG_R5,UC_ARM_REG_R6,UC_ARM_REG_R7,UC_ARM_REG_R8,UC_ARM_REG_R9,UC_ARM_REG_R10,UC_ARM_REG_R11]
STOP=0x02008000; STACK=0x023f0000; BASE=0x02300000
linked=BUILD/'core.linked.elf'
subprocess.run([str(TOOLS/'arm-none-eabi-ld'),'-Ttext',hex(BASE),'-Tdata',hex(BASE+0x8000),'-e','PokewebFollowingObjectRow',str(BUILD/'PokewebFollowingCoreW2.elf'),'-o',str(linked)],check=True)
uc=Uc(UC_ARCH_ARM,UC_MODE_THUMB);uc.ctl_set_cpu_model(UC_CPU_ARM_946);uc.mem_map(0x02000000,0x400000)
symbols={}
with linked.open('rb') as stream:
    elf=ELFFile(stream)
    for section in elf.iter_sections():
        if section['sh_flags']&2 and section['sh_type']!='SHT_NOBITS':uc.mem_write(section['sh_addr'],section.data())
    for symbol in elf.get_section_by_name('.symtab').iter_symbols():
        if symbol.name and symbol['st_shndx']!='SHN_UNDEF':symbols[symbol.name]=symbol['st_value']
def call(name,args=()):
    for r in regs:uc.reg_write(r,0)
    for r,v in zip(regs,args):uc.reg_write(r,v)
    for i,r in enumerate(preserved):uc.reg_write(r,0x12340000+i)
    uc.reg_write(UC_ARM_REG_SP,STACK);uc.reg_write(UC_ARM_REG_LR,STOP|1)
    uc.emu_start((symbols[name] if isinstance(name,str) else name)|1,STOP,count=10000000)
    assert uc.reg_read(UC_ARM_REG_PC)==STOP, 'Core did not return'
    assert uc.reg_read(UC_ARM_REG_SP)==STACK, 'Core unbalanced stack'
    assert all(uc.reg_read(r)==0x12340000+i for i,r in enumerate(preserved)), 'Callee-saved register clobbered'
    return uc.reg_read(UC_ARM_REG_R0)
contract=json.loads((HERE/'contract.json').read_text())
lookup=contract['hooks'][0]
retail=0x0200fe34
uc.mem_write(retail,bytes.fromhex(lookup['expectedHex']))
# Execute retail and compiled code for EVERY 16-bit object code.
for code in range(65536):
    expected=call(retail,(code,))
    actual=call('PokewebFollowingObjectRow',(code,))
    assert actual==expected,(code,actual,expected)
veneer=bytes(uc.mem_read(symbols['FULL_COPY_ARM9_0x0200fe34'],8))
uc.mem_write(retail,veneer)
uc.ctl_remove_cache(retail,retail+len(lookup["expectedHex"])//2)
assert call(retail,(0x1000,))==377
payload=bytearray(56);payload[:4]=b'FWDB'
struct.pack_into('<HHIHHHHHH',payload,4,1,1,len(payload),1,0,1009,975,0x3000,1008)
struct.pack_into('<HBBBBHHBBbbb',payload,32,25,0,0,0,0,1008,100,32,0,0,0,0)
struct.pack_into('<I',payload,24,zlib.crc32(payload))
ptr=0x02200000;uc.mem_write(ptr,bytes(payload))
assert call('PokewebFollowingConfigure',(ptr,len(payload),1009,975))==1
assert call(retail,(0x3000,))==1008
assert call(retail,(0x3001,))==10
payload[32]^=1;uc.mem_write(ptr,bytes(payload))
assert call('PokewebFollowingConfigure',(ptr,len(payload),1009,975))==0
assert call(retail,(0x3000,))==10
# Execute the exact FULL_COPY replacement, including its surrounding register contract.
patch=contract['hooks'][1];addr=patch['address'];size=patch['patchBytes']
actual=bytes(uc.mem_read(symbols['FULL_COPY_12_0x02167fb8'],size))
assert actual.hex()==patch['replacementHex'],actual.hex()
uc.mem_write(addr,actual)
for row in [0,1007,1008,2340,2341,5103]:
    uc.reg_write(UC_ARM_REG_R1,row*28);uc.reg_write(UC_ARM_REG_R5,ptr)
    uc.mem_write(ptr+24,struct.pack('<I',0x02210000))
    uc.reg_write(UC_ARM_REG_SP,STACK)
    uc.emu_start(addr|1,addr+size,count=4)
    assert uc.reg_read(UC_ARM_REG_R2)==4+row*28
    assert uc.reg_read(UC_ARM_REG_R0)==0x02210000
    assert uc.reg_read(UC_ARM_REG_SP)==STACK
print('Compiled ARM946 core passed: 65,536 retail comparisons, veneer ABI, registry rejection/revocation, offsets >64 KiB.')
