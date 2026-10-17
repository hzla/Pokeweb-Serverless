"""Compiled dual-screen raster/lifetime checks, separate from gameplay evidence."""
from pathlib import Path
import sys,struct,json,os
HERE=Path(__file__).resolve().parent
os.environ['LEARNSET_INFO_LINK_PREFIX']='pokenav-style'
sys.path.insert(0,str(HERE.parent/'learnset-viewer'))
from verify_info import Harness,Font,WORK,PIXELS,png,decode_bank
from unicorn.arm_const import UC_ARM_REG_SP

def symbol(h,prefix):
    names=[n for n in h.symbols if n.startswith(prefix)]
    assert len(names)==1,(prefix,names)
    return names[0]

def capture(h,game,name):
    output=[]
    for screen in range(2):
        data=bytes(h.c.mem_read(0x6200000 if screen else 0x6000000,49152))
        palette=struct.unpack('<256H',h.c.mem_read(0x5000400 if screen else 0x5000000,512))
        for y in range(192):
            for x in range(256):
                color=palette[data[((y>>3)*32+(x>>3))*64+(y&7)*8+(x&7)]]
                output.extend([(color>>shift&31)*255//31 for shift in (0,5,10)])
    png(HERE/'build'/f'style-{game}-{name}.png',256,384,output)

for game in ('W2','B2'):
    h=Harness(game);h.styled=True;h.instruction_limit=60000000
    narc=__import__('ndspy.narc',fromlist=['NARC']).NARC
    h.messages[109]=decode_bank(narc(h.files['a/0/0/2']).files[109])
    h.c.mem_map(0x4000000,0x2000);h.c.mem_map(0x6000000,0x400000)
    callbacks=[];keys=[0];touch=[False,0,0]
    h.fonts={};small=Font(h.rom,1)
    def font_create():
        assert [h.r(i) for i in range(4)]==[23,1,0,0]
        handle=h.alloc(148)
        if handle:h.fonts[handle]=small
        h.ret(handle)
    def font_free():
        h.fonts.pop(h.r(0));h.free(h.r(0));h.ret()
    h.stub(0x2022d84,font_create);h.stub(0x2022dd4,font_free)
    fades=[]
    def original_fade():
        fades.append([h.r(i) for i in range(4)]+list(struct.unpack('<3I',h.c.mem_read(h.c.reg_read(UC_ARM_REG_SP),12))))
        h.ret()
    h.stub(0x20279e0,original_fade)
    h.stubs[0x20056fc]=lambda:(callbacks.append(h.r(0)),h.ret(0x2308000))
    h.stub(0x203a6d4,lambda:h.ret());h.stub(0x203e808,lambda:h.ret())
    h.stub(0x203df28,lambda:h.ret(keys[0]));h.stubs[0x2006254]=lambda:h.ret()
    def touch_read():h.w32(h.r(0),touch[1]);h.w32(h.r(1),touch[2]);h.ret(int(touch[0]))
    h.stub(0x203dab0,touch_read)
    launch,out=0x2307000,0x2307200
    data=bytearray(248);struct.pack_into('<IHHHH',data,0,0x56414e50,1,248,437,124);data[14]=1
    data[16:23]=bytes([10]*7);species=1
    for method in range(7):
        for slot in range(12 if method<3 else 5):
            at=16+(8+method*48 if method<3 else 152+(method-3)*20)+slot*4
            struct.pack_into('<HBB',data,at,species,5,9);species+=1
    assert species==57;h.c.mem_write(launch,bytes(data))
    assert h.call('_Z12pokenavBeginPvPP7Request',launch,out)
    # Initial buffers remain hidden until native initialization/fade finishes.
    before_palette=bytes(h.c.mem_read(0x5000000,0x800))
    h.call('_Z11pokenavInitPv',WORK)
    h.call('LearnsetOpeningFade',0,1,1,0,6,1,79);assert not fades
    assert callbacks and max(h.allocations.values())==157284
    h.call(callbacks[-1],0,0)
    assert h.u16(0x400000c)==h.u16(0x400100c)==0
    assert h.u16(0x400006c)==h.u16(0x400106c)==0x8010
    assert bytes(h.c.mem_read(0x5000000,0x800))==before_palette
    h.call('_Z12pokenavFramePv',WORK);h.call(callbacks[-1],0,0)
    assert h.u16(0x400000c)==h.u16(0x400100c)==0x1f82
    assert h.u16(0x400006c)==h.u16(0x400106c)==0
    for screen in (0,1):
        assert list(struct.unpack('<768H',h.c.mem_read((0x6200000 if screen else 0x6000000)+0xf800,1536)))==list(range(768))
    references=struct.unpack('<48H',h.c.mem_read(0x5000400+320,96))
    expected=struct.unpack_from('<48H',__import__('ndspy.narc',fromlist=['NARC']).NARC(h.files['a/0/0/7']).files[0],40)
    assert references==expected
    palette=struct.unpack('<256H',h.c.mem_read(0x5000000,512))
    assert palette[231]==0x7fff and palette[225]==(20|20<<5|21<<10)
    # Match actual compact-font pixels for labels, not a scaled large font.
    upper=bytes(h.c.mem_read(0x6000000,49152))
    for value,x,y in [('Base stats',11,33),('Family / Abilities',123,33),('HP',11,49),('Sp.A',11,91)]:
        for (gx,gy),ink in small.text(value)[1].items():
            px,py=x+gx,y+gy;at=((py>>3)*32+(px>>3))*64+(py&7)*8+(px&7)
            assert upper[at]==(227 if ink==1 else 226),(value,px,py,upper[at])
    icon_archive=narc(h.files['a/0/0/7']).files;banks=set();compared=0
    nav=symbol(h,'_ZN12_GLOBAL__N_110navigationE');address=h.symbols[nav]
    assert [h.c.mem_read(address+m*74+72,1)[0] for m in range(7)]==[12,12,12,5,5,5,5]
    raw=bytes(h.c.mem_read(0x6200000,49152))
    pixel=lambda x,y:raw[((y>>3)*32+(x>>3))*64+(y&7)*8+(x&7)]
    for section,entries in [(0,range(37,42)),(1,range(1,13))]:
        for i,species in enumerate(entries):
            member=h.call(0x2020fc1-h.delta,species,0,0,0);bank=h.call(0x2021061-h.delta,species,0,0,0);banks.add(bank)
            tiles=icon_archive[member][48:560];x=12+(i%6)*40 if section else 24+i*44;y=104+(35 if i>=6 else 0) if section else 40
            for iy in range(32):
                for ix in range(32):
                    at=((iy>>3)*4+(ix>>3))*32+(iy&7)*4+((ix&7)>>1);ink=(tiles[at]>>((ix&1)*4))&15
                    if ink:assert pixel(x+ix,y+iy)==160+bank*16+ink;compared+=bool(ink)
    assert banks=={0,1,2} and compared>2000
    assert pixel(12,103)==31 and pixel(13,97)==16,'Selector must stay below grass underline'
    assert any(pixel(x,y) in range(64,80) for y in range(178,192) for x in range(200,214))
    assert any(pixel(x,y) in range(64,80) for y in range(178,192) for x in range(232,246))
    capture(h,game,'full')
    for _ in range(8):h.call('_ZN7pokenav2ui4tickEv')
    h.call(callbacks[-1],0,0);moved=bytes(h.c.mem_read(0x6200000,49152))
    assert moved!=raw and moved[((103>>3)*32+(12>>3))*64+(103&7)*8+(12&7)]==31
    def same_as_full():
        h.call(callbacks[-1],0,0);incremental=bytes(h.c.mem_read(0x6200000,49152))
        h.call(symbol(h,'_ZN12_GLOBAL__N_14drawEPvPKN7pokenav5StateE'),WORK,0);h.call(callbacks[-1],0,0)
        assert bytes(h.c.mem_read(0x6200000,49152))==incremental,'Incremental selector/folder redraw differs from full rendering'
    # Touch targets cover icons, each flap, remembered selections and Back.
    for x,y in [(68,120),(108,120),(228,155),(52,28),(178,28),(65,90),(170,90)]:
        touch[:]=[False,0,0];h.call('_Z12pokenavInputPv',WORK)
        touch[:]=[True,x,y];h.call('_Z12pokenavInputPv',WORK);same_as_full()
    # Shoulders work on icon rows too, preserve selection/focus, and stop at
    # endpoints. A method's remembered column drives subsequent Up/Down.
    def tap(x,y):
        touch[:]=[False,0,0];h.call('_Z12pokenavInputPv',WORK)
        touch[:]=[True,x,y];h.call('_Z12pokenavInputPv',WORK)
        touch[:]=[False,0,0];h.call('_Z12pokenavInputPv',WORK)
    tap(25,90);tap(228,155)
    def shoulder(key,method):
        keys[0]=key;h.call('_Z12pokenavInputPv',WORK);keys[0]=0
        h.call('_Z12pokenavInputPv',WORK);same_as_full()
        assert h.c.mem_read(address+519,1)==bytes([method]) and h.c.mem_read(address+522,1)==b'\0'
    shoulder(0x100,1);shoulder(0x100,2);shoulder(0x100,2)
    shoulder(0x200,1);shoulder(0x200,0);shoulder(0x200,0)
    assert h.c.mem_read(address+73,1)==b'\x0b' and h.c.mem_read(address+521,1)==b'\x05'
    touch[:]=[False,0,0];h.call('_Z12pokenavInputPv',WORK)
    for x in (206,238):
        touch[:]=[True,x,184];assert h.call('_Z12pokenavInputPv',WORK)
        touch[:]=[False,0,0];h.call('_Z12pokenavInputPv',WORK)
    request=struct.unpack('<I',h.c.mem_read(out,4))[0]
    def badge(chance):
        h.call(callbacks[-1],0,0)
        data=bytes(h.c.mem_read(0x6000000,49152));width,glyph=h.font.text(str(chance)+'%');x=231-width//2
        for (gx,gy),ink in glyph.items():
            px,py=x+gx,7+gy;at=((py>>3)*32+(px>>3))*64+(py&7)*8+(px&7)
            assert data[at]==(231 if ink==1 else 225),('cached native glyph',chance,px,py,data[at])
    for chance in (1,100):
        h.c.mem_write(0x2307300,struct.pack('<HHBB',1,0,chance,1));h.draws=[]
        h.call(symbol(h,'_Z10infoReloadPvP7RequestPK'),WORK,request,0x2307300)
        badge(chance)
    keys[0]=2;assert h.call('_Z12pokenavInputPv',WORK);keys[0]=0
    h.call('_Z7infoEndv');h.call('_Z11pokenavStopv')
    assert list(h.allocations.values())==[157284],'Upload buffers must outlive native application cleanup'
    before=bytes(h.c.mem_read(0x6200000,49152));h.call(callbacks[-1],0,0)
    assert bytes(h.c.mem_read(0x6200000,49152))==before,'Canceled upload must not touch VRAM'
    h.call('_Z10pokenavEndv');assert not h.allocations
    h.call('LearnsetOpeningFade',0,1,1,0,6,1,79)
    assert fades.pop()==[0,1,1,0,6,1,79],'Ordinary native/party fade arguments must remain intact'
    h.call(f'THUMB_BRANCH_LINK_258_0x{0x2199c2e-(64 if game=="B2" else 0):x}',2,4,8,0x1234,10,12,79)
    assert fades.pop()==[2,4,8,0x1234,10,12,79],'Opening-fade veneer must preserve all seven native arguments'
    # A VBlank before either framebuffer exists must leave both BGs/palettes
    # untouched; stopping before presentation restores brightness as well.
    h.c.mem_write(0x400006c,b'\x04\x80');h.c.mem_write(0x400106c,b'\x06\x80')
    h.call(symbol(h,'_ZN7pokenav2ui6createEPK'),0)
    old_modes=bytes(h.c.mem_read(0x400000c,2))+bytes(h.c.mem_read(0x400100c,2))
    old_palette=bytes(h.c.mem_read(0x5000000,0x800))
    h.call('_ZN7pokenav2ui7presentEv')
    h.call(callbacks[-1],0,0)
    assert bytes(h.c.mem_read(0x400000c,2))+bytes(h.c.mem_read(0x400100c,2))==old_modes
    assert bytes(h.c.mem_read(0x5000000,0x800))==old_palette
    h.call('_ZN7pokenav2ui7destroyEv');assert not h.allocations
    assert h.u16(0x400006c)==0x8004 and h.u16(0x400106c)==0x8006
    # Modern requests gray physical dupe slots using all three native palettes.
    modern=bytearray(data)+bytes(8);struct.pack_into('<HH',modern,4,2,256);modern[15]=3
    modern[248:255]=bytes([255]*7);h.c.mem_write(launch,bytes(modern))
    assert h.call('_Z12pokenavBeginPvPP7Request',launch,out)
    h.call('_Z11pokenavInitPv',WORK);h.call('_Z12pokenavFramePv',WORK);h.call(callbacks[-1],0,0)
    raw=bytes(h.c.mem_read(0x6200000,49152));palette=struct.unpack('<256H',h.c.mem_read(0x5000400,512));banks=set()
    for section,entries in [(0,range(37,42)),(1,range(1,13))]:
        for i,species in enumerate(entries):
            member=h.call(0x2020fc1-h.delta,species,0,0,0);bank=h.call(0x2021061-h.delta,species,0,0,0);banks.add(bank)
            tiles=icon_archive[member][48:560];x=12+(i%6)*40 if section else 24+i*44;y=104+(35 if i>=6 else 0) if section else 40
            for iy in range(32):
                for ix in range(32):
                    at=((iy>>3)*4+(ix>>3))*32+(iy&7)*4+((ix&7)>>1);ink=(tiles[at]>>((ix&1)*4))&15
                    if ink:
                        index=pixel(x+ix,y+iy);assert index==80+bank*16+ink
                        color=palette[index];assert color&31==color>>5&31==color>>10&31
    assert banks=={0,1,2}
    for method in range(7):
        for i in range(12 if method<3 else 5):
            assert bytes(h.c.mem_read(address+method*74+i*6+4,2))==b'\0\1'
    capture(h,game,'dupes')
    h.call('_Z7infoEndv');h.call('_Z11pokenavStopv');h.call('_Z10pokenavEndv');assert not h.allocations
    h.fail_alloc_sizes.update({148,164,61440});h.c.mem_write(launch,bytes(data))
    assert h.call('_Z12pokenavBeginPvPP7Request',launch,out)
    h.call('_Z11pokenavInitPv',WORK);assert h.call('_ZN7pokenav2ui9availableEv')
    h.call('_Z7infoEndv');h.call('_Z11pokenavStopv');h.call('_Z10pokenavEndv');assert not h.allocations
    h.fail_alloc_sizes.clear();h.fail_alloc_sizes.add(157284);h.draws=[];h.c.mem_write(launch,bytes(data))
    assert h.call('_Z12pokenavBeginPvPP7Request',launch,out)
    h.call('_Z11pokenavInitPv',WORK)
    assert not h.call('_ZN7pokenav2ui9availableEv') and any(t=='Pokenav unavailable' for x,y,t in h.draws)
    h.call('LearnsetOpeningFade',0,1,1,0,6,1,79)
    assert fades.pop()==[0,1,1,0,6,1,79],'Allocation-failure UI must retain the native opening fade'
    keys[0]=2;assert h.call('_Z12pokenavInputPv',WORK)
    h.call('_Z7infoEndv');h.call('_Z11pokenavStopv');h.call('_Z10pokenavEndv');assert not h.allocations
    print(game,'compiled dual-screen layout, native palettes/footer, scrolling mask, selector clearance, flaps and retained-buffer cleanup passed',flush=True)

print('These reconstructed images and CPU checks are not emulator gameplay evidence.')
