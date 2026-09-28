"""Build independent English Black 2 and White 2 save-menu PMC modules."""
from pathlib import Path
import os,shutil,subprocess
import ndspy.rom
from sys import path as sys_path
sys_path.insert(0, str(Path(__file__).resolve().parent.parent / 'battle-type-hud'))
from rpm_read import read_rpm

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
TOOLS=Path(os.environ.get('ARM_TOOLCHAIN_BIN',ROOT/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
JAR=Path(os.environ.get('RPM_TOOL_JAR',ROOT/'White2Upgrade/CTRMap.jar'))
ASSET_ROM=ROOT/'cleanwhite2.nds'
TARGETS={
    'W2': {'rom':ROOT/'cleanwhite2.nds','hook':0x0219d9e4,'table':0x021a1770},
    'B2': {'rom':ROOT/'cleanblack2.nds','hook':0x0219d9a4,'table':0x021a1730},
}
HOOK_BYTES=bytes.fromhex('38b519251c1c2d016159201c8a000849')
BUILD=HERE/'build'
def run(*args):subprocess.run([str(x) for x in args],check=True)
def main():
    BUILD.mkdir(exist_ok=True)
    run('python3',HERE/'assets.py','--rom',ASSET_ROM)
    for version,target in TARGETS.items():
        build_one(version,target)

def build_one(version,target):
    rom=ndspy.rom.NintendoDSRom.fromFile(target['rom'])
    assert bytes(rom.idCode)==(b'IRDO' if version=='W2' else b'IREO')
    ov=rom.loadArm9Overlays([162])[162]
    hook=target['hook']
    assert ov.data[hook-ov.ramAddress:hook-ov.ramAddress+16]==HOOK_BYTES
    suffix=version.lower()
    symbol=f'FULL_COPY_162_0x{hook:x}'
    continuation=hook+17
    asm='''\
.syntax unified
.thumb
.balign 4
.global @SYMBOL@
.type @SYMBOL@,%object
@SYMBOL@:
    push {r3}
    ldr r3,1f
    mov ip,r3
    pop {r3}
    bx ip
    .balign 4
1:  .word SaveMenuMain
.size @SYMBOL@,.-@SYMBOL@
.balign 4
.global OriginalSaveMenuMain
.type OriginalSaveMenuMain,%function
.thumb_func
OriginalSaveMenuMain:
    push {r3,r4,r5,lr}
    movs r5,#0x19
    adds r4,r3,#0
    lsls r5,r5,#4
    ldr r1,[r4,r5]
    adds r0,r4,#0
    lsls r2,r1,#2
    ldr r1,2f
    ldr r3,3f
    bx r3
    .balign 4
2:  .word @TABLE@
3:  .word @CONTINUATION@
.size OriginalSaveMenuMain,.-OriginalSaveMenuMain
'''.replace('@SYMBOL@',symbol).replace('@TABLE@',f"0x{target['table']:08x}").replace('@CONTINUATION@',f'0x{continuation:08x}')
    (BUILD/f'hook-{suffix}.s').write_text(asm)
    (BUILD/f'esdb-{suffix}.yml').write_text('Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n')
    (BUILD/f'meta-{suffix}.yml').write_text(f'PMCGameID: {version}\nPMCModulePriority: 4\nPMCVersion: 0.2.3\n')
    run(TOOLS/'arm-none-eabi-g++','-std=c++17','-mthumb','-march=armv5t','-mlong-calls','-Os','-Wall','-Wextra','-Werror','-ffreestanding','-fno-exceptions','-fno-rtti','-fno-unwind-tables','-fno-asynchronous-unwind-tables','-fno-builtin','-fvisibility=hidden',*(['-DSAVE_MENU_B2=1'] if version=='B2' else []),'-c',HERE/'menu.cpp','-o',BUILD/f'menu-{suffix}.o')
    run(TOOLS/'arm-none-eabi-g++','-std=c++17','-mthumb','-march=armv5t','-Os','-Wall','-Wextra','-Werror','-ffreestanding','-fno-builtin','-c',HERE/'memory.cpp','-o',BUILD/'memory.o')
    run(TOOLS/'arm-none-eabi-as','-mthumb','-march=armv5t',BUILD/f'hook-{suffix}.s','-o',BUILD/f'hook-{suffix}.o')
    elf=BUILD/f'SaveMenu{version}.elf'
    run(TOOLS/'arm-none-eabi-g++','-mthumb','-march=armv5t','-nostdlib','-Wl,-r',BUILD/f'menu-{suffix}.o',BUILD/'memory.o',BUILD/f'hook-{suffix}.o','-o',elf)
    assert not subprocess.check_output([str(TOOLS/'arm-none-eabi-nm'),'-u',str(elf)]).strip()
    out=BUILD/f'SaveMenu{version}.dll'
    run('java','-cp',JAR,'rpm.cli.RPMTool','-i',elf,'--fourcc','DLXF','-o',out,'--esdb',BUILD/f'esdb-{suffix}.yml','--meta',BUILD/f'meta-{suffix}.yml','--generate-relocations','--strip')
    assert out.read_bytes()[:4]==b'DLXF'
    assert read_rpm(out.read_bytes())['expanded_size']<0x10000
    shutil.copyfile(out,HERE.parents[1]/f'src/assets/codeinjection/SaveMenu{version}.dll')
    print(out,out.stat().st_size)
if __name__=='__main__':main()
