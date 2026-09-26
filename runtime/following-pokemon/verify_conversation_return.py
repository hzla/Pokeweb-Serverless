"""Conversation -> field regression using the packaged DLL and retail event loop.

Native UI, actors and resources are spies, not a DS emulator. The actual pinned
ARM9 event scheduler/latch and field event query execute on the ARM946 CPU.
Importing the controller harness also runs its existing interaction checks.
"""
import hashlib,os,sys
import ndspy.rom,ndspy.codeCompression
import verify_interactions as h
from unicorn import UC_HOOK_CODE
from unicorn.arm_const import UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_SP,UC_ARM_REG_PC,UC_ARM_REG_LR

if len(sys.argv)!=2:raise SystemExit('Expected pinned clean ROM path')
raw=h.Path(sys.argv[1]).read_bytes()
profile=os.environ.get('FOLLOWING_PROFILE','stock')
contract=h.json.loads((h.HERE/('upgrade-contract.json' if profile=='white2upgrade' else 'contract.json')).read_text())
expected_hash=contract['sourceRomSha256'] if profile=='white2upgrade' else contract['target']['sha256']
assert hashlib.sha256(raw).hexdigest()==expected_hash
rom=ndspy.rom.NintendoDSRom(raw)
h.uc.mem_write(rom.arm9RamAddress,bytes(ndspy.codeCompression.decompress(rom.arm9)))
ov=rom.loadArm9Overlays([36])[36];h.uc.mem_write(ov.ramAddress,bytes(ov.data))
h.F=h.addr('fwfield_follower')
deletes=[];updates=[];mode=partner=0
native={0x0219a6e0,0x0219a704,0x0216a2b4,0x021667b8,0x02166980,0x0201735c,0x0201fe24,0x0201ff34,0x0201cd24,0x0201cdd8}
def spy(u,pc,size,user):
 if pc not in native:return
 assert u.reg_read(UC_ARM_REG_SP)%8==0,hex(pc)
 r0=u.reg_read(UC_ARM_REG_R0);r1=u.reg_read(UC_ARM_REG_R1);result=0
 if pc==0x0219a6e0:result=h.P
 if pc==0x0219a704:result=mode
 if pc==0x0216a2b4:result=partner
 if pc==0x021667b8:updates.append(r0)
 if pc==0x02166980:deletes.append(r0);h.put(r0,0)
 if pc in (0x0201735c,0x0201ff34):result=h.GAME+0x500
 if pc==0x0201fe24:result=1
 if pc==0x0201cd24:result={5:25,0x6f:0,0x6e:0,0x4c:0,0xa0:100,0xa1:100,0:123,7:456}.get(r1,0)
 u.reg_write(UC_ARM_REG_R0,result);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
h.uc.hook_add(UC_HOOK_CODE,spy)
def setup():
 global mode,partner
 h.call('fwt_unload');h.fail='';h.controller=0;mode=partner=0
 world,trail=h.setup()
 for name,value in [('fwfield_owner',h.SYS),('fwfield_player',h.P),('fwfield_generation',1),('fwfield_tick',0),('fwfield_configState',1)]:h.put(h.addr(name),value)
 h.put(h.SYS,17);h.half(h.SYS+4,2);h.put(h.SYS+28,h.P);h.put(h.SYS+64,h.FIELD)
 h.put(h.FIELD+4,h.GAME);h.put(h.FIELD+8,h.GAMEDATA);h.uc.mem_write(h.GAME+0x35,b'\0')
 h.put(h.addr('fwfield_eventsReady'),h.call('fws_attach',[h.SYS,h.F,1,h.addr('scene_recall')|1]));h.call('fws_set_player',[h.P])
 h.uc.mem_write(h.F+28,bytes(h.uc.mem_read(h.SNAP,20)));h.uc.mem_write(h.F+49,b'\1')
 h.put(h.F+52+64*28,65536) # One vertical tile in the normalized trail metric.
 for offset,value in [(20,0),(32,h.A),(40,1)]:h.put(h.addr('FollowingDebug')+offset,value)
 return world
