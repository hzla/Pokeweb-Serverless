import {inspectMoveEffects,upgradeMoveRuntime,type MoveEffectsInspection} from "../pokeweb/moveEffectsModel";
import type {ProjectState} from "../pokeweb/projectStore";
import {escapeHtml} from "./dom";
import {renderRuntimeReleaseTimestamp} from "./runtimeReleaseTimestamp";
import "../styles/moveDllFlags.css";

function buttonState(state:MoveEffectsInspection){
  return {disabled:!state.editable||!state.updateAvailable,title:!state.editable?state.message:state.runtimeVersion===undefined?"No move runtime installed":state.updateAvailable?"Update the shared runtime and preserve all saved move recipes":"Move runtime is current"};
}
export function renderMoveRuntimeUpdate(project:ProjectState):string {
  const state=buttonState(inspectMoveEffects(project));
  return `<div class="ability-runtime-update"><button type="button" class="btn -default" data-update-move-runtime ${state.disabled?"disabled":""} title="${escapeHtml(state.title)}">Update Move Runtime</button>${renderRuntimeReleaseTimestamp("move")}<span role="status" data-move-runtime-status></span></div>`;
}
export function refreshMoveRuntimeUpdate(root:HTMLElement,project:ProjectState):void {
  const button=root.querySelector<HTMLButtonElement>("[data-update-move-runtime]");if(!button)return;
  const state=buttonState(inspectMoveEffects(project));button.disabled=state.disabled;button.title=state.title;
}
export function installMoveRuntimeUpdate(root:HTMLElement,project:ProjectState,onDirty?:()=>void):void {
  const button=root.querySelector<HTMLButtonElement>("[data-update-move-runtime]");
  button?.addEventListener("click",async()=>{
    const status=root.querySelector<HTMLElement>("[data-move-runtime-status]")!;
    button.disabled=true;status.textContent="Updating…";
    try{const changed=await upgradeMoveRuntime(project);status.textContent=changed?"Updated":"Already current";if(changed)onDirty?.();}
    catch(error){status.textContent=error instanceof Error?error.message:String(error);}
    finally{refreshMoveRuntimeUpdate(root,project);}
  });
}
