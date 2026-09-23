"""Packaged resident/field modules on ARM946, with pinned native event/VM code.

Native UI/rendering/heap services are spies. This is not a DS emulator run.
"""
import verify_conversation_return as r
from verify_packaged import *
from unicorn import UC_HOOK_CODE
import collections,json
h=r.h;uc=h.uc
h.SYS=0x0220a000 # Separate the actor system from the expanded four-actor pool.
ov=r.rom.loadArm9Overlays([12])[12];uc.mem_write(ov.ramAddress,bytes(ov.data))
EVENTS=PACKAGE_BUILD/'PokewebFollowingEventsW2.dll';EBASE=0x022c0000
ex=load_dependencies(uc,EBASE,0x022d0000)
install_hooks(uc,EVENTS,EBASE)
install_hooks(uc,h.DLL,h.BASE,ex)
NPC=h.A+256;ENTITY=0x0220b000;VM=0x0220c000;ENV=VM+0x100;PARAM=VM+0x200;WORK=VM+0x300;PROGRAM=VM+0x400
EXT=VM+0x500;CHECK=VM+0x600;VEC=VM+0x700;RAIL=VM+0x800;MAN=VM+0x900
observed=[];callback_result=0;checks=[];rail_curve=False;rail_broken=False;own_free=False
policy=json.loads((HERE/'event-policy.json').read_text())
finisher_entries=struct.unpack('<15I',uc.mem_read(0x0216b53c,60))
finisher_indices={address&~1:index for index,address in enumerate(finisher_entries) if address}
finisher_calls=[];finisher_wait=False
h.native_addresses.discard(0x02016d08)
r.native.discard(0x02166980)
def reg(index):return uc.reg_read([UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3][index])
def ret(value=0):uc.reg_write(UC_ARM_REG_R0,value);uc.reg_write(UC_ARM_REG_PC,uc.reg_read(UC_ARM_REG_LR))
def pop_return(regs):
 sp=uc.reg_read(UC_ARM_REG_SP)
 values=struct.unpack('<'+'I'*(len(regs)+1),uc.mem_read(sp,4*(len(regs)+1)))
 for dst,value in zip(regs,values):uc.reg_write(dst,value)
 uc.reg_write(UC_ARM_REG_SP,sp+4*len(values));uc.reg_write(UC_ARM_REG_PC,values[-1])
