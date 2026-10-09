"""Build separately checked English B2/W2 PMC modules and their private archive."""
import hashlib,json,os,struct,subprocess
from pathlib import Path
import ndspy.rom,ndspy.codeCompression
from graphics import create
HERE=Path(__file__).resolve().parent;REPO=HERE.parents[1];WS=REPO.parent;BUILD=HERE/'build';ASSETS=REPO/'src/assets/codeinjection'
TOOLS=Path(os.environ.get('ARM_TOOLCHAIN_BIN',WS/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
JAR=Path(os.environ.get('RPM_TOOL_JAR',WS/'White2Upgrade/CTRMap.jar'));VERSION='0.1.2'
# Every native import is an explicit US address. No reference source is a build
# dependency. Verified early getters share addresses; the saved flag helper
# and the later imported helpers differ by 44.
APIS=[0x20056fc,0x2006254,0x2008474,0x2008ddc,0x20098c0,0x2009918,0x200ddb8,0x200dde0,
 0x2016ad8,0x2016af0,0x2016cb4,0x2016d68,0x2016ed8,0x2016edc,0x20171f4,0x2017354,0x201735c,0x2017394,0x20175a4,0x2017934,0x20191d8,
 0x201cd24,0x201fe24,0x201ff34,0x2039f8c,0x2039fbc,0x203a228,0x203a278,0x203a6d4,0x203cb14,0x203da74,0x203dab0,
 0x204aac8,0x204ab38,0x204ab48,0x204ac38,0x204b8e8,0x204b9b8,0x204ba6c,0x204bbcc,0x204bcfc,
 0x204bd3c,0x204be0c,0x204be90,0x204bf48,0x204c06c,0x204c134,0x204c150,0x204c16c,0x204c54c,0x2070ca8,0x2070ecc]
NATIVE={12:[0x21536ac,0x2159270,0x2159460,0x21596c4,0x215b4c8,0x215c038,0x215eff4,0x215f024],
 36:[0x2180500,0x218130c,0x21983ec,0x2198564,0x219863c,0x219865c,0x21986b4,0x21986c0],
 79:[0x21eb748,0x21eb894,0x21ec808,0x21ec9cc,0x21ed2e0]}
CALLS=[('QaInput',79,0x21ec980,0x21eb894,''),('QaButtonHit',79,0x21eb8c8,0x21eb748,''),
 ('QaGearUnit',79,0x21ec740,0x204bf48,''),
 ('QaGearEnd',79,0x21ece42,0x21ec808,''),
 ('QaRepelStep',36,0x21824bc,0x200ddb8,'adds r1,r7,#0'),('QaRepelDepleted',36,0x21a0b2c,0x200dde0,'adds r1,r4,#0')]
WORDS=[('QaCGearInit',36,0x21cfa10,0x2198565),('QaCGearUpdate',36,0x21cfa14,0x219865d),
 ('QaCGearEvent',36,0x21cfa1c,0x21986b5),('QaCGearExit',36,0x21cfa20,0x219863d),
 ('QaNoGearInit',36,0x21cfa9c,0x21986c1),('QaTownMapReturn',12,0x216cca4,0x215c039)]
RETAIL_HASHES={
 'W2':{'ARM9':'013f8943fa632b0803451bb341473b44915a1756edaf3f9d2d18116822727c21',
  '12':'4086a96335723d80eba824fadd689d1f46a90d39992639b8d102ab4b7d66725b',
  '36':'ddd209a6bf958685d0311b49c3c6a575787c2cefbe35cbce8acf2760acdeaf08',
  '79':'c0c65423f1ed097347a0c9a58916cca997a76adfcfd5e566dd44b9205a0994a4'},
 'B2':{'ARM9':'03b2e68d7ebc98f4c2d2e78d41d1ef85647f041a096ed65f3fe342e08859e92d',
  '12':'7a3f4df4c7ce8b09194a95afbbf2a0f185560bf853ef1545f89d330c57a7ade0',
  '36':'21fa0a20eefb8234f66a2e786bb0ee0eb5b07bf3d440c0e37d09961b6184fadb',
  '79':'01357a95204975214935b7a95944751c38459c1ee4962f7a08e54a77be028c50'}}
def run(*args):subprocess.run([str(a) for a in args],check=True)
def bl_target(b,a):
    x,y=struct.unpack('<HH',b);assert x&0xf800==0xf000 and y&0xf800==0xf800
    d=((x&2047)<<12)|((y&2047)<<1);return a+4+(d-0x800000 if d&0x400000 else d)
def main():
    BUILD.mkdir(exist_ok=True)
    graphics_rom=ndspy.rom.NintendoDSRom.fromFile(os.environ.get('QUICK_ACTIONS_W2_ROM',WS/'cleanwhite2.nds'))
    create(ASSETS/'cgearQuickActions.narc',BUILD/'buttons.png',graphics_rom)
    arc=__import__('ndspy.narc',fromlist=['NARC']).NARC((ASSETS/'cgearQuickActions.narc').read_bytes());fnv=0x811c9dc5
    for b in b''.join(arc.files[1:8]):fnv=((fnv^b)*0x1000193)&0xffffffff
    manifest={'graphicsFingerprint':f'{fnv:08x}','version':VERSION,'defaultPcHideFlag':1517,'maxSaveFlag':3059,'archivePath':'quick-actions/ui.narc','archiveSha256':hashlib.sha256((ASSETS/'cgearQuickActions.narc').read_bytes()).hexdigest(),'previousVersions':json.loads((HERE/'previous.json').read_text()),'games':{}}
    profiles=['#pragma once','inline u32 nativeAddress(u32 a) {','#ifdef GAME_B2','switch(a) {']
    profiles += [f'case 0x{a:x}: return 0x{a-(0x2c if a>=0x20191d8 else 0):x};' for a in APIS]
    profiles+=['case 0x214197c: return 0x214193c;','default: __builtin_trap();','}','#else','return a;','#endif','}',
        'inline u32 overlayAddress(u32 a) {','#ifdef GAME_B2','return a-0x40;','#else','return a;','#endif','}']
    (BUILD/'profiles.generated.h').write_text('\n'.join(profiles)+'\n')
    reference={}
    for game,name,delta in [('W2','cleanwhite2.nds',0),('B2','cleanblack2.nds',64)]:
        rom=ndspy.rom.NintendoDSRom.fromFile(os.environ.get(f'QUICK_ACTIONS_{game}_ROM',WS/name))
        assert bytes(rom.idCode)==(b'IRDO' if game=='W2' else b'IREO') and rom.version==0
        overlays=rom.loadArm9Overlays(NATIVE.keys());arm=ndspy.codeCompression.decompress(rom.arm9)
        for module,expected in RETAIL_HASHES[game].items():
            data=arm if module=='ARM9' else bytes(overlays[int(module)].data)
            assert hashlib.sha256(data).hexdigest()==expected,f'{game} retail {module} source hash differs'
        signatures=[];asm=['.syntax unified','.thumb']
        def signature(label,module,address,length,patch=0):
            base=rom.arm9RamAddress if module=='ARM9' else overlays[int(module)].ramAddress
            data=arm if module=='ARM9' else overlays[int(module)].data
            b=bytes(data[address-base:address-base+length]);assert len(b)==length
            signatures.append({'label':label,'module':str(module),'address':address,'expectedHex':b.hex(),'patchSize':patch})
            return b
        for label,mod,a,target,prep in CALLS:
            a-=delta;t=target-(delta if target>=0x2150000 else (44 if game=='B2' and target>=0x201c000 else 0))
            assert bl_target(signature(label,mod,a,4,4),a)==t,(game,label,hex(a))
            sym=f'THUMB_BRANCH_LINK_{mod}_0x{a:x}'
            asm+=['.balign 4',f'.global {sym}',f'.type {sym},%function','.thumb_func',sym+':']
            if prep:asm.append(prep)
            asm+=['push {r3}','ldr r3,1f','mov ip,r3','pop {r3}','bx ip','.balign 4',f'1: .word {label}',f'.size {sym},.-{sym}']
        for label,mod,a,value in WORDS:
            a-=(52 if game=='B2' and mod==36 else delta);expected=value-delta
            assert struct.unpack('<I',signature(label,mod,a,4,4))[0]==expected,(game,label,hex(a))
            sym=f'FULL_COPY_{mod}_0x{a:x}'
            asm+=['.balign 4',f'.global {sym}',f'.type {sym},%object',sym+':',f'.word {label}',f'.size {sym},4']
        for a in APIS:
            address=a-(44 if game=='B2' and a>=0x20191d8 else 0)
            b=signature('Native API','ARM9',address,8)
            # PC-relative loads/BLs may encode different offsets while the ABI
            # remains the same. Preserve independent signatures for each game.
            if game=='W2':reference[a]=b
        assert struct.unpack('<I',signature('Native graphics system pointer','ARM9',0x204b9a8-(44 if game=='B2' else 0),4))[0]==(0x214193c if game=='B2' else 0x214197c)
        for mod,addresses in NATIVE.items():
            for a in addresses:signature('Native field ABI',mod,a-delta,12)
        signature('C-Gear ring colour layout',79,0x21eb3e4-delta,28)
        signature('C-Gear delayed dimming layout',79,0x21ed290-delta,48)
        assert signature('C-Gear dimming colours',79,0x21ed834-delta,4)==struct.pack('<HH',0x0441,0x0423)
        signature('C-Gear save initialization','ARM9',0x2009890,44)
        signature('C-Gear save accessors','ARM9',0x20098bc,104)
        signature('Options initialization and accessors','ARM9',0x20089c0,0x144)
        signature('Saved event flag accessor layout','ARM9',0x2019278-(44 if game=='B2' else 0),68)
        assert signature('Native trainer flag range',12,0x2155078-delta,6)==bytes.fromhex('5f2212018918')
        # The default lies in the gap between item flags and trainer flags.
        # Neither retail script data nor entity data contains this operand.
        for path in ['a/0/5/6','a/1/2/6']:
            arc=__import__('ndspy.narc',fromlist=['NARC']).NARC(rom.files[rom.filenames.idOf(path)])
            assert not any(struct.pack('<H',1517) in b for b in arc.files),(game,path,'default PC flag is referenced')
        stem=f'CGearQuickActions{game}';source=BUILD/f'{stem}.s';source.write_text('\n'.join(asm)+'\n')
        run(TOOLS/'arm-none-eabi-g++','-std=c++17','-mthumb','-march=armv5t','-mlong-calls','-Os','-Wall','-Wextra','-Werror',
            '-fvisibility=hidden','-fno-exceptions','-fno-rtti','-fno-unwind-tables','-fno-asynchronous-unwind-tables','-ffreestanding','-fno-builtin',f'-DGAME_{game}',
            '-I',BUILD,'-c',HERE/'quick_actions.cpp','-o',BUILD/f'{stem}.o')
        run(TOOLS/'arm-none-eabi-as','-mthumb','-march=armv5t',source,'-o',BUILD/f'{stem}Hooks.o')
        elf=BUILD/f'{stem}.elf';run(TOOLS/'arm-none-eabi-g++','-nostdlib','-Wl,-r',BUILD/f'{stem}.o',BUILD/f'{stem}Hooks.o','-o',elf)
        assert not subprocess.check_output([str(TOOLS/'arm-none-eabi-nm'),'-u',str(elf)]).strip()
        meta=BUILD/'metadata.yml';meta.write_text(f'PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: {VERSION}\n')
        esdb=BUILD/'symbols.yml';esdb.write_text('Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n')
        dll=ASSETS/f'{stem}.dll';run('java','-cp',JAR,'rpm.cli.RPMTool','-i',elf,'--fourcc','DLXF','-o',dll,'--esdb',esdb,'--meta',meta,'--generate-relocations','--strip')
        blob=dll.read_bytes();h=struct.unpack_from('<I',blob,8)[0];info=h+struct.unpack_from('<I',blob,h+8)[0]
        start,size=struct.unpack_from('<II',blob,info+16);code=blob[start:start+size];fnv=0x811c9dc5
        for b in code:fnv=((fnv^b)*0x1000193)&0xffffffff
        manifest['games'][game]={'idCode':bytes(rom.idCode).decode(),'revision':0,'fileName':dll.name,'sha256':hashlib.sha256(blob).hexdigest(),
          'codeFingerprint':f'{fnv:08x}','bssSize':struct.unpack_from('<I',blob,h+12)[0],'signatures':signatures}
        print(dll.name,len(blob), 'bytes; code',size)
    (ASSETS/'cgearQuickActionsManifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
if __name__=='__main__':main()
