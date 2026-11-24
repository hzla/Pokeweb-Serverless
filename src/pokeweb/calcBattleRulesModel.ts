import { calcAbilityTemplateId, exportCalcEffect } from "./calcAbilityCatalog";
import calcAbilityManifest from "../assets/data/calcAbilityManifest.json";
import vanillaAbilities from "../assets/data/vanilla_abilities.txt?raw";
import { ABILITY_EFFECTS_DLL_PATH, readCalcAbilityEffects } from "./abilityEffectsModel";
import { isVanillaAbilityRule } from "./abilityNativeRuntime";
import { defaultMoveDllFlags } from "./abilityMoveClasses";
import { resolveCalcItemName } from "./calcItemNames";
import { calcNativeItemGain, readCalcItemEffects, ITEM_EFFECTS_DLL_PATH } from "./itemEffectsModel";
import type { ItemRuleEffect } from "./itemRules";
import { inspectMoveEffects, MOVE_EFFECTS_DLL_PATH } from "./moveEffectsModel";
import { MOVE_PRIMITIVES } from "./moveRules";
import { getItemRecord, getMoveCount, getMoveRecord } from "./moveItemModel";
import { listCodeInjectionDlls } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { getTrainerFieldConditions, TRAINER_GLOBAL_CONDITIONS, TRAINER_SIDE_CONDITIONS } from "./trainerFieldConditionsModel";

const stockAbilityNames = vanillaAbilities.split(/\r?\n/u);

export function calcTrainerOpening(project: ProjectState, id: number) {
  if (project.session.baseRom !== "BW2") return {};
  const field = getTrainerFieldConditions(project, id);
  const names = (mask: number, definitions: readonly {id: number; label: string}[]) =>
    definitions.filter(entry => mask & 1 << entry.id).map(entry => entry.label.toLowerCase().replaceAll(" ", ""));
  const weather = [undefined, "Clear", "Sun", "Rain", "Hail", "Sand"][field.weather];
  return {
    ...(weather ? { weather } : {}),
    ...(field.fields ? { fieldGlobal: names(field.fields, TRAINER_GLOBAL_CONDITIONS) } : {}),
    ...(field.player ? { fieldLeft: names(field.player, TRAINER_SIDE_CONDITIONS) } : {}),
    ...(field.opponent ? { fieldRight: names(field.opponent, TRAINER_SIDE_CONDITIONS) } : {}),
    ...(field.playerSpikes ? { spikesLeft: field.playerSpikes } : {}),
    ...(field.opponentSpikes ? { spikesRight: field.opponentSpikes } : {}),
    ...(field.playerToxicSpikes ? { toxicSpikesLeft: field.playerToxicSpikes } : {}),
    ...(field.opponentToxicSpikes ? { toxicSpikesRight: field.opponentToxicSpikes } : {}),
  };
}

function exportItemEffect(project: ProjectState, effect: ItemRuleEffect, assigned = false) {
  const exported = exportCalcEffect(effect);
  const profile = effect.kind.startsWith("native:") ? Number(effect.kind.slice(7)) : 0;
  const gain = calcNativeItemGain(profile);
  if (!gain) return exported;
  const percent = effect.value !== -1 ? effect.value :
    !assigned && project.narcs.items?.rawFiles[profile] ? Number(getItemRecord(project, profile).raw.gain_values) : gain.original;
  return {
    ...exported,
    // Native item percentages are truncated to fixed point by the ROM.
    value: Math.floor((100 + percent) * 4096 / 100) / 4096,
    kind: gain.stage === "power" ? "itemRecipe:power" : "itemRecipe:nativeDamage",
    parameters: { type: gain.type ?? 18, category: gain.category ?? 0, superEffective: Number(gain.superEffective ?? false) },
    ...(profile === 270 ? { additionalManualEffect: "recoil" } : {}),
  };
}

