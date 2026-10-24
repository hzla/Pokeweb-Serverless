import type { CutsceneScene, SceneEvent } from './cutsceneScene';
export type SceneDialogue = Extract<SceneEvent,{type:'dialogue'}>;
export type SceneChoice = Extract<SceneEvent,{type:'dialogue.choice'}>;
export type SceneMessage = SceneDialogue | SceneChoice;
export type DialogueCueBinding = {bankId:number;messageId:number};
export const DIALOGUE_CUE_MARKER = 0x50445700;
export const JUMP_CUE_MARKER = DIALOGUE_CUE_MARKER + 2;
export const CHOICE_CUE_MARKER = DIALOGUE_CUE_MARKER + 3;

export function plainSceneText(text:string) {
  if(!/^[\x20-\x7e\xa0-\xff\u2018\u2019\u201c\u201d\n]+$/u.test(text)||text.includes('\\')||text.includes('VAR('))throw new Error('Dialogue supports plain Western text and line breaks; native control codes and unsupported glyphs are not accepted.');
}
function wrap(text:string) {
  plainSceneText(text);const lines:string[]=[];
  for(const paragraph of text.split('\n')) {
    if(!paragraph.trim()){lines.push('');continue;}
    let line='';for(const word of paragraph.trim().split(/ +/)){if(word.length>24)throw new Error('A dialogue word exceeds 24 characters. Add a line break or shorten it.');if(line&&line.length+word.length+1>24){lines.push(line);line='';}line+=(line?' ':'')+word;}lines.push(line);
  }
  return lines;
}
function prompt(scene:CutsceneScene,event:SceneMessage) {
  const actor=event.speakerId===null?undefined:scene.actors?.find(a=>a.id===event.speakerId);
  if(event.speakerId!==null&&!actor)throw new Error('The dialogue speaker must be an existing NPC track.');
  const speaker=actor?.name??'',lines=wrap([speaker?`${speaker}:`:undefined,event.text].filter(s=>s!==undefined).join('\n'));
  return {speaker,body:event.text,lines};
}
/** A native dialogue window reserves four lines; choices reserve six. */
export function formatSceneDialogue(scene:CutsceneScene,event:SceneDialogue) {
  const result=prompt(scene,event);
  if(result.lines.length>4)throw new Error('Dialogue exceeds four wrapped lines including the speaker. Split it into additional dialogue events.');
  return {...result,nativeText:result.lines.join('\\n')};
}
export function formatSceneChoice(scene:CutsceneScene,event:SceneChoice,selected=0) {
  const result=prompt(scene,event);
  const responses=event.choices.map((c,i)=>{plainSceneText(c.text);if(!c.text.trim()||c.text.length>22||c.text.includes('\n'))throw new Error('Each response must fit one line of 1–22 characters.');return `${i===selected?'>':' '} ${c.text}`;});
  const lines=[...result.lines,...responses];if(lines.length>6)throw new Error('The choice prompt and responses must fit six native lines including the speaker.');
  return {...result,promptLines:result.lines,lines,nativeText:lines.join('\\n')};
}

/** Forward-only control flow shared with W2. Skipped events are never executed. */
export class SceneDialoguePlayback {
  frame=0; pending:SceneMessage|undefined;
  readonly decisions=new Map<string,string>();
  private acknowledged=new Set<string>();private executed=new Set<string>();private resolved:CutsceneScene|undefined;private resolvedCount=-1;
  constructor(readonly scene:CutsceneScene,frame=0){this.seek(frame);}
  private events(){return [...this.scene.events].sort((a,b)=>a.frame-b.frame);}
  seek(frame:number){
    this.frame=Math.max(0,Math.min(this.scene.frameCount-1,Math.round(frame)));this.resolved=undefined;
    this.acknowledged=new Set(this.events().filter(e=>e.frame<this.frame).map(e=>e.id));
    this.executed=new Set(this.events().filter(e=>e.frame<=this.frame).map(e=>e.id));this.decisions.clear();
    this.pending=this.events().find((e):e is SceneMessage=>(e.type==='dialogue.choice'||e.type==='dialogue'&&e.waitForInput)&&e.frame===this.frame);
  }
  private skipTo(frame:number){this.frame=frame;this.pending=undefined;for(const e of this.events())if(e.frame<frame)this.acknowledged.add(e.id);}
  step(count:number){
    if(this.pending)return this.frame;
    let remaining=Math.max(0,Math.floor(count));
    for(let limit=0;limit<=this.scene.events.length;limit++){
      const target=Math.min(this.scene.frameCount-1,this.frame+remaining);
      const control=this.events().find(e=>!this.acknowledged.has(e.id)&&e.frame>=this.frame&&e.frame<=target&&(e.type==='timeline.jump'||e.type==='dialogue.choice'||e.type==='dialogue'&&e.waitForInput));
      const end=control?.frame??target;
      for(const e of this.events())if(e.frame>=this.frame&&e.frame<=end)this.executed.add(e.id);
      remaining-=end-this.frame;this.frame=end;if(!control)return this.frame;
      if(control.type==='timeline.jump'){this.acknowledged.add(control.id);this.skipTo(control.targetFrame);continue;}
      if(control.type==='dialogue'||control.type==='dialogue.choice'){this.pending=control;return this.frame;}
    }
    throw new Error('Invalid cyclic scene control flow.');
  }
  advance(){if(this.pending?.type==='dialogue'){this.acknowledged.add(this.pending.id);this.pending=undefined;}}
  choose(choiceId:string){
    if(this.pending?.type!=='dialogue.choice')throw new Error('No response is pending.');
    const event=this.pending,choice=event.choices.find(c=>c.id===choiceId);if(!choice)throw new Error('Choose an existing response.');
    this.decisions.set(event.id,choice.id);this.acknowledged.add(event.id);this.skipTo(choice.targetFrame);return this.step(0);
  }
  visible():SceneMessage|undefined{return this.pending??this.events().find((e):e is SceneDialogue=>e.type==='dialogue'&&!e.waitForInput&&this.executed.has(e.id)&&this.frame>=e.frame&&this.frame<e.frame+e.durationFrames);}
  resolvedScene():CutsceneScene{if(!this.resolved||this.resolvedCount!==this.executed.size){this.resolvedCount=this.executed.size;this.resolved={...this.scene,events:this.scene.events.filter(e=>this.executed.has(e.id))};}return this.resolved;}
}
