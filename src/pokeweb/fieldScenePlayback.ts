import { fieldPhaseFrames, type FieldScene, type FieldDialogueStep } from './fieldScene';
import { formatFieldDialogue } from './fieldSceneDialogue';

/** Source-clock playback. Input holds do not consume source frames; ambient map
 * animation may continue on its own clock, as it does on the native live field. */
export class FieldScenePlayback {
  frame=0;
  readonly phases:Array<{step:FieldScene['steps'][number];start:number;end:number}>;
  readonly frameCount:number;
  pending:{step:FieldDialogueStep;page:number}|undefined;
  private acknowledged=new Set<string>();
  constructor(readonly scene:FieldScene,frame=0){
    let start=0;this.phases=scene.steps.map(step=>{const phase={step,start,end:start+fieldPhaseFrames(scene,step)};start=phase.end;return phase;});
    this.frameCount=start+1;this.seek(frame);
  }
  seek(frame:number){
    this.frame=Math.max(0,Math.min(this.frameCount-1,Math.floor(frame*2)/2));this.pending=undefined;
    this.acknowledged=new Set(this.phases.filter(p=>p.end<=this.frame).map(p=>p.step.id));
    const phase=this.phases.find(p=>p.start<=this.frame&&this.frame<p.end);
    if(phase?.step.type==='dialogue'&&phase.step.waitForInput)this.pending={step:phase.step,page:0};
  }
  step(count:number){
    if(this.pending)return this.frame;
    const target=Math.min(this.frameCount-1,this.frame+Math.max(0,count));
    const next=this.phases.find(p=>p.step.type==='dialogue'&&p.step.waitForInput&&!this.acknowledged.has(p.step.id)&&p.start>=this.frame&&p.start<=target);
    if(next&&next.step.type==='dialogue'){this.frame=next.start;this.pending={step:next.step,page:0};}
    else this.frame=target;
    return this.frame;
  }
  advance(){
    if(!this.pending)return false;
    const {step,page}=this.pending,pages=formatFieldDialogue(this.scene,step).pages;
    if(page+1<pages.length)this.pending={step,page:page+1};
    else{this.acknowledged.add(step.id);this.pending=undefined;this.frame=this.phases.find(p=>p.step.id===step.id)!.end;this.step(0);}
    return true;
  }
  visible(){
    if(this.pending){const formatted=formatFieldDialogue(this.scene,this.pending.step);return {...formatted,step:this.pending.step,page:this.pending.page};}
    const phase=this.phases.find(p=>p.start<=this.frame&&this.frame<p.end);
    if(phase?.step.type!=='dialogue'||phase.step.waitForInput)return;
    const formatted=formatFieldDialogue(this.scene,phase.step);
    return {...formatted,step:phase.step,page:Math.min(formatted.pages.length-1,Math.floor((this.frame-phase.start)/phase.step.durationFrames))};
  }
}
