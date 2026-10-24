import { NARC } from '../nds/narc';
import { plainSceneText } from './cutsceneDialogue';
import { encodeGen5TextBank, decodeGen5TextBank } from './text';
import type { FieldScene, FieldDialogueStep } from './fieldScene';
import {readU16,readU32,writeU16,writeU32,concatBytes} from '../nds/binary';

export type FieldDialogueBinding = { bankId: number; messageIds: number[] };
export type FieldDialogueBindings = Record<string, FieldDialogueBinding>;

/** Two conservatively wrapped lines per native field balloon. Pagination is
 * explicit, so timed messages never wait on an implicit engine page break. */
export function fieldDialoguePages(text: string): string[][] {
  if(typeof text!=='string'||!text.trim()||text.length>512)throw new Error('Dialogue needs 1–512 characters.');
  plainSceneText(text);
  const lines:string[]=[];
  for(const paragraph of text.split('\n')){
    if(!paragraph.trim()){lines.push('');continue;}
    let line='';
    for(const word of paragraph.trim().split(/ +/)){
      if(word.length>24)throw new Error('A dialogue word exceeds 24 characters. Shorten it or insert a line break.');
      if(line&&line.length+1+word.length>24){lines.push(line);line='';}
      line+=(line?' ':'')+word;
    }
    lines.push(line);
  }
  if(lines.length>24)throw new Error('Split speeches longer than twelve pages into more dialogue blocks.');
  return Array.from({length:Math.ceil(lines.length/2)},(_,i)=>lines.slice(i*2,i*2+2));
}

export function formatFieldDialogue(scene: Pick<FieldScene,'actors'>,step: FieldDialogueStep) {
  const speaker=step.speakerId==='player'?'Player':scene.actors?.find(a=>a.id===step.speakerId)?.name;
  if(!speaker)throw new Error('Dialogue speaker must be the player or an existing NPC. Reassign its dialogue before removing an NPC.');
  return {speaker,pages:fieldDialoguePages(step.text)};
}

/** Extend the native system-window bank without decoding/re-encoding existing
 * encrypted strings, flags, or control codes. Their table offsets alone move. */
export function appendFieldNarration(bytes:Uint8Array,texts:string[]){
  const oldCount=readU16(bytes,2),block=readU32(bytes,12),size=readU32(bytes,block);
  if(readU16(bytes,0)!==1||!oldCount||block+size>bytes.length||size<4+oldCount*8||oldCount+texts.length>=0x4000)throw new Error('Narration requires a supported single-block map story bank.');
  const encoded=encodeGen5TextBank([...Array.from({length:oldCount},(_,i)=>[`0_${i}`,'',0] as [string,string,number]),...texts.map((t,i)=>[`0_${oldCount+i}`,t,0] as [string,string,number])]),eb=readU32(encoded,12),extra=texts.length*8,table=new Uint8Array(4+(oldCount+texts.length)*8),parts=[bytes.slice(block+4+oldCount*8,block+size)];table.set(bytes.slice(block+4,block+4+oldCount*8),4);
  for(let i=0;i<oldCount;i++)writeU32(table,4+i*8,readU32(table,4+i*8)+extra);
  let cursor=table.length+parts[0].length;
  texts.forEach((_,i)=>{const p=eb+4+(oldCount+i)*8,start=eb+readU32(encoded,p),length=readU16(encoded,p+4)*2;table.set(encoded.slice(p,p+8),4+(oldCount+i)*8);writeU32(table,4+(oldCount+i)*8,cursor);parts.push(encoded.slice(start,start+length));cursor+=length;});writeU32(table,0,cursor);
  const out=concatBytes([bytes.slice(0,block),table,...parts,bytes.slice(block+size)]);writeU16(out,2,oldCount+texts.length);writeU32(out,4,readU32(bytes,4)+cursor-size);return out;
}

/** Actor balloons use a private bank; native narration appends messages to the
 * target map's bank while retaining every original encrypted message. */
export function stageFieldSceneDialogue(archiveBytes:Uint8Array,scene:FieldScene,defaultBankId?:number) {
  const dialogue=scene.steps.filter((s):s is FieldDialogueStep=>s.type==='dialogue');
  if(!dialogue.length)return {bytes:undefined,bindings:{} as FieldDialogueBindings,bankId:undefined};
  const archive=new NARC(archiveBytes),bindings:FieldDialogueBindings={},messages:string[]=[],narration=dialogue.some(s=>s.window==='narration');
  if(narration&&(defaultBankId===undefined||!archive.files[defaultBankId]))throw new Error('Narration needs the target map story-text bank.');
  const originals=narration?decodeGen5TextBank(archive.files[defaultBankId!]):[],nativeMessages=[...originals];
  // 0x400 means the script's default bank; >=0x4000 reads a work variable.
  if(archive.files.length===0x400)archive.files.push(encodeGen5TextBank([['0_0','',0]]));
  const bankId=archive.files.length;
  if(bankId>=0x4000)throw new Error('No literal field dialogue bank IDs are available.');
  for(const step of dialogue){const pages=formatFieldDialogue(scene,step).pages,messageIds:number[]=[];
    for(const page of pages){if(step.window==='narration'){messageIds.push(nativeMessages.length);nativeMessages.push([`0_${nativeMessages.length}`,page.join('\\n'),0]);}else{messageIds.push(messages.length);messages.push(page.join('\\n'));}}
    bindings[step.id]={bankId:step.window==='narration'?defaultBankId!:bankId,messageIds};
  }
  if(messages.length){const encoded=encodeGen5TextBank(messages.map((text,i)=>[`0_${i}`,text,0]));
    if(JSON.stringify(decodeGen5TextBank(encoded).map(e=>e[1]))!==JSON.stringify(messages))throw new Error('Dialogue text does not round trip through the W2 text encoder.');archive.files.push(encoded);}
  if(narration){archive.files[defaultBankId!]=appendFieldNarration(archive.files[defaultBankId!],nativeMessages.slice(originals.length).map(e=>e[1]));if(JSON.stringify(decodeGen5TextBank(archive.files[defaultBankId!]).slice(0,originals.length))!==JSON.stringify(originals))throw new Error('Existing map messages did not round trip.');}
  return {bytes:archive.save(),bindings,bankId:messages.length?bankId:defaultBankId};
}
