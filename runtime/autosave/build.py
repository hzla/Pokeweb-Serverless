"""Build an experimental map-transition autosave against exact US B2/W2 binaries."""
import hashlib,json,os,struct,subprocess,sys
from pathlib import Path
import ndspy.rom,ndspy.codeCompression
HERE=Path(__file__).resolve().parent;REPO=HERE.parents[1];WS=REPO.parent;BUILD=HERE/'build'
TOOLS=Path(os.environ.get('ARM_TOOLCHAIN_BIN',WS/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
JAR=Path(os.environ.get('RPM_TOOL_JAR',WS/'White2Upgrade/CTRMap.jar'));VERSION='0.1.1-test';ARTIFACTS=HERE/'artifacts'
APIS={0x2016af0:4,0x2153a28:12,0x217ff02:4,0x2017750:32,0x2017830:4,0x200746c:28,0x20095a0:24,0x2016a80:6,0x2016cb4:64,0x2016edc:4,0x2017394:4,0x201782c:36,0x2017850:52,0x20178bc:8,0x2017934:4,0x2017994:4,0x2027af8:24,0x2039fbc:24,0x204855c:52,0x2048590:28,0x2048640:24,
 0x217ff7a:4,0x217ffec:4,0x2180b40:96,0x218189c:112,0x218190c:100,0x2181a68:54,0x2181cf0:36,0x2187c3c:32,0x2187c5c:24,0x2187c8c:10,0x2187cb0:12,0x21983dc:16,0x219a5d8:30,0x219a6f8:12,0x21a0204:124}
HASHES={
 'W2':{'12':'4086a96335723d80eba824fadd689d1f46a90d39992639b8d102ab4b7d66725b','ARM9':'013f8943fa632b0803451bb341473b44915a1756edaf3f9d2d18116822727c21','36':'ddd209a6bf958685d0311b49c3c6a575787c2cefbe35cbce8acf2760acdeaf08'},
 'B2':{'12':'7a3f4df4c7ce8b09194a95afbbf2a0f185560bf853ef1545f89d330c57a7ade0','ARM9':'03b2e68d7ebc98f4c2d2e78d41d1ef85647f041a096ed65f3fe342e08859e92d','36':'21fa0a20eefb8234f66a2e786bb0ee0eb5b07bf3d440c0e37d09961b6184fadb'}}
def run(*a):subprocess.run([str(v)for v in a],check=True)
def address(a,game):return a-(64 if a>=0x2150000 else 44 if a>=0x20191d8 else 0)if game=='B2'else a
def bl(b,a):
 x,y=struct.unpack('<HH',b);assert x&0xf800==0xf000 and y&0xf800==0xf800
 d=((x&2047)<<12)|((y&2047)<<1);return a+4+(d-0x800000 if d&0x400000 else d)
def main():
 BUILD.mkdir(exist_ok=True);ARTIFACTS.mkdir(exist_ok=True)
 (BUILD/'profiles.generated.h').write_text('#pragma once\ninline u32 nativeAddress(u32 a){\n#ifdef GAME_B2\n return a-(a>=0x2150000?64:a>=0x20191d8?44:0);\n#else\n return a;\n#endif\n}\n')
 manifest={'version':VERSION,'experimental':True,'saveStepsPerTick':8,'previousVersions':json.loads((HERE/'previous.json').read_text()),'games':{}}
 for game,filename in [('W2','cleanwhite2.nds'),('B2','cleanblack2.nds')]:
  rom=ndspy.rom.NintendoDSRom.fromFile(str(WS/filename));assert rom.idCode==(b'IRDO'if game=='W2'else b'IREO')and rom.version==0
  overlays=rom.loadArm9Overlays([12,36]);ov=overlays[36];arm=ndspy.codeCompression.decompress(rom.arm9);segs={'ARM9':(rom.arm9RamAddress,arm),'36':(ov.ramAddress,ov.data),'12':(overlays[12].ramAddress,overlays[12].data)}
  for mod,(base,data)in segs.items():assert hashlib.sha256(data).hexdigest()==HASHES[game][mod],(game,mod,'unrecognized source')
  signatures=[]
  for a,size in APIS.items():
   mod='36'if a>=0x2170000 else'12'if a>=0x2150000 else'ARM9';base,data=segs[mod];p=address(a,game);raw=bytes(data[p-base:p-base+size]);assert len(raw)==size
   signatures.append({'module':mod,'address':p,'expectedHex':raw.hex(),'patchSize':4 if a in(0x217ff7a,0x217ffec,0x2017830,0x217ff02)else 0})
  for at,target in[(0x217ff7a,0x2016a80),(0x217ffec,0x2180b40),(0x2017830,0x2017750),(0x217ff02,0x2153a28)]:
   mod='36'if at>=0x2150000 else'ARM9';base,data=segs[mod];a=address(at,game);assert bl(bytes(data[a-base:a-base+4]),a)==address(target,game)
  # Verify native save dispatch, result values, fixed lower window and current
  # location accessors independently in each game, beyond function prologues.
  assert arm[0x20178bc-rom.arm9RamAddress:0x20178c4-rom.arm9RamAddress]==bytes.fromhex('07218901405c7047')
  assert bytes(ov.data[address(0x2180518,game)-ov.ramAddress:address(0x2180518,game)-ov.ramAddress+6])==bytes.fromhex('e83000887047')
  table=struct.unpack_from('<I',ov.data,address(0x21a02b0,game)-ov.ramAddress)[0]
  menus=[struct.unpack_from('<7I',ov.data,table-ov.ramAddress+i*28)for i in range(7)]
  assert [i for i,row in enumerate(menus)if 5 in row]==[0,2,3,6]
  signatures.append({'module':'36','address':table,'expectedHex':bytes(ov.data[table-ov.ramAddress:table-ov.ramAddress+7*28]).hex(),'patchSize':0})
  assembly=['.syntax unified','.thumb']
  for at,name in [(0x217ff7a,'AutosaveRegister'),(0x217ffec,'AutosaveZone'),(0x2017830,'AutosaveSnapshot'),(0x217ff02,'AutosaveArrival')]:
   mod='36'if at>=0x2150000 else'ARM9';sym=f'THUMB_BRANCH_LINK_{mod}_0x{address(at,game):x}'
   assembly+=['.balign 4',f'.global {sym}',f'.type {sym},%function','.thumb_func',sym+':','push {r3}','ldr r3,1f','mov ip,r3','pop {r3}','bx ip','.balign 4',f'1: .word {name}',f'.size {sym},.-{sym}']
  stem=f'MapAutosave{game}';asm=BUILD/f'{stem}.s';asm.write_text('\n'.join(assembly)+'\n')
  run(TOOLS/'arm-none-eabi-g++','-std=c++17','-mthumb','-march=armv5t','-mlong-calls','-Os','-Wall','-Wextra','-Werror','-fno-jump-tables','-fvisibility=hidden','-fno-exceptions','-fno-rtti','-fno-unwind-tables','-fno-asynchronous-unwind-tables','-ffreestanding','-fno-builtin',f'-DGAME_{game}','-I',BUILD,'-c',HERE/'autosave.cpp','-o',BUILD/f'{stem}.o')
  run(TOOLS/'arm-none-eabi-as','-mthumb','-march=armv5t',asm,'-o',BUILD/f'{stem}Hooks.o')
  elf=BUILD/f'{stem}.elf';run(TOOLS/'arm-none-eabi-g++','-nostdlib','-Wl,-r',BUILD/f'{stem}.o',BUILD/f'{stem}Hooks.o','-o',elf)
  assert not subprocess.check_output([str(TOOLS/'arm-none-eabi-nm'),'-u',str(elf)]).strip()
  meta=BUILD/'metadata.yml';meta.write_text(f'PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: {VERSION}\n')
  esdb=BUILD/'symbols.yml';esdb.write_text('Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n')
  dll=ARTIFACTS/f'{stem}.dll';run('java','-cp',JAR,'rpm.cli.RPMTool','-i',elf,'--fourcc','DLXF','-o',dll,'--esdb',esdb,'--meta',meta,'--generate-relocations','--strip')
  sys.path.insert(0,str(HERE.parent/'battle-type-hud'));from rpm_read import read_rpm
  rpm=read_rpm(dll.read_bytes());assert not any(s['attributes']&2 for s in rpm['symbols'])
  hooks=[r for r in rpm['relocations']if r['module']!='base'];assert len(hooks)==4 and all(r['type']=='THUMB_BRANCH_LINK'for r in hooks)
  manifest['games'][game]={'idCode':rom.idCode.decode(),'fileName':dll.name,'sha256':hashlib.sha256(dll.read_bytes()).hexdigest(),'signatures':signatures,'codeBytes':len(rpm['code']),'bssBytes':rpm['bss']}
  print(game,'code',len(rpm['code']),'BSS',rpm['bss'])
 (HERE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
if __name__=='__main__':main()
