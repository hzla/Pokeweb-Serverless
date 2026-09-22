"""Check and execute packaged DLL instructions, not GNU linker's ELF veneers.

Native game services are not called. This is a CPU-level regression for the
undefined Thumb BLX found in the human-supplied melonDS freeze states.
"""
import argparse,math,random,struct,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
import os
PACKAGE_BUILD=Path(os.environ.get('FOLLOWING_BUILD_DIR',HERE/'build'))
sys.path.insert(0,str(HERE/'build/python'))
from elftools.elf.elffile import ELFFile
import capstone
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_THUMB
from unicorn.arm_const import *

def read_module(path):
 data=Path(path).read_bytes()
 def u32(at):return struct.unpack_from('<I',data,at)[0]
 if data[:4]!=b'DLXF':raise ValueError('Expected DLXF')
 header=u32(8);info=header+u32(header+8)
 syms=header+u32(info+4);rel=header+u32(info+8)
 symbols=[struct.unpack_from('<HHIBBH',data,syms+24+i*12) for i in range(u32(syms+20))]
 relocations=[]
 for field in (8,12,16):
  off=u32(rel+field)
  if off==0xffffffff:continue
  at=header+off
  relocations.extend(struct.unpack_from('<IBBH',data,at+4+i*8) for i in range(u32(at)))
 return bytearray(data[u32(info+16):u32(info+16)+u32(info+20)]),u32(header+12),symbols,relocations

def symbol_hash(name):
 value=0x811c9dc5
 for c in name:value=((value^ord(c))*16777619)&0xffffffff
 return value

def module_exports(path,base):
 data=Path(path).read_bytes();get=lambda at:struct.unpack_from('<I',data,at)[0]
 header=get(8);info=header+get(header+8);table=header+get(info+4)
 first,count=struct.unpack_from('<HH',data,table+8);hashes=header+get(table+16)
 symbols=read_module(path)[2]
 result={}
 for i in range(count):
  _,_,address,typ,flags,_=symbols[first+i]
  result[get(hashes+i*4)]=(address if flags&4 else base+address)|(1 if typ==3 else 0)
 return result

def verify_imports(field,events,core):
 imports={s[2] for s in read_module(field)[2] if s[4]&2}
 assert imports=={symbol_hash('FollowingEventsAPI'),symbol_hash('FollowingCoreAPI')},imports
 assert imports<=module_exports(events,0).keys()|module_exports(core,0).keys()
 assert not any(s[4]&2 for s in read_module(events)[2])
 assert not any(s[4]&2 for s in read_module(core)[2])

def relocate(path,base,imports=None):
 code,bss,symbols,rels=read_module(path);loaded=code+bytes(bss)
 for at,module,kind,idx in rels:
  if module!=255:continue
  _,_,address,typ,flags,_=symbols[idx]
  assert kind==0,'new internal relocation type requires coverage'
  if flags&2:
   assert imports and address in imports,'unresolved import'
   target=imports[address]
  else:target=(address if flags&4 else base+address)|(1 if typ==3 else 0)
  struct.pack_into('<I',loaded,at,target)
 return loaded

def load_events(uc,base=0x022c0000):
 dll=PACKAGE_BUILD/'PokewebFollowingEventsW2.dll'
 audit(dll,PACKAGE_BUILD/'PokewebFollowingEventsW2.elf')
 uc.mem_write(base,bytes(relocate(dll,base)))
 return module_exports(dll,base)

def load_dependencies(uc,events_base=0x022c0000,core_base=0x022d0000):
 events=PACKAGE_BUILD/'PokewebFollowingEventsW2.dll';core=PACKAGE_BUILD/'PokewebFollowingCoreW2.dll'
 audit(events,PACKAGE_BUILD/'PokewebFollowingEventsW2.elf');audit(core,PACKAGE_BUILD/'PokewebFollowingCoreW2.elf')
 uc.mem_write(events_base,bytes(relocate(events,events_base)))
 uc.mem_write(core_base,bytes(relocate(core,core_base)))
 exports=module_exports(events,events_base);exports.update(module_exports(core,core_base));return exports

