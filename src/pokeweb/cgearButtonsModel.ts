import type { ProjectState } from "./projectStore";
import { NintendoDSRom } from "../nds/rom";
import { NARC } from "../nds/narc";
import { readU16, readU32, writeU32 } from "../nds/binary";
import { NativeFont } from "../customUi/assets";
import { actionFor, defaults, legacyDefaults, type Project } from "../cgearButtons/document";
import { originalGraphics, packNativeGraphics, buttonGraphics, sameGraphics } from "../cgearButtons/nativeGraphics";
import { compile, fingerprint, type Assets } from "../cgearButtons/compiler";
import { getRomFileBytes, ensureFileSystemState } from "./fileSystemModel";
import { decodeGen5TextBank } from "./text";
import { materializeProjectEdits } from "./projectMaterialize";
import { loadActiveRomBytes } from "./persistence";
import { defaultSkins, skinBytes, validateSkins } from "../cgearButtons/skins";
export const BUTTON_ARCHIVE = "quick-actions/ui.narc";
export function ensureCGearButtons(project:ProjectState):Project { const bw1=project.session.baseRom==="BW",state=project.cgearButtons??={document:defaults(bw1?"BW":"BW2"),enabled:false};state.document.skins??=bw1?{nextId:1,defaultId:0,entries:[]}:defaultSkins();return state; }
export function buttonAssets(project:ProjectState,rom:NintendoDSRom):Assets {
  function narc(path:string){const id=rom.filenames.idOf(path);if(id===undefined)throw new Error(`Required ROM archive ${path} is missing.`);return new NARC(getRomFileBytes(project,rom,id));}
  const game=project.session?.baseRom==="BW"?"BW":"BW2",native=narc(game==="BW"?"a/0/3/0":"a/2/8/7"),font=new NativeFont(narc("a/0/2/3").files[1]),items=narc("a/0/2/4");
  // Inspect pending item edits as well as filesystem replacements before staging a native route.
  const pending=project.narcs.items;
  if(pending){const copy={...project,narcs:{items:structuredClone(pending)}} as ProjectState;materializeProjectEdits(copy);items.files=copy.narcs.items!.rawFiles;}
  const itemGroups=new Map(items.files.map((b,i)=>[i,b[10]]));
  const itemNames=new Map<number,string>();
  try{const texts=narc("a/0/0/2");const names=decodeGen5TextBank(texts.files[game==="BW"?54:64]);for(const [key,name]of names){const i=Number(key.split("_").pop());if(Number.isInteger(i))itemNames.set(i,name);}}catch{/* Native action names remain available if a hack relocated its message bank. */}
  for(const [i,name] of (project.texts.banks.items??[]).entries())itemNames.set(i,name);
  const prior=privateArchive(project,rom);
  const saved=prior&&new NARC(prior);
  return {game,native,font,itemGroups,itemNames,originalGraphics:saved?.files[14]?new NARC(saved.files[14]):undefined};
}
export function privateArchive(project:ProjectState,rom:NintendoDSRom):Uint8Array|undefined {const fs=project.fileSystem,id=rom.filenames.idOf(BUTTON_ARCHIVE);return fs?.additions?.[BUTTON_ARCHIVE]??(id===undefined?undefined:getRomFileBytes(project,rom,id));}
export function installedNativeButtonGraphics(bytes:Uint8Array):NARC {
  const arc=new NARC(bytes),metadata=JSON.parse(new TextDecoder().decode(arc.files[13])),g=metadata.nativeGraphics;
  if([8,9].includes(readU16(arc.files[0],4))){if(g?.version!==(readU16(arc.files[0],4)===9?5:4)||g.backupFingerprint!==fingerprint(arc.files[14])||g.packedFingerprint!==g.backupFingerprint)throw new Error("BW1 C-Gear graphics backup failed its integrity check.");return new NARC(arc.files[14]);}
  if(g?.version!==undefined&&![1,2,3,4,5].includes(g.version))throw new Error("Unrecognized native C-Gear graphics version.");
  const backup=new NARC(arc.files[14]),packed=g?.skinSelector?buttonGraphics(backup,undefined,true,g.saveControl===true,g.version??1):packNativeGraphics(backup);
  if(g?.backupFingerprint!==fingerprint(arc.files[14])||g?.packedFingerprint!==fingerprint(packed.save()))throw new Error("Native C-Gear graphics backup failed its integrity check.");
  return packed;
}
export function recoverCGearButtons(bytes:Uint8Array):Project {
  const arc=new NARC(bytes),h=arc.files[0];
  if([5,6,7,8,9].includes(readU16(h,4))){
    const state=JSON.parse(new TextDecoder().decode(arc.files[13])) as Project;
    if(state.document?.version!==1||!Number.isInteger(state.document.nextId)||!Array.isArray(state.document.buttons)||state.document.buttons.length>8||state.document.buttons.some(b=>!b||!Number.isInteger(b.id)||typeof b.label!=="string"||typeof b.color!=="string"||!Number.isFinite(b.x)||!Number.isFinite(b.y)||typeof b.action!=="string"||b.flag&&(!Number.isFinite(b.flag.id)||!["set","clear"].includes(b.flag.when))))throw new Error("Unrecognized editable C-Gear button metadata.");
    return {document:state.document,applied:state.applied,enabled:!!readU32(h,8)};
  }
  const document=legacyDefaults();if(readU16(h,4)===4)document.buttons[1].flag!.id=readU16(h,36);
  return {document,applied:structuredClone(document),enabled:!!readU32(h,8)};
}
export function hydrateCGearButtons(project:ProjectState,rom:NintendoDSRom):void {
  if(project.cgearButtons)return;const bytes=privateArchive(project,rom);if(bytes)try{project.cgearButtons=recoverCGearButtons(bytes);}catch{/* Installation status reports unrecognized or corrupted archives. */}
}
export function stageButtonArchive(project:ProjectState,rom:NintendoDSRom,bytes:Uint8Array):void {const fs=ensureFileSystemState(project),id=rom.filenames.idOf(BUTTON_ARCHIVE);if(fs.additions?.[BUTTON_ARCHIVE]||id===undefined)fs.additions![BUTTON_ARCHIVE]=bytes;else fs.replacements[id]=bytes;}
export function materializeCGearButtonSource(project:ProjectState,rom:NintendoDSRom):void {
  const state=project.cgearButtons;if(!state)return;const prior=privateArchive(project,rom);
  if(prior && [5,6,7,8,9].includes(readU16(new NARC(prior).files[0],4))){const arc=new NARC(prior);arc.files[13]=new TextEncoder().encode(JSON.stringify({...JSON.parse(new TextDecoder().decode(arc.files[13])),...state}));stageButtonArchive(project,rom,arc.save());}
  else if(!prior){const empty={version:1 as const,nextId:1,buttons:[],...(project.session.baseRom==="BW"?{hideCommunicationButtons:true,skins:{nextId:1,defaultId:0,entries:[]}}:{})};const data=compile(state.applied??empty,buttonAssets(project,rom),false,state);if(!data.archive)throw new Error(`Cannot package the button draft: ${data.diagnostics.filter(d=>d.severity==="error").map(d=>d.message).join(" ")}`);stageButtonArchive(project,rom,data.archive);}
}
export function hasUnappliedButtons(project:ProjectState):boolean {const s=ensureCGearButtons(project);return JSON.stringify(s.document)!==JSON.stringify(s.applied);}
export async function resolveButtonAssets(project:ProjectState):Promise<{rom:NintendoDSRom;assets:Assets;bytes:Uint8Array}> {const bytes=project.originalRomBytes??await loadActiveRomBytes();if(!bytes)throw new Error("Reload the source ROM to edit buttons.");const rom=new NintendoDSRom(bytes,{fileData:"view"});return {rom,assets:buttonAssets(project,rom),bytes};}
export function validateButtonArchive(bytes:Uint8Array):boolean {
  const arc=new NARC(bytes),h=arc.files[0];const v=h&&readU16(h,4),bw1=v===8||v===9;if(!h||![5,6,7,8,9].includes(v)||arc.files.length!==(bw1?17:v>=6?16+h[21]:15)||h?.length!==160||readU16(h,6)!==160||readU32(h,0)!==0x41475143||readU32(h,8)>1||readU32(h,12)!==(0x41475143^readU32(h,8))||h[20]>8)throw new Error("Unrecognized configurable C-Gear archive.");
  const joined=(parts:Uint8Array[])=>{const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){b.set(p,at);at+=p.length;}return b;};
  if(fingerprint(joined([h.subarray(0,28),h.subarray(32)]))!==readU32(h,28)||fingerprint(joined(bw1?[...arc.files.slice(1,12),arc.files[16]]:arc.files.slice(1,12)))!==readU32(h,24)||arc.files[12].length!==5120||fingerprint(arc.files[12])!==readU32(h,16))throw new Error("C-Gear configuration or graphics failed its integrity check.");
  if(arc.files[1].length!==(bw1?328:296)||arc.files[2].length!==(v===9?512:bw1?288:240)||arc.files[3].length!==(bw1?328:272)||arc.files.slice(4,12).some(b=>b.length!==(v===9?1024:2048))||(bw1&&arc.files[16].length!==(v===9?512:4096)))throw new Error("Invalid eight-button sprite resources.");
  const metadata=JSON.parse(new TextDecoder().decode(arc.files[13]));
  installedNativeButtonGraphics(bytes);
  const state=recoverCGearButtons(bytes),buttons=state.applied?.buttons??[];
  if(v>=6){
    const skins=state.applied?.skins??(bw1?{nextId:1,defaultId:0,entries:[]}:defaultSkins());validateSkins(skins);const catalog=arc.files[15];
    if(bw1&&(h[21]||readU16(h,22)||h[45]!==1||(state.applied&&!state.applied.hideCommunicationButtons)||skins.entries.length))throw new Error("BW1 requires its native background and hidden communication controls.");
    if(catalog.length!==16+h[21]*8||readU32(catalog,0)!==0x534e4b53||readU16(catalog,4)!==1||readU16(catalog,6)!==h[21]||
       fingerprint(catalog)!==metadata.skinCatalogFingerprint||skins.entries.length!==h[21]||skins.defaultId!==readU16(h,22))throw new Error("Invalid C-Gear skin catalog.");
    for(let i=0;i<skins.entries.length;i++)if(readU16(catalog,16+i*8)!==skins.entries[i].id||readU16(catalog,18+i*8)!==16+i||
      fingerprint(arc.files[16+i])!==readU32(catalog,20+i*8)||fingerprint(skinBytes(skins.entries[i].data))!==readU32(catalog,20+i*8))throw new Error("C-Gear skin failed its integrity check.");
  }
  if(v===7&&(h[45]>1||!!h[45]!==!!state.applied?.hideCommunicationButtons||metadata.nativeGraphics?.skinSelector!==true||metadata.nativeGraphics?.saveControl!==true))throw new Error("Communication controls do not match the applied design.");
  if(v===7&&(h[46]>1||!!h[46]!==!!metadata.nativeGraphics?.muteControl||!!h[46]!== [4,5].includes(metadata.nativeGraphics?.version)))throw new Error("Music control does not match its native graphics.");
  if(buttons.length!==h[20])throw new Error("Editable metadata does not match the applied buttons.");
  const ids=new Set<number>();
  for(let i=0;i<h[20];i++) {
    const b=buttons[i],at=32+i*16,id=readU16(h,at),a=actionFor(b.action,bw1?"BW":"BW2");
    if(!id||id!==b.id||ids.has(id)||!a||a.code!==h[at+2]||
      readU16(h,at+4)!==a.item||readU16(h,at+6)!==(a.alternate??0)||h[at+12]!==a.check||
      h[at+3]!== (b.flag?(b.flag.when==="set"?1:2):0)||readU16(h,at+8)!==(b.flag?.id??0)||
      (b.flag&&(!Number.isInteger(b.flag.id)||b.flag.id<1||b.flag.id>(bw1?2911:3059)))||
      h[at+10]!==b.x||h[at+11]!==b.y||b.x<16||b.x>240||b.y<16||b.y>176)
      throw new Error("Invalid C-Gear button definitions.");
    ids.add(id);
  }
  return !!readU32(h,8);
}
export function disableButtonArchive(bytes:Uint8Array):Uint8Array {const arc=new NARC(bytes),h=arc.files[0];writeU32(h,8,0);writeU32(h,12,0x41475143);const b=new Uint8Array(156);b.set(h.subarray(0,28));b.set(h.subarray(32),28);writeU32(h,28,fingerprint(b));return arc.save();}

