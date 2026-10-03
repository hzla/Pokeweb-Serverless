"""Execute the packaged direct boot and its complete event lifecycle on ARM946."""
import json
from pathlib import Path
import struct
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'following-pokemon'))
from verify_packaged import audit, install_hooks, module_exports, read_module, relocate, symbol_hash
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import *

def verify(dll, elf, trainer, rule):
    audit(dll, elf)
    code, bss, symbols, relocations = read_module(dll)
    assert bss == 4
    assert not any(s[4] & 2 for s in symbols)
    assert sorted((r[0], r[1], r[2]) for r in relocations if r[1] != 255) == [(0x0215a790, 1, 5),(0x021ce9e4,0,1)]
    # Audited native procedure runner, direct placement/fade helpers, and view arrays.
    opening_code = bytes.fromhex('10b5041ce0300268002a0fd0211ce831201c0968ec309047002805d0201c0021e030ec3401602160002010bd201ce4300268002a0ed0211ce831201c0968ec309047002804d00020e4342060012010bd002010bd012010bd10b5041c0948a3f63ffb002806dc032010210022231c7cf69dfe10bd0c2010210022231c7cf696fe10bdc0466c000004f0b585b0071c0293081c006800910192002804d0012832d002283dd043e002980025002825d9381c0390483003904d208000001d04900198445d4d2080003858211ccbf7ebf9061c0498311c3858cbf707ffe9f773fe211c0ef04cfa0c20311c41430398401802f0fdfa02986d1c8542e1d300980068411c0098016013e015200001385c002802d005b00120f0bd0220c043fff79dffece70ef012fa002802d105b00120f0bd002005b0f0bd08b5024a0223fff7a5ff08bd70a91d0208b5024a0423fff79dff08bd72a91d0208b5024a0623fff795ff08bd76a91d02')
    positions = bytes.fromhex('010002030405020304050607')
    checks = 0
    music_table = [1132,1135,1145,1262,1130,1258,1137,1257,1260,1259,1267,1261,1258,1133]
    scenarios = [(base, tr, battle_rule, group, defeat) for base in (0x02300000, 0x02380004)
                 for tr, battle_rule in ((trainer, rule), (65535, 3), (123, 1), (456, 2), (0, 0))
                 for group in (0, 8, 13, 14, 255) for defeat in (False, True)]
    for base, tr, battle_rule, group, defeat in scenarios:
        uc = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
        uc.ctl_set_cpu_model(UC_CPU_ARM_946)
        uc.mem_map(0x02000000, 0x400000)
        uc.mem_map(0x04000000, 0x2000)
        uc.mem_write(0x04001000, struct.pack('<I',0x1713))
        # Execute the audited display wrapper itself, including its sub-screen
        # register read/modify/write; only its main-engine SDK call is stubbed.
        uc.mem_write(0x02046e0c,bytes.fromhex('08b52df077fd034a0120116800040843106008bd00100004'))
        uc.mem_write(0x021d12e0,opening_code)
        uc.mem_write(0x021da970,positions)
        uc.mem_write(base, bytes(relocate(dll, base)))
        exports = module_exports(dll, base)
        config = exports[symbol_hash('BattleHarnessConfig')]
        callback = exports[symbol_hash('BattleHarnessEvent')]
        assert struct.unpack('<IHHII', uc.mem_read(config, 16)) == (0x32484250, 5, trainer, rule, 0x57483242)
        uc.mem_write(config + 6, struct.pack('<HI', tr, battle_rule))
        install_hooks(uc, dll, base)
        game, init, data, event, work, bp = 0x02200000,0x02200100,0x02210000,0x02220000,0x02220100,0x02230000
        state = {'calls': [], 'freed': 0, 'busy': True}
        native = {0x0203ce38,0x0217c980,0x02016cb4,0x02016edc,0x02016ad8,0x02017df0,
                  0x020173ac,0x02017544,0x020171f4,0x02044264,0x02017c60,0x020185d0,
                  0x0203050c,0x020307f0,0x02018d68,0x02030828,0x02019370,0x020175b4,0x02034ee8,0x0201798c,
                  0x02016d68,0x0202fe7c,0x02016e38,0x02034f40,0x02169128,0x02017c84,
                  0x0202feb0,0x02016d50,0x02169114,0x0215a190,0x0201828c,0x020182c0,0x020182f4,0x02018328,
                  0x02046e0c,0x02074900,0x021d10c4,0x0219c784,0x0219d1c8,0x021bb0a4,
                  0x021df85c,0x021d39cc,0x020749c0,0x0204e08c,0x021df828}
        screen=0x02240000
        registers = [UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3]
        def spy(cpu, pc, size, user):
            if pc not in native: return
            args = [cpu.reg_read(r) for r in registers]
            assert cpu.reg_read(UC_ARM_REG_SP) % 8 == 0
            state['calls'].append((pc, args))
            result = 0
            if pc == 0x02046e0c: return # Run the real wrapper instructions.
            elif pc == 0x02074900: pass
            elif pc == 0x0219c784: assert args[0] == game; result = args[1]
            elif pc == 0x0219d1c8: assert args[0] == data; result = bp+0x100+args[1]*0x100
            elif pc == 0x021bb0a4: result = args[0]+0x40
            elif pc == 0x021df85c: assert args[:2] == [bp+0x140+args[1]*0x100,args[1]]
            elif pc == 0x021d39cc: assert (args[0]-screen-0x48)//12 in range(8)
            elif pc == 0x020749c0: assert args[0] == 0x0400006c; result = (group%3-1)&0xffffffff
            elif pc == 0x0204e08c: assert args == [12 if group%3==2 else 3,16,0,0xfffffffd]
            elif pc == 0x021df828: result = int(state['busy'])
            elif pc == 0x021d10c4:
                assert args[0] == screen
                uc.mem_write(screen+0x134,struct.pack('<2I',game,data))
                uc.mem_write(screen+0xe0,struct.pack('<4I',0,0x021d1639,screen,0))
                uc.mem_write(screen+0x150,bytes([args[1]]))
            elif pc == 0x0203ce38: assert args[0] == 35
            elif pc == 0x0217c980:
                assert args[:2] == [game,init]
                result = 0x02221000
            elif pc == 0x02016cb4:
                assert args == [game,0,callback,48]
                uc.mem_write(work, bytes(48))
                result = event
            elif pc == 0x02016edc: assert args[0] == event; result = work
            elif pc == 0x02016ad8: assert args[0] == game; result = data
            elif pc == 0x02017df0: uc.mem_write(args[0], struct.pack('<IIBBHBBH',0,0,0,0,0,10,0,0))
            elif pc == 0x020173ac: assert args[0] == data; result = 3
            elif pc == 0x020171f4: assert args[0] == data; result = data + 0x40
            elif pc == 0x02017544: assert args[0] == data + 0x40; result = 439
            elif pc == 0x02044264: uc.mem_write(args[0], struct.pack('<III',22,31,15))
            elif pc == 0x02017c60: assert args[0] == 4; result = bp
            elif pc in (0x0201828c,0x020182c0,0x020182f4,0x02018328):
                assert pc == 0x0201828c + 0x34*battle_rule
                assert args[:2] == [bp,data] and args[3] == tr
                assert struct.unpack('<I',cpu.mem_read(cpu.reg_read(UC_ARM_REG_SP),4))[0] == 4
                assert struct.unpack('<IIBBHBBH',cpu.mem_read(args[2],16)) == (9,0,0,3,439,22,31,0)
            elif pc == 0x020185d0: assert args[:3] == [bp,data,439]
            elif pc == 0x0203050c: assert args[:2] == [tr,1]; result = 97
            elif pc == 0x02018d68: assert args[0] == 439; result = 3
            elif pc == 0x02030828: assert args[:2] == [97,3]; result = 9
            elif pc == 0x020307f0: assert args[0] == 97; result = group
            elif pc == 0x020175b4: assert args[0] == data; result = data + 0x80
            elif pc == 0x0201798c: assert args[0] == data; result = data + 0x100
            elif pc == 0x02019370: assert args[0] == data + 0x80 and args[1] in (0,1)
            elif pc in (0x02034ee8,0x02034f40): assert args[0] == data + 0x100
            elif pc == 0x0202fe7c:
                assert args[:2] == [game, music_table[group] if group < 14 else 1130]
                result = 0x02222000
            elif pc == 0x02016d68: assert args[:2] in ([event,0x02222000],[event,0x02223000],[event,0x02221000])
            elif pc == 0x02016e38:
                assert args[0] == event
                if args[1] == 167: assert args[2:] == [0x021d6d20,bp]
                else:
                    assert args[1:] == [166,0x0219d6e0,work+12]
                    assert struct.unpack('<II',cpu.mem_read(work+12,8)) == (data,bp)
            elif pc == 0x02169128: assert args[:2] == [work,data] and state['freed'] == 0
            elif pc == 0x02017c84: assert args[0] == bp and state['freed'] == 0; state['freed'] += 1
            elif pc == 0x0202feb0: assert args[0] == game; result = 0x02223000
            elif pc == 0x02169114: assert args[0] == work and state['freed'] == 0; result = int(defeat)
            elif pc == 0x0215a190: assert args[0] == game; result = 0x02224000
            elif pc == 0x02016d50: assert args[:2] == [event,0x02224000 if defeat else 0x02221000] and state['freed'] == 1
            cpu.reg_write(UC_ARM_REG_R0,result)
            cpu.reg_write(UC_ARM_REG_PC,cpu.reg_read(UC_ARM_REG_LR))
        uc.hook_add(UC_HOOK_CODE,spy)
        def call(address, args, stop=0x02008000):
            nonlocal checks
            uc.reg_write(UC_ARM_REG_SP,0x023f0000)
            uc.reg_write(UC_ARM_REG_LR,0x02008001)
            for reg,value in zip(registers,args): uc.reg_write(reg,value)
            saved = [UC_ARM_REG_R4,UC_ARM_REG_R5,UC_ARM_REG_R6,UC_ARM_REG_R7]
            for reg in saved: uc.reg_write(reg,0x12345678)
            uc.emu_start(address|1,stop,count=10000)
            assert uc.reg_read(UC_ARM_REG_PC)==stop
            assert uc.reg_read(UC_ARM_REG_SP) == 0x023f0000
            assert all(uc.reg_read(reg) == 0x12345678 for reg in saved)
            checks += 1
            return uc.reg_read(UC_ARM_REG_R0)
        # New-game mode must retain native startup and not consume the latch.
        uc.mem_write(init,struct.pack('<I',0))
        assert call(0x0215a790,[game,init]) == 0x02221000
        assert struct.unpack('<I',uc.mem_read(0x04001000,4))[0] == 0x1713
        state['calls'].clear()
        uc.mem_write(init,struct.pack('<I',1))
        assert call(0x0215a790,[game,init]) == (event if tr else 0x02221000)
        if tr:
            assert not any(pc in (0x0203ce38,0x0217c980) for pc,args in state['calls'])
            assert struct.unpack('<III',uc.mem_read(work,12)) == (game,data,0)
            assert struct.unpack('<I',uc.mem_read(work+44,4))[0] == init
            sequence = event+8
            uc.mem_write(sequence,bytes(4))
            for step in range(5):
                state['calls'].clear()
                assert call(callback,[event,sequence,work]) == 0
                pcs = [pc for pc,args in state['calls']]
                if step < 4: assert not any(pc in (0x0203ce38,0x0217c980) for pc in pcs)
                if step == 0: assert struct.unpack('<H',uc.mem_read(bp+0x18,2))[0] == (music_table[group] if group<14 else 1130)
                if step == 1:
                    assert pcs == [0x02046e0c,0x02074900,0x02016e38]
                    assert struct.unpack('<I',uc.mem_read(0x04001000,4))[0] == 0x11713
                    call(0x021ce9e4,[screen,0],0x021ce9e8)
                    assert struct.unpack('<4I',uc.mem_read(screen+0xe0,16)) == (0,exports[symbol_hash('BattleHarnessPlace')],screen,0)
                    assert uc.mem_read(screen+0x150,1) == b'\0'
                    state['calls'].clear()
                    assert call(0x021d12e0,[screen]) == 0
                    views = [1,0] if battle_rule == 0 else list(range(2,6 if battle_rule == 1 else 8))
                    assert [args[1] for pc,args in state['calls'] if pc == 0x021df85c] == views
                    assert [(args[0]-screen-0x48)//12 for pc,args in state['calls'] if pc == 0x021d39cc] == views
                    assert struct.unpack('<I',uc.mem_read(screen+0xec,4))[0] == 1
                    state['calls'].clear()
                    assert call(0x021d12e0,[screen]) == 0
                    assert [pc for pc,args in state['calls']] == [0x020749c0,0x0204e08c]
                    assert struct.unpack('<I',uc.mem_read(screen+0xec,4))[0] == 2
                    assert call(0x021d12e0,[screen]) == 0 # Wait while resources/effects are busy.
                    state['busy']=False
                    assert call(0x021d12e0,[screen]) == 1
                    assert struct.unpack('<I',uc.mem_read(screen+0xe4,4))[0] == 0
                    # The arm is consumed; later entries retain native presentation.
                    call(0x021ce9e4,[screen,1],0x021ce9e8)
                    assert struct.unpack('<I',uc.mem_read(screen+0xe4,4))[0] == 0x021d1639
                    assert uc.mem_read(screen+0x150,1) == b'\1'
                if step == 3: assert state['freed'] == 1 and struct.unpack('<I',uc.mem_read(work+8,4))[0] == 0
                if step == 4: assert pcs == ([0x0215a190,0x02016d50] if defeat else [0x0203ce38,0x0217c980,0x02016d50])
                else: assert struct.unpack('<I',uc.mem_read(sequence,4))[0] == step+1
            assert state['freed'] == 1
        # Later native game-start requests and disabled templates never relaunch.
        for _ in range(3):
            state['calls'].clear()
            assert call(0x0215a790,[game,init]) == 0x02221000
            assert [pc for pc,args in state['calls']] == [0x0203ce38,0x0217c980]
        if not tr:
            call(0x021ce9e4,[screen,0],0x021ce9e8)
            assert struct.unpack('<I',uc.mem_read(screen+0xe4,4))[0] == 0x021d1639
    return {'cpuChecks':checks,'codeBytes':len(code),'bssBytes':bss,'fixedPayloadBytes':len(code)+bss,
            'temporaryEventBytes':68,'bootPath':'direct-save-to-battle','openingPresentation':'direct-placement'}

if __name__ == '__main__':
    print(json.dumps(verify(Path(sys.argv[1]),Path(sys.argv[2]),int(sys.argv[3]),int(sys.argv[4]))))
