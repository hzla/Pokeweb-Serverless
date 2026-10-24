"""Exercise a prepared trainer-2 field-conditions fixture in headless melonDS.

Requires a separately built harness ROM/save with rain, Trick Room, opposing
screens/Safeguard/Tailwind/Lucky Chant, player Spikes x3, opponent Toxic Spikes x2; both teams use Splash and
player move slot 2 is Brick Break. Copies ROM/save before any emulation.
"""
from pathlib import Path
import argparse, json, shutil, tempfile
from melonds import MelonDS
from profiles import PROFILES, address as native_address
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('rom',type=Path);p.add_argument('--out',type=Path,required=True);p.add_argument('--opening-only',action='store_true');p.add_argument('--expected-weather',type=int,default=2)
p.add_argument('--game',choices=PROFILES,default='W2')
p.add_argument('--all-conditions',action='store_true')
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
if a.all_conditions and not a.opening_only:p.error('--all-conditions requires --opening-only')
def A(value): return native_address(value,a.game)
FIELD,SIDE=A(0x021dd928),0x0689e960
with tempfile.TemporaryDirectory(prefix='trainer-fields-emulator-') as tmp:
    path=Path(tmp)/'battle.nds';shutil.copyfile(a.rom,path);shutil.copyfile(a.rom.with_suffix('.sav'),path.with_suffix('.sav'))
    emu=MelonDS();flow=0;menus=[];removals=[];cues=[];weatherCues=[];messages=[];pending=[]
    def opening(cpu,address):
        global flow
        flow=emu.memory.register_arm9.r6
    def command(cpu,address):
        if flow and emu.memory.read_long(emu.memory.register_arm9.r1)==0:
            turn=emu.memory.read_long(flow+16)
            if turn not in menus:
                menus.append(turn);print('command turn',turn,'frame',emu.frame_count,flush=True)
    def removed(cpu,address):
        removals.append((emu.memory.register_arm9.r0,emu.memory.register_arm9.r1))
    def animation(cpu,address):
        if not menus and emu.memory.read_long(emu.memory.register_arm9.r1)==0:
            data=emu.memory.register_arm9.r2
            cue={'frame':emu.frame_count,'from':emu.memory.read_long(data),'to':emu.memory.read_long(data+4),'move':emu.memory.read_long(data+8)}
            cues.append(cue);pending.append((emu.frame_count+50,f"opening-move-{cue['move']}"))
    def weather(cpu,address):
        if not menus and emu.memory.read_long(emu.memory.register_arm9.r1)==0:
            weatherCues.append({'frame':emu.frame_count,'weather':emu.memory.read_long(emu.memory.register_arm9.r2)})
    def capture_message(item):
        messages.append(item)
        pending.append((emu.frame_count+80,f"opening-message-{item['id']}-early"))
        pending.append((emu.frame_count+150,f"opening-message-{item['id']}"))
    def message_standard(cpu,address):
        if not menus:
            capture_message({'frame':emu.frame_count,'id':emu.memory.register_arm9.r1&0xFFFF,'bank':19,'args':[]})
    def message_set(cpu,address):
        if not menus:
            capture_message({'frame':emu.frame_count,'id':emu.memory.register_arm9.r1&0xFFFF,'bank':18,
                'args':[emu.memory.read_long(emu.memory.register_arm9.r2)]})
    callbacks=[emu.memory.register_exec(A(0x021b7434),animation),emu.memory.register_exec(A(0x021b78ac),weather),emu.memory.register_exec(A(0x021d0290),message_standard),emu.memory.register_exec(A(0x021d02ac),message_set),emu.memory.register_exec(A(0x0219f5da),opening),emu.memory.register_exec(A(0x021cef18),command),emu.memory.register_exec(0x06898d10,removed)]
    def state():
        return {'weather':emu.memory.read_long(FIELD),'weatherTurns':emu.memory.read_long(FIELD+4),
            'trickRoom':emu.memory.read_long(FIELD+0x28+4),'trickRoomActive':emu.memory.read_long(FIELD+0x148+4),
            'reflect':emu.memory.read_long(SIDE+224+12),'lightScreen':emu.memory.read_long(SIDE+224+16+12),
            'safeguard':emu.memory.read_long(SIDE+224+2*16+12),'tailwind':emu.memory.read_long(SIDE+224+4*16+12),'luckyChant':emu.memory.read_long(SIDE+224+5*16+12),
            'spikes':emu.memory.read_long(SIDE+6*16+12),'toxicSpikes':emu.memory.read_long(SIDE+224+7*16+12)}
    try:
        emu.open(path)
        for _ in range(30000 if a.all_conditions else 12000):
            emu.cycle()
            for frame,label in list(pending):
                if emu.frame_count>=frame:
                    emu.screenshot().save(a.out/f'{label}.png');pending.remove((frame,label))
            if menus:break
        assert menus and flow,'Battle did not reach its command menu'
        emu.run_frames(40);initial=state();assert initial=={'weather':a.expected_weather,'weatherTurns':255,'trickRoom':1,'trickRoomActive':1,'reflect':1,'lightScreen':1,'safeguard':1,'tailwind':1,'luckyChant':1,'spikes':3,'toxicSpikes':2},initial
        emu.screenshot().save(a.out/'opening.png')
        expectedMoves=[433,191,115,113,219,366,381,390]
        expectedMessages=[857,148,125,129,133,141,145,153]
        if a.all_conditions:
            expectedMoves=[433,356,346,300,472,478]+[115,113,219,54,366,381,191,390,446,518,519,520]*2
            expectedMessages=[857,117,114,115,178,180]+[124,128,132,136,140,144,148,152,156,164,168,172]+[125,129,133,137,141,145,149,153,157,165,169,173]
        assert [c['move'] for c in cues]==expectedMoves,cues
        assert all(c['from']==c['to']==(0 if a.all_conditions and index<18 else 1)
            for index,c in enumerate(cues) if c['move'] in [115,113,219,54,366,381]),cues
        conditionMessages=[m for m in messages if m['id'] in expectedMessages]
        assert [m['id'] for m in conditionMessages]==expectedMessages,messages
        for index,(cue,text) in enumerate(zip(cues,conditionMessages)):
            assert cue['frame']<text['frame']<(cues[index+1]['frame'] if index+1<len(cues) else emu.frame_count),(cue,text)
        assert conditionMessages[0]['args']==[0],conditionMessages
        assert weatherCues and weatherCues[0]['weather']==2 and weatherCues[0]['frame']<cues[0]['frame'],weatherCues
        if a.expected_weather != 2:
            assert weatherCues[-1]['weather']==a.expected_weather and weatherCues[-1]['frame']>conditionMessages[-1]['frame'],weatherCues
        if a.opening_only:
            result={'game':a.game,'passed':True,'initial':initial,'openingAnimations':cues,'openingMessages':conditionMessages,'weatherCues':weatherCues,'scope':'Actual native client commands and rendered-message requests before the first command menu in DS-mode melonDS'}
            (a.out/'report.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));raise SystemExit(0)
        for _ in range(60000):
            emu.input.keypad_update(1 if emu.frame_count%12<3 else 0)
            emu.cycle()
            if max(menus)>=10:break
        emu.input.keypad_update(0);emu.run_frames(60)
        assert max(menus)>=10,menus
        after=state();assert after==initial,(initial,after)
        emu.screenshot().save(a.out/'turn10.png')
        # Open Fight, then select the second move with the native D-pad.
        for key,frames in [(1,2),(0,40),(16,2),(0,2),(1,2),(0,20)]:
            emu.input.keypad_update(key);emu.run_frames(frames)
        for _ in range(5000):
            emu.input.keypad_update(1 if emu.frame_count%12<3 else 0);emu.cycle()
            if state()['reflect']==0 and state()['lightScreen']==0:break
        emu.input.keypad_update(0);emu.run_frames(90)
        broken=state();assert broken['reflect']==broken['lightScreen']==0,(broken,removals)
        assert (1,0) in removals and (1,1) in removals,removals
        for _ in range(4000):
            emu.input.keypad_update(1 if emu.frame_count%12<3 else 0);emu.cycle()
            if max(menus)>=12:break
        assert max(menus)>=12,menus
        final=state();assert final['reflect']==final['lightScreen']==0,final
        emu.screenshot().save(a.out/'brick-break.png')
        result={'game':a.game,'passed':True,'openingAnimations':cues,'openingMessages':conditionMessages,'weatherCues':weatherCues,'initial':initial,'afterTenTurns':after,'afterBrickBreak':broken,'later':final,'commandTurns':menus,
            'nativeScreenRemovals':removals,'scope':f'Cold-boot DS-mode gameplay on prepared {a.game} fixture; no hardware or DSi claim'}
        (a.out/'report.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
    finally:emu.destroy()
