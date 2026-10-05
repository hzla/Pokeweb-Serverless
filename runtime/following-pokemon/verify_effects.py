"""Compiled effect logic with mocked native services. Does not run a DS game."""
from verify_field import *
import collections,hashlib,json,math,ndspy.narc
HERE=Path(__file__).resolve().parent
# Battle effects begin at ID 561. Effect 619/member 58 is Sunny Day (SE 1565),
# 620/member 59 is switch-out return, and 621/member 60 is send-out. Check the
# clean US White 2 ROM scripts so an off-by-one effect ID cannot select weather.
battle_effects=rom.files[413]
assert battle_effects[:4]==b'NARC'
fat=battle_effects.index(b'BTAF');data=battle_effects.index(b'GMIF')
def battle_member(index):
 start,end=struct.unpack_from('<II',battle_effects,fat+12+index*8)
 return battle_effects[data+8+start:data+8+end]
for effect_id,member,offset,sound,digest in (
 (619,58,0x68,1565,'6f8fd06c518544e2285b66925169ef96a53c0d4f35ce24a3de48fc9cc64a5fdb'),
 (620,59,0x1ae,1383,'f6133e130d7e30b38f1147d7e6c99030f8dc794fc870459bb53d9f02af92a179'),
 (621,60,0x190,1383,'99176e07ba99c6a18b535c8f8b94f3b39e372645792fb965ed739080ec81b700')):
 assert member==effect_id-561
 effect=battle_member(member)
 assert hashlib.sha256(effect).hexdigest()==digest
 assert struct.unpack_from('<HI',effect,offset)==(52,sound),'Unexpected stock battle SE_PLAY command'
uc.hook_del(spy_hook)
asset=(Path(__file__).resolve().parents[2]/'src/assets/following/hgss-effects.narc').read_bytes()
calls=[];allocations=[];frees=[];renders=[];sounds=[];file_ok=True;counter=0;free_bytes=131072
PALETTE=0x02290000
body_texture=0x02298000;emote_texture=0x02299000;resource_paths={};emote_poses=[];checking_emote=False
def u32(at):return struct.unpack('<I',uc.mem_read(at,4))[0]
def put(at,value):uc.mem_write(at,struct.pack('<I',value))
def cstr(at):return bytes(uc.mem_read(at,100)).split(b'\0')[0].decode()
def native(u,address,size,user):
 global counter
 if address not in {0x2006254,0x203a2d4,0x2070ca8,0x2070ecc,0x2070dec,0x2070e6c,0x2070de0,
  0x20493f0,0x2049430,0x20494d8,0x2049560,0x204964c,0x20652e4,0x204974c,
  0x2049758,0x2049800,0x2049838,0x20498b4,0x20498e4,0x2049960,0x20499a0,
  0x2049a10,0x2049b88,0x204e55c,0x204ebdc,0x204f684}:return
 assert u.reg_read(UC_ARM_REG_SP)%8==0,hex(address)
 r0,r1,r2=[u.reg_read(r) for r in [UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2]]
 calls.append((address,r0,r1,r2));result=1
 if address==0x2006254:sounds.append(r0)
 if address==0x203a2d4:result=free_bytes
 if address==0x2070ecc:
  assert cstr(r1)=='rom:/following/effects.narc';result=int(file_ok)
 if address==0x2070dec:result=len(asset)
 if address==0x2070e6c:assert r2==len(asset);u.mem_write(r1,asset);result=r2
 if address in {0x20493f0,0x2049758,0x2049838,0x20498e4}:
  counter+=1;result=0x02280000+counter*0x100;allocations.append(result)
  if address==0x20493f0:
   assert cstr(r0) in ('rom:/following/effects.narc','rom:/a/0/4/8','rom:/following/emotes.narc')
   resource_paths[result]=cstr(r0)
   if cstr(r0)=='rom:/a/0/4/8':assert r1==981,(r1,cstr(r0))
 if address in {0x2049430,0x2049800,0x20498b4,0x2049960}:frees.append(r0)
 if address==0x204964c:result=emote_texture if resource_paths.get(r0)=='rom:/following/emotes.narc' else body_texture
 if address==0x20652e4:result=32
 if address==0x204974c:result=PALETTE
 if address==0x204e55c:
  put(r0,r1);put(r0+12,0x18000);put(r0+16,0x600);put(r0+32,0x10003000);put(r0+36,0x400000c0)
 if address==0x204ebdc:
  mat=u32(r0+4);bill=u32(r0+8)
  assert u32(mat+12)==0x18000 and u32(mat+16)==0x600
  flags=struct.unpack('<H',u.mem_read(bill+24,2))[0]
  assert flags&0x0200 and flags&0xf000==0x1000,'Recall lost visibility or map lighting'
  renders.append(('white',struct.unpack('<hh',u.mem_read(bill+18,4))))
  if checking_emote:emote_poses.append(struct.unpack('<3i',u.mem_read(bill+4,12)))
 if address==0x2049b88:renders.append(('model',r0))
 if address==0x2049a10:renders.append(('frame',u32(r2)))
 u.reg_write(UC_ARM_REG_R0,result);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
