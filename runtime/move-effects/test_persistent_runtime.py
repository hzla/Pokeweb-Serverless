"""Exercise private transient effects in the compiled Thumb interpreter."""
from test_history_runtime import HistoryHarness
from test_runtime import effect, leaf

h=HistoryHarness()
h.invoke('MoveHistoryInit')
h.install(effects=[effect(kind=44,phase=8,value=6144,arg=1)])
h.call('MoveEvent_4d')
h.vars.update({4:0,0x35:4096,0x51:0})
h.event(0x47);h.event(0x1c)
assert h.vars[0x35]==6144 and h.vars[0x51]==1, 'Configured ratio and accuracy apply to the move user'
h.vars.update({4:1,0x35:4096,0x51:0});h.event(0x47);h.event(0x1c)
assert h.vars[0x35]==4096 and not h.vars[0x51], 'Other battlers remain unchanged'
h.vars.update({2:0,4:0,0x35:4096});h.simulated=True;h.event(1);h.event(0x47)
assert h.vars[0x35]==6144, 'Preview calculations read but do not expire the live effect'
h.simulated=False;h.event(1);h.vars[0x35]=4096;h.event(0x47)
assert h.vars[0x35]==4096, 'The effect expires when the user next acts'
for event in (0x54,0xa3):
 h.call('MoveEvent_4d');h.vars[2]=0;h.event(event);h.vars.update({4:0,0x35:4096});h.event(0x47)
 assert h.vars[0x35]==4096, 'Switching or fainting clears the effect'
h.call('MoveEvent_4d');h.invoke('MoveHistoryInit');h.vars.update({4:0,0x35:4096});h.event(0x47)
assert h.vars[0x35]==4096, 'Starting another battle clears the effect'
h=HistoryHarness();h.invoke('MoveHistoryInit')
h.install(effects=[effect(kind=45,phase=4,target=1,value=8,arg=4,parameters=(10,8,0)),effect(conditions=leaf(27,0,subject=1))])
h.vars.update({3:0,4:1,0x32:10,0x46:0});h.call('MoveEvent_4b');h.call('MoveEvent_37');assert h.vars[0x30]==80, 'The move can detect its active recurring effect';h.vars[2]=1;h.event(0x77)
assert h.stats[(1,13)]==38, 'Recurring damage uses maximum HP and rounds down'
h.types[1]=(10,3);h.event(0x77)
assert h.stats[(1,13)]==13, 'The selected type uses its edited denominator'
h.vars[2]=1;h.event(0x54);h.stats[(1,13)]=50;h.event(0x77)
assert h.stats[(1,13)]==50, 'Switching clears recurring damage'
h=HistoryHarness();h.invoke('MoveHistoryInit')
h.install(effects=[effect(kind=46,phase=4,target=1,value=-1,arg=5,parameters=(2,1))])
h.vars.update({3:0,4:1,0x32:10,0x46:0});h.call('MoveEvent_4b');h.vars[2]=1
h.event(0x77);h.event(0x77);h.event(0x77)
assert h.stats[(1,5)]==4, 'Recurring stat changes expire after the configured number of turns'
h.call('MoveEvent_4b');h.vars[2]=0;h.event(0x54);h.vars[2]=1;h.event(0x77)
assert h.stats[(1,5)]==4, 'A linked recurring effect ends when its source leaves'
print('Transient and recurring effect callbacks passed Thumb emulation.')
h=HistoryHarness();h.invoke('MoveHistoryInit')
h.install(effects=[effect(kind=47,phase=6,value=12,arg=0)])
h.vars.update({3:0,4:1,0x12:1});h.call('MoveEvent_a1')
h.vars.update({2:1,0x16:0});h.event(0x28);assert h.vars[0x16]==12, 'The chosen field type is converted'
h.vars.update({2:1,0x16:10});h.event(0x28);assert h.vars[0x16]==10, 'Unmatched types are unchanged'
h.install(effects=[effect(kind=48,phase=6,target=1,value=10)])
h.vars.update({3:0,4:1,0x12:1});h.call('MoveEvent_a0')
h.vars.update({2:1,0x16:0});h.event(0x28);assert h.vars[0x16]==10, 'Recipient conversion takes precedence over field conversion'
h.vars.update({2:1,0x51:1});h.event(4);h.vars[0x16]=0;h.event(0x28);assert h.vars[0x16]==12
h.vars[2]=31;h.event(0x78);h.vars.update({2:1,0x16:0});h.event(0x28);assert h.vars[0x16]==0, 'Turn end clears conversions'
print('Field and recipient conversion callbacks passed Thumb emulation.')
h=HistoryHarness();h.invoke('MoveHistoryInit')
h.install(effects=[effect(kind=49,phase=6,value=1,arg=31)])
h.vars.update({3:0,4:0,0x12:1});h.call('MoveEvent_a0')
assert all(h.stats[(0,i)]==7 for i in range(1,6)) and h.conditions[(0,22)], 'The first use raises the selected stats and applies the native trap'
h.call('MoveEvent_a0');assert all(h.stats[(0,i)]==7 for i in range(1,6)), 'A self-trapped user cannot repeat the effect'
h.vars[2]=0;h.event(0x54);h.conditions[(0,22)]=False;h.call('MoveEvent_a0')
assert all(h.stats[(0,i)]==8 for i in range(1,6)), 'Switching resets the self-trap restriction'
print('Self-trap stat boost passed Thumb emulation.')
h=HistoryHarness();h.invoke('MoveHistoryInit')
h.install(effects=[effect(kind=50,phase=4,target=1,value=1)])
h.vars.update({3:0,4:1,0x12:1,0x32:10,0x46:0});h.call('MoveEvent_4b')
assert h.conditions[(0,22)] and h.conditions[(1,22)], 'A direct hit links escape prevention in both directions'
h=HistoryHarness();h.invoke('MoveHistoryInit');h.types[1]=(7,7)
h.install(effects=[effect(kind=50,phase=4,target=1,value=1)])
h.vars.update({3:0,4:1,0x12:1,0x32:10,0x46:0});h.call('MoveEvent_4b')
assert not h.conditions.get((1,22)) and h.conditions[(0,22)], 'Ghost immunity prevents trapping that Pokémon'
print('Mutual source-linked trapping passed Thumb emulation.')

