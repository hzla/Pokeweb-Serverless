"""Read-only regression using the supplied DeSmuME capture; never boots a game.

Usage: python verify_dst.py CAPTURE.dst OLD_0.3.2.dll [NEW.dll]
Runs only the compiled Add/Main wrappers and their getter helpers. Native
creation/Main are no-ops because the captured gauge already exists. The state
and ROM memory stay private; only a small diagnostic report is written.
"""
from pathlib import Path
import hashlib, json, struct, sys, zlib
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_ARM, UC_HOOK_CODE, UC_HOOK_MEM_WRITE
from unicorn.arm_const import *
from rpm_read import read_rpm
from verify import ASSETS, REGS, SAVED, SP, STOP, normalized, setpixel, enemy_header, paint_expected

HERE=Path(__file__).resolve().parent
RAM=0x02000000
BASE=0x02e00020  # private fixture memory, outside the game's captured 4 MiB

def u32(b,p): return struct.unpack_from('<I',b,p)[0]

def read_state(path):
    raw=path.read_bytes()
    assert raw[:16]==b'DeSmuME SState\0\0' and u32(raw,16)==12
    data=raw[32:] if u32(raw,28)==0xffffffff else zlib.decompress(raw[32:])
    chunks={};p=0
    while p<len(data):
        kind=u32(data,p);p+=4
        if kind==0xffffffff:break
        size=u32(data,p);p+=4
        assert p+size<=len(data)
        chunks[kind]=data[p:p+size];p+=size
    mem={};p=0;data=chunks[4]
    while p<len(data):
        tag,size,count=struct.unpack_from('<4sII',data,p);p+=12
        assert p+size*count<=len(data)
        mem[tag.decode()]=data[p:p+size*count];p+=size*count
    assert len(mem['WRAM'])==0x400000 and len(mem['LCDM'])==0xa4000
    return mem

def relocated(rpm,base):
    code=bytearray(rpm['code'])
    for r in rpm['relocations']:
        if r['module']!='base':continue
        assert r['type']=='OFFSET'
        s=rpm['symbols'][r['symbol']]
        dest=s['address']+(0 if s['attributes']&4 else base)
        if s['type']==3:dest|=1
        struct.pack_into('<I',code,r['address'],dest)
    return bytes(code)

def installed_state(mem,profile,old):
    ram=mem['WRAM']
    site=next(h['address'] for h in profile['hooks'] if h['name']=='Main')
    a,b=struct.unpack_from('<HH',ram,site-RAM)
    assert a&0xf800==0xf000 and b&0xf800==0xf800
    delta=((a&2047)<<12)|((b&2047)<<1)
    if delta&0x400000:delta-=0x800000
    r=next(r for r in old['relocations'] if r['module']=='168' and r['address']==site)
    base=site+4+delta-old['symbols'][r['symbol']]['address']
    assert RAM<=base<RAM+len(ram)-len(old['code'])
    assert ram[base-RAM:base-RAM+len(old['code'])]==relocated(old,base), 'capture does not contain the supplied old DLL'
    state=base+len(old['code'])
    gauge=u32(ram,state-RAM)
    enemy=state+60
    battler=u32(ram,enemy+4-RAM)
    actual=ram[battler+0x19-RAM]
    saved=(ram[enemy+57-RAM]>>4)&7
    assert actual==12 and saved==4 and u32(ram,enemy-RAM)==0
    assert ram[state+360-RAM]==0
    return gauge,battler,dict(actual_battler_id=actual,truncated_saved_id=saved,
        old_enemy_binding_cleared=True,old_runtime_failure=0,loaded_old_code_matches=True)

