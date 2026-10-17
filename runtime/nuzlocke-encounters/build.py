"""Build independent US B2/W2 table filters from checked native interfaces."""
from pathlib import Path
import subprocess,json,struct,hashlib,os,tempfile
import ndspy.rom,ndspy.codeCompression
HERE=Path(__file__).resolve().parent;REPO=HERE.parents[1];WS=REPO.parent
BUILD=HERE/'build';ASSETS=REPO/'src/assets/codeinjection';BUILD.mkdir(exist_ok=True)
TOOLS=Path(os.environ.get('ARM_TOOLCHAIN_BIN',WS/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
JAR=Path(os.environ.get('RPM_TOOL_JAR',WS/'White2Upgrade/CTRMap.jar'));VERSION='0.1.0'
def run(*args):subprocess.run([str(x) for x in args],check=True)
def target(data,address):
 a,b=struct.unpack('<HH',data);assert a&0xf800==0xf000 and b&0xf800==0xf800
 n=((a&2047)<<12)|((b&2047)<<1);return address+4+(n-0x800000 if n&0x400000 else n)
manifest={'version':VERSION,'games':{}}
for game,name,delta in [('W2','cleanwhite2.nds',0),('B2','cleanblack2.nds',64)]:
 rom=ndspy.rom.NintendoDSRom.fromFile(WS/name);assert rom.idCode==(b'IRDO' if game=='W2' else b'IREO') and rom.version==0
 overlay=rom.loadArm9Overlays([36])[36];arm=bytes(ndspy.codeCompression.decompress(rom.arm9))
 signatures=[];hooks=[];asm=['.syntax unified','.thumb']
 def signature(label,module,address,size,patch=0):
  data,base=(arm,rom.arm9RamAddress) if module=='ARM9' else (overlay.data,overlay.ramAddress)
  raw=bytes(data[address-base:address-base+size]);assert len(raw)==size
  value={'label':label,'module':module,'address':address,'expectedHex':raw.hex(),'patchSize':patch};signatures.append(value)
  if patch:hooks.append(value)
  return raw
 for call,callee,label in [(0x21a0ca0,0x21a0c34,'NuzlockeGenerate'),(0x21a162c,0x21a15ec,'NuzlockeProbability'),
                         (0x21a164c,0x21a15ec,'NuzlockeProbability'),(0x21a166c,0x21a15ec,'NuzlockeProbability'),
                         (0x21a148e,0x21a1384,'NuzlockePreferred')]:
  address=call-delta;assert target(signature(label,'36',address,4,4),address)==callee-delta
  symbol=f'THUMB_BRANCH_LINK_36_0x{address:x}'
  asm+=['.balign 4',f'.global {symbol}',f'.type {symbol},%function','.thumb_func',symbol+':',
        'ldr r3,1f','bx r3',f'1: .word {label}',f'.size {symbol},.-{symbol}']
 table=struct.unpack_from('<I',overlay.data,0x21a14c0-delta-overlay.ramAddress)[0]
 original=struct.unpack('<4I',signature('Native slot provider table','36',table,16))
 assert list(original)==[x-delta for x in [0x21a1619,0x21a1639,0x21a1659,0x21a1679]]
 address=table+12;signature('Filtered uniform provider','36',address,4,4)
 symbol=f'FULL_COPY_36_0x{address:x}'
 asm+=['.balign 4',f'.global {symbol}',f'.type {symbol},%object',symbol+':','.word NuzlockeUniform',f'.size {symbol},4']
 for address,length,label in [(0x21a0c34,0x74,'Native encounter generation/Repel'),(0x21a1278,0x16c,'Native table/forms/type preference'),
                              (0x21a1470,0x54,'Native preferred/weighted selection'),(0x21a15ec,0x94,'Native probability providers')]:
  signature(label,'36',address-delta,length)
 for address in [0x2005748,0x2005784,0x200d184,0x200d660,0x2017934,0x2039dc8,0x203a278,0x2070ca8,0x2070ecc,0x2070dec,0x2070e54,0x2070e6c,0x2070de0]:
  signature('Native read-only service','ARM9',address-(44 if game=='B2' and address>=0x20191d8 else 0),16)
 assert signature('Native caught-bit lookup','ARM9',0x200d660,0x30)==bytes(arm[0x200d660-rom.arm9RamAddress:0x200d690-rom.arm9RamAddress])
 # Pin actual base weights independently in each game; fishing differs from Surf.
 weights=[]
 for literal,expected in [(0x21a1634,[20,20,10,10,10,10,5,5,4,4,1,1]),(0x21a1654,[60,30,5,4,1]),(0x21a1674,[40,40,15,4,1])]:
  pointer=struct.unpack_from('<I',overlay.data,literal-delta-overlay.ramAddress)[0]
  raw=signature('Native slot weights','36',pointer,len(expected)*4);assert list(raw[:len(expected)])==expected;weights.append(list(raw))
 source=BUILD/f'{game}.s';source.write_text('\n'.join(asm)+'\n');objects=[]
 for item in [HERE/'runtime.cpp',HERE/'filter.cpp',REPO/'runtime/learnset-viewer/memory.cpp']:
  obj=BUILD/f'{item.stem}{game}.o';objects.append(obj)
  run(TOOLS/'arm-none-eabi-g++','-std=c++17','-mthumb','-march=armv5t','-mlong-calls','-Os','-Wall','-Wextra','-Werror',
      '-fno-exceptions','-fno-rtti','-fno-unwind-tables','-fno-asynchronous-unwind-tables','-ffreestanding','-fno-builtin','-fvisibility=hidden',f'-DGAME_{game}','-c',item,'-o',obj)
 hook=BUILD/f'hooks{game}.o';run(TOOLS/'arm-none-eabi-as','-mthumb','-march=armv5t',source,'-o',hook);objects.append(hook)
 elf=BUILD/f'NuzlockeStyleEncounters{game}.elf';run(TOOLS/'arm-none-eabi-g++','-nostdlib','-Wl,-r',*objects,'-o',elf)
 assert not subprocess.check_output([TOOLS/'arm-none-eabi-nm','-u',elf]).strip()
 meta=BUILD/f'{game}.yml';meta.write_text(f'PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: {VERSION}\n')
 esdb=BUILD/'symbols.yml';esdb.write_text('Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n')
 filename=f'NuzlockeStyleEncounters{game}.dll';dll=ASSETS/filename
 with tempfile.TemporaryDirectory(dir=BUILD) as tmp:
  candidate=Path(tmp)/filename
  run('java','-cp',JAR,'rpm.cli.RPMTool','-i',elf,'--fourcc','DLXF','-o',candidate,'--esdb',esdb,'--meta',meta,'--generate-relocations','--strip')
  raw=candidate.read_bytes();assert raw[:4]==b'DLXF' and len(raw)>128;dll.write_bytes(raw)
 description=BUILD/f'{game}-runtime.json';run(REPO/'node_modules/.bin/vite-node',HERE/'inspect.ts',dll,description)
 manifest['games'][game]={'idCode':rom.idCode.decode(),'fileName':filename,'sha256':hashlib.sha256(raw).hexdigest(),
   'hooks':hooks,'signatures':signatures,**json.loads(description.read_text())}
 print(game,filename,len(raw),'native uniform table',hex(table),flush=True)
(ASSETS/'nuzlockeEncountersManifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
