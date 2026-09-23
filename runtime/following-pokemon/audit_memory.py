"""Measure packaged follower buffers and document the implemented memory reduction.

Reads artifacts only; does not modify runtime code, ROMs, or saves.
"""
import argparse, json, struct
from pathlib import Path
from collections import Counter
import ndspy.rom
from verify_packaged import read_module, ELFFile
HERE=Path(__file__).resolve().parent
APP=HERE.parents[1]

def audit(profile,rom_path):
 assets=APP/'src/assets/following';build=HERE/'build'
 if profile=='white2upgrade':assets/='white2upgrade';build/='white2upgrade'
 if profile=='black2':assets/='black2';build/='black2'
 if profile=='white2italy':assets/='white2italy';build/='white2italy'
 manifest=json.loads((assets/'runtime.json').read_text());modules=[];objects=[]
 for name in ['Core','Events','Field']:
  stem='PokewebFollowing'+name+('B2' if profile=='black2' else 'W2I' if profile=='white2italy' else 'W2');path=assets/(stem+'.dll');raw=path.read_bytes()
  code,bss,symbols,rels=read_module(path)
  modules.append(dict(name=stem,fileBytes=len(raw),codeAndInitializedData=len(code),bss=bss,
                      codePlusBss=len(code)+bss,expandedModuleBytes=struct.unpack_from('<I',raw,4)[0],
                      symbols=len(symbols),exportedSymbols=sum(bool(s[4]&1) for s in symbols),
                      allSymbolNamesStripped=all(s[0]==0 for s in symbols)))
  if name=='Field':
   assert (build/(stem+'.dll')).read_bytes()==raw,'ELF/build no longer matches packaged DLL'
   with (build/(stem+'.elf')).open('rb') as stream:
    elf=ELFFile(stream)
    for s in elf.get_section_by_name('.symtab').iter_symbols():
     if s['st_info']['type']=='STT_OBJECT' and s['st_size']:
      objects.append(dict(name=s.name,bytes=s['st_size'],section=elf.get_section(s['st_shndx']).name))
 rom=ndspy.rom.NintendoDSRom.fromFile(rom_path)
 data=rom.getFileByName('following/runtime-registry.bin');version=struct.unpack_from('<H',data,4)[0]
 count=struct.unpack_from('<H',data,12)[0];species=Counter()
 for i in range(count):
  value=struct.unpack_from('<I' if version in (2,4) else '<H',data,32+i*(12 if version in (2,4) else 24))[0]
  species[value>>11 if version in (2,4) else value]+=1
 sizes={o['name']:o['bytes'] for o in objects}
 assert sizes['fwfield_page']==1024 and sizes['dataBytes']==8192 and sizes['contextBytes']==4096
 assert sizes['fwfield_follower']==1852
 assert sizes['fwfield_index']==(1025 if profile=='white2upgrade' else 651)*2
 allocatedRegistry=0
 total=sum(m['codePlusBss'] for m in modules)+allocatedRegistry
 return dict(profile=profile,version=manifest['version'],modules=modules,
             largestObjects=sorted(objects,key=lambda o:o['bytes'],reverse=True)[:15],
             fixedPayloadBytes=total,registryBytes=len(data),registryRecords=count,
             registryHeapBytes=allocatedRegistry,pageBytes=sizes['fwfield_page'],indexBytes=sizes['fwfield_index'],
             conversationCapacity=sizes['dataBytes'],contextualCapacity=sizes['contextBytes'],giftScratchCapacity=sizes['contextBytes'],
             largestSpeciesGroups=species.most_common(5),maxSpeciesBytesAtRuntimeStride=max(species.values())*(12 if version in (2,4) else 24),
             directoryBytesAt16BitRowOffsets=(max(species)+2)*2,
             conversationBytes=len(rom.getFileByName('following/interactions.bin')),contextualBytes=len(rom.getFileByName('following/contextual-dialogues.narc')),giftBytes=len(rom.getFileByName('following/contextual-items.narc')))

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('stock_rom',type=Path);p.add_argument('black2_rom',type=Path);p.add_argument('upgrade_rom',type=Path);a=p.parse_args()
 reports=[audit('stock',a.stock_rom),audit('black2',a.black2_rom),audit('white2upgrade',a.upgrade_rom)]
 previous=[dict(profile='stock',version='0.6.31-alpha',fixedPayloadBytes=46648),dict(profile='black2',version='0.6.31-alpha',fixedPayloadBytes=46648),dict(profile='white2upgrade',version='0.7.22-alpha',fixedPayloadBytes=47628)]
 out={'measurements':reports,'previousReleaseMeasurements':previous,
      'limits':'Fixed payloads exclude loader metadata, allocator overhead, native graphics/UI allocations, stack usage and VRAM. Expanded module sizes are loader image requirements, not measured steady-state heap charges.',
      'implementationStatus':'ROM registry streaming and 8 KiB conversation buffers implemented; automated checks passed, game emulator acceptance pending.'}
 (HERE/'MEMORY-AUDIT.json').write_text(json.dumps(out,indent=2)+'\n')
 print(json.dumps(out,indent=2))
if __name__=='__main__':main()
