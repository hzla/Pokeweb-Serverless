"""Final packaged draw-stage checks. Native GPU submission is a spy, not an emulator."""
from verify_packaged import *
from unicorn import UC_HOOK_CODE
import ndspy.rom,hashlib,sys,math
import json
DLL=PACKAGE_BUILD/'PokewebFollowingFieldW2.dll';ELF=PACKAGE_BUILD/'PokewebFollowingFieldW2.elf'
code,bss,syms,rels,funcs,_=audit(DLL,ELF)
BASE=0x02300000;STOP=0x02008000;STACK=0x023f0000
uc=Uc(UC_ARCH_ARM,UC_MODE_THUMB);uc.ctl_set_cpu_model(UC_CPU_ARM_946);uc.mem_map(0x02000000,0x400000)
uc.mem_write(BASE,bytes(relocate(DLL,BASE,load_dependencies(uc))))
raw=DLL.read_bytes();get=lambda o:struct.unpack_from('<I',raw,o)[0]
h=get(8);info=h+get(h+8);sym=h+get(info+4);first,count=struct.unpack_from('<HH',raw,sym+8);hashat=h+get(sym+16)
exports={get(hashat+i*4):BASE+syms[first+i][2] for i in range(count)}
def addr(name):return BASE+funcs[name][0] if name in funcs else exports[symbol_hash(name)]
def put(p,v):uc.mem_write(p,struct.pack('<I',v&0xffffffff))
def half(p,v):uc.mem_write(p,struct.pack('<H',v&0xffff))
def vec(p,v):uc.mem_write(p,struct.pack('<3i',*v))
def read(p,f):return struct.unpack('<'+f,uc.mem_read(p,struct.calcsize('<'+f)))
def call(name,args):
 for r,v in zip([UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3],args+[0]*4):uc.reg_write(r,v)
 for i,r in enumerate(range(UC_ARM_REG_R4,UC_ARM_REG_R11+1)):uc.reg_write(r,0x12340000+i)
 uc.reg_write(UC_ARM_REG_SP,STACK);uc.reg_write(UC_ARM_REG_LR,STOP|1)
 uc.emu_start(addr(name)|1,STOP,count=500000)
 assert uc.reg_read(UC_ARM_REG_PC)==STOP and uc.reg_read(UC_ARM_REG_SP)==STACK
 for i,r in enumerate(range(UC_ARM_REG_R4,UC_ARM_REG_R11+1)):assert uc.reg_read(r)==0x12340000+i
P=0x02220000;A=P+256;SYS=P+0x1000;FBL=SYS+0x100;BL=SYS+0x200;SCENE=SYS+0x300;SLOTS=SYS+0x400;BILL=SYS+0x500;CAM=SYS+0x600;LIGHT=SYS+0x700
seen=[];expected_args=[BL,CAM,LIGHT]
def spy(u,pc,size,user):
 if pc!=0x0204f684:return
 assert u.reg_read(UC_ARM_REG_SP)%8==0
 assert [u.reg_read(r) for r in [UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2]]==expected_args
 seen.append((read(BILL+28+4,'3i'),read(BILL+28+18,'2h'),read(addr('FollowingRenderDebug')+24,'3i')))
 u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
uc.hook_add(UC_HOOK_CODE,spy,begin=0x0204f684,end=0x0204f684)
F=addr('fwfield_follower')
def setup(size=32,projection=0):
 uc.mem_write(P,bytes(0x2000))
 uc.mem_write(F+51,b'\x00')
 put(addr('fwfield_owner'),SYS);put(addr('fwfield_player'),P);put(F+24,A)
 half(SYS+4,2);put(SYS+28,P);put(SYS+40,FBL);put(FBL+4,BL)
 put(BL+4,SCENE);put(BL+24,SLOTS);half(BL+28,2);put(SLOTS,0);put(SLOTS+40,1)
 put(SCENE+8,BILL);half(SCENE+14,2)
 for i,a in enumerate([P,A]):
  put(a,1);put(a+136,SYS);put(a+140,addr('fwfield_moves'));half(a+196,i)
  half(a+24,2)
  half(BILL+28*i,13+i);half(BILL+28*i+18,8192 if i==0 else size*256);half(BILL+28*i+20,8192 if i==0 else size*256);half(BILL+28*i+24,0x121f)
 uc.mem_write(A+235,bytes([2 if size==64 else 0]));put(CAM,projection)
 vec(CAM+32,(0,200*4096,140*4096));vec(CAM+56,(0,0,0))
 vec(P+68,(0,0,0));vec(A+68,(65536,0,0));vec(BILL+4,(0,0,0))
def draw():
 # Actor state, trail and native billboard values must survive drawing intact.
 before=bytes(uc.mem_read(P,0x2000));trail=bytes(uc.mem_read(F,7300));n=len(seen)
 call('FollowingDraw',[BL,CAM,LIGHT])
 assert len(seen)==n+1
 assert bytes(uc.mem_read(P,0x2000))==before
 assert bytes(uc.mem_read(F,7300))==trail
 return seen[-1]
