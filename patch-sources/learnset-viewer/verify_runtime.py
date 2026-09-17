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
    stubs={};logs=[];draws=[];freed=[];queue=[];arena=[0x2260000];sounds=[]
    def allocate(size):
        p=arena[0];arena[0]=(p+size+7)&~7;return p
    def ret(value=0):uc.reg_write(REGS[0],value);uc.reg_write(UC_ARM_REG_PC,uc.reg_read(UC_ARM_REG_LR))
    def intercept(_uc,address,size,_):
        if address==STOP:uc.emu_stop();return
        if address in stubs:
            assert uc.reg_read(UC_ARM_REG_SP)%8==0, f"misaligned native call {address:x}"
            stubs[address]();return
        assert 0x02300000<=address<0x02320000, f"uninstrumented native call {address:x}"
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
    # Execute the actual seven-argument window hook veneer, not just its C++
    # destination. It must preserve width in r3 and all three stack arguments.
    windows=[]
    def window():
        windows.append([r(i) for i in range(4)]+list(struct.unpack('<3I',uc.mem_read(uc.reg_read(UC_ARM_REG_SP),12))))
        ret(0x2205000)
    stubs[0x20480ec-delta]=window
    hook=f'Viewer:THUMB_BRANCH_LINK_258_0x{0x2199fe4-ovdelta:x}'
    call(hook,[2,1,0,20,3,15,1]);assert windows[-1]==[2,1,0,20,3,15,1]
    active=symbols['Viewer:_ZN12_GLOBAL__N_16activeE']
    w32(active,0x2206000)
    call(hook,[2,1,0,20,3,15,1]);assert windows[-1]==[2,0,0,32,24,14,1]
    call(hook,[2,7,5,11,16,15,1]);assert windows[-1]==[2,0,24,1,1,15,1]
    call(hook,[6,8,9,21,11,15,1]);assert windows[-1]==[6,8,9,21,11,15,1]
    w32(active,0)
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
    party_count=[6];eggs=set();empty_slots=set();species=[6]*6;forms=[0]*6;keys=[0]
    mon=lambda slot:0x2220000+slot*256
    stubs[0x201fe24-delta]=lambda:ret(party_count[0])
    def party_mon():
        assert r(1)<party_count[0] and r(1)<6
        ret(mon(r(1)))
    stubs[0x201ff34-delta]=party_mon
    def pokemon_field():
        slot=(r(0)-mon(0))//256;assert 0<=slot<6
        ret({5:0 if slot in empty_slots else species[slot],0x4c:int(slot in eggs),0x6f:forms[slot]}.get(r(1),0))
    stubs[0x201cd24-delta]=pokemon_field
    stubs[0x20204ac-delta]=lambda:ret(r(0)+r(1))
    stubs[0x203df28-delta]=lambda:ret(keys[0])
    stubs[0x2006254]=lambda:(sounds.append(r(0)),ret())
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
    stubs[0x204c150-delta]=lambda:(logs.append(('visible',r(0),r(1))),ret())
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
    stubs[0x219a4c4-ovdelta]=lambda:(logs.append('native-fixed-text'),ret())
    for present in [False,True,True]:
        table=0x219b9e8-ovdelta
        callbacks=[symbols['Viewer:LearnsetViewer'+s] for s in ['Init','Main','End']]
        if not present:callbacks[0]=0x2199901-ovdelta
        uc.mem_write(table,struct.pack('<3I',*callbacks))
        w32(seq,13);w32(partydata+0x50,0x4c535631);w32(partydata+0x4c,2)
        call('Menu:LearnsetDispatch',[0x2205000,seq,eventwork]);assert u32(seq)==12
        bridge,request=queue[-1];w32(viewerwork,request)
        assert u16(request+32)==3 and u16(request+34)==260
        assert uc.mem_read(request+240,2)==b'\x02\xff'
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
    # Party navigation exercises both companions and a complete native End /
    # parent-dispatch / native Init boundary for every change. Request ownership
    # stays in the field; no list still used by the viewer is edited in place.
    table=0x219b9e8-ovdelta
    uc.mem_write(table,struct.pack('<3I',*[symbols['Viewer:LearnsetViewer'+s] for s in ['Init','Main','End']]))
    w32(seq,13);w32(partydata+0x50,0x4c535631);w32(partydata+0x4c,0)
    call('Menu:LearnsetDispatch',[0x2205000,seq,eventwork]);bridge,request=queue[-1]
    w32(viewerwork,request);call(u32(bridge),[0x2243000,seq,request,viewerwork])
    saved=bytes(uc.mem_read(mon(0),6*256))
    # Default count, bounded data and future/current moves are regenerated per
    # species/form. Slot 2 is an Egg; slot 4 is an invalid empty record.
    species[:]=[1,2,3,4,5,5];forms[5]=1;eggs.add(2);empty_slots.add(4)
    records=[b'\xff'*4,struct.pack('<4H',11,5,65535,65535),struct.pack('<4H',12,10,65535,65535),
             b'\xff'*4,b'\xff'*4,b'bad',struct.pack('<6H',16,50,17,80,65535,65535)]
    image_data=b''.join(records);offset=0;fat_entries=[]
    for record_data in records:fat_entries.append((offset,offset+len(record_data)));offset+=len(record_data)
    fat=b'BTAF'+struct.pack('<IHH',12+len(records)*8,len(records),0)+b''.join(struct.pack('<II',*entry) for entry in fat_entries)
    image=b'GMIF'+struct.pack('<I',8+len(image_data))+image_data
    archive=b'NARC'+struct.pack('<IIHH',0x0100fffe,16+len(fat)+8+len(image),16,3)+fat+b'BTNF'+struct.pack('<I',8)+image
    def switch(key,expected,count,status):
        # A different lower scroll/cursor and outgoing-evolution page cannot
        # carry into the new Pokemon's native initialization.
        uc.mem_write(request+20,struct.pack('<HHBB',3,12,1,1))
        before=len(queue);keys[0]=key;w32(seq,1);heard=len(sounds)
        call(u32(bridge+4),[0x2243000,seq,request,viewerwork])
        assert logs[-1]==8 and uc.mem_read(request+241,1)[0]==expected
        assert sounds[heard:]==[1637], 'One summary page-change sound per party switch'
        assert len(queue)==before and request not in freed
        # Repeat input during fade cannot enqueue a second transition.
        w32(seq,8);call(u32(bridge+4),[0x2243000,seq,request,viewerwork]);assert len(queue)==before
        assert sounds[heard:]==[1637], 'No repeated sound during a party fade'
        call(u32(bridge+8),[0x2243000,seq,request,viewerwork]);assert u32(active)==0
        keys[0]=0;w32(seq,13);call('Menu:LearnsetDispatch',[0x2205000,seq,eventwork])
        assert u32(seq)==12 and len(queue)==before+1 and queue[-1][1]==request and request not in freed
        assert u32(request)==mon(expected) and uc.mem_read(request+240,2)==bytes([expected,255])
        assert bytes(uc.mem_read(request+20,6))==b'\x00\x00\x00\x00\x00\xfe'
        assert u16(request+164)==count and u16(request+166)==status
        ids=[u16(request+168+i*2) for i in range(max(count,1)+1)]
        assert ids[-1]==65535 and (count or ids[0]==1)
        call(u32(bridge),[0x2243000,seq,request,viewerwork]);assert uc.mem_read(request+234,1)==b'\x01'
    switch(0x10,1,1,0) # Right: slot 1 -> slot 2.
    assert u16(request+168)==12
    switch(0x10,3,0,1) # Skip Egg; empty learnset is still viewable.
    switch(0x10,5,2,0) # Skip missing species; use current form's learnset.
    assert u16(request+168)==16 and u16(request+170)==17
    switch(0x10,0,1,0) # Right wraps.
    forms[5]=0
    switch(0x20,5,0,2) # Left wraps; malformed learnset never keeps old moves.
    switch(0x20,3,0,1)
    switch(0x20,1,1,0)
    for i in range(3):switch(0x20,0,1,0);switch(0x10,1,1,0)
    # The graph choice is ROM-tested in verify_info.py. Here execute the full
    # in-place refresh, retaining app/window/cursor ownership with no seq=8.
    nav_address=symbols['Viewer:_Z12infoNavigatePvP7Requestb']&~1
    nav_target=[(5,1)];fail=[None];new_lists=set();refreshes=[];message_calls=[0]
    def choose_family():
        assert r(0)==viewerwork and r(1)==request
        uc.mem_write(request+252,struct.pack('<4H',*nav_target[0],2,0))
        uc.mem_write(request+241,b'\xfe');ret(1)
    def new_list(count):
        p=allocate((count+1)*8);uc.mem_write(p,bytes((count+1)*8))
        w32(p+count*8,0xffffffff);w32(p+count*8+4,79);new_lists.add(p);return p
    def delete_list(p):
        assert p in new_lists and p not in freed
        for i in range(33):
            text=u32(p+8*i)
            if text in (0,0xffffffff):break
            assert text not in freed;freed.append(text)
        else:assert False,'Missing native list terminator'
        new_lists.remove(p);freed.append(p)
    def list_create():
        assert r(1)==79 and 1<=r(0)<=32
        ret(0 if fail[0]=='list' else new_list(r(0)))
    def message_open():
        assert r(2)==403 and r(3)==79
        message_calls[0]=0;ret(0 if fail[0]=='bank' else allocate(16))
    def move_message():
        message_calls[0]+=1
        if fail[0]==message_calls[0]:ret(0);return
        p=allocate(64);strings[p]='Move '+str(r(1))
        uc.mem_write(p,strings[p].encode('utf-16le')+b'\xff\xff');ret(p)
    stubs[nav_address]=choose_family
    stubs[0x2024f8c-delta]=list_create
    stubs[0x2024fd8-delta]=lambda:(delete_list(r(0)),ret())
    stubs[0x2048788-delta]=message_open
    stubs[0x2048800-delta]=lambda:(freed.append(r(0)),ret())
    stubs[0x20489b8-delta]=move_message
    stubs[0x2048590-delta]=lambda:(freed.append(r(0)),ret())
    stubs[0x202ba90-delta]=lambda:(logs.append(('cursor',r(0),r(1))),ret())
    reload_address=symbols['Viewer:_Z10infoReloadPvP7Request']&~1
    stubs[reload_address]=lambda:(refreshes.append(struct.unpack('<2H',uc.mem_read(request+244,4))),ret())
    for address,label in [(0x219a8ec,'redraw'),(0x219b77c,'scroll-controls'),(0x219b858,'scroll-arrows'),(0x219b2f4,'selection')]:
        stubs[address-ovdelta]=lambda label=label:(logs.append(label),ret())
    stubs[0x219a9d8-ovdelta]=lambda:(logs.append(('details',r(1))),ret())
    initial_list=new_list(1);w32(viewerwork+0x58,initial_list)
    w32(viewerwork+0x1c8,0x2257000)
    for key,identity,count,status in [(0x100,(5,1),2,0),(0x200,(1,0),1,0),(0x100,(4,0),0,1),(0x100,(5,0),0,2),(0x200,(5,1),2,0)]*3:
        nav_target[0]=identity;keys[0]=key;w32(seq,1);before=len(queue);heard=len(sounds)
        old=u32(viewerwork+0x58);uc.mem_write(request+20,struct.pack('<HHB',3,12,1))
        call(u32(bridge+4),[0x2243000,seq,request,viewerwork])
        assert u32(seq)==1 and len(queue)==before and u32(active)==request
        assert sounds[heard:]==[1356], 'One move-list click per family switch'
        assert uc.mem_read(request+234,1)==b'\x01'
        assert u32(request)==mon(1) and uc.mem_read(request+240,2)==b'\x01\xff'
        assert struct.unpack('<2H',uc.mem_read(request+244,4))==identity
        assert not any(uc.mem_read(request+252,8)) and u16(request+164)==count and u16(request+166)==status
        assert not any(uc.mem_read(request+20,5)) and u32(request+16)==request+168
        assert uc.mem_read(viewerwork+0x1b8,1)[0]==max(count,1)
        assert old in freed and new_lists=={u32(viewerwork+0x58)}
        assert refreshes[-1]==identity and ('details',u16(request+168) if count else 0xfffffffe) in logs
        assert logs[-1]==('visible',u32(viewerwork+0x10c),int(bool(count)))
        assert bytes(uc.mem_read(mon(0),6*256))==saved
    # Failed refreshes leave the old selection, moves, list and display intact.
    nav_target[0]=(5,1)
    for failure in ['list','bank',1,2]:
        fail[0]=failure;before=bytes(uc.mem_read(request,260));old=u32(viewerwork+0x58)
        count=len(refreshes);heard=len(sounds);call(u32(bridge+4),[0x2243000,seq,request,viewerwork])
        assert bytes(uc.mem_read(request,260))==before and u32(viewerwork+0x58)==old
        assert len(refreshes)==count and new_lists=={old} and u32(seq)==1
        assert len(sounds)==heard, 'Failed refreshes are silent'
    fail[0]=None
    # Native End owns the current list, including one created by a refresh.
    stubs[0x2199a50-ovdelta]=lambda:((delete_list(u32(viewerwork+0x58)) if u32(viewerwork+0x58) in new_lists else None),ret(1))
    del stubs[nav_address]
    switch(0x10,3,0,1) # Party navigation discards the family selection.
    assert struct.unpack('<4H',uc.mem_read(request+244,8))==(4,0,0,0)
    switch(0x20,1,1,0)
    # L/R and B do not request a party transition; simultaneous Left+Right
    # does nothing, and one non-Egg Pokemon never closes/reopens the viewer.
    for key in [0x100,0x200,0x30,0x12]:
        keys[0]=key;w32(seq,1);before=len(queue);heard=len(sounds)
        call(u32(bridge+4),[0x2243000,seq,request,viewerwork])
        assert uc.mem_read(request+241,1)==b'\xff' and len(queue)==before and logs[-1]==1
        assert len(sounds)==heard, 'No click for endpoints, conflicting keys or B'
    eggs.update([0,3,5])
    for key in [0x10,0x20]:
        keys[0]=key;w32(seq,1);heard=len(sounds);call(u32(bridge+4),[0x2243000,seq,request,viewerwork])
        assert u32(seq)==1 and uc.mem_read(request+241,1)==b'\xff'
        assert len(sounds)==heard, 'No click when there is no other eligible party member'
    call(u32(bridge+8),[0x2243000,seq,request,viewerwork]);w32(seq,13)
    call('Menu:LearnsetDispatch',[0x2205000,seq,eventwork]);assert freed.count(request)==1 and u32(seq)==11
    call('Menu:LearnsetDispatch',[0x2205000,seq,eventwork]);assert u32(partydata+0x4c)==1
    assert bytes(uc.mem_read(mon(0),6*256))==saved
    # Both old/mixed request ABIs are rejected before reading the new suffix.
    for version,size in [(1,236),(2,244)]:
        legacy=allocate(size);uc.mem_write(legacy,bytes(uc.mem_read(request,size)))
        uc.mem_write(legacy+25,b'\xfe');uc.mem_write(legacy+32,struct.pack('<HH',version,size));w32(legacy+28,0x3156534c)
        assert call('Viewer:LearnsetViewerInit',[0x2243000,seq,legacy,viewerwork])==1 and u32(active)==0
    assert call('Viewer:LearnsetConfirm',[viewerwork])==2
    call('Viewer:LearnsetDrawLine',[viewerwork,0,0]);assert logs[-1]=='native-row'
    call('Viewer:LearnsetFixedText',[viewerwork]);assert logs[-1]=='native-fixed-text'
    call('Viewer:LearnsetScreen',[0x2230000,2,7,24,2048,0,79]);assert logs[-1]==('native-screen',0x2230000,2,7,24,2048,0,79)
    print(game, 'compiled wrappers: capacity, selection, trampolines, lifetime, read-only guard, rows/PP/scroll, private divider, missing companion, party Left/Right/wrap/Egg/empty/form navigation and ABI rejection, no-fade family refresh/rollback/native list ownership, repeated sessions passed')
