"""Build the separately bound US Black/White functional C-Gear runtime."""
import hashlib,json,os,struct,subprocess
from pathlib import Path
from configure_bw1 import configure,header,CALLS,WORDS,FUNCTIONS,rom_path
import ndspy.narc
HERE=Path(__file__).resolve().parent;REPO=HERE.parents[1];WS=REPO.parent;BUILD=HERE/'build';ASSETS=REPO/'src/assets/codeinjection'
TOOLS=Path(os.environ.get('ARM_TOOLCHAIN_BIN',WS/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
JAR=Path(os.environ.get('RPM_TOOL_JAR',WS/'White2Upgrade/CTRMap.jar'));VERSION='0.1.2-bw1'
def run(*args):subprocess.run([str(a)for a in args],check=True)
def fingerprint(data):
    h=0x811c9dc5
    for b in data:h=((h^b)*0x1000193)&0xffffffff
    return f'{h:08x}'
def main():
    BUILD.mkdir(exist_ok=True)
    run(REPO/'node_modules/.bin/vite-node',REPO/'scripts/generate-cgear-button-defaults-bw1.ts',rom_path('B'))
    archive=(ASSETS/'cgearQuickActionsBw1.narc').read_bytes()
    m={'version':VERSION,'archivePath':'quick-actions/ui.narc','archiveSha256':hashlib.sha256(archive).hexdigest(),
       'defaultPcHideFlag':1517,'maxSaveFlag':2911,'format':9,'previousVersions':json.loads((HERE/'previous-bw1.json').read_text()),'games':{}}
    (BUILD/'profiles-bw1.generated.h').write_text(header())
    for game in ['B','W']:
        rom,p=configure(game)
        native=ndspy.narc.NARC(rom.files[rom.filenames.idOf('a/0/3/0')])
        backup=ndspy.narc.NARC(ndspy.narc.NARC(archive).files[14])
        assert native.files==backup.files
        p['nativeGraphicsFingerprint']=fingerprint(ndspy.narc.NARC(archive).files[14])
        script=ndspy.narc.NARC(rom.files[rom.filenames.idOf('a/0/5/7')]).files[868]
        (BUILD/'pc-bw1.generated.h').write_text(f'#pragma once\nconstexpr u32 PC_SCRIPT_SIZE={len(script)},PC_SCRIPT_HASH=0x{fingerprint(script)};\n')
        m['pcScript']={'archive':'a/0/5/7','member':868,'length':len(script),'fingerprint':fingerprint(script)}
        asm=['.syntax unified','.thumb']
        for label,module,black,white,target,prep in CALLS:
            a=black if game=='B'else white;sym=f'THUMB_BRANCH_LINK_{module}_0x{a:x}'
            asm+=['.balign 4',f'.global {sym}',f'.type {sym},%function','.thumb_func',sym+':']
            if prep:asm.append(prep)
            asm+=['push {r3}','ldr r3,1f','mov ip,r3','pop {r3}','bx ip','.balign 4',f'1: .word {label}',f'.size {sym},.-{sym}']
        for label,module,black,white,target in WORDS:
            a=black if game=='B'else white;sym=f'FULL_COPY_{module}_0x{a:x}'
            asm+=['.balign 4',f'.global {sym}',f'.type {sym},%object',sym+':',f'.word {label}',f'.size {sym},4']
        stem=f'CGearQuickActions{game}';source=BUILD/f'{stem}.s';source.write_text('\n'.join(asm)+'\n')
        run(TOOLS/'arm-none-eabi-g++','-std=c++17','-mthumb','-march=armv5t','-mlong-calls','-Os','-Wall','-Wextra','-Werror',
            '-fno-jump-tables','-fvisibility=hidden','-fno-exceptions','-fno-rtti','-fno-unwind-tables','-fno-asynchronous-unwind-tables',
            '-ffreestanding','-fno-builtin','-fno-tree-loop-distribute-patterns',f'-DGAME_{game}','-I',BUILD,'-c',HERE/'bw1.cpp','-o',BUILD/f'{stem}.o')
        run(TOOLS/'arm-none-eabi-as','-mthumb','-march=armv5t',source,'-o',BUILD/f'{stem}Hooks.o')
        elf=BUILD/f'{stem}.elf';run(TOOLS/'arm-none-eabi-g++','-nostdlib','-Wl,-r',BUILD/f'{stem}.o',BUILD/f'{stem}Hooks.o','-o',elf)
        assert not subprocess.check_output([str(TOOLS/'arm-none-eabi-nm'),'-u',str(elf)]).strip()
        meta=BUILD/'metadata-bw1.yml';meta.write_text(f'PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: {VERSION}\n')
        esdb=BUILD/'symbols-bw1.yml';esdb.write_text('Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n')
        dll=ASSETS/f'{stem}.dll';run('java','-cp',JAR,'rpm.cli.RPMTool','-i',elf,'--fourcc','DLXF','-o',dll,'--esdb',esdb,'--meta',meta,'--generate-relocations','--strip')
        blob=dll.read_bytes();h=struct.unpack_from('<I',blob,8)[0];info=h+struct.unpack_from('<I',blob,h+8)[0];start,size=struct.unpack_from('<II',blob,info+16)
        p.update(sha256=hashlib.sha256(blob).hexdigest(),codeFingerprint=fingerprint(blob[start:start+size]),bssSize=struct.unpack_from('<I',blob,h+12)[0])
        m['games'][game]=p;(HERE/f'profile-{game}.json').write_text(json.dumps(p,indent=2)+'\n')
        print(dll.name,len(blob),'bytes; code',size)
    (ASSETS/'cgearQuickActionsBw1Manifest.json').write_text(json.dumps(m,indent=2)+'\n')
if __name__=='__main__':main()
