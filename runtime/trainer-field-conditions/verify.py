"""Run the compiled hook and native BW2 condition routines on an ARM CPU model.

Only file IO, event allocation/removal, animation commands and switch-in bodies
are stubbed. Native message serialization, field/side state, duration and removal execute.
This is a CPU integration check, not DS gameplay/visual acceptance.
"""
from pathlib import Path
import struct, json, argparse
from profiles import PROFILES, address as native_address, rom_path
import ndspy.rom, ndspy.codeCompression
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import *
HERE = Path(__file__).resolve().parent
WS = HERE.parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--game', choices=PROFILES, default='W2')
game = parser.parse_args().game
rom = ndspy.rom.NintendoDSRom.fromFile(rom_path(game))
assert bytes(rom.idCode).decode() == PROFILES[game] and rom.version == 0
def A(value): return native_address(value, game)
overlays = rom.loadArm9Overlays([167,169])
image = (HERE/'build'/game/'cpu.elf').open('rb')
elf = ELFFile(image)
symbols = {s.name:s['st_value'] for s in elf.get_section_by_name('.symtab').iter_symbols()}
START = symbols['TrainerFieldStart']
HOOK = symbols[f'THUMB_BRANCH_LINK_167_0x{A(0x0219f5da):08x}']
FINISH_HOOK = symbols[f'THUMB_BRANCH_LINK_167_0x{A(0x0219f688):08x}']
FINISH = symbols['TrainerFieldFinish']
FIELD = A(0x021dd928)
SIDE = 0x0689e960
MAIN, SETUP, ENEMY, FLOW, QUEUE = 0x02200000,0x02200100,0x02200300,0x02200400,0x02201000
STOP, STACK = 0x023f0000,0x023e0000
regs = [UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3]
checks = []
class Machine:
    def __init__(self, record=bytes(12), trainer=2, count=4, battle=1, comm=0):
        self.uc = Uc(UC_ARCH_ARM,UC_MODE_THUMB)
        self.uc.mem_map(0x02000000,0x400000)
        self.uc.mem_map(0x06800000,0x100000)
        self.uc.mem_write(rom.arm9RamAddress,bytes(ndspy.codeCompression.decompress(rom.arm9)))
        for o in overlays.values(): self.uc.mem_write(o.ramAddress,bytes(o.data))
        for s in elf.iter_segments():
            if s['p_type']=='PT_LOAD': self.uc.mem_write(s['p_vaddr'],s.data())
        self.write(MAIN,SETUP); self.write(SETUP,battle); self.uc.mem_write(SETUP+0x20,bytes([comm]));self.write(SETUP+0x4c,ENEMY);self.write(ENEMY,trainer)
        self.write(FLOW+4,MAIN);self.write(FLOW+12,QUEUE)
        self.table = struct.pack('<IHHII',0x43465750,1,12,count,0)+bytes(count*12)
        if trainer < count:
            at=16+trainer*12;self.table=self.table[:at]+record+self.table[at+12:]
        self.cursor=0;self.reads=0;self.events=0;self.removed=[];self.order=[];self.style=0;self.positions={0:0,12:1};self.activationResult=0
        self.uc.hook_add(UC_HOOK_CODE,self.callback)
        # Patch the actual retail call site to the compiled assembly adapter.
        for address,dest in [(A(0x0219f5da),HOOK),(A(0x0219f688),FINISH_HOOK)]:
            delta=(dest&~1)-(address+4)
            self.uc.mem_write(address,struct.pack('<HH',0xf000|((delta>>12)&2047),0xf800|((delta>>1)&2047)))
        self.call(A(0x021d5af4),FIELD,0)
        self.uc.mem_write(SIDE,bytes(448))
    def write(self,at,value): self.uc.mem_write(at,struct.pack('<I',value))
    def read(self,at): return struct.unpack('<I',self.uc.mem_read(at,4))[0]
    def ret(self,value=0):
        self.uc.reg_write(UC_ARM_REG_R0,value);self.uc.reg_write(UC_ARM_REG_PC,self.uc.reg_read(UC_ARM_REG_LR))
    def callback(self,uc,at,size,data):
        a=[uc.reg_read(r) for r in regs]
        if at==STOP: uc.emu_stop();return
        if at==STOP+0x100: self.ret()
        elif at==A(0x02070ca8): self.ret()
        elif at==A(0x02070ecc):
            path=bytes(uc.mem_read(a[1],80)).split(b'\0')[0]
            assert path==b'rom:/battle/trainer-fields.bin';self.cursor=0;self.ret(1 if self.table is not None else 0)
        elif at==A(0x02070dec): self.ret(len(self.table))
        elif at==A(0x02070e54): self.cursor=a[1];self.ret(1)
        elif at==A(0x02070e6c):
            block=self.table[self.cursor:self.cursor+a[2]];uc.mem_write(a[1],block);self.cursor+=len(block);self.reads+=1;self.ret(len(block))
        elif at==A(0x02070de0): self.ret(1)
        elif at in [A(0x021d5bf0),0x06898cc0]:
            self.events+=1;self.ret(0x02210000+self.events*64)
        elif at==0x06898cd0: self.ret() # BattleEventItem_SetWorkValue
        elif at in [A(0x021d5e40),A(0x021d5c34),0x06898d44,0x06898dd0]: self.removed.append(a[0]);self.ret()
        elif at==A(0x021a76a8): # Native display/event queue boundary, state API retained.
            self.order.append(('weather',a[1]));self.write(FIELD,a[1]);self.write(FIELD+4,a[2]);self.ret()
        elif at==A(0x0219f2bc):
            if a[1] not in [0,1]: self.ret(0)
            else:
                client=0x02220000+a[1]*32;self.write(client+4,client+16)
                n=[1,2,3,3][self.style];uc.mem_write(client+9,bytes([n]));self.ret(client)
        elif at==A(0x0219d524): self.ret(0x02230000+a[1]*128)
        elif at==A(0x021bb3a8): self.ret(0)
        elif at==A(0x021a13d8):
            self.order.append(('entry',a[1],a[2],self.read(FIELD),self.read(SIDE+12),self.read(FIELD+0x148+4)))
            self.ret()
        elif at==A(0x0219bdc0): self.ret(self.style)
        elif at==A(0x021abb90):self.ret(self.positions.get(a[1],6))
        elif at==A(0x021b1474):
            assert a[0]==QUEUE and a[1]==0x30
            stack=uc.reg_read(UC_ARM_REG_SP)
            self.order.append(('animation',a[2],a[3],self.read(stack)))
            assert self.read(stack+4)==self.read(stack+8)==0
            self.ret()
        elif at==A(0x021b1610):
            assert a[0]==QUEUE and a[1] in [0x5A,0x5B]
            if a[1]==0x5B:
                assert self.read(uc.reg_read(UC_ARM_REG_SP))==0xFFFF0000
                self.order.append(('message',18,a[2],a[3]))
            else:
                assert a[3]==0xFFFF0000
                self.order.append(('message',19,a[2]))
            # Execute the actual native variadic serializer and queue writes.
        elif at==A(0x021a14e8):
            self.order.append(('abilities',));self.ret(self.activationResult)
        elif at==A(0x0219bfe0):self.ret(0)
    def call(self,address,*args):
        for r,v in zip(regs,list(args)+[0]*(4-len(args))): self.uc.reg_write(r,v)
        self.uc.reg_write(UC_ARM_REG_SP,STACK);self.uc.reg_write(UC_ARM_REG_LR,STOP|1)
        self.uc.emu_start(address|1,STOP,count=200000)
        assert self.uc.reg_read(UC_ARM_REG_PC)==STOP,hex(self.uc.reg_read(UC_ARM_REG_PC))
        assert self.uc.reg_read(UC_ARM_REG_SP)==STACK
        return self.uc.reg_read(UC_ARM_REG_R0)
    def start(self): return self.call(START,MAIN,FLOW)

