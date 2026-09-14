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
VERSION = "1.0.3"
# PMC's priority-chain array has five entries (0..PMC_PATCH=4). Priority 5
# writes past it and never reaches the overlay activation chain.
PATCH_PRIORITY = 4
assert 0 <= PATCH_PRIORITY <= 4
manifest={"version":VERSION, "games":{}}
for game,filename,delta in [("W2","cleanwhite2.nds",0),("B2","cleanblack2.nds",0x40)]:
    rom=ndspy.rom.NintendoDSRom.fromFile(Path(os.environ.get(f"LEARNSET_{game}_ROM",WORKSPACE/filename)))
    assert bytes(rom.idCode)==(b"IRDO" if game=="W2" else b"IREO")
    overlays=rom.loadArm9Overlays([12,165,258])
    for ovl,pin in PINS[game].items(): assert hashlib.sha256(overlays[ovl].data).hexdigest()==pin, f"Unexpected {game} overlay {ovl}"
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
    address=0x219b9e8-delta
    symbol=f"FULL_COPY_258_0x{address:x}"
    viewer += [".balign 4",f".global {symbol}",f".type {symbol},%object",symbol+":",
               ".word LearnsetViewerInit,LearnsetViewerMain,LearnsetViewerEnd",f".size {symbol},.-{symbol}"]
    signature("Viewer callbacks",258,address,12,"FULL_COPY",12)
    # Layout-sensitive, non-hooked regions also gate installation.
    for label,addr,length in [("Tutor work size",0x2199900,0x2e),("Tutor list offsets",0x219a7f0,0x20),
                              ("Tutor bitmap layout",0x219bbcc,28),("Tutor resource load",0x219af0a,14)]:
        signature(label,258,addr-delta,length)
    graphics=ndspy.narc.NARC(rom.getFileByName("a/1/2/5"))
    resources=[{"member":n,"sha256":hashlib.sha256(graphics.files[n]).hexdigest()} for n in [0,1,2,5,7,8,17]]
    manifest["games"][game]={"idCode":bytes(rom.idCode).decode(),"hooks":signatures,"resources":resources}
    esdb=BUILD/f"symbols_{game}.yml"
    esdb.write_text("Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n")
    for group,asm in [("Menu",menu),("Viewer",viewer)]:
        (BUILD/f"{group}{game}.s").write_text("\n".join(asm)+"\n")
        objects=[]
        for source in [HERE/f"{group.lower()}.cpp",HERE/"config.cpp",HERE/"memory.cpp"]:
            obj=BUILD/f"{source.stem}{group}{game}.o"; objects.append(obj)
            run(TOOLS/"arm-none-eabi-g++","-std=c++17","-mthumb","-march=armv5t","-mlong-calls","-Os","-Wall","-Wextra","-Werror",
                "-fno-exceptions","-fno-rtti","-fno-unwind-tables","-fno-asynchronous-unwind-tables","-ffreestanding","-fno-builtin",
                "-fvisibility=hidden",f"-DGAME_{game}","-c",source,"-o",obj)
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