def install_hooks(uc,path,base,imports=None):
 """Apply final RPM external relocations with the same Thumb BL arithmetic."""
 loaded=relocate(path,base,imports);_,_,symbols,rels=read_module(path)
 for at,module,kind,idx in rels:
  if module==255:continue
  _,size,address,typ,flags,_=symbols[idx]
  assert not flags&6
  if kind==5:uc.mem_write(at,bytes(loaded[address:address+size]))
  elif kind==1:
   delta=(base+address)-(at+4)
   assert typ==3 and delta%2==0 and -(1<<22)<=delta<(1<<22)
   uc.mem_write(at,struct.pack('<HH',0xf000|((delta>>12)&0x7ff),0xf800|((delta>>1)&0x7ff)))
  else:raise AssertionError(('uncovered external relocation',kind))
 # Earlier harness phases may have translated native addresses while a spy
 # immediately returned. Invalidate those translations after installing code.
 uc.ctl_remove_cache(0x02000000,0x02400000)

def elf_functions(path):
 with Path(path).open('rb') as stream:
  elf=ELFFile(stream);text=elf.get_section_by_name('.text').data()
  functions={s.name:(int(s['st_value']),int(s['st_size'])) for s in elf.get_section_by_name('.symtab').iter_symbols()
   if s['st_info']['type']=='STT_FUNC' and s['st_shndx']!='SHN_UNDEF'}
 return text,functions

def audit(dll,elf):
 code,bss,symbols,rels=read_module(dll);original,functions=elf_functions(elf)
 cs=capstone.Cs(capstone.CS_ARCH_ARM,capstone.CS_MODE_THUMB)
 count=0
 for name,(address,size) in functions.items():
  if not address&1:continue
  start=address&~1
  for ins in cs.disasm(original[start:start+size],start):
   if ins.size!=4 or ins.mnemonic not in ('bl','blx'):continue
   high,low=struct.unpack_from('<HH',code,ins.address)
   if high&0xf800!=0xf000 or low&0xf800 not in (0xe800,0xf800):
    raise ValueError(f'Unexpected packaged branch in {name} at {ins.address:#x}')
   if low&0xf800==0xe800 and low&1:
    raise ValueError(f'Invalid ARMv5 Thumb BLX in packaged {name} at {ins.address:#x}: {high:04x} {low:04x}')
   count+=1
 return code,bss,symbols,rels,functions,count

