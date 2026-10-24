import { describe, expect, it } from 'vitest';
import { NARC } from '../nds/narc';
import { readU32, writeU32 } from '../nds/binary';
import { createMapCutscene, readCutsceneScene, storeCutsceneScene } from '../pokeweb/cutsceneScene';
import { DIALOGUE_CUE_MARKER, formatSceneDialogue, SceneDialoguePlayback, type SceneDialogue } from '../pokeweb/cutsceneDialogue';
import { stageCutsceneDialogueBank } from '../pokeweb/cutsceneDialogueBank';
import { cutsceneDialogueRuntimeOffset, installCutsceneDialogueRuntime } from '../pokeweb/cutsceneDialogueRuntime';
import { compileCutsceneTimeline } from '../pokeweb/cutsceneNativeCompiler';
import { buildAspertiaCutsceneClone } from '../pokeweb/nativeCutsceneClone';
import type { NativeCutsceneLibrary } from '../pokeweb/nativeCutsceneModel';
import { CUTSCENE_OVERLAY_BASE as BASE, readNativeCutsceneLayout } from '../pokeweb/nativeCutsceneRegistry';
import { encodeGen5TextBank, decodeGen5TextBank } from '../pokeweb/text';
import { createProjectDocument } from '../pokeweb/projectDocument';
import { openProjectSession } from '../pokeweb/projectSession';
import { makeEditProject } from './fixtures/editProject';
import { nativeCutsceneFixture } from './fixtures/nativeCutscene';
import { updateTextEntry } from '../pokeweb/textModel';

function scene() {
  const s=createMapCutscene(370,'Conversation',{position:[32,100,64],rotationDegrees:[-30,0,0]},'route13.conversation');
  s.actors=[{id:'guide',name:'Guide',overworldId:1,frameStep:8,keys:[{id:'guide-start',frame:0,position:[32,0,64],facing:'down',action:'idle',easing:'linear'}]}];
  s.events=[{id:'hello',type:'dialogue',frame:30,speakerId:'guide',text:'Hello there!',waitForInput:true,durationFrames:90},
    {id:'timed',type:'dialogue',frame:60,speakerId:null,text:'The journey continues.',waitForInput:false,durationFrames:30},
    {id:'goodbye',type:'dialogue',frame:120,speakerId:'guide',text:'See you soon.',waitForInput:true,durationFrames:90}];
  return s;
}
const message=(s=scene(),index=0)=>s.events[index] as SceneDialogue;
function bankFixture() {
  const p=makeEditProject(),f=nativeCutsceneFixture(),overlay=buildAspertiaCutsceneClone(f.overlay,f.files).overlay;
  const bank=new NARC();bank.files=[encodeGen5TextBank([['0_0','Original text',0]])];
  const files:Uint8Array[]=[];files[349]=bank.save();
  const library={rom:{files,fileId:()=>349},overlayBytes:overlay} as unknown as NativeCutsceneLibrary;
  return {p,library,bank};
}