export function buildCalcBattleRules(project: ProjectState, moveName: (value: unknown) => string, abilityName: (value: unknown) => string, catalogFingerprint?: string) {
  if (project.session.baseRom !== "BW" && project.session.baseRom !== "BW2") return undefined;
  const modules = new Set(listCodeInjectionDlls(project).map(module => module.path.toLowerCase()));
  const has = (path: string) => modules.has(path.toLowerCase());
  const warnings: string[] = [];
  const read = <T>(label: string, installed: boolean, readRules: () => T) => {
    try { return readRules(); }
    catch {
      if (installed) warnings.push(`${label} runtime could not be verified for calculator export.`);
      return undefined;
    }
  };
  const abilitiesInstalled = has(ABILITY_EFFECTS_DLL_PATH);
  const abilities = read("Ability", abilitiesInstalled, () => readCalcAbilityEffects(project, abilitiesInstalled));
  const itemsInstalled = has(ITEM_EFFECTS_DLL_PATH) || [...modules].some(path => /^patches\/itemtypehealing\d+\.dll$/u.test(path));
  const items = read("Item", itemsInstalled, () => readCalcItemEffects(project, itemsInstalled));
  const moves = read("Move", has(MOVE_EFFECTS_DLL_PATH), () => {
    if (!has(MOVE_EFFECTS_DLL_PATH)) return [];
    const result = inspectMoveEffects(project);
    if (!result.editable) throw Error(result.message);
    return [...result.rules].map(([id, rule]) => [id, {
      ...rule, effects: rule.effects.map(effect => {
        const definition = MOVE_PRIMITIVES.find(p => p.kind === effect.kind);
        return { ...effect, label: definition?.label, parameters: { ...Object.fromEntries((definition?.parameters ?? []).map(p => [p.key, p.original])), ...effect.parameters } };
      }),
    }] as const);
  });
  const banks = project.texts.banks;
  const nameRows = (names: readonly string[] | undefined, format: (name: string) => string) =>
    (names ?? []).flatMap((name, id) => id && typeof name === "string" && name.trim() ? [[id, format(name)] as const] : []);
  const customFlags = new Map<number, number[]>();
  for (const flag of abilities?.customFlags ?? []) for (const id of flag.moves) {
    const flags = customFlags.get(id) ?? [];
    flags.push(flag.id);
    customFlags.set(id, flags);
  }
  const abilityRules = [...(abilities?.rules ?? [])].filter(([id, rule]) => !isVanillaAbilityRule(id, rule));
  const editedSlots = new Set(abilityRules.map(([id]) => id));
  const stockAliases = nameRows(banks.abilities, abilityName).flatMap(([id, name]) => {
    const original = abilityName(stockAbilityNames[id]);
    return original && name !== original && !editedSlots.has(id) ? [[id, original] as const] : [];
  });
  const references = new Map<number, number>();
  if (catalogFingerprint === calcAbilityManifest.fingerprint) {
    for (const [id, rule] of abilityRules) {
      const template = calcAbilityTemplateId(rule, banks.abilities?.[id]);
      if (template !== undefined) references.set(id, template);
    }
  }
  return {
    version: 1,
    baseGame: project.session.baseRom,
    ...(references.size ? { abilityTemplateCatalog: catalogFingerprint, abilityTemplates: [...references] } : {}),
    ...(stockAliases.length ? { stockAbilityAliases: stockAliases } : {}),
    abilities: abilityRules.filter(([id]) => !references.has(id)).map(([id, rule]) =>
      [id, { ...rule, effects: rule.effects.map(exportCalcEffect) }] as const),
    items: [
      ...[...(items?.rules ?? [])].map(([id, rule]) => [id, { ...rule, effects: rule.effects.map(effect => exportItemEffect(project, effect)) }] as const),
      ...(items?.native ?? []).map(({ id, profile, value }) =>
        [id, { effects: [exportItemEffect(project, { kind: `native:${profile}`, value }, true)] }] as const),
    ],
    moves: moves ?? [],
    names: {
      abilities: nameRows(banks.abilities, abilityName),
      items: nameRows(banks.items, name => resolveCalcItemName(name) ?? name),
    },
    moveData: Array.from({ length: Math.max(0, getMoveCount(project) - 1) }, (_, index) => {
      const id = index + 1, move = getMoveRecord(project, id);
      const name = moveName(banks.moves?.[id] ?? move.readable.name ?? `Move ${id}`);
      const flags = customFlags.get(id);
      const data = [id, name, move.raw.properties ?? 0, abilities?.flags[id] ?? defaultMoveDllFlags(id)] as const;
      return flags ? [...data, flags] as const : data;
    }),
    ...(warnings.length ? { warnings } : {}),
  };
}