def native(u,pc,size,user):
 global callback_result
 if pc in (0x02153820,0x021a83d4,0x021aea38,0x021aea60,0x0203a278,0x02167aac,CHECK,0x021b0acc,0x021b0af8,0x021b0a14,0x02154184,0x021538c0) or pc in finisher_indices:
  assert u.reg_read(UC_ARM_REG_SP)%8==0,hex(pc)
 if pc in finisher_indices:
  index=finisher_indices[pc];finisher_calls.append((index,h.u32(h.F+24)))
  assert reg(1)==reg(0)+12
  if finisher_wait and h.u32(reg(1))==0:h.put(reg(1),1);ret(0)
  else:ret(1)
 elif pc==0x02154184:
  assert reg(0)==ENV;prepare_cleanup(h.u32(0x0216e680));ret(h.FOREIGN)
 elif pc==0x021538c0:
  assert reg(0)==WORK and reg(1)==h.FOREIGN
  h.put(h.GAME+0x18,h.FOREIGN);ret()
 elif pc in (0x02153820,0x021a83d4,0x021aea38,0x021aea60):
  observed.append(('callback',reg(0),h.u32(h.F+24),h.u32(h.F)))
  assert reg(1)==reg(0)+8 and reg(2)==h.u32(reg(0)+12)
  ret(callback_result)
 elif pc==0x0203a278:
  observed.append(('free',reg(0)))
  if own_free and reg(0)==h.EVENT:h.frees.append(('event',h.EVENT))
  ret()
 elif pc==0x02166988:
  actor=u.reg_read(UC_ARM_REG_R4);r.deletes.append(actor);h.put(actor,0)
  pop_return([UC_ARM_REG_R4])
 elif pc==0x02167c14:
  actor=reg(0);pos=u.reg_read(UC_ARM_REG_R4);observed.append(('position',actor,h.u32(h.F+24)))
  uc.mem_write(actor+68,bytes(uc.mem_read(pos,12)))
  pop_return([UC_ARM_REG_R4,UC_ARM_REG_R5,UC_ARM_REG_R6])
 elif pc==0x02167aac:
  observed.append(('allocate',reg(0),h.u32(h.F+24)))
  ret(h.A if not h.u32(h.A)&1 else NPC+256)
 elif pc==CHECK:checks.append(reg(1));ret(1)
 elif pc==0x02008008:observed.append(('unknown-child',h.u32(h.F+24)));ret(37)
 # Rail prediction executes an actual private native cursor layout, with the
 # curve evaluator isolated here. In-game curve/connection acceptance remains
 # in S11; no stock-map geometry or camera is synthesized by this fixture.
 elif pc==0x021b0acc:
  assert reg(0)!=RAIL and reg(1)==0
  uc.mem_write(reg(0)+44,b'\1');uc.mem_write(reg(0)+45,b'\0');h.half(reg(0)+46,reg(2));ret(1)
 elif pc==0x021b0af8:
  p=reg(0);n=uc.mem_read(p+45,1)[0]+1;uc.mem_write(p+45,bytes([n]));uc.mem_write(p+44,bytes([int(n<16 or rail_broken)]))
  x,y,z=struct.unpack('<iii',uc.mem_read(RAIL+56,12));key=struct.unpack('<H',uc.mem_read(p+46,2))[0]
  dx,dz={1:(0,-4096),2:(4096,0),3:(0,4096),4:(-4096,0)}[key]
  if rail_curve:dx,dz=0,4096 # actual path differs from world compass
  uc.mem_write(p+56,struct.pack('<iii',x+n*dx,y,z+n*dz));ret()
 elif pc==0x021b0a14:uc.mem_write(reg(1),bytes(uc.mem_read(reg(0)+56,12)));ret()
 elif pc==0x0215e908:h.put(reg(2),h.u32(reg(0)+72));ret(1)
uc.hook_add(UC_HOOK_CODE,native)
debug=h.addr('FollowingSceneDebug')
def setup():
 global callback_result,rail_curve,rail_broken,finisher_wait
 callback_result=0;rail_curve=rail_broken=finisher_wait=False;r.setup();h.call('fws_detach');h.put(0x0216e680,0)
 h.half(h.SYS+4,4);h.put(NPC,3);h.put(NPC+136,h.SYS);h.half(h.A+8,0xf0);h.half(NPC+8,5)
 h.put(NPC+256,0);h.put(NPC+140,0);h.put(NPC+4,0);uc.mem_write(NPC+124,b'\1\1');h.put(NPC+148,0)
 uc.mem_write(h.A+124,b'\1\1');h.half(h.A+60,10);h.half(h.A+64,9)
 uc.mem_write(h.A+68,struct.pack('<iii',10*65536+32768,0,9*65536+32768))
 h.put(h.GAME+0x18,0);uc.mem_write(h.GAME+0x35,b'\0');h.put(h.P+4,0)
 h.put(h.addr('fwfield_eventsReady'),h.call('fws_attach',[h.SYS,h.F,1,h.addr('scene_recall')|1]));h.call('fws_set_player',[h.P])
 uc.mem_write(ENTITY,bytes(36));h.half(ENTITY,5);h.half(ENTITY+2,1);h.half(ENTITY+28,20);h.half(ENTITY+30,20)
 uc.mem_write(VM,bytes(0x1000));h.put(VM+4,0x0216b578);h.put(VM+8,0x2f3);h.put(VM+0x2c,ENV)
 h.put(ENV+0x20,PARAM);h.put(PARAM,WORK);h.put(PARAM+4,h.GAME);h.put(PARAM+12,h.SYS);h.put(WORK+20,h.EVENT)
 return bytes(uc.mem_read(h.F+52,64*28+8)),bytes(uc.mem_read(h.A+24,2)),bytes(uc.mem_read(h.A+68,12))