/** Only replace our two owned members; preserve palettes, themes and other native edits. */
export function stageNativeButtonGraphics(project:ProjectState,rom:NintendoDSRom,backup:NARC,packed:NARC,enable:boolean,previousPacked?:NARC):void {
  const id=rom.filenames.idOf("a/2/8/7");if(id===undefined)throw new Error("Native C-Gear archive is missing.");
  const native=new NARC(getRomFileBytes(project,rom,id)),current=originalGraphics(native);
  if(!sameGraphics(current,backup)&&!sameGraphics(current,packed)&&!sameGraphics(current,packNativeGraphics(backup))&&!(previousPacked&&sameGraphics(current,previousPacked)))throw new Error("Native C-Gear graphics changed after installation. Restore the owned graphics before updating or disabling.");
  const desired=enable?packed:backup;native.files[16]=desired.files[0].slice();native.files[17]=desired.files[1].slice();ensureFileSystemState(project).replacements[id]=native.save();
}
export function restoreNativeButtonGraphics(project:ProjectState,rom:NintendoDSRom,bytes:Uint8Array):void {
  const arc=new NARC(bytes);if([8,9].includes(readU16(arc.files[0],4))||!arc.files[14])return;const backup=new NARC(arc.files[14]);stageNativeButtonGraphics(project,rom,backup,installedNativeButtonGraphics(bytes),false);
}