h=HistoryHarness();h.invoke('MoveHistoryInit')
h.install(effects=[effect(kind=51,phase=6,target=1,value=13,arg=4)])
h.vars.update({3:0,4:1,0x12:1});h.call('MoveEvent_a0');h.vars.update({2:1,0x12:1})
h.invoke('MovePersistentEvent_1f',0,0x02250000,31,0)
assert h.vars[0x22]==0x19 and h.vars[0x41]==1 and h.stats[(1,13)]==25, 'A matching move is prevented and causes maximum-HP damage'
h.vars.update({0x22:0,0x41:0});h.invoke('MovePersistentEvent_1f',0,0x02250000,31,0)
assert not h.vars[0x41] and h.stats[(1,13)]==25, 'The reaction is consumed after activation'
print('Matching-move reaction passed Thumb emulation.')
from test_runtime import STUB, FLOW, MON
from unicorn.arm_const import UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_PC, UC_ARM_REG_LR
class FlagHarness(HistoryHarness):
 def __init__(self):
  super().__init__();self.put(self.symbols['MoveHistoryApi']+32,STUB+72*4+1)
 def hook(self,u,pc,size,data):
  if pc==STUB+72*4:
   u.reg_write(UC_ARM_REG_R0,int(u.reg_read(UC_ARM_REG_R0)==1 and u.reg_read(UC_ARM_REG_R1)==8))
   u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR));return
  return super().hook(u,pc,size,data)
h=FlagHarness();h.invoke('MoveHistoryInit');h.install(effects=[effect(kind=52,phase=4,target=1,value=8,arg=2)])
h.vars.update({3:0,4:1,0x12:1,0x32:10,0x46:0});h.call('MoveEvent_4b')
assert h.invoke('MoveHistorySelect',FLOW,MON+0x200,1,FLOW+0x900)==1
assert h.invoke('MoveHistorySelect',FLOW,MON+0x200,2,FLOW+0x900)==0
h.vars.update({2:1,0x12:1,0x41:0});h.invoke('MovePersistentEvent_1f',0,FLOW,31,0)
assert h.vars[0x41]==1, 'The flag restriction also blocks called moves'
h.vars[2]=31;h.event(0x78);assert h.invoke('MoveHistorySelect',FLOW,MON+0x200,1,FLOW+0x900)==1
h.vars[2]=31;h.event(0x78);assert h.invoke('MoveHistorySelect',FLOW,MON+0x200,1,FLOW+0x900)==0
print('Timed move-flag restrictions passed Thumb emulation.')
class FocusHarness(HistoryHarness):
 def __init__(self):
  super().__init__();self.put(self.symbols['MoveHistoryApi']+36,STUB+73*4+1)
 def hook(self,u,pc,size,data):
  if pc==STUB+73*4:
   u.reg_write(UC_ARM_REG_R0,0);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR));return
  return super().hook(u,pc,size,data)