def replay(mem,profile,rpm,gauge,battler,fixed):
    c=Uc(UC_ARCH_ARM,UC_MODE_ARM);c.ctl_set_cpu_model(UC_CPU_ARM_946)
    for start,size in ((0,0x10000),(RAM,0x1000000),(0x04000000,0x10000),
                       (0x05000000,0x1000),(0x06400000,0x10000)):
        c.mem_map(start,size)
    for address,data in ((0,mem['ITCM']),(RAM,mem['WRAM']),(0x02fe0000,mem['DTCM']),
                         (0x04000000,mem['9REG']),(0x05000000,mem['VMEM']),
                         (0x06400000,mem['LCDM'][0x80000:0x90000])):
        c.mem_write(address,data)
    c.mem_write(BASE,relocated(rpm,BASE)+b'\0'*rpm['bss'])
    state=BASE+len(rpm['code']);record=state+60
    entries={}
    for r in rpm['relocations']:
        if r['module']!='168':continue
        name=next(h['name'] for h in profile['hooks'] if h['address']==r['address'])
        entries[name]=BASE+rpm['symbols'][r['symbol']]['address']
    calls=[];writes=[]
    def original(c,pc,size,name):
        calls.append(name)
        if name=='Add':
            assert [c.reg_read(r) for r in REGS]==[gauge,0,battler,0]
            assert u32(c.mem_read(c.reg_read(UC_ARM_REG_SP),4),0)==1
        for r in REGS+[UC_ARM_REG_R12]:c.reg_write(r,0xdeadbeef)
        c.reg_write(UC_ARM_REG_R0,0);c.reg_write(UC_ARM_REG_PC,c.reg_read(UC_ARM_REG_LR))
    for name in ('Add','Main'):
        address=profile['functions'][name]
        c.hook_add(UC_HOOK_CODE,original,name,begin=address,end=address)
    def video_write(c,access,address,size,value,user):
        assert size in (2,4) and address%size==0
        writes.append((address,size))
    c.hook_add(UC_HOOK_MEM_WRITE,video_write,begin=0x06400000,end=0x0640ffff)
    def call(name,args):
        c.reg_write(UC_ARM_REG_CPSR,0x1f);c.reg_write(UC_ARM_REG_SP,SP);c.reg_write(UC_ARM_REG_LR,STOP|1)
        for r,arg in zip(REGS,args):c.reg_write(r,arg)
        for i,arg in enumerate(args[4:]):c.mem_write(SP+i*4,struct.pack('<I',arg))
        saved=[0x12340000+i for i in range(8)]
        for r,v in zip(SAVED,saved):c.reg_write(r,v)
        c.emu_start(entries[name]|1,STOP,count=2000000)
        assert c.reg_read(UC_ARM_REG_PC)==STOP and c.reg_read(UC_ARM_REG_SP)==SP
        assert [c.reg_read(r) for r in SAVED]==saved
    call('Add',(gauge,0,battler,0,1))
    assert c.mem_read(state+360,1)[0]==0
    if fixed:
        assert u32(c.mem_read(record,4),0)==gauge and c.mem_read(record+58,1)[0]==12
        graphics=u32(c.mem_read(record+12,4),0)
        before=mem['LCDM'][0x80000+graphics-0x06400000:0x80000+graphics-0x06400000+2048]
        expected=bytearray(normalized(before))
        enemy_header(expected,1);paint_expected(expected,(12,12),1,0)
        assert bytes(c.mem_read(graphics,2048))==expected, 'captured enemy icon pixels differ'
        assert all(graphics<=a and a+n<=graphics+2048 for a,n in writes)
        # The native palette getter runs against captured globals. Only its
        # two source and two transfer color entries may change in game RAM.
        bank=c.mem_read(record+57,1)[0]
        address=profile['functions']['GetPfd']
        c.reg_write(UC_ARM_REG_SP,SP);c.reg_write(UC_ARM_REG_LR,STOP|1)
        c.emu_start(address|1,STOP,count=10000)
        fade=c.reg_read(UC_ARM_REG_R0)+40
        source,transfer=struct.unpack('<II',c.mem_read(fade,8))
        allowed={p+bank*32+i*2+j for p in (source,transfer) for i in (4,15) for j in (0,1)}
        after=bytes(c.mem_read(RAM,0x400000))
        changed={RAM+i for i,(a,b) in enumerate(zip(mem['WRAM'],after)) if a!=b}
        assert changed<=allowed, [hex(a) for a in sorted(changed-allowed)[:12]]
        color=struct.pack('<H',ASSETS['rgb555'][12])
        for p in (source,transfer,0x05000200):
            for i in (4,15):assert bytes(c.mem_read(p+bank*32+i*2,2))==color
        # All other OBJ graphics, including Mew's existing icon and HP slash,
        # remain byte-identical to the capture.
        obj=bytearray(mem['LCDM'][0x80000:0x90000])
        obj[graphics-0x06400000:graphics-0x06400000+2048]=expected
        assert bytes(c.mem_read(0x06400000,0x10000))==obj
    else:
        assert u32(c.mem_read(record,4),0)==0 and not writes
        assert (c.mem_read(record+57,1)[0]>>4)&7==4
        assert bytes(c.mem_read(RAM,0x400000))==mem['WRAM']
    writes.clear();call('Main',(gauge,));assert not writes
    assert calls==['Add','Main']
    return dict(enemy_drawn=fixed,unchanged_frame_no_writes=True,
        native_getters='executed against captured RAM' if fixed else 'not reached',
        original_calls_preserved=True,unrelated_game_ram_and_graphics_unchanged=True)

def main():
    state_path,old_path=map(Path,sys.argv[1:3])
    new_path=Path(sys.argv[3]) if len(sys.argv)>3 else HERE/'build/TypeIconsW2.dll'
    mem=read_state(state_path);profile=json.loads((HERE/'profile-W2.json').read_text())
    old=read_rpm(old_path.read_bytes());new=read_rpm(new_path.read_bytes())
    gauge,battler,diagnosis=installed_state(mem,profile,old)
    report=dict(diagnosis=diagnosis,old_0_3_2=replay(mem,profile,old,gauge,battler,False),
        fixed=replay(mem,profile,new,gauge,battler,True),
        release_sha256=hashlib.sha256(new_path.read_bytes()).hexdigest(),
        writable_state_bytes=new['bss'],
        limitations=['Read-only captured-memory regression, no game boot or frames.',
                     'Native gauge creation and Main are no-ops; actual helper routines execute.'])
    (HERE/'build/captured-state-verification.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
