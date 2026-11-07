import select from "../assets/data/moveHistorySelectBindings.json";
import callers from "../assets/data/itemSelectionCallBindings.json";
import black from "../assets/data/moveRecipeBindingsB1.json";
import white from "../assets/data/moveRecipeBindingsW1.json";
import native from "../assets/data/itemNativeBindings.json";
import { readU16 } from "../nds/binary";
import { battleBranchTarget, battleRuntimeResolver, type BattleRuntimeSignature } from "./battleRuntimeBindings";
import type { ItemRuleSet } from "./itemRules";

export const hasItemSelection = (rules: ReadonlyMap<number, ItemRuleSet>) => [...rules.values()].some(rule => rule.effects.some(effect => effect.kind === "itemRecipe:moveRestriction"));
export type ItemSelectionBindings = { address: number; sites: number[]; canUse: number; moveType: number };
export function resolveItemSelection(game: string, overlay: Uint8Array, base: number, arm9: Uint8Array, armBase: number, check: (address:number, size:number)=>void): ItemSelectionBindings {
  const functions = (game === "IRBO" ? black.functions : game === "IRAO" ? white.functions : native.functions) as Record<string, BattleRuntimeSignature>;
  const profile = (select as Record<string, BattleRuntimeSignature>)[game];
  if (!profile) throw Error("Unsupported move-selection profile.");
  const resolver = battleRuntimeResolver(overlay, base, arm9, armBase, { ...functions, HistorySelect: profile });
  const entry = resolver.resolve("HistorySelect"), canUse = resolver.resolve("CanMonUseHeldItem"), moveType = resolver.resolve("PML_MoveGetType");
  const sites: number[] = [];
  for (let at = 0; at + 4 <= overlay.length; at += 2) {
    const hi = readU16(overlay, at), lo = readU16(overlay, at + 2);
    if ((hi & 0xf800) === 0xf000 && (lo & 0xf800) === 0xf800 && battleBranchTarget(overlay, at, base) === entry.address) sites.push(base + at);
  }
  const expected=(callers as Record<string,Array<{hex:string;mask:string}>>)[game];
  if (sites.length !== 5 || !expected || expected.length !== sites.length) throw Error("Unrecognized move-selection callers; item restriction was not installed.");
  sites.forEach((site,index)=>{
    const pattern=expected[index],bytes=Uint8Array.from(pattern.hex.match(/../gu)!,v=>parseInt(v,16)),mask=Uint8Array.from(pattern.mask.match(/../gu)!,v=>parseInt(v,16)),at=site-base-12;
    if(at<0||at+bytes.length>overlay.length||!bytes.every((value,n)=>(overlay[at+n]&mask[n])===(value&mask[n])))throw Error("Unrecognized move-selection caller code.");
    check(site,4);
  });
  return { address: entry.address, sites, canUse: canUse.address, moveType: moveType.address };
}