# The native control-Z byte shifts the model and its native shadow together,
# while logical movement coordinates, other dimensions, and descriptor stay put.
setup();uc.mem_write(A+243,b'\x03')
before=bytes(uc.mem_read(A,256))
for face,expected in ((0,-4),(1,9),(2,3),(3,3)):
 call('fwr_anchor',[A,face]);assert read(A+128,'b')[0]==expected
 after=bytes(uc.mem_read(A,256))
 assert after[:128]==before[:128] and after[129:]==before[129:]
call('fwr_anchor',[0,0])
frames=0
for size in (32,64):
 for projection in (0,1,2):
  setup(size,projection)
  for cycle in range(100):
   for phase in range(20):
    bob=6144 if phase%10<5 else 0
    # Native animation has already produced this frame's final translation.
    vec(BILL+32,(65536-8192,bob,-8192))
    submitted,scales,depth=draw();frames+=1
    assert depth[0]==-1 and depth[2]<=-508,(size,projection,phase,depth)
    assert scales[0]>0 and scales[1]>0
  # Repeated draws without an actor update cannot accumulate any correction.
  one=draw()
  assert all(draw()==one for _ in range(10))
# Different camera yaw, pitch and player control offsets: compare actual final positions.
for eye in [(200*4096,120*4096,0),(-120*4096,210*4096,80*4096),(80*4096,200*4096,-140*4096)]:
 setup();vec(CAM+32,eye)
 # A screen-horizontal baseline perpendicular to the horizontal camera axis.
 length=math.hypot(eye[0],eye[2]);base=(int(65536*eye[2]/length),0,int(-65536*eye[0]/length))
 vec(A+68,base);vec(BILL+32,(base[0],6144,base[2]));vec(BILL+4,(0,1024,0))
 assert draw()[2][2]<=-508
# Stair policies: upper native; lower lateral clamp; foreground stair preserved.
for base,expected in [((65536,65536,0),0),((65536,-32740,0),-2),((0,-65536,65536),1)]:
 setup(64);vec(A+68,base);vec(BILL+32,(base[0],base[1]+6144,base[2]-8192))
 submitted,scales,depth=draw();assert depth[0]==expected,(base,depth)
 if expected==0:assert submitted==(base[0],base[1]+6144,base[2]-8192)
# The registry Y offset must affect the follower quad only. Disable the player
# billboard for this fixture so the depth correction cannot obscure the exact
# five-pixel delta, then verify the native effects pass sees the original pose.
setup();uc.mem_write(F+51,b'\xfb');half(BILL,0x400d)
vec(BILL+32,(65536,6144,0));original=read(BILL+32,'3i')
assert draw()[0]==(original[0],original[1]-5*4096,original[2])
n=len(seen);call('FollowingEffectsDraw',[BL,CAM,LIGHT])
assert len(seen)==n+1 and seen[-1][0]==original
assert read(BILL+32,'3i')==original
# A lowered grounded follower can sit behind its own native shadow plane.
# The main pass must submit its pixels ahead of that plane while restoring the
# original billboard for the later native shadow/effect pass.
setup();put(A+4,0x4000);uc.mem_write(F+51,b'\xfb');half(BILL,0x400d)
vec(BILL+32,(65536,6144,0));original=read(BILL+32,'3i')
submitted=draw()[0];axis=(200/math.hypot(200,140),140/math.hypot(200,140))
assert (submitted[1]*axis[0]+submitted[2]*axis[1])>=6*4096-64,submitted
assert read(BILL+32,'3i')==original
n=len(seen);call('FollowingEffectsDraw',[BL,CAM,LIGHT])
assert len(seen)==n+1 and seen[-1][0]==original
# The upward artwork receives a two-pixel correction relative to the shadow;
# downward and lateral artwork retain their existing registry Y offset.
for face,extra in ((0,-2),(1,0),(2,0),(3,0)):
 setup();uc.mem_write(F+51,b'\xfb');half(BILL,0x400d);half(A+24,face)
 vec(BILL+32,(65536,6144,0));original=read(BILL+32,'3i')
 assert draw()[0]==(original[0],original[1]+(-5+extra)*4096,original[2])
 assert read(BILL+32,'3i')==original
