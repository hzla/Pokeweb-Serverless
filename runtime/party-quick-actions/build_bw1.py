"""Build exact BW1 candidates without enabling installation before acceptance."""
import hashlib,json,re,struct,subprocess
import ndspy.narc
from build import HERE,BUILD,ASSETS,TOOLS,JAR,run,art,fingerprint
from configure_bw1 import configure,header,CALLS,WORDS,ICONS,BINDINGS,OVERLAY_BINDINGS
VERSION='0.1.0-bw1'
ACCEPTANCE=HERE/'acceptance-bw1.json'

def main():
 BUILD.mkdir(exist_ok=True);(BUILD/'adapter_bw1.generated.h').write_text(header())
 m={'version':VERSION,'archivePath':'party-tools/ui.narc','games':{}}
 # Source changes cannot accidentally call an unmapped BW2 routine.
 source=(HERE/'party_tools.cpp').read_text()
 api={int(v,16)for v in re.findall(r'api<[^;]*?>\((0x[\da-f]+)\)',source)}-{0x2034c80}
 ov={int(v,16)for v in re.findall(r'ov<[^;]*?>\((0x[\da-f]+)\)',source)}
 assert api<=BINDINGS.keys(),api-BINDINGS.keys()
 assert ov<=OVERLAY_BINDINGS.keys(),ov-OVERLAY_BINDINGS.keys()
 for game in ('B','W'):
  r,p=configure(game);asm=['.syntax unified','.thumb']
  for label,module,addr,target in CALLS[game]:
   sym=f'THUMB_BRANCH_LINK_{module}_0x{addr:x}'
   asm+=['.balign 4',f'.global {sym}',f'.type {sym},%function','.thumb_func',sym+':','push {r3}','ldr r3,1f','mov ip,r3','pop {r3}','bx ip','.balign 4',f'1: .word {label}',f'.size {sym},.-{sym}']
  for label,module,addr,target in WORDS[game]:
   sym=f'FULL_COPY_{module}_0x{addr:x}';asm+=['.balign 4',f'.global {sym}',f'.type {sym},%object',sym+':',f'.word {label}',f'.size {sym},4']
  graphics=art(r,'a/0/8/3',ICONS[game]);arc=ndspy.narc.NARC()
  arc.files=[struct.pack('<11I',0x51415050,3,44,1,0,0,0,0,0,0,0x51415050^1),*graphics]
  archive=bytes(arc.save());name=f'partyQuickActions{game}.narc';(ASSETS/name).write_bytes(archive)
  p.update({'archiveFileName':name,'archiveSha256':hashlib.sha256(archive).hexdigest(),'graphicsFingerprints':[fingerprint(v)for v in graphics]})
  stem=f'PartyQuickActions{game}';s=BUILD/f'{stem}.s';s.write_text('\n'.join(asm)+'\n')
  run(TOOLS/'arm-none-eabi-g++','-std=c++17','-mthumb','-march=armv5t','-mlong-calls','-Os','-Wall','-Wextra','-Werror','-fno-jump-tables','-fno-exceptions','-fno-rtti','-fno-unwind-tables','-fno-asynchronous-unwind-tables','-ffreestanding','-fno-builtin',f'-DGAME_{game}','-I',BUILD,'-c',HERE/'party_tools.cpp','-o',BUILD/f'{stem}.o')
  run(TOOLS/'arm-none-eabi-as','-mthumb','-march=armv5t',s,'-o',BUILD/f'{stem}Hooks.o');elf=BUILD/f'{stem}.elf'
  run(TOOLS/'arm-none-eabi-g++','-nostdlib','-Wl,-r',BUILD/f'{stem}.o',BUILD/f'{stem}Hooks.o','-o',elf)
  assert not subprocess.check_output([str(TOOLS/'arm-none-eabi-nm'),'-u',str(elf)]).strip()
  meta=BUILD/f'metadata-{game}.yml';meta.write_text(f'PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: {VERSION}\n')
  esdb=BUILD/f'symbols-{game}.yml';esdb.write_text('Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n')
  dll=ASSETS/f'{stem}.dll';run('java','-cp',JAR,'rpm.cli.RPMTool','-i',elf,'--fourcc','DLXF','-o',dll,'--esdb',esdb,'--meta',meta,'--generate-relocations','--strip')
  blob=dll.read_bytes();h=struct.unpack_from('<I',blob,8)[0];info=h+struct.unpack_from('<I',blob,h+8)[0];start,size=struct.unpack_from('<II',blob,info+16)
  p.update({'fileName':dll.name,'sha256':hashlib.sha256(blob).hexdigest(),'codeFingerprint':fingerprint(blob[start:start+size]),'bssSize':struct.unpack_from('<I',blob,h+12)[0]})
  if ACCEPTANCE.exists():
   accepted=json.loads(ACCEPTANCE.read_text());proof=accepted.get('games',{}).get(game,{})
   p['dsAccepted']=accepted.get('version')==VERSION and proof.get('passed',False) and proof.get('toolbarSha256')==p['sha256'] and proof.get('archiveSha256')==p['archiveSha256']
  (HERE/f'profile-{game}.json').write_text(json.dumps(p,indent=2)+'\n');m['games'][game]=p
  print(game,len(blob),'bytes;', 'DS accepted' if p['dsAccepted'] else 'DS acceptance pending')
 (ASSETS/'partyQuickActionsBw1Manifest.json').write_text(json.dumps(m,indent=2)+'\n')

if __name__=='__main__':main()
