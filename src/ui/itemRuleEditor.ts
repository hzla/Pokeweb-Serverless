import {recipeAbilityEffect} from "../pokeweb/abilityRecipeEffects";
import { nativeAbilityProfile } from "../pokeweb/abilityNativeRuntime";
import { ITEM_RULE_EFFECTS, ITEM_RULE_WEATHER, ITEM_RULE_STATUS_LABELS, ITEM_RULE_STAT_LABELS, ITEM_RULE_TRIGGERS, ITEM_RULE_TARGETS, ITEM_RULE_TRIGGER_LABELS, validateItemRule, type ItemRuleCondition, type ItemRuleSet, type ItemRuleEffect, type ItemRuleEffectDefinition } from "../pokeweb/itemRules";
import { configureItemRuleSets } from "../pokeweb/itemEffectsModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { typeNamesForProject } from "../pokeweb/constants";
import { ITEM_RULE_PRESETS, itemRulePreset } from "../pokeweb/itemRulePresets";
import { getItemRecord } from "../pokeweb/moveItemModel";
import { escapeHtml } from "./dom";
import { libraryAbilityEffect } from "../pokeweb/abilityLibraryEffects";

export type RuleFormOptions = {
  definitions?: readonly ItemRuleEffectDefinition[];
  presets?: readonly { id: number; label: string; group?: string }[];
  ability?: boolean;
  apply?: (rule: ItemRuleSet) => Promise<void>;
  preset?: (id: number) => ItemRuleSet;
  imported?: (id:number) => void;
};