def record(weather=0,fields=0,player=0,opponent=0,layers=(0,0,0,0)):
    return struct.pack('<BBHHH4B',weather,0,fields,player,opponent,*layers)

# Real first-turn caller and adapter ABI, including all four formats.
for style in range(4):
    m=Machine(record(3,0xf6,0x393f,0x393f,(3,2,1,1)));m.style=style
    for r in [UC_ARM_REG_R4,UC_ARM_REG_R5,UC_ARM_REG_R6,UC_ARM_REG_R7]:m.uc.reg_write(r,0x12340000+r)
    saved=[m.uc.reg_read(r) for r in [UC_ARM_REG_R4,UC_ARM_REG_R5,UC_ARM_REG_R6,UC_ARM_REG_R7]]
    m.call(A(0x0219f5c8),FLOW)
    assert saved==[m.uc.reg_read(r) for r in [UC_ARM_REG_R4,UC_ARM_REG_R5,UC_ARM_REG_R6,UC_ARM_REG_R7]]
    assert m.order[0]==('weather',2)
    entries=[e for e in m.order if e[0]=='entry'];assert entries and all(e[3:]==(2,1,1) for e in entries)
    animations=[e for e in m.order if e[0]=='animation'];assert len(animations)==30
    assert m.order.index(animations[0])>m.order.index(entries[-1])
    assert m.order[-1]==('abilities',)
    assert ('animation',0,0,115) in animations and ('animation',1,1,113) in animations
    assert ('animation',1,0,191) in animations and ('animation',0,1,390) in animations
    messages=[e for e in m.order if e[0]=='message'];assert len(messages)==30
    for animation in animations: assert m.order[m.order.index(animation)+1][0]=='message'
    expected=[('message',18,857,0)]+[('message',19,i) for i in [117,114,115,178,180]]
    for side in range(2):expected += [('message',19,i+side) for i in [124,128,132,136,140,144,148,152,156,164,168,172]]
    assert messages==expected
    assert m.read(QUEUE)>0, 'Native message serializer wrote no data'
    assert m.reads==4
    checks.append(f'format {style}: native messages follow each animation before entry abilities; correct side variants and actor IDs; native serialization and adapter ABI')

