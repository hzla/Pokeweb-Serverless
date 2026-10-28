"""Observe real AI trapping checks in cold-boot DS-mode native battles."""
import argparse, hashlib, json, shutil, subprocess, sys, tempfile
from pathlib import Path
from melonds import MelonDS

p=argparse.ArgumentParser(description=__doc__);p.add_argument('evidence',type=Path)
p.add_argument('--start',type=int,default=0);p.add_argument('--limit',type=int)
p.add_argument('--max-frames',type=int,default=12000)
a=p.parse_args();manifest=json.loads((a.evidence/'client-cases.json').read_text());results=[]
with tempfile.TemporaryDirectory(prefix='pokeweb-item-client-') as tmp:
    for spec in manifest['cases'][a.start:a.start+a.limit if a.limit else None]:
        source=a.evidence/f"{spec['label']}.nds";assert hashlib.sha256(source.read_bytes()).hexdigest()==spec['sha256']
        rom=Path(tmp)/'client.nds'
        if sys.platform!='darwin' or subprocess.run(['cp','-c',str(source),str(rom)],stderr=subprocess.DEVNULL).returncode:shutil.copyfile(source,rom)
        shutil.copyfile(a.evidence/f"{spec['label']}.sav",rom.with_suffix('.sav'))
        emu=MelonDS();queries=[];pending={};returns={};hooks=[];menus=[];flow=[0]
        def opening(cpu,address):flow[0]=emu.memory.register_arm9.r6
        def command(cpu,address):
            if flow[0] and not emu.memory.read_long(emu.memory.register_arm9.r1):
                turn=emu.memory.read_long(flow[0]+16)
                if not menus or menus[-1]!=turn:menus.append(turn)
        def returned(cpu,address):
            if address not in pending:return
            query=pending.pop(address);query['result']=emu.memory.register_arm9.r0
            query['restoredItem']=emu.memory.read_short(query['mon']+0x12);queries.append(query)
        def checking(cpu,address):
            mon=emu.memory.register_arm9.r1
            if not 0x02000000<=mon<0x02400000:return
            if emu.memory.read_short(mon+0x12)!=spec['itemId'] or emu.memory.read_short(mon+0xc)!=spec.get('species',320):return
            destination=emu.memory.register_arm9.lr&~1
            pending[destination]={'mon':mon,'frame':emu.frame_count,'item':spec['itemId']}
            if destination not in returns:returns[destination]=emu.memory.register_exec(destination,returned)
        hooks += [emu.memory.register_exec(0x0219f5da,opening),emu.memory.register_exec(0x021cef18,command),emu.memory.register_exec(spec['hook'],checking)]
        try:
            emu.open(rom)
            for _ in range(a.max_frames):
                if menus:emu.input.keypad_update(1 if emu.frame_count%12<3 else 0)
                emu.cycle()
                if len(menus)>=3:break
            assert len(menus)>=3,menus
            assert len(queries)>=2,queries
            assert all(query['result']==spec['expected'] and query['restoredItem']==spec['itemId'] for query in queries),queries
            result={'case':spec['label'],'passed':True,'romSha256':spec['sha256'],'queries':queries,'turns':menus[:3],
                    'scope':'Native AI called CanMonSwitch normally; read-only entry/return hooks; no game-service stubs or injected calls'}
            emu.screenshot().save(a.evidence/f"{spec['label']}.png")
            (a.evidence/f"{spec['label']}-result.json").write_text(json.dumps(result,indent=2)+'\n')
            results.append(result);print(f"PASS {spec['label']}: native trapping result {spec['expected']}, {len(queries)} queries",flush=True)
        except Exception:
            emu.screenshot().save(a.evidence/f"{spec['label']}-failure.png")
            (a.evidence/f"{spec['label']}-failure.json").write_text(json.dumps({'menus':menus,'queries':queries,'pending':pending,'flow':flow,'pc':hex(emu.memory.register_arm9.pc)},indent=2)+'\n')
            raise
        finally:emu.destroy()
(a.evidence/f'client-emulator-{a.start}-{len(results)}.json').write_text(json.dumps(results,indent=2)+'\n')