const option = (value: string | number, label: string, selected: string | number) => `<option value="${value}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
function group(node: ItemRuleCondition, types: string[], path = "", depth = 0): string {
  if (node.kind === "group") return `<fieldset data-rule-group data-rule-path="${path}" class="item-rule-group">
    <legend>${depth ? "Group" : "Activation conditions"}</legend>
    <div class="item-rule-group-tools"><select data-rule-mode aria-label="${depth ? "Group" : "Activation"} condition logic">${option("all", "All (AND)", node.mode)}${option("any", "Any (OR)", node.mode)}</select>
      <button type="button" class="btn -default" data-rule-action="add-condition" data-rule-path="${path}" ${node.children.length >= 8 ? "disabled" : ""}>+ Condition</button>
      <button type="button" class="btn -default" data-rule-action="add-group" data-rule-path="${path}" ${depth >= 3 || node.children.length >= 8 ? "disabled" : ""}>+ Group</button>
      ${depth ? `<button type="button" class="btn -default" data-rule-action="remove-condition" data-rule-path="${path}" aria-label="Remove condition group">Remove</button>` : ""}</div>
    <div data-rule-children>${node.children.length ? node.children.map((child, index) => group(child, types, path ? `${path}.${index}` : String(index), depth + 1)).join("") : `<span class="item-native-hint">${depth ? "Add a condition" : "Always active"}</span>`}</div>
  </fieldset>`;
  return `<div class="item-rule-condition" data-rule-condition data-rule-kind="${node.kind}" data-rule-path="${path}">
    <select data-rule-condition-kind aria-label="Condition type">${option("hp", "Holder HP", node.kind)}${option("type", "Holder type", node.kind)}${option("weather", "Weather", node.kind)}${option("species", "Holder species", node.kind)}${option("status", "Holder status", node.kind)}${option("moveType", "Move type", node.kind)}${option("category", "Move category", node.kind)}</select>
    ${node.kind === "hp" ? `<select data-rule-comparison aria-label="HP comparison">${[["lt", "Below (<)"], ["lte", "At most (≤)"], ["gt", "Above (>)"], ["gte", "At least (≥)"]].map(([v, label]) => option(v, label, node.comparison)).join("")}</select><label class="item-rule-value"><input data-rule-condition-value aria-label="HP percent" type="number" min="0" max="100" step="1" value="${node.percent}"><span>%</span></label>`
      : `<select data-rule-negate aria-label="Condition comparison">${option(0, "Is", Number(Boolean(node.negate)))}${option(1, "Is not", Number(Boolean(node.negate)))}</select>${node.kind === "species" ? `<input data-rule-condition-value aria-label="Species ID" type="number" min="1" max="1023" value="${node.value}">` : `<select data-rule-condition-value aria-label="Condition value">${(node.kind === "type" || node.kind === "moveType" ? types : node.kind === "weather" ? ITEM_RULE_WEATHER : node.kind === "category" ? ["Status", "Physical", "Special"] : ["None", ...ITEM_RULE_STATUS_LABELS.slice(0, 6)]).map((label, id) => option(id, label, node.value)).join("")}</select>`}`}
    <button type="button" class="btn -default" data-rule-action="remove-condition" data-rule-path="${path}" aria-label="Remove condition">×</button>
  </div>`;
}
function effectFields(effect: ItemRuleEffect, index: number, types: string[], options: RuleFormOptions, abilityNames: string[] = []): string {
  const definition = (options.definitions ?? ITEM_RULE_EFFECTS).find(d => d.kind === effect.kind)!;
  const select = (attribute: string, label: string, labels: readonly string[], selected: number, first = 0) => `<label><span>${label}</span><select ${attribute} aria-label="Effect ${index + 1} ${label.toLowerCase()}">${labels.map((text, i) => option(i + first, text, selected)).join("")}</select></label>`;
  const number = `<label class="item-rule-value"><input data-rule-effect-value aria-label="Effect ${index + 1} value" type="number" min="${effect.kind.startsWith("native:") ? 1 : effect.kind.startsWith("nativeAbility:") ? .125 : definition.min}" max="${definition.max}" step="${definition.step}" value="${effect.value}"><span>${definition.unit}</span></label>`;
  const native = effect.kind.startsWith("native:") || effect.kind.startsWith("nativeAbility:");
  let fields = effect.kind === "status" ? select("data-rule-effect-value", "Status", ITEM_RULE_STATUS_LABELS, effect.value, 1)
    : effect.kind === "moveType" ? select("data-rule-effect-value", "Type", types, effect.value)
    : definition.valueChoices ? `<label><span>Effectiveness</span><select data-rule-effect-value aria-label="Effect ${index+1} value">${definition.valueChoices.map(v=>option(v,definition.valueLabels?.[v]??String(v),effect.value)).join("")}</select></label>`
    : definition.min===definition.max ? `<input data-rule-effect-value type="hidden" value="1">`
    : native ? definition.parameterLabel ? `<label><span>${escapeHtml(definition.parameterLabel)}</span><select data-rule-native-original aria-label="Native parameter mode">${option(1, "Original", Number(effect.value === -1))}${option(0, "Custom", Number(effect.value === -1))}</select></label>${effect.value === -1 ? `<input data-rule-effect-value type="hidden" value="-1">` : number}` : `<input data-rule-effect-value type="hidden" value="${effect.value}">` : number;
  if (effect.kind === "statStage") fields = select("data-rule-stat", "Stat", ITEM_RULE_STAT_LABELS, effect.stat ?? 1, 1) + fields;
  if (["status", "statStage", "recoil"].includes(effect.kind)) {
    const timing = effect.trigger ?? (effect.kind === "statStage" ? "entry" : effect.kind === "status" ? "turnEnd" : "afterAttack");
    fields += select("data-rule-trigger", "Trigger", ITEM_RULE_TRIGGER_LABELS, ITEM_RULE_TRIGGERS.indexOf(timing));
    fields += select("data-rule-target", "Target", ["Holder", "Attacker", "Defender"], ITEM_RULE_TARGETS.indexOf(effect.target ?? "holder"));
    fields += `<label><span>Chance (%)</span><input data-rule-chance aria-label="Effect ${index + 1} chance" type="number" min="1" max="100" value="${effect.chance ?? 100}"></label>`;
  }
  if (effect.kind === "moveType") fields += `<label><span>Move ID (0 = any)</span><input data-rule-move aria-label="Move type filter" type="number" min="0" max="1023" value="${effect.move ?? 0}"></label>`;
  const profile = nativeAbilityProfile(effect.kind), library=libraryAbilityEffect(effect.kind)??recipeAbilityEffect(effect.kind);
  if (profile?.stats) fields += select("data-rule-stat", "Stat lowered", ITEM_RULE_STAT_LABELS, effect.stat ?? profile.stats[0].original, 1);
  if (profile?.weather) fields += `<label><span>Weather check</span><select data-rule-native-weather aria-label="Native weather check">${option(-1, "Original", effect.weather ?? -1)}${ITEM_RULE_WEATHER.map((text, id) => option(id, text, effect.weather ?? -1)).join("")}</select></label>`;
  if (profile?.chances) fields += `<label><span>Activation chance (%)</span><input type="number" data-rule-native-chance aria-label="Native activation chance" min="1" max="100" placeholder="Original" value="${effect.chance ?? ""}"></label>`;
  for (const control of profile?.parameters ?? library?.parameters ?? []) {
    if(control.when){const current=effect.parameters?.[control.when.key]??library?.parameters.find(p=>p.key===control.when!.key)?.original;if(Array.isArray(control.when.value)?!control.when.value.includes(current!):current!==control.when.value)continue;}
    const value=effect.parameters?.[control.key], labels=control.kind==="ability"?abilityNames:control.kind==="type"?types:control.kind==="weather"?ITEM_RULE_WEATHER:control.kind==="category"?["Status","Physical","Special"]:control.kind==="stat"?["",...ITEM_RULE_STAT_LABELS,"All stats"]:control.kind==="status"||control.kind==="majorStatus"?["","Paralysis","Sleep","Freeze","Burn","Poison","Confusion","Infatuation"]:undefined;
    const text=(id:number)=>control.labels?.[id]??(id===14&&control.kind==="status"?"Yawn":(control.kind==="ability"?`${id} · ${labels?.[id]||`Ability ${id}`}`:labels?.[id]??String(id)));
    const values=(control.choices??Array.from({length:control.max-control.min+1},(_,i)=>control.min+i)).filter(id=>control.kind!=="type"||id<types.length||control.labels?.[id]!==undefined);
    fields+=`<label><span>${escapeHtml(control.label)}</span>${labels||control.choices?`<select data-rule-native-parameter="${control.key}" aria-label="Effect ${index+1} ${escapeHtml(control.label.toLowerCase())}">${option("",`Original (${text(control.original)})`,value??"")}${values.map(id=>option(id,text(id),value??"")).join("")}</select>`:`<input type="number" data-rule-native-parameter="${control.key}" aria-label="Effect ${index+1} ${escapeHtml(control.label.toLowerCase())}" min="${control.min}" max="${control.max}" step="${control.step}" placeholder="Original (${Number(control.original.toFixed(3))})" value="${value??""}">`}</label>`;
  }
  if (options.ability) fields += `<label class="ability-rule-bypass"><input type="checkbox" data-rule-bypass ${((effect as ItemRuleEffect & { bypassable?: boolean }).bypassable ?? (profile ? true : library?.bypassable ?? ["defense", "specialDefense", "incomingAccuracy"].includes(effect.kind))) ? "checked" : ""}>${profile ? "Use native Mold Breaker rules" : "Mold Breaker can bypass"}</label>`;
  return fields;
}
export function renderItemRuleForm(project: ProjectState, rule: ItemRuleSet, options: RuleFormOptions = {}): string {
  const root = rule.conditions.kind === "group" ? rule.conditions : { kind: "group" as const, mode: "all" as const, children: [rule.conditions] };
  const presets=options.presets??ITEM_RULE_PRESETS,groups=[...new Set(presets.map(p=>"group"in p?p.group:undefined))];
  const choices=groups.map(name=>`${name?`<optgroup label="${escapeHtml(name)}">`:""}${presets.filter(p=>("group"in p?p.group:undefined)===name).map(p=>option(p.id,p.label,"")).join("")}${name?"</optgroup>":""}`).join("");
  return `<div class="item-rule-form" data-item-rule-form>
    ${options.ability ? `<p class="ability-effects-help">Abilities are made up of “effects”. You can import an effect template from an existing ability below, or click “+ Effect” to manually add a custom effect or the effect of an existing ability. Once an effect is added, you can further adjust its parameters.</p>` : ""}
    <div class="item-rule-preset"><select data-rule-preset aria-label="${options.ability ? "Import ability effects" : "Item effect preset"}"><option value="">${options.ability?"Import effects…":"Load preset…"}</option>${choices}</select><button type="button" class="btn -default" data-rule-action="preset">${options.ability?"Import Effect Template":"Load preset"}</button></div>
    <div class="item-rule-effects-heading"><strong>Effects</strong><button type="button" class="btn -default" data-rule-action="add-effect" ${rule.effects.length >= 16 ? "disabled" : ""}>+ Effect</button></div>
    <div data-rule-effects>${rule.effects.map((effect, index) => `<div class="item-rule-effect" data-rule-effect data-rule-effect-kind="${effect.kind}" data-rule-index="${index}">
      <div class="item-rule-effect-heading"><select data-rule-effect-kind aria-label="Effect ${index + 1}">${[false, true].map(native => `<optgroup label="${native ? options.ability ? "Copied ability handlers" : "Native item behaviors" : "Adjustable primitives"}">${(options.definitions ?? ITEM_RULE_EFFECTS).filter(d => Boolean(d.nativeItem) === native).map(d => option(d.kind, d.label, effect.kind)).join("")}</optgroup>`).join("")}</select>
      <button type="button" class="btn -default" data-rule-action="remove-effect" data-rule-index="${index}" aria-label="Remove effect ${index + 1}" ${rule.effects.length === 1 ? "disabled" : ""}>×</button></div>
      <div class="item-rule-effect-fields">${effectFields(effect, index, typeNamesForProject(project), options, project.texts.banks.abilities??[])}</div></div>`).join("")}</div>
    ${group(root, typeNamesForProject(project))}
    ${options.ability ? "" : `<label class="item-rule-consumable"><input type="checkbox" data-rule-consumable ${rule.consumable ? "checked" : ""}>Consume on first successful effect</label>`}
    <button type="button" class="btn -default" data-rule-action="apply">${options.ability?"Apply ability":"Apply custom effects"}</button>
    <span data-rule-feedback class="item-native-feedback" role="status" aria-live="polite"></span>
  </div>`;
}
export function readItemRuleForm(container: HTMLElement): ItemRuleSet {
  function read(node: HTMLElement): ItemRuleCondition {
    if (node.hasAttribute("data-rule-group")) return { kind: "group", mode: node.querySelector<HTMLSelectElement>(":scope > .item-rule-group-tools [data-rule-mode]")!.value as "all" | "any",
      children: Array.from(node.querySelector<HTMLElement>(":scope > [data-rule-children]")!.children).filter((child): child is HTMLElement => child instanceof HTMLElement && (child.hasAttribute("data-rule-group") || child.hasAttribute("data-rule-condition"))).map(read) };
    const field = node.querySelector<HTMLInputElement>("[data-rule-condition-value]")!;
    const value = field.value.trim() ? Number(field.value) : Number.NaN;
    if (node.dataset.ruleKind === "hp") return { kind: "hp", comparison: node.querySelector<HTMLSelectElement>("[data-rule-comparison]")!.value as "lt", percent: value };
    return { kind: node.dataset.ruleKind as "type" | "weather", value, negate: node.querySelector<HTMLSelectElement>("[data-rule-negate]")!.value === "1" };
  }
  const numeric = (field: HTMLInputElement) => field.value.trim() ? Number(field.value) : Number.NaN;
  return { effects: Array.from(container.querySelectorAll<HTMLElement>("[data-rule-effect]")).map(row => {
      const effect: ItemRuleEffect = { kind: row.dataset.ruleEffectKind as ItemRuleEffect["kind"], value: numeric(row.querySelector<HTMLInputElement>("[data-rule-effect-value]")!) };
      if (row.querySelector("[data-rule-trigger]")) {
        effect.trigger = ITEM_RULE_TRIGGERS[Number(row.querySelector<HTMLSelectElement>("[data-rule-trigger]")!.value)];
        effect.target = ITEM_RULE_TARGETS[Number(row.querySelector<HTMLSelectElement>("[data-rule-target]")!.value)];
        effect.chance = numeric(row.querySelector<HTMLInputElement>("[data-rule-chance]")!);
      }
      if (row.querySelector("[data-rule-stat]")) effect.stat = Number(row.querySelector<HTMLSelectElement>("[data-rule-stat]")!.value);
      if (row.querySelector("[data-rule-move]")) effect.move = numeric(row.querySelector<HTMLInputElement>("[data-rule-move]")!);
      const weather = row.querySelector<HTMLSelectElement>("[data-rule-native-weather]");
      if (weather && weather.value !== "-1") effect.weather = Number(weather.value);
      const chance = row.querySelector<HTMLInputElement>("[data-rule-native-chance]");
      if (chance?.value.trim()) effect.chance = numeric(chance);
      const parameters=Object.fromEntries(Array.from(row.querySelectorAll<HTMLInputElement|HTMLSelectElement>("[data-rule-native-parameter]")).filter(field=>field.value.trim()!=="").map(field=>[field.dataset.ruleNativeParameter!,Number(field.value)]));
      if(Object.keys(parameters).length)effect.parameters=parameters;
      if (row.querySelector("[data-rule-bypass]")) Object.assign(effect, { bypassable: row.querySelector<HTMLInputElement>("[data-rule-bypass]")!.checked });
      return effect;
    }),
    conditions: read(container.querySelector<HTMLElement>("[data-rule-group]")!), consumable: container.querySelector<HTMLInputElement>("[data-rule-consumable]")?.checked ?? false };
}
export function installItemRuleEditor(container: HTMLElement, project: ProjectState, itemId: number, applied: () => void, changed: () => void, options: RuleFormOptions = {}): void {
  const replace = (rule: ItemRuleSet) => { container.innerHTML = renderItemRuleForm(project, rule, options); };
  const feedback = (message: string) => { const node = container.querySelector<HTMLElement>("[data-rule-feedback]")!; node.textContent = message; node.classList.add("-error"); };
  function at(rule: ItemRuleSet, path: string): ItemRuleCondition {
    let node = rule.conditions;
    for (const index of path ? path.split(".").map(Number) : []) {
      if (node.kind !== "group") throw new Error("Invalid condition group.");
      node = node.children[index];
    }
    return node;
  }
  function parent(rule: ItemRuleSet, path: string): { node: Extract<ItemRuleCondition, { kind: "group" }>; index: number } {
    const parts = path.split("."), index = Number(parts.pop()), node = at(rule, parts.join("."));
    if (node.kind !== "group") throw new Error("Invalid condition group.");
    return { node, index };
  }
  container.addEventListener("input", () => changed());
  container.addEventListener("change", event => {
    const target = event.target as HTMLElement;
    changed();
    if(target.matches('[data-rule-native-parameter="moveClass"],[data-rule-native-parameter="activation"],[data-rule-native-parameter="operation"]')&&(libraryAbilityEffect(target.closest<HTMLElement>("[data-rule-effect]")!.dataset.ruleEffectKind!)||recipeAbilityEffect(target.closest<HTMLElement>("[data-rule-effect]")!.dataset.ruleEffectKind!))){replace(readItemRuleForm(container));return;}
    if (!target.matches("[data-rule-effect-kind], [data-rule-condition-kind], [data-rule-native-original]")) return;
    try {
      const rule = readItemRuleForm(container);
      if (target.matches("[data-rule-native-original]")) {
        const index = Number(target.closest<HTMLElement>("[data-rule-effect]")!.dataset.ruleIndex);
        rule.effects[index].value = (target as HTMLSelectElement).value === "1" ? -1 : options.ability ? 2 : 20;
      } else if (target.matches("[data-rule-effect-kind]")) {
        const index = Number(target.closest<HTMLElement>("[data-rule-effect]")!.dataset.ruleIndex), kind = (target as HTMLSelectElement).value;
        const definition = (options.definitions ?? ITEM_RULE_EFFECTS).find(d => d.kind === kind)!;
        rule.effects[index] = { kind: definition.kind, value: definition.value };
      } else {
        const path = target.closest<HTMLElement>("[data-rule-condition]")!.dataset.rulePath!, location = parent(rule, path), kind = (target as HTMLSelectElement).value;
        location.node.children[location.index] = kind === "hp" ? { kind: "hp", comparison: "lt", percent: 50 } : { kind: kind as "type" | "weather", value: kind === "species" ? 1 : kind === "type" ? 5 : kind === "weather" ? 2 : 0 };
      }
      replace(rule);
    } catch (error) { feedback(error instanceof Error ? error.message : String(error)); }
  });
  container.addEventListener("click", async event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-rule-action]");
    if (!button || button.disabled) return;
    try {
      const rule = readItemRuleForm(container), action = button.dataset.ruleAction, path = button.dataset.rulePath ?? "";
      if (action === "preset") {
        const selected = container.querySelector<HTMLSelectElement>("[data-rule-preset]")!.value;
        if (!selected) return;
        replace(options.preset ? options.preset(Number(selected)) : itemRulePreset(Number(selected), Boolean(Number(getItemRecord(project, Number(selected)).raw.consumable_flag)))); options.imported?.(Number(selected)); changed(); return;
      }
      if (action === "apply") {
        button.disabled = true;
        if (options.apply) await options.apply(rule);
        else await configureItemRuleSets(project, [{ itemId, rules: validateItemRule(rule) }]);
        applied(); return;
      }
      if (action === "add-effect") {
        const definitions = options.definitions ?? ITEM_RULE_EFFECTS;
        const next = definitions.find(d => !rule.effects.some(effect => effect.kind === d.kind)) ?? definitions[0];
        if (next) rule.effects.push({ kind: next.kind, value: next.value });
      } else if (action === "remove-effect") rule.effects.splice(Number(button.dataset.ruleIndex), 1);
      else if (action === "remove-condition") { const location = parent(rule, path); location.node.children.splice(location.index, 1); }
      else {
        const node = at(rule, path);
        if (node.kind !== "group") throw new Error("Invalid condition group.");
        node.children.push(action === "add-group" ? { kind: "group", mode: "any", children: [{ kind: "hp", comparison: "lt", percent: 50 }] } : { kind: "hp", comparison: "lt", percent: 50 });
      }
      changed(); replace(rule);
    } catch (error) { button.disabled = false; feedback(error instanceof Error ? error.message : String(error)); }
  });
}
