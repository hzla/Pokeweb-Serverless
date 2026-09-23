"""Menu/storage/streaming regressions on packaged ARM946 code; no DS game run.

Native map/render/allocation services are spies. The retail zone deletion loop
and runtime party identity validation execute unchanged.
"""
import verify_ambient as ambient
from verify_packaged import *
from unicorn import UC_HOOK_CODE
s=ambient.s;h=s.h;uc=h.uc;r=s.r
# Run the native streamed-zone deletion scan: the exact 0x20 bit must retain
# the follower, not the neighboring ordinary NPC, with unchanged trail/pose.
for cycle in range(h.CYCLES):
 snap=s.setup();h.put(h.A,h.u32(h.A)|32);h.half(h.P+8,255)
 h.put(s.NPC,1);h.put(s.NPC+144,0x0221f000);h.put(s.NPC+132,0)
 h.call(0x02167adc,[h.SYS]);s.kept(snap);assert h.u32(s.NPC)==0
 # Repeat on the same live follower after another ordinary actor spawn.
 h.put(s.NPC,1);h.put(s.NPC+136,h.SYS);h.put(s.NPC+144,0x0221f000);h.call(0x02167adc,[h.SYS]);s.kept(snap);assert h.u32(s.NPC)==0
# The bit cannot prevent an actual delete/warp teardown.
h.call(0x02166980,[h.A]);assert not h.u32(h.A)&1

# Exercise actual native initialization after streaming, not just flags on a
# pre-positioned fixture. The original world vector is zero at this point.
# Boundary coordinates match the reported Floccesy Town -> Route 20 crossing.
import ndspy.narc
maps=ndspy.narc.NARC(r.rom.getFileByName('a/1/2/6')).files
for cycle in range(h.CYCLES):
 for map_id,fx,fz in [(560,126,662),(599,129,662)]:
  snap=s.setup()
  ambient.grid(h.A,fx,2,fz)
  snap=(snap[0],snap[1],bytes(uc.mem_read(h.A+68,12)))
  s.opcode(0x1d9) # zone setup is allowed, actual spawn still checked
  data=maps[map_id];start=8+data[4]*20
  for i in range(data[5]):
   entity=data[start+36*i:start+36*(i+1)]
   uc.mem_write(s.ENTITY,bytes(entity))
   uc.mem_write(s.NPC,bytes(256));h.put(s.NPC,1);h.put(s.NPC+136,h.SYS)
   h.call(0x02166b7c,[s.NPC,s.ENTITY]);s.kept(snap)
# Placement onto the follower still yields it, during a script or exploration.
for script in (False,True):
 snap=s.setup()
 if script:s.event()
 h.half(s.ENTITY+28,10);h.half(s.ENTITY+30,9)
 uc.mem_write(s.NPC,bytes(256));h.put(s.NPC,1);h.put(s.NPC+136,h.SYS)
 h.call(0x02166b7c,[s.NPC,s.ENTITY])
 assert not h.u32(h.F+24) and h.u32(s.debug+16)==4
 assert h.call('fws_poll')==(2 if script else 4)
 assert bytes(uc.mem_read(s.NPC+68,12))==snap[2] # original write still commits
# The same long sweep from an initialized NPC remains unsafe even when the
# endpoint is clear. Do not weaken real movement to destination-only checks.
s.setup();h.put(s.NPC,3);uc.mem_write(s.NPC+68,bytes(12))
uc.mem_write(s.VEC,struct.pack('<iii',20*65536+32768,0,20*65536+32768))
h.call(0x02167348,[s.NPC,s.VEC])
assert not h.u32(h.F+24) and h.u32(s.debug+16)==4
# Native 0x1D9 target only edits spawn data: direction/x/y/z, not live actors.
# The handler's operand resolver is verified separately by policy signatures;
# execute its exact final helper including bounds and rail exclusions.
DATA=s.EXT
for index,rail in [(0,False),(1,False),(0,True)]:
 snap=s.setup();uc.mem_write(DATA,bytes(40));h.half(DATA+20,1);h.put(DATA+32,s.ENTITY)
 h.put(s.ENTITY+24,int(rail));before=bytes(uc.mem_read(s.ENTITY,36))
 s.opcode(0x1d9);h.call(0x0215d1dc,[DATA,index,3,160,2*65536,643]);s.kept(snap)
 if index or rail:assert bytes(uc.mem_read(s.ENTITY,36))==before
 else:
  assert struct.unpack('<H',uc.mem_read(s.ENTITY+12,2))[0]==3
  assert struct.unpack('<HHi',uc.mem_read(s.ENTITY+28,8))==(160,643,2*65536)

