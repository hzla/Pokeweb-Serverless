"""Compiled Thumb UI tests with the real retail type chart; native drawing/input
calls are ABI fixtures. No test calls a damage simulation or consumes game RNG.
"""
import hashlib,json,struct
from unicorn import UC_HOOK_CODE
from unicorn.arm_const import *
from verify import Harness,HERE,REGS,BASE
from rpm_read import read_rpm
BIW=0x02280000;BMP=0x02280400;WIN=0x02280420;PIX=0x02281000
PFD=0x02285000;PAL=0x02285100;TRANS=0x02285300
MAIN=0x02286000;CORE=0x02286100;CON=0x02286200;PARAM=0x02287000;KEYS=0x02287100
FIELD=0x02288000

def off(x,y):return ((y//8)*32+x//8)*32+(y%8)*4+(x%8)//2
def getpix(h,x,y):return (h.c.mem_read(PIX+off(x,y),1)[0]>>((x&1)*4))&15
def setpix(h,x,y,col):
 a=PIX+off(x,y);v=h.c.mem_read(a,1)[0];s=(x&1)*4;h.c.mem_write(a,bytes([(v&~(15<<s))|col<<s]))

def test(game):
 h=Harness(game,"MoveEffectiveness");p=h.profile['functions'];c=h.c;calls=[]
 # Sub-BG palette writes and main-OBJ writes are independently bounded.
 h.paletteWrite=lambda c,a,address,size,value,u: None
 h.put(BIW+0x2b0,BMP);h.put(BIW+0x2ac,WIN);h.put(WIN+12,BMP)
 h.put(BMP,PIX);c.mem_write(BMP+4,struct.pack('<HHHH',256,96,32,0));h.put(BIW+0x64,PFD)
 h.put(PFD+20,PAL);h.put(PFD+24,TRANS);h.put(PFD+28,480)
 nativepal=[0x18c8,0x7fff,0x39ce,0x35f,0x18f,0x1df,0xee,0x243f,0x182f,0x37e0,0x2584]+[0x7c1f]*5
 palette=struct.pack('<16H',*nativepal)*16;c.mem_write(PAL,palette);c.mem_write(TRANS,palette)
 h.put(MAIN+4,CORE);h.put(CORE,MAIN);h.put(CORE+8,CON);h.put(CON,MAIN)
 mons=[0x02273000+i*0x300 for i in (1,3,5,6)];h.liveTypes.update({mons[0]:(11,8),mons[1]:(9,9),mons[2]:(10,10)})
 h.put(mons[3],0x02276000);h.put(BIW+0x330,mons[3]);h.put(MAIN+0x2bc,FIELD)
 def ability(mon,value):c.mem_write(mon+0x13c,struct.pack('<H',value))
 def condition(mon,id,value=1):h.put(mon+0x1c+id*4,value)
 def held(value):c.mem_write(mons[0]+0x12,struct.pack('<H',value))
 def field(id,value):h.put(FIELD+0x148+id*4,value)
 data={53:(9,2),55:(10,2),33:(0,1),45:(0,0),82:(9,2),101:(7,2),237:(0,2),165:(0,1),311:(0,2),363:(0,1),449:(0,2),546:(0,2),89:(4,1),85:(12,2),94:(13,2),280:(1,1),202:(11,2),304:(0,2),90:(4,1)}
 def stub(c,pc,size,name):
  args=[c.reg_read(r) for r in REGS];result=0
  if name=='MoveDraw':
   calls.append(name);c.mem_write(PIX,bytes(12288))
   for i in range(4):
    for y in range(10+i//2*48,26+i//2*48):
     for x in range(30+i%2*128,98+i%2*128):setpix(h,x,y,1 if (x+y)%3 else 2)
    setpix(h,60+i%2*128,26+i//2*48,1)
  elif name=='MoveClear':c.mem_write(PIX,bytes(12288));calls.append(name)
  elif name=='MoveParam':calls.append(name);result=data[args[0]][0 if args[1]==0 else 1]
  elif name=='GetMainModule':result=MAIN
  elif name=='ViewToBattle':result={0:3,1:0,3:0,5:1,7:2}.get(args[1],6)
  elif name=='FrontBattler':result=mons[args[1]]
  elif name=='MoveFlag':assert args[1]==8;calls.append(name);result=args[0]==304
  elif name=='HiddenPower':assert args[0]==0x02276000;calls.append(name);result=9
  elif name=='FlushBitmap':calls.append(name)
  elif name=='MoveKey':
   args += [h.get(c.reg_read(UC_ARM_REG_SP)+i*4) for i in range(2)]
   assert args[4:]==[0xffffffff,0x87654321],args
   calls.append(name);result=0xffffffff
  for r in REGS+[UC_ARM_REG_R12]:c.reg_write(r,0xdeadbeef)
  c.reg_write(UC_ARM_REG_R0,result);c.reg_write(UC_ARM_REG_PC,c.reg_read(UC_ARM_REG_LR))
 for name in ['MoveDraw','MoveClear','MoveParam','MoveFlag','GetMainModule','ViewToBattle','FrontBattler','FlushBitmap','MoveKey','HiddenPower']:
  c.hook_add(UC_HOOK_CODE,stub,name,begin=p[name],end=p[name])
 checks=[]
 def draw(rule,moves=(53,55,33,45),index=0):
  h.put(BIW+0x50,rule);h.put(BIW+0x58,5 if rule==3 else 2)
  c.mem_write(PARAM,struct.pack('<4H',*moves)+bytes(16));c.mem_write(BIW+0x2f0,struct.pack('<4H',*moves))
  h.invoke('MoveDraw',BIW,PARAM,index=index)
 def letter(i):return getpix(h,31+(i%2)*128,10+(i//2)*48)
 def key(targets,button,cursor=0,index=0):
  rows=bytearray(b'\xff'*12*16);rows[cursor*12:cursor*12+len(targets)]=bytes(targets);rows[cursor*12+10]=button
  c.mem_write(KEYS,bytes(rows));h.put(BIW+0x68,cursor<<5)
  h.invoke('MoveKey',BIW,0x12345678,KEYS,0,0xffffffff,0x87654321,index=index)
  assert c.reg_read(UC_ARM_REG_R0)==0xffffffff
 for rule in (0,3):
  draw(rule,index=rule==3);assert [letter(i) for i in range(4)]==[11,12,12,1]
  assert all(getpix(h,60+i%2*128,26+i//2*48)==1 for i in range(4))
  assert struct.unpack('<3H',c.mem_read(PAL+219*2,6))==(0x2b5e,0x62b3,0x211f)
  before=len(calls);key([0],0,index=rule==3)
  assert calls[before:]==['MoveKey'],calls[before:]
 checks.append('singles/rotation: native type chart, status moves default, PP untouched, unchanged frames have zero bitmap flushes or move-data queries')
 # Fixed-damage Fire vs Grass/Steel remains white, despite its type being 4x.
 draw(0,(82,55,33,45));assert letter(0)==1
 checks.append('fixed damage does not acquire a false super-effective color')
 for rule in (0,3):
  draw(rule,(237,165,311,363));assert [letter(i) for i in range(4)]==[11,1,1,1]
  before=len(calls);key([0],0,index=rule==3);assert calls[before:]==['MoveKey']
  ability(mons[3],96);draw(rule);assert [letter(i) for i in range(4)]==[12,12,12,1];ability(mons[3],0)
 draw(0,(449,546,33,45));assert [letter(i) for i in range(2)]==[1,1]
 checks.append('Hidden Power uses native IV type once per drawing; effective Normalize changes move type; Struggle and unsupported item/weather moves stay neutral')
 for rule in (1,2):
  draw(rule);assert [letter(i) for i in range(4)]==[1]*4
  h.put(BIW+0x300,0);c.mem_write(BIW+0x2c8,b'\x00')
  before=[getpix(h,x,y) for y in range(10,26) for x in range(128)]
  h.invoke('MoveClear',BIW,3);h.put(BIW+0x58,3)
  assert [getpix(h,x+64,y) for y in range(16) for x in range(128)]==before
  # Unusual key-table order proves the cursor ordinal is not used as an enemy ID.
  key([1],1,cursor=3);assert getpix(h,95,0)==11
  key([3],3,cursor=1);assert getpix(h,95,0)==12
  key([5],5,cursor=4);assert getpix(h,95,0)==(12 if rule==2 else 12)
  key([0],0,cursor=2);assert getpix(h,95,0)==1
  key([1,3],1);assert getpix(h,95,0)==1
  h.invoke('MoveClear',BIW,2);assert all(getpix(h,x,y)==0 for y in range(16) for x in range(64,192))
 checks.append('doubles/triples: default move buttons, exact glyph transfer, current enemy from key-table mapping, ally/spread default, cancellation clears label')
 # Every new wrapper preserved callee-saved registers/SP (Harness.invoke) and both stack arguments.
 checks.append('five additional call-site wrappers preserve original calls, return value, callee-saved registers and fifth/sixth stack arguments')
 # Real retail BPP ability/condition/item and client field readers, with only
 # view mapping and page drawing substituted. These checks never start a game.
 def reset(pair=(0,0)):
  h.liveTypes[mons[0]]=pair
  for mon in (mons[0],mons[3]):
   ability(mon,0)
   for id in (16,17,19,21,30,31,32):condition(mon,id,0)
  held(0);field(2,0);field(7,0)
 def expect(move,col):
  draw(0,(move,45,45,45));assert letter(0)==col,(game,move,letter(0),col)
 reset((7,7));expect(33,13);expect(280,13)
 ability(mons[3],113);expect(33,1);expect(280,1)
 condition(mons[3],16);expect(33,13)
 condition(mons[0],17,1|(7<<9));expect(33,1)
 reset((16,16));expect(94,13);condition(mons[0],17,1|(16<<9));expect(94,1)
 reset((10,4));expect(85,13)
 for source in ('levitate','balloon','magnet','telekinesis'):
  reset((12,12))
  if source=='levitate':ability(mons[0],26)
  elif source=='balloon':held(541)
  else:condition(mons[0],30 if source=='magnet' else 32)
  expect(89,13)
  for bypass in (104,163,164):
   ability(mons[3],bypass);expect(89,11 if source=='levitate' else 13)
  ability(mons[3],0)
  for id in (21,31):condition(mons[0],id);expect(89,11);condition(mons[0],id,0)
  field(2,1);expect(89,11);field(2,0)
 reset((12,12));ability(mons[0],26);condition(mons[0],16);expect(89,11)
 reset((12,12));held(541)
 for suppress in ('embargo','klutz','magicroom'):
  if suppress=='embargo':condition(mons[0],19)
  elif suppress=='klutz':ability(mons[0],103)
  else:field(7,1)
  expect(89,11);condition(mons[0],19,0);ability(mons[0],0);field(7,0)
  expect(89,13)
 held(0);expect(89,11)
 reset((2,12));expect(89,13);held(278);expect(89,1)
 field(2,1);expect(89,11);field(2,0);condition(mons[0],21);expect(89,11)
 for monAbility,move in ((11,55),(87,55),(114,55),(10,85),(31,85),(78,85),(18,53),(157,202),(43,304)):
  reset();ability(mons[0],monAbility);expect(move,13)
  for bypass in (104,163,164):ability(mons[3],bypass);expect(move,1)
  ability(mons[3],0);condition(mons[0],16);expect(move,1)
 reset((11,8));ability(mons[0],25);expect(33,13);expect(53,11);expect(82,1)
 reset();ability(mons[0],5);expect(90,13);ability(mons[3],104);expect(90,1)
 reset();ability(mons[0],200);expect(33,1)
 checks.append('red: type immunities, Scrappy/Foresight/Miracle Eye, Levitate/Air Balloon/Magnet Rise/Telekinesis, grounding and Iron Ball dual-type order; active item suppression; absorption, Soundproof, Wonder Guard, Sturdy OHKO and ability bypass/suppression, with real native state readers')
 # Re-evaluate live state without reloading move data; immunity clearing must
 # remove every red glyph. Native client objects remain byte-identical.
 reset();held(541);draw(0,(89,45,45,45));assert letter(0)==13
 held(0);before=bytes(c.mem_read(mons[0],0x300));oldCalls=len(calls)
 key([0],0);assert letter(0)==1 and bytes(c.mem_read(mons[0],0x300))==before
 assert calls[oldCalls:]==['MoveKey','FlushBitmap']
 checks.append('live immunity removal retints red to default without move-data reloads or client-state mutations')
 reset((7,7))
 for rule in (1,2):
  draw(rule,(33,45,45,45));h.put(BIW+0x300,0);c.mem_write(BIW+0x2c8,b'\0')
  h.invoke('MoveClear',BIW,3);h.put(BIW+0x58,3)
  key([1],1,cursor=3);assert getpix(h,95,0)==13
  key([3],3,cursor=1);assert getpix(h,95,0)==1
  key([1],1,cursor=3);assert getpix(h,95,0)==13
  key([0],0);assert getpix(h,95,0)==1
  h.invoke('MoveClear',BIW,2)
  assert struct.unpack('<3H',c.mem_read(PAL+219*2,6))==(0x7c1f,)*3
 # Edit the same six constant bytes as the installer; exercise actual compiled
 # loads, all three fade-buffer entries, hardware palette and restore path.
 from verify import blend
 debug=read_rpm((HERE/'build'/f'MoveEffectiveness{game}.debug.dll').read_bytes())
 table=BASE+next(s['address'] for s in debug['symbols'] if s['name']=='gMovePreviewColors')
 custom=(0x03e0,0x7c00,0x7c1f);c.mem_write(table,struct.pack('<3H',*custom))
 faded=struct.pack('<256H',*[blend(v,0,8) for v in struct.unpack('<256H',c.mem_read(PAL,512))]);c.mem_write(TRANS,faded)
 h.put(PFD+20+12,0);c.mem_write(PFD+20+16,b'\0\0')
 draw(0)
 for at,col in zip((219,220,221),custom):
  assert struct.unpack('<H',c.mem_read(PAL+at*2,2))[0]==col
  assert struct.unpack('<H',c.mem_read(TRANS+at*2,2))[0]==blend(col,0,8)
  assert struct.unpack('<H',c.mem_read(0x05000400+at*2,2))[0]==blend(col,0,8)
 h.invoke('MoveClear',BIW,2)
 assert struct.unpack('<3H',c.mem_read(PAL+219*2,6))==(0x7c1f,)*3
 checks.append('red target/ally transitions in doubles/triples; customized six-byte color table loads and fades correctly, and all three native palette entries restore')
 assert c.mem_read(h.state+19,1)[0]==0
 return checks
if __name__=='__main__':
 out={'checks':{g:test(g) for g in ('B2','W2')},'release_sha256':{g:hashlib.sha256((HERE/'build'/f'MoveEffectiveness{g}.dll').read_bytes()).hexdigest() for g in ('B2','W2')},'writable_state_bytes':20};(HERE/'build/move-verification.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2))
