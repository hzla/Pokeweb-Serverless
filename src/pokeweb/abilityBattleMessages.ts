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
export const ABILITY_ZEN_MODE_MESSAGES = ["VAR(262, 0) triggered!", "VAR(262, 0) ended!"] as const;
const blockKinds = new Set(["ability:immunity", "abilityRecipe:windAbsorb", "abilityRecipe:moveGuard", "abilityRecipe:priorityGuard"]);
const noticeKinds = new Set(["abilityRecipe:fieldPower", "abilityRecipe:auraInvert", "abilityRecipe:fieldStat", "abilityRecipe:fallenPower", "abilityRecipe:clearScreens", "abilityRecipe:stageOperation", "abilityRecipe:perish", "abilityRecipe:windCharge"]);
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
function ensureMessages(project: ProjectState, messages: readonly string[], bankIds = [project.session.baseRom === "BW" ? 14 : 18]): number {
  if (!project.narcs.message_texts) loadCodeInjectionNarcs(project, new NintendoDSRom(project.originalRomBytes!, {fileData:"view"}), ["message_texts"]);
  const banks = bankIds.map(bankId => {
    const bank = getTextBank(project, "message_texts", bankId);
    const entries = new Map(bank.filter(entry => parseTextEntryId(entry[0]).block === 0).map(entry => [parseTextEntryId(entry[0]).entry, entry[1]]));
    return { bankId, entries, next: Math.max(-1, ...entries.keys()) + 1 };
  });
  for (const [id, text] of banks[0].entries) {
    if (text === messages[0] && banks.every(({ entries }) => messages.every((line, offset) => entries.get(id + offset) === line))) return id;
  }
  const base = Math.max(...banks.map(bank => bank.next));
  if (banks.some(bank => !bank.next) || base > 65532) throw Error("The battle message bank has no room for ability messages.");
  for (const { bankId, next } of banks) {
    addTextEntries(project, "message_texts", bankId, base - next + messages.length);
    for (const entry of getTextBank(project, "message_texts", bankId)) {
      const id = parseTextEntryId(entry[0]);
      if (id.block === 0 && id.entry >= base && id.entry < base + messages.length) entry[1] = messages[id.entry - base];
    }
    commitTextBank(project, "message_texts", bankId);
  }
  return base;
}
/** Append native message variants without changing existing battle text. */
export function ensureAbilityBlockMessages(project: ProjectState, rules: ReadonlyMap<number, AbilityRuleSet>): number | undefined {
  if (![...rules.values()].some(rule => rule.effects.some(effect => blockKinds.has(effect.kind)))) return;
  return ensureMessages(project, ABILITY_BLOCK_MESSAGES);
}
export function ensureAbilityPresentationMessages(project: ProjectState, rules: ReadonlyMap<number, AbilityRuleSet>): number[] | undefined {
  const effects = [...rules.values()].flatMap(rule => rule.effects);
  const zen = effects.some(effect => effect.kind === "abilityRecipe:zenMode");
  const existingNotices = effects.some(effect => noticeKinds.has(effect.kind));
  // BW2 uses a different standard message bank during Pokéstar battles.
  const zenMessage = zen ? ensureMessages(project, ABILITY_ZEN_MODE_MESSAGES, project.session.baseRom === "BW" ? [15] : [19, 17]) : undefined;
  if (!existingNotices) return zenMessage === undefined ? undefined : [...Array<number>(34).fill(0), zenMessage];
  const triplet = (message: string) => ensureMessages(project, [message, message.replace("VAR(258, 0)", "The wild VAR(258, 0)"), message.replace("VAR(258, 0)", "The foe's VAR(258, 0)")]);
  const auraTypes = new Set([...rules.values()].flatMap(rule => rule.effects.filter(effect => effect.kind === "abilityRecipe:fieldPower").map(effect => effect.parameters?.type ?? 16)));
  const names = typeNamesForProject(project), texts = new Map<number,string>(), auras = Array<number>(18).fill(0);
  for (const type of auraTypes) {
    const name = names[type];
    if (!name || /[\\\r\n\x00-\x1f]|VAR\(/u.test(name)) throw Error("Aura type names must be plain text.");
    texts.set(type, `VAR(258, 0) is radiating\\nan aura of ${name}!`);
  }
  const ids = notices.map(triplet);
  for (const [type,text] of texts) auras[type] = triplet(text);
  const messages = [...ids, ...auras];
  if (effects.some(effect => effect.kind === "abilityRecipe:windCharge")) messages.push(triplet("VAR(258, 0) became charged\\nwith power!"));
  if (zenMessage !== undefined) {
    messages[33] ??= 0;
    messages.push(zenMessage);
  }
  return messages;
}
