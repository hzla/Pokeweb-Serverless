"""Execute the compiled side-effect callbacks under Thumb emulation."""
import struct
from unicorn.arm_const import UC_ARM_REG_LR, UC_ARM_REG_PC, UC_ARM_REG_R0
from test_history_runtime import HistoryHarness
from test_runtime import STUB, FLOW, effect

SIDE=0x02290000
FACTOR=0x022a0000
class SideHarness(HistoryHarness):
 def __init__(self):
  super().__init__();self.put(self.symbols['MoveNativeSideState'],SIDE)
  for i in (12,13):self.put(self.symbols['MoveHistoryApi']+4*i,STUB+(64+i)*4+1)
 def hook(self,u,pc,size,data):
  if pc in (STUB+76*4,STUB+77*4):
   u.reg_write(UC_ARM_REG_R0,0);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR));return
  return super().hook(u,pc,size,data)
 def web(self,side):return self.u.mem_read(self.symbols['moveWeb']+side*4,4)[0]

def place(h,side=1,amount=-1,stat=5):
 h.install(effects=[effect(kind=57,phase=6,value=amount,arg=stat,parameters=(side,))]);h.vars.update({3:0,4:12,0x12:1});h.call('MoveEvent_a0')

h=SideHarness();h.invoke('MoveHistoryInit');place(h)
assert h.web(1)==1 and h.web(0)==0
h.vars[2]=12;h.event(0x55);assert h.stats[(12,5)]==5
h.vars[2]=0;h.event(0x55);assert h.stats.get((0,5),6)==6
place(h,side=0,amount=-2,stat=2);h.vars[2]=0;h.event(0x55);assert h.stats[(0,2)]==4
h.vars.update({3:0,6:12});h.invoke('MoveDefog',0,FLOW,0,0);assert h.web(1)==0 and h.web(0)==1
h.invoke('MoveRapidSpin',0,FLOW,0,0);assert h.web(0)==0
print('Entry hazard activation, editable stat changes, and removal hooks passed Thumb emulation.')

h=SideHarness();h.invoke('MoveHistoryInit');place(h)
slot=SIDE+(14+6)*16;h.put(slot,FACTOR);h.put(slot+4,0x12345678);h.put(slot+8,3);h.put(slot+12,2)
h.put(FACTOR+16,2);h.u.mem_write(FACTOR+0x38,struct.pack('<HBB',6,1,31))
h.install(effects=[effect(kind=58,phase=6,value=1)]);h.vars.update({3:0,4:0,0x12:1});h.call('MoveEvent_a0')
assert h.web(0)==1 and h.web(1)==0
assert struct.unpack('<IIII',h.u.mem_read(SIDE+6*16,16))==(FACTOR,0x12345678,3,2)
assert h.u.mem_read(FACTOR+0x3a,1)[0]==0 and struct.unpack('<I',h.u.mem_read(slot,4))[0]==0
h.put(SIDE+14*16,0x01000000);before=bytes(h.u.mem_read(SIDE,448));h.call('MoveEvent_a0')
assert bytes(h.u.mem_read(SIDE,448))==before and h.web(0)==1, 'Unknown side records fail before mutation'
print('Side exchange preserves native records and rejects unrecognized factors atomically.')
h=SideHarness();h.invoke('MoveHistoryInit');place(h);other=FACTOR+0x100;h.sideNodes[0]=other;h.put(other+16,2);h.u.mem_write(other+0x38,struct.pack('<HBB',99,0,31))
h.install(effects=[effect(kind=58,phase=6,value=1)]);h.vars.update({3:0,4:0,0x12:1});h.call('MoveEvent_a0')
assert h.web(1)==1 and h.web(0)==0, 'An unknown custom side effect prevents a partial exchange'
print('Unreviewed side factors block the exchange.')
from test_runtime import leaf,group
h=SideHarness();h.invoke('MoveHistoryInit');h.weather=3
h.install(conditions=group('all',group('any',leaf(3,1),leaf(4,25))),effects=[effect(kind=57,phase=6,value=-1,arg=5,parameters=(1,))]);h.vars.update({3:0,4:12,0x12:1});h.call('MoveEvent_a0')
assert not h.web(1) and h.queries==1
h.weather=1;h.call('MoveEvent_a0');assert h.web(1) and h.queries==2
h.vars[2]=12;h.event(0x55);assert h.queries==2,'Switch-in must not repeatedly query weather'
h.invoke('MoveHistoryInit');assert not h.web(0) and not h.web(1),'Each battle starts without stale hazards'
print('Nested conditions and bounded weather checks passed Thumb emulation.')
