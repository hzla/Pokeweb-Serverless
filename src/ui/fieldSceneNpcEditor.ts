import { fieldPhaseFrames, type FieldScene, type FieldNpcAction, type FieldNpcTrack } from '../pokeweb/fieldScene';
import { escapeHtml as esc } from './dom';

const directions=['up','down','left','right'];
const directionOptions=(value:string)=>directions.map(d=>`<option ${d===value?'selected':''}>${d}</option>`).join('');
const number=(name:string,label:string,value:number)=>`<label>${label}<input name="${name}" type="number" min="0" step="1" value="${value}" required></label>`;

/** NPC actions share named block boundaries with camera/player actions. This is
 * the same barrier schedule compiled to native concurrent movement lists. */
export function mountFieldSceneNpcEditor(lanes:HTMLElement,panel:HTMLElement,options:{
  scene():FieldScene; catalog():Array<{id:number;label:string}>;
  publish(scene:FieldScene):Promise<void>; run(fn:()=>void|Promise<void>):void;
  select(id:string,frame?:number):void; pick(id:string):void;
}) {
  let selected='',keyId='',anchor='',tab='placement';
  function focusPanel(){const aside=panel.closest<HTMLElement>('.scene-inspector');if(aside)aside.scrollTop+=panel.getBoundingClientRect().top-aside.getBoundingClientRect().top-12;}
  function render(){
    const scene=options.scene(),actors=scene.actors??[];
    if(!actors.some(a=>a.id===selected)){selected=actors[0]?.id??'';keyId='';}
    const actor=actors.find(a=>a.id===selected),key=actor?.actions.find(a=>a.id===keyId);
    if(!scene.steps.some(s=>s.id===anchor))anchor=scene.steps[0].id;
    let frame=0;const phases=scene.steps.map(step=>{const at=frame;frame+=fieldPhaseFrames(scene,step);return {step,frame:at};});
    lanes.innerHTML=`<h3>NPC tracks</h3><div class="field-npc-lanes" style="--field-phase-count:${phases.length}"><span>Actor</span>${phases.map(p=>`<span>${p.frame}f · ${esc(p.step.id)}</span>`).join('')}${actors.map(a=>`<button data-npc="${esc(a.id)}" aria-pressed="${a.id===selected}">${esc(a.name)}</button>${phases.map(p=>{const k=a.actions.find(k=>k.stepId===p.step.id);return `<button data-npc="${esc(a.id)}" data-phase="${esc(p.step.id)}" data-key="${esc(k?.id??'')}" ${p.step.type==='dialogue'?'disabled title="Dialogue holds actor movement"':''} aria-label="${esc(a.name)} at ${p.frame} frames: ${k?`${k.type} ${k.direction}`:'add action'}" aria-pressed="${a.id===selected&&k?.id===keyId}">${p.step.type==='dialogue'?'Dialogue hold':k?`${k.type==='walk'?`Walk ${k.tiles}`:'Face'} ${k.direction}`:'＋'}</button>`;}).join('')}`).join('')}</div>${actors.length?'':'<p>Add an NPC to place a walking sprite on this map.</p>'}`;
    const catalog=options.catalog();
    panel.innerHTML=`<h3>NPC tracks</h3><div class="scene-actions"><button type="button" data-npc-act="add" ${actors.length>=8?'disabled':''}>Add NPC</button>${actor?'<button type="button" data-npc-act="remove">Remove NPC</button>':''}</div>${actor?`<label>Selected NPC<select data-npc-select>${actors.map(a=>`<option value="${esc(a.id)}" ${a.id===selected?'selected':''}>${esc(a.name)}</option>`).join('')}</select></label><div class="scene-actions"><button type="button" data-npc-act="placement" aria-pressed="${tab==='placement'}">NPC placement</button><button type="button" data-npc-act="movement" aria-pressed="${tab==='movement'}">NPC movement</button></div><form data-npc-settings ${tab!=='placement'?'hidden':''}><label>NPC name<input name="name" value="${esc(actor.name)}" maxlength="128" required></label><label>Overworld sprite<select name="sprite">${catalog.map(item=>`<option value="${item.id}" ${item.id===actor.overworldId?'selected':''}>${esc(item.label)}</option>`).join('')}</select></label>${number('x','NPC entry tile X',actor.entry.tileX)}${number('z','NPC entry tile Z',actor.entry.tileZ)}<label>NPC entry facing<select name="facing">${directionOptions(actor.entry.facing)}</select></label><label>NPC placement<select name="placement"><option value="tour" ${actor.placement!=='map'?'selected':''}>Create when tour starts</option><option value="map" ${actor.placement==='map'?'selected':''}>Map overworld (present before tour)</option></select></label><label>After handoff<select name="end"><option value="stay" ${actor.endBehavior==='stay'?'selected':''}>Stay until map unload</option><option value="remove" ${actor.endBehavior==='remove'?'selected':''}>Remove when tour ends</option></select></label><button type="submit">Apply NPC settings</button><button type="button" data-npc-act="pick">Pick NPC entry on map</button></form><h3 ${tab!=='movement'?'hidden':''}>${key?'Edit NPC action':'Add NPC action'}</h3><form data-npc-action ${tab!=='movement'?'hidden':''}><label>Start with tour action<select name="step">${phases.map(p=>`<option value="${esc(p.step.id)}" ${p.step.type==='dialogue'?'disabled':''} ${p.step.id===(key?.stepId??anchor)?'selected':''}>${p.frame}f · ${esc(p.step.id)}</option>`).join('')}</select></label><label>NPC action<select name="type"><option value="walk" ${key?.type!=='face'?'selected':''}>Walk</option><option value="face" ${key?.type==='face'?'selected':''}>Face</option></select></label><label>NPC direction<select name="direction">${directionOptions(key?.direction??actor.entry.facing)}</select></label>${number('tiles','NPC tiles (walk only)',key?.type==='walk'?key.tiles:1)}<button type="submit">${key?'Apply NPC action':'Add NPC action'}</button>${key?'<button type="button" data-npc-act="delete-key">Delete NPC action</button><button type="button" data-npc-act="new-key">New NPC action</button>':''}</form>`:''}<p>NPCs start at their entry tiles. A track action begins with its chosen camera/player block; the next block waits for every actor. Longer walks extend that block. Empty cells hold position and facing. Standard W2 walking sprites only.</p>`;
    const tiles=panel.querySelector<HTMLInputElement>('[data-npc-action] input[name=tiles]');if(tiles)tiles.disabled=key?.type==='face';
  }
  lanes.addEventListener('click',event=>{
    const b=(event.target as Element).closest<HTMLButtonElement>('[data-npc]');if(!b)return;
    selected=b.dataset.npc!;keyId=b.dataset.key??'';anchor=b.dataset.phase??options.scene().steps[0].id;
    let frame=0;for(const step of options.scene().steps){if(step.id===anchor)break;frame+=fieldPhaseFrames(options.scene(),step);}
    tab=b.dataset.phase?'movement':'placement';options.select(selected,frame);render();focusPanel();
  });
  panel.addEventListener('change',event=>{const target=event.target as HTMLSelectElement;if(target.matches('[data-npc-action] select[name=type]'))panel.querySelector<HTMLInputElement>('[data-npc-action] input[name=tiles]')!.disabled=target.value==='face';if(target.matches('[data-npc-select]')){selected=(event.target as HTMLSelectElement).value;keyId='';options.select(selected);render();}});
  panel.addEventListener('submit',event=>{
    event.preventDefault();event.stopPropagation();const form=event.target as HTMLFormElement,get=(key:string)=>(form.elements.namedItem(key) as HTMLInputElement).value;
    options.run(async()=>{
      const next=structuredClone(options.scene()),actor=next.actors!.find(a=>a.id===selected)!;
      if(form.matches('[data-npc-settings]')){actor.name=get('name');actor.overworldId=Number(get('sprite'));actor.entry={tileX:Number(get('x')),tileZ:Number(get('z')),facing:get('facing') as FieldNpcTrack['entry']['facing']};actor.endBehavior=get('end') as FieldNpcTrack['endBehavior'];actor.placement=get('placement') as FieldNpcTrack['placement'];}
      if(form.matches('[data-npc-action]')){
        let id=keyId;if(!id){let i=1;while(actor.actions.some(a=>a.id===`action-${i}`))i++;id=`action-${i}`;}
        const common={id,stepId:get('step'),direction:get('direction') as FieldNpcAction['direction']};
        const action:FieldNpcAction=get('type')==='walk'?{...common,type:'walk',tiles:Number(get('tiles'))}:{...common,type:'face'};
        actor.actions=actor.actions.filter(a=>a.id!==id);actor.actions.push(action);keyId=id;
      }
      await options.publish(next);options.select(selected);
    });
  });
  panel.addEventListener('click',event=>{const b=(event.target as Element).closest<HTMLButtonElement>('[data-npc-act]');if(!b)return;options.run(async()=>{
    const next=structuredClone(options.scene()),act=b.dataset.npcAct;
    if(act==='placement'||act==='movement'){tab=act;render();return;}
    if(act==='pick'){options.pick(selected);return;}
    if(act==='new-key'){keyId='';tab='movement';render();return;}
    if(act==='add'){
      const catalog=options.catalog();if(!catalog.length)throw new Error('Wait for the W2 NPC sprite catalog to load.');
      let i=1;while(next.actors?.some(a=>a.id===`npc-${i}`))i++;selected=`npc-${i}`;keyId='';tab='placement';
      (next.actors??=[]).push({id:selected,name:`NPC ${i}`,overworldId:catalog.find(a=>a.id===232)?.id??catalog[0].id,entry:{...next.entry,tileX:Math.max(0,next.entry.tileX-1)},endBehavior:'stay',actions:[]});
    }else if(act==='remove'){next.actors=next.actors?.filter(a=>a.id!==selected);selected='';keyId='';}
    else if(act==='delete-key'){const a=next.actors!.find(a=>a.id===selected)!;a.actions=a.actions.filter(a=>a.id!==keyId);keyId='';}
    else return;
    await options.publish(next);options.select(selected||'player');
  });});
  return {render,select(id:string){selected=id;keyId='';tab='placement';render();focusPanel();}};
}
