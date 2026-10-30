"""Exercise exported rules in cold-boot DS-mode melonDS, without game stubs."""
import argparse, hashlib, json, shutil, subprocess, sys, tempfile
from pathlib import Path
from melonds import MelonDS


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('evidence',type=Path);p.add_argument('--start',type=int,default=0);p.add_argument('--limit',type=int)
    p.add_argument('--max-frames',type=int,default=12000)
    a=p.parse_args();manifest=json.loads((a.evidence/'cases.json').read_text())
    selected=manifest['cases'][a.start:a.start+a.limit if a.limit else None]
    results=[]
    with tempfile.TemporaryDirectory(prefix='pokeweb-rules-native-') as tmp:
        copies={}
        for name,digest in manifest['romHashes'].items():
            source=a.evidence/name;assert hashlib.sha256(source.read_bytes()).hexdigest()==digest
            target=Path(tmp)/name
            if sys.platform!='darwin' or subprocess.run(['cp','-c',str(source),str(target)],stderr=subprocess.DEVNULL).returncode:
                shutil.copyfile(source,target)
            copies[name]=target
        for spec in selected:
            rom=copies[spec['rom']];save=a.evidence/'saves'/f"{spec['label']}.sav"
            shutil.copyfile(save,rom.with_suffix('.sav'))
            emu=MelonDS();flow=0;code=0;menus=[];multipliers=[];errors=[];hooks=[];minimum={}
            result={'case':spec['label'],'itemId':spec['itemId'],'passed':False,'romSha256':manifest['romHashes'][spec['rom']]}
            def heap(fragment):
                address=next(value for name,value in manifest['pmcSymbols'].items() if fragment in name)
                value=emu.memory.read_long(address)
                if not 0x02000000<=value<0x02400000:return None
                capacity=emu.memory.read_long(value+8)
                if not 4096<=capacity<=1024*1024:return None
                node=emu.memory.read_long(value+12);seen=set();free=0
                while node:
                    assert node not in seen and 0x02000000<=node<0x02400000
                    seen.add(node);size=emu.memory.read_long(node);assert size<=capacity;free+=size
                    node=emu.memory.read_long(node+4)
                assert free<=capacity
                return {'capacity':capacity,'freePayloadBytes':free}
            def sample():
                for name,fragment in [('bookkeeping','g_UserHeapArea'),('system','g_MainAllocator')]:
                    stats=heap(fragment)
                    if stats and (name not in minimum or stats['freePayloadBytes']<minimum[name]['freePayloadBytes']):minimum[name]=stats
            def opening(cpu,address):
                nonlocal flow
                flow=emu.memory.register_arm9.r6
            def command(cpu,address):
                nonlocal code
                try:
                    if not flow or emu.memory.read_long(emu.memory.register_arm9.r1):return
                    turn=emu.memory.read_long(flow+16)
                    if menus and menus[-1]['turn']==turn:return
                    main=emu.memory.read_long(flow+4);player=emu.memory.read_long(main+0xcc);enemy=emu.memory.read_long(main+0xcc+0x1c)
                    state={'turn':turn,'frame':emu.frame_count,'hp':emu.memory.read_short(player+0x10),'maxHp':emu.memory.read_short(player+0xe),
                           'item':emu.memory.read_short(player+0x12),'consumedItem':emu.memory.read_short(player+0x14),'enemyHp':emu.memory.read_short(enemy+0x10), 'enemyMaxHp':emu.memory.read_short(enemy+0xe), 'stages':list(emu.memory.unsigned[player+0xfc:player+0x103]), 'conditions':[emu.memory.read_long(player+0x1c+n*4) for n in range(36)]}
                    assert emu.memory.read_short(player+0xc)==spec['speciesId']
                    assert state['maxHp']==spec['maxHp']
                    if not menus:
                        pass # Entry effects can already have changed HP, stages or consumed the item.
                        site=manifest['hook']+2
                        high=emu.memory.read_short(site);low=emu.memory.read_short(site+2)
                        assert emu.memory.read_short(manifest['hook'])==0xb500 and high&0xf800==0xf000 and low&0xf800==0xf800
                        delta=((high&0x7ff)<<12)|((low&0x7ff)<<1)
                        if delta&0x400000:delta-=0x800000
                        target=site+4+delta
                        code=target-manifest['symbols']['RuleDispatch']
                        result['moduleCodeBase']=code
                        assert 0x02000000<code<0x02400000
                        data=emu.memory.read_long(code+manifest['symbols']['ItemRuleData'])
                        expected=bytes.fromhex(manifest['configHex'])
                        actual=bytearray(emu.memory.unsigned[data:data+len(expected)])
                        for offset in manifest['nativeOffsets']:
                            pointer=int.from_bytes(actual[offset+8:offset+12],'little')
                            assert code<=pointer<code+manifest['codeBytes'],hex(pointer)
                            assert 1<=actual[offset+14]<=12
                            actual[offset+8:offset+12]=bytes(4);actual[offset+14]=0
                        assert bytes(actual)==expected,'Live rule configuration differs from the export'
                        node=emu.memory.read_long(next(value for name,value in manifest['pmcSymbols'].items() if 'g_Modules' in name))
                        states=[];ours=0
                        while node:
                            assert node not in states
                            states.append(node);ours+=emu.memory.read_long(node+8)==code-32
                            node=emu.memory.read_long(node+24)
                        assert ours==1,('Expected one shared item module',ours)
                        result['loader']={'totalPatchRecords':len(states),'itemPatchRecords':ours,'liveRuleCount':manifest['editedItems']}
                    menus.append(state)
                except Exception as error:errors.append(error)
            def multiplied(cpu,address):
                if not code or not menus:return
                lr=emu.memory.register_arm9.lr&~1
                native=manifest.get('nativeObservationRange',[0,0])
                if (code<=lr<code+manifest['codeBytes'] or native[0]<=lr<native[1]) and flow and not emu.memory.read_long(flow+0x774):
                    multipliers.append({'frame':emu.frame_count,'turnIndex':len(menus)-1,'key':emu.memory.register_arm9.r0,'value':emu.memory.register_arm9.r1})
            rewrites=[]
            def rewritten(cpu,address):
                if code and menus and code<=(emu.memory.register_arm9.lr&~1)<code+manifest['codeBytes']:
                    rewrites.append({'turnIndex':len(menus)-1,'key':emu.memory.register_arm9.r0,'value':emu.memory.register_arm9.r1})
            hooks.append(emu.memory.register_exec(manifest['api']['BattleEventVar_RewriteValue'],rewritten))
            hooks += [emu.memory.register_exec(manifest.get('openingHook',0x0219f5da),opening),emu.memory.register_exec(manifest.get('commandHook',0x021cef18),command),
                      emu.memory.register_exec(manifest['api']['BattleEventVar_MulValue'],multiplied)]
            try:
                emu.open(rom)
                for _ in range(a.max_frames):
                    if menus:emu.input.keypad_update(1 if emu.frame_count%12<3 else 0)
                    emu.cycle()
                    if errors:raise errors[0]
                    # Field overlays occupy these addresses before the battle
                    # loader is linked. Inspect heaps after the registry check.
                    if menus and emu.frame_count%30==0:sample()
                    if len(menus)>=3:break
                emu.input.keypad_update(0)
                assert len(menus)>=3,f'No two completed turns: {menus}'
                checks=spec.get('checks',{})
                if checks.get('survive'):assert menus[1]['hp']==1 and menus[2]['hp']==1,menus
                if checks.get('noDamage'):assert all(state['hp']==spec['maxHp'] for state in menus),menus
                if checks.get('unchangedHp'):assert all(state['hp']==spec['hp'] for state in menus),menus
                if 'healingFlat' in checks:assert [state['hp'] for state in menus]==[spec['hp']+checks['healingFlat']*n for n in range(3)],menus
                if 'enemyDamageDivisor' in checks:
                    amount=max(1,menus[0]['enemyMaxHp']//checks['enemyDamageDivisor'])
                    assert [state['enemyHp'] for state in menus]==[menus[0]['enemyHp']-amount*n for n in range(3)],menus
                if 'initialCondition' in checks:assert menus[0]['conditions'][checks['initialCondition']],menus
                if 'status' in checks:
                    states=menus[1:3]
                    for state in states:
                        present=[n for n in range(1,7) if state['conditions'][n]]
                        assert present==([checks['status']] if checks['status'] else []),(present,checks,menus)
                if checks.get('badPoison'):assert (menus[1]['conditions'][5]>>3)&63==15,menus[1]['conditions'][5]
                for stage,value in checks.get('initialStages',{}).items():assert menus[0]['stages'][int(stage)-1]==value,menus
                for stage,value in checks.get('stages',{}).items():
                    for state in menus[1:3]:assert state['stages'][int(stage)-1]==value,(stage,value,menus)
                for stage,values in checks.get('stagesPerTurn',{}).items():assert [state['stages'][int(stage)-1] for state in menus]==values,menus
                if 'lock' in checks:
                    for state in menus[1:3]:assert bool(state['conditions'][0x1b])==checks['lock'],menus
                if checks.get('consumed'):
                    for state in menus[1:3]:assert state['item']==0 and state['consumedItem']==spec['itemId'],menus
                if checks.get('retained'):
                    for state in menus:assert state['item']==spec['itemId'],menus
                if 'recoilPercent' in checks:
                    amount=max(1,spec['maxHp']*checks['recoilPercent']//100)
                    expected=[spec['hp'],spec['hp']-amount,spec['hp']-amount*(1 if checks.get('consumed') else 2)]
                    assert [state['hp'] for state in menus]==expected,(menus,expected)
                if 'healingDivisor' in checks:
                    amount=max(1,spec['maxHp']//checks['healingDivisor'])
                    assert [state['hp'] for state in menus]==[spec['hp'],spec['hp']+amount,spec['hp']+amount*2],menus
                if 'damageDivisor' in checks:
                    amount=max(1,spec['maxHp']//checks['damageDivisor'])
                    assert [state['hp'] for state in menus]==[spec['hp'],spec['hp']-amount,spec['hp']-amount*2],menus
                if 'initialHeal' in checks:assert menus[0]['hp']==min(spec['maxHp'],spec['hp']+checks['initialHeal']),menus
                if 'initialHealPercent' in checks:assert menus[0]['hp']==min(spec['maxHp'],spec['hp']+spec['maxHp']*checks['initialHealPercent']//100),menus
                if 'minimumHeal' in checks:assert menus[2]['hp']>=spec['hp']+checks['minimumHeal'],menus
                if checks.get('enemyDamaged'):assert menus[1]['enemyHp']<menus[0]['enemyHp'],menus
                if 'multiplier' in checks:
                    actual=[entry for entry in multipliers if entry['value']==checks['multiplier']]
                    assert any(entry['turnIndex']==0 for entry in actual),(checks,multipliers)
                    if checks.get('bothTurns'):assert any(entry['turnIndex']==1 for entry in actual),multipliers
                    if checks.get('firstTurnOnly'):assert not any(entry['turnIndex']>=1 for entry in actual),multipliers
                if 'critical' in checks:assert any(entry['key']==0x2c and entry['value']==checks['critical'] for entry in rewrites),(checks,rewrites)
                if 'moveType' in checks:assert any(entry['key']==0x16 and entry['value']==checks['moveType'] for entry in rewrites),(checks,rewrites)
                result.update(passed=True,menus=menus,multipliers=multipliers,rewrites=rewrites,minimumObservedFree=minimum)
                emu.run_frames(20);emu.screenshot().save(a.evidence/f"{spec['label']}.png")
                (a.evidence/f"{spec['label']}-result.json").write_text(json.dumps(result,indent=2)+'\n')
                results.append(result);print(f"PASS {spec['label']}: HP {[s['hp'] for s in menus]}, held {[s['item'] for s in menus]}",flush=True)
            except Exception as error:
                result.update(error=str(error),menus=menus,multipliers=multipliers,rewrites=rewrites,minimumObservedFree=minimum,pc=hex(emu.memory.register_arm9.pc))
                emu.screenshot().save(a.evidence/f"{spec['label']}-failure.png")
                (a.evidence/f"{spec['label']}-failure.json").write_text(json.dumps(result,indent=2)+'\n')
                raise
            finally:emu.destroy()
    (a.evidence/f'primitive-emulator-{a.start}-{len(results)}.json').write_text(json.dumps({'passed':len(results),'cases':results,'scope':'Cold-boot DS-mode melonDS; native engine, normal input, read-only hooks; no game-service stubs'},indent=2)+'\n')


if __name__=='__main__':main()