def event(pointer=h.EVENT,callback=0x02153821,parent=0):
 uc.mem_write(pointer,struct.pack('<5I',parent,callback,0,pointer+32,h.GAME));h.put(h.GAME+0x18,pointer)
 h.call(0x02016a88,[h.GAME]);h.call(0x02016cf8,[pointer])
def opcode(code,vm=VM):
 h.put(vm+32,PROGRAM);uc.mem_write(PROGRAM,struct.pack('<H',code))
 result=h.call(ex[symbol_hash('FollowingEventOpcode')],[vm]);assert result==code and h.u32(vm+32)==PROGRAM+2
def actor_pos(x,z,y=0):
 uc.mem_write(NPC+68,struct.pack('<iii',x*65536+32768,y*65536,z*65536+32768));uc.mem_write(NPC+60,struct.pack('<hhh',x,y,z))
def kept(snapshot):
 assert h.u32(h.F+24)==h.A and h.u32(h.A)&1 and not h.u32(h.A)&4
 assert (bytes(uc.mem_read(h.F+52,64*28+8)),bytes(uc.mem_read(h.A+24,2)),bytes(uc.mem_read(h.A+68,12)))==snapshot
def recalled(reason):
 assert h.u32(h.F+24)==0 and not h.u32(h.A)&1,(reason,h.u32(debug+16))
 assert h.u32(debug+16)==reason,(reason,h.u32(debug+16))
 assert h.call('fws_poll')==2
def finish():
 h.call(0x02016d08,[h.EVENT]);h.put(h.GAME+0x18,0)
 assert h.call('fws_poll') in (1,2) # completion-frame cache still owns pause
 assert uc.mem_read(h.GAME+0x35,1)==b'\1'
 h.call(0x02016a88,[h.GAME]);assert h.call('fws_poll')==4
def prepare_cleanup(mask):
 h.put(0x0216e680,mask)
 uc.mem_write(h.FOREIGN,struct.pack('<5I',h.EVENT,0x02154135,0,h.FOREIGN+32,h.GAME))
 uc.mem_write(h.FOREIGN+32,struct.pack('<6I',h.GAME,ENV,WORK,0,0,15))
def cleanup(mask):
 prepare_cleanup(mask);h.put(h.GAME+0x18,h.FOREIGN)
 return h.call(0x02016cf8,[h.FOREIGN])
def cleanup_return():
 h.call(0x02016d08,[h.FOREIGN]);h.put(h.GAME+0x18,h.EVENT)

# Real menu callback identity, replacement event, and stale/recycled address.
# UI services are spies; actual packaged guards execute before every callback.
SAFE_UI={0x0215a8b4,0x0218b1a8,0x0217993c,0x02179a28,0x02179ac4,0x02019654,0x0201958c,0x0201937c,0x02019400,0x02019478}
def ui_spy(u,pc,size,user):
 if pc in SAFE_UI:ret(37)
uc.hook_add(UC_HOOK_CODE,ui_spy)
def ui_event(pointer,callback,parent=0):
 uc.mem_write(pointer+32,struct.pack('<4I',h.GAME,h.GAME,h.FIELD,h.FIELD))
 if callback==0x0215a8b5:h.put(pointer+40,h.GAME)
 if callback in (0x0217993d,0x02179a29,0x02179ac5):h.put(pointer+36,h.FIELD)
 event(pointer,callback,parent)
for cycle in range(h.CYCLES):
 snap=setup();ui_event(h.EVENT,0x0215a8b5);h.call('fws_mark_menu',[h.EVENT]);kept(snap)
 assert h.u32(h.A)&16 # A retained external menu freezes the current idle pose.
 h.call(0x02016d08,[h.EVENT]);ui_event(h.FOREIGN,0x0218b1a9);kept(snap)
 h.call(0x02016d08,[h.FOREIGN]);h.put(h.GAME+0x18,0);h.call('fws_poll');h.call(0x02016a88,[h.GAME]);r.field_frame();kept(snap);assert not h.u32(h.A)&16
# A freed menu's pointer cannot confer permission on a different event.
ui_event(h.EVENT,0x0215a8b5);h.call('fws_mark_menu',[h.EVENT]);h.call(0x02016d08,[h.EVENT])
event(h.EVENT,0x02008009);recalled(2)

