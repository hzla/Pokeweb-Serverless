"""Execute the final packaged interaction DLL on ARM946 with native-service spies.
This checks controller/ABI/resource ownership; it is not a game-emulator test.
"""
from verify_packaged import *
from unicorn import UC_HOOK_CODE
import collections,json,os,ndspy.narc,zlib
CYCLES=int(os.environ.get("FOLLOWING_TEST_CYCLES","100"))
DLL=PACKAGE_BUILD/'PokewebFollowingFieldW2.dll';ELF=PACKAGE_BUILD/'PokewebFollowingFieldW2.elf'
code,bss,syms,rels,funcs,_=audit(DLL,ELF)
BASE=0x02300000;STOP=0x02008000;STACK=0x023f0000
uc=Uc(UC_ARCH_ARM,UC_MODE_THUMB);uc.ctl_set_cpu_model(UC_CPU_ARM_946);uc.mem_map(0x02000000,0x400000)
loaded=relocate(DLL,BASE,load_dependencies(uc))
uc.mem_write(BASE,bytes(loaded))
# Resolve exported state by the exact RPM hash table; functions retain text offsets.
raw=DLL.read_bytes();get=lambda o:struct.unpack_from('<I',raw,o)[0]
h=get(8);info=h+get(h+8);sym=h+get(info+4);first,count=struct.unpack_from('<HH',raw,sym+8);hashat=h+get(sym+16)
exports={get(hashat+i*4):BASE+syms[first+i][2] for i in range(count)}
def addr(name):
 if name in funcs:return BASE+funcs[name][0]
 hash=0x811c9dc5
 for c in name:hash=((hash^ord(c))*16777619)&0xffffffff
 return exports[hash]
def put(p,v):uc.mem_write(p,struct.pack('<I',v&0xffffffff))
def u32(p):return struct.unpack('<I',uc.mem_read(p,4))[0]
def half(p,v):uc.mem_write(p,struct.pack('<H',v))
def cstr(p):return bytes(uc.mem_read(p,100)).split(b'\0')[0].decode()
def call(name,args=()):
 args=list(args)
 for reg,value in zip([UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3],args+[0]*4):uc.reg_write(reg,value)
 for i,reg in enumerate(range(UC_ARM_REG_R4,UC_ARM_REG_R11+1)):uc.reg_write(reg,0x12340000+i)
 for i,v in enumerate(args[4:]):put(STACK+i*4,v)
 uc.reg_write(UC_ARM_REG_SP,STACK);uc.reg_write(UC_ARM_REG_LR,STOP|1)
 try:uc.emu_start((addr(name) if isinstance(name,str) else name)|1,STOP,count=2000000)
 except Exception:
  print("CPU failure",name,"PC",hex(uc.reg_read(UC_ARM_REG_PC)),"SP",hex(uc.reg_read(UC_ARM_REG_SP)),"r0-r3",[hex(uc.reg_read(x)) for x in range(UC_ARM_REG_R0,UC_ARM_REG_R3+1)]);raise
 assert uc.reg_read(UC_ARM_REG_PC)==STOP,(name,'did not return',hex(uc.reg_read(UC_ARM_REG_PC)))
 assert uc.reg_read(UC_ARM_REG_SP)==STACK
 for i,reg in enumerate(range(UC_ARM_REG_R4,UC_ARM_REG_R11+1)):assert uc.reg_read(reg)==0x12340000+i,(name,'callee saved')
 return uc.reg_read(UC_ARM_REG_R0)
F=0x02200000;P=0x02203000;A=P+0x100;SYS=P+0x200;FIELD=0x02204000;GAME=0x02205000;SNAP=0x02206000;BG=0x02207000;EVENT=0x02208000;STRING=EVENT+0x100;FOREIGN=EVENT+0x200
scene=0x02209000;bill=scene+0x100;mat=scene+0x200;bl=scene+0x300;fieldbl=scene+0x400;indices=scene+0x500
GAMEDATA=0x0220a000;PARTY=GAMEDATA+0x100;BAG=GAMEDATA+0x200;MON=GAMEDATA+0x300;BLOCK_C=MON+0x48
def gift_archive():
 name=[*map(ord,'Master Ball'),0xffff];message=[0xfff0,*map(ord,' found a '),0xfff3,ord('!'),0xffff]
 member=bytearray(16+28+(len(name)+len(message))*2);name_at=44;text_at=name_at+len(name)*2
 struct.pack_into('<IHHI',member,0,0x49545746,1,1,len(member))
 struct.pack_into('<HHHBBBBBBBBIHIHH',member,16,427,151,1,0,255,255,0,0,0,0,1,name_at,len(name),text_at,len(message),0)
 for at,words in ((name_at,name),(text_at,message)):
  for i,word in enumerate(words):struct.pack_into('<H',member,at+i*2,word)
 struct.pack_into('<I',member,12,zlib.crc32(member[16:])&0xffffffff)
 narc=ndspy.narc.NARC();narc.files=[bytes(member)];return narc.save()
