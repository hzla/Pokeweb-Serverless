"""Run compiled Thumb code against instrumented native APIs; no game emulator.

These checks cover the wrapper ABI and ownership contracts. Rendering, native
flashing and live Summary contexts still require the user's acceptance run.
"""
from pathlib import Path
import struct
import subprocess
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent/'build/python'))
from elftools.elf.elffile import ELFFile
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_THUMB,UC_HOOK_CODE
from unicorn.arm_const import *
import ndspy.rom
import ndspy.narc
import ndspy.codeCompression
from build import TOOLS,HERE,WORKSPACE,HOOKS

REGS=[UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3,
      UC_ARM_REG_R4,UC_ARM_REG_R5,UC_ARM_REG_R6,UC_ARM_REG_R7,
      UC_ARM_REG_R8,UC_ARM_REG_R9,UC_ARM_REG_R10,UC_ARM_REG_R11]
STOP=0x2008000;STACK=0x23f0000;WORK=0x2200000;PARAM=0x2201000;POKE=0x2202000;SKILL=0x2209000

def verify(game,od,ad,bw1=None,extended=False):
    # Exercise work/Pokémon pointers in DSi extended RAM independently of code.
    WORK,PARAM,POKE,SKILL=[n+(0x800000 if extended else 0) for n in (0x2200000,0x2201000,0x2202000,0x2209000)]
    # BW1 supplies independently decoded entry points, including ARM mode.
    addr=lambda reference,ov=False: (bw1['addresses'][reference]&~1) if bw1 else reference-(od if ov else ad)
    thumb=lambda reference,ov=False: (True if ov else bool(bw1['addresses'][reference]&1)) if bw1 else True
    hooks=bw1['hooks'] if bw1 else [(label,site-od,target) for label,site,target in HOOKS]
    overlay_id=131 if bw1 else 207
    uc=Uc(UC_ARCH_ARM,UC_MODE_THUMB);uc.ctl_set_cpu_model(UC_CPU_ARM_946);uc.mem_map(0x2000000,0x1000000 if extended else 0x400000)
    src=HERE/f'build/SummaryStatViewer{game}.elf';linked=src.with_suffix('.linked.elf')
    subprocess.run([str(TOOLS/'arm-none-eabi-ld'),'-Ttext','0x2300000','-Tdata','0x2320000','-e','SummaryInit',str(src),'-o',str(linked)],check=True,capture_output=True)
    symbols={}
    with linked.open('rb') as stream:
        elf=ELFFile(stream)
        for section in elf.iter_sections():
            if section['sh_flags']&2 and section['sh_type']!='SHT_NOBITS':uc.mem_write(section['sh_addr'],section.data())
        for symbol in elf.get_section_by_name('.symtab').iter_symbols():
            if symbol.name and symbol['st_shndx']!='SHN_UNDEF':symbols[symbol.name]=symbol['st_value']
    rom=ndspy.rom.NintendoDSRom.fromFile(bw1['rom'] if bw1 else WORKSPACE/('cleanwhite2.nds' if game=='W2' else 'cleanblack2.nds'))
    native_summary=rom.loadArm9Overlays([overlay_id])[overlay_id]
    for site in ([0x21da1b2,0x21da210,0x21da26e,0x21da2cc,0x21da32a] if bw1 else [0x21b9052,0x21b90b0,0x21b910e,0x21b916c,0x21b91ca]):
        # Each native non-HP stat passes x=105 to the same numeric renderer.
        actual=site+(0x20 if game=='W' else 0) if bw1 else site-od
        assert struct.unpack_from('<H',native_summary.data,actual-native_summary.ramAddress)[0]==0x2069
    arm=ndspy.codeCompression.decompress(rom.arm9)
    touch_start,touch_end=(bw1['touchScanner']-0x6c,bw1['touchScanner']+0x7c) if bw1 else (0x203d91c-ad,0x203d9c0-ad)
    uc.mem_write(touch_start,bytes(arm[touch_start-rom.arm9RamAddress:touch_end-rom.arm9RamAddress]))
    # Derive the sound call from retail code, not the runtime's address table.
    # Both games call 0x02006254; the former B2 offset jumped into an epilogue.
    from build_bw1 import call_target
    sound_site=(0x21d54fe+(0x20 if game=='W' else 0)) if bw1 else 0x21b4276-od
    sound=call_target(native_summary.data[sound_site-native_summary.ramAddress:sound_site-native_summary.ramAddress+4],sound_site)&~1
    assert sound==(addr(0x2006254) if bw1 else 0x2006254)
    sound_body=bytes(arm[sound-rom.arm9RamAddress:sound-rom.arm9RamAddress+12])
    assert sound_body[:8]==bytes.fromhex('0021014bc9431847')
    sound_dispatch_address=struct.unpack_from('<I',sound_body,8)[0]&~1
    uc.mem_write(sound,sound_body)
    bitmap_get=addr(0x2048520);bitmap_size=8 if bw1 else 4
    uc.mem_write(bitmap_get,bytes(arm[bitmap_get-rom.arm9RamAddress:bitmap_get-rom.arm9RamAddress+bitmap_size]))
    sequence_if_changed=addr(0x204c4e4);sequence_size=36 if bw1 else 26
    uc.mem_write(sequence_if_changed,bytes(arm[sequence_if_changed-rom.arm9RamAddress:sequence_if_changed-rom.arm9RamAddress+sequence_size]))
    retail_ranges=[(addr(a,True),addr(a,True)+n) for a,n in [(0x21b8f50,0x354),(0x21b85e0,0x240),(0x21b8ce4,0xa4)]]
    for start,end in retail_ranges:
        uc.mem_write(start,bytes(native_summary.data[start-native_summary.ramAddress:end-native_summary.ramAddress]))
    for label,address,_ in hooks:
        if any(start<=address<end for start,end in retail_ranges):
            d=(symbols[label]&~1)-address-4
            uc.mem_write(address,struct.pack('<HH',0xf000|((d>>12)&2047),0xf800|((d>>1)&2047)))
    symbols['NativeSkillUpdate']=addr(0x21b85e0,True)
    r=lambda i:uc.reg_read(REGS[i])
    read=lambda p,n:bytes(uc.mem_read(p,n))
    u32=lambda p:struct.unpack('<I',read(p,4))[0]
    write=lambda p,n:uc.mem_write(p,struct.pack('<I',n))
    def ret(value=0):uc.reg_write(REGS[0],value);uc.reg_write(UC_ARM_REG_PC,uc.reg_read(UC_ARM_REG_LR))
    def args(n):return [r(i) for i in range(min(n,4))]+[u32(uc.reg_read(UC_ARM_REG_SP)+i*4) for i in range(max(0,n-4))]
    def call(name,a=()):
        for i in range(12):uc.reg_write(REGS[i],a[i] if i<min(4,len(a)) else 0x11110000+i)
        for i,x in enumerate(a[4:]):write(STACK+i*4,x)
        uc.reg_write(UC_ARM_REG_SP,STACK);uc.reg_write(UC_ARM_REG_LR,STOP|1)
        uc.emu_start(symbols[name]|1,STOP,count=300000)
        assert uc.reg_read(UC_ARM_REG_PC)==STOP,name
        assert uc.reg_read(UC_ARM_REG_SP)==STACK,name
        assert [r(i) for i in range(4,12)]==[0x11110000+i for i in range(4,12)],name
        return r(0)
    keys=0;touch=(0,0);next_cgr=0;failure=-1;fail_unit=False;fail_actor=False
    live_cgr=set();actors=set();units=set();log=[];values={};uploads=[];seq={};positions={};sequence_changes=[]
    native={};queue_busy=False;locked=False;cleared=[];window_uploads=[];sounds=[]
    modes={}
    def stub(w2,fn,ov=False):
        a=addr(w2,ov);native[a]=fn;modes[a]=thumb(w2,ov)
    def intercept(_u,a,_s,_):
        if a==STOP:uc.emu_stop();return
        if a in native:
            assert uc.reg_read(UC_ARM_REG_SP)%8==0,f'Unaligned native call {a:x}'
            if a in modes:assert bool(uc.reg_read(UC_ARM_REG_CPSR)&32)==modes[a],f'Wrong instruction mode at {a:x}'
            native[a]();return
        assert (0x2300000<=a<0x2330000 or touch_start<=a<touch_end
                or sound<=a<sound+12 or bitmap_get<=a<bitmap_get+bitmap_size
                or sequence_if_changed<=a<sequence_if_changed+sequence_size
                or any(start<=a<end for start,end in retail_ranges)),f'Unexpected native call {a:x}'
    uc.hook_add(UC_HOOK_CODE,intercept)
    def cgr():
        nonlocal next_cgr
        assert args(3)==[2304,0,23]
        if next_cgr==failure:ret(0xffffffff);return
        live_cgr.add(next_cgr);ret(next_cgr);next_cgr+=1
    def release():live_cgr.remove(r(0));log.append('release');ret()
    def replace():
        a=args(5);assert a[0] in live_cgr and a[2:]==[2304,0,0]
        assert not actors,'Graphics must be prepared before actor reveal'
        uploads.append(read(a[1],2304));ret()
    def create_unit():
        if fail_unit:ret();return
        units.add(0x2204000);ret(0x2204000)
    def remove_unit():units.remove(r(0));log.append('unit');ret()
    def create_actor():
        a=args(7);assert a[0] in units and a[1] in live_cgr and a[2:4]==[7,8] and a[5:]==[0,23]
        assert read(a[4],8)==struct.pack('<HHHBB',80,168,2,10,0)
        if fail_actor:ret();return
        actors.add(0x2205000);ret(0x2205000)
    def remove_actor():actors.remove(r(0));log.append('actor');ret()
    def set_seq():
        seq[r(0)]=r(1);sequence_changes.append((r(0),r(1)))
        uc.mem_write(r(0)+0x5a,struct.pack('<H',r(1)));ret()
    def set_pos():positions[r(0)]=struct.unpack('<hh',read(r(1),4));ret()
    def get_proxy():uc.mem_write(r(1),struct.pack('<9I',*([r(0)]*9)));ret()
    def set_proxy():assert r(0) in actors or r(0) in (0x2206000,0x2206100,0x2206200);ret()
    def original_init():ret(1)
    def original_end():assert not actors and not units and not live_cgr;log.append('native-end');ret(1)
    def original_keys():
        if keys&0x40:write(WORK+0x18,u32(WORK+0x18)+1)
        elif keys&0x10 and u32(WORK+0x58)==0:write(WORK+0x58,1)
        elif keys&0x20 and u32(WORK+0x58)==1:write(WORK+0x58,0)
        ret(1)
    def refresh():write(WORK+0xc,1);log.append(('refresh',u32(WORK+0x58)));ret()
    def touch_hit():
        # Execute the retail rectangle scanner and predicate, with touch input
        # supplied by this harness. This verifies the real inclusive boundaries.
        uc.reg_write(REGS[1],touch[0]);uc.reg_write(REGS[2],touch[1]);uc.reg_write(UC_ARM_REG_PC,bw1['touchScanner'] if bw1 else (0x203d970-ad)|1)
    def getter():log.append(('get',r(1)));ret(values.get(r(1),r(1)))
    def print_right():log.append(('print',args(7)));ret()
    def copy_title():log.append(('title',args(10)));ret()
    def title_chars():log.append(('native-chars',args(7)));ret(8192)
    def extra_chars():log.append(('extra-chars',args(4)));ret()
    def sound_dispatch():
        assert args(2)==[1637,0xffffffff]
        sounds.append(1637);ret()
    def pokemon_lock():
        nonlocal locked
        assert r(0)==WORK and r(1) in (0,1) and bool(r(1))!=locked
        locked=bool(r(1));ret()
    def clear_font():
        index=(r(0)-0x2220000)//0x40
        assert index in (0,2,3,4,5,6) and r(1)==0
        cleared.append(index);uc.mem_write(u32(r(0)),bytes(128));ret()
    def upload_window():
        index=(r(0)-0x2210000)//0x100
        assert 0<=index<8,'Stats variants must upload only top windows'
        window_uploads.append(index);ret()
    stub(0x204b8e8,cgr);stub(0x204b9b8,release);stub(0x204bae4,replace)
    stub(0x204bf48,create_unit);stub(0x204bfc4,remove_unit);stub(0x204c06c,create_actor);stub(0x204c134,remove_actor)
    stub(0x204c4b4,set_seq);stub(0x204c23c,set_pos);stub(0x204bb84,get_proxy);stub(0x204c410,set_proxy)
    stub(0x204c56c,lambda:ret())
    stub(0x204c150,lambda:ret());stub(0x204c54c,lambda:ret());stub(0x2021a68,lambda:ret())
    native[sound_dispatch_address]=sound_dispatch # execute the real sound wrapper; intercept only its tail dispatch
    stub(0x203df70,lambda:ret(keys));stub(0x203da38,touch_hit);stub(0x201cd24,getter)
    stub(0x204add4,title_chars);stub(0x20450ac,extra_chars);stub(0x2045500,copy_title)
    stub(0x21b2fc0,original_init,True);stub(0x21b3198,original_end,True);stub(0x21b404c,original_keys,True)
    stub(0x21b4a10,refresh,True);stub(0x21b4220,lambda:ret(),True)
    stub(0x21b4f04,lambda:(log.append(('slash',args(6))),ret()),True);stub(0x21b5080,print_right,True)
    stub(0x21b4e4c,pokemon_lock,True);stub(0x21b4e1c,lambda:ret(POKE),True)
    stub(0x2047168,clear_font)
    stub(0x2024200,lambda:ret(0x2223000));stub(0x2024548,lambda:ret());stub(0x20242a0,lambda:ret())
    stub(0x21ba57c,lambda:ret(0x440),True)
    stub(0x2048788,lambda:ret(0x2223100));stub(0x20489b8,lambda:ret(0x2223200))
    stub(0x2021ca8,lambda:ret());stub(0x2048590,lambda:ret());stub(0x2048800,lambda:ret())
    stub(0x2021c48,lambda:ret(int(queue_busy)));stub(0x2048270,upload_window)
    stub(0x2048298,lambda:ret());stub(0x2048500,lambda:ret(4));stub(0x2045ba8,lambda:ret())
    stub(0x20457bc,lambda:ret());stub(0x2044fbc,lambda:ret());stub(0x2045080,lambda:ret())
    stub(0x21b9804,lambda:ret(),True);stub(0x21ba67c,lambda:ret(),True)
    write(WORK,23);write(WORK+8,PARAM);write(WORK+0x44,1);write(WORK+0x98,7);write(WORK+0xfc,8);write(WORK+0xc8,99)
    write(WORK+0x90,SKILL)
    for i in range(13):
        window=0x2210000+i*0x100;buffer=0x2220000+i*0x40
        write(SKILL+0x5c+i*4,window);write(window+0xc,buffer);write(buffer,0x2221000+i*0x100)
        uc.mem_write(0x2221000+i*0x100,bytes([i+1])*128)
    write(SKILL+0x3c,0x2225000);write(0x2225008,128);write(SKILL+0x4c,0x2226000)
    uc.mem_write(SKILL+0xb0,bytes(range(144))) # bottom move actors, retained across variant changes
    for i in range(3):write(WORK+0x178+i*4,0x2206000+i*0x100)
    table=0x2207000;uc.mem_write(table,bytes.fromhex('a8c00028a8c02850a8c05078a8c07890a8c090a8a8c0a8c0a8c0c8e0a8c0e800ff000000'))
    config=symbols['summaryStatConfiguration']
    for enabled in (False,True):
        write(config+12,int(enabled));write(config+16,int(enabled)^0x53535631)
        for ribbons in (False,True):
            write(WORK+0x40,int(ribbons));write(WORK+0x58,0);write(WORK+0x38,0)
            assert call('SummaryInit',[WORK])==1
            assert len(live_cgr)==3 and len(actors)==1 and len(units)==1
            expected=[0,1,1]+([1] if enabled else [])+([2] if ribbons else [])
            for page in expected[1:]:
                keys=0x10;call('SummaryKeys',[WORK]);assert u32(WORK+0x58)==page
            keys=0x10;call('SummaryKeys',[WORK]);assert u32(WORK+0x58)==expected[-1]
            for page in reversed(expected[:-1]):
                keys=0x20;call('SummaryKeys',[WORK]);assert u32(WORK+0x58)==page
                call('SummaryTick',[0x2208000])
                if page==1:
                    # The final Stats stop must restore native selected seq 4.
                    assert seq[0x2206100]==(1 if u32(symbols['_ZN12_GLOBAL__N_17sessionE']+24) else 4)
            # Stats touch resets; the bar-chart tab starts IVs, even after EVs.
            width=30 if ribbons else 40
            for x,wanted in [(0,0),(width-1,0),(width,1),(width*2-1,1),(width*2,8),(width*3-1,8),(120,3),(152,4),(176,5),(200,6),(232,7)]:
                touch=(x,180);assert call('SummaryHit',[table])==wanted,(x,wanted)
            if ribbons:
                touch=(90,180);assert call('SummaryHit',[table])==2
            write(WORK+0x24,8);call('SummaryTouch',[WORK]);assert u32(WORK+0x58)==1
            call('SummaryTick',[0x2208000]);assert seq[0x2205000]==5 and seq[0x2206100]==1
            changes=len(sequence_changes)
            for _ in range(20):call('SummaryTick',[0x2208000])
            assert len(sequence_changes)==changes,'Unchanged footer sequences must not restart each frame'
            before=read(POKE,220)
            for mode,order in [(1,[70,71,72,74,75,73]),*([(2,[13,14,15,17,18,16])] if enabled else [])]:
                if mode==2:keys=0x10;call('SummaryKeys',[WORK])
                for field,actual in zip([160,162,163,165,166,164],order):
                    for value in ([0,31] if mode==1 else [0,252,255]):
                        values[actual]=value;assert call('SummaryValue',[POKE,field,0])==value
                log.clear();call('SummarySlash',[WORK,2,3,4,5,6]);call('SummaryMaxHp',[WORK,2,3,4,5,6,7]);assert not log
                call('SummaryHp',[WORK,2,3,4,5,6,7]);assert log[-1]==('print',[WORK,2,3,4,105,6,7])
                call('SummaryTitle',[5,0,0,32,3,table,0,0,32,32]);a=log[-1][1]
                assert a[:5]==[5,0,0,32,3] and a[6:]==[0,0,32,32]
                title=read(a[5],192);assert title==read(symbols['_ZL7ivTitle' if mode==1 else '_ZL7evTitle'],192)
            assert read(POKE,220)==before
            # Pokémon changes and the native move-detail page do not clear IVs.
            keys=0x40;call('SummaryKeys',[WORK]);keys=0;write(WORK+0x58,3);call('SummaryKeys',[WORK]);write(WORK+0x58,1)
            assert call('SummaryValue',[POKE,160,0])==values[13 if enabled else 70]
            write(WORK+0x24,1);call('SummaryTouch',[WORK]);assert call('SummaryValue',[POKE,160,0])==160
            call('SummaryTick',[0x2208000]);assert seq[0x2206100]==4 and seq[0x2205000]==2
            changes=len(sequence_changes)
            for _ in range(20):call('SummaryTick',[0x2208000])
            assert len(sequence_changes)==changes,'Restored Stats flashing must retain the native animation phase'
            call('SummaryHp',[WORK,2,3,4,89,1,7]);assert log[-1]==('print',[WORK,2,3,4,89,1,7])
            # A ten-argument and seven-argument real hook veneer preserve r3/SP.
            for label,site,_ in hooks:
                if label=='SummaryTitle':call(f'THUMB_BRANCH_LINK_{overlay_id}_0x{site:x}',[5,0,0,32,3,table,0,0,32,32])
                if label=='SummaryTitleChars':
                    call(f'THUMB_BRANCH_LINK_{overlay_id}_0x{site:x}',[1,11,5,0,0,0,23])
                    if bw1:
                        assert log[-3][1]==[1,11,5,0,0,0,23]
                        assert log[-2][1][0::2]==[5,320] and log[-2][1][3]==64
                        assert log[-1][1][0::2]==[5,320] and log[-1][1][3]==96
                    else:
                        assert log[-2][1]==[1,11,5,0,0,0,23]
                        assert log[-1][1][0::2]==[5,640] and log[-1][1][3]==64
            call('SummaryEnd',[WORK]);assert not live_cgr and not actors and not units
    # Real native numeric drawing and SkillUpdate must retain bottom resources,
    # leave the HP-bar bitmap intact, and wait for the queue before top uploads.
    for enabled in (False,True):
        write(config+12,int(enabled));write(config+16,int(enabled)^0x53535631)
        write(WORK+0x58,1);write(WORK+0x40,0);write(WORK+0xc,0);write(SKILL+4,0)
        call('SummaryInit',[WORK]);bottom=read(SKILL+0xb0,144);hpbar=read(0x2221100,128)
        owned=(actors.copy(),units.copy(),live_cgr.copy(),len(uploads))
        for key in ([0x10,0x10,0x20,0x20] if enabled else [0x10,0x20]):
            keys=key;log.clear();cleared.clear();window_uploads.clear();sound_count=len(sounds)
            call('SummaryKeys',[WORK])
            assert cleared==[0,2,3,4,5,6] and not locked
            assert not any(isinstance(x,tuple) and x[0]=='refresh' for x in log)
            assert u32(WORK+0xc)==0 and u32(SKILL+4)==1 and len(sounds)==sound_count+1
            assert read(SKILL+0xb0,144)==bottom and read(0x2221100,128)==hpbar
            queue_busy=True;call('NativeSkillUpdate',[WORK,SKILL]);assert not window_uploads and u32(SKILL+4)==1
            queue_busy=False;call('NativeSkillUpdate',[WORK,SKILL]);assert u32(SKILL+4)==0
            assert window_uploads==list(range(8))*2
            assert (actors,units,live_cgr,len(uploads))==owned
        # Radar and Stats touches take the same targeted path.
        for hit in (8,1):
            log.clear();cleared.clear();write(WORK+0x24,hit);call('SummaryTouch',[WORK])
            assert cleared==[0,2,3,4,5,6] and u32(WORK+0xc)==0
            assert not any(isinstance(x,tuple) and x[0]=='refresh' for x in log)
            call('NativeSkillUpdate',[WORK,SKILL])
        call('SummaryEnd',[WORK])
    # Eggs and restricted contexts delegate navigation and display native values.
    for egg,mode in [(1,0),(0,2)]:
        write(WORK+0x38,egg);uc.mem_write(PARAM+0xd,bytes([mode]));call('SummaryInit',[WORK]);write(WORK+0x24,8)
        call('SummaryTouch',[WORK]);assert call('SummaryValue',[POKE,160,0])==160;call('SummaryEnd',[WORK])
    # Failed registration releases every successful prior allocation.
    uc.mem_write(PARAM+0xd,b'\0');write(WORK+0x38,0)
    for n in range(3):
        failure=next_cgr+n;call('SummaryInit',[WORK]);assert not live_cgr and not actors and not units;call('SummaryEnd',[WORK])
    failure=-1
    for fail_unit,fail_actor in [(True,False),(False,True)]:
        call('SummaryInit',[WORK]);assert not live_cgr and not actors and not units
        call('SummaryEnd',[WORK])
    fail_unit=False;fail_actor=False
    for _ in range(25):
        call('SummaryInit',[WORK]);assert len(live_cgr)==3 and len(actors)==1 and len(units)==1
        call('SummaryEnd',[WORK]);assert not live_cgr and not actors and not units
    assert uploads and all(len(x)==2304 for x in uploads)
    assert sounds
    verify_titles(rom,read,symbols,bool(bw1))
    print(f'{game} ({"extended RAM" if extended else "DS RAM"}): ABI, IV/EV values/navigation, retail sound/touch/conditional sequence code, restored Stats selection without frame resets, top-only queued uploads, ownership and failure cleanup passed')