created=[]
def allocation_spy(u,pc,size,user):
 if pc==0x021668c0:
  assert u.reg_read(UC_ARM_REG_SP)%8==0
  created.append(1);uc.mem_write(h.A,bytes(256));h.put(h.A,1);h.put(h.A+136,h.SYS)
  h.half(h.A+8,0xf0);uc.mem_write(h.A+124,b'\1\1');s.ret(h.A)
uc.hook_add(UC_HOOK_CODE,allocation_spy)
RESTORE=s.VEC
for changed in (False,True):
 for cycle in range(h.CYCLES):
  s.setup();s.event();s.opcode(0x130);s.opcode(0x14f)
  pose=bytes(uc.mem_read(h.A+68,12));identity=bytes(uc.mem_read(h.F+28,20))
  h.call('fws_detach');h.put(h.F+24,0);h.put(h.F,0);h.put(h.A,0)
  assert h.call('fws_attach',[h.SYS,h.F,1,h.addr('scene_recall')|1])==1
  h.call('fws_set_player',[h.P]);assert h.call('fws_take_restore',[h.addr('fwfield_restore')])==1
  if changed:h.put(h.addr('fwfield_restore')+40+12,999) # Different personality, same species/slot.
  # The PC script still owns the field after application reconstruction.
  s.event();before=len(created);h.call('FollowingUpdate',[h.SYS])
  assert h.u32(h.addr('FollowingDebug')+20)==0
  if changed:
   assert not h.u32(h.F+24) and len(created)==before
  else:
   assert h.u32(h.F+24)==h.A and len(created)==before+1 and not h.u32(h.A)&4
   assert bytes(uc.mem_read(h.A+68,12))==pose and h.u32(h.A)&32
   assert h.u32(h.A+4)&1048576 # independently nonpersistent
   assert h.u32(h.F)==6 # external event pause
  # Return to ordinary exploration. Changed lead waits for trail reseeding;
  # unchanged lead keeps the same restored actor with no send-out.
  h.put(h.GAME+0x18,0);uc.mem_write(h.GAME+0x35,b'\0')
  h.call('FollowingUpdate',[h.SYS]);assert h.u32(h.F+24)==h.A
  assert h.u32(h.F)==(1 if changed else 2)
  assert bool(h.u32(h.A)&4)==changed
  assert not h.u32(h.addr('fwfield_restore'))
# Older/mismatched resident bridge must fail closed without calling a missing
# optional function, and hidden followers must not gain a visible PC snapshot.
s.setup();api=s.ex[symbol_hash('FollowingEventsAPI')];abi=h.u32(api);h.put(api,1)
try:
 h.call('fws_detach');h.put(h.addr('fwfield_eventsReady'),0)
 h.call('FollowingUpdate',[h.SYS]);assert not h.u32(h.F+24)
finally:h.put(api,abi)
s.setup();s.event();s.opcode(0x130);h.put(h.A,h.u32(h.A)|4);s.opcode(0x14f)
assert not h.call('fws_take_restore',[RESTORE])
print(f'Continuity checks passed: {h.CYCLES} menu-close, PC presentation/fade cycles and native zone deletions; {h.CYCLES*34} real-map NPC initial placements, destination/sweep conflicts and spawn-data guards; {h.CYCLES} unchanged + {h.CYCLES} changed-identity storage reconstructions; keep-zone + non-save flags; unsafe child/fade and teardown guards. Native UI/map/allocation mocked; no emulator run.')
