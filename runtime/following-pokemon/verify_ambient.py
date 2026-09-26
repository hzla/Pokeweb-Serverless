"""Ambient NPC reservations on final packaged modules and native collision code.

UI, map/rail evaluation and resource services are isolated spies; no DS game run.
"""
import verify_scenes as s
from verify_packaged import *
from unicorn import UC_HOOK_CODE
h=s.h;uc=h.uc
CALLBACK=0x0220e000;TABLE=CALLBACK+0x100;QUERY=TABLE+32;OUT=QUERY+64
# Tiny ARMv5 Thumb callback calls native collision with test arguments. Unlike
# a direct observer test, this passes through the real autonomous dispatcher.
# push {r4,lr}; ldr r1/2/3 literals; ldr r4 native; blx r4; ldr r4 out; str; pop.
uc.mem_write(CALLBACK,struct.pack('<10H',0xb510,0x4904,0x4a04,0x4b05,0x4c05,0x47a0,0x4c06,0x6020,0xbd10,0x46c0)+bytes(24))
# PC-relative literals: x+20,y+24,z+28,target+32,out+40.
def callback(x,y,z,rail=False):
 h.put(CALLBACK+20,x);h.put(CALLBACK+24,y);h.put(CALLBACK+28,z)
 h.put(CALLBACK+32,s.ex[symbol_hash('FollowingAmbientRail')] if rail else 0x0215e539)
 h.put(CALLBACK+40,OUT)
 uc.ctl_remove_cache(CALLBACK,CALLBACK+64)
def grid(a,x,y,z):
 uc.mem_write(a+60,struct.pack('<hhh',x,y,z));uc.mem_write(a+54,struct.pack('<hhh',x,y,z))
 uc.mem_write(a+68,struct.pack('<iii',x*65536+32768,y*65536,z*65536+32768))
def setup():
 s.setup();h.half(h.P+8,255);h.put(h.A,1|128|256|32768|512|1024)
 grid(h.P,10,0,10);grid(h.A,10,0,9);grid(s.NPC,9,0,9)
 h.put(TABLE+8,CALLBACK|1);h.put(s.NPC+140,TABLE);h.put(h.SYS+60,s.MAN);h.put(s.MAN,s.MAN+128)
 h.put(OUT,99)
def run(actor=s.NPC):
 h.call(0x021671c8,[actor]);return h.u32(OUT)
# The native collision scan really runs. Its fourth arg z survives the veneer.
for i in range(100):
 setup();callback(10,0,9);assert run()==1
 assert h.call(0x0215e538,[s.NPC,10,0,9])==0 # out-of-callback / sight query
 assert h.u32(h.F+24)==h.A and h.u32(h.A)&128 # no recall or flag mutation
 callback(10,0,8);assert run()==0
 callback(10,1,9);assert run()==0 # another elevation
 callback(10,0,9);h.put(h.A,h.u32(h.A)|4);assert run()==0 # invisible
 h.put(h.A,h.u32(h.A)&~4);h.put(h.P+140,TABLE);assert run(h.P)==0
# Old tile is reserved during movement; a wider native footprint is respected.
setup();grid(h.A,11,0,9);h.half(h.A+54,10);callback(10,0,9);assert run()==1
setup();uc.mem_write(h.A+124,b'\2\1');callback(11,0,9);assert run()==1
# Native collision with an unrelated actor is unchanged, even outside callback.
setup();grid(s.NPC+256,12,0,9);h.put(s.NPC+256,1);uc.mem_write(s.NPC+256+124,b'\1\1')
callback(12,0,9);assert run()==1 and h.call(0x0215e538,[s.NPC,12,0,9])==1
# Real event/locked actor bypasses ambient policy: its script retains priority.
setup();s.event();callback(10,0,9);assert run()==0
setup();h.put(s.NPC+4,8);callback(10,0,9);assert run()==0
# Follower cannot step into either NPC endpoint; the player remains passable.
setup();uc.mem_write(QUERY,struct.pack('<iii',9*65536+32768,0,9*65536+32768));assert not h.call('fws_step_clear',[h.A,QUERY])
grid(s.NPC,8,0,9);h.half(s.NPC+54,9);assert not h.call('fws_step_clear',[h.A,QUERY])
h.half(s.NPC+54,8);assert h.call('fws_step_clear',[h.A,QUERY])
uc.mem_write(QUERY,bytes(uc.mem_read(h.P+68,12)));assert h.call('fws_step_clear',[h.A,QUERY])
# Execute the follower callback through a reserved tile, then reseed normally.
setup();grid(s.NPC,10,0,10)
uc.mem_write(h.P+68,struct.pack('<iii',10*65536,0,11*65536))
old=bytes(uc.mem_read(h.A+68,12));h.call('move',[h.A])
assert h.u32(h.A)&4 and bytes(uc.mem_read(h.A+68,12))==old
assert struct.unpack('<H',uc.mem_read(h.F+52+64*28+6,2))[0]==0
# Leaving the old trail discarded avoids teleporting past the blocking actor.
grid(s.NPC,8,0,8)
for z in (12,13):
 uc.mem_write(h.P+68,struct.pack('<iii',10*65536,0,z*65536));h.call('move',[h.A])
