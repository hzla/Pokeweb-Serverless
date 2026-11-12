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
LABEL_WIDTH=136;LABEL_HEIGHT=24;LABEL_BYTES=LABEL_WIDTH*LABEL_HEIGHT//2

def off(x,y,width=256):return ((y//8)*(width//8)+x//8)*32+(y%8)*4+(x%8)//2
def getpix(h,x,y):return (h.c.mem_read(h.move_pixels+off(x,y),1)[0]>>((x&1)*4))&15
def setpix(h,x,y,col):
 a=h.move_pixels+off(x,y);v=h.c.mem_read(a,1)[0];s=(x&1)*4;h.c.mem_write(a,bytes([(v&~(15<<s))|col<<s]))

def test(game,factory=Harness,memory_offset=0):
 h=factory(game,"MoveEffectiveness");p=h.profile['functions'];c=h.c;calls=[]
 BIW,BMP,WIN,PIX,PFD,PAL,TRANS,MAIN,CORE,CON,PARAM,KEYS,FIELD=(v+memory_offset for v in
  (0x02280000,0x02280400,0x02280420,0x02281000,0x02285000,0x02285100,0x02285300,
   0x02286000,0x02286100,0x02286200,0x02287000,0x02287100,0x02288000))
 h.move_pixels=PIX
 label_win,label_bmp,label_pix=(0x02289000+memory_offset,0x02289020+memory_offset,0x02289100+memory_offset)
 footer_win,footer_bmp,footer_pix=(0x02289800+memory_offset,0x02289820+memory_offset,0x02289840+memory_offset)
 label_allocated=label_mapped=deny_label=False
 glyph_bounds=(30,98)
 glyph_height=16
 def label_pixel(x,y):return (c.mem_read(label_pix+off(x,y,LABEL_WIDTH),1)[0]>>((x&1)*4))&15
 def label_text():return {(x,y):1 if pixel==7 else 2 for y in range(LABEL_HEIGHT) for x in range(LABEL_WIDTH)
                          if (pixel:=label_pixel(x,y)) in (7,14)}
 def palette_entries():return struct.unpack('<16H',c.mem_read(PAL+224*2,32))
 layout=h.profile.get('layout',{'rule':0x50,'screen':0x58,'state':0x68,'pfd':0x64,
  'window':0x2ac,'bitmap':0x2b0,'selectedActive':0x300,'selectedSlots':0x2c8,
  'moveArray':0x2f0,'rotationMons':0x330})
 # Sub-BG palette writes and main-OBJ writes are independently bounded.
 h.paletteWrite=lambda c,a,address,size,value,u: None
 h.put(BIW+layout['bitmap'],BMP);h.put(BIW+layout['window'],WIN);h.put(WIN+12,BMP)
 h.put(BIW+layout['bitmap']+4,footer_win);h.put(footer_win+12,footer_bmp);h.put(footer_bmp,footer_pix)
 c.mem_write(footer_win+2,bytes((6,3,22,3,2,3,2,13)))
 c.mem_write(footer_bmp+4,struct.pack('<HHHH',24,16,32,0))
 h.put(BMP,PIX);c.mem_write(BMP+4,struct.pack('<HHHH',256,96,32,0));h.put(BIW+layout['pfd'],PFD)
 h.put(PFD+20,PAL);h.put(PFD+24,TRANS);h.put(PFD+28,480)
 nativepal=[0x18c8,0x7fff,0x39ce,0x35f,0x18f,0x1df,0xee,0x243f,0x182f,0x37e0,0x2584]+[0x7c1f]*5
 bank=struct.pack('<16H',*nativepal)
 palette=bank*14+bytes(32)+bank;c.mem_write(PAL,palette);c.mem_write(TRANS,palette)
 # BG5's move page crosses two screen blocks, with a flipped right edge.
 c.mem_map(0x06200000,0x20000)
 c.mem_write(0x0400100a,struct.pack('<H',0xc411))
 keyline=15 if game in ('B','W') else 6
 c.mem_write(0x06210020,bytes([0xa0|keyline,0xc8,0x53,0x35])*8+bytes.fromhex('53533553')*8)
 for y in range(28,34):
  screen=0x06202800+(y//32)*0x1000
  for x in range(32):
   tile=1 if x%16==0 else 0x401 if x%16==15 else 2
   c.mem_write(screen+2*((y%32)*32+x),struct.pack('<H',((9+x//16)<<12)|tile))
 h.put(MAIN+4,CORE);h.put(CORE,MAIN);h.put(CORE+8,CON);h.put(CON,MAIN)
 mons=[0x02273000+memory_offset+i*0x300 for i in (1,3,5,6)];h.liveTypes.update({mons[0]:(11,8),mons[1]:(9,9),mons[2]:(10,10)})
 h.put(mons[3],0x02276000+memory_offset);h.put(BIW+layout['rotationMons'],mons[3]);h.put(MAIN+0x2bc,FIELD)
 def ability(mon,value):c.mem_write(mon+0x13c,struct.pack('<H',value))
 def condition(mon,id,value=1):h.put(mon+0x1c+id*4,value)
 def held(value):c.mem_write(mons[0]+0x12,struct.pack('<H',value))
 def field(id,value):h.put(FIELD+0x148+id*4,value)
 data={53:(9,2),55:(10,2),33:(0,1),45:(0,0),82:(9,2),101:(7,2),237:(0,2),165:(0,1),311:(0,2),363:(0,1),449:(0,2),546:(0,2),89:(4,1),85:(12,2),94:(13,2),280:(1,1),202:(11,2),304:(0,2),90:(4,1)}
 def stub(c,pc,size,name):
  nonlocal label_allocated,label_mapped
  args=[c.reg_read(r) for r in REGS];result=0
  if name=='MoveDraw':
   calls.append(name);c.mem_write(PIX,bytes(12288))
   for i in range(4):
    for y in range(10+i//2*48,10+i//2*48+glyph_height):
     for x in range(glyph_bounds[0]+i%2*128,glyph_bounds[1]+i%2*128):setpix(h,x,y,1 if (x+y)%3 else 2)
    setpix(h,60+i%2*128,26+i//2*48,1)
  elif name in ('MoveClear','MoveDestroy'):
   assert not label_allocated and not label_mapped
   c.mem_write(PIX,bytes(12288));calls.append(name)
  elif name=='MoveWindowCreate':
   sp=c.reg_read(UC_ARM_REG_SP)
   tile_y=19 if any(c.mem_read(footer_pix,192)) else 21
   assert args+[h.get(sp+i*4) for i in range(3)]==[6,0,tile_y,17,3,14,1]
   assert not label_allocated and not label_mapped
   calls.append(name)
   if not deny_label:
    label_allocated=True;result=label_win
    c.mem_write(label_win+2,bytes((6,0,tile_y,17,3,17,3,14)))
    h.put(label_win+12,label_bmp);h.put(label_bmp,label_pix)
    c.mem_write(label_bmp+4,struct.pack('<HHHH',LABEL_WIDTH,LABEL_HEIGHT,32,0))
    c.mem_write(label_pix,b'\xff'*LABEL_BYTES+b'\x5a'*32)
  elif name=='MoveWindowMap':
   assert label_allocated and not label_mapped
   if args[0]==footer_win:calls.append('FooterMap')
   else:
    assert args[0]==label_win
    label_mapped=True;calls.append(name)
  elif name=='MoveWindowUnmap':
   assert args[0]==label_win and label_mapped
   label_mapped=False;calls.append(name)
  elif name=='MoveWindowDelete':
   assert args[0]==label_win and label_allocated and not label_mapped
   assert c.mem_read(label_pix+LABEL_BYTES,32)==b'\x5a'*32
   label_allocated=False;calls.append(name)
  elif name=='MoveBgCommit':assert args[0]==6;calls.append(name)
  elif name=='MoveParam':calls.append(name);result=data[args[0]][0 if args[1]==0 else 1]
  elif name=='GetMainModule':result=MAIN
  elif name=='ViewToBattle':result={0:3,1:0,3:0,5:1,7:2}.get(args[1],6)
  elif name=='FrontBattler':result=mons[args[1]]
  elif name=='MoveFlag':assert args[1]==8;calls.append(name);result=args[0]==304
  elif name=='HiddenPower':assert args[0]==0x02276000+memory_offset;calls.append(name);result=9
  elif name=='FlushBitmap':
   assert args[0]==WIN or args[0]==label_win and label_allocated
   calls.append(name)
  elif name=='MoveKey':
   args += [h.get(c.reg_read(UC_ARM_REG_SP)+i*4) for i in range(2)]
   assert args[4:]==[0xffffffff,0x87654321],args
   calls.append(name);result=0xffffffff
  for r in REGS+[UC_ARM_REG_R12]:c.reg_write(r,0xdeadbeef)
  c.reg_write(UC_ARM_REG_R0,result);c.reg_write(UC_ARM_REG_PC,c.reg_read(UC_ARM_REG_LR))
 for name in ['MoveDraw','MoveClear','MoveDestroy','MoveWindowCreate','MoveWindowMap','MoveWindowUnmap','MoveWindowDelete',
              'MoveBgCommit','MoveParam','MoveFlag','GetMainModule','ViewToBattle','FrontBattler','FlushBitmap','MoveKey','HiddenPower']:
  c.hook_add(UC_HOOK_CODE,stub,name,begin=p[name]&~1,end=p[name]&~1)
 checks=[]
 def draw(rule,moves=(53,55,33,45),index=0):
  h.put(BIW+layout['rule'],rule);h.put(BIW+layout['screen'],5 if rule==3 else 2)
  c.mem_write(PARAM,struct.pack('<4H',*moves)+bytes(16))
  # BW1 rotation does not fill the normal move array. The compiled candidate
  # must retain Draw's move snapshot across native key processing instead.
  c.mem_write(BIW+layout['moveArray'],struct.pack('<4H',*moves) if not (game in ('B','W') and rule==3) else bytes(8))
  h.invoke('MoveDraw',BIW,PARAM,index=index)
 def letter(i):return getpix(h,31+(i%2)*128,10+(i//2)*48)
 def key(targets,button,cursor=0,index=0):
  rows=bytearray(b'\xff'*12*16);rows[cursor*12:cursor*12+len(targets)]=bytes(targets);rows[cursor*12+10]=button
  c.mem_write(KEYS,bytes(rows));h.put(BIW+layout['state'],cursor<<5)
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
 for rule,slot,edge,bevel in ((1,0,0x14df,0x0c97),(2,1,0x7de4,0x5963)):
  draw(rule);assert [letter(i) for i in range(4)]==[1]*4
  h.put(BIW+layout['selectedActive'],0);c.mem_write(BIW+layout['selectedSlots'],bytes([slot]))
  for index,color in ((8,edge),(10,bevel)):
   for bank in (PAL,TRANS):c.mem_write(bank+((9+slot)*16+index)*2,struct.pack('<H',color))
  before={(15+x,5+y):getpix(h,slot*128+30+x,10+y) for y in range(1,14) for x in range(68)}
  h.invoke('MoveClear',BIW,3);h.put(BIW+layout['screen'],3)
  assert label_mapped and label_text()==before
  assert not any(c.mem_read(PIX,12288))
  selected=struct.unpack('<16H',c.mem_read(PAL+(9+slot)*32,32))
  expected=list(selected);expected[0]=0;expected[7],expected[14]=nativepal[1:3]
  assert palette_entries()==tuple(expected) and (expected[8],expected[10])==(edge,bevel)
  assert [label_pixel(x,y) for x,y in ((1,3),(1,12),(2,12),(3,12),(4,12),(96,12))]==[0,keyline,10,8,12,keyline]
  assert {label_pixel(x,13) for x in range(8,15)}=={3,5}
  if game in ('B2','W2'):
   assert [label_pixel(x,y) for x,y in ((7,3),(48,3),(93,3),(4,21),(48,21),(90,21))]==[6,0,6,6,0,6]
   for y in range(10,15):assert label_pixel(0,y)==0 and label_pixel(1,y)==6
   for y in range(10,15):assert label_pixel(96,y)==6 and label_pixel(97,y)==0
  old_calls=len(calls)
  key([1],1,cursor=3);key([0],0,cursor=2);key([1,3],1)
  assert calls[old_calls:]==['MoveKey']*3 and label_text()==before
  assert palette_entries()==tuple(expected)
  h.invoke('MoveClear',BIW,2 if rule==1 else 0)
  assert calls[-5:]==['MoveWindowUnmap','FooterMap','MoveBgCommit','MoveWindowDelete','MoveClear']
  assert not label_mapped and not label_allocated and palette_entries()==(0,)*16
 c.mem_write(BIW+layout['selectedSlots'],b'\0')
 glyph_bounds=(71,90);glyph_height=11
 draw(1);h.invoke('MoveClear',BIW,3)
 assert set(label_text())=={(x,y) for x in range(34,53) for y in range(7,18)}
 h.invoke('MoveDestroy',BIW);assert not label_mapped and not label_allocated and palette_entries()==(0,)*16
 glyph_bounds=(26,98);glyph_height=13
 draw(1);h.invoke('MoveClear',BIW,3)
 assert label_text()=={(x,y):1 if (x+11+y+4)%3 else 2 for x in range(15,87) for y in range(6,19)}
 h.invoke('MoveClear',BIW,2)
 glyph_bounds=(7,115);glyph_height=16
 draw(2);h.invoke('MoveClear',BIW,3)
 assert set(label_text())=={(x,y) for x in range(15,117) for y in range(6,19)}
 assert [label_pixel(x,6) for x in range(15,117)]==[7 if (x+11)%3 else 14 for x in range(10,112)]
 h.invoke('MoveClear',BIW,2)
 c.mem_write(footer_pix,b'\x01')
 draw(2);h.invoke('MoveClear',BIW,3);h.invoke('MoveClear',BIW,2)
 assert calls[-4:]==['MoveWindowUnmap','MoveBgCommit','MoveWindowDelete','MoveClear']
 assert c.mem_read(footer_pix,192)==b'\x01'+bytes(191)
 c.mem_write(footer_pix,b'\0')
 glyph_bounds=(30,98)
 deny_label=True
 draw(2);h.invoke('MoveClear',BIW,3);assert not label_allocated and palette_entries()==(0,)*16
 h.invoke('MoveClear',BIW,2)
 deny_label=False
 draw(2);c.mem_write(PAL+225*2,b'\x01\x00');h.invoke('MoveClear',BIW,3)
 assert not label_allocated and palette_entries()==(0,1)+(0,)*14
 c.mem_write(PAL+225*2,b'\0\0')
 checks.append('doubles/triples: native frame tiles, corner outline and palette, centered uncut 72x13 glyphs, footer restoration on exit, and safe fallback when the footer is occupied')
 # Every new wrapper preserved callee-saved registers/SP (Harness.invoke) and both stack arguments.
 checks.append('six call-site wrappers preserve original calls, return value, callee-saved registers and fifth/sixth stack arguments')
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
 # Edit the same six constant bytes as the installer; exercise actual compiled
 # loads, all three fade-buffer entries, hardware palette and restore path.
 h.invoke('MoveClear',BIW,2)
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
 checks.append('customized six-byte move-menu color table loads and fades correctly, and all three native palette entries restore')
 assert c.mem_read(h.state+16,1)[0]==0
 return checks
if __name__=='__main__':
 out={'checks':{g:test(g) for g in ('B2','W2')},'release_sha256':{g:hashlib.sha256((HERE/'build'/f'MoveEffectiveness{g}.dll').read_bytes()).hexdigest() for g in ('B2','W2')},'writable_state_bytes':24};(HERE/'build/move-verification.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2))
