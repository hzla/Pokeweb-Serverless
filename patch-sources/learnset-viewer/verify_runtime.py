"""Execute compiled Thumb wrappers with instrumented native calls, not a game emulator.

Install unicorn==2.1.4 and pyelftools==0.32, or put them in build/python.
The retail functions are stubs; live graphics/input remain user acceptance tests.
"""
from pathlib import Path
import struct
import json
import subprocess
import sys
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/"build/python"))
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import UC_CPU_ARM_946, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_R4, UC_ARM_REG_R5, UC_ARM_REG_R6, UC_ARM_REG_R7, UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_PC
TOOLS=HERE.parents[2]/"toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin"
REGS=[UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3,UC_ARM_REG_R4,UC_ARM_REG_R5,UC_ARM_REG_R6,UC_ARM_REG_R7]
STOP=0x02008000
STACK=0x023f0000

for game,ovdelta,delta in [("W2",0,0),("B2",0x40,0x2c)]:
    uc=Uc(UC_ARCH_ARM,UC_MODE_THUMB);uc.ctl_set_cpu_model(UC_CPU_ARM_946);uc.mem_map(0x02000000,0x400000)
    symbols={}
    for group,base in [("Menu",0x2300000),("Viewer",0x2310000)]:
        source=HERE/f"build/Learnset{group}{game}.elf";linked=source.with_suffix(".linked.elf")
        subprocess.run([str(TOOLS/"arm-none-eabi-ld"),"-Ttext",hex(base),"-Tdata",hex(base+0x8000),"-e","Learnset"+("MenuCreate" if group=="Menu" else "ViewerInit"),str(source),"-o",str(linked)],check=True,capture_output=True)
        with linked.open("rb") as stream:
            elf=ELFFile(stream)
            for section in elf.iter_sections():
                if section['sh_flags']&2 and section['sh_type']!='SHT_NOBITS':uc.mem_write(section['sh_addr'],section.data())
            for symbol in elf.get_section_by_name('.symtab').iter_symbols():
                if symbol.name and symbol['st_shndx']!='SHN_UNDEF':symbols[group+":"+symbol.name]=symbol['st_value']
    manifest=json.loads((HERE.parents[1]/'src/assets/codeinjection/learnsetViewerManifest.json').read_text())
    for hook in manifest['games'][game]['hooks']:
        if hook['label'] in ['MenuCreate','MenuSelect','Dispatch']:
            address=symbols['Menu:Original'+hook['label']]&~1
            assert bytes(uc.mem_read(address,8))==bytes.fromhex(hook['expectedHex'])[:8], 'Trampoline must replay the exact native prologue'
    r=lambda n:uc.reg_read(REGS[n])
    u32=lambda p:struct.unpack("<I",uc.mem_read(p,4))[0]
    w32=lambda p,n:uc.mem_write(p,struct.pack("<I",n))
    u16=lambda p:struct.unpack("<H",uc.mem_read(p,2))[0]
    stubs={};logs=[];draws=[];freed=[];queue=[];arena=[0x2260000]
    def allocate(size):
        p=arena[0];arena[0]=(p+size+7)&~7;return p
    def ret(value=0):uc.reg_write(REGS[0],value);uc.reg_write(UC_ARM_REG_PC,uc.reg_read(UC_ARM_REG_LR))
    def intercept(_uc,address,size,_):
        if address==STOP:uc.emu_stop();return
        if address in stubs:
            assert uc.reg_read(UC_ARM_REG_SP)%8==0, f"misaligned native call {address:x}"
            stubs[address]();return
    uc.hook_add(UC_HOOK_CODE,intercept)
    def call(name,args):
        address=symbols.get(name,name)
        for i in range(8):uc.reg_write(REGS[i],args[i] if i<min(len(args),4) else 0x11110000+i)
        for i,value in enumerate(args[4:]):w32(STACK+i*4,value)
        uc.reg_write(UC_ARM_REG_SP,STACK);uc.reg_write(UC_ARM_REG_LR,STOP|1)
        uc.emu_start(address|1,STOP,count=100000)
        assert uc.reg_read(UC_ARM_REG_PC)==STOP, f"did not return from {name}"
        assert uc.reg_read(UC_ARM_REG_SP)==STACK
        assert [r(i) for i in range(4,8)]==[0x11110000+i for i in range(4,8)], name
        return r(0)
    def original(body_size,action):
        action()
        sp=uc.reg_read(UC_ARM_REG_SP)
        saved=struct.unpack("<5I",uc.mem_read(sp+body_size,20))
        for i in range(4):uc.reg_write(REGS[4+i],saved[i])
        uc.reg_write(UC_ARM_REG_SP,sp+body_size+20)
        uc.reg_write(UC_ARM_REG_PC,saved[4])
    stubs[0x219fca8-ovdelta]=lambda:original(12,lambda:None)
    stubs[0x219d02c-ovdelta]=lambda:original(68,lambda:logs.append("native-select"))
    def dispatch():
        seq=r(7)
        if u32(seq)==12:w32(seq,13)
        elif u32(seq)==11:w32(seq,12)
        uc.reg_write(REGS[0],0)
    stubs[0x215b554-ovdelta]=lambda:original(12,dispatch)
    stubs[0x20489b8-delta]=lambda:ret(allocate(32))
    work=0x2200000;menu=0x2201000;items=0x2202000;partydata=0x2203000
    w32(work+0x28c,partydata);w32(partydata+0x44,0);w32(work+0x138,0x2204000)
    for group in ['Menu','Viewer']:
        config=symbols[group+':learnsetConfig']
        for i,n in enumerate([50,60,61]):uc.mem_write(config+10+i*4,struct.pack('<HH',n,n^65535))
    for fields in range(5):
        for extras in range(3):
            count=4+fields+extras
            raw=[0,1,3,4]+([11,7][:extras])+[6,16]
            uc.mem_write(items,struct.pack('<8I',*(raw+[16]*(8-len(raw)))))
            uc.mem_write(menu,bytes(116));uc.mem_write(menu,bytes([min(count,8)]))
            ids=[0]+list(range(16,16+fields))+[3,4]+[11,7][:extras]+[6]
            for i,n in enumerate(ids[:8]):uc.mem_write(menu+2+2*i,struct.pack('<H',n))
            call('Menu:LearnsetMenuCreate',[work,menu,items])
            expected=count<8
            assert uc.mem_read(menu,1)[0]==min(count+int(expected),8)
            if expected:assert u16(menu+2+2*(count-1))==0x4c53 and u16(menu+2+2*count)==6
    w32(work+0x40,0x4c53);w32(work+0x30,2)
    call('Menu:LearnsetMenuSelect',[work]);assert u32(partydata+0x50)==0x4c535631 and u32(partydata+0x4c)==2
    w32(work+0x40,9);call('Menu:LearnsetMenuSelect',[work]);assert logs==['native-select']
    # Field handoff, tag recognition, missing-viewer fail-closed, and teardown.
    stubs[0x2039dc8-delta]=lambda:ret(allocate(r(1)))
    stubs[0x203a278-delta]=lambda:(freed.append(r(0)),ret())
    for address in [0x2016ad8,0x201735c,0x201736c]:stubs[address]=lambda:ret(0x2210000)
    stubs[0x201fe24-delta]=lambda:ret(6)
    stubs[0x201ff34-delta]=lambda:ret(0x2220000)
    stubs[0x201cd24-delta]=lambda:ret(6 if r(1)==5 else 0)
    stubs[0x20204ac-delta]=lambda:ret(6)
    stubs[0x204aa5c-delta]=lambda:ret(0x2230000)
    stubs[0x204adac-delta]=lambda:ret(1024)
    stubs[0x204ab38-delta]=lambda:ret()
    stubs[0x2070ca8-delta]=lambda:ret()
    stubs[0x2070ecc-delta]=lambda:ret(1)
    record=struct.pack('<6H',53,55,10,0,65535,65535)
    fat=b'BTAF'+struct.pack('<IHH',12+7*8,7,0)+struct.pack('<II',0,len(record))*7
    image=b'GMIF'+struct.pack('<I',8+len(record))+record
    archive=b'NARC'+struct.pack('<IIHH',0x0100fffe,16+len(fat)+8+len(image),16,3)+fat+b'BTNF'+struct.pack('<I',8)+image
    position=[0]
    stubs[0x2070dec-delta]=lambda:ret(len(archive))
    stubs[0x2070e54-delta]=lambda:(position.__setitem__(0,r(1)),ret(1))
    def fsread():
        data=archive[position[0]:position[0]+r(2)];uc.mem_write(r(1),data);position[0]+=len(data);ret(len(data))
    stubs[0x2070e6c-delta]=fsread
    stubs[0x2070de0-delta]=lambda:ret(1)
    stubs[0x2016a98]=lambda:(queue.append((r(2),r(3))),ret())
    eventwork=0x2240000;seq=0x2241000;params=0x2242000
    w32(eventwork+4,0);w32(eventwork+0x1c,partydata);w32(eventwork+0x18,params);w32(params,0x2210000)
    viewerwork=0x2250000
    stubs[0x2199900-ovdelta]=lambda:ret(1)
    stubs[0x2199974-ovdelta]=lambda:(logs.append(u32(r(1))),ret())
    stubs[0x2199a50-ovdelta]=lambda:ret(1)
    stubs[0x219b994-ovdelta]=lambda:(logs.append('native-confirm'),ret(2))
    stubs[0x219b6c8-ovdelta]=lambda:(logs.append(('button',r(1))),ret())
    # Instrument the real row-formatting code and the seven-argument resource
    # veneer. The same test runs against both separately compiled games.
    strings={};ppcalls=[];transfers=[];buffered=[True];screen_buffers={}
    def text_at(p):
        text=[]
        while u16(p)!=65535:
            text.append(chr(u16(p)));p+=2
            assert len(text)<256
        return ''.join(text)
    stubs[0x204871c-delta]=lambda:ret(r(0))
    stubs[0x2048640-delta]=lambda:(strings.__setitem__(r(0),text_at(r(1))),ret())
    stubs[0x20228b4-delta]=lambda:ret(len(strings[r(0)])*6)
    stubs[0x2048520-delta]=lambda:ret(r(0))
    stubs[0x2021d54-delta]=lambda:(draws.append((r(0),r(1),r(2),strings[r(3)],u32(uc.reg_read(UC_ARM_REG_SP)+4))),ret())
    stubs[0x20216dc-delta]=lambda:(ppcalls.append((r(0),r(1))),ret(20))
    for address in [0x2048270,0x2048298,0x2048500,0x2045ba8]:stubs[address-delta]=lambda:ret()
    original_tiles=struct.pack('<1024H',*range(1024))
    def load_screen():
        screen=allocate(2060);uc.mem_write(screen,struct.pack('<HHII',256,256,0,2048)+original_tiles)
        w32(r(3),screen);ret(screen)
    stubs[0x204b358-delta]=load_screen
    stubs[0x2044fdc-delta]=lambda:(transfers.append((r(0),r(2),r(3),bytes(uc.mem_read(r(1),2048)))),ret())
    stubs[0x2045840-delta]=lambda:ret(0x2258000 if buffered[0] else 0)
    def buffer_screen():
        assert r(2)==2048
        screen_buffers[r(0)]=(r(2),r(3),bytes(uc.mem_read(r(1),r(2))))
        ret()
    def upload_buffer():
        assert r(0) in screen_buffers, 'Upload must follow the CPU-side map update'
        transfers.append((r(0),*screen_buffers[r(0)]));ret()
    stubs[0x204508c-delta]=buffer_screen
    stubs[0x2044fbc-delta]=upload_buffer
    stubs[0x204af7c-delta]=lambda:(logs.append(('native-screen',r(0),r(1),r(2),r(3),*[u32(uc.reg_read(UC_ARM_REG_SP)+i*4) for i in range(3)])),ret())
    stubs[0x219a7f0-ovdelta]=lambda:(logs.append('native-row'),ret())
    for present in [False,True,True]:
        table=0x219b9e8-ovdelta
        callbacks=[symbols['Viewer:LearnsetViewer'+s] for s in ['Init','Main','End']]
        if not present:callbacks[0]=0x2199901-ovdelta
        uc.mem_write(table,struct.pack('<3I',*callbacks))
        w32(seq,13);w32(partydata+0x50,0x4c535631);w32(partydata+0x4c,2)
        call('Menu:LearnsetDispatch',[0x2205000,seq,eventwork]);assert u32(seq)==12
        bridge,request=queue[-1];w32(viewerwork,request)
        saved=bytes(uc.mem_read(0x2220000,220))
        assert call(u32(bridge),[0x2243000,seq,request,viewerwork])==1
        if present:
            assert uc.mem_read(request+0x19,1)==b'\x01'
            assert u16(request+36)==10 and u16(request+38)==0 and u16(request+40)==53
            assert call('Viewer:LearnsetConfirm',[viewerwork])==1
            call('Viewer:LearnsetEnterButton',[viewerwork,1]);assert logs[-1]==('button',0)
            for state,wanted in [(1,1),(2,1),(5,1),(6,1),(10,1),(14,8),(15,1)]:
                w32(seq,state);call(u32(bridge+4),[0x2243000,seq,request,viewerwork]);assert logs[-1]==wanted
            w32(viewerwork+0x58,0x2252000);w32(viewerwork+0x4c,0x2253000);w32(viewerwork+0x30,0x2254000)
            for level in [0,1,55,100]:
                uc.mem_write(request+38,struct.pack('<H',level))
                for name in ['SmokeScreen','A very long custom move name that needs truncation']:
                    uc.mem_write(0x2255000,name.encode('utf-16le')+b'\xff\xff');w32(0x2252000,0x2255000)
                    call('Viewer:LearnsetDrawLine',[viewerwork,0,0])
                    label,pp=draws[-2:]
                    assert label[1:3]==(2,0), 'Two-pixel icon gap must not move the row vertically'
                    assert label[3].startswith(f'{level} - ') and len(label[3])*6<=106 and label[4]==0x3c40
                    if len(name)>20:assert label[3].endswith('...')
                    assert pp==(0x2254000,120,0,'PP 20',0x440) and ppcalls[-1]==(10,0)
            # Four visible rows at a nonzero scroll position, not four copies
            # of the first row; move IDs remain independent from display text.
            uc.mem_write(request+164,struct.pack('<H',6))
            for i in range(6):
                uc.mem_write(request+36+i*4,struct.pack('<HH',10+i,i));w32(0x2252000+i*8,0x2255000)
            for pos in range(4):
                call('Viewer:LearnsetDrawLine',[viewerwork,2,pos])
                assert draws[-2][1:3]==(2,24*pos) and draws[-2][3].startswith(f'{2+pos} - ')
                assert draws[-1][1:3]==(120,24*pos), 'PP stays in its original column'
                assert ppcalls[-1]==(12+pos,0)
            before_count=len(draws);call('Viewer:LearnsetDrawLine',[viewerwork,2,4]);assert len(draws)==before_count
            hook=f'Viewer:THUMB_BRANCH_LINK_258_0x{0x2199f24-ovdelta:x}'
            call(hook,[0x2230000,2,7,24,2048,0,79])
            frame,length,offset,data=transfers[-1];assert (frame,length,offset)==(7,2048,24)
            assert screen_buffers[7][2]==data, 'A later redraw must not restore a blank/old map'
            call(0x2044fbd-delta,[7]);assert transfers[-1][3]==data
            tiles=struct.unpack('<1024H',data)
            for y in range(32):
                for x in range(32):
                    source=x
                    if 8<=y<21:
                        if 18<=x<=20:source=17
                        elif x in [21,22]:source=x-3
                    assert tiles[y*32+x]==y*32+source
            # Length zero means the NSCR's full raw size, not a compressed
            # stream. Also preserve the native fallback for unbuffered BGs.
            call(hook,[0x2230000,2,7,0,0,0,79]);assert transfers[-1][1:3]==(2048,0)
            buffered[0]=False
            call(hook,[0x2230000,2,7,0,2048,0,79]);assert transfers[-1][3]==data
            buffered[0]=True
        assert call(u32(bridge+8),[0x2243000,seq,request,viewerwork])==1
        w32(seq,13);call('Menu:LearnsetDispatch',[0x2205000,seq,eventwork]);assert freed.count(request)==1 and u32(seq)==11
        call('Menu:LearnsetDispatch',[0x2205000,seq,eventwork]);assert u32(partydata+0x4c)==2 and u32(seq)==12
        assert bytes(uc.mem_read(0x2220000,220))==saved
    assert call('Viewer:LearnsetConfirm',[viewerwork])==2
    call('Viewer:LearnsetDrawLine',[viewerwork,0,0]);assert logs[-1]=='native-row'
    call('Viewer:LearnsetScreen',[0x2230000,2,7,24,2048,0,79]);assert logs[-1]==('native-screen',0x2230000,2,7,24,2048,0,79)
    print(game, 'compiled wrappers: capacity, selection, trampolines, lifetime, read-only guard, rows/PP/scroll, private divider, missing companion, repeated sessions passed')
