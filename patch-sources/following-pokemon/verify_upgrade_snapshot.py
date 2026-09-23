"""Regression using copied melonDS RAM and native heap routines, not a game run.

FS alone is supplied from the exported ROM. Neither the input state nor ROM is
modified; no emulator is started. Candidate modules live in isolated test RAM.
"""
import argparse, hashlib, json, struct
from pathlib import Path
import ndspy.rom
from unicorn import UC_HOOK_CODE
from verify_packaged import *

def verify(state,rom_path):
 raw=state.read_bytes()
 assert raw[:4]==b'MELN' and struct.unpack_from('<H',raw,4)[0]==14
 assert struct.unpack_from('<I',raw,8)[0]==len(raw)
 at=16;sections={}
 while at<len(raw):
  n=struct.unpack_from('<I',raw,at+4)[0];assert n>=16 and at+n<=len(raw)
  sections[raw[at:at+4]]=raw[at+16:at+n];at+=n
 ram=sections[b'NDSG'][4:0x400004];assert len(ram)==0x400000
 rom=ndspy.rom.NintendoDSRom.fromFile(rom_path)
 files={f'rom:/following/{name}':bytes(rom.getFileByName(f'following/{name}')) for name in ['native.bin','runtime-registry.bin']}
 # Execute only explicitly verified native routines from the captured binary.
 native_contract=json.loads((HERE/'upgrade-contract.json').read_text())
 for adapter in native_contract['nativeAdapters']:
  offset=adapter['address']-0x02000000;expect=bytes.fromhex(adapter['expectedHex'])
  assert ram[offset:offset+len(expect)]==expect,adapter['id']
 uc=Uc(UC_ARCH_ARM,UC_MODE_THUMB);uc.ctl_set_cpu_model(UC_CPU_ARM_946)
 uc.mem_map(0x02000000,0x1000000);uc.mem_write(0x02000000,ram)
 base=0x02480000;stop=0x02f00000;stack=0x02fff000
 dll=PACKAGE_BUILD/'PokewebFollowingFieldW2.dll'
 for name in ['PokewebFollowingFieldW2','PokewebFollowingCoreW2','PokewebFollowingEventsW2']:
  assert bytes(rom.getFileByName('patches/'+name+'.dll'))==(PACKAGE_BUILD/(name+'.dll')).read_bytes()
 uc.mem_write(base,bytes(relocate(dll,base,load_dependencies(uc,0x02600000,0x02620000))))
 funcs=elf_functions(PACKAGE_BUILD/'PokewebFollowingFieldW2.elf')[1];exports=module_exports(dll,base)
 addr=lambda name:exports[symbol_hash(name)]
 get=lambda p:struct.unpack('<I',uc.mem_read(p,4))[0]
 regs=[UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3]
 def call(fn,*args):
  for reg,value in zip(regs,args):uc.reg_write(reg,value)
  uc.reg_write(UC_ARM_REG_SP,stack);uc.reg_write(UC_ARM_REG_LR,stop|1)
  uc.emu_start(fn,stop,count=50000000)
  assert uc.reg_read(UC_ARM_REG_PC)==stop and uc.reg_read(UC_ARM_REG_SP)==stack
  return uc.reg_read(UC_ARM_REG_R0)
 paths={}
 sites={0x02070580,0x02039dc8,0x02039e58,0x02070ca8,0x02070ecc,0x02070dec,0x02070e6c,0x02070de0,(base+funcs['FollowingOriginalUnload'][0])&~1}
 def fs(u,at,size,_):
  args=[u.reg_read(r) for r in regs];value=0
  if at in (0x02039dc8,0x02039e58):raise AssertionError('Streamed registry must not allocate heap memory')
  if at==0x02070580:
   assert args[1:3]==[14,1]
   off,origin=struct.unpack('<iI',u.mem_read(get(args[0]+16),8));assert origin==0 and off>=0
   paths[args[0]][1]=off;value=1
  elif at==0x02070ecc:
   path=bytes(u.mem_read(args[1],100)).split(b'\0')[0].decode();assert path in files
   paths[args[0]]=[path,0];value=1
  elif at==0x02070dec:value=len(files[paths[args[0]][0]])
  elif at==0x02070e6c:
   path,pos=paths[args[0]];contents=files[path];value=min(args[2],len(contents)-pos);u.mem_write(args[1],contents[pos:pos+value]);paths[args[0]][1]+=value
  elif at==0x02070de0:del paths[args[0]];value=1
  u.reg_write(UC_ARM_REG_R0,value);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
 for site in sites:uc.hook_add(UC_HOOK_CODE,fs,begin=site,end=site)
 before=call(0x02039f8d,1);peak=before;registry=files['rom:/following/runtime-registry.bin']
 for cycle in range(3):
  assert call(base+funcs['config'][0])==1
  assert get(addr('FollowingConfigDebug')+8)==7
  remaining=call(0x02039f8d,1);assert remaining==before;peak=min(peak,remaining)
  assert call(base+funcs['config'][0])==1 and call(0x02039f8d,1)==remaining
  call(base+funcs['FollowingUnload'][0],0,0)
  assert get(addr('fwfield_pageCount'))==0 and not paths and call(0x02039f8d,1)==before
 return dict(stateSha256=hashlib.sha256(raw).hexdigest(),romRegistryBytes=len(registry),registryHeapAllocations=0,pageBytes=1024,heapFreeBefore=before,
             heapFreeWhileLoaded=peak,heapFreeAfter=call(0x02039f8d,1),nativeHeapCycles=3,
             filesystem='Mocked using exported ROM files',nativeHeap='Captured ARM9 code and heap metadata executed',
             emulatorExecuted=False,hardwareTested=False)
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('state',type=Path);p.add_argument('rom',type=Path);p.add_argument('--report',type=Path);a=p.parse_args()
 result=verify(a.state,a.rom);output=json.dumps(result,indent=2)+'\n'
 if a.report:a.report.write_text(output)
 print(output)
