"""Build independent native field-menu adapters from the two US revision-0 ROMs."""
import hashlib, json, os, struct, subprocess, tempfile
from pathlib import Path
import ndspy.rom, ndspy.codeCompression

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
WORKSPACE=REPO.parent
BUILD=HERE/'build'
ASSETS=REPO/'src/assets/codeinjection'
TOOLS=Path(os.environ.get('ARM_TOOLCHAIN_BIN',WORKSPACE/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
JAR=Path(os.environ.get('RPM_TOOL_JAR',WORKSPACE/'pw2-build-work/ctrmap/CTRMap.jar'))
BUILD.mkdir(parents=True,exist_ok=True)
def run(*args): subprocess.run([str(x) for x in args],check=True)
def unique(data,pattern):
    at=data.find(pattern)
    assert at>=0 and data.find(pattern,at+1)<0, ('Nonunique native contract',pattern.hex())
    return at
def target(data,at,base):
    a,b=struct.unpack_from('<HH',data,at)
    assert a&0xf800==0xf000 and b&0xf800==0xf800
    v=((a&2047)<<12)|((b&2047)<<1)
    if v&0x400000:v-=0x800000
    return base+at+4+v
def calls(data,base,to,start,end):
    result=[]
    for at in range(start,end,2):
        a,b=struct.unpack_from('<HH',data,at)
        if a&0xf800==0xf000 and b&0xf800==0xf800 and target(data,at,base)==to:result.append(base+at)
    return result

roms={g:ndspy.rom.NintendoDSRom.fromFile(str(Path(os.environ.get('UI_SCREENS_'+g+'_ROM',WORKSPACE/f'clean{n}2.nds')))) for g,n in [('W2','white'),('B2','black')]}
w=roms['W2'].loadArm9Overlays([36])[36]
wd=bytes(w.data)
anchors={name:wd[address-w.ramAddress:address-w.ramAddress+size] for name,address,size in [('create',0x21a0860,12),('navigate',0x21a058c,8),('touch',0x21a0708,24)]}
manifest={'version':1,'games':{}}
for game,rom in roms.items():
    assert bytes(rom.idCode)==(b'IRDO' if game=='W2' else b'IREO') and rom.version==0
    overlay=rom.loadArm9Overlays([36])[36]; data=bytes(overlay.data); base=overlay.ramAddress
    pos={k:unique(data,p) for k,p in anchors.items()}
    create=base+pos['create']; nav=base+pos['navigate']; touch=base+pos['touch']+26
    creates=calls(data,base,create,0,len(data)-4); navs=calls(data,base,nav,pos['navigate'],pos['touch'])
    assert len(creates)==1 and len(navs)==4
    touch_target=target(data,touch-base,base)
    arm=ndspy.codeCompression.decompress(rom.arm9)
    # Verify the native UTF-16 string functions separately in each game.
    string_new=target(data,creates[0]-base-0x10c,base)
    string_set=target(data,creates[0]-base-0xf2,base)
    string_free=target(data,creates[0]-base+6,base)
    headers={'BUTTON_CREATE':create,'NAVIGATE':nav,'TOUCH_TEST':touch_target,'STRING_NEW':string_new,'STRING_SET':string_set,'STRING_FREE':string_free}
    (BUILD/'addresses.h').write_text('\n'.join(f'#define {k} 0x{v:x}' for k,v in headers.items())+'\n')
    hooks=[('UiCreate',creates[0],''),('UiTouch',touch,'adds r1,r5,#0')]+[('UiNavigate',a,'') for a in navs]
    asm=['.syntax unified','.thumb']
    signatures=[]
    for label,address,prep in hooks:
        symbol=f'THUMB_BRANCH_LINK_36_0x{address:x}'
        asm+=['.balign 4',f'.global {symbol}',f'.type {symbol},%function','.thumb_func',symbol+':']
        if prep:asm.append(prep)
        asm+=['ldr r3,1f','bx r3','.balign 4','1: .word '+label,f'.size {symbol},.-{symbol}']
        signatures.append({'label':label,'address':address,'expectedHex':data[address-base:address-base+4].hex(),'patchSize':4})
    contracts=[{'address':base+at,'expectedHex':data[at:at+{'create':0x116,'navigate':0x60,'touch':0x80}[k]].hex(),'module':'36'} for k,at in pos.items()]
    producer=creates[0]-base-0x162
    contracts.append({'address':base+producer,'expectedHex':data[producer:creates[0]-base+0x16].hex(),'module':'36'})
    for address in [string_new,string_set,string_free,touch_target]:
        at=address-rom.arm9RamAddress
        contracts.append({'address':address,'expectedHex':arm[at:at+12].hex(),'module':'ARM9'})
    (BUILD/'hooks.s').write_text('\n'.join(asm)+'\n')
    run(TOOLS/'arm-none-eabi-g++','-std=c++17','-mthumb','-march=armv5t','-mlong-calls','-Os','-Wall','-Wextra','-Werror','-fno-exceptions','-fno-rtti','-fno-unwind-tables','-fno-asynchronous-unwind-tables','-ffreestanding','-fno-builtin','-I',BUILD,'-c',HERE/'menu.cpp','-o',BUILD/'menu.o')
    run(TOOLS/'arm-none-eabi-as','-mthumb','-march=armv5t',BUILD/'hooks.s','-o',BUILD/'hooks.o')
    elf=BUILD/f'UiScreens{game}.elf'
    run(TOOLS/'arm-none-eabi-g++','-mthumb','-march=armv5t','-nostdlib','-Wl,-r',BUILD/'menu.o',BUILD/'hooks.o','-o',elf)
    assert not subprocess.check_output([str(TOOLS/'arm-none-eabi-nm'),'-u',str(elf)]).strip()
    (BUILD/'symbols.yml').write_text('Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n')
    (BUILD/'meta.yml').write_text(f'PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: 0.1.0\n')
    with tempfile.TemporaryDirectory(dir=BUILD) as tmp:
        candidate=Path(tmp)/f'UiScreens{game}.dll'
        run('java','-cp',JAR,'rpm.cli.RPMTool','-i',elf,'--fourcc','DLXF','-o',candidate,'--esdb',BUILD/'symbols.yml','--meta',BUILD/'meta.yml','--generate-relocations','--strip')
        dll=candidate.read_bytes();assert dll[:4]==b'DLXF' and len(dll)>420
        (ASSETS/candidate.name).write_bytes(dll)
    manifest['games'][game]={'idCode':bytes(rom.idCode).decode(),'overlay':36,'base':base,'hooks':signatures,'contracts':contracts,'specialMapAddress':base+unique(data,struct.pack('<7I',18,20,20,19,20,20,18))+24,'sha256':hashlib.sha256(dll).hexdigest()}
(ASSETS/'uiScreensManifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Built both native UI screen adapters.')
