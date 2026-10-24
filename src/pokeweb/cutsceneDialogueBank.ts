import { NARC } from '../nds/narc';
import { getRomFileBytes } from './fileSystemModel';
import { encodeGen5TextBank } from './text';
import { formatSceneDialogue, formatSceneChoice, type DialogueCueBinding } from './cutsceneDialogue';
import type { CutsceneScene } from './cutsceneScene';
import { readNativeSceneDefinition, type NativeCutsceneLibrary } from './nativeCutsceneModel';
import { CUTSCENE_OVERLAY_BASE, readNativeCutsceneLayout } from './nativeCutsceneRegistry';
import type { ProjectState } from './projectStore';
export type CutsceneDialogueBankBinding={fileId:number;bankId:number;hash:string};
function hash(bytes:Uint8Array){let n=2166136261;for(const byte of bytes)n=Math.imul(n^byte,16777619);return (n>>>0).toString(16);}
export function stageCutsceneDialogueBank(project:ProjectState,library:NativeCutsceneLibrary,source:CutsceneScene,previous?:CutsceneDialogueBankBinding,sequenceId?:number){
  const fileId=library.rom.fileId('a/0/0/2'),initial=getRomFileBytes(project,library.rom,fileId),archive=new NARC(initial),events=source.events.filter(e=>e.type==='dialogue'||e.type==='dialogue.choice');
  if(previous){
    if(previous.fileId!==fileId||!Number.isInteger(previous.bankId)||!archive.files[previous.bankId]||hash(archive.files[previous.bankId])!==previous.hash)throw new Error('The installed dialogue bank changed outside this timeline. Restore the project snapshot or use a new scene ID.');
    const overlay=project.overlays[293]??library.overlayBytes,count=readNativeCutsceneLayout(overlay).count;
    for(let id=1;id<count;id++)if(id!==sequenceId&&readNativeSceneDefinition(overlay,CUTSCENE_OVERLAY_BASE,id).cues.some(c=>c.opcode===14&&c.args[0]===previous.bankId))throw new Error('The dialogue bank no longer belongs exclusively to this scene.');
  }
  const cues:Record<string,DialogueCueBinding>={};let binding=previous,bytes:Uint8Array|undefined;
  if(events.length){
    const bankId=previous?.bankId??archive.files.length;if(bankId>65535)throw new Error('The message archive has no available dialogue bank IDs.');
    const messages:string[]=[];
    for(const e of events){cues[e.id]={bankId,messageId:messages.length};if(e.type==='dialogue')messages.push(formatSceneDialogue(source,e).nativeText);else for(let i=0;i<e.choices.length;i++)messages.push(formatSceneChoice(source,e,i).nativeText);}
    const encoded=encodeGen5TextBank(messages.map((text,i)=>[`0_${i}`,text,0]));
    archive.files[bankId]=encoded;binding={fileId,bankId,hash:hash(encoded)};bytes=archive.save();
  }
  return {binding,cues,bytes,fileId,assertCurrent(){const current=getRomFileBytes(project,library.rom,fileId);if(current.length!==initial.length||!current.every((n,i)=>n===initial[i]))throw new Error('Message text changed while this scene was compiling. Apply again.');}};
}
