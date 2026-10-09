"""Execute compiled ARM code and retail resource parsers with isolated stubs.

This is a CPU/ownership harness, not evidence of DS graphics or travel behavior.
"""
import json,struct,subprocess
from pathlib import Path
import ndspy.rom,ndspy.codeCompression,ndspy.narc
from elftools.elf.elffile import ELFFile
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_THUMB,UC_HOOK_CODE
from unicorn.arm_const import *
from build import HERE,WS,BUILD,TOOLS,APIS,NATIVE
REGS=[UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3]
SAVED=[UC_ARM_REG_R4,UC_ARM_REG_R5,UC_ARM_REG_R6,UC_ARM_REG_R7,UC_ARM_REG_R8,UC_ARM_REG_R9,UC_ARM_REG_R10,UC_ARM_REG_R11]
STOP=0x023f8000;STACK=0x023f0000;SUB=0x02280000;FIELD=SUB+0x100;SYSTEM=SUB+0x200;GAME=SUB+0x300;CONFIG=SUB+0x400;CGEAR=SUB+0x500;PARTY=SUB+0x600;WORK=SUB+0x1000;CLSYS=SUB+0x2000
class Harness:
 def __init__(self,game):
    self.game=game;self.delta=64 if game=='B2' else 0;self.armdelta=44 if game=='B2' else 0
    self.uc=Uc(UC_ARCH_ARM,UC_MODE_THUMB);self.uc.ctl_set_cpu_model(UC_CPU_ARM_946);self.uc.mem_map(0x02000000,0x400000)
    rom=ndspy.rom.NintendoDSRom.fromFile(WS/('cleanblack2.nds' if game=='B2' else 'cleanwhite2.nds'))
    self.uc.mem_write(rom.arm9RamAddress,bytes(ndspy.codeCompression.decompress(rom.arm9)))
    for o in rom.loadArm9Overlays(NATIVE.keys()).values():self.uc.mem_write(o.ramAddress,bytes(o.data))
    elf=BUILD/f'{game}-harness.elf'
    subprocess.run([str(TOOLS/'arm-none-eabi-g++'),'-nostdlib','-Wl,-Ttext=0x02300020,-Tbss=0x02320000,-eQaCGearInit',str(BUILD/f'CGearQuickActions{game}.o'),'-o',str(elf)],check=True)
    with elf.open('rb') as f:
      e=ELFFile(f)
      for p in e.iter_segments():
        if p['p_type']=='PT_LOAD':self.uc.mem_write(p['p_vaddr'],p.data()+bytes(p['p_memsz']-p['p_filesz']))
      self.symbols={s.name:s['st_value'] for s in e.get_section_by_name('.symtab').iter_symbols()}
    self.functions={};self.calls=[];self.heap=0x02200000;self.allocations={};self.fail=0;self.attempts=0
    self.touch=None;self.trigger=False;self.event=0;self.busy=False;self.allowed=True;self.bikeOwned=True;self.mapOwned=True;self.flyAllowed=True;self.eggs=set();self.moves={0:[19]};self.sounds=[];self.chars=set();self.actorSet=set();self.inVblank=False;self.uploads=[];self.vblank=0
    self.write(SUB,struct.pack('<IIIHHIIIIII',0,0,0,45,0,0,FIELD,0,0,WORK,0));self.put(FIELD+4,SYSTEM);self.put(FIELD+8,GAME)
    self.put(GAME,CONFIG);self.put(GAME+0x10,PARTY);self.put(WORK,self.ov(0x21ec9cc)|1);self.put(WORK+0x10,SYSTEM);self.put(WORK+0x14,GAME)
    self.flagWork=SUB+0x8000;self.put(GAME+0x1ac,self.flagWork)
    self.put(SYSTEM+0x1c,GAME);self.put(SYSTEM+0x20,FIELD);self.children=[];self.maps=[];self.record=[]
    self.put(PARTY+4,1);self.write(CGEAR,bytes(52));self.write(CONFIG,b'\x01\x0a\0\0')
    self.put(self.arm(0x214197c),CLSYS);self.put(CLSYS+0x10c,CLSYS+0x400);self.put(CLSYS+0x114,CLSYS+0x1400)
    self.put(CLSYS+0x110,CLSYS+0x1600)
    for i in range(16):self.put(CLSYS+0x400+i*64+60,0x80000000)
    for i in range(8):self.put(CLSYS+0x1400+i*20+16,1)
    for i in range(8):self.put(CLSYS+0x1600+i*24+20,0x80000000)
    self.write(CLSYS+0x118,struct.pack('<HHH',16,8,8))
    self.put(WORK+0x34,CLSYS+0x2000);self.put(CLSYS+0x2000,CLSYS+0x2400);self.write(CLSYS+0x200c,struct.pack('<H',88))
    self.arc=ndspy.narc.NARC((HERE.parents[1]/'src/assets/codeinjection/cgearQuickActions.narc').read_bytes())
    def add(a,f):self.functions[self.arm(a) if a<0x2150000 else self.ov(a)]=f
    add(0x2007448,lambda a: CONFIG if a[1]==27 else CGEAR-40)
    add(0x201735c,lambda a:PARTY);add(0x2017354,lambda a:GAME);add(0x20171f4,lambda a:GAME)
    add(0x20175a4,lambda a: self.riding if hasattr(self,'riding') else 0)
    add(0x2008474,lambda a:int(self.bikeOwned if a[1]==450 else self.mapOwned if a[1]==442 else False))
    add(0x201ff34,lambda a:PARTY+0x20+a[1]*0x100)
    add(0x201cd24,lambda a:int((a[0]-PARTY-0x20)//0x100 in self.eggs) if a[1]==0x4c else self.moves.get((a[0]-PARTY-0x20)//0x100,[0]*4)[a[1]-0x36] if 0x36<=a[1]<0x3a and a[1]-0x36<len(self.moves.get((a[0]-PARTY-0x20)//0x100,[])) else 0)
    add(0x2159270,lambda a:self.write(a[1],struct.pack('<HHIIII',20,16,0,SYSTEM,0,FIELD)))
    add(0x21596c4,lambda a:0 if self.flyAllowed else 1);add(0x215eff4,lambda a:0 if self.allowed else 1)
    add(0x218130c,lambda a:int(self.busy));add(0x21983ec,lambda a:13 if self.allowed else 5);add(0x21ed2e0,lambda a:int(bool(self.byte(WORK+0x30e) or self.byte(WORK+0x30f))))
    add(0x2198564,lambda a:0);add(0x219863c,lambda a:0);add(0x219865c,lambda a:0);add(0x21986c0,lambda a:0);add(0x21986b4,lambda a:self.event)
    add(0x21eb894,lambda a:0);add(0x21eb748,lambda a:7 if self.byte(WORK+0x30b) else -1)
    add(0x203dab0,self.point);add(0x203da74,lambda a:int(self.trigger))
    self.heapFree=65536;self.heapLargest=65536
    add(0x2039f8c,lambda a:self.heapFree);add(0x2039fbc,lambda a:self.heapLargest)
    add(0x203a228,lambda a:self.allocate(a[1]));add(0x203a278,lambda a:self.free(a[0]));add(0x2070ca8,lambda a:0);add(0x2070ecc,lambda a:1);add(0x204aac8,lambda a:0);add(0x204ab38,lambda a:self.free(a[0]))
    add(0x204ac38,lambda a:len(self.arc.files[a[1]]));add(0x204ab48,self.read)
    add(0x204bbcc,lambda a:2);add(0x204be0c,lambda a:3);add(0x204be90,lambda a:0);add(0x204bcfc,lambda a:0)
    add(0x204bf48,lambda a:CLSYS+0x2000);add(0x204c134,self.actorDelete)
    add(0x204b8e8,self.char);add(0x204b9b8,self.charDelete);add(0x204c06c,self.actor)
    self.actorVisibility={}
    add(0x204c01c,lambda a:0);add(0x204c044,lambda a:0);add(0x204c54c,lambda a:0);add(0x204c150,lambda a:self.actorVisibility.update({a[0]:bool(a[1])}));add(0x204c16c,lambda a:0)
    add(0x21ec808,self.workEnd)
    add(0x20056fc,self.task);add(0x203a6d4,lambda a:self.free(a[0]));add(0x204ba6c,self.upload);add(0x204bd3c,self.paletteUpload)
    add(0x2006254,lambda a:self.sounds.append(a[0]));add(0x21536ac,lambda a:0x022f1000);add(0x215f024,lambda a:0x022f2000)
    add(0x2016cb4,self.eventCreate);add(0x215b4c8,self.mapCreate);add(0x2016d68,lambda a:self.children.append((a[0],a[1])))
    add(0x2180500,lambda a:45);add(0x2159460,self.flyCreate);add(0x2017994,lambda a:GAME+0x800);add(0x20095a0,lambda a:self.record.append(a[1]))
    self.uc.hook_add(UC_HOOK_CODE,self.intercept)
 def arm(self,a):return (0x214193c if self.game=='B2' else a) if a==0x214197c else a-(self.armdelta if a>=0x20191d8 else 0)
 def ov(self,a):return a-self.delta
 def write(self,a,b):self.uc.mem_write(a,bytes(b));return 0
 def put(self,a,v):self.write(a,struct.pack('<I',v&0xffffffff))
 def word(self,a):return struct.unpack('<I',self.uc.mem_read(a,4))[0]
 def byte(self,a):return self.uc.mem_read(a,1)[0]
 def allocate(self,n):
    self.attempts+=1
    if self.fail==self.attempts:return 0
    if not self.allocations:self.heap=0x02200000
    p=self.heap;self.heap+=(n+7)&~7;self.allocations[p]=n;self.write(p,bytes(n));return p
 def free(self,p):
    assert p in self.allocations,('invalid/double free',hex(p));del self.allocations[p];return 0
 def point(self,a):
    if self.touch:self.put(a[0],self.touch[0]);self.put(a[1],self.touch[1]);return 1
    return 0
 def read(self,a):
    b=self.arc.files[a[1]];p=self.allocate(len(b))
    if p:self.write(p,b)
    return p
 def char(self,a):
    i=next(i for i in range(16) if i not in self.chars);self.chars.add(i)
    self.put(CLSYS+0x400+i*64+60,512);self.write(CLSYS+0x400+i*64+52,struct.pack('<II',INVALID:=0xffffffff,512*i));return i
 def charDelete(self,a):assert a[0] in self.chars;self.chars.remove(a[0]);self.put(CLSYS+0x400+a[0]*64+60,0x80000000);return 0
 def actor(self,a):p=self.allocate(32);self.actorSet.add(p) if p else None;return p
 def actorDelete(self,a):self.actorSet.remove(a[0]);return self.free(a[0])
 def unitDelete(self,a):
    for p in self.actorSet:self.free(p)
    self.actorSet.clear();return self.free(a[0])
 def workEnd(self,a):
    assert not self.actorSet and not self.chars and not self.allocations,'Owned resources survived inner C-Gear teardown'
    self.put(WORK,0);self.put(WORK+0x34,0);return 0
 def task(self,a):self.vblank=a[0];return self.allocate(16)
 def upload(self,a):
    assert self.inVblank,'Upload outside VBlank'
    source=self.word(a[1]+20);size=self.word(a[1]+16)
    assert size==512 and any(p<=source and source+size<=p+n for p,n in self.allocations.items()),'DMA source is not retained main-RAM allocation'
    self.uploads.append((a[0],bytes(self.uc.mem_read(source,size))));return 0
 def paletteUpload(self,a):
    assert self.inVblank and self.word(a[1]+8)==128 and a[2]==4
    self.paletteBytes=bytes(self.uc.mem_read(self.word(a[1]+12),128));return 0
 def eventCreate(self,a):
    e=self.allocate(20)
    if not e:return 0
    data=self.allocate(a[3])
    if not data:self.free(e);return 0
    self.put(e+4,a[2]);self.put(e+12,data);self.put(e+16,a[0]);return e
 def mapCreate(self,a):
    assert self.word(a[0])==SYSTEM and self.word(a[0]+16)==8
    assert any(p<=a[0]<p+n for p,n in self.allocations.items()),'Map request is not owned'
    child=self.eventCreate([SYSTEM,0,0,124])
    if child:self.put(self.word(child+12)+24,a[0]);self.maps.append((a[0],child))
    return child
 def flyCreate(self,a):
    assert a[0]==4 and self.word(a[1]+4)==self.destination
    assert self.word(a[1])>>16==4 and self.word(a[1])&0xffff==self.member
    return self.eventCreate([SYSTEM,0,0,24])
 def eventDelete(self,e):self.free(self.word(e+12));self.free(e)
 def intercept(self,u,a,size,_):
    if a==STOP:u.emu_stop();return
    if a not in self.functions:return
    assert u.reg_read(UC_ARM_REG_SP)%8==0,('stack misalignment',hex(a))
    args=[u.reg_read(r) for r in REGS];self.calls.append((a,args));v=self.functions[a](args)
    for r in REGS:u.reg_write(r,0xdeadbeef)
    u.reg_write(UC_ARM_REG_R0,(v or 0)&0xffffffff);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
 def call(self,name,*args):
    address=self.symbols[name] if isinstance(name,str) else name
    values=[0x11110000+i for i in range(8)]
    for r,v in zip(SAVED,values):self.uc.reg_write(r,v)
    for r,v in zip(REGS,args):self.uc.reg_write(r,v)
    self.uc.reg_write(UC_ARM_REG_SP,STACK);self.uc.reg_write(UC_ARM_REG_LR,STOP|1)
    self.uc.emu_start(address|1,STOP,count=200000)
    assert self.uc.reg_read(UC_ARM_REG_PC)==STOP,('Did not return',name,hex(self.uc.reg_read(UC_ARM_REG_PC)))
    assert self.uc.reg_read(UC_ARM_REG_SP)==STACK and [self.uc.reg_read(r) for r in SAVED]==values
    return self.uc.reg_read(UC_ARM_REG_R0)
 def session(self):return self.symbols['_ZN12_GLOBAL__N_17sessionE']
 def press(self,x,y):self.touch=(x,y);self.trigger=True;self.call('QaInput',WORK);self.trigger=False
 def release(self):self.touch=None;self.call('QaInput',WORK)

for game in ('W2','B2'):
 h=Harness(game)
 # The retail Nitro parsers unpack our complete one-cell resources.
 for file,parser in [(2,0x206017c),(3,0x2060078)]:
    p=0x022e0000;h.write(p,h.arc.files[file]);assert h.call(h.arm(parser),p,p+0x500)==1
 h.call('QaCGearInit',SUB);h.call('QaCGearUpdate',SUB,1)
 assert len(h.chars)==4 and len(h.actorSet)==4
 h.call('QaGearUnit',84,0,45);assert h.calls[-1][1][:3]==[88,0,45]
 h.inVblank=True;h.call(h.vblank);h.inVblank=False;assert len(h.uploads)==4
 # Item gates hide the actors and release their touch regions. Retail flag
 # setters/getters execute on the real saved flag layout in both profiles.
 actors=[h.word(h.session()+12+i*4) for i in range(4)]
 for flag in (1517,1509):
    header=bytearray(h.arc.files[0]);struct.pack_into('<H',header,36,flag);h.arc.files[0]=bytes(header)
    h.call('QaCGearExit',SUB);h.call('QaCGearInit',SUB);h.call('QaCGearUpdate',SUB,1)
    actors=[h.word(h.session()+12+i*4) for i in range(4)]
    h.call(h.arm(0x2019204),h.flagWork,flag);h.bikeOwned=False;h.mapOwned=False
    h.call('QaCGearUpdate',SUB,1);h.inVblank=True;h.call(h.vblank);h.inVblank=False
    assert [h.actorVisibility[a] for a in actors]==[True,False,False,False]
    for x,y in [(196,116),(88,152),(172,152)]:
      before=len(h.calls);h.press(x,y);assert h.call('QaCGearEvent',SUB,1)==0;h.release()
      assert any(a==h.ov(0x21eb894) for a,_ in h.calls[before:]),'Hidden button owned a touch'
    h.call(h.arm(0x2019204),h.flagWork,flag-1);h.call(h.arm(0x201922c),h.flagWork,flag)
    assert h.call(h.arm(0x20191d8),h.flagWork,flag-1)==1,'Adjacent saved flag changed'
    h.bikeOwned=True;h.mapOwned=True;h.call('QaCGearUpdate',SUB,1);h.inVblank=True;h.call(h.vblank);h.inVblank=False
    assert [h.actorVisibility[a] for a in actors]==[True]*4
 # Fresh appearance expectations start with the first native pattern again.
 h.uploads.clear();h.inVblank=True
 for i in range(4):h.write(h.session()+84+i,b'\xff')
 h.call(h.vblank);h.inVblank=False
 # Decode every native pattern for each gender through the actual compositor.
 for sex in range(2):
  for design in range(5):
    h.write(WORK+0x30a,bytes([sex]));h.write(WORK+0x300,bytes([design]));h.call('QaCGearUpdate',SUB,1)
    h.inVblank=True;h.call(h.vblank);h.inVblank=False
    for i in range(4):
      art=h.arc.files[4+i][:512];pattern=h.arc.files[8][(sex*5+design)*512:(sex*5+design+1)*512]
      expected=bytes(((p&15 if p&15==13 else 9) if a&15==9 else a&15)|(((p>>4 if p>>4==13 else 9) if a>>4==9 else a>>4)<<4) for a,p in zip(art,pattern))
      assert next(data for char,data in reversed(h.uploads) if char==i)==expected
 h.press(60,116);assert h.call('QaCGearEvent',SUB,1)==0
 assert h.word(CONFIG)&0x1000 and h.sounds==[1996]
 for _ in range(5):h.call('QaInput',WORK);h.call('QaCGearEvent',SUB,1)
 assert h.sounds==[1996] and h.word(CONFIG)&0x1000
 h.release();h.press(60,116);h.call('QaCGearEvent',SUB,1);h.release()
 assert not h.word(CONFIG)&0x1000 and h.sounds==[1996]
 h.press(196,116);h.event=0x022f3000;assert h.call('QaCGearEvent',SUB,1)==h.event;h.event=0;h.release()
 assert h.call('QaCGearEvent',SUB,1)==0,'Blocked PC touch queued later'
 h.press(196,116);assert h.call('QaCGearEvent',SUB,1)==0x022f1000;h.release()
 h.bikeOwned=False;h.call('QaCGearUpdate',SUB,1);h.press(88,152);assert h.call('QaCGearEvent',SUB,1)==0;h.release()
 h.bikeOwned=True;h.call('QaCGearUpdate',SUB,1);h.press(88,152);assert h.call('QaCGearEvent',SUB,1)==0x022f2000;h.release()
 # Busy field events and inactive input retain the display, but reject touches.
 h.busy=True;h.call('QaCGearUpdate',SUB,0);h.inVblank=True;h.call(h.vblank);h.inVblank=False
 assert all(h.actorVisibility[a] for a in h.actorSet),'Bike/PC events hid custom buttons'
 before=h.paletteBytes
 h.write(WORK+0x30e,b'\1');h.write(WORK+0x310,b'\1');h.call('QaCGearUpdate',SUB,0)
 h.inVblank=True;h.call(h.vblank);h.inVblank=False;assert h.paletteBytes==before,'Short Bike event flashed dim colors'
 h.write(WORK+0x310,b'\0');h.call('QaCGearUpdate',SUB,0);h.inVblank=True;h.call(h.vblank);h.inVblank=False
 assert all(h.actorVisibility[a] for a in h.actorSet),'Dimming hid buttons'
 original=struct.unpack_from('<H',before,16)[0];target=0x0423 # Female fixture after pattern loop.
 expected=sum((((original>>shift)&31)+((target>>shift)&31))//2<<shift for shift in (0,5,10))
 assert struct.unpack_from('<H',h.paletteBytes,16)[0]==expected
 h.press(196,116);assert h.call('QaCGearEvent',SUB,1)==0;h.release();h.busy=False
 h.write(WORK+0x30e,b'\0')
 h.call('QaCGearUpdate',SUB,1);assert h.call('QaCGearEvent',SUB,1)==0,'Busy touch queued later'
 h.write(WORK+0x2fe,b'\1');h.press(60,116);h.touch=(77,125);h.call('QaInput',WORK);h.release()
 assert h.word(CGEAR+16)==0x31504151 and bytes(h.uc.mem_read(CGEAR+21,2))==bytes([77,125])
 assert bytes(h.uc.mem_read(CGEAR,16))==bytes(16)
 h.write(WORK+0x2fe,b'\0');h.call('QaCGearExit',SUB)
 assert not h.allocations and not h.chars and not h.actorSet
 # Native PC storage and other applications rebuild the inner C-Gear work
 # without replacing its subscreen. Tear down before native unit deletion,
 # then attach to the rebuilt work, including reused memory addresses.
 for _ in range(12):
    h.put(WORK,h.ov(0x21ec9cc)|1);h.put(WORK+0x34,CLSYS+0x2000)
    h.call('QaCGearInit',SUB);h.call('QaCGearUpdate',SUB,1)
    assert len(h.actorSet)==4
    h.call('QaGearEnd',WORK);assert not h.allocations
    h.put(WORK,h.ov(0x21ec9cc)|1);h.put(WORK+0x34,CLSYS+0x2000)
    h.call('QaCGearUpdate',SUB,1);assert len(h.actorSet)==4
    h.call('QaCGearExit',SUB);assert not h.allocations
 h.write(CONFIG,struct.pack('<HH',0x1801,0));h.call('QaCGearInit',SUB);h.call('QaCGearUpdate',SUB,1);assert h.sounds==[1996]
 for setter in (0x2008a1c,0x2008a38,0x2008a54,0x2008a70,0x2008ad0,0x2008af0):
    h.call(setter,CONFIG,1);assert h.word(CONFIG)&0x1800==0x1800
 encounter=0x022d0000;h.write(encounter,bytes(64));h.write(encounter+0x2d,b'\x7b');h.write(encounter+0x32,b'\x4c\0')
 assert h.call('QaRepelStep',encounter,GAME)==0 and h.byte(encounter+0x2d)==123
 assert h.call('QaRepelDepleted',encounter,GAME)==0
 h.write(encounter+0x2d,b'\0');h.put(PARTY+4,0);assert h.call('QaRepelDepleted',encounter,GAME)==1
 h.put(PARTY+4,1);h.write(encounter+0x2d,b'\x7b')
 h.write(CONFIG,struct.pack('<HH',0x801,0));assert h.call('QaRepelStep',encounter,GAME)==0 and h.byte(encounter+0x2d)==122
 assert bytes(h.uc.mem_read(encounter+0x32,2))==b'\x4c\0'
 h.call('QaCGearExit',SUB);assert not h.allocations
 # First eligible non-egg Fly user; native app request remains owned across
 # graphics cleanup and a rebuilt field. Cancel returns directly to the field.
 h.put(PARTY+4,3);h.eggs={0};h.moves={0:[19],1:[0],2:[19]};h.call('QaCGearInit',SUB);h.call('QaCGearUpdate',SUB,1)
 for result in [1,2]:
    h.press(172,152);event=h.call('QaCGearEvent',SUB,1);h.release();assert event,(game,[(hex(a),args) for a,args in h.calls[-40:]],list(h.uc.mem_read(h.session()+96,24)))
    callback=h.word(event+4);seq=event+8;assert h.call(callback,event,seq)==0 and h.word(seq)==1
    request,child=h.maps[-1];childwork=h.word(child+12)
    assert h.word(request+16)==0 and h.byte(childwork+0x68)==2
    h.call('QaCGearExit',SUB);assert request in h.allocations
    param=0x022e0000;h.write(param,struct.pack('<IIH2xIII',0,result,42,8,9,SYSTEM))
    ret=h.call('QaTownMapReturn',childwork,param);assert ret==(1 if result==1 else 2)
    h.put(request+40,result);h.member=2;h.destination=42
    h.eventDelete(child);h.call('QaCGearInit',SUB);h.call('QaCGearUpdate',SUB,1)
    if result==2:
      assert h.call(callback,event,seq)==0 and h.word(seq)==2
      h.eventDelete(h.children[-1][1]);assert h.call(callback,event,seq)==1
    else:assert h.call(callback,event,seq)==1
    h.eventDelete(event)
 h.call('QaCGearExit',SUB);assert not h.allocations and h.record==[42]
 # No Fly user, eggs only, empty party, and prohibited Fly locations open
 # the ordinary Town Map. Cancel owns no party menu or Fly travel request.
 for n,eggs,moves,allowed in [(1,set(),{0:[0]},True),(1,{0},{0:[19]},True),(0,set(),{},True),(1,set(),{0:[19]},False)]:
    h.put(PARTY+4,n);h.eggs=eggs;h.moves=moves;h.flyAllowed=allowed
    h.call('QaCGearInit',SUB);h.call('QaCGearUpdate',SUB,1)
    h.press(172,152);event=h.call('QaCGearEvent',SUB,1);h.release();assert event
    callback=h.word(event+4);seq=event+8;assert h.call(callback,event,seq)==0
    request,child=h.maps[-1];assert h.word(request+16)==8,'Fallback opened Fly map'
    h.put(request+40,1);h.eventDelete(child);assert h.call(callback,event,seq)==1
    h.eventDelete(event);h.call('QaCGearExit',SUB);assert not h.allocations
 # Map parent and child allocation failures leave the live field UI intact.
 h.flyAllowed=True;h.put(PARTY+4,1);h.moves={0:[19]};h.eggs=set()
 h.call('QaCGearInit',SUB);h.call('QaCGearUpdate',SUB,1)
 for offset in (1,2):
    baseline=dict(h.allocations);h.fail=h.attempts+offset
    h.press(172,152);assert h.call('QaCGearEvent',SUB,1)==0;h.release()
    assert h.allocations==baseline and len(h.actorSet)==4
 for offset in (1,2):
    h.fail=0;baseline=dict(h.allocations);h.press(172,152);event=h.call('QaCGearEvent',SUB,1);h.release()
    h.fail=h.attempts+offset;assert h.call(h.word(event+4),event,event+8)==1
    h.eventDelete(event);assert h.allocations==baseline and len(h.actorSet)==4
 h.call('QaCGearExit',SUB);assert not h.allocations
 for n in range(1,18):
    h=Harness(game);h.fail=n;h.call('QaCGearInit',SUB);h.call('QaCGearUpdate',SUB,1);h.call('QaCGearExit',SUB);assert not h.allocations and not h.chars
 for low in ('heapFree','heapLargest'):
    h=Harness(game);setattr(h,low,1024);h.call('QaCGearInit',SUB);h.call('QaCGearUpdate',SUB,1);assert not h.actorSet and not h.allocations
    h.call('QaCGearExit',SUB)
 print(game,'native resource parsers, register/stack preservation, touch ownership/hold, event priority, saved bits, Repel pause/resume, dragging, VBlank, persistent display/dimming, inner teardown/rebuild, Town Map fallback, Fly request lifetime/cancel/travel dispatch and allocation failure/cleanup passed')
