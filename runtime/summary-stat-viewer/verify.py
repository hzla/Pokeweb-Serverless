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
import ndspy.codeCompression
from build import TOOLS,HERE,WORKSPACE,HOOKS

REGS=[UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3,
      UC_ARM_REG_R4,UC_ARM_REG_R5,UC_ARM_REG_R6,UC_ARM_REG_R7,
      UC_ARM_REG_R8,UC_ARM_REG_R9,UC_ARM_REG_R10,UC_ARM_REG_R11]
STOP=0x2008000;STACK=0x23f0000;WORK=0x2200000;PARAM=0x2201000;POKE=0x2202000

def verify(game,od,ad):
    uc=Uc(UC_ARCH_ARM,UC_MODE_THUMB);uc.ctl_set_cpu_model(UC_CPU_ARM_946);uc.mem_map(0x2000000,0x400000)
    src=HERE/f'build/SummaryStatViewer{game}.elf';linked=src.with_suffix('.linked.elf')
    subprocess.run([str(TOOLS/'arm-none-eabi-ld'),'-Ttext','0x2300000','-Tdata','0x2320000','-e','SummaryInit',str(src),'-o',str(linked)],check=True,capture_output=True)
    symbols={}
    with linked.open('rb') as stream:
        elf=ELFFile(stream)
        for section in elf.iter_sections():
            if section['sh_flags']&2 and section['sh_type']!='SHT_NOBITS':uc.mem_write(section['sh_addr'],section.data())
        for symbol in elf.get_section_by_name('.symtab').iter_symbols():
            if symbol.name and symbol['st_shndx']!='SHN_UNDEF':symbols[symbol.name]=symbol['st_value']
    rom=ndspy.rom.NintendoDSRom.fromFile(WORKSPACE/('cleanwhite2.nds' if game=='W2' else 'cleanblack2.nds'))
    native_summary=rom.loadArm9Overlays([207])[207]
    for site in (0x21b9052,0x21b90b0,0x21b910e,0x21b916c,0x21b91ca):
        # Each native non-HP stat passes x=105 to the same numeric renderer.
        assert struct.unpack_from('<H',native_summary.data,site-od-native_summary.ramAddress)[0]==0x2069
    arm=ndspy.codeCompression.decompress(rom.arm9)
    uc.mem_write(0x203d91c-ad,bytes(arm[0x203d91c-ad-rom.arm9RamAddress:0x203d9c0-ad-rom.arm9RamAddress]))
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
    live_cgr=set();actors=set();units=set();log=[];values={};uploads=[];seq={};positions={}
    native={}
    def stub(w2,fn,ov=False):native[w2-(od if ov else ad)]=fn
    def intercept(_u,a,_s,_):
        if a==STOP:uc.emu_stop();return
        if a in native:
            assert uc.reg_read(UC_ARM_REG_SP)%8==0,f'Unaligned native call {a:x}'
            native[a]();return
        assert 0x2300000<=a<0x2330000 or 0x203d91c-ad<=a<0x203d9c0-ad,f'Unexpected native call {a:x}'
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
    def set_seq():seq[r(0)]=r(1);ret()
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
        uc.reg_write(REGS[1],touch[0]);uc.reg_write(REGS[2],touch[1]);uc.reg_write(UC_ARM_REG_PC,(0x203d970-ad)|1)
    def getter():log.append(('get',r(1)));ret(values.get(r(1),r(1)))
    def print_right():log.append(('print',args(7)));ret()
    def copy_title():log.append(('title',args(10)));ret()
    def title_chars():log.append(('native-chars',args(7)));ret(8192)
    def extra_chars():log.append(('extra-chars',args(4)));ret()
    stub(0x204b8e8,cgr);stub(0x204b9b8,release);stub(0x204bae4,replace)
    stub(0x204bf48,create_unit);stub(0x204bfc4,remove_unit);stub(0x204c06c,create_actor);stub(0x204c134,remove_actor)
    stub(0x204c4b4,set_seq);stub(0x204c23c,set_pos);stub(0x204bb84,get_proxy);stub(0x204c410,set_proxy)
    stub(0x204c150,lambda:ret());stub(0x204c54c,lambda:ret());stub(0x2021a68,lambda:ret());stub(0x2006254,lambda:ret())
    stub(0x203df70,lambda:ret(keys));stub(0x203da38,touch_hit);stub(0x201cd24,getter)
    stub(0x204add4,title_chars);stub(0x20450ac,extra_chars);stub(0x2045500,copy_title)
    stub(0x21b2fc0,original_init,True);stub(0x21b3198,original_end,True);stub(0x21b404c,original_keys,True)
    stub(0x21b4a10,refresh,True);stub(0x21b4220,lambda:ret(),True)
    stub(0x21b4f04,lambda:(log.append(('slash',args(6))),ret()),True);stub(0x21b5080,print_right,True)
    write(WORK,23);write(WORK+8,PARAM);write(WORK+0x44,1);write(WORK+0x98,7);write(WORK+0xfc,8);write(WORK+0xc8,99)
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
            # Stats touch resets; the bar-chart tab starts IVs, even after EVs.
            width=30 if ribbons else 40
            for x,wanted in [(0,0),(width-1,0),(width,1),(width*2-1,1),(width*2,8),(width*3-1,8),(120,3),(152,4),(176,5),(200,6),(232,7)]:
                touch=(x,180);assert call('SummaryHit',[table])==wanted,(x,wanted)
            if ribbons:
                touch=(90,180);assert call('SummaryHit',[table])==2
            write(WORK+0x24,8);call('SummaryTouch',[WORK]);assert u32(WORK+0x58)==1
            call('SummaryTick',[0x2208000]);assert seq[0x2205000]==5 and seq[0x2206100]==1
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
            call('SummaryHp',[WORK,2,3,4,89,1,7]);assert log[-1]==('print',[WORK,2,3,4,89,1,7])
            # A ten-argument and seven-argument real hook veneer preserve r3/SP.
            for label,site,_ in HOOKS:
                if label=='SummaryTitle':call(f'THUMB_BRANCH_LINK_207_0x{site-od:x}',[5,0,0,32,3,table,0,0,32,32])
                if label=='SummaryTitleChars':
                    call(f'THUMB_BRANCH_LINK_207_0x{site-od:x}',[1,11,5,0,0,0,23]);assert log[-2][1]==[1,11,5,0,0,0,23]
                    assert log[-1][1][0::2]==[5,640] and log[-1][1][3]==64
            call('SummaryEnd',[WORK]);assert not live_cgr and not actors and not units
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
    print(f'{game}: ABI, IV/EV ordering/extremes, navigation, retail touch scanner, title request lifetime, ownership and failure cleanup passed')

for g,od,ad in [('W2',0,0),('B2',0x40,0x2c)]:verify(g,od,ad)
