"""Controlled native UI tests on an actual reset-booted battle snapshot.

Executes the installed status hook and all its real native callees in Unicorn,
then displays their non-stack writes in a private melonDS snapshot. Does not
change the Pokémon's gameplay status or claim a move-induced gameplay test.
"""
import json, struct, sys, os
from pathlib import Path
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_ARM,UC_HOOK_MEM_WRITE,UC_HOOK_CODE
from unicorn.arm_const import *
from analyze import HERE,ROOT
sys.path.insert(0,str(ROOT/'work/scan-button/emulator-ref/python'))
sys.path.insert(0,str(ROOT/'work/tagbattle-crash'))
from melonds import MelonDS
from compare_states import State
from live import report
REGS=[UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3]
STOP=0x02fd0000;SP=0x02fe1000
def main():
    game=sys.argv[1];folder=HERE/'build'/f'live-{game}{os.environ.get("BTH_LIVE_SUFFIX","")}';state=State(folder/'session.mln')
    p=json.loads((HERE/f'profile-{game}.json').read_text())
    emu=MelonDS(ROOT/'work/scan-button/emulator-build/src/headless/libmelonds_headless.dylib')
    emu.open(folder/'typehud.nds');emu.savestate.load_file(folder/'session.mln')
    live=report(emu,game);assert live.get('failure')==0 and live['records'][int(os.environ.get('BTH_RECORD','0'))]['painted']==1,live
    record=live['records'][int(os.environ.get('BTH_RECORD','0'))];gauge=int(record['gauge'],16);graphics=int(record['graphics'],16);pos=record['pos']
    mem=emu.memory
    obj=bytes(mem.unsigned[0x06400000:0x06410000]);pal=bytes(mem.unsigned[0x05000000:0x05000800])
    out=[]
    def cpu():
        c=Uc(UC_ARCH_ARM,UC_MODE_ARM);c.ctl_set_cpu_model(UC_CPU_ARM_946)
        for a,n in [(0,0x10000),(0x02000000,0x1000000),(0x04000000,0x10000),(0x05000000,0x1000),(0x06400000,0x10000)]:c.mem_map(a,n)
        c.mem_write(0,state.itcm);c.mem_write(0x02000000,state.ram);c.mem_write(0x02fe0000,state.dtcm)
        c.mem_write(0x06400000,obj);c.mem_write(0x05000000,pal)
        c.mem_write(0x04000000,struct.pack('<I',mem.read_long(0x04000000)))
        c.mem_write(0x04000244,bytes([mem.read_byte(0x04000244)]))
        return c
    for status in range(1,7):
        c=cpu();writes={};calls=[]
        def written(c,access,a,n,v,_):
            if 0x02fe0000<=a<0x02fe4000:return
            assert n in (1,2,4)
            if 0x06000000<=a<0x07000000:assert n>=2
            writes[(a,n)]=True
        c.hook_add(UC_HOOK_MEM_WRITE,written)
        # The native allocator entry points are independently verified ARM9
        # functions in these releases (same local ABI as the gauge's calls).
        alloc=0x0203a228 if game=='W2' else 0x0203a1fc
        c.hook_add(UC_HOOK_CODE,lambda *args:calls.append('allocation'),begin=alloc,end=alloc)
        hook=next(h for h in p['hooks'] if h['name']=='Status' and h['kind']=='OFFSET')
        entry=struct.unpack('<I',c.mem_read(hook['address'],4))[0]
        def invoke(s):
            c.reg_write(UC_ARM_REG_CPSR,0x1f);c.reg_write(UC_ARM_REG_SP,SP);c.reg_write(UC_ARM_REG_LR,STOP|1)
            for r,v in zip(REGS,[gauge,s,pos,0]):c.reg_write(r,v)
            c.emu_start(entry|1,STOP,count=2000000)
            assert c.reg_read(UC_ARM_REG_PC)==STOP
            assert not calls
        def display(name):
            for a,n in writes:
                v=int.from_bytes(c.mem_read(a,n),'little')
                {1:mem.write_byte,2:mem.write_short,4:mem.write_long}[n](a,v)
            emu.input.keypad_update(0);emu.run_frames(4);emu.screenshot().save(folder/f'{name}.png')
        emu.savestate.load_file(folder/'session.mln')
        invoke(status)
        hidden=bytes(c.mem_read(graphics,2048))
        assert hidden!=obj[graphics-0x06400000:graphics-0x06400000+2048]
        display(f'status-{status}')
        invoke(0)
        restored=bytes(c.mem_read(graphics,2048))
        assert restored==obj[graphics-0x06400000:graphics-0x06400000+2048]
        display(f'status-{status}-cleared')
        out.append(dict(status=status,actual_native_status_calls=True,icons_restored_byte_for_byte=True,allocation_calls=0))
    # Compare real native gauge updates with and without the installed wrapper,
    # starting from identical game state. This includes all heap metadata and
    # sprite/resource manager state, not just allocation-call instrumentation.
    original=cpu();patched=cpu()
    def call(c,entry,*args):
        c.reg_write(UC_ARM_REG_CPSR,0x1f);c.reg_write(UC_ARM_REG_SP,SP);c.reg_write(UC_ARM_REG_LR,STOP|1)
        for reg,value in zip(REGS,args):c.reg_write(reg,value)
        c.emu_start(entry|1,STOP,count=2000000)
        assert c.reg_read(UC_ARM_REG_PC)==STOP
        return c.reg_read(UC_ARM_REG_R0)
    mainHook=next(h for h in p['hooks'] if h['name']=='Main')
    lo,hi=struct.unpack('<HH',patched.mem_read(mainHook['address'],4))
    delta=((lo&2047)<<12)|((hi&2047)<<1)
    if delta&0x400000:delta-=0x800000
    wrapper=mainHook['address']+4+delta
    # Same controlled effective type input in both executions.
    battler=int(record['battler'],16)
    original.mem_write(battler+0xf8,bytes([9,2]));patched.mem_write(battler+0xf8,bytes([9,2]))
    call(original,p['functions']['Main'],gauge);call(patched,wrapper,gauge)
    pfd=call(patched,p['functions']['GetPfd'])
    source,transfer=struct.unpack('<II',patched.mem_read(pfd+40,8))
    state_address=int(live['state_address'],16)
    allowed=[(state_address,state_address+364)]
    for base in (source,transfer):
        for index in (4,15):
            a=base+record['bank']*32+index*2;allowed.append((a,a+2))
    a=bytearray(original.mem_read(0x02000000,0x400000));b=bytearray(patched.mem_read(0x02000000,0x400000))
    for lo,hi in allowed:a[lo-0x02000000:hi-0x02000000]=b[lo-0x02000000:hi-0x02000000]
    assert a==b,'A native gauge update changed game RAM beyond the HUD state and its palette colors'
    emu.savestate.load_file(folder/'session.mln')
    for lo,hi in allowed:
        for at in range(lo,hi,2):mem.write_short(at,int.from_bytes(patched.mem_read(at,2),'little'))
    mem.write_short(battler+0xf8,0x0209)
    for at in range(graphics,graphics+2048,2):mem.write_short(at,int.from_bytes(patched.mem_read(at,2),'little'))
    for index in (4,15):
        at=0x05000200+record['bank']*32+index*2;mem.write_short(at,int.from_bytes(patched.mem_read(at,2),'little'))
    emu.run_frames(4);emu.screenshot().save(folder/'dual-controlled.png')
    emu.destroy()
    result=dict(game=game,dll_sha256=live['dll_sha256'],starting_displayed_types=record['types'],native_status_checks=out,
        actual_native_gauge_update_comparison='Identical 4 MiB game RAM except 364-byte panel state and four palette-buffer entries; battlers, heap metadata and resource manager state unchanged.',
        limitation='Controlled native HUD requests, not gameplay status inflicted by a move.')
    (folder/('native-integration-'+os.environ.get('BTH_RECORD','0')+'.json')).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
if __name__=='__main__':main()