assets={"rom:/following/interactions.bin":(HERE.parents[1]/'src/assets/following/interactions.bin').read_bytes(),"rom:/following/emotes.narc":(HERE.parents[1]/'src/assets/following/interaction-emotes.narc').read_bytes(),"rom:/following/contextual-items.narc":gift_archive()}
files={};calls=[];alloc=[];frees=[];held=pressed=0;free_bytes=131072;provider=0;controller=0;blocked=0;fail='';resource_counter=0;print_done=1;close_done=1
native_addresses={0x02070ca8,0x02070ecc,0x02070dec,0x02070e6c,0x02070de0,0x0203a2d4,0x02180578,0x02195728,0x0219a9d0,0x0219aacc,0x0215e4f0,0x02016cb4,0x02016d08,0x02167098,0x0219a5d8,0x0203df4c,0x0203df28,0x02005cbc,0x020069f4,0x02006b5c,0x021804d0,0x02180500,0x0204855c,0x02048590,0x02048640,0x021887d8,0x02188814,0x02188834,0x02188858,0x021888c4,0x02188a08,0x020493f0,0x02049430,0x02049560,0x0204e598,0x0204e55c,0x0204ebdc,0x0218151c,0x02181aa0,0x02017354,0x0201735c,0x0201fe24,0x0201ff34,0x0201cd24,0x0201ccc4,0x0201ccec,0x0201eef0,0x02008238,0x02008268}
bag_adds=[]
def native(u,pc,size,user):
 global resource_counter
 if pc not in native_addresses:return
 assert u.reg_read(UC_ARM_REG_SP)%8==0,hex(pc)
 r=[u.reg_read(x) for x in [UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3]];r0,r1,r2,r3=r;calls.append((pc,*r));result=1
 if pc==0x02070ecc:
  path=cstr(r1);result=int(path in assets and fail!='data');files[r0]=[path,0]
 if pc==0x02070dec:result=len(assets[files[r0][0]])
 if pc==0x02070e6c:
  path,off=files[r0];content=assets[path][off:off+r2];u.mem_write(r1,content);files[r0][1]+=len(content);result=len(content)
 if pc==0x0203a2d4:result=free_bytes
 if pc==0x02017354:assert r0==GAMEDATA;result=BAG
 if pc==0x0201735c:result=PARTY if r0==GAMEDATA else 0
 if pc==0x0201fe24:result=1 if r0==PARTY else 0
 if pc==0x0201ff34:result=MON if r0==PARTY and r1==0 else 0
 if pc==0x0201cd24:
  result={0:123,7:456,5:151,0x6f:0,0x4c:0}.get(r1,0) if r0==MON and r2==0 else 0
 if pc==0x0201ccc4:result=1
 if pc==0x0201ccec:result=1
 if pc==0x0201eef0:assert r2==2;result=BLOCK_C if r0==MON else r0+0x48
 if pc==0x02008238:assert r0==BAG and r1==1 and r2==1 and r3==4;result=int(fail!='bag-full')
 if pc==0x02008268:assert r0==BAG and r1==1 and r2==1 and r3==4;bag_adds.append((r1,r2));result=int(fail!='bag-add')
 if pc==0x02180578:result=controller
 if pc==0x0219aacc:
  direction=struct.unpack('<H',u.mem_read(P+24,2))[0];x,z=10,10
  if direction<2:z+=-1 if direction==0 else 1
  else:x+=-1 if direction==2 else 1
  half(r1,x);half(r2,0);half(r3,z)
 if pc in (0x0215e4f0,0x02195728):result=blocked
 if pc==0x0219a9d0:
  x,y,z=struct.unpack('<iii',u.mem_read(P+68,12));dx,dz={0:(0,-65536),1:(0,65536),2:(-65536,0),3:(65536,0)}[r1]
  if controller==2:dx,dz=-dz,dx
  u.mem_write(r2,struct.pack('<iii',x+dx,y,z+dz))
 if pc==0x02016cb4:
  assert r0==GAME and r1==0 and r3==4
  result=0 if fail=='event' else EVENT
  if result:u.mem_write(EVENT,struct.pack('<5I',0,r2,0,EVENT+0x20,GAME));alloc.append(('event',EVENT))
 if pc==0x02016d08:frees.append(('event',r0))
 if pc==0x02167098:half(r0+24,r1)
 if pc==0x0203df4c:result=held
 if pc==0x0203df28:result=pressed
 if pc==0x02005cbc:result=int(fail=='sound')
 if pc==0x020069f4:assert r0==struct.unpack("<H",u.mem_read(SNAP,2))[0] and r1==0;result=2
 if pc==0x02006b5c:assert r0==2 and r1==(-2143&0xffffffff)
 if pc==0x021804d0:result=0 if fail=='bg' else BG
 if pc==0x02180500:result=11
 if pc==0x0204855c:
  result=0 if fail=='string' else STRING
  if result:alloc.append(('string',result))
 if pc==0x02048590:frees.append(('string',r0))
 if pc==0x02048640:
  text=struct.unpack('<192H',u.mem_read(r1,384));assert 0xffff in text;assert 0xfff0 not in text[:text.index(65535)];u.mem_write(r0,bytes(u.mem_read(r1,(text.index(65535)+1)*2)))
 if pc==0x021887d8:
  assert r0==BG and r1==1 and r3==STRING;result=0 if fail=='window' else BG+0xf4
  if result:alloc.append(('window',result));put(result+8,BG+0x200)
 if pc==0x021888c4:result=print_done
 if pc==0x02188834:
  result=close_done
  if result:frees.append(('window',r0));put(r0+8,0)
 if pc==0x02188858:frees.append(('window',r0));put(r0+8,0)
 if pc==0x020493f0:
  assert cstr(r0)=='rom:/following/emotes.narc' and r1<14
  resource_counter+=1;result=0 if fail=='emote' else 0x02220000+(resource_counter%100)*0x100
  if result:alloc.append(('resource',result))
 if pc==0x02049430:frees.append(('resource',r0))
 if pc==0x0204e598:assert r1==0 and r2==0x22 and r3==32 and u32(u.reg_read(UC_ARM_REG_SP))==32
 if pc==0x0204e55c:put(r0+32,0 if fail=='vram' else 1);put(r0+36,1)
 if pc in (0x0218151c,0x02181aa0):result=provider
 u.reg_write(UC_ARM_REG_R0,result);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
