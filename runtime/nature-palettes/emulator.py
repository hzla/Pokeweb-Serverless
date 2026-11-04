"""Render a caller-prepared doubles Litwick fixture in a local melonDS core.

ROM/save are copied before emulation. Diagnostics require an external directory.
"""
import argparse, json, shutil, sys, struct
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('rom',type=Path);p.add_argument('--out',type=Path,required=True)
p.add_argument('--core',type=Path,required=True);p.add_argument('--bindings',type=Path,required=True)
p.add_argument('--pmc-symbols',type=Path,help='Local PMC symbol-address JSON for heap sampling')
p.add_argument('--trace-palettes',action='store_true',help='Compare player source palettes each frame through battle effects')
p.add_argument('--field-summary-menu',action='store_true');p.add_argument('--open-field-summary',action='store_true');p.add_argument('--field-summary',action='store_true');p.add_argument('--resume',type=Path);p.add_argument('--summary',action='store_true');p.add_argument('--enter-summary',action='store_true')
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=False)
sys.path.insert(0,str(a.bindings.resolve()))
from melonds import MelonDS
rom=a.out/'test.nds';shutil.copyfile(a.rom,rom);shutil.copyfile(a.rom.with_suffix('.sav'),rom.with_suffix('.sav'))
emu=MelonDS(a.core);emu.open(rom)
commands=[];getters=set();pp=set();handles=[];lifecycle={'setup':0,'freed':False,'fieldFrame':None}
heap={'samples':0,'capacity':0,'minFree':None,'lastFree':None};symbols=json.loads(a.pmc_symbols.read_text())if a.pmc_symbols else {}
def sample_heap(*_):
    pointer=next((v for k,v in symbols.items()if 'g_MainAllocator' in k),0)
    if not pointer:return
    u=emu.memory.read_long;area=u(pointer)
    if not 0x02000000<=area<0x023fff00:return
    capacity=u(area+8);node=u(area+12);seen=set();free=0
    if not 4096<=capacity<=1024*1024:return
    while node:
        if node in seen or not 0x02000000<=node<0x023ffff8:return
        seen.add(node);free+=u(node);node=u(node+4)
    heap['samples']+=1;heap['capacity']=capacity;heap['lastFree']=free
    heap['minFree']=min(heap['minFree'],free)if heap['minFree']is not None else free
def getter(cpu,addr):
    if emu.memory.register_arm9.r1==0x70:
        address=emu.memory.register_arm9.r0
        if 0x02000000<=address<0x023ffff0:pp.add(address)
def command(cpu,addr):
    pointer=emu.memory.register_arm9.r1
    if 0x02000000<=pointer<0x02400000 and emu.memory.read_long(pointer)==0:
        commands.append(emu.frame_count);sample_heap();heap.setdefault('battleFree',heap['lastFree'])
def setup(cpu,addr):
    if emu.memory.register_arm9.r1==167:lifecycle['setup']=emu.memory.register_arm9.r3
def freed(cpu,addr):
    if lifecycle['setup'] and emu.memory.register_arm9.r0==lifecycle['setup']:lifecycle['freed']=True
def ready(cpu,addr):
    game=emu.memory.register_arm9.r0
    if lifecycle['freed'] and emu.memory.register_arm9.r1 in (0x0218189d,0x02181a69,0x02181cf1) and emu.memory.read_long(game+0x20) and not emu.memory.read_long(game+0x18):lifecycle['fieldFrame']=emu.frame_count
handles=[emu.memory.register_exec(0x02016e38,setup),emu.memory.register_exec(0x02017c84,freed),emu.memory.register_exec(0x02016dcc,ready),emu.memory.register_exec(0x0201cd24,getter),emu.memory.register_exec(0x021cef18,command)]
for name,address in symbols.items():
    if 'FreeStatic' in name or 'ReallocStatic' in name or 'FillAlloc' in name:handles.append(emu.memory.register_exec(address&~1,sample_heap))
def screenshot(name):
    sample_heap();heap[name+'Free']=heap['lastFree'];emu.screenshot().save(a.out/(name+'.png'))
def press(key,frames=2,wait=30):
    emu.input.keypad_update(key);emu.run_frames(frames);emu.input.keypad_update(0);emu.run_frames(wait)
def touch(x,y):
    emu.input.touch_set_pos(x,y);emu.run_frames(2);emu.input.touch_release();emu.run_frames(40)
