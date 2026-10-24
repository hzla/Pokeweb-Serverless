import { describe,expect,it } from 'vitest';
import source from '../../examples/cutscenes/route13.choices.scene.json';
import legacy from '../assets/cutscenes/dialogue-runtime-v1.json';
import { NARC } from '../nds/narc';
import { readU32,writeU32 } from '../nds/binary';
import { readCutsceneScene,storeCutsceneScene } from '../pokeweb/cutsceneScene';
import { CHOICE_CUE_MARKER,JUMP_CUE_MARKER,formatSceneChoice,SceneDialoguePlayback,type SceneChoice } from '../pokeweb/cutsceneDialogue';
import { compileCutsceneTimeline } from '../pokeweb/cutsceneNativeCompiler';
import { stageCutsceneDialogueBank } from '../pokeweb/cutsceneDialogueBank';
import { cutsceneDialogueRuntimeOffset,installCutsceneDialogueRuntime } from '../pokeweb/cutsceneDialogueRuntime';
import { buildAspertiaCutsceneClone } from '../pokeweb/nativeCutsceneClone';
import { CUTSCENE_ORIGINAL_SIZE,CUTSCENE_OVERLAY_BASE as BASE,readNativeCutsceneLayout } from '../pokeweb/nativeCutsceneRegistry';
import { encodeGen5TextBank,decodeGen5TextBank } from '../pokeweb/text';
import type { NativeCutsceneLibrary } from '../pokeweb/nativeCutsceneModel';
import { makeEditProject } from './fixtures/editProject';
import { nativeCutsceneFixture } from './fixtures/nativeCutscene';
const scene=()=>readCutsceneScene(source);
const choice=(s=scene())=>s.events.find(e=>e.type==='dialogue.choice') as SceneChoice;

