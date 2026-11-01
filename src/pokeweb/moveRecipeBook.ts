import { validateMoveRule, type MoveRuleSet } from "./moveRules";
import { strFromU8, strToU8, unzlibSync, zlibSync } from "fflate";
/** Deduplicate templates and omit repeated field names from the DLL metadata. */
export function encodeMoveRecipeBook(rules: ReadonlyMap<number, MoveRuleSet>, originals: ReadonlyMap<number, Record<string, number>>, fields: readonly string[], packed = false): string {
  const pool: MoveRuleSet[] = [], indices = new Map<string, number>();
  const rows = [...rules].sort(([a],[b])=>a-b).map(([id,rule]) => {
    const key=JSON.stringify(rule);let index=indices.get(key);
    if(index===undefined){index=pool.length;pool.push(rule);indices.set(key,index);}
    const source=originals.get(id);if(!source)throw Error("Missing original move data.");
    return [id,index,...fields.map(f=>source[f])];
  });
  const text=JSON.stringify({pool,rows});
  if(text.length>60000)throw Error("Move recipe metadata exceeds its bound.");
  if(!packed)return text;
  const compressed=zlibSync(strToU8(text),{level:9});
  let binary="";for(const byte of compressed)binary+=String.fromCharCode(byte);
  return `z1:${btoa(binary)}`;
}
export function decodeMoveRecipeBook(text: string, fields: readonly string[]) {
  if(text.startsWith("z1:")){
    if(text.length>80000)throw Error("Move recipe metadata exceeds its bound.");
    try{
      const binary=atob(text.slice(3)),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
      const unpacked=unzlibSync(bytes,{out:new Uint8Array(60001)});
      if(unpacked.length>60000)throw Error("Move recipe metadata exceeds its bound.");
      text=strFromU8(unpacked);
    }catch{throw Error("Invalid compressed move recipe metadata.");}
  }
  if(text.length>60000)throw Error("Move recipe metadata exceeds its bound.");
  const book=JSON.parse(text) as {pool:MoveRuleSet[];rows:number[][]};
  if(!Array.isArray(book.pool)||!Array.isArray(book.rows)||!book.rows.length||book.rows.length>2048||book.pool.length>book.rows.length)throw Error("Invalid move recipe book.");
  const rules=new Map<number,MoveRuleSet>(),originals=new Map<number,Record<string,number>>();
  const pool=book.pool.map(validateMoveRule);
  for(const row of book.rows){
    if(!Array.isArray(row)||row.length!==fields.length+2||!row.every(Number.isInteger)||row[0]<1||row[0]>65534||rules.has(row[0])||row[1]<0||row[1]>=pool.length||row.slice(2).some(v=>v<0||v>65535))throw Error("Invalid move recipe book row.");
    rules.set(row[0],structuredClone(pool[row[1]]));originals.set(row[0],Object.fromEntries(fields.map((field,i)=>[field,row[i+2]])));
  }
  return {rules,originals};
}
