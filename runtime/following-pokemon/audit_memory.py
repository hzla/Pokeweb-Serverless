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
 assert sizes['fwfield_follower']==1856
 assert sizes['fwfield_index']==(1025 if profile=='white2upgrade' else 651)*2
 allocatedRegistry=0
 total=sum(m['codePlusBss'] for m in modules)+allocatedRegistry
 suffix='B2' if profile=='black2' else 'W2I' if profile=='white2italy' else 'W2'
 base_modules=[]
 for name in ('Events','Field'):
  stem=f'PokewebFollowing{name}{suffix}Base'
  path=assets/(stem+'.dll')
  code,bss,_,_=read_module(path)
  assert (build/'base'/(stem+'.dll')).read_bytes()==path.read_bytes(),'Base build no longer matches packaged DLL'
  base_modules.append(dict(name=stem,fileBytes=path.stat().st_size,codePlusBss=len(code)+bss))
 base_total=next(m['codePlusBss'] for m in modules if 'Core' in m['name'])+sum(m['codePlusBss'] for m in base_modules)
 surf_registry=rom.getFileByName('following/surf-registry.bin')
 surf_archive=rom.getFileByName('following/surf-mounts.narc')
 surf=dict(registryBytes=len(surf_registry),archiveBytes=len(surf_archive),
           appearances=struct.unpack_from('<H',surf_registry,8)[0],residentTextureCount=16,
           heapIndexBytes=0)
 rider=rom.getFileByName('following/land-riders.narc')
 anchors=rom.getFileByName('following/land-anchors.bin')
 land=dict(riderArchiveBytes=len(rider),anchorTableBytes=len(anchors),
           appearanceRows=struct.unpack_from('<H',anchors,6)[0],residentRiderTextures=12,
           codeAndInitializedDataBytes=next(m['codeAndInitializedData'] for m in modules if 'Field' in m['name']))
 positioning_bytes=rom.getFileByName('following/positioning.narc')
 positioning=dict(archiveBytes=len(positioning_bytes),residentCatalogBytes=0,
                  selectedLandBytes=12,selectedSurfBytes=8) if positioning_bytes else None
 return dict(profile=profile,version=manifest['version'],modules=modules,baseModules=base_modules,baseFixedPayloadBytes=base_total,fullMinusBaseBytes=total-base_total,
             surf=surf,land=land,positioning=positioning,
             largestObjects=sorted(objects,key=lambda o:o['bytes'],reverse=True)[:15],
             fixedPayloadBytes=total,registryBytes=len(data),registryRecords=count,
             registryHeapBytes=allocatedRegistry,pageBytes=sizes['fwfield_page'],indexBytes=sizes['fwfield_index'],
             conversationCapacity=sizes['dataBytes'],contextualCapacity=sizes['contextBytes'],giftScratchCapacity=sizes['contextBytes'],
             largestSpeciesGroups=species.most_common(5),maxSpeciesBytesAtRuntimeStride=max(species.values())*(12 if version in (2,4) else 24),
             directoryBytesAt16BitRowOffsets=(max(species)+2)*2,
             conversationBytes=len(rom.getFileByName('following/interactions.bin')),contextualBytes=len(rom.getFileByName('following/contextual-dialogues.narc')),giftBytes=len(rom.getFileByName('following/contextual-items.narc')))

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('stock_rom',type=Path);p.add_argument('black2_rom',type=Path);p.add_argument('upgrade_rom',type=Path);p.add_argument('italy_rom',type=Path,nargs='?');a=p.parse_args()
 reports=[audit('stock',a.stock_rom),audit('black2',a.black2_rom),audit('white2upgrade',a.upgrade_rom)]
 previous=[dict(profile='stock',version='0.6.75-alpha',fixedPayloadBytes=67956),dict(profile='black2',version='0.6.41-alpha',fixedPayloadBytes=67956),dict(profile='white2upgrade',version='0.7.36-alpha',fixedPayloadBytes=68944)]
 if a.italy_rom:
  reports.append(audit('white2italy',a.italy_rom))
  previous.append(dict(profile='white2italy',version='0.6.42-alpha',fixedPayloadBytes=68132))
 core_baselines={'stock':('0.6.75-alpha',3500),'black2':('0.6.41-alpha',3500),
                 'white2italy':('0.6.42-alpha',3500),'white2upgrade':('0.7.36-alpha',3720)}
 options_memory=[]
 for r in reports:
  core=next(m['codePlusBss'] for m in r['modules'] if 'Core' in m['name'])
  old_version,old_core=core_baselines[r['profile']]
  options_memory.append(dict(profile=r['profile'],previousVersion=old_version,
    previousCoreFixedBytes=old_core,currentCoreFixedBytes=core,
    addedCoreFixedBytes=core-old_core,temporaryMenuAllocationBytes=1684,
    temporaryMarkerSlots=2))
 out={'measurements':reports,'previousReleaseMeasurements':previous,
      'optionsMenuMemory':options_memory,
      'limits':'Fixed payloads exclude loader metadata, allocator overhead, native graphics/UI allocations, stack usage and VRAM. Expanded module sizes are loader image requirements, not measured steady-state heap charges.',
      'implementationStatus':'ROM registry streaming and 8 KiB conversation buffers implemented; automated checks passed, game emulator acceptance pending.'}
 (HERE/'MEMORY-AUDIT.json').write_text(json.dumps(out,indent=2)+'\n')
 print(json.dumps(out,indent=2))
if __name__=='__main__':main()