def execute(dll,elf):
 code,bss,symbols,rels,functions,count=audit(dll,elf)
 args_regs=[UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3]
 saved_regs=[UC_ARM_REG_R4,UC_ARM_REG_R5,UC_ARM_REG_R6,UC_ARM_REG_R7,UC_ARM_REG_R8,UC_ARM_REG_R9,UC_ARM_REG_R10,UC_ARM_REG_R11]
 stop=0x02008000;stack=0x023f0000;sample=0x02208000;other=sample+64;trail=0x02210000;out=sample+128
 cases=[(0,0),(1,1),(0xffff,0xffff),(0x10000,0x10000),(0xffffffff,0xffffffff),(0x123456789abcdef0,0xfedcba9876543210)]
 randomizer=random.Random(946)
 cases.extend((randomizer.getrandbits(64),randomizer.getrandbits(64)) for _ in range(100))
 for base in (0x02300000,0x023b9090,0x023b9094):
  uc=Uc(UC_ARCH_ARM,UC_MODE_THUMB);uc.ctl_set_cpu_model(UC_CPU_ARM_946);uc.mem_map(0x02000000,0x400000)
  loaded=relocate(dll,base,load_dependencies(uc))
  uc.mem_write(base,bytes(loaded))
  def call(name,args):
   for reg,value in zip(args_regs,list(args)+[0]*4):uc.reg_write(reg,value)
   for i,reg in enumerate(saved_regs):uc.reg_write(reg,0x12340000+i)
   uc.reg_write(UC_ARM_REG_SP,stack);uc.reg_write(UC_ARM_REG_LR,stop|1)
   uc.emu_start((base+functions[name][0])|1,stop,count=1000000)
   assert uc.reg_read(UC_ARM_REG_PC)==stop,(name,'did not return')
   assert uc.reg_read(UC_ARM_REG_SP)==stack
   assert all(uc.reg_read(reg)==0x12340000+i for i,reg in enumerate(saved_regs))
   return uc.reg_read(UC_ARM_REG_R0),uc.reg_read(UC_ARM_REG_R1)
  for a,b in cases:
   lo,hi=call('__aeabi_lmul',[a&0xffffffff,a>>32,b&0xffffffff,b>>32])
   assert lo+(hi<<32)==(a*b)&0xffffffffffffffff
  for a,b in [(0,1),(0xffffffff,1),(0xffffffff,0xffffffff),(0xffffffff,0x80000000),(100,3)]+[(randomizer.getrandbits(32),randomizer.randrange(1,1<<32)) for _ in range(100)]:
   assert call('__aeabi_uidivmod',[a,b])==divmod(a,b)
   assert call('__aeabi_uidiv',[a,b])[0]==a//b
  # The native actor's animation is unpaused only for ordinary visible follow.
  # Check every state and both independent presentation guards in final RPM.
  for state in range(7):
   for visible in (0,1):
    for effect_busy in (0,1):
     assert call('fw_idle_animation_enabled',[state,visible,effect_busy])[0]==int(state==2 and visible and not effect_busy)
  def point(ptr,x,z):uc.mem_write(ptr,struct.pack('<iiiIIHHBBH',x,0,z,1,1,0,0xffff,0,3,1))
  # Distance helpers may inline under -Os; verify through the exported trail API.
  call('fw_trail_clear',[trail]);point(sample,0,0)
  assert call('fw_trail_push',[trail,sample,out,6])[0]==0
  # The frozen state reached the second stationary sample before any movement.
  assert call('fw_trail_push',[trail,sample,out,6])[0]==0
  for x in range(1,33):
   point(sample,x*4096,0);result=call('fw_trail_push',[trail,sample,out,6])[0]
   assert result==int(x>=22)
   if x>=22:assert struct.unpack('<i',uc.mem_read(out,4))[0]==(x-22)*4096
  # Both cardinal axes, speeds, reversals and bends execute in the final RPM.
  for axis in (0,1):
   for sign in (-1,1):
    for speed in (4096,8192):
     call('fw_trail_clear',[trail]);gap=(16 if axis else 22)*4096
     for v in range(0,80*4096+1,speed):
      point(sample,0 if axis else sign*v,sign*v if axis else 0)
      result=call('fw_trail_push',[trail,sample,out,6])[0]
      assert result==int(v>=gap)
      if result:assert struct.unpack('<iii',uc.mem_read(out,12))[2 if axis else 0]==sign*(v-gap)
  call('fw_trail_clear',[trail]);poses=[];last=-1;x=z=0
  for i in range(180):
   if i:
    if (i//30)%2:x+=4096
    else:z+=4096
   point(sample,x,z);poses.append((x,0,z));result=call('fw_trail_push',[trail,sample,out,6])[0]
   assert result in (0,1)
   if result:
    pose=struct.unpack('<iii',uc.mem_read(out,12));at=poses.index(pose)
    assert at>=last and (last<0 or at-last<=2);last=at
 print(f'Packaged DLL: {count} immediate calls valid; multiply/divide, directional idle gate, stationary startup and walking trail pass at three load addresses. No DS game run.')

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--dll',type=Path,default=PACKAGE_BUILD/'PokewebFollowingFieldW2.dll')
 parser.add_argument('--elf',type=Path,default=PACKAGE_BUILD/'PokewebFollowingFieldW2.elf')
 args=parser.parse_args();execute(args.dll,args.elf)
