"""Execute final packaged streaming code with ROM-backed FS spies; no game run."""
import argparse,json,struct,zlib
from pathlib import Path
from collections import defaultdict
import ndspy.rom,ndspy.codeCompression
from unicorn import UC_HOOK_CODE
from verify_packaged import *

def verify(rom_path):
 rom=ndspy.rom.NintendoDSRom.fromFile(rom_path)
 source={f'rom:/following/{n}':bytes(rom.getFileByName(f'following/{n}')) for n in ['native.bin','runtime-registry.bin']}
 data=source['rom:/following/runtime-registry.bin'];version=struct.unpack_from('<H',data,4)[0];stride=12 if version in (2,4) else 24
 count,zonecount,desc,res=struct.unpack_from('<4H',data,12);maximum=1023 if version in (2,4) else 649
 rows=defaultdict(list);gaps={}
 for i in range(count):
  at=32+i*stride
  if stride==12:
   key,row=struct.unpack_from('<IH',data,at);sp=key>>11;form=(key>>3)&255;gender=(key>>1)&3;shiny=key&1
  else:sp,form,gender,shiny,_,row=struct.unpack_from('<HBBBBH',data,at)
  rows[sp].append((form,gender,shiny,row));gaps[row]=(data[at+8]>>3)&7 if stride==12 else data[at+15]
 uc=Uc(UC_ARCH_ARM,UC_MODE_THUMB);uc.ctl_set_cpu_model(UC_CPU_ARM_946);uc.mem_map(0x02000000,0x400000)
 base=0x02300000;core=0x022d0000;stop=0x02008000;stack=0x023f0000;pokemon=0x02210000
 dll=PACKAGE_BUILD/'PokewebFollowingFieldW2.dll';core_dll=PACKAGE_BUILD/'PokewebFollowingCoreW2.dll'
 for module in [dll,core_dll,PACKAGE_BUILD/'PokewebFollowingEventsW2.dll']:
  assert module.read_bytes()==bytes(rom.getFileByName('patches/'+module.name)), 'ROM/package mismatch'
 uc.mem_write(base,bytes(relocate(dll,base,load_dependencies(uc))))
 funcs=elf_functions(PACKAGE_BUILD/'PokewebFollowingFieldW2.elf')[1]
 corefuncs=elf_functions(PACKAGE_BUILD/'PokewebFollowingCoreW2.elf')[1]
 exports=module_exports(dll,base);addr=lambda n:exports[symbol_hash(n)]
 put=lambda p,v:uc.mem_write(p,struct.pack('<I',v))
 get=lambda p:struct.unpack('<I',uc.mem_read(p,4))[0]
 # Execute the verified native seek wrapper; spy only on its synchronous dispatcher.
 native=ndspy.codeCompression.decompress(rom.arm9);start=0x02070e54
 uc.mem_write(start,bytes(native[start-rom.arm9RamAddress:0x02070e6c-rom.arm9RamAddress]))
 regs=[UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3]
 def call(fn,*args):
  for reg,value in zip(regs,args):uc.reg_write(reg,value)
  uc.reg_write(UC_ARM_REG_SP,stack);uc.reg_write(UC_ARM_REG_LR,stop|1)
  uc.emu_start(fn,stop,count=50000000)
  assert uc.reg_read(UC_ARM_REG_PC)==stop and uc.reg_read(UC_ARM_REG_SP)==stack
  return uc.reg_read(UC_ARM_REG_R0)
 paths={};files=source.copy();reads=seeks=opens=closes=0;mode='ok';failAt=0
 original=(base+funcs['FollowingOriginalUnload'][0])&~1
 def fs(u,at,size,_):
  nonlocal reads,seeks,opens,closes
  args=[u.reg_read(r) for r in regs];result=0
  assert u.reg_read(UC_ARM_REG_SP)%8==0
  if at in (0x02039dc8,0x02039d9c,0x02039e58):raise AssertionError('Registry must not allocate/free heap memory')
  if at==0x02070ecc:
   name=bytes(u.mem_read(args[1],100)).split(b'\0')[0].decode();assert name in files
   if not(mode=='missing' and name.endswith('registry.bin')):paths[args[0]]=[name,0];opens+=1;result=1
  elif at==0x02070dec:result=len(files[paths[args[0]][0]])
  elif at==0x02070580:
   assert args[1:3]==[14,1],args
   off,origin=struct.unpack('<iI',u.mem_read(get(args[0]+16),8));assert origin==0 and off>=0
   seeks+=1
   if mode!='seek-failure':paths[args[0]][1]=off;result=1
  elif at==0x02070e6c:
   path,pos=paths[args[0]];contents=files[path];result=min(args[2],len(contents)-pos);reads+=1
   if path.endswith('registry.bin'):
    assert args[2]<=1024,'Unbounded read'
    if mode=='short' or (failAt and reads==failAt):result=max(0,result-1)
   u.mem_write(args[1],contents[pos:pos+result]);paths[args[0]][1]+=result
  elif at==0x02070de0:
   assert args[0] in paths;del paths[args[0]];closes+=1;result=1
  u.reg_write(UC_ARM_REG_R0,result);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
 for at in (0x02070ca8,0x02070ecc,0x02070dec,0x02070580,0x02070e6c,0x02070de0,0x02039dc8,0x02039d9c,0x02039e58,original):
  uc.hook_add(UC_HOOK_CODE,fs,begin=at,end=at)
 def config():return call(base+funcs['config'][0])
 def unload():
  call(base+funcs['FollowingUnload'][0],0,0)
  assert get(addr('fwfield_configState'))==0 and get(addr('fwfield_pageCount'))==0 and not paths
  assert call(core+corefuncs['PokewebFollowingObjectRow'][0],0x3000)==10
 def model(sp,f,g,s):
  uc.mem_write(pokemon,struct.pack('<HBBBBHH2xII',sp,f,g,s,0,30,30,1,2))
  result=call(base+funcs['model'][0],pokemon)
  if result:assert uc.mem_read(addr('fwfield_follower')+50,1)[0]==gaps[result-0x3000+1008], 'Selected appearance spacing mismatch'
  return result
 def expected(sp,f,g,s):
  variants=rows.get(sp,[])
  if not variants:return 0
  def score(e):
   ef,eg,es,_=e
   return (8 if ef==f else 0 if ef==0 else -20)+(4 if eg==g else 2 if eg==2 else -20)+(1 if es==s else -20)
  return 0x3000+max(variants,key=score)[3]-1008
 assert config()==1 and not paths
 before=(reads,seeks,opens);assert config()==1 and before==(reads,seeks,opens)
 # Every exact appearance plus fallback directions through the same packaged model selector.
 cases=0
 for sp,variants in rows.items():
  for f,g,s,row in variants:
   assert model(sp,f,g,s)==expected(sp,f,g,s),(sp,f,g,s)
   cases+=1
  for s in (0,1):assert model(sp,255,2,s)==expected(sp,255,2,s);cases+=1
 # Small groups fit one page: subsequent queries perform no filesystem operations.
 sp=next(sp for sp,v in rows.items() if len(v)*stride<=1024)
 assert model(sp,0,2,0)==expected(sp,0,2,0);before=(reads,seeks,opens)
 for _ in range(100):assert model(sp,0,2,0)==expected(sp,0,2,0)
 assert before==(reads,seeks,opens)
 assert model(0,0,0,0)==0 and model(maximum+1,0,0,0)==0
 for code in range(65536):
  want=code if code<0x179 else code-0xe87 if 0x1000<=code<0x126c else code-0x1c1b if 0x2000<=code<0x200b else 10
  if 0x3000<=code<0x3000+desc-1008:want=code-0x3000+1008
  assert call(core+corefuncs['PokewebFollowingObjectRow'][0],code)==want
 unload();assert model(sp,0,2,0)==0
 # A species can exceed the cache (Unown in stock); the prior exhaustive pass spans pages.
 # Repeat lifecycle with unchanged ABI, no retained FS handles, and no allocator calls.
 for _ in range(100):assert config()==1;unload()
 def change(payload,fix_inner=True):
  payload=bytearray(payload)
  if fix_inner:struct.pack_into('<I',payload,24,0);struct.pack_into('<I',payload,24,zlib.crc32(payload))
  files[source_key]=bytes(payload);header=bytearray(source['rom:/following/native.bin'])
  struct.pack_into('<I',header,12,len(payload));struct.pack_into('<I',header,24,zlib.crc32(payload));files['rom:/following/native.bin']=bytes(header)
 source_key='rom:/following/runtime-registry.bin';failures=0
 for failure in ('missing','short','seek-failure','inner-crc','outer-crc','flags','row','resource','duplicate','version','tail','late-read','spacing'):
  files=source.copy();mode=failure if failure in ('missing','short','seek-failure') else 'ok';bad=bytearray(data)
  if failure=='inner-crc':bad[24]^=1;change(bad,False)
  if failure=='outer-crc':bad[35]^=1;files[source_key]=bytes(bad)
  if failure=='flags':bad[32+(8 if stride==12 else 5)]=128;change(bad)
  if failure=='row':struct.pack_into('<H',bad,32+(4 if stride==12 else 6),0);change(bad)
  if failure=='resource':struct.pack_into('<H',bad,32+(6 if stride==12 else 8),res);change(bad)
  if failure=='duplicate':bad[32+stride:32+stride*2]=bad[32:32+stride];change(bad)
  if failure=='version':bad[4]=5;change(bad)
  if failure=='tail':change(bad[:-1])
  if failure=='spacing':bad[32+(8 if stride==12 else 15)]=((bad[40]&7)|56) if stride==12 else 7;change(bad)
  if failure=='late-read':failAt=reads+6
  assert config()==0,failure
  before=(reads,seeks,opens);assert config()==0 and before==(reads,seeks,opens)
  unload();failAt=0;failures+=1
 # The same packaged runtime still accepts older zero-gap registries.
 legacy=bytearray(data);legacy[4]=2 if stride==12 else 1
 for i in range(count):
  at=32+i*stride
  if stride==12:legacy[at+8]&=7
  else:legacy[at+15]=0
 savedGaps=gaps;gaps={row:0 for row in savedGaps};files=source.copy();mode='ok';change(legacy)
 assert config()==1
 for sp in rows:assert model(sp,0,2,0)==expected(sp,0,2,0)
 unload();gaps=savedGaps
 # Lookup failures after successful startup close the file and invalidate the page.
 for mode in ('short','seek-failure','missing'):
  failure=mode;mode='ok';files=source.copy();assert config()==1;mode=failure
  assert model(sp,0,2,0)==0 and get(addr('fwfield_pageCount'))==0 and not paths
  unload();failures+=1
 assert opens==closes and not paths
 # Final packaged reaction selector uses the profile roster, independent of party selection.
 reaction=bytes(rom.getFileByName('following/interactions.bin'));assert len(reaction)<=8192
 rp=0x02219000;dp=0x02218000;snap=0x0221c000;rng=0x0221c100
 uc.mem_write(rp,reaction);assert call(base+funcs['fwr_validate'][0],dp,rp,len(reaction))==1
 for species in range(maximum+3):
  snapshot=bytearray(68);struct.pack_into('<H',snapshot,0,species);struct.pack_into('<HH',snapshot,6,30,30);snapshot[24]=100
  uc.mem_write(snap,bytes(snapshot));put(rng,946)
  result=call(base+funcs['fwr_choose'][0],dp,snap,rng)
  assert (result!=0xffffffff)==(1<=species<=maximum),species
 snapshot[5]=1;struct.pack_into('<H',snapshot,0,1);uc.mem_write(snap,bytes(snapshot));assert call(base+funcs['fwr_choose'][0],dp,snap,rng)==0xffffffff

 return dict(speciesMax=maximum,exactAppearances=count,lookupCases=cases,cacheBytes=1024,indexBytes=(maximum+2)*2,
             lifecycleCycles=100,failures=failures,heapAllocations=0,balancedFileOpens=opens,balancedFileCloses=closes,
             objectMappings=65536,conversationSpeciesChecked=maximum,spacingSelectionsChecked=cases,legacyZeroSpacing=True,seekWrapper='Native instructions executed; synchronous FS dispatcher mocked',gameEmulatorRun=False)
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('rom',type=Path);p.add_argument('--report',type=Path);a=p.parse_args()
 output=json.dumps(verify(a.rom),indent=2)+'\n'
 if a.report:a.report.write_text(output)
 print(output)