assert h.u32(h.F+24)==h.A
# Rail wrapper uses the resolved destination, not compass direction/grid guess.
rail_result=0;rail_point=(10*65536+32768,0,9*65536+32768)
def native(u,pc,size,user):
 if pc in (0x021957a8,0x021b0724,0x021b0624,0x021b08c0,0x021b084c,0x021b0a24):
  assert u.reg_read(UC_ARM_REG_SP)%8==0
  if pc==0x021957a8:s.ret(rail_result)
  elif pc==0x021b0724:uc.mem_write(s.reg(2),struct.pack('<iii',*rail_point));s.ret()
  elif pc==0x021b0624:s.ret(65536)
  elif pc==0x021b08c0:uc.mem_write(s.reg(1),struct.pack('<iii',*rail_point));s.ret()
  elif pc==0x021b084c:uc.mem_write(s.reg(3),struct.pack('<iii',*rail_point));s.ret(1)
  else:s.ret(2)
uc.hook_add(UC_HOOK_CODE,native)
setup();callback(QUERY,0,0,True);assert run()==1
rail_point=(10*65536+32768,32768,9*65536+32768);assert run()==0 # native vertical separation
rail_point=(12*65536+32768,0,9*65536+32768);assert run()==0
rail_result=1;assert run()==1;rail_result=0
setup();h.put(s.NPC,3|8192);h.put(s.NPC+148,s.RAIL);h.put(s.RAIL+120,s.MAN+128)
uc.mem_write(QUERY,struct.pack('<iii',*rail_point));assert not h.call('fws_step_clear',[h.A,QUERY])
# Execute the actual random-walk state machine's blocked/retry branch. Only
# direction RNG and terrain route conversion are spies; collision scan is native.
h.native_addresses.discard(0x0215e4f0)
wandering=False
def wander_native(u,pc,size,user):
 if not wandering:return
 if pc==0x021922d4:s.ret(3) # choose east
 elif pc==0x0215e4f0:
  a=s.reg(0);x,y,z=struct.unpack('<hhh',uc.mem_read(a+60,6))
  uc.reg_write(UC_ARM_REG_R1,x+1);uc.reg_write(UC_ARM_REG_R2,y);uc.reg_write(UC_ARM_REG_R3,z)
  uc.reg_write(UC_ARM_REG_PC,0x0215e539) # collision result -> native retry branch
 elif pc==0x0218f05c:s.ret(0) # accepted animation still running