# North-facing movement changed the billboard's ground-plane anchor. The
# packaged main-pass correction must recover its former foreground depth while
# preserving the new on-screen pose and leaving native effect/shadow data alone.
setup();uc.mem_write(F+51,b'\xfa');half(A+24,2)
vec(A+68,(0,0,65536));vec(BILL+32,(0,0,65536-2*4096))
old_depth=draw()[2][1]
setup();uc.mem_write(F+51,b'\xfa');half(A+24,0)
vec(A+68,(0,0,65536));vec(BILL+32,(0,0,65536-9*4096))
new_pose=read(BILL+32,'3i');north=draw();assert north[2][0]==1
assert old_depth<=north[2][2]<old_depth+128,(old_depth,north[2])
assert read(BILL+32,'3i')==new_pose
n=len(seen);call('FollowingEffectsDraw',[BL,CAM,LIGHT])
assert len(seen)==n+1 and seen[-1][0]==new_pose
# Keep the draw-only offset active through the existing depth policies. No
# temporary position or sidecar value may accumulate across repeated draws.
for base in ((65536,0,0),(65536,65536,0),(65536,-32740,0),(0,-65536,65536)):
 setup(64);uc.mem_write(F+51,b'\xfb');vec(A+68,base)
 vec(BILL+32,(base[0],base[1]+6144,base[2]-8192))
 first=draw()
 assert all(draw()==first for _ in range(5))
# Invalid/stale/unsupported objects forward once without mutating the scene.
for invalid in ('hidden','unused','lost','foreign','slot','index','mode','camera','zero-camera','scale'):
 setup();vec(BILL+32,(65536,6144,0))
 if invalid=='hidden':put(A,5)
 if invalid=='unused':put(A,0)
 if invalid=='lost':put(F+24,0)
 if invalid=='foreign':put(A+136,SYS+4)
 if invalid=='slot':half(A+196,2)
 if invalid=='index':put(SLOTS+40,2)
 if invalid=='mode':half(BILL+28,0x400e)
 if invalid=='camera':put(CAM,3)
 if invalid=='zero-camera':vec(CAM+32,(0,0,0))
 if invalid=='scale':half(BILL+46,0)
 expected=read(BILL+32,'3i');assert draw()[0]==expected
# Execute the retail argument-loading blocks with distinct saved scene handles.
# The previous fixture called FollowingDraw directly and missed wrong-pass hooks.
assert 'THUMB_BRANCH_LINK_36_0x0218119a' in funcs,'Missing main actor draw hook (0.6.9 regression)'
rom_path=Path(sys.argv[1]) if len(sys.argv)>1 else HERE.parents[2]/'cleanwhite2.nds'
rom_bytes=rom_path.read_bytes()
assert hashlib.sha256(rom_bytes).hexdigest()==json.loads((HERE/'contract.json').read_text())['target']['sha256']
rom=ndspy.rom.NintendoDSRom(rom_bytes);overlay=rom.loadArm9Overlays([36])[36]
FIELD=0x02210000
for binding in json.loads((HERE/'tests/render-bindings.json').read_text()):
 assert binding['main']==binding['actorSystemBillboards']
 assert binding['main']!=binding['secondary'] and binding['main']!=binding['effects']
 BL=binding['main'];setup(64)
 for offset,value in [(0xc0,BL),(0xc4,binding['secondary']),(0xc8,binding['effects']),(0xb4,CAM),(0xb8,LIGHT)]:put(FIELD+offset,value)
 vec(BILL+32,(65536,6144,0))
 for start,site,stop,handle in [(0x2181188,0x218119a,0x218119e,BL),(0x218121c,0x218122e,0x2181232,binding['secondary']),(0x218119e,0x21811b0,0x21811b4,binding['effects'])]:
  stub='THUMB_BRANCH_LINK_36_'+f'0x{site:08x}'
  uc.mem_write(start,bytes(overlay.data[start-overlay.ramAddress:stop-overlay.ramAddress]))
  if site!=0x21811b0:
   target=addr(stub)&~1;relative=target-(site+4)
   assert -(1<<22)<=relative<(1<<22)
   uc.mem_write(site,struct.pack('<HH',0xf000|((relative>>12)&0x7ff),0xf800|((relative>>1)&0x7ff)))
  uc.ctl_remove_cache(start,stop)
  uc.reg_write(UC_ARM_REG_R5,FIELD);uc.reg_write(UC_ARM_REG_SP,STACK)
  expected_args=[handle,CAM,LIGHT]
  before=bytes(uc.mem_read(BILL,56));n=len(seen)
  uc.emu_start(start|1,stop,count=500000)
  assert uc.reg_read(UC_ARM_REG_PC)==stop and uc.reg_read(UC_ARM_REG_SP)==STACK
  assert uc.reg_read(UC_ARM_REG_R5)==FIELD and len(seen)==n+1
  assert bytes(uc.mem_read(BILL,56))==before
  if handle==BL:assert seen[-1][2][0]==-1 and seen[-1][2][2]<=-508
  else:assert seen[-1][0]==(65536,6144,0),'Secondary pass must not alter actor scene'
print('Retail pass routing passed: main actor correction and unchanged secondary/effect ownership for three saved scene bindings.')
print(f'Render checks passed: {frames} packaged submission frames, both sizes, all supported projection types, current animation/control offsets, rotated cameras, stairs, restoration, repeated draws, invalid handles and ABI. GPU draw is a spy; no emulator execution.')