def field_frame():
 before=len(updates);h.call('FollowingUpdate',[h.SYS]);assert len(updates)==before+1
 if h.u32(h.F+24):h.call('move',[h.A])
def conversation(interrupt=None):
 assert h.begin()==h.EVENT
 for frame in range(2000):
  h.held=h.pressed=1 if h.stage()==6 and frame%3==0 else 0
  # Exact retail order: cache event state, run callbacks, then field actors.
  h.call(0x02016a88,[h.GAME]);done=h.call(0x02016d74,[h.GAME])
  if done:
   assert not h.u32(h.GAME+0x18) and h.call(0x0218130c,[h.FIELD])==1
   if interrupt:interrupt()
  field_frame()
  if done:return
 raise AssertionError('Conversation did not finish')
def retained():
 assert h.u32(h.F)==2 and h.u32(h.F+24)==h.A,('follower recalled after own dialogue',h.u32(h.addr('FollowingDebug')+20),deletes)
 assert h.u32(h.A)&1 and not h.u32(h.A)&4
 assert not h.u32(h.A)&16 # Normal stationary follow advances its native idle loop.
 assert h.u32(h.addr('FollowingDebug')+20)==0
 assert not h.call('fwt_active');h.balanced()

# Final billboard depth checks live in verify_render.py.

# Repeat on the same actor/trail, rather than recreating a fixture each time.
world=setup();count=len(deletes)
field_frame();assert not h.u32(h.A)&16
for i in range(h.CYCLES):
 h.held=h.pressed=0;h.call('fwt_poll_input');assert h.begin()==h.EVENT;assert h.u32(h.A)&16
 for frame in range(2000):
  h.held=h.pressed=1 if h.stage()==6 and frame%3==0 else 0
  h.call(0x02016a88,[h.GAME]);done=h.call(0x02016d74,[h.GAME])
  field_frame()
  if done:break
 else:raise AssertionError('Conversation did not finish')
 retained()
 assert bytes(h.uc.mem_read(h.GAME+0x35,1))==b'\1' # Never clear a native lock.
 for _ in range(3):
  h.call(0x02016a88,[h.GAME]);field_frame();retained()
 assert bytes(h.uc.mem_read(h.A+68,12))==world
assert len(deletes)==count
# Idle after talking, then continue the same recorded trail without respawning.
for _ in range(120):h.call(0x02016a88,[h.GAME]);field_frame();retained()
for step in range(1,17):
 h.put(h.P+76,10*65536+step*4096);h.call(0x02016a88,[h.GAME]);field_frame();retained()
assert bytes(h.uc.mem_read(h.A+68,12))!=world and len(deletes)==count

# An external event or independent transition guard wins on the completion frame.
def set_mode():
 global mode
 mode=1
def set_partner():
 global partner
 partner=1
for interrupt in (lambda:h.put(h.GAME+0x18,h.FOREIGN),lambda:h.put(h.FIELD+0x148,1),set_mode,set_partner,lambda:h.put(h.F+20,2)):
 setup();count=len(deletes);conversation(interrupt)
 assert not h.u32(h.F+24) and len(deletes)==count+1
 assert h.u32(h.addr('FollowingDebug')+20)&(8|16|32|1024|2048)
 h.balanced()
# The completion exemption is consumed once; it cannot mask another event's latch.
setup();conversation();retained();field_frame()
assert not h.u32(h.F+24) and h.u32(h.addr('FollowingDebug')+20)&16
# Message-system failure also returns safely to the same visible actor.
for failure in ('bg','string','window'):
 setup();h.fail=failure;conversation();retained()
# Cancellation/teardown never leaves an unconsumed completion exemption behind.
setup();conversation(lambda:h.call('fwt_unload'))
assert not h.u32(h.F+24)
h.balanced()
print(f'Conversation return regression passed: retail event loop/latch, {h.CYCLES} same-actor conversations, idle/walk resumption, one-update ownership, external event/fade/mode/partner/generation guards, message failures and unload. Native UI/resources mocked; no DS game run.')