uc.hook_add(UC_HOOK_CODE,native)
def invoke(name,args=()):return call(symbols[name],args)
def debug():return struct.unpack('<8I',uc.mem_read(symbols['FollowingEffectsDebug'],32))
# Read real I4 nibbles, including a frame whose only visible pixel has index
# one in the upper nibble. Reject malformed lengths before scanning any data.
texture=0x022a0000;bounds=texture+20000
for size in (32,64):
 for frames in (1,6,8):
  length=size*size*frames//2;uc.mem_write(texture,bytes(20000))
  put(texture,0x30584554);put(texture+4,64+length);put(texture+20,64)
  uc.mem_write(texture+12,struct.pack('<H',length//8))
  expected=[]
  for frame in range(frames):
   top,bottom=3+frame,size-4-frame;expected.append((top,bottom))
   for y in (top,bottom):uc.mem_write(texture+64+frame*size*size//2+y*size//2,b'\x10')
  assert invoke('fwfx_outline',[texture,size,bounds,bounds+8])==frames
  assert list(zip(uc.mem_read(bounds,frames),uc.mem_read(bounds+8,frames)))==expected
  put(texture+4,64+length-1)
  assert not invoke('fwfx_outline',[texture,size,bounds,bounds+8])
assert not invoke('fwfx_outline',[texture,16,bounds,bounds+8])
actor=0x02210000;uc.mem_write(actor,bytes(256));put(actor+136,system)
uc.mem_write(actor+228+16,struct.pack('<H',981));put(system+40,0x02240000)
put(0x02240004,0x02241000);put(0x02241004,0x02242000);put(0x02241018,0x02245000)
uc.mem_write(0x0224101c,struct.pack('<H',1));put(0x02245000,0)
scene=0x02242000;mat=0x02243000;bill=0x02244000
put(scene+4,mat);put(scene+8,bill);uc.mem_write(scene+12,struct.pack('<HH',1,1))
uc.mem_write(mat,bytes(range(40)));uc.mem_write(bill,struct.pack('<HHiiiHhhHHH',0,0,100,200,300,1,4096,4096,0,0x121f,0))
original=bytes(uc.mem_read(mat,40))+bytes(uc.mem_read(bill,28))
# Missing effects and low memory are cosmetic failures, with no native allocations.
file_ok=False;invoke('fwfx_prepare',[actor]);assert not allocations
invoke('fwfx_out',[actor]);assert not invoke('fwfx_busy')
assert not sounds,'Unavailable effects must not play an orphan ball cue'
invoke('fwfx_destroy');file_ok=True;free_bytes=1000
invoke('fwfx_prepare',[actor]);assert not allocations
free_bytes=131072;uc.mem_write(PALETTE,bytes(range(32)))
invoke('fwfx_set_resource_count',[975])
invoke('fwfx_prepare',[actor]);assert debug()[7]==0
assert not any(x[0]==0x20493f0 and cstr(x[1])=='rom:/a/0/4/8' for x in calls)
invoke('fwfx_set_resource_count',[1323])
invoke('fwfx_prepare',[actor]);assert debug()[6]==1
assert any(x[0]==0x20493f0 and cstr(x[1])=='rom:/a/0/4/8' and x[2]==981 for x in calls)
palette=struct.unpack('<16H',uc.mem_read(PALETTE,32))
assert set(palette)=={0x7f93,0x7fff} and palette[0]==0x7f93,palette
invoke('fwfx_snapshot',[actor]);assert debug()[7]==1
baseline=len(calls);allocated=len(allocations)
for _ in range(20):invoke('fwfx_prepare',[actor]);invoke('fwfx_snapshot',[actor])
assert len(allocations)==allocated
assert not any(x[0] in {0x204e55c,0x20494d8} for x in calls[baseline:]),'repeated VRAM uploads'
# Ball stays visible two ticks, then all eight animation frames; no allocation.
invoke('fwfx_out',[actor]);renders.clear()
assert not sounds,'Send-out cue belongs to ball opening, not effect setup'
for age in range(10):
 assert bool(invoke('fwfx_hides_actor'))==(age<2)
 invoke('fwfx_draw',[0x2221000,0x2222000]);invoke('fwfx_tick')
 if age==0:assert not sounds
 if age>=1:assert sounds==[1383],sounds
assert not invoke('fwfx_busy')
assert [v for tag,v in renders if tag=='frame']==[n*4096 for n in range(8)]
# Snapshot owns the recall image after the field actor has gone away.
invoke('fwfx_recall',[actor]);uc.mem_write(actor,bytes(256));renders.clear()
assert sounds==[1383,1383],sounds
invoke('fwfx_recall',[actor]);assert sounds==[1383,1383],'Repeated recall restarted its cue'
assert invoke('fwfx_recalling')
for _ in range(12):invoke('fwfx_draw',[0x2221000,0x2222000]);invoke('fwfx_tick')
assert sounds==[1383,1383],'Per-frame recall replayed sound'
assert [v for tag,v in renders if tag=='white']==[(n,n) for n in (4096,4096,4096,3440,2784,2112,1456,768)]
assert len([x for x in renders if x[0]=='model'])==4 and not invoke('fwfx_busy')
assert not invoke('fwfx_recalling')
assert bytes(uc.mem_read(mat,40))+bytes(uc.mem_read(bill,28))==original
assert len(allocations)==allocated
# If a sprite snapshot is unavailable, the already-loaded ball remains visible
# throughout the recall instead of leaving eight empty frames.
put(symbols['fwfx']+52,0)
invoke('fwfx_recall',[actor]);renders.clear()
assert sounds==[1383,1383,1383],'Ball-only fallback lost its return cue'
for _ in range(12):invoke('fwfx_draw',[0x2221000,0x2222000]);invoke('fwfx_tick')
assert len([x for x in renders if x[0]=='model'])==12
assert not [x for x in renders if x[0]=='white']
invoke('fwfx_destroy');invoke('fwfx_destroy')
assert collections.Counter(allocations)==collections.Counter(frees),(allocations,frees)
assert debug()[6:]==(0,0) and not invoke('fwfx_busy')
uc.mem_write(actor,bytes(256));put(actor+136,system)
uc.mem_write(actor+228+16,struct.pack('<H',981))
previous_loads=sum(x[0]==0x20493f0 and cstr(x[1])=='rom:/a/0/4/8' for x in calls)
invoke('fwfx_prepare',[actor])
assert sum(x[0]==0x20493f0 and cstr(x[1])=='rom:/a/0/4/8' for x in calls)==previous_loads+1,'field-owner change lost validated resource bound'
invoke('fwfx_destroy');invoke('fwfx_set_resource_count',[0])
assert collections.Counter(allocations)==collections.Counter(frees),(allocations,frees)
assert sounds==[1383,1383,1383],'Teardown replayed sound'
# Drive the actual prepared texture -> cached bounds -> emote draw path with
# shipped 32/64px art. Read opaque pixels independently from the source atlas.
followers=ndspy.narc.NARC((HERE.parents[1]/'src/assets/following/gen5-followers.narc').read_bytes())
emotes=ndspy.narc.NARC((HERE.parents[1]/'src/assets/following/interaction-emotes.narc').read_bytes())
camera=0x02221000;uc.mem_write(camera,bytes(80));uc.mem_write(camera+32,struct.pack('<3i',0,200*4096,140*4096))
up=(0,140/math.hypot(200,140),-200/math.hypot(200,140))
body_texture=0x022a0000;emote_texture=0x022b0000
def pixels(resource):
 at=resource.index(b'TEX0');block=resource[at:]
 start=struct.unpack_from('<I',block,20)[0];length=struct.unpack_from('<H',block,12)[0]*8
 return block,block[start:start+length]
emote_block,emote_pixels=pixels(emotes.files[0]);uc.mem_write(emote_texture,emote_block)
bubble_bottom=max(i//16 for i,value in enumerate(emote_pixels) if value)
checking_emote=True
for size,member in ((32,6),(64,314)):
 invoke('fwfx_destroy');invoke('fwfx_set_resource_count',[1323])
 block,art=pixels(followers.files[member]);uc.mem_write(body_texture,block)
 uc.mem_write(actor,bytes(256));put(actor+136,system);uc.mem_write(actor+244,struct.pack('<H',981))
 uc.mem_write(actor+235,bytes([2 if size==64 else 0]))
 uc.mem_write(bill,struct.pack('<HHiiiHhhHHH',0,0,0,0,0,0,size*256,size*256,0,0x121f,0))
 invoke('fwfx_prepare',[actor]);assert invoke('fwfx_emote_begin',[actor,0])
 allocated=len(allocations);loads=len(calls)
 for frame in range(len(art)//(size*size//2)):
  pose=art[frame*size*size//2:(frame+1)*size*size//2]
  rows=[i//(size//2) for i,value in enumerate(pose) if value]
  for flipped in (False,True):
   uc.mem_write(bill+16,struct.pack('<H',frame));uc.mem_write(bill+24,struct.pack('<H',0x121f|(0x0800 if flipped else 0)))
   invoke('fwfx_emote_frame',[actor,frame&1]);invoke('fwfx_draw',[camera,0x02222000])
   height=sum(emote_poses[-1][i]*up[i] for i in range(3))/4096
   visible_top=size-1-max(rows) if flipped else min(rows)
   gap=height+(31-bubble_bottom)-(size-visible_top)
   assert abs(gap-1)<0.02,(size,frame,flipped,gap)
 assert len(allocations)==allocated and not any(c[0] in (0x20493f0,0x204964c,0x204e55c) for c in calls[loads:]),'Per-draw texture work'
 invoke('fwfx_emote_end');invoke('fwfx_destroy')
assert collections.Counter(allocations)==collections.Counter(frees)
print('Effect checks passed: I4 row bounds, one-pixel opaque-edge emote placement for shipped 32/64px poses and vertical flips, no per-frame scan/load/upload, member 981 bounds, private palette/material, lighting, one-shot ball cues, send-out/recall frames, ABI and teardown. Native services mocked; visual/audio acceptance pending.')