# Exact US PC opcodes; 12D/12E/12F no longer receive PC exceptions.
# 14C is harmless user-work cleanup, but must not preserve a PC pose.
snap=setup();event();opcode(0x14c);kept(snap);assert not h.call('fws_take_restore',[VEC])
for old in (0x12d,0x12e,0x12f):
 snap=setup();event();opcode(old);recalled(1)
for cycle in range(h.CYCLES):
 snap=setup();event();opcode(0xea);opcode(0x130)
 ui_event(h.FOREIGN,0x0217993d,h.EVENT);kept(snap)
 h.call(0x02016d08,[h.FOREIGN]);h.put(h.GAME+0x18,h.EVENT)
 opcode(0x1a4);h.put(h.FIELD+0x148,1);r.field_frame();kept(snap)
 opcode(0x1a7);opcode(0x14f);ui_event(h.FOREIGN,0x02019655,h.EVENT);kept(snap)
 h.call(0x02016d08,[h.FOREIGN]);h.put(h.GAME+0x18,h.EVENT)
 opcode(0x131);ui_event(h.FOREIGN,0x02179a29,h.EVENT);kept(snap)
 h.call(0x02016d08,[h.FOREIGN]);h.put(h.GAME+0x18,h.EVENT)
 opcode(0x1a3);h.put(h.FIELD+0x148,0);opcode(0x1a7);opcode(0x132)
 ui_event(h.FOREIGN,0x02179ac5,h.EVENT);kept(snap)
 h.call(0x02016d08,[h.FOREIGN]);h.put(h.GAME+0x18,h.EVENT);finish();kept(snap)
# Unrelated child, forced movement, and non-PC fades remain conservative.
for code in (0x1a3,0x1a4,0x1a7):
 setup();event();opcode(code);recalled(1)
setup();event();opcode(0x130);event(h.FOREIGN,0x02008009,h.EVENT);recalled(2)

# One-shot storage snapshot includes the real selected Pokemon, not just pose.
RESTORE=VEC
snap=setup();event();opcode(0x130);opcode(0x14f);h.call('fws_detach');h.put(h.F+20,2)
assert h.call('fws_attach',[h.SYS,h.F,2,h.addr('scene_recall')|1])==1
assert h.call('fws_take_restore',[RESTORE])==1
assert h.u32(RESTORE)==0x52535746
assert bytes(uc.mem_read(RESTORE+4,12))==bytes(uc.mem_read(h.P+68,12))
assert bytes(uc.mem_read(RESTORE+16,12))==bytes(uc.mem_read(h.A+68,12))
assert bytes(uc.mem_read(RESTORE+40,20))==bytes(uc.mem_read(h.F+28,20))
assert not h.call('fws_take_restore',[RESTORE])
snap=setup();event();opcode(0x130);opcode(0x14f);finish();h.call('fws_detach');h.put(h.F+20,2)
assert h.call('fws_attach',[h.SYS,h.F,2,h.addr('scene_recall')|1])==1
assert not h.call('fws_take_restore',[RESTORE])
# An unsafe event invalidates an outstanding storage snapshot.
setup();event();opcode(0x130);opcode(0x14f);opcode(0xffff);recalled(1)
assert not h.call('fws_take_restore',[RESTORE])

# Safe dialogue/page/choice/camera sequences, repeated on one live actor.
snap=setup();start=len(r.deletes);allocations=len(h.alloc)
for cycle in range(h.CYCLES):
 event()
 for code in (0x2e,0x74,0x4c,0x3d,0x31,0x3d,0x47,0x1f,0x13f,0x143,0x148,0xa6):opcode(code)
 for callback in (0x021a83d5,0x021aea39,0x021aea61):
  event(h.FOREIGN,callback,h.EVENT);kept(snap);h.call(0x02016d08,[h.FOREIGN]);h.put(h.GAME+0x18,h.EVENT)
 # Stock EVENT_END runs cleanup, unpause, then halt. A leftover dialogue
 # window must not turn this mandatory cleanup child into a recall.
 opcode(0x30);assert cleanup(1<<2)==1;kept(snap);cleanup_return()
 opcode(0x2f);opcode(2)
 h.put(h.P+4,8);h.put(h.SYS,17|32)
 for _ in range(3):r.field_frame();kept(snap);assert h.u32(h.F)==6
 h.put(h.P+4,0);h.put(h.SYS,17);finish();kept(snap);assert h.u32(h.F)==2