describe('response branches',()=>{
  it('requires distinct stable IDs, two or three one-line responses and finite forward targets',()=>{
    const s=scene();expect(formatSceneChoice(s,choice(s)).lines).toEqual(['Coastal walker:','Where should we go?','> Explore the beach','  Take the high path']);
    expect(formatSceneChoice(s,choice(s),1).lines[3]).toBe('> Take the high path');
    const three=scene();choice(three).choices.push({id:'third-response',text:'Look around first',targetFrame:300});expect(formatSceneChoice(readCutsceneScene(three),choice(three),2).lines.at(-1)).toBe('> Look around first');
    const third=new SceneDialoguePlayback(three);third.step(90);expect(third.choose('third-response')).toBe(300);expect(third.pending).toBeUndefined();expect(third.step(60)).toBe(360);
    for(const targetFrame of [0,90,419,420,NaN,120.5]){const bad=scene();choice(bad).choices[0].targetFrame=targetFrame;expect(()=>readCutsceneScene(bad)).toThrow('targets');}
    const duplicate=scene();choice(duplicate).choices[0].id=duplicate.camera[0].id;expect(()=>readCutsceneScene(duplicate)).toThrow('unique');
    const short=scene();choice(short).choices.pop();expect(()=>readCutsceneScene(short)).toThrow('two or three');
    for(const text of ['Two\nlines','VAR(1)','x'.repeat(23),'']){const bad=scene();choice(bad).choices[0].text=text;expect(()=>readCutsceneScene(bad)).toThrow();}
    const long=scene();choice(long).text='a\nb\nc\nd';expect(()=>readCutsceneScene(long)).toThrow('six native lines');
  });
  it('rejects overlapping control events, active fade entry and malformed source without publishing',()=>{
    const p=makeEditProject(),good=scene();storeCutsceneScene(p,good);const bad=scene();bad.events.push({id:'same-frame',type:'sound.play',frame:90,assetId:1,volume:127});
    expect(()=>storeCutsceneScene(p,bad,1)).toThrow('own event frame');expect(p.cutsceneAuthoring!.scenes[good.id].source).toEqual(good);
    const fade=scene();fade.events.push({id:'branch-fade',type:'screen.fade',frame:110,durationFrames:20,screens:'both',from:'clear',to:'black'});expect(()=>readCutsceneScene(fade)).toThrow('land inside');
    const template=scene();template.stage={kind:'native-template',sequenceId:27};expect(()=>readCutsceneScene(template)).toThrow('map stage');
  });
  it('runs only the selected reaction and joins with camera/NPC time at the shared ending',()=>{
    for(const [id,target,skipped]of [['beach-response',120,'cliff-reaction'],['cliff-response',240,'beach-reaction']] as const){
      const p=new SceneDialoguePlayback(scene());expect(p.step(300)).toBe(90);expect(p.pending?.type).toBe('dialogue.choice');
      p.advance();expect(p.step(20)).toBe(90);expect(()=>p.choose('missing')).toThrow('existing response');
      expect(p.choose(id)).toBe(target);expect(p.pending?.id).toBe(target===120?'beach-reaction':'cliff-reaction');
      expect(p.decisions.get('route-choice')).toBe(id);p.advance();expect(p.step(300)).toBe(360);expect(p.pending?.id).toBe('shared-ending');
      expect(p.resolvedScene().events.map(e=>e.id)).not.toContain(skipped);
      if(target===240)expect(p.resolvedScene().events.map(e=>e.id)).not.toContain('beach-join');
      p.advance();expect(p.step(500)).toBe(419);p.seek(0);expect(p.decisions.size).toBe(0);expect(p.step(100)).toBe(90);
    }
  });
  it('preserves fade state from reached events rather than applying fades from skipped branches',()=>{
    const s=scene();s.events.push({id:'beach-only',type:'screen.fade',frame:160,durationFrames:20,screens:'both',from:'clear',to:'black'});
    const p=new SceneDialoguePlayback(readCutsceneScene(s));p.step(90);p.choose('cliff-response');p.advance();p.step(120);
    expect(p.resolvedScene().events.map(e=>e.id)).not.toContain('beach-only');
    p.seek(90);p.choose('beach-response');p.advance();p.step(90);expect(p.resolvedScene().events.map(e=>e.id)).toContain('beach-only');
  });
  it('allocates private cursor variants and emits choice/jump cues with no raw code in the source',()=>{
    const s=scene(),archive=new NARC();archive.files=[encodeGen5TextBank([['0_0','Original',0]])];
    const p=makeEditProject(),files:Uint8Array[]=[];files[349]=archive.save();const library={rom:{files,fileId:()=>349}} as unknown as NativeCutsceneLibrary;
    const staged=stageCutsceneDialogueBank(p,library,s),messages=decodeGen5TextBank(new NARC(staged.bytes!).files[1]);
    expect(messages).toHaveLength(5);expect(messages[0][1]).toBe(formatSceneChoice(s,choice(s),0).nativeText);expect(messages[1][1]).toBe(formatSceneChoice(s,choice(s),1).nativeText);
    const compiled=compileCutsceneTimeline(s,staged.cues);expect(compiled.cues.find(c=>c.frame===90)).toEqual({opcode:14,frame:90,args:[1,0,CHOICE_CUE_MARKER,2,120,240,0,0]});
    expect(compiled.cues.find(c=>c.frame===210)).toEqual({opcode:14,frame:210,args:[0,360,JUMP_CUE_MARKER,0,0,0,0,0]});
    expect(compiled.cues.find(c=>c.frame===120)?.args[1]).toBe(2);expect(new NARC(staged.bytes!).files[0]).toEqual(archive.files[0]);
  });
  it('upgrades recognized version-1 dialogue exports and rejects tampered legacy code',()=>{
    const f=nativeCutsceneFixture(),cloned=buildAspertiaCutsceneClone(f.overlay,f.files).overlay,start=(cloned.length+3)&~3;
    const code=Uint8Array.from(legacy.hex.match(/../g)!.map(n=>parseInt(n,16))),bytes=new Uint8Array((start+24+code.length+3)&~3);bytes.set(cloned);
    for(const at of legacy.relocations)writeU32(code,at,readU32(code,at)+BASE+start+24);
    [0x4c445750,1,code.length,legacy.stateOffset].forEach((v,i)=>writeU32(bytes,start+i*4,v));bytes.set(code,start+24);
    writeU32(bytes,0x021ab458-BASE,BASE+start+24+legacy.cueOffset+1);writeU32(bytes,0x021a35a4-BASE,BASE+start+24+legacy.taskOffset+1);writeU32(bytes,CUTSCENE_ORIGINAL_SIZE+8,bytes.length);
    expect(cutsceneDialogueRuntimeOffset(bytes)).toBe(start);const next=installCutsceneDialogueRuntime(bytes),at=cutsceneDialogueRuntimeOffset(next)!;
    expect(readU32(next,at+4)).toBe(2);expect(at).toBeGreaterThan(start);expect(next.subarray(start,start+24+code.length)).toEqual(bytes.subarray(start,start+24+code.length));
    expect(readNativeCutsceneLayout(next).count).toBe(28);expect(installCutsceneDialogueRuntime(next)).toBe(next);
    const tampered=bytes.slice();tampered[start+30]^=1;expect(()=>installCutsceneDialogueRuntime(tampered)).toThrow('unsupported');
  });
});