try:
    if a.resume:
        emu.savestate.load_file(a.resume)
        emu.run_frames(10)
    else:
        for _ in range(12000):
            emu.cycle()
            if commands:break
        assert commands,'Battle command menu not reached'
        emu.run_frames(60)
    screenshot('battle')
    emu.savestate.save_file(a.out/'battle.state')
    u=emu.memory.read_long;bew=u(0x021f4280);bmw=u(bew+0x190) if 0x02000000<=bew<0x02400000 else 0
    palettes=[]
    if bmw:
        for i in range(14):
            m=u(bmw+8+i*0x5c)
            if 0x02000000<=m<0x02400000:
                base=u(m+0xd4)
                palettes.append({'slot':i,'view':u(bmw+0x50+i*0x5c),'member':u(bmw+0x14+i*0x5c),'colors':[emu.memory.read_short(base+j*2) for j in range(16)]})
    palette_trace={'frames':0,'mismatches':[]}
    def sample_palettes():
        if not a.trace_palettes or lifecycle['freed']:return
        palette_trace['frames']+=1
        for entry in palettes:
            if entry['view'] not in (2,4):continue
            actor=bmw+entry['slot']*0x5c;m=u(actor+8)
            if not 0x02000000<=m<0x023fff00 or u(actor+0x14)!=entry['member']:continue
            base=u(m+0xd4)
            if not 0x02000000<=base<0x023fffe0:continue
            actual=[emu.memory.read_short(base+j*2)for j in range(16)]
            if actual!=entry['colors'] and len(palette_trace['mismatches'])<10:palette_trace['mismatches'].append({'frame':emu.frame_count,'slot':entry['slot'],'colors':actual})
    if a.field_summary_menu:
        touch(205,84);emu.run_frames(180);screenshot('summary');emu.savestate.save_file(a.out/'summary.state')
        press(128,wait=90);screenshot('summary-next')
        press(64,wait=90);screenshot('summary-modest')
    if a.open_field_summary:
        touch(55,46);emu.run_frames(100);screenshot('party')
        press(1,wait=60);screenshot('party-options')
        press(1,wait=60);touch(205,84);emu.run_frames(180);screenshot('summary');emu.savestate.save_file(a.out/'summary.state')
        press(128,wait=90);screenshot('summary-next')
        press(64,wait=90);screenshot('summary-modest')
    if a.enter_summary:
        touch(45,171);emu.run_frames(180);screenshot('summary');emu.savestate.save_file(a.out/'summary.state')
        press(128,wait=90);screenshot('summary-next')
        press(64,wait=90);screenshot('summary-modest')
    if a.summary:
        touch(190,150);screenshot('party')
        press(1);screenshot('party-options')
        press(128);press(1);emu.run_frames(90);touch(45,171);emu.run_frames(120);screenshot('summary')
        emu.savestate.save_file(a.out/'summary.state')
    mons=[]
    if 0x02000000<=bew<0x02400000:
        scu=u(bew+0x1e0);con=u(scu+0x138)
        for i in range(24):
            mon=u(con+0x84+i*4)
            if not 0x02000000<=mon<0x023ff000:continue
            source=u(mon)
            if not 0x02000000<=source<0x023ff000:continue
            raw=bytearray(emu.memory.unsigned[source:source+220]);pid=struct.unpack_from('<I',raw)[0];checksum=struct.unpack_from('<H',raw,6)[0]
            plain=bytearray(raw);seed=checksum
            for off in range(8,136,2):
                seed=(seed*0x41c64e6d+0x6073)&0xffffffff
                v=struct.unpack_from('<H',plain,off)[0];struct.pack_into('<H',plain,off,v^(seed>>16))
            orders=('ABCD ABDC ACBD ACDB ADBC ADCB BACD BADC CABD DABC CADB DACB BCAD BDAC CBAD DBAC CDAB DCAB BCDA BDCA CBDA DBCA CDBA DCBA').split()
            blocks=bytes(plain[8:136]);perm=[ord(c)-65 for c in orders[((pid>>13)&31)%24]]
            plain[8:136]=b''.join(blocks[j*32:(j+1)*32]for j in perm)
            mons.append({'id':i,'mon':mon,'source':source,'species':struct.unpack_from('<H',plain,8)[0],'nature':plain[0x41],'pidModulo25':pid%25,'checksumValid':sum(struct.unpack_from('<64H',plain,8))&65535==checksum})
    if a.field_summary:
        for _ in range(20000):
            emu.input.keypad_update(1 if emu.frame_count%12<3 else 0);emu.cycle()
            sample_palettes()
            if lifecycle['fieldFrame']:break
        emu.input.keypad_update(0);emu.run_frames(60)
        assert lifecycle['fieldFrame'],'Battle did not return to field'
        screenshot('field');emu.savestate.save_file(a.out/'field.state')
        press(1024,wait=60);screenshot('field-menu');emu.savestate.save_file(a.out/'field-menu.state')
    result={'lifecycle':lifecycle,'mons':mons,'commandFrame':commands[0] if commands else None,'frame':emu.frame_count,'palettes':palettes,'paletteTrace':palette_trace if a.trace_palettes else None,'natureGetterSourceCount':len(pp),'summaryRequested':a.summary,'pmcHeap':heap if symbols else None}
    (a.out/'report.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))
finally:emu.close()
