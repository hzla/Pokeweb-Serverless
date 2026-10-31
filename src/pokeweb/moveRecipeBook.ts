import { validateMoveRule, type MoveRuleSet } from "./moveRules";
/** Deduplicate templates and omit repeated field names from the DLL metadata. */
export function encodeMoveRecipeBook(rules: ReadonlyMap<number, MoveRuleSet>, originals: ReadonlyMap<number, Record<string, number>>, fields: readonly string[]): string {
  const pool: MoveRuleSet[] = [], indices = new Map<string, number>();
  const rows = [...rules].sort(([a],[b])=>a-b).map(([id,rule]) => {
    const key=JSON.stringify(rule);let index=indices.get(key);
    if(index===undefined){index=pool.length;pool.push(rule);indices.set(key,index);}
    const source=originals.get(id);if(!source)throw Error("Missing original move data.");
    return [id,index,...fields.map(f=>source[f])];
  });
  return JSON.stringify({pool,rows});
}
export function decodeMoveRecipeBook(text: string, fields: readonly string[]) {
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
