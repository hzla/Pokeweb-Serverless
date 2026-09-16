"""Execute the release ARM binaries against native graphics and ABI fixtures.

Uses real ROM GetImgProxy and Illusion view selection. Other engine services are
instrumented stand-ins; this is not a substitute for the live gameplay matrix.
"""
from pathlib import Path
import hashlib, json, os, struct, sys
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_ARM,UC_HOOK_CODE,UC_HOOK_MEM_WRITE
from unicorn.arm_const import *
from analyze import HERE, ROOT, load
from rpm_read import read_rpm,thumb_bl
from panel_expansion import transform

REGS=[UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3]
SAVED=[UC_ARM_REG_R4,UC_ARM_REG_R5,UC_ARM_REG_R6,UC_ARM_REG_R7,UC_ARM_REG_R8,UC_ARM_REG_R9,UC_ARM_REG_R10,UC_ARM_REG_R11]
SP=0x02fe3000;STOP=0x02fd0000;BASE=0x02380020
G=0x02270000;PFD=0x02278000;PAL=0x02279000;TRANS=0x02279200
# Native IDs encode client/party membership, independently of HUD positions.
BATTLE_IDS=(0,12,0,12,6,18,1,13)
ASSETS=json.loads((HERE/'assets.json').read_text())
EXPANSION=json.loads((HERE/'panel-expansion.json').read_text())
CAUGHT_BALL=bytes.fromhex('00220200207128008277870212111102e211e102201e2e000022020000000000')
def pixel(data,x,y):
    return (data[((y//8)*8+x//8)*32+(y%8)*4+(x%8)//2]>>((x&1)*4))&15
def setpixel(data,x,y,c):
    p=((y//8)*8+x//8)*32+(y%8)*4+(x%8)//2;s=(x&1)*4
    data[p]=(data[p]&~(15<<s))|(c<<s)
def caught_ball(data,moved):
    left,top=8,8
    for y in range(8):
        for x in range(8):
            c=CAUGHT_BALL[y*4+x//2]>>(4*(x&1))&15
            if c:setpixel(data,left+x,top+y,c)
def name_origin(data):
    for x in range(8,24):
        if any(pixel(data,x,y) for y in range(5,16)):return min(x,18)-7
    return 9
def header_pixel(data,x,y):return pixel(data,x&63,y+(32 if x>=64 else 0))
def set_header(data,x,y,c):setpixel(data,x&63,y+(32 if x>=64 else 0),c)
def enemy_header(data,p):
    # Independent logical canvas: move only nontransparent name/info pixels.
    pts={(x,y):header_pixel(data,x,y) for y in range(16) for x in range(128) if header_pixel(data,x,y)}
    name={q:c for q,c in pts.items() if 16<=q[0]<80};info={q:c for q,c in pts.items() if q[0]>=80}
    first=min((x for x,y in name),default=24);last=max((x for x,y in name),default=24)
    anchor={1:60,3:64,5:60,7:56}[p]
    ns=max(0,23-(anchor-64+first))
    rs=max(0,last+ns+2-min((x for x,y in info),default=128))
    assert all(x+rs<128 for x,y in info)
    moved={(x+ns,y):c for (x,y),c in name.items()}
    assert not set(moved)&{(x+rs,y) for x,y in info}
    moved.update({(x+rs,y):c for (x,y),c in info.items()})
    for y in range(16):
        for x in range(16,128):set_header(data,x,y,moved.get((x,y),0))
    return first+ns-22

def player_header(data):
    origin=name_origin(data)
    name={(x,y):header_pixel(data,x,y) for y in range(16) for x in range(8,72) if header_pixel(data,x,y)}
    info={(x,y):header_pixel(data,x,y) for y in range(16) for x in range(72,128) if header_pixel(data,x,y)}
    moved={(x+12,y):c for (x,y),c in name.items()}
    assert not set(moved)&{(x+8,y) for x,y in info}
    assert all(x+8<120 for x,y in info)
    moved.update({(x+8,y):c for (x,y),c in info.items()})
    for y in range(16):
        for x in range(8,128):set_header(data,x,y,moved.get((x,y),0))
    return origin

def paint_expected(data,pair,p,t,origin=None):
    del origin
    a,b=pair
    anchor={1:60,3:64,5:60,7:56}.get(p)
    base=65-anchor if anchor is not None else 0
    solid=ASSETS.get('variant')=='solid'
    if solid:
        compact=bool(p&1) or t>=2
        outline=ASSETS['compactOutline'] if compact else ASSETS['outline']
        primary=ASSETS['compactPrimary'] if compact else ASSETS['primary']
        secondary=ASSETS['compactSecondary'] if compact else ASSETS['secondary']
        primary_shade=ASSETS['compactPrimaryShade'] if compact else ASSETS['primaryShade']
        secondary_shade=ASSETS['compactSecondaryShade'] if compact else ASSETS['secondaryShade']
        monofill=ASSETS['compactMonoFill'] if compact else ASSETS['monoFill']
        monoshade=ASSETS['compactMonoShade'] if compact else ASSETS['monoShade']
        left=(12 if t>=2 else 11) if p&1 else (9 if t>=2 else 7)
        for y in range(len(outline)):
            for x in range(12):
                mask=2048>>x
                if not outline[y]&mask:continue
                if a==b and monofill[y]&mask:color=4
                elif a==b and monoshade[y]&mask:color=15
                elif primary[y]&mask:color=4
                elif secondary[y]&mask:color=15
                elif primary_shade[y]&mask:color=4 if (x+y)&1 else 2
                elif secondary_shade[y]&mask:color=15 if (x+y)&1 else 2
                else:color=2
                setpixel(data,left+x,18+y,color)
        return
    positions=[(base+2,17,a)] if a==b else [(base,15,a),(base+5,21,b)]
    for kind,(left,top,typ) in enumerate(positions):
        for y in range(ASSETS['iconHeight']):
            for x in range(12):
                mask=2048>>x
                if not ASSETS['outline'][y]&mask:continue
                inside=ASSETS['fill'][y]&mask
                white=inside and ASSETS['symbols'][typ][y]&mask
                color=1 if white else (4 if kind==0 else 15) if inside else 2
                setpixel(data,left+x,top+y,color)
def normalized(data): return bytes((2 if v&15 in (4,15) else v&15)|((2 if v>>4 in (4,15) else v>>4)<<4) for v in data)
def blend(c,t,e):
    return sum((((c>>s)&31)+(((((t>>s)&31)-((c>>s)&31))*e)>>4))<<s for s in (0,5,10))

class Harness:
    def __init__(self,game,module="TypeIcons"):
        self.game=game;self.profile=json.loads((HERE/f'profile-{game}.json').read_text())
        self.c=Uc(UC_ARCH_ARM,UC_MODE_ARM);self.c.ctl_set_cpu_model(UC_CPU_ARM_946)
        for start,size in [(0x02000000,0x1000000),(0x04000000,0x10000),(0x05000000,0x1000),(0x06400000,0x10000)]:self.c.mem_map(start,size)
        _,blobs=load(game)
        for base,data in blobs.values():self.c.mem_write(base,bytes(data))
        rpm=read_rpm((HERE/'build'/f'{module}{game}.dll').read_bytes())
        debug=read_rpm((HERE/'build'/f'{module}{game}.debug.dll').read_bytes())
        assert rpm['code']==debug['code'] and rpm['bss']==debug['bss']==(364 if module.startswith('TypeIcons') else 20)
        self.c.mem_write(BASE,rpm['code']+b'\0'*rpm['bss'])
        self.entries={}
        for r in rpm['relocations']:
            s=rpm['symbols'][r['symbol']];dest=s['address']+(0 if s['attributes']&4 else BASE)
            if s['type']==3:dest|=1
            if r['module']=='base':
                assert r['type']=='OFFSET';self.put(BASE+r['address'],dest)
            else:
                assert r['module']=='168'
                hook=next(h for h in self.profile['hooks'] if h['address']==r['address'])
                self.entries.setdefault(hook['name'],[]).append((r['type'],r['address'],dest))
                if r['type']=='OFFSET':self.put(r['address'],dest)
                else:self.c.mem_write(r['address'],thumb_bl(r['address'],dest))
        self.state=BASE+next(s['address'] for s in debug['symbols'] if s['name']==('gBattleTypeHud' if module.startswith('TypeIcons') else 'gBattleMoveHud'))
        self.events=[];self.fakeReads=0;self.liveTypes={};self.fakeTypes={};self.writes=[];self.caught=set()
        self.addReset=True;self.nativeHooks={}
        for name in ['Add','AddPP','Main','Del','Release','Status','GetPfd','PalAddr','PPGet','EffectiveTypes','NameDraw','SexDraw','LevelDraw']:
            address=self.profile['functions'][name]
            self.nativeHooks[name]=self.c.hook_add(UC_HOOK_CODE,self.stub,name,begin=address,end=address)
        self.c.hook_add(UC_HOOK_MEM_WRITE,self.videoWrite,begin=0x06400000,end=0x0640ffff)
        self.c.hook_add(UC_HOOK_MEM_WRITE,self.paletteWrite,begin=0x05000000,end=0x05000fff)
        self.put(0x04000000,0x00111f18);self.c.mem_write(0x04000244,b'\x82')
        self.put(PFD+40,PAL);self.put(PFD+44,TRANS);self.put(PFD+48,512)
        pal=(HERE/'build'/f'{game}-resource-430.bin').read_bytes()[40:72]*16
        self.c.mem_write(PAL,pal);self.c.mem_write(TRANS,pal);self.c.mem_write(0x05000200,pal)
        self.raw={(t,side):(HERE/'build'/f'{game}-resource-{(441 if t==2 else 435)+(0 if side else 3)}.bin').read_bytes()[48:] for t in (0,2) for side in (0,1)}
        self.raw[(0,0)]=transform((HERE/'build'/f'{game}-resource-438.bin').read_bytes(),EXPANSION['438'])[48:]
        self.hpRaw=(HERE/'build'/f'{game}-resource-456.bin').read_bytes()[48:]
        assert len(self.hpRaw)==256
        self.hpExpected=self.hpRaw[:96]+normalized(self.hpRaw[96:128])+self.hpRaw[128:]
        for p in range(8):
            panel=G+0x40+p*0x84;cell=0x02271000+p*0x100;mon=0x02273000+p*0x300
            self.put(panel,cell);self.put(panel+24,p+100);self.put(panel+112,8)
            cellData=0x0227c000+p*0x40
            self.put(cell+0xa4,cellData);self.put(cellData,3|(21<<16));self.put(cellData+4,cellData+8)
            self.c.mem_write(cellData+8,bytes.fromhex('f040c0c10000f04000c01000f440bc812000'))
            self.put(cell+0x20,p*0x1000)
            hpCell=0x02271800+p*0x100
            self.put(panel+4,hpCell);self.put(hpCell+0x20,0x8000+p*0x100)
            self.c.mem_write(0x06408000+p*0x100,self.hpRaw)
            self.c.mem_write(mon+0x19,bytes([BATTLE_IDS[p]]));self.put(mon,0x0227b000+p*0x200)
            self.put(G+0x18+(p if p<2 else p-2)*4,(p if p<2 else p-2))
            self.liveTypes[mon]=(9,9)
    def put(self,a,v):self.c.mem_write(a,struct.pack('<I',v))
    def get(self,a):return struct.unpack('<I',self.c.mem_read(a,4))[0]
    def videoWrite(self,c,access,address,size,value,user):
        assert size in (2,4) and address%size==0,'VRAM byte/unaligned write'
        assert (any(0x06400000+p*0x1000<=address<0x06400000+p*0x1000+2304 for p in range(8)) or
                any(0x06408060+p*0x100<=address and address+size<=0x06408080+p*0x100 for p in range(9))), 'foreign graphics/digit write'
        self.writes.append((address,size))
    def paletteWrite(self,c,access,address,size,value,user):
        assert size==2 and address in [0x05000200+b*32+i*2 for b in range(6) for i in (4,15)]+[0x05000400+i*2 for i in (219,220,221)],'unrelated palette write'
    def stub(self,c,pc,size,name):
        args=[c.reg_read(r) for r in REGS];result=0
        if name in ('Add','AddPP'):
            args.append(self.get(c.reg_read(UC_ARM_REG_SP)));g,m,b,t,p=args
            if self.addReset and p<8:
                self.c.mem_write(0x06400000+p*0x1000,self.raw[(2 if t==2 else 0,p&1)])
                self.c.mem_write(0x06408000+p*0x100,self.hpRaw)
                if p in self.caught:
                    ball=bytearray(self.raw[(2 if t==2 else 0,p&1)]);caught_ball(ball,False)
                    self.c.mem_write(0x06400000+p*0x1000,bytes(ball))
            if p<8:self.put(G+0x40+p*0x84+112,8)
            if p<8:self.put(G+0x40+p*0x84+64,t)
        elif name=='GetPfd':result=PFD
        elif name=='PalAddr':result=args[0]*32
        elif name=='EffectiveTypes':
            a,b=self.liveTypes[args[0]];result=(a<<8)|b
        elif name=='PPGet':
            self.fakeReads+=1;result=self.fakeTypes[args[0]][args[1]-174]
        elif name=='Del':self.put(G+0x40+args[1]*0x84+112,0)
        if name in ('Add','AddPP','Main','Del','Release','Status','NameDraw','SexDraw','LevelDraw'):self.events.append((name,args))
        for r in REGS+[UC_ARM_REG_R12]:c.reg_write(r,0xdeadbeef)
        c.reg_write(UC_ARM_REG_R0,result);c.reg_write(UC_ARM_REG_PC,c.reg_read(UC_ARM_REG_LR))
    def invoke(self,name,*args,index=0):
        kind,site,dest=self.entries[name][index]
        address=dest if kind=='OFFSET' else site
        stop=STOP if kind=='OFFSET' else site+4
        c=self.c;c.reg_write(UC_ARM_REG_CPSR,0x1f);c.reg_write(UC_ARM_REG_SP,SP);c.reg_write(UC_ARM_REG_LR,STOP|1)
        for reg,arg in zip(REGS,args):c.reg_write(reg,arg)
        for i,arg in enumerate(args[4:]):self.put(SP+4*i,arg)
        preserved=[0x12340000+i for i in range(8)]
        for reg,val in zip(SAVED,preserved):c.reg_write(reg,val)
        c.emu_start(address|1,stop,count=2000000)
        assert c.reg_read(UC_ARM_REG_PC)==stop,hex(c.reg_read(UC_ARM_REG_PC))
        assert c.reg_read(UC_ARM_REG_SP)==SP
        assert [c.reg_read(r) for r in SAVED]==preserved
    def add(self,p,pair=(9,9),layout=0,index=0,caught=False):
        if caught:self.caught.add(p)
        else:self.caught.discard(p)
        mon=0x02273000+p*0x300;self.liveTypes[mon]=pair
        if p&1:
            cellData=0x0227c000+p*0x40
            self.put(cellData,(3|(21<<16)) if layout>=2 else (2|(17<<16)))
            self.c.mem_write(cellData+8,bytes.fromhex('f040c0c10000f04000c01000f08040802000'))
        self.invoke('Add',G,0x0227a000,mon,layout,p,index=index)
        assert self.events[-1]==('Add',[G,0x0227a000,mon,layout,p])
        return mon
    def image(self,p,t=0):return bytes(self.c.mem_read(0x06400000+p*0x1000,len(self.raw[(2 if t==2 else 0,p&1)])))
    def hpImage(self,p):
        cell=self.get(G+0x40+p*0x84+4)
        return bytes(self.c.mem_read(0x06400000+self.get(cell+0x20),256))
    def check(self,p,pair,t=0,status=False):
        expected=bytearray(normalized(self.raw[(2 if t==2 else 0,p&1)]));a,b=pair
        origin=None
        if p&1:enemy_header(expected,p)
        elif t==0:origin=player_header(expected)
        if not status:paint_expected(expected,pair,p,t,origin)
        if p&1 and p in self.caught:caught_ball(expected,False)
        assert self.image(p,t)==expected,(self.game,p,pair,t,status,self.c.mem_read(self.state+360,1)[0])
        assert self.c.mem_read(self.state+360,1)[0]==0,('runtime compatibility failure',self.c.mem_read(self.state+360,1)[0])
    def setfade(self,bank,target,evy):
        # Native parameter has already advanced to the next frame.
        self.c.mem_write(PFD+52,struct.pack('<HHHH',1<<bank,min(evy+2,16)<<6,target,2))
        for i in range(16):
            c=struct.unpack('<H',self.c.mem_read(PAL+bank*32+i*2,2))[0]
            v=blend(c,target,evy)
            self.c.mem_write(TRANS+bank*32+i*2,struct.pack('<H',v))

def test(game):
    h=Harness(game);checks=[]
    approved={v['name']:v for v in json.loads((HERE/'approved-icons.json').read_text())['icons']}
    assert ASSETS['names']=='Normal Fighting Flying Poison Ground Rock Bug Ghost Steel Fire Water Grass Electric Psychic Ice Dragon Dark Fairy'.split()
    assert ASSETS['fill']==[0,96,504,1020,2046,2046,2046,1020,504,96,0]
    assert ASSETS['outline']==[96,504,1020,2046,4095,4095,4095,2046,1020,504,96]
    assert ASSETS['iconWidth']==12 and ASSETS['iconHeight']==11 and ASSETS['stackDx']==5 and ASSETS['stackDy']==6 and ASSETS['stackTop']==15
    assert sum(bool(row&(2048>>x)) for row in ASSETS['outline'] for x in range(12))==88
    assert all(ASSETS['outline'][y]&(2048>>x) for x,y in ((3,1),(8,1),(3,9),(8,9)))
    assert all(not symbol[y]&~ASSETS['fill'][y] for symbol in ASSETS['symbols'] for y in range(11))
    assert sum(bool(row&(2048>>x)) and y!=6 and not (y in (1,9) and x in (3,8))
               for y,row in enumerate(ASSETS['outline']) for x in range(12))==72
    # Water uses the exact five-wide W from the approved circular reference.
    assert ASSETS['symbols'][10][3:8]==[272,272,336,336,160]
    assert all(not symbol[0] and not symbol[1] and not symbol[2] for symbol in ASSETS['symbols'])
    assert all(not symbol[7]&(2048>>x) or ASSETS['fill'][8]&(2048>>x)
               for symbol in ASSETS['symbols'] for x in range(12))
    for name,rows,color in zip(ASSETS['names'],ASSETS['symbols'],ASSETS['rgb555']):
        icon=approved[name]
        assert any(rows)
        rgb=bytes.fromhex(next(c[1:] for c in icon['colors'] if c!='#FFFFFF'))
        assert color==sum((c>>3)<<(5*i) for i,c in enumerate(rgb))
    checks.append('all 18 compact first initials, exact five-pixel Water W, source RGB colors and 12x11 point-up rhombus masks match')
    # Regression: packing IDs into three bits silently dropped the user's
    # enemy ID 12 as soon as creation tried to validate its binding.
    for battler_id in range(24):
        h.c.mem_write(0x02273319,bytes([battler_id]))
        h.add(1,(12,12));h.check(1,(12,12))
        assert h.c.mem_read(h.state+60+58,1)[0]==battler_id
        h.writes.clear();h.invoke('Main',G);h.check(1,(12,12));assert not h.writes
        h.invoke('Del',G,1)
    h.c.mem_write(0x02273319,bytes([BATTLE_IDS[1]]))
    checks.append('all 24 client/party battler IDs survive creation and unchanged updates independently of panel position, including captured enemy ID 12')
    # Both NCGR layouts and every ID, including Fairy=17, mono and dual.
    for t,p in ((0,0),(0,1),(1,2),(1,3),(2,2),(2,3)):
        for a in range(18):
            for pair in ((a,a),(a,(a+1)%18)):
                h.add(p,pair,t);h.check(p,pair,t)
        h.invoke('Del',G,p)
    checks.append('all 18 lowered initials have a full colored row beneath them inside fully outlined 12x11 rhombuses; dual types use a 5px-right/6px-down 17x17 stack and monotypes retain their raised position')
    # The native caught marker remains in its original header slot while the
    # type stack occupies the left edge of the lower panel.
    native_parts=(HERE/'build'/f'{game}-resource-434.bin').read_bytes()[48:]
    assert native_parts[0x1b*32:0x1c*32]==CAUGHT_BALL
    for p,t in ((1,0),(3,1),(5,2)):
        caught_h=Harness(game);caught_h.add(p,(9,2),t,caught=True);caught_h.check(p,(9,2),t)
        image=bytearray(normalized(caught_h.raw[(2 if t==2 else 0,1)]));caught_ball(image,False)
        for status in range(1,7):
            caught_h.invoke('Status',G,status,p);caught_h.check(p,(9,2),t,status=True)
            caught_h.invoke('Status',G,0,p);caught_h.check(p,(9,2),t)
        # Reproduce a native image reload with the marker back in tile 9.
        caught_h.c.mem_write(0x06400000+p*0x1000,bytes(image));caught_h.invoke('Main',G);caught_h.check(p,(9,2),t)
        caught_h.invoke('Del',G,p);assert caught_h.image(p,t)==bytes(image)
    checks.append('native 8x8 caught Poké Ball remains in its header slot; type icons, all statuses, reload and removal preserve it in every enemy layout')
    # The number sprite shares the panel palette but has a separate image proxy.
    # Palette index 4 is its slash shadow; white/gray strokes are indices 1/14.
    slash=[v>>s&15 for v in h.hpRaw[96:128] for s in (0,4)]
    assert set(slash)=={0,1,4,14} and slash.count(4)>0
    for p in (0,2):assert h.hpImage(p)==h.hpExpected
    for p in (1,3):assert h.hpImage(p)==h.hpRaw
    checks.append('native HP slash shadows remap 4 to 2; white/gray strokes, transparency and every digit byte are preserved')
    for p,pair in [(2,(12,12)),(3,(9,2)),(4,(7,14)),(5,(10,11)),(6,(0,8)),(7,(17,17))]:h.add(p,pair,2);h.check(p,pair,2)
    before=int.from_bytes(h.c.mem_read(h.state+362,2),"little");h.writes.clear()
    for _ in range(8):h.invoke('Main',G)
    assert not h.writes and int.from_bytes(h.c.mem_read(h.state+362,2),"little")==before
    checks.append('six simultaneous player/enemy panels; unchanged frames perform no video writes or redraws')
    for p,pair in [(2,(12,12)),(3,(9,2)),(4,(7,14)),(5,(10,11)),(6,(0,8)),(7,(17,17))]:
        for s in range(1,7):
            h.invoke('Status',G,s,p);h.check(p,pair,2,status=True)
            assert h.hpImage(p)==(h.hpRaw if p&1 else h.hpExpected)
            h.writes.clear();h.invoke('Main',G);assert not h.writes
            h.invoke('Status',G,0,p);h.check(p,pair,2)
    checks.append('all six native status IDs hide/restore the whole icon area on all six panels')
    h.invoke('Release',G)
    for p,pair in [(2,(12,12)),(3,(9,2)),(4,(7,14)),(5,(10,11)),(6,(0,8)),(7,(17,17))]:h.check(p,pair,2,status=True)
    assert all(h.get(h.state+i*60)==0 for i in range(6))
    checks.append('removal and resource teardown clear bindings before the native release call')
    mon=h.add(1,(9,2));fake=0x0227e000;h.fakeTypes[fake]=(10,10)
    h.put(mon+4,fake);h.c.mem_write(mon+0x1b,b'\x40');h.invoke('Main',G);h.check(1,(10,10))
    assert h.fakeReads==2
    h.invoke('Main',G);h.invoke('Main',G);assert h.fakeReads==2
    h.c.mem_write(mon+0x1b,b'\x00');h.invoke('Main',G);h.check(1,(9,2))
    checks.append('real native Illusion selector, cached disguise reads, and break to effective types')
    for pair in ((10,10),(11,3),(0,0),(7,16),(14,15)):
        h.liveTypes[mon]=pair;h.invoke('Main',G);h.check(1,pair)
    checks.append('live type-pair changes without gauge recreation (engine service simulated)')
    for evy in (0,1,4,8,15,16):
        for target in (0,0x7fff,16):
            h.setfade(1,target,evy);h.liveTypes[mon]=(9,10);h.invoke('Main',G)
            for idx,typ in ((4,9),(15,10)):
                assert struct.unpack('<H',h.c.mem_read(TRANS+32+idx*2,2))[0]==blend(ASSETS['rgb555'][typ],target,evy)
            h.liveTypes[mon]=(11,11);h.invoke('Main',G)
    checks.append('current fade state, including one-frame-ahead native EVY, black/white/colored targets')
    h.setfade(1,0,0)
    # Rebinding restores the previous occupant before native initialization.
    for i in range(12):h.add(1,(i%18,(i+1)%18));h.check(1,(i%18,(i+1)%18))
    h.invoke('Del',G,1)
    checks.append('repeated switching/replacement and duplicate-type collapse')
    mon=h.add(1,(9,2));cell=h.get(G+0x40+0x84)
    h.c.mem_write(0x06407000,h.raw[(0,1)]);h.put(cell+0x20,0x7000)
    h.invoke('Main',G)
    expected=bytearray(normalized(h.raw[(0,1)]));enemy_header(expected,1);paint_expected(expected,(9,2),1,0)
    assert h.image(7)==expected
    h.invoke('Release',G)
    original=(HERE/'build'/f'{game}-resource-430.bin').read_bytes()[40:72]
    for i in (4,15):assert bytes(h.c.mem_read(PAL+32+i*2,2))==original[i*2:i*2+2]
    h.put(cell+0x20,0x1000)
    checks.append('image-proxy relocation retains the correct original palette for teardown')
    for p in (0,2,4,6):
        h.writes.clear();h.add(p);h.check(p,(9,9));h.invoke("Del",G,p)
    h.writes.clear();h.add(1,(9,2),3);assert not h.writes
    checks.append('player/partner panels draw correctly; rotation icon panels remain outside this version')
    mon=h.add(1,(9,2))
    h.c.mem_write(0x06401000,h.raw[(0,1)]);h.invoke('Main',G);h.check(1,(9,2))
    h.c.mem_write(mon+0x19,b'\x03');h.invoke('Main',G)
    assert h.get(h.state+60)==0
    h.c.mem_write(mon+0x19,bytes([BATTLE_IDS[1]]))
    checks.append('native graphics reload repaints current icons; changed battler identity clears the stale binding')
    h.add(0,(13,13))
    count=int.from_bytes(h.c.mem_read(h.state+362,2),'little');main=h.image(0)
    # Native HP updates write current/max digit tiles without rewriting tile 3.
    hp=bytearray(h.hpExpected)
    for tile in (0,1,2,4,5,6):hp[tile*32:(tile+1)*32]=bytes([0x14+tile])*32
    h.c.mem_write(0x06408000,bytes(hp));h.writes.clear();h.invoke('Main',G)
    assert h.hpImage(0)==hp and not h.writes and h.image(0)==main
    # A number-only resource reload must be repaired even with an unchanged main hash.
    h.c.mem_write(0x06408000,h.hpRaw);h.writes.clear();h.invoke('Main',G)
    assert h.hpImage(0)==h.hpExpected and h.writes
    assert all(0x06408060<=a<0x06408080 for a,_ in h.writes)
    assert h.image(0)==main and int.from_bytes(h.c.mem_read(h.state+362,2),'little')==count
    h.c.mem_write(0x06408800,h.hpRaw);h.put(h.get(G+0x44)+0x20,0x8800)
    h.writes.clear();h.invoke('Main',G)
    assert h.hpImage(0)==h.hpExpected and all(0x06408860<=a<0x06408880 for a,_ in h.writes)
    h.invoke('Del',G,0)
    checks.append('HP digit updates untouched; number-only graphics reloads and proxy relocation repair only the slash without icon redraws')
    # Run the actual game's effective-type helper, including its Roost logic.
    h.c.hook_del(h.nativeHooks['EffectiveTypes'])
    mon=0x02273000+0x300
    h.c.mem_write(mon+0xf8,bytes([9,2]));h.add(1,(9,2));h.check(1,(9,2))
    h.put(mon+0x1c+24*4,1);h.invoke('Main',G);h.check(1,(9,9))
    h.c.mem_write(mon+0xf8,bytes([2,2]));h.invoke('Main',G);h.check(1,(0,0))
    h.put(mon+0x1c+24*4,0);h.invoke('Main',G);h.check(1,(2,2))
    for pair in ((10,10),(11,3),(15,14)):
        h.c.mem_write(mon+0xf8,bytes(pair));h.invoke('Main',G);h.check(1,pair)
    h.invoke('Del',G,1)
    checks.append('actual retail effective-type helper: Roost removes Flying, pure Flying becomes Normal, clearing restores Flying')
    cascade_path=Path(os.environ.get('BTH_CASCADE_ROM',str(Path.home()/'Downloads/cascadescan-bumpers.nds')))
    if game=='W2' and cascade_path.exists():
        # The user's Cascade ROM already expands the null type sentinel to 18.
        # Execute that real engine too; the HUD does not change type mechanics.
        import ndspy.rom
        cascade=ndspy.rom.NintendoDSRom.fromFile(cascade_path)
        ov=cascade.loadArm9Overlays([167])[167]
        h.c.mem_write(ov.ramAddress,bytes(ov.data))
        h.c.ctl_remove_cache(ov.ramAddress,ov.ramAddress+len(ov.data))
        for pair in ((17,17),(17,2),(9,17)):
            h.c.mem_write(mon+0xf8,bytes(pair));h.add(1,pair);h.check(1,pair)
        h.c.mem_write(mon+0xf8,bytes([17,2]));h.put(mon+0x1c+24*4,1)
        h.invoke('Main',G);h.check(1,(17,17));h.invoke('Del',G,1)
        checks.append('actual Cascade Fairy-expanded effective-type helper, including Fairy/Flying with Roost')
    # Exercise every generated call-site wrapper, including 5th stack argument.
    for name,entries in h.entries.items():
        if name.startswith("Move"): continue # separately exercised in verify_moves.py
        for idx in range(len(entries)):
            args={'Add':(G,0x227a000,0x2273000,3,0),'AddPP':(G,0x227a000,0x2273000,0,0),
                  'Main':(G,),'Status':(G,0,0),'Del':(G,0),'Release':(G,),
                  'NameDraw':(G,G+0x40,0x2273000),'SexDraw':(G,G+0x40),'LevelDraw':(G,G+0x40)}[name]
            h.invoke(name,*args,index=idx)
            assert h.events[-1][0]==name
            if name in ('Add','AddPP'):assert h.events[-1][1]==list(args)
    checks.append('all 17 icon PMC relocations; callee-saved registers, SP and fifth stack argument preserved')
    # Enemy icon drawing must not depend on unused HP number images or on
    # the static Lv. label matching an unmodified native resource.
    for p,t in ((1,0),(3,1),(3,2),(5,2),(7,2)):
        h=Harness(game);h.addReset=False
        raw=bytearray(h.raw[(2 if t==2 else 0,1)])
        setpixel(raw,24,41,1) # legitimate changed header; no icon overlap
        h.c.mem_write(0x06400000+p*0x1000,bytes(raw))
        h.put(G+0x40+p*0x84+4,0)
        h.raw[(2 if t==2 else 0,1)]=bytes(raw)
        h.add(p,(7,3),t);h.check(p,(7,3),t)
        assert all(a<0x06408000 for a,_ in h.writes)
    checks.append('enemy mono/dual layouts remain enabled with absent HP number sprites and changed Lv. graphics; no writes to enemy number images')
    # Exercise names and native redraws in every layout, including shifted singles headers.
    for p,t in ((0,0),(2,1),(2,2),(1,0),(3,2)):
        h=Harness(game);h.addReset=False
        key=(2 if t==2 else 0,p&1);base=h.raw[key]
        names=[]
        for variant in range(2):
            data=bytearray(base)
            for y in range(5,16):
                for x in range(16 if p&1 else 8,64):
                    setpixel(data,x,y,(0,1,4)[(x+y+variant)%3])
            for y in range(37,48):
                for x in range(32 if p&1 else 24,48 if p&1 else 40):setpixel(data,x,y,1 if (x+y)%2 else 4)
            names.append(bytes(data))
        h.raw[key]=names[0];h.c.mem_write(0x06400000+p*0x1000,names[0]);mon=h.add(p,(9,10),t)
        h.check(p,(9,10),t)
        for pair in ((13,13),(7,3),(10,10)):
            h.liveTypes[mon]=pair;h.invoke('Main',G);h.check(p,pair,t)
            for status in range(1,7):
                h.invoke('Status',G,status,p);h.check(p,pair,t,status=True)
                h.invoke('Status',G,0,p);h.check(p,pair,t)
        # A native redraw can write exactly the same foreground color as an
        # icon. The name hook must restore first, then capture the new text.
        def redraw(c,pc,size,user):
            data=names[1];addr=0x06400000+p*0x1000
            for tile in list(range(1 if not p&1 else 2,8))+list(range(9 if not p&1 else 10,16)):
                c.mem_write(addr+tile*32,data[tile*32:(tile+1)*32])
        hook=h.c.hook_add(UC_HOOK_CODE,redraw,begin=h.profile['functions']['NameDraw'],end=h.profile['functions']['NameDraw'])
        h.raw[key]=names[1]
        h.invoke('NameDraw',G,G+0x40+p*0x84,0x2273000);h.check(p,(10,10),t)
        h.invoke('Status',G,1,p);h.check(p,(10,10),t,status=True)
        h.c.hook_del(hook)
    checks.append('player singles name shifts +12 and gender/level +8; stacked rhombuses, transparent corners, statuses and native name redraws preserve panel text')
    h=Harness(game)
    # Incompatible layout must produce a diagnostic with zero unsafe writes.
    h.addReset=False;h.c.mem_write(0x06401000,b'\0'*2048);h.writes.clear();h.add(1)
    assert h.c.mem_read(h.state+360,1)[0]==2 and not h.writes,(h.c.mem_read(h.state+360,1)[0],len(h.writes))
    checks.append('unknown native layout rejects the binding before any video write')
    for bad in ('shape','pointer','proxy overflow'):
        h=Harness(game);h.addReset=False
        h.c.mem_write(0x06400000,h.raw[(0,0)])
        if bad=='shape':h.c.mem_write(0x06408060,b'\x11'*32)
        elif bad=='pointer':h.put(G+0x44,0)
        else:h.put(h.get(G+0x44)+0x20,0xffffffe0)
        h.writes.clear();h.add(0,(13,13))
        assert not h.writes and h.get(h.state)==0 and h.c.mem_read(h.state+360,1)[0]!=0,bad
        original=(HERE/'build'/f'{game}-resource-430.bin').read_bytes()[40:72]
        assert bytes(h.c.mem_read(PAL,32))==original
    checks.append('unknown slash shape, invalid number-sprite pointer and overflowed proxy reject before graphics or palette writes')
    for bad in ('original cell','previous position','wrong tile','bad pointer'):
        h=Harness(game)
        data=0x0227c000
        if bad=='original cell':h.put(data,2|(17<<16))
        elif bad=='previous position':h.c.mem_write(data+22,b'\xb0\x81')
        elif bad=='wrong tile':h.c.mem_write(data+24,b'\x21\0')
        else:h.put(h.get(G+0x40)+0xa4,0)
        h.writes.clear();h.add(0,(9,10))
        assert not h.writes and h.c.mem_read(h.state+360,1)[0]==2,bad
    checks.append('unexpanded or mismatched player cell rejects before any graphics write, including standalone DLL without the installer resource patch')
    return checks
def main():
    reports={game:test(game) for game in ('B2','W2')}
    report=dict(compiled_arm_checks=reports,
        release_sha256={g:hashlib.sha256((HERE/'build'/f'TypeIcons{g}.dll').read_bytes()).hexdigest() for g in reports},
        allocation_calls_from_module=0,writable_state_bytes=364,
        limitations=['Engine creation/update/status services are instrumented fixtures.',
                    'Move-specific semantics, actual switching/position commands and allocation counters require live testing.'])
    (HERE/'build/verification.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
if __name__=='__main__':main()
