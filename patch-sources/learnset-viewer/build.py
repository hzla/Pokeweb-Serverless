"""Build the two standalone companions for each verified US BW2 revision.

Only generated build outputs and bundled assets are written. Retail binaries
are inputs, never modified. Override tool paths with environment variables.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import tempfile
import ndspy.rom
import ndspy.narc
import ndspy.codeCompression
from background import profile, palette_index, header as background_header

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
WORKSPACE = REPO.parent
BUILD = HERE / "build"
ASSETS = REPO / "src/assets/codeinjection"
TOOLS = Path(os.environ.get("ARM_TOOLCHAIN_BIN", WORKSPACE / "toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin"))
JAR = Path(os.environ.get("RPM_TOOL_JAR", WORKSPACE / "White2Upgrade/CTRMap.jar"))
PINS = {
    "W2": {12: "4086a96335723d80eba824fadd689d1f46a90d39992639b8d102ab4b7d66725b", 165: "15f629232972cb92bb65bf3a9adb01ee7b3c82e237963cd63cd05359afe25c26", 258: "3e13bfb1d36051d574c575ca32e25bb8c4a824a69421ab952024fd170317256b"},
    "B2": {12: "7a3f4df4c7ce8b09194a95afbbf2a0f185560bf853ef1545f89d330c57a7ade0", 165: "a0e3266b197364d57686b45529e2d96c1d23df4c67123cb96f8480436c1c071c", 258: "a0e113fdb21611435e564decbaccc4a10a208fa564780df9d8b18c000960c5cc"},
}

def run(*args):
    subprocess.run([str(x) for x in args], check=True)

def calls(data, base, target):
    found=[]
    # End before the proc table: do not decode literal/data tables as code.
    for offset in range(0, 0x20e8, 2):
        a,b=struct.unpack_from("<HH",data,offset)
        if a&0xf800!=0xf000 or b&0xf800!=0xf800: continue
        delta=((a&0x7ff)<<12)|((b&0x7ff)<<1)
        if delta&0x400000: delta-=0x800000
        if base+offset+4+delta==target: found.append(base+offset)
    assert found, hex(target)
    return found

BUILD.mkdir(exist_ok=True)
VERSION = "1.4.3"
messages=json.loads((HERE/'info_messages.json').read_text())
assert len({key for key,text in messages})==len(messages)
header=['#pragma once', '#include "runtime.h"', 'enum class InfoMessage : u16 {']
header += [f'    {key},' for key,text in messages]
header += ['};',f'constexpr u32 InfoMessageCount={len(messages)};',
           'struct InfoConfig { u8 magic[8]; u16 version,count; u16 ids[InfoMessageCount][2]; };',
           'extern "C" { __attribute__((used,section(".learnset_info_config"))) volatile InfoConfig learnsetInfoConfig = {',
           "    {'L','S','V','I','N','F','1',0},1,InfoMessageCount,{",
           *['        {0xffff,0},' for _ in messages], '    }}; }']
(BUILD/'info_messages.generated.h').write_text('\n'.join(header)+'\n')
# PMC's priority-chain array has five entries (0..PMC_PATCH=4). Priority 5
# writes past it and never reaches the overlay activation chain.
PATCH_PRIORITY = 4
assert 0 <= PATCH_PRIORITY <= 4
manifest={"version":VERSION, "games":{}}
background_rows=None
for game,filename,delta in [("W2","cleanwhite2.nds",0),("B2","cleanblack2.nds",0x40)]:
    rom=ndspy.rom.NintendoDSRom.fromFile(Path(os.environ.get(f"LEARNSET_{game}_ROM",WORKSPACE/filename)))
    assert bytes(rom.idCode)==(b"IRDO" if game=="W2" else b"IREO")
    overlays=rom.loadArm9Overlays([12,165,258])
    arm9=ndspy.codeCompression.decompress(rom.arm9)
    arm_delta=0 if game=='W2' else 0x2c
    # Verify native list ownership and non-callback cursor reset separately.
    for address,expected in [
        (0x2024f8c,'78b581b0051c0c1c292000902004691c'),
        (0x2024fd8,'10b5041c00f042f8201c15f049f910bd'),
        (0x202ba90,'4173ff218173c1737047'),
        (0x204c23c,'0a8849888281c1817047'),
        (0x204c3a4,'18b4046e054b09072340090c0b4304490b40d10719430166')]:
        offset=address-arm_delta-rom.arm9RamAddress
        assert bytes(arm9[offset:offset+len(expected)//2]).hex()==expected
    # Independently verify the healthy two-pose party-icon cycle in each ROM.
    # NANR sequence 1 is the healthy party-icon idle animation.
    icon_files=ndspy.narc.NARC(rom.getFileByName('a/0/0/7')).files
    for member in (2,4,6):
        anm=icon_files[member]
        assert anm[:4]==b'RNAN' and anm[16:20]==b'KNBA'
        seq,frames,contents=(24+struct.unpack_from('<I',anm,p)[0] for p in (28,32,36))
        count,loop,kind,mode,offset=struct.unpack_from('<HHIII',anm,seq+16)
        assert (count,loop,kind,mode)==(2,0,0x10000,2)
        poses=[]
        for i in range(count):
            content,ticks=struct.unpack_from('<IH',anm,frames+offset+i*8)
            poses.append((struct.unpack_from('<H',anm,contents+content)[0],ticks))
        assert poses==[(0,8),(1,8)], f'Unexpected {game} healthy party-icon timing'
    for ovl,pin in PINS[game].items(): assert hashlib.sha256(overlays[ovl].data).hexdigest()==pin, f"Unexpected {game} overlay {ovl}"
    # Header reuses the upper tutor's native type badges, not category actors.
    # Verify both US resource mappings, single centered 32x16 cell and frame.
    types=ndspy.narc.NARC(rom.getFileByName('a/0/8/2')).files
    cell=types[60];anim=types[63]
    assert struct.unpack_from('<HHI',cell,24)==(1,0,24)
    assert struct.unpack_from('<HHI',cell,48)==(1,5,0)
    assert struct.unpack_from('<3H',cell,56)==(0x40f8,0x81f0,0)
    assert struct.unpack_from('<HHIII',anim,48)==(1,0,0x10000,2,0)
    assert struct.unpack_from('<H',anim,72)[0]==0
    for member in range(34,52):
        assert len(types[member])==304 and types[member][:4]==b'RGCN'
        assert struct.unpack_from('<I',types[member],40)[0]==256
    at=0x202d80c-arm_delta-rom.arm9RamAddress
    assert arm9[at:at+8].hex()=='5220704721207047'
    assert arm9[at+20:at+32].hex()=='223070473b3070473e307047'
    assert arm9[at+16:at+20]==struct.pack('<I',0x20920b8-arm_delta)
    at=0x20920b8-arm_delta-rom.arm9RamAddress
    assert bytes(arm9[at:at+18])==bytes([0,0,1,1,0,0,2,1,0,0,1,2,0,1,1,2,0,0])
    signatures=[]
    def signature(label,ovl,address,length,patchType="",patchSize=0):
        o=overlays[ovl]; offset=address-o.ramAddress
        signatures.append({"label":label,"overlayId":ovl,"address":address,"expectedHex":bytes(o.data[offset:offset+length]).hex(),"patchType":patchType,"patchSize":patchSize})
    menu=[".syntax unified", ".thumb"]
    for label,ovl,addr,body in [
        ("MenuCreate",165,0x219fca0,"push {r4,r5,r6,r7,lr}\nsub sp,#12\nadds r6,r0,#0\nadds r0,r2,#0"),
        ("MenuSelect",165,0x219d024,"push {r4,r5,r6,r7,lr}\nsub sp,#68\nmovs r5,#163\nadds r4,r0,#0"),
        ("Dispatch",12,0x215b54c,"push {r4,r5,r6,r7,lr}\nsub sp,#12\nadds r7,r1,#0\nadds r5,r0,#0"),
    ]:
        addr-=delta
        symbol=f"FULL_COPY_{ovl}_0x{addr:x}"
        # Eight-byte absolute veneer; these functions take <=3 arguments, so
        # r3 is caller-scratch. No SP, LR, or callee-saved register is clobbered.
        menu += [".balign 4",f".global {symbol}",f".type {symbol},%object",symbol+":",
                 "ldr r3,1f", "bx r3", "1: .word Learnset"+label,f".size {symbol},.-{symbol}",
                 ".balign 4",f".global Original{label}",f".type Original{label},%function",".thumb_func",f"Original{label}:",
                 body,"ldr r3,1f","bx r3",f"1: .word 0x{addr+9:x}",f".size Original{label},.-Original{label}"]
        signature(label,ovl,addr,16,"FULL_COPY",8)
    viewer=[".syntax unified", ".thumb"]
    ov=overlays[258]
    for target,label in [(0x219a7f0,"DrawLine"),(0x219b994,"Confirm"),(0x219b6c8,"EnterButton"),
                         (0x219a9d8,"Details"),(0x219b180,"TypeIcons"),(0x219a4c4,"FixedText")]:
        for address in calls(ov.data,ov.ramAddress,target-delta):
            symbol=f"THUMB_BRANCH_LINK_258_0x{address:x}"
            viewer += [".balign 4",f".global {symbol}",f".type {symbol},%function",".thumb_func",symbol+":",
                       "ldr r3,1f","bx r3","1: .word Learnset"+label,f".size {symbol},.-{symbol}"]
            signature(label,258,address,4,"THUMB_BRANCH_LINK",4)
    # This call has seven parameters: tail branch must preserve r3 and SP.
    address=0x2199f24-delta
    symbol=f"THUMB_BRANCH_LINK_258_0x{address:x}"
    viewer += [".balign 4",f".global {symbol}",f".type {symbol},%function",".thumb_func",symbol+":",
               "push {r3}","ldr r3,1f","mov ip,r3","pop {r3}","bx ip",".balign 4",
               "1: .word LearnsetScreen",f".size {symbol},.-{symbol}"]
    signature("Private lower background",258,address,4,"THUMB_BRANCH_LINK",4)
    address=0x2199fe4-delta
    symbol=f"THUMB_BRANCH_LINK_258_0x{address:x}"
    viewer += [".balign 4",f".global {symbol}",f".type {symbol},%function",".thumb_func",symbol+":",
               "push {r3}","ldr r3,1f","mov ip,r3","pop {r3}","bx ip",".balign 4",
               "1: .word LearnsetWindow",f".size {symbol},.-{symbol}"]
    signature("Private upper window layout",258,address,4,"THUMB_BRANCH_LINK",4)
    address=0x219b9e8-delta
    symbol=f"FULL_COPY_258_0x{address:x}"
    viewer += [".balign 4",f".global {symbol}",f".type {symbol},%object",symbol+":",
               ".word LearnsetViewerInit,LearnsetViewerMain,LearnsetViewerEnd",f".size {symbol},.-{symbol}"]
    signature("Viewer callbacks",258,address,12,"FULL_COPY",12)
    # Layout-sensitive, non-hooked regions also gate installation.
    for label,addr,length in [("Tutor work size",0x2199900,0x2e),("Tutor list offsets",0x219a7f0,0x20),
                              ("Tutor bitmap layout",0x219bbcc,28),("Tutor resource load",0x219af0a,14),
                              ("Tutor font palette load",0x2199f4e,0x34),
                              ("Tutor list redraw",0x219a8ec,0x50),
                              ("Tutor list ownership and count",0x219a93c,0x9c),
                              ("Tutor selected cursor refresh",0x219b2f4,0x84),
                              ("Tutor scroll control refresh",0x219b77c,0x6c),
                              ("Tutor scroll arrow refresh",0x219b858,0x64),
                              ("Tutor type graphics queue",0x219b0b8,0xc8),
                              ("Tutor upper type resources",0x219af2a,0x120),
                              ("Tutor upper type actors",0x219bf58,0x58)]:
        signature(label,258,addr-delta,length)
    graphics=ndspy.narc.NARC(rom.getFileByName("a/1/2/5"))
    assert {palette_index(graphics.files,2,x,y) for x in (8,16,64,200) for y in (8,20,36)}=={17}, 'Unexpected lower description fill index'
    assert {palette_index(graphics.files,2,x,8) for x in (0,1,2)}=={21}, 'Unexpected lower description left shade'
    assert {palette_index(graphics.files,2,x,y) for x,y in ((3,8),(4,16),(120,32))}=={19}, 'Unexpected lower description rules'
    rows=profile(graphics.files)
    if background_rows is not None: assert rows==background_rows, 'US W2/B2 tutor backgrounds differ'
    background_rows=rows
    (BUILD/'info_background.generated.h').write_text(background_header(rows))
    resources=[{"member":n,"sha256":hashlib.sha256(graphics.files[n]).hexdigest()} for n in [0,1,2,4,5,7,8,17]]
    manifest["games"][game]={"idCode":bytes(rom.idCode).decode(),"hooks":signatures,"resources":resources}
    esdb=BUILD/f"symbols_{game}.yml"
    esdb.write_text("Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n")
    for group,asm in [("Menu",menu),("Viewer",viewer)]:
        (BUILD/f"{group}{game}.s").write_text("\n".join(asm)+"\n")
        objects=[]
        sources=[HERE/f"{group.lower()}.cpp",HERE/"config.cpp",HERE/"memory.cpp"]
        if group=='Viewer':sources.append(HERE/'info.cpp')
        for source in sources:
            obj=BUILD/f"{source.stem}{group}{game}.o"; objects.append(obj)
            run(TOOLS/"arm-none-eabi-g++","-std=c++17","-mthumb","-march=armv5t","-mlong-calls","-Os","-Wall","-Wextra","-Werror",
                "-fno-exceptions","-fno-rtti","-fno-unwind-tables","-fno-asynchronous-unwind-tables","-ffreestanding","-fno-builtin",
                "-fvisibility=hidden",f"-DGAME_{game}","-I",BUILD,"-I",HERE,"-c",source,"-o",obj)
        hook=BUILD/f"{group}{game}.o"; objects.append(hook)
        run(TOOLS/"arm-none-eabi-as","-mthumb","-march=armv5t",BUILD/f"{group}{game}.s","-o",hook)
        elf=BUILD/f"Learnset{group}{game}.elf"
        run(TOOLS/"arm-none-eabi-g++","-mthumb","-march=armv5t","-nostdlib","-Wl,-r",*objects,"-o",elf)
        undefined=subprocess.check_output([str(TOOLS/"arm-none-eabi-nm"),"-u",str(elf)]).decode().strip()
        assert not undefined, undefined
        sections=subprocess.check_output([str(TOOLS/"arm-none-eabi-readelf"),"-SW",str(elf)]).decode()
        assert not re.search(r"\.(init_array|fini_array|ctors|dtors)\b",sections), "Constructors are not supported"
        meta=BUILD/f"{group}{game}.yml"
        meta.write_text(f"PMCGameID: {game}\nPMCModulePriority: {PATCH_PRIORITY}\nPMCVersion: {VERSION}\n")
        output=ASSETS/f"Learnset{group}{game}.dll"
        # RPMTool sometimes exits zero after a Java exception. A fresh temporary
        # output plus explicit parsing prevents accidentally publishing stale DLLs.
        with tempfile.TemporaryDirectory(prefix="learnset-rpm-",dir=BUILD) as temp:
            candidate=Path(temp)/output.name
            run("java","-cp",JAR,"rpm.cli.RPMTool","-i",elf,"--fourcc","DLXF","-o",candidate,"--esdb",esdb,"--meta",meta,"--generate-relocations","--strip")
            data=candidate.read_bytes()
            assert data[:4]==b"DLXF" and len(data)>128
            dump=subprocess.check_output(["java","-cp",str(JAR),"rpm.cli.RPMDump","--fourcc","DLXF","-i",str(candidate)])
            assert b"Symbol count:" in dump and b"<anonymous>" in dump and b"Exception" not in dump
            output.write_bytes(data)
        (BUILD/f"Learnset{group}{game}.dump.txt").write_bytes(dump)
        print(output.name,output.stat().st_size)
(ASSETS/"learnsetViewerManifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