def verify_titles(rom,read,symbols,bw1=False):
    files=ndspy.narc.NARC(rom.getFileByName('a/0/7/8' if bw1 else 'a/0/7/7')).files
    chars=bytearray(files[9 if bw1 else 11][48:8240]);native=struct.unpack_from('<96H',files[75 if bw1 else 77],36)
    def pixel(data,tiles,x,y):
        t=tiles[y//8*32+x//8];xx=7-x%8 if t&1024 else x%8;yy=7-y%8 if t&2048 else y%8
        return data[(t&1023)*32+yy*4+xx//2]>>(xx%2*4)&15
    if bw1:
        used={tile&1023 for n in (65,69,75,76) for tile in struct.unpack_from('<1024H',files[n],36)}
        assert not used.intersection(list(range(64,74))+list(range(96,106)))
        glyphs=read(symbols['_ZL11titleGlyphs'],640)
        chars[64*32:74*32]=glyphs[:320];chars[96*32:106*32]=glyphs[320:]
        moves=struct.unpack_from('<96H',files[76],36)
        for label,stem_width in [('ivTitle',3),('evTitle',4)]:
            title=struct.unpack('<96H',read(symbols['_ZL7'+label],192))
            start=184+(32-(stem_width+4+4+2))//2
            sx=start+stem_width+1+4+1;vx=start+stem_width+1
            assert all(pixel(chars,title,sx+x,13+y)==pixel(chars,native,185+x,13+y) for y in range(7) for x in range(4))
            assert all(pixel(chars,title,vx+x,13+y)==pixel(chars,moves,222+x,13+y) for y in range(7) for x in range(4))
            if label=='evTitle':
                assert all(pixel(chars,title,start+x,13+y)==pixel(chars,moves,228+x,13+y) for y in range(7) for x in range(4))
            for y in range(24):
                for x in range(256):
                    if 185<=x<216 and 13<=y<20:continue
                    assert pixel(chars,title,x,y)==pixel(chars,native,x,y),'Native BW1 bar/arrows changed'
        return
    s=[[pixel(chars,native,190+x,14+y) for x in range(4)] for y in range(5)]
    a=[[pixel(chars,native,201+x,14+y) for x in range(5)] for y in range(5)]
    v=list(reversed(a));v[1]=v[1].copy();v[1][2]=3
    chars[64*32:84*32]=read(symbols['_ZL11titleGlyphs'],640)
    for label,stem_width in [('ivTitle',3),('evTitle',4)]:
        title=struct.unpack('<96H',read(symbols['_ZL7'+label],192))
        start=184+(40-(stem_width+5+4+2))//2
        sx=start+stem_width+1+5+1;vx=start+stem_width+1
        assert [[pixel(chars,title,sx+x,14+y) for x in range(4)] for y in range(5)]==s,'S must copy every native STATS pixel'
        assert [[pixel(chars,title,vx+x,14+y) for x in range(5)] for y in range(5)]==v,'V must use the native diagonal shades'
        assert all(pixel(chars,title,start+x,14+y) in (1,3) for y in range(5) for x in range(stem_width)),'I/E strokes must have no shadow pixels'
        for y in range(24):
            for x in range(256):
                if 190<=x<220 and 13<=y<20:continue
                assert pixel(chars,title,x,y)==pixel(chars,native,x,y),'Native bar and arrows must remain exact'
        assert all(pixel(chars,title,x,19)==3 for x in range(190,220)),'No offset shadow below the baseline'

if __name__=='__main__':
    for g,od,ad in [('W2',0,0),('B2',0x40,0x2c)]:verify(g,od,ad)