h=FocusHarness();h.invoke('MoveHistoryInit');h.install(effects=[effect(kind=53,phase=6,value=2)])
h.vars.update({3:0,4:0,0x12:1});h.call('MoveEvent_a0');assert h.invoke('MoveFocusedCritical',0)==1
h.vars[2]=31;h.event(0x78);assert h.invoke('MoveFocusedCritical',0)==1
h.vars[2]=31;h.event(0x78);assert h.invoke('MoveFocusedCritical',0)==0, 'Critical focus expires at the second turn boundary'
print('Time-limited critical focus passed Thumb emulation.')
h=HistoryHarness();h.invoke('MoveHistoryInit');h.active.add(2)
h.install(effects=[effect(kind=45,phase=4,target=1,value=8,arg=4,parameters=(10,8,n)) for n in range(16)])
h.vars.update({3:0,0x12:1,0x32:10,0x46:0})
for target in (1,12,13):h.vars[4]=target;h.call('MoveEvent_4b')
h.vars[4]=2;h.call('MoveEvent_4b')
assert any(kind==4 for kind,_ in h.work), 'An exhausted effect pool reports failure instead of overwriting active state'
print('Recurring-effect capacity is bounded and reports failed applications.')
h=FlagHarness();h.invoke('MoveHistoryInit');h.install(effects=[effect(kind=54,phase=6,target=1,value=1)])
h.vars.update({3:0,4:1,0x12:1});h.call('MoveEvent_a0')
h.vars.update({3:12,4:0,0x12:1});h.invoke('MoveSpotlightRedirect',0,FLOW,31,0)
assert h.vars[4]==1, 'Eligible opposing attacks redirect to the marked Pokémon'
h.vars.update({3:0,4:12,0x12:1});h.invoke('MoveSpotlightRedirect',0,FLOW,31,0)
assert h.vars[4]==12, 'Attacks from the same side are not redirected'
h.vars[2]=1;h.event(0x54);h.vars.update({3:12,4:0,0x12:1});h.invoke('MoveSpotlightRedirect',0,FLOW,31,0)
assert h.vars[4]==0, 'The marked Pokémon leaving clears redirection'
print('Temporary target redirection passed Thumb emulation.')
class CritHarness(HistoryHarness):
 def __init__(self):
  super().__init__();self.flags={};self.put(self.symbols['MoveHistoryApi']+40,STUB+74*4+1)
 def hook(self,u,pc,size,data):
  if pc==STUB+74*4:
   u.reg_write(UC_ARM_REG_R0,2);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR));return
  if pc==STUB+55*4:
   ident=(u.reg_read(UC_ARM_REG_R0)-MON)//0x200;flag=u.reg_read(UC_ARM_REG_R1)
   u.reg_write(UC_ARM_REG_R0,int(self.flags.get((ident,flag),False)));u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR));return
  if pc==STUB+11*4 and self.pending and self.pending[-1][0]==23:
   p=u.reg_read(UC_ARM_REG_R1);raw=bytes(u.mem_read(p,9));self.flags[(raw[8],int.from_bytes(raw[4:8],'little'))]=True
  return super().hook(u,pc,size,data)
h=CritHarness();h.invoke('MoveHistoryInit');h.types[0]=(15,15);h.u.mem_write(MON+0x142,b'\x01')
h.install(effects=[effect(kind=55,phase=6,value=1,arg=15,parameters=(2,))])
h.vars.update({3:0,4:0,0x12:1});h.call('MoveEvent_a0')
assert h.flags[(0,9)] and h.invoke('MoveCriticalRank',MON)==3, 'Matching types receive the enhanced critical stage'
h.invoke('MoveHistoryTransform',MON+0x200,MON,FLOW)
h.u.mem_write(MON+0x200+0x142,b'\x01')
assert h.flags[(1,9)] and h.invoke('MoveCriticalRank',MON+0x200)==3, 'Transform copies the critical boost'
h.vars.update({0x12:244,3:1,6:0});h.event(0xa0)
assert h.invoke('MoveCriticalRank',MON+0x200)==3, 'Psych Up preserves the copied critical boost'
print('Critical-stage boosting and copy tracking passed Thumb emulation.')
h=HistoryHarness();h.invoke('MoveHistoryInit');h.install(effects=[effect(kind=56,phase=6,value=2)])
h.vars.update({3:0,4:0,0x12:1});h.call('MoveEvent_a0')
assert h.invoke('MoveFieldSwitchCheck',MON,22)==1
h.types[1]=(7,7)
assert h.invoke('MoveFieldSwitchCheck',MON+0x200,22)==0, 'Ghost types retain native switching rules'
h.vars.update({2:0,0x41:0});h.event(0x0c);assert h.vars[0x41]==1
h.vars[2]=31;h.event(0x78);assert h.invoke('MoveFieldSwitchCheck',MON,22)==1
h.vars[2]=31;h.event(0x78);assert h.invoke('MoveFieldSwitchCheck',MON,22)==0
print('Timed field switch restriction passed Thumb emulation.')
class PassHarness(CritHarness):
 def __init__(self):
  super().__init__();self.put(self.symbols['MoveHistoryApi']+44,STUB+75*4+1)
 def hook(self,u,pc,size,data):
  if pc==STUB+75*4:
   u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR));return
  return super().hook(u,pc,size,data)
h=PassHarness();h.invoke('MoveHistoryInit');h.install(effects=[effect(kind=55,phase=6,value=1,arg=15,parameters=(2,))])
h.vars.update({3:0,4:0,0x12:1});h.call('MoveEvent_a0');h.vars[2]=0;h.event(0x54)
h.invoke('MovePassEffects',MON+0x200,MON);h.flags[(1,9)]=True
assert h.invoke('MoveCriticalRank',MON+0x200)==1, 'Baton Pass carries the recipe boost after switch-out'
print('Critical-stage Baton Pass transfer passed Thumb emulation.')