uc.hook_add(UC_HOOK_CODE,wander_native)
setup();h.put(TABLE+8,0x02191489);h.half(s.NPC+148,3);h.put(s.NPC+152,0);wandering=True
h.call(0x021671c8,[s.NPC]);assert struct.unpack('<h',uc.mem_read(s.NPC+148,2))[0]==0
assert struct.unpack('<hhh',uc.mem_read(s.NPC+60,6))==(9,0,9)
grid(h.A,10,0,7);h.half(s.NPC+148,3);h.call(0x021671c8,[s.NPC])
assert struct.unpack('<h',uc.mem_read(s.NPC+148,2))[0]==4
wandering=False
# A controller that ignores the collision result yields the follower before
# writing a conflicting world position, without delaying/changing that write.
setup();s.actor_pos(9,9);uc.mem_write(QUERY,bytes(uc.mem_read(h.A+68,12)))
h.call(0x02167348,[s.NPC,QUERY]);assert not h.u32(h.F+24)
assert bytes(uc.mem_read(s.NPC+68,12))==bytes(uc.mem_read(QUERY,12))
# Rail fallback uses actual world separation, even inside the same grid cell.
setup();h.put(s.NPC,3|8192);grid(s.NPC,10,0,8)
fpos=struct.unpack('<iii',uc.mem_read(h.A+68,12))
uc.mem_write(QUERY,struct.pack('<iii',fpos[0]+9*4096,fpos[1],fpos[2]))
h.call(0x02167348,[s.NPC,QUERY]);assert h.u32(h.F+24)==h.A
uc.mem_write(QUERY,struct.pack('<iii',fpos[0]+7*4096,fpos[1],fpos[2]))
h.call(0x02167348,[s.NPC,QUERY]);assert not h.u32(h.F+24)
# Unload removes all field participation; resident queries forward unchanged.
setup();h.call('fws_detach');callback(10,0,9);assert run()==0

# The native tile-entry dispatcher reads Actor+0x94 without a null check. Both
# supplied states show that grid actors leave this movement context null, and
# the 0.6.44 freeze proves that clearing flag 0x400 before calling it is unsafe.
# Keep the stock synthetic actor out of that dispatcher even across tiles.
tile_effect_calls=[]
def tile_effect_spy(u,pc,size,user):
 if pc==0x02194b88:
  tile_effect_calls.append(h.A)
uc.hook_add(UC_HOOK_CODE,tile_effect_spy)
def follower_step(z):
 uc.mem_write(h.P+68,struct.pack('<iii',10*65536+32768,0,z*65536+32768))
 h.call('move',[h.A])
setup();h.put(h.A,h.u32(h.A)|0x400);assert h.call(0x021677e4,[h.A])==1
for z in (10,11,12,13,13):follower_step(z)
assert not tile_effect_calls
assert h.u32(h.A)&0x400 and h.call(0x021677e4,[h.A])==1
tile_effect_calls.clear();setup();h.put(h.A,h.u32(h.A)|0x400)
for z in (10,11,12,13):follower_step(z)
assert not tile_effect_calls and h.u32(h.A)&0x400
# The stock grid follower queries its own tile and asks only the safe native
# grass-entry helper to create the effect. Entry is once per visible tile,
# including initial appearance; Flying types and hidden actors are excluded.
s.setup();h.terrain_attr=0x240004;h.grass_entries.clear()
h.put(h.addr('fwfield_flying'),0)
h.call('FollowingUpdate',[h.SYS]);assert h.grass_entries==[(h.A,0x240004)]
assert h.terrain_queries[-1]==(h.A,(10*65536+32768,0,9*65536+32768))
h.call('FollowingUpdate',[h.SYS]);assert len(h.grass_entries)==1
grid(h.A,10,0,10);h.call('FollowingUpdate',[h.SYS]);assert len(h.grass_entries)==2
h.put(h.addr('fwfield_flying'),1);grid(h.A,10,0,11);h.call('FollowingUpdate',[h.SYS]);assert len(h.grass_entries)==2
h.put(h.addr('fwfield_flying'),0);h.put(h.A,h.u32(h.A)|4);h.call('FollowingUpdate',[h.SYS]);assert len(h.grass_entries)==2
h.put(h.A,h.u32(h.A)&~4);h.call('FollowingUpdate',[h.SYS]);assert len(h.grass_entries)==3
h.terrain_attr=0;grid(h.A,10,0,12);h.call('FollowingUpdate',[h.SYS]);assert len(h.grass_entries)==3
assert not tile_effect_calls
print('Ambient checks passed: 100 callback cycles; native grid result and fourth-argument preservation; player/sight/script exemption; hidden/elevation/old-tile/dimension checks; follower reservations; resolved rail destination; unload; safe grass entry once per visible tile, with Flying/hidden exclusion. Native map/rail/effect services mocked; no DS game run.')