assert len(r.deletes)==start and len(h.alloc)==allocations

# Real end-command VM dispatch creates its child before yielding. The retail
# cleanup callback/bit checker/table run intact, with presentation finalizers
# isolated as spies; unknown cleanup work recalls before any finalizer executes.
snap=setup();event();h.put(VM+0x30,CHECK);h.put(VM+0x34,ENV);uc.mem_write(VM+0x19,b'\1');h.put(VM+32,PROGRAM)
uc.mem_write(PROGRAM,struct.pack('<HH',0x30,2));h.call(0x0201592c,[VM]);kept(snap)
assert h.u32(h.GAME+0x18)==h.FOREIGN and h.u32(VM+32)==PROGRAM+2
assert h.call(0x02016cf8,[h.FOREIGN])==1;kept(snap);cleanup_return();finish();kept(snap)
mask=sum(1<<entry['index'] for entry in policy['finishers'])
snap=setup();event();before=len(finisher_calls);assert cleanup(mask)==1;kept(snap)
assert finisher_calls[before:]==[(entry['index'],h.A) for entry in policy['finishers']]
snap=setup();event();finisher_wait=True;assert cleanup(1<<12)==0;kept(snap)
assert h.call(0x02016cf8,[h.FOREIGN])==1;kept(snap)
for index in (7,8,10,11,14,31):
 setup();event();before=len(finisher_calls);assert cleanup(1<<index)==1;recalled(13)
 assert all(actor==0 for _,actor in finisher_calls[before:])
snap=setup();event();finisher_wait=True;assert cleanup(1<<12)==0
h.put(0x0216e680,(1<<12)|(1<<7));h.call(0x02016cf8,[h.FOREIGN]);recalled(13)
for offset,value in ((0,0),(16,15),(20,16)):
 setup();event();prepare_cleanup(0);h.put(h.FOREIGN+32+offset,value);h.put(h.GAME+0x18,h.FOREIGN)
 h.call('fws_poll');recalled(13)

# Exercise own conversations with the resident hooks actually installed too.
setup();r.setup();own_free=True
for _ in range(10):
 h.held=h.pressed=0;h.call('fwt_poll_input');r.conversation();r.retained()
 h.call(0x02016a88,[h.GAME]);r.field_frame();r.retained()
own_free=False

# Every audited opcode and every unaudited standard/extended value is explicit.
policy=json.loads((HERE/'event-policy.json').read_text());safe={e['opcode'] for e in policy['commands']}
for code in range(0x10000):assert bool(h.call('fws_safe_opcode',[code]))==(code in safe)

# Actual retail VM dispatch: normal checker retained, extended bypass retained,
# only executed branch bytes are observed, operands are not fetched as opcodes.
setup();event();h.put(VM+0x30,CHECK);h.put(VM+0x34,ENV);h.put(VM+12,EXT);h.put(VM+16,1);h.put(VM+20,0x8000)
h.put(EXT,0x021541c1);uc.mem_write(VM+0x19,b'\1');h.put(VM+32,PROGRAM)
uc.mem_write(PROGRAM,struct.pack('<HH',0,2));checks.clear();h.call(0x0201592c,[VM]);assert checks and h.u32(h.F+24)==h.A
setup();event();h.put(VM+0x30,CHECK);h.put(VM+0x34,ENV);uc.mem_write(VM+0x19,b'\1');h.put(VM+32,PROGRAM)
# Relative jump skips an unknown opcode. Its 32-bit operand must not be
# treated as another command fetch.
uc.mem_write(PROGRAM,struct.pack('<HIHH',0x1e,2,0xffff,2));checks.clear();h.call(0x0201592c,[VM]);assert h.u32(h.F+24)==h.A and len(checks)==2
setup();event();h.put(VM+0x30,CHECK);h.put(VM+0x34,ENV);h.put(VM+12,EXT);h.put(VM+16,1);h.put(VM+20,0x8000)
h.put(EXT,0x021541c1);uc.mem_write(VM+0x19,b'\1');h.put(VM+32,PROGRAM)
uc.mem_write(PROGRAM,struct.pack('<HH',0x8000,2));checks.clear();h.call(0x0201592c,[VM]);recalled(1);assert len(checks)==1

