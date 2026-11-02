import type { AbilityRuleSet } from "./abilityRules";
import type { ProjectState } from "./projectStore";
import { addTextEntries, commitTextBank, getTextBank, parseTextEntryId } from "./textModel";
import { loadCodeInjectionNarcs } from "./codeInjectionInstall";
import { NintendoDSRom } from "../nds/rom";
import { typeNamesForProject } from "./constants";

export const ABILITY_BLOCK_MESSAGES = [
  "VAR(258, 0)'s VAR(262, 1)\\nblocked VAR(263, 2)!",
  "The wild VAR(258, 0)'s VAR(262, 1)\\nblocked VAR(263, 2)!",
  "The foe's VAR(258, 0)'s VAR(262, 1)\\nblocked VAR(263, 2)!",
];
const blockKinds = new Set(["ability:immunity", "abilityRecipe:windAbsorb", "abilityRecipe:moveGuard", "abilityRecipe:priorityGuard"]);
const noticeKinds = new Set(["abilityRecipe:fieldPower", "abilityRecipe:auraInvert", "abilityRecipe:fieldStat", "abilityRecipe:fallenPower", "abilityRecipe:clearScreens", "abilityRecipe:stageOperation", "abilityRecipe:perish"]);
const notices = [
  "VAR(258, 0) is radiating\\nan aura of VAR(259, 1)!",
  "VAR(258, 0) reversed\\nother Pokémon's auras!",
  ...["weakened", "strengthened"].flatMap(verb => ["Attack", "Defense", "Sp. Atk", "Sp. Def"].map(stat => `VAR(258, 0) ${verb} the\\n${stat} of nearby Pokémon!`)),
  "VAR(258, 0) gained strength\\nfrom its fallen allies!",
  "VAR(258, 0) cleared away\\nthe screens!",
  "VAR(258, 0)'s stats\\nreturned to normal!",
  "VAR(258, 0) copied\\nVAR(258, 1)'s stat changes!",
  "Both Pokémon will faint\\nwhen the count reaches zero!",
];
function ensureTriplet(project: ProjectState, messages: readonly string[]): number {
  if (!project.narcs.message_texts) loadCodeInjectionNarcs(project, new NintendoDSRom(project.originalRomBytes!, {fileData:"view"}), ["message_texts"]);
  const bankId = project.session.baseRom === "BW" ? 14 : 18, bank = getTextBank(project, "message_texts", bankId);
  const entries = new Map(bank.filter(entry => parseTextEntryId(entry[0]).block === 0).map(entry => [parseTextEntryId(entry[0]).entry, entry[1]]));
  for (const [id, text] of entries) if (text === messages[0] && messages.every((text, offset) => entries.get(id + offset) === text)) return id;
  const base = Math.max(-1, ...entries.keys()) + 1;
  if (!entries.size || base + 2 >= 65535) throw Error("The battle message bank has no room for ability messages.");
  addTextEntries(project, "message_texts", bankId, 3);
  for (const entry of getTextBank(project, "message_texts", bankId)) {
    const id = parseTextEntryId(entry[0]);
    if (id.block === 0 && id.entry >= base && id.entry < base + 3) entry[1] = messages[id.entry - base];
  }
  commitTextBank(project, "message_texts", bankId);
  return base;
}
/** Append native message variants without changing existing battle text. */
export function ensureAbilityBlockMessages(project: ProjectState, rules: ReadonlyMap<number, AbilityRuleSet>): number | undefined {
  if (![...rules.values()].some(rule => rule.effects.some(effect => blockKinds.has(effect.kind)))) return;
  return ensureTriplet(project, ABILITY_BLOCK_MESSAGES);
}
export function ensureAbilityPresentationMessages(project: ProjectState, rules: ReadonlyMap<number, AbilityRuleSet>): number[] | undefined {
  if (![...rules.values()].some(rule => rule.effects.some(effect => noticeKinds.has(effect.kind)))) return;
  const triplet = (message: string) => ensureTriplet(project, [message, message.replace("VAR(258, 0)", "The wild VAR(258, 0)"), message.replace("VAR(258, 0)", "The foe's VAR(258, 0)")]);
  const auraTypes = new Set([...rules.values()].flatMap(rule => rule.effects.filter(effect => effect.kind === "abilityRecipe:fieldPower").map(effect => effect.parameters?.type ?? 16)));
  const names = typeNamesForProject(project), texts = new Map<number,string>(), auras = Array<number>(18).fill(0);
  for (const type of auraTypes) {
    const name = names[type];
    if (!name || /[\\\r\n\x00-\x1f]|VAR\(/u.test(name)) throw Error("Aura type names must be plain text.");
    texts.set(type, `VAR(258, 0) is radiating\\nan aura of ${name}!`);
  }
  const ids = notices.map(triplet);
  for (const [type,text] of texts) auras[type] = triplet(text);
  return [...ids, ...auras];
}