uc.hook_add(UC_HOOK_CODE,native)
def setup(direction=0,species=25,zone=0,reset_mon=True):
 global held,pressed
 assert not call('fwt_active')
 held=pressed=0;call('fwt_poll_input')
 uc.mem_write(F,bytes(1852));put(F,2);put(F+20,1);put(F+24,A)
 uc.mem_write(P,bytes(0x300));put(P,1|8192);put(P+148,P+0x600);put(A,1|128|256|32768);put(P+136,SYS);put(A+136,SYS);put(A+140,addr('fwfield_moves'));half(P+24,direction)
 x,z=10*65536,10*65536;ax=x+(-65536 if direction==2 else 65536 if direction==3 else 0);az=z+(-65536 if direction==0 else 65536 if direction==1 else 0)
 uc.mem_write(P+68,struct.pack('<iii',x,0,z));uc.mem_write(A+68,struct.pack('<iii',ax,0,az));uc.mem_write(A+60,struct.pack('<hhh',ax//65536,0,az//65536))
 for i,(sx,sz) in enumerate([(ax,az),(x,z)]):uc.mem_write(F+52+i*28,struct.pack('<iiiIIHHBBH',sx,0,sz,1,1,0,0,0,3,1))
 half(F+52+64*28+6,2);put(FIELD+8,GAMEDATA);put(FIELD+0x94,P+0x400);put(FIELD+0x148,0);put(GAME+0x18,0)
 uc.mem_write(SNAP,struct.pack('<H4BHH2xIIIH4B12H9H',species,0,0,0,0,100,100,123,456,0,zone,100,direction^1,0,0,*([ord('P'),ord('i'),ord('k'),ord('a')]+[65535]*8),*([ord('U')]+[65535]*8)))
 if reset_mon:uc.mem_write(MON,bytes(0x100));put(MON,123);half(MON+4,2)
 put(BG+0x15c,BG+0x200);put(BG+0xfc,0)
 put(SYS+0x28,fieldbl);put(fieldbl+4,bl);put(bl+4,scene);put(bl+0x18,indices);half(bl+0x1c,1);put(indices,0)
 put(scene+4,mat);put(scene+8,bill);half(scene+12,1);half(scene+14,1)
 uc.mem_write(bill,bytes(28));held=pressed=1
 return bytes(uc.mem_read(A+68,12)),bytes(uc.mem_read(F+52,64*28+8))
def begin():
 event=call('fwt_begin',[F,P,A,FIELD,GAME,SNAP])
 if event:put(GAME+0x18,event)
 return event
def stage():return u32(addr('FollowingTalkDebug')+12)
def tick():
 global held,pressed
 done=call(u32(EVENT+4),[EVENT,EVENT+8,EVENT+0x20])
 if done:put(GAME+0x18,0);frees.append(('event',EVENT))
 return done
def balanced():assert collections.Counter(alloc)==collections.Counter(frees),(collections.Counter(alloc)-collections.Counter(frees),collections.Counter(frees)-collections.Counter(alloc))
# Actual branch veneers forward native providers and leave retail event priority intact.
provider=FOREIGN
for name,args in [('THUMB_BRANCH_LINK_36_0x021818bc',[GAME,FIELD,SNAP,SNAP+4]),('THUMB_BRANCH_LINK_36_0x02181a6c',[GAME,FIELD])]:assert call(name,args)==FOREIGN
provider=0
# A matching one-time gift must use Field::GameData for both Party and Bag
# adapters, set the per-Pokemon claim bit, and then fall through on repetition.
setup(0,151,427);fail='bag-full';assert begin()==EVENT
gift_debug=addr('FollowingGiftDebug');assert u32(gift_debug+36)==0 and not bag_adds and not (struct.unpack('<H',uc.mem_read(BLOCK_C+0x1e,2))[0]&1)
call('fwt_cancel');balanced();fail=''
setup(0,151,427);fail='bag-add';assert begin()==EVENT
assert u32(gift_debug+36)==0 and bag_adds==[(1,1)] and not (struct.unpack('<H',uc.mem_read(BLOCK_C+0x1e,2))[0]&1)
call('fwt_cancel');balanced();fail='';bag_adds.clear()
setup(0,151,427);assert begin()==EVENT
gift_values=[u32(gift_debug+i*4) for i in range(12)];assert gift_values[5]==1 and gift_values[7]==1 and gift_values[9]==1,gift_values
assert bag_adds==[(1,1)] and (struct.unpack('<H',uc.mem_read(BLOCK_C+0x1e,2))[0]&1)
call('fwt_cancel');balanced();setup(0,151,427,False);assert begin()==EVENT
assert bag_adds==[(1,1)] and u32(gift_debug+24)&1 and not u32(gift_debug+28)
call('fwt_cancel');balanced()
for direction in range(4):
 setup(direction);assert call('fwt_reach',[F,P,A,FIELD])==1
 blocked=1;assert not call('fwt_reach',[F,P,A,FIELD]);blocked=0
 put(A+72,65536);assert not call('fwt_reach',[F,P,A,FIELD]);put(A+72,0)
# Wider lateral gap stays talkable from either side without relaxing walls,
# elevation, native adjacent tiles, or straight connected-trail requirements.
for direction in (2,3):
 setup(direction);uc.mem_write(F+50,b'\6');sign=-1 if direction==2 else 1
 for gap in (22,23):
  x,z=10*65536+32768,10*65536+32768;ax=x+sign*gap*4096
  uc.mem_write(P+68,struct.pack('<iii',x,0,z));uc.mem_write(A+68,struct.pack('<iii',ax,0,z))
  uc.mem_write(A+60,struct.pack('<hhh',ax//65536,0,z//65536))
  for i,sx in enumerate((ax,x)):uc.mem_write(F+52+i*28,struct.pack('<iiiIIHHBBH',sx,0,z,1,1,0,0,0,3,1))
  assert call('fwt_reach',[F,P,A,FIELD])==1
  blocked=1;assert not call('fwt_reach',[F,P,A,FIELD]);blocked=0
 put(A+68,x+sign*24*4096);assert not call('fwt_reach',[F,P,A,FIELD])
# Vertical reach does not expand with the lateral spacing.
setup(0);put(A+76,10*65536-22*4096);assert not call('fwt_reach',[F,P,A,FIELD])
# Rail keys rotated 90 degrees relative to world compass still address the follower.
setup(0);controller=2
uc.mem_write(A+68,struct.pack('<iii',11*65536,0,10*65536))
uc.mem_write(F+52,struct.pack('<iii',11*65536,0,10*65536))
assert call('fwt_reach',[F,P,A,FIELD])==1
blocked=3;assert not call('fwt_reach',[F,P,A,FIELD]);blocked=0
assert begin();assert struct.unpack('<H',uc.mem_read(A+24,2))[0]==2;call('fwt_cancel');balanced();controller=0
# Exercise both frames of all seven private resources, without changing native material data.
setup();shared=bytes(uc.mem_read(mat,40))+bytes(uc.mem_read(bill,28))
for member in range(0,14,2):
 assert call('fwfx_emote_begin',[A,member])
 for frame in (0,1,0,1):call('fwfx_emote_frame',[A,frame]);call('fwfx_draw',[0x02210000,0x02211000])
 call('fwfx_emote_end');balanced()
assert bytes(uc.mem_read(mat,40))+bytes(uc.mem_read(bill,28))==shared
# 100 complete simulated conversations; input must be released before dismissal.
visited=set();reactions=set()
for i in range(CYCLES):
 world,trail=setup(i%4,([25,649,650,722,810,1023] if os.environ.get("FOLLOWING_PROFILE")=="white2upgrade" else [25,649])[i%(6 if os.environ.get("FOLLOWING_PROFILE")=="white2upgrade" else 2)]);controller=i%2;assert begin()==EVENT
 assert call('fwt_owns',[FIELD]);assert not begin()
 reactions.add(u32(addr('FollowingTalkDebug')+16))
 for frame in range(2000):
  if stage()==6:held=pressed=1 if frame%3==0 else 0
  else:held=pressed=0
  done=tick();visited.add(stage())
  if done:break
 else:raise AssertionError('stuck controller')
 assert not call('fwt_active');assert u32(F)==2
 held=pressed=1;assert not begin();call('fwt_poll_input');assert not begin()
 assert bytes(uc.mem_read(A+68,12))==world and bytes(uc.mem_read(F+52,64*28+8))==trail
 assert bytes(uc.mem_read(A+80,12))==bytes(12);balanced()
assert visited==set(range(9)),visited
# Cancel during each observed stage, including nested foreign event, reused actor, generation and fade.
for target in range(9):
 for interruption in ('cancel','nested','actor','generation','fade'):
  setup();assert begin()
  for frame in range(2000):
   held=pressed=1 if stage()==6 and frame%3==0 else 0
   if stage()==target:break
   if tick():setup();assert begin()
  else:raise AssertionError(('stage not reached',target))
  if interruption=='nested':put(FOREIGN,EVENT);put(GAME+0x18,FOREIGN)
  if interruption=='actor':put(A+140,0)
  if interruption=='generation':put(F+20,2)
  if interruption=='fade':put(FIELD+0x148,1);assert tick()
  else:call('fwt_cancel')
  assert not call('fwt_active')
  if interruption=='nested':assert u32(GAME+0x18)==FOREIGN and u32(FOREIGN)==0
  call('fwt_cancel');balanced()
# Native close failing to complete is bounded and cleaned up once.
setup();assert begin();close_done=0
for frame in range(2000):
 held=pressed=1 if stage()==6 and frame%3==0 else 0
 if tick():break
else:raise AssertionError('close timeout stuck')
close_done=1;balanced()
# Allocation/message failures cancel; unavailable emotes/cry are optional.
for failure in ('event','bg','string','window','emote','vram','sound'):
 setup();fail=failure
 event=begin()
 if event:
  for frame in range(2000):
   held=pressed=1 if stage()==6 and frame%3==0 else 0
   if tick():break
  else:raise AssertionError(('failure stuck',failure))
 assert not call('fwt_active');balanced();fail=''
call('fwt_unload');setup();fail='data';assert not begin();balanced()
print(f'Packaged interaction checks passed: ABI, priority veneers, four-direction reach, blocked/elevation rejection, {len(reactions)} randomly selected rules, {CYCLES} simulated conversations, all 9 interruption stages, nested event ownership and resource failures. Native services mocked; no DS game run.')
