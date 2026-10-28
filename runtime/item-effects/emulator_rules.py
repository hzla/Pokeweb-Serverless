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
                           'item':emu.memory.read_short(player+0x12),'consumedItem':emu.memory.read_short(player+0x14),'enemyHp':emu.memory.read_short(enemy+0x10)}
                    assert emu.memory.read_short(player+0xc)==spec['speciesId']
                    assert state['maxHp']==spec['maxHp']
                    if not menus:
                        assert state['hp']==spec['hp'] and state['item']==spec['itemId'],state
                        site=manifest['hook']+2
                        high=emu.memory.read_short(site);low=emu.memory.read_short(site+2)
                        assert emu.memory.read_short(manifest['hook'])==0xb500 and high&0xf800==0xf000 and low&0xf800==0xf800
                        delta=((high&0x7ff)<<12)|((low&0x7ff)<<1)
                        if delta&0x400000:delta-=0x800000
                        target=site+4+delta
                        code=target-manifest['symbols']['RuleDispatch']
                        assert 0x02000000<code<0x02400000
                        data=emu.memory.read_long(code+manifest['symbols']['ItemRuleData'])
                        expected=bytes.fromhex(manifest['configHex'])
                        assert bytes(emu.memory.unsigned[data:data+len(expected)])==expected,'Live rule configuration differs from the export'
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
                if code<=lr<code+manifest['codeBytes'] and flow and not emu.memory.read_long(flow+0x774):
                    multipliers.append({'frame':emu.frame_count,'turnIndex':len(menus)-1,'key':emu.memory.register_arm9.r0,'value':emu.memory.register_arm9.r1})
            hooks += [emu.memory.register_exec(0x0219f5da,opening),emu.memory.register_exec(0x021cef18,command),
                      emu.memory.register_exec(manifest['api']['BattleEventVar_MulValue'],multiplied)]
            try:
                emu.open(rom)
                for _ in range(a.max_frames):
                    if menus:emu.input.keypad_update(1 if emu.frame_count%12<3 else 0)
                    emu.cycle()
                    if errors:raise errors[0]
                    if emu.frame_count%30==0:sample()
                    if len(menus)>=3:break
                emu.input.keypad_update(0)
                assert len(menus)>=3,f'No two completed turns: {menus}'
                rules=spec['rules'];effects=rules['effects'];heal=0
                def active(node,hp):
                    if node['kind']=='group':
                        values=[active(child,hp) for child in node['children']]
                        return all(values) if node['mode']=='all' else any(values)
                    if node['kind']=='hp':
                        left=hp*100;right=spec['maxHp']*node['percent']
                        return {'lt':left<right,'lte':left<=right,'gt':left>right,'gte':left>=right}[node['comparison']]
                    if node['kind']=='type':match=node['value'] in spec['holderTypes']
                    else:match=node['value']==spec.get('expectedWeather',1)
                    return not match if node.get('negate') else match
                if spec.get('active',True) and not spec.get('healBlock'):
                    for effect in effects:
                        if effect['kind']=='healDivisor':heal+=max(1,spec['maxHp']//effect['value'])
                        if effect['kind']=='healPercent':heal+=max(1,int(spec['maxHp']*round(effect['value']*100)//10000))
                        if effect['kind']=='healFlat':heal+=effect['value']
                if not spec.get('enemyAttack'):
                    hp=spec['hp']
                    for turn,state in enumerate(menus[1:3]):
                        if (not rules['consumable'] or turn==0) and active(rules['conditions'],hp):hp=min(spec['maxHp'],hp+heal)
                        assert state['hp']==hp,(spec['label'],menus,hp)
                else:assert menus[1]['hp']<menus[0]['hp'],'The native opposing attack did not execute'
                kinds=[effect['kind'] for effect in effects]
                offensive=any(kind in ['attack','specialAttack','damage'] for kind in kinds)
                activation=spec.get('active',True) and (not spec.get('fullHp') or any(kind in ['attack','specialAttack','defense','specialDefense','speed','damage'] for kind in kinds)) and not spec.get('healBlock')
                spent=rules['consumable'] and activation
                for state in menus[1:3]:assert state['item']==(0 if spent else spec['itemId']),(spec['label'],state,'spent',spent)
                if spent:assert menus[1]['consumedItem']==spec['itemId'],menus
                if offensive and spec.get('active',True):assert menus[1]['enemyHp']<menus[0]['enemyHp'],'The boosted native attack did not deal damage'
                for effect in effects:
                    if effect['kind'].startswith('heal'):continue
                    ratio=round(effect['value']*4096)
                    actual=[entry for entry in multipliers if entry['value']==ratio and entry['key']==0x35]
                    if spec.get('active',True):assert any(entry['turnIndex']==0 for entry in actual),(spec['label'],multipliers)
                    else:assert not actual,(spec['label'],multipliers)
                    if spent:assert not any(entry['turnIndex']>=1 for entry in actual),(spec['label'],multipliers)
                result.update(passed=True,menus=menus,multipliers=multipliers,minimumObservedFree=minimum)
                emu.run_frames(20);emu.screenshot().save(a.evidence/f"{spec['label']}.png")
                (a.evidence/f"{spec['label']}-result.json").write_text(json.dumps(result,indent=2)+'\n')
                results.append(result);print(f"PASS {spec['label']}: HP {[s['hp'] for s in menus]}, held {[s['item'] for s in menus]}",flush=True)
            except Exception as error:
                result.update(error=str(error),menus=menus,multipliers=multipliers,minimumObservedFree=minimum,pc=hex(emu.memory.register_arm9.pc))
                emu.screenshot().save(a.evidence/f"{spec['label']}-failure.png")
                (a.evidence/f"{spec['label']}-failure.json").write_text(json.dumps(result,indent=2)+'\n')
                raise
            finally:emu.destroy()
    (a.evidence/f'rule-emulator-{a.start}-{len(results)}.json').write_text(json.dumps({'passed':len(results),'cases':results,'scope':'Cold-boot DS-mode melonDS; native engine, normal input, read-only hooks; no game-service stubs'},indent=2)+'\n')


if __name__=='__main__':main()