# Native duration and removal: permanent values survive well past every native
# turn limit, while ordinary later-created timed conditions still expire.
m=Machine(record(2,0xf6,0x393f,0x393f,(3,2,3,2)))
assert m.start()==SETUP+8
assert bytes(m.uc.mem_read(SETUP+16,1))==b'\x01'
for effect in [1,2,4,5,6,7]:assert m.read(FIELD+0x28+effect*4)==1
for side in range(2):
    assert [m.read(SIDE+side*224+e*16+12) for e in [6,7]]==[3,2]
for _ in range(100):
    m.call(A(0x021d5de4),FIELD,0,FLOW)
    m.call(0x06898d54,(STOP+0x100)|1,FLOW)
assert not m.removed
for side in range(2):
    for effect in [0,1,2,3,4,5,6,7,8,11,12,13]:assert m.read(SIDE+side*224+effect*16+12)>0
# The same native removal used by Brick Break/Rapid Spin, then a timed screen.
for effect in [0,1]: assert m.call(0x06898d10,1,effect)==1
for effect in [0,1]: assert m.read(SIDE+224+effect*16+12)==0
for _ in range(10):m.call(0x06898d54,(STOP+0x100)|1,FLOW)
assert m.read(SIDE+224+12)==0
turn5=m.call(A(0x021ce1c0),5)
m.call(0x06898c10,1,0,turn5)
for _ in range(4):m.call(0x06898d54,(STOP+0x100)|1,FLOW)
assert m.read(SIDE+224+12)==1
m.call(0x06898d54,(STOP+0x100)|1,FLOW);assert m.read(SIDE+224+12)==0
assert m.call(A(0x021d5c00),FIELD,1)==1
for _ in range(10):m.call(A(0x021d5de4),FIELD,0,FLOW)
assert m.read(FIELD+0x148+4)==0
# Replacement weather keeps its native finite duration; old weather never returns.
m.call(A(0x021d5b2c),FIELD,1,255)
for _ in range(100):assert m.call(A(0x021d5b3c),FIELD)==0
assert m.read(FIELD)==1
m.call(A(0x021d5b2c),FIELD,2,5)
for _ in range(4):assert m.call(A(0x021d5b3c),FIELD)==0
assert m.call(A(0x021d5b3c),FIELD)==2 and m.read(FIELD)==0
checks.append('100 native turn checks: permanent field/side/weather; explicit removal persists; later timed effects expire')

for battle,comm in [(0,0),(2,0),(3,0),(4,0),(1,1)]:
    m=Machine(record(2,2,1,1),battle=battle,comm=comm);m.start();assert m.reads==0 and m.events==0
checks.append('wild/facility/online/demo/communication passthrough')
for variant in ['missing','short','bad-header','bad-size','bad-record','out-of-range']:
    m=Machine(record(2,2,1,1))
    if variant=='missing':m.table=None
    elif variant=='short':m.table=b'abc'
    elif variant=='bad-header':m.table=b'BAD!'+m.table[4:]
    elif variant=='bad-size':m.table+=b'\0'
    elif variant=='bad-record':m.table=m.table[:40]+b'\xFF'+m.table[41:]
    else:m.write(ENEMY,60000)
    m.start();assert m.events==0 and bytes(m.uc.mem_read(SETUP+16,1))==b'\0'
checks.append('missing/malformed/out-of-range data fails closed without battle mutations')
# Default records and clear-weather behavior.
m=Machine();m.start();assert m.events==0 and not m.order
m=Machine(record(1));m.write(FIELD,4);m.start();assert m.read(FIELD)==0 and m.order==[('weather',0)]
checks.append('default records preserve battle weather; explicit clear removes existing weather')


# Active-slot lookup handles fainted slot zero and nonstandard placements.
m=Machine(record(0,0,1,2));m.positions={1:4,14:5};m.activationResult=1
assert m.call(FINISH,FLOW)==1
assert m.order==[('animation',4,4,115),('message',19,124),('animation',5,5,113),('message',19,129),('abilities',)]
# An empty side has no phantom animation, and hazards animate once per field,
# independently of the number of layers.
m=Machine(record(0,0,0,0,(3,2,0,0)));m.positions={0:0}
m.call(FINISH,FLOW)
assert m.order==[('animation',0,0,191),('message',19,148),('animation',0,0,390),('message',19,152),('abilities',)]
# Trick Room's text uses the native Pokémon ID rather than its field position.
m=Machine(record(0,2));m.positions={1:4,14:5};m.call(FINISH,FLOW)
assert ('message',18,857,1) in m.order
m=Machine(record(0,2));m.positions={14:5};m.call(FINISH,FLOW)
assert ('message',18,857,14) in m.order
checks.append('Opening cues/messages: one per hazard regardless of layers; missing sides; active actor IDs; native activation return value')
print(json.dumps({'game':game,'checks':checks,'result':'passed','scope':'ARM CPU integration; file/display/event boundaries stubbed; no DS visual acceptance'},indent=2))
