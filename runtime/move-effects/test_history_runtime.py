"""Execute the compiled history callbacks and conditions in Thumb emulation."""
import struct
from unicorn.arm_const import UC_ARM_REG_LR, UC_ARM_REG_PC, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_SP
from test_runtime import Harness, STUB, STOP, STACK, FLOW, MON, effect, leaf


class HistoryHarness(Harness):
    def __init__(self):
        super().__init__()
        self.nativeSelection=0
        for index in range(8):
            self.put(self.symbols['MoveHistoryApi'] + index * 4, STUB + (64 + index) * 4 + 1)
        self.put(self.symbols['MoveHistoryCount'], 0)

    def hook(self, u, pc, size, data):
        if STUB + 64 * 4 <= pc < STUB + 72 * 4:
            index=(pc-STUB)//4-64
            if index == 2:
                mon=u.reg_read(UC_ARM_REG_R1)
                self.items[(mon-MON)//0x200]=0
            if index == 5:
                params=u.reg_read(UC_ARM_REG_R1);ident=struct.unpack('<I',bytes(u.mem_read(params,4)))[0]>>8&31
                self.items[ident]=0
            u.reg_write(UC_ARM_REG_R0, 0 if index == 4 else self.nativeSelection if index==6 else 1)
            u.reg_write(UC_ARM_REG_PC, u.reg_read(UC_ARM_REG_LR))
            return
        return super().hook(u, pc, size, data)

    def invoke(self, name, *args):
        for reg,value in zip([UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3],args):
            self.u.reg_write(reg,value)
        self.u.reg_write(UC_ARM_REG_SP,STACK);self.u.reg_write(UC_ARM_REG_LR,STOP|1)
        self.u.emu_start(self.symbols[name]|1,STOP,count=50000)
        assert self.u.reg_read(UC_ARM_REG_PC)==STOP
        return self.u.reg_read(UC_ARM_REG_R0)

    def event(self, number):
        self.invoke(f'MoveHistoryEvent_{number:02x}',0,FLOW,31,0)

    def power(self, condition):
        self.install(effects=[effect(conditions=condition)])
        self.call('MoveEvent_37')
        return self.vars[0x30]


def run():
    h=HistoryHarness();h.invoke('MoveHistoryInit')
    assert h.power(leaf(20,1))==40
    h.items[0]=158;h.invoke('MoveHistoryChangeItem',FLOW,MON,0,1)
    assert h.power(leaf(20,1))==80
    h.invoke('MoveHistoryInit');assert h.power(leaf(20,1))==40
    params=FLOW+0x500;h.put(params,12<<8);h.put(params+4,1);h.items[12]=158
    h.invoke('MoveHistoryConsumeWork',FLOW,params)
    h.vars[4]=12;assert h.power(leaf(20,1,subject=1))==40,'Removing a Berry for a forced use does not credit its previous holder'
    h.put(params+4,0);h.items[12]=158;h.invoke('MoveHistoryConsumeWork',FLOW,params)
    assert h.power(leaf(20,1,subject=1))==80,'Ordinary consumption credits its holder'

    h.vars.update({2:0,0x20:1});h.event(0x5d)
    assert h.power(leaf(24,1))==80
    h.vars.update({2:0,0x20:-1});h.event(0x5d)
    assert h.power(leaf(25,1))==80
    h.vars[2]=31;h.event(0x78)
    assert h.power(leaf(24,1))==40 and h.power(leaf(25,1))==40

    h.vars.update({3:1,4:0,0x32:20,0x46:0});h.event(0x4b);h.event(0x4b)
    assert h.power(leaf(22,2))==80 and h.power(leaf(22,3))==40
    assert h.invoke('MoveHistoryTransform',MON+0x200,MON,FLOW)==1
    h.vars[4]=1;assert h.power(leaf(22,2,subject=1))==80, 'Transform copies the target hit count'
    h.vars[4]=0

    h.install(effects=[effect(kind=42,phase=0,value=25,arg=0,parameters=(1,))]);h.call('MoveEvent_37')
    assert h.vars[0x30]==65, 'The increment and count limit are editable'
    h.install(effects=[effect(kind=42,phase=0,value=25,arg=0,parameters=(4,))]);h.call('MoveEvent_37')
    assert h.vars[0x30]==90
    h.stats[(1,13)]=0;h.vars[2]=1;h.event(0xa3);h.event(0xa3)
    assert h.power(leaf(23,1))==80 and h.power(leaf(23,2))==40
    h.install(effects=[effect(kind=42,phase=0,value=30,arg=1,parameters=(5,))]);h.call('MoveEvent_37')
    assert h.vars[0x30]==70
    h.stats[(1,13)]=50;h.vars[2]=1;h.event(0x55)
    h.stats[(1,13)]=0;h.event(0xa3)
    assert h.power(leaf(23,2))==80, 'A revived Pokémon can faint and be counted again'
    h.simulated=True;h.vars.update({3:1,4:0,0x32:20,0x46:0});h.event(0x4b);h.simulated=False
    assert h.power(leaf(22,3))==40, 'Preview calculations cannot change hit history'

    h.vars.update({3:0,0x12:45});h.event(3)
    h.vars.update({2:0,0x51:0});h.event(4)
    h.vars[2]=31;h.event(0x78)
    assert h.power(leaf(21,1))==80 and h.power(leaf(26,45))==80
    assert h.power(leaf(26,46))==40
    h.vars[2]=31;h.event(0x78)
    assert h.power(leaf(21,1))==40 and h.power(leaf(26,45))==40
    h.vars.update({3:0,0x12:45});h.event(3);h.invoke('MoveHistoryProtect',FLOW,MON,MON+0x200,45)
    h.vars.update({2:0,0x51:0});h.event(4);h.vars[2]=31;h.event(0x78)
    assert h.power(leaf(21,1))==40, 'Protect does not count as a failed move'
    message=FLOW+0x900
    h.install(effects=[effect(kind=43,phase=14,value=1,arg=1,parameters=(0,),conditions=leaf(26,0))])
    assert h.invoke('MoveHistorySelect',FLOW,MON,1,message)==0
    h.vars.update({3:0,0x12:1});h.event(3);h.vars.update({2:0,0x51:1});h.event(4);h.vars[2]=31;h.event(0x78)
    assert h.invoke('MoveHistorySelect',FLOW,MON,1,message)==1
    assert struct.unpack('<H',bytes(h.u.mem_read(message,2)))[0]==905
    h.install(effects=[effect(kind=43,phase=14,value=1,arg=0,parameters=(1,),conditions=leaf(20,0))])
    assert h.invoke('MoveHistorySelect',FLOW,MON,1,message)==1
    assert struct.unpack('<H',bytes(h.u.mem_read(message,2)))[0]==905
    h.items[0]=158;h.invoke('MoveHistoryChangeItem',FLOW,MON,0,1)
    assert h.invoke('MoveHistorySelect',FLOW,MON,1,message)==0
    h.nativeSelection=1;assert h.invoke('MoveHistorySelect',FLOW,MON,1,0)==1
    h.invoke('MoveHistoryInit')
    assert h.power(leaf(22,1))==40 and h.power(leaf(23,1))==40
    print('History callbacks and conditions passed Thumb emulation.')


if __name__=='__main__':run()
