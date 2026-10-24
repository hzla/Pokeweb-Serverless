import {describe,it,expect} from 'vitest';
import example from '../../examples/cutscenes/route13.dialogue-field-tour.json';
import {readFieldScene,compileFieldScene,fieldStepFrames,storeFieldScene} from '../pokeweb/fieldScene';
import {fieldDialoguePages,stageFieldSceneDialogue,appendFieldNarration} from '../pokeweb/fieldSceneDialogue';
import {readU16,readU32} from '../nds/binary';
import {FieldScenePlayback} from '../pokeweb/fieldScenePlayback';
import {NARC} from '../nds/narc';
import {decodeGen5TextBank,encodeGen5TextBank} from '../pokeweb/text';
import {makeEditProject} from './fixtures/editProject';
import {createProjectDocument} from '../pokeweb/projectDocument';
import {openProjectSession} from '../pokeweb/projectSession';
const scene=()=>readFieldScene(example);
const archive=(count=2)=>{const narc=new NARC();narc.files=Array.from({length:count},(_,i)=>encodeGen5TextBank([['0_0',`Original ${i}`,0]]));return narc.save();};
describe('native field tour dialogue',()=>{
  it('uses the native translucent narration window and retains original encrypted messages',()=>{
    const s=scene(),step=s.steps.find(s=>s.type==='dialogue')!;if(step.type!=='dialogue')throw new Error();step.window='narration';step.waitForInput=false;Object.assign(step,{durationFrames:90});
    const before=archive(),result=stageFieldSceneDialogue(before,s,0),oldBank=new NARC(before).files[0],bank=new NARC(result.bytes!).files[0],old=decodeGen5TextBank(oldBank);
    expect(decodeGen5TextBank(bank).slice(0,old.length)).toEqual(old);expect(result.bindings[step.id]).toEqual({bankId:0,messageIds:[1]});
    const oldBlock=readU32(oldBank,12),newBlock=readU32(bank,12),length=readU16(oldBank,oldBlock+8)*2;
    expect(bank.slice(newBlock+readU32(bank,newBlock+4),newBlock+readU32(bank,newBlock+4)+length)).toEqual(oldBank.slice(oldBlock+readU32(oldBank,oldBlock+4),oldBlock+readU32(oldBank,oldBlock+4)+length));
    const ops=compileFieldScene(s,false,undefined,result.bindings).compiled.instructions;
    expect(ops.find(i=>i.opcode===0x34)?.operands).toEqual([1,0]);expect(ops.filter(i=>i.opcode===0x36)).toHaveLength(1);
    expect(()=>stageFieldSceneDialogue(before,s)).toThrow('target map');expect(()=>appendFieldNarration(new Uint8Array(20),['bad'])).toThrow('single-block');
  });
  it('wraps plain text into explicit two-line pages and rejects hidden controls or lost glyphs',()=>{
    expect(fieldDialoguePages('First line\nSecond line\nThird line')).toEqual([['First line','Second line'],['Third line']]);
    for(const text of ['', 'a'.repeat(25), 'Hello\\nworld', 'VAR(256, 1)', 'Hello 👋'])expect(()=>fieldDialoguePages(text)).toThrow();
    expect(()=>fieldDialoguePages(Array.from({length:25},()=> 'line').join('\n'))).toThrow('twelve');
  });
  it('appends an explicit bank while preserving every existing message and avoiding the default-bank sentinel',()=>{
    const before=archive(),old=new NARC(before).files,result=stageFieldSceneDialogue(before,scene()),files=new NARC(result.bytes!).files;
    expect(result.bankId).toBe(2);expect(files.slice(0,old.length)).toEqual(old);
    expect(result.bindings['guide-talk']).toEqual({bankId:2,messageIds:[1,2]});
    expect(decodeGen5TextBank(files[2]).map(e=>e[1])).toEqual(['Welcome to Route 13!\\nEnjoy the ocean view.','This is still the live\\nfield, with no reload.','Try walking when I am\\ndone speaking.','Thanks for the tour!']);
    expect(stageFieldSceneDialogue(archive(0x400),scene()).bankId).toBe(0x401);
    const noText=scene();noText.steps=noText.steps.filter(s=>s.type!=='dialogue');expect(stageFieldSceneDialogue(before,noText).bytes).toBeUndefined();
  });
  it('uses explicit native speakers, print completion, fresh A/B wait, timed hold and window close',()=>{
    const s=scene(),bindings=stageFieldSceneDialogue(archive(),s).bindings;
    expect(()=>compileFieldScene(s)).toThrow('private dialogue');
    const {compiled,source}=compileFieldScene(s,false,undefined,bindings),messages=compiled.instructions.filter(i=>i.opcode===0x3c);
    expect(messages.map(i=>i.operands)).toEqual([[2,0,254,2,0],[2,1,254,2,0],[2,2,254,2,0],[2,3,255,2,0]]);
    expect(source).toContain('cmd_003c 2, 0, 254, 2, 0\n  sleep 45');
    expect(compiled.instructions.filter(i=>i.opcode===0x31)).toHaveLength(3);
    expect(compiled.instructions.filter(i=>i.opcode===0x3e)).toHaveLength(3);
    expect(compiled.instructions.slice(-4).map(i=>i.opcode)).toEqual([0x142,0x140,0x2f,2]);
  });
  it('holds the source clock through every input page and resumes without skipping the next speech',()=>{
    const p=new FieldScenePlayback(scene());p.step(10000);
    expect(p.frame).toBe(407);expect(p.visible()).toMatchObject({speaker:'Coast guide',page:0});
    p.step(1000);expect(p.frame).toBe(407);p.advance();expect(p.visible()?.page).toBe(1);expect(p.frame).toBe(407);
    p.advance();expect(p.frame).toBe(408);expect(p.pending?.step.id).toBe('player-reply');expect(p.visible()?.speaker).toBe('Player');
    p.advance();expect(p.frame).toBe(409);expect(p.visible()).toBeUndefined();p.step(12);expect(p.frame).toBe(421);
    p.seek(407);expect(p.visible()?.page).toBe(0);p.seek(409);expect(p.pending).toBeUndefined();
  });
  it('shows timed pages for their authored holds and does not require a confirmation',()=>{
    const s=scene(),timed=s.steps.find(s=>s.id==='welcome')!;expect(fieldStepFrames(timed)).toBe(45);
    const p=new FieldScenePlayback(s,362);expect(p.visible()).toMatchObject({page:0,step:{waitForInput:false}});expect(p.advance()).toBe(false);
    p.step(44.5);expect(p.visible()?.step.id).toBe('welcome');p.step(.5);expect(p.pending?.step.id).toBe('guide-talk');
  });
  it('rejects dangling speakers, actor movement during a hold and ambiguous timing; persists valid dialogue',()=>{
    const s=scene(),project=makeEditProject();storeFieldScene(project,s);
    expect(openProjectSession(structuredClone(createProjectDocument(project,false))).fieldScenes?.scenes[s.id]).toEqual(s);
    const bad=scene();bad.actors=[];expect(()=>readFieldScene(bad)).toThrow('speaker');
    const moving=scene();moving.actors![0].actions.push({id:'during-text',stepId:'guide-talk',type:'walk',direction:'left',tiles:1});expect(()=>readFieldScene(moving)).toThrow('pause movement');
    const duration=scene();Object.assign(duration.steps.find(s=>s.id==='guide-talk')!,{durationFrames:60});expect(()=>readFieldScene(duration)).toThrow('Unsupported property');
    expect(()=>storeFieldScene(project,bad)).toThrow();expect(project.fieldScenes!.scenes[s.id]).toEqual(s);
  });
});