# Facing and NPC routes away retain; crossing is removed before action storage.
for code in (0,1,2,3,0x3c,0x42):
 snap=setup();event();h.call(0x02166ec8,[h.P,code]);kept(snap)
for code in (4,8,0xc,0x10,0x14,0x34,0x38,0x4c,0x60,0xa7):
 snap=setup();event();actor_pos(20,20);h.call(0x02166ec8,[NPC,code]);kept(snap)
snap=setup();event();actor_pos(10,8);h.call(0x02166ec8,[NPC,9]);recalled(4);assert struct.unpack('<H',uc.mem_read(NPC+38,2))[0]==9
snap=setup();event();actor_pos(10,8,2);h.call(0x02166ec8,[NPC,9]);kept(snap)
for code in (8,0x2c,0x34,0x43):
 setup();event();h.call(0x02166ec8,[h.P,code]);recalled(3)
setup();event();h.call(0x02166ec8,[NPC,0xc0]);recalled(7)

# Common field-event setup pauses autonomous actor movement. A dormant queued
# route from a random mover must not recall the follower during NPC, sign, or
# static-furniture text. The exact stock sign/furniture preamble also reports
# interaction progress through 0x276 before sound/message presentation. If the
# actor actually receives a coordinate write, the synchronous commit hook still
# recalls before the conflicting write.
for presentation in ((0x74,0x3d),(0x276,0xa6,0x43,0x4b),(0x276,0xa6,0x3d,0x4b)):
 snap=setup();event();opcode(0x2e);h.put(NPC+4,8);actor_pos(10,8)
 h.call(0x02166ec8,[NPC,9]);kept(snap)
 for code in presentation:opcode(code)
 kept(snap);opcode(0x2f);finish();kept(snap)
setup();event();opcode(0x2e);h.put(NPC+4,8);actor_pos(10,8)
uc.mem_write(VEC,bytes(uc.mem_read(h.A+68,12)));h.call(0x02167348,[NPC,VEC]);recalled(4)

# Private rail cursor follows rail direction/curve, not cardinal screen axes.
for crossing in (False,True):
 snap=setup();event();h.controller=2;h.put(NPC,1|8192);actor_pos(10,8 if crossing else 20)
 h.put(NPC+148,RAIL);h.put(RAIL,1);h.put(RAIL+120,MAN);uc.mem_write(RAIL+56,bytes(uc.mem_read(NPC+68,12)));old=bytes(uc.mem_read(RAIL,124))
 rail_curve=True;h.call(0x02166ec8,[NPC,0xb]);assert bytes(uc.mem_read(RAIL,124))==old
 if crossing:recalled(4)
 else:kept(snap)
setup();event();h.put(NPC,1|8192);h.put(NPC+148,0);h.call(0x02166ec8,[NPC,8]);recalled(7)
# Non-grid free movement is checked at its actual native world-position write.
snap=setup();event();h.controller=1;actor_pos(20,20);uc.mem_write(VEC,struct.pack('<iii',21*65536,0,20*65536));h.call(0x02167348,[NPC,VEC]);kept(snap)
setup();event();h.controller=1;actor_pos(10,8);uc.mem_write(VEC,bytes(uc.mem_read(h.A+68,12)));h.call(0x02167348,[NPC,VEC]);recalled(4)

# Direct placements and pool/ID conflicts are checked before native operations.
for target,reason in ((h.P,3),(NPC,4)):
 setup();event();actor_pos(20,20);uc.mem_write(VEC,bytes(uc.mem_read(h.A+68,12)));h.call(0x02167c0c,[target,VEC,0]);recalled(reason)
 assert observed[-1]==('position',target,0)