describe('cutscene dialogue source and playback',()=>{
  it('wraps speaker names and explicit line breaks without emitting native control codes',()=>{
    const s=scene();message(s).text='This is a quiet place by the sea.';
    expect(formatSceneDialogue(s,message(s)).lines).toEqual(['Guide:','This is a quiet place by','the sea.']);
    expect(formatSceneDialogue(s,message(s)).nativeText).toBe('Guide:\\nThis is a quiet place by\\nthe sea.');
    message(s).speakerId=null;message(s).text='First line\nSecond line';
    expect(formatSceneDialogue(s,message(s)).lines).toEqual(['First line','Second line']);
    for(const text of ['\\xFFFE','VAR(1, 2)','Hello 😊','x'.repeat(25),'a\nb\nc\nd\ne']) {
      message(s).text=text;expect(()=>readCutsceneScene(s)).toThrow();
    }
  });
  it('rejects missing speakers, overlapping windows, active fades and template dialogue',()=>{
    const missing=scene();message(missing).speakerId='unknown';expect(()=>readCutsceneScene(missing)).toThrow('existing NPC');
    const overlap=scene();message(overlap,2).frame=80;expect(()=>readCutsceneScene(overlap)).toThrow('overlap');
    const duplicate=scene();message(duplicate,2).frame=30;expect(()=>readCutsceneScene(duplicate)).toThrow('share a frame');
    const fade=scene();fade.events.push({id:'fade',type:'screen.fade',frame:20,durationFrames:20,screens:'both',from:'black',to:'clear'});expect(()=>readCutsceneScene(fade)).toThrow('active screen fades');
    const template=scene();template.stage={kind:'native-template',sequenceId:27};expect(()=>readCutsceneScene(template)).toThrow('map stage');
    const bounds=scene();message(bounds,1).durationFrames=300;expect(()=>readCutsceneScene(bounds)).toThrow('fit inside');
    message(bounds,1).waitForInput=true;expect(()=>readCutsceneScene(bounds)).not.toThrow();
    message(bounds,2).frame=299;expect(()=>readCutsceneScene(bounds)).toThrow('one camera frame after');
  });
  it('stops on skipped-over waits, resumes without consuming time, and supports backward seeking/restart',()=>{
    const s=readCutsceneScene(scene()),p=new SceneDialoguePlayback(s);
    expect(p.step(80)).toBe(30);expect(p.pending?.id).toBe('hello');
    expect(p.step(100)).toBe(30);p.advance();expect(p.frame).toBe(30);expect(p.visible()).toBeUndefined();
    expect(p.step(45)).toBe(75);expect(p.visible()?.id).toBe('timed');expect(p.pending).toBeUndefined();
    expect(p.step(100)).toBe(120);expect(p.pending?.id).toBe('goodbye');p.advance();expect(p.step(1000)).toBe(299);
    p.seek(100);expect(p.step(50)).toBe(120);p.seek(31);expect(p.step(1)).toBe(32);
    p.seek(30);expect(p.pending?.id).toBe('hello');p.seek(0);expect(p.step(299)).toBe(30);
  });
  it('persists dialogue in project documents and lowers it through private text bindings',()=>{
    const p=makeEditProject(),s=readCutsceneScene(scene());storeCutsceneScene(p,s);
    expect(openProjectSession(structuredClone(createProjectDocument(p,true))).cutsceneAuthoring?.scenes[s.id].source).toEqual(s);
    expect(()=>compileCutsceneTimeline(s)).toThrow('allocate its dialogue text bank');
    const cues=compileCutsceneTimeline(s,{hello:{bankId:495,messageId:0},timed:{bankId:495,messageId:1},goodbye:{bankId:495,messageId:2}}).cues;
    expect(cues[0]).toEqual({opcode:14,frame:30,args:[495,0,DIALOGUE_CUE_MARKER+1,90,2,15,28,8]});
    expect(cues[1].args[2]).toBe(DIALOGUE_CUE_MARKER);expect(cues[2].args[1]).toBe(2);
  });
});

