"""Build the independent White 2 save-menu PMC module."""
from pathlib import Path
import hashlib,os,shutil,subprocess
import ndspy.rom
from sys import path as sys_path
sys_path.insert(0, str(Path(__file__).resolve().parent.parent / 'battle-type-hud'))
from rpm_read import read_rpm

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
TOOLS=Path(os.environ.get('ARM_TOOLCHAIN_BIN',ROOT/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
JAR=Path(os.environ.get('RPM_TOOL_JAR',ROOT/'White2Upgrade/CTRMap.jar'))
TARGET=ROOT.parent/'White2Upgrade-Following-0.7.16-alpha.nds'
TARGET_SHA='6aab8eeff93ff966fce3c2a44162bfa10052511f3b7f69e000815852af05d1c9'
BUILD=HERE/'build'
def run(*args):subprocess.run([str(x) for x in args],check=True)
def main():
    assert hashlib.sha256(TARGET.read_bytes()).hexdigest()==TARGET_SHA
    run('python3',HERE/'assets.py')
    rom=ndspy.rom.NintendoDSRom.fromFile(TARGET)
    ov=rom.loadArm9Overlays([162])[162]
    hook=0x0219d9e4
    assert ov.data[hook-ov.ramAddress:hook-ov.ramAddress+16].hex()=='38b519251c1c2d016159201c8a000849'
    BUILD.mkdir(exist_ok=True)
    asm='''\
.syntax unified
.thumb
.balign 4
.global FULL_COPY_162_0x219d9e4
.type FULL_COPY_162_0x219d9e4,%object
FULL_COPY_162_0x219d9e4:
    push {r3}
    ldr r3,1f
    mov ip,r3
    pop {r3}
    bx ip
    .balign 4
1:  .word SaveMenuMain
.size FULL_COPY_162_0x219d9e4,.-FULL_COPY_162_0x219d9e4
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
2:  .word 0x021a1770
3:  .word 0x0219d9f5
.size OriginalSaveMenuMain,.-OriginalSaveMenuMain
'''
    (BUILD/'hook.s').write_text(asm)
    (BUILD/'esdb.yml').write_text('Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n')
    (BUILD/'meta.yml').write_text('PMCGameID: W2\nPMCModulePriority: 4\nPMCVersion: 0.1.9\n')
    run(TOOLS/'arm-none-eabi-g++','-std=c++17','-mthumb','-march=armv5t','-mlong-calls','-Os','-Wall','-Wextra','-Werror','-ffreestanding','-fno-exceptions','-fno-rtti','-fno-unwind-tables','-fno-asynchronous-unwind-tables','-fno-builtin','-fvisibility=hidden','-c',HERE/'menu.cpp','-o',BUILD/'menu.o')
    run(TOOLS/'arm-none-eabi-g++','-std=c++17','-mthumb','-march=armv5t','-Os','-Wall','-Wextra','-Werror','-ffreestanding','-fno-builtin','-c',HERE/'memory.cpp','-o',BUILD/'memory.o')
    run(TOOLS/'arm-none-eabi-as','-mthumb','-march=armv5t',BUILD/'hook.s','-o',BUILD/'hook.o')
    run(TOOLS/'arm-none-eabi-g++','-mthumb','-march=armv5t','-nostdlib','-Wl,-r',BUILD/'menu.o',BUILD/'memory.o',BUILD/'hook.o','-o',BUILD/'SaveMenuW2.elf')
    assert not subprocess.check_output([str(TOOLS/'arm-none-eabi-nm'),'-u',str(BUILD/'SaveMenuW2.elf')]).strip()
    out=BUILD/'SaveMenuW2.dll'
    run('java','-cp',JAR,'rpm.cli.RPMTool','-i',BUILD/'SaveMenuW2.elf','--fourcc','DLXF','-o',out,'--esdb',BUILD/'esdb.yml','--meta',BUILD/'meta.yml','--generate-relocations','--strip')
    assert out.read_bytes()[:4]==b'DLXF'
    assert read_rpm(out.read_bytes())['expanded_size']<0x10000
    shutil.copyfile(out,HERE.parents[1]/'src/assets/codeinjection/SaveMenuW2.dll')
    print(out,out.stat().st_size)
if __name__=='__main__':main()