snap=setup();event();actor_pos(20,20);uc.mem_write(VEC,struct.pack('<iii',22*65536,0,22*65536));h.call(0x02167c0c,[NPC,VEC,0]);kept(snap)
for conflict in ('id','pool','space','safe'):
 snap=setup();event()
 if conflict=='id':h.half(ENTITY,0xf0)
 if conflict=='pool':h.put(NPC+256,1)
 if conflict=='space':h.half(ENTITY+28,10);h.half(ENTITY+30,9)
 h.call(ex[symbol_hash('FollowingEventAllocate')],[h.SYS,ENTITY])
 if conflict=='safe':kept(snap)
 else:recalled({'id':5,'pool':6,'space':4}[conflict]);assert observed[-1][2]==0
 # Actor absence persists after native locks clear while the event is live.
 if conflict!='safe':h.put(h.P+4,0);r.field_frame();assert not h.u32(h.F+24)
snap=setup();event();h.call(0x02166980,[NPC]);kept(snap)
setup();event();before=len(r.deletes);h.call(0x02166980,[h.A]);recalled(11);assert len(r.deletes)==before+1
setup();event();h.half(ENTITY,0xf0)
efuncs=elf_functions(PACKAGE_BUILD/'PokewebFollowingEventsW2.elf')[1]
args=[h.SYS,0,0,0]+list(struct.unpack('<9I',uc.mem_read(ENTITY,36)))
assert h.call(EBASE+efuncs['THUMB_BRANCH_LINK_12_0x02166836'][0],args)==h.A;recalled(5)
setup();event();uc.mem_write(VEC,struct.pack('<iii',0,0,0));before=len(observed);h.call(0x02167c0c,[h.A,VEC,0]);recalled(5)
assert not any(entry[0]=='position' for entry in observed[before:]) # no use after deletion

# Child replacement, nested VM lifetimes and bounded storage.
setup();event();uc.mem_write(h.FOREIGN,struct.pack('<5I',h.EVENT,0x02008001,0,0,h.GAME));h.put(h.GAME+0x18,h.FOREIGN)
h.call('fws_poll');recalled(2)
setup();event();uc.mem_write(h.FOREIGN,struct.pack('<5I',h.EVENT,0x02008009,0,0,h.GAME));h.put(h.GAME+0x18,h.FOREIGN)
assert h.call(0x02016cf8,[h.FOREIGN])==37;recalled(2);assert observed[-1]==('unknown-child',0)
snap=setup();event()
for i in range(3):
 vm=VM+i*64
 if i:uc.mem_write(vm,bytes(uc.mem_read(VM,64)))
 opcode(0x3d,vm)
kept(snap);finish()
snap=setup();event()
for i in range(60):
 vm=0x02210000+i*64;uc.mem_write(vm,bytes(uc.mem_read(VM,64)));opcode(0,vm)
 # VM_Free runs after its environment is freed; poison that pointer first.
 h.put(vm+0x2c,0xdead0000);h.call(0x020158f8,[vm]);kept(snap)
setup();event()
for i in range(49):
 vm=0x02210000+i*64;uc.mem_write(vm,bytes(uc.mem_read(VM,64)));opcode(0,vm)
recalled(9)
setup();event();h.put(h.F+20,2);r.field_frame();assert not h.u32(h.F+24) and h.u32(h.addr('FollowingDebug')+20)&1024

# Unbind before unload. Resident hooks must be transparent without a field.
setup();event();h.call('fws_detach');snap=bytes(uc.mem_read(debug,44))
opcode(0xffff);assert bytes(uc.mem_read(debug,44))==snap
callback_result=37;assert h.call(0x02016cf8,[h.EVENT])==37
assert not h.call('fws_poll')
for generation in range(2,12):
 h.put(h.F+20,generation);assert h.call('fws_attach',[h.SYS,h.F,generation,h.addr('scene_recall')|1])==1
 h.call('fws_detach')
print(f'Scene checks passed: two linked packaged DLLs; {h.CYCLES} retained-actor cycles; all 65536 opcode classifications; retail normal/extended VM dispatch; child events; bounded concurrent VMs; paused autonomous routes; sign/furniture presentation; grid/rail/world conflicts; elevation; player movement; allocation/deletion ordering; completion latch; unload/reload. Native UI/geometry services isolated; emulator acceptance pending.')