describe('private dialogue resources',()=>{
  it('preserves committed edits from the loaded text editor and detects subsequent text changes',()=>{
    const {p,library,bank}=bankFixture();
    p.narcs.message_texts={name:'message_texts',fileId:349,sourcePath:'a/0/0/2',fileCount:1,rawFiles:bank.files,records:new Map(),dirty:new Set()};
    updateTextEntry(p,'message_texts',0,0,'My edited message');
    const staged=stageCutsceneDialogueBank(p,library,scene());
    expect(decodeGen5TextBank(new NARC(staged.bytes!).files[0])[0][1]).toBe('My edited message');
    staged.assertCurrent();updateTextEntry(p,'message_texts',0,0,'A newer edit');expect(()=>staged.assertCurrent()).toThrow('changed while');
  });
  it('stages one bank without changing original text, reuses it and rejects changed/shared banks',()=>{
    const {p,library,bank}=bankFixture(),s=scene(),before=library.rom.files[349].slice();
    const first=stageCutsceneDialogueBank(p,library,s);expect(first.binding?.bankId).toBe(1);
    expect(library.rom.files[349]).toEqual(before);expect(p.fileSystem).toBeUndefined();
    const output=new NARC(first.bytes!);expect(output.files[0]).toEqual(bank.files[0]);
    expect(decodeGen5TextBank(output.files[1]).map(e=>e[1])).toEqual(s.events.map(e=>formatSceneDialogue(s,e as SceneDialogue).nativeText));
    p.fileSystem={replacements:{349:first.bytes!}};
    const second=stageCutsceneDialogueBank(p,library,s,first.binding,27);expect(second.bytes).toEqual(first.bytes);
    const changed=scene();message(changed).text='Welcome!';const updated=stageCutsceneDialogueBank(p,library,changed,first.binding,27);expect(updated.binding?.bankId).toBe(1);expect(new NARC(updated.bytes!).files).toHaveLength(2);
    const tampered=new NARC(first.bytes!);tampered.files[1][20]^=1;p.fileSystem.replacements[349]=tampered.save();
    expect(()=>stageCutsceneDialogueBank(p,library,s,first.binding,27)).toThrow('changed outside');
    p.fileSystem.replacements[349]=first.bytes!;
    // A second registered sequence claiming the bank blocks the owner's replacement.
    writeU32(library.overlayBytes,0x6000,14);writeU32(library.overlayBytes,0x6008,1);
    expect(()=>stageCutsceneDialogueBank(p,library,s,first.binding,27)).toThrow('exclusively');
  });
  it('detects concurrent message edits before publication and retains ownership after removing dialogue',()=>{
    const {p,library}=bankFixture(),s=scene(),first=stageCutsceneDialogueBank(p,library,s);first.assertCurrent();
    p.fileSystem={replacements:{349:first.bytes!}};expect(()=>first.assertCurrent()).toThrow('changed while');
    s.events=[];const removed=stageCutsceneDialogueBank(p,library,s,first.binding,27);expect(removed.binding).toEqual(first.binding);expect(removed.bytes).toBeUndefined();
  });
  it('installs a relocatable adapter once, preserves descriptors, and rejects altered code or headers',()=>{
    const f=nativeCutsceneFixture(),cloned=buildAspertiaCutsceneClone(f.overlay,f.files).overlay,before=cloned.slice();
    const output=installCutsceneDialogueRuntime(cloned),offset=cutsceneDialogueRuntimeOffset(output)!;
    expect(cutsceneDialogueRuntimeOffset(cloned)).toBeUndefined();expect(cloned).toEqual(before);
    expect(readNativeCutsceneLayout(output).count).toBe(28);expect(installCutsceneDialogueRuntime(output)).toBe(output);
    const table=readNativeCutsceneLayout(cloned).tableOffset;expect(output.subarray(table,table+28*20)).toEqual(cloned.subarray(table,table+28*20));
    expect(readU32(output,offset)).toBe(0x4c445750);expect(readU32(output,0x021ab458-BASE)&1).toBe(1);
    for(const at of [offset+12,offset+24,0x021a35a4-BASE]){const altered=output.slice();altered[at]^=4;expect(()=>installCutsceneDialogueRuntime(altered)).toThrow('modified or is unsupported');}
    const wrong=cloned.slice();wrong[0x021a2636-BASE]^=1;expect(()=>installCutsceneDialogueRuntime(wrong)).toThrow('step hook changed');
    const alteredNative=output.slice();alteredNative[0x021a368c-BASE]^=1;expect(()=>installCutsceneDialogueRuntime(alteredNative)).toThrow('implementation has changed');
  });
});
