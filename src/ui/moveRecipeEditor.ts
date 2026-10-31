import { MOVE_EFFECT_VALUE_LABELS, moveEffectTargets } from "../pokeweb/moveRules";
import "../styles/moveRecipes.css";
import { clearMoveRules, configureMoveRuleSets, inspectMoveEffects, supportsMoveRecipes } from "../pokeweb/moveEffectsModel";
import { MOVE_RECIPE_LIBRARY, moveRecipeTemplate } from "../pokeweb/moveRecipeLibrary";
import { EMPTY_MOVE_RULE, MOVE_ALWAYS, MOVE_NATIVE_BASES, MOVE_PRIMITIVES, movePhaseMatchesCategory, newMoveEffect, validateMoveRule, type MoveCondition, type MoveRuleSet } from "../pokeweb/moveRules";
import { typeNamesForProject } from "../pokeweb/constants";
import { decodeRecord,type ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

const option = (value: string | number, label: string, selected: string | number,disabled=false) => `<option value="${value}" ${String(value) === String(selected) ? "selected" : ""} ${disabled?"disabled":""}>${escapeHtml(label)}</option>`;
const phaseLabels = { power: "Power calculation", damage: "Damage modifier", accuracy: "Accuracy check", check: "Use check", hit: "After each successful hit", afterMove: "After the whole move", status: "Status move effect", knockout: "After a knockout", hitSide: "After each hit (native side effects)", afterRealHits: "After the move (direct hits only)" };
const targets = { user: "User", target: "Move recipients", allies: "User and allies", opponents: "Opponents", all: "All active Pokémon" };
const conditionLabels: Record<string, string> = { hp: "HP", type: "Type", weather: "Weather", status: "Condition", species: "Species", ability: "Ability", field: "Field effect", effectiveness: "Type effectiveness", targetActed: "Has acted", firstTurn: "First turn on field", grounded: "Grounded", ally: "Ally of user", pendingPriority: "Pending attack priority", sameMon: "Same Pokémon as user" };
function conditionForm(node: MoveCondition, path: string, label: string, types: string[], depth = 0): string {
  if (node.kind === "group") return `<fieldset class="item-rule-group" data-move-condition-path="${path}"><legend>${label}</legend><div class="item-rule-group-tools"><select data-move-input="mode" data-path="${path}" aria-label="${label} logic">${option("all", "All (AND)", node.mode)}${option("any", "Any (OR)", node.mode)}</select><button type="button" class="btn -default" data-move-action="condition" data-path="${path}" ${depth >= 3 || node.children.length >= 8 ? "disabled" : ""}>+ Condition</button><button type="button" class="btn -default" data-move-action="group" data-path="${path}" ${depth >= 2 || node.children.length >= 8 ? "disabled" : ""}>+ Group</button></div>${node.children.map((c, i) => conditionForm(c, `${path}.${i}`, "Group", types, depth + 1)).join("") || `<span class="item-native-hint">Always</span>`}${depth ? `<button class="btn -default" type="button" data-move-action="remove-condition" data-path="${path}">Remove group</button>` : ""}</fieldset>`;
  const value = node.kind === "hp" ? node.percent : node.value;
  const labels = node.kind === "type" ? Object.fromEntries(types.map((t, i) => [i, t])) : node.kind === "weather" ? { 0: "Clear", 1: "Sun", 2: "Rain", 3: "Hail", 4: "Sandstorm" } : node.kind === "status" ? { 0: "No major status", 1: "Paralysis", 2: "Sleep", 3: "Freeze", 4: "Burn", 5: "Poison", 6: "Confusion" } : ["targetActed", "firstTurn", "grounded", "ally", "sameMon"].includes(node.kind) ? { 0: "No", 1: "Yes" } : undefined;
  return `<div class="item-rule-condition"><select data-move-input="condition-kind" data-path="${path}" aria-label="Condition type">${Object.entries(conditionLabels).map(([k, text]) => option(k, text, node.kind)).join("")}</select>${!["weather", "field"].includes(node.kind) ? `<select data-move-input="subject" data-path="${path}" aria-label="Condition subject">${option("user", "User", node.subject ?? "target")}${option("target", "Recipient", node.subject ?? "target")}</select>` : ""}${node.kind === "hp" ? `<select data-move-input="comparison" data-path="${path}" aria-label="HP comparison">${[["lt", "Below"], ["lte", "At most"], ["gt", "Above"], ["gte", "At least"]].map(([v, text]) => option(v, text, node.comparison)).join("")}</select>` : `<select data-move-input="negate" data-path="${path}" aria-label="Condition comparison">${option(0, "Is", Number(Boolean(node.negate)))}${option(1, "Is not", Number(Boolean(node.negate)))}</select>`}${labels ? `<select data-move-input="condition-value" data-path="${path}" aria-label="Condition value">${Object.entries(labels).map(([v, text]) => option(v, text, value)).join("")}</select>` : `<input data-move-input="condition-value" data-path="${path}" type="number" value="${value}" aria-label="Condition value">`}<button type="button" class="btn -default" data-move-action="remove-condition" data-path="${path}" aria-label="Remove condition">×</button></div>`;
}
function alwaysGroup(condition: MoveCondition): MoveCondition { return condition.kind === "group" ? condition : { kind: "group", mode: "all", children: [condition] }; }
export function installMoveRecipeButtons(root: HTMLElement, project: ProjectState, onDirty?: () => void): void {
  if (!supportsMoveRecipes(project)) return;
  root.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-open-move-recipe]"); if (!button) return;
    event.stopPropagation();
    const card = button.closest<HTMLElement>("[data-move-index]")!, id = Number(card.dataset.moveIndex);
    let panel = card.querySelector<HTMLElement>("[data-move-recipe-panel]");
    if (panel) { panel.hidden = !panel.hidden; return; }
    panel = document.createElement("section"); panel.dataset.moveRecipePanel = ""; panel.className = "expanded-card-content move-recipe-panel"; card.append(panel);
    installMoveRecipeEditor(project, panel, id, onDirty);
  });
}
export function installMoveRecipeEditor(project: ProjectState, root: HTMLElement, id: number, onDirty?: () => void): void {
  const state = inspectMoveEffects(project);
  if (!state.editable) { root.innerHTML = `<p role="status">${escapeHtml(state.message)}</p>`; return; }
  let applied = state.rules.has(id), draft = structuredClone(state.rules.get(id) ?? EMPTY_MOVE_RULE), feedback = "";
  let draftDirty=!applied;
  const category=decodeRecord(project,"moves",id).raw!.category;
  const makeEffect=(kind=category===0?"statStage":"power")=>{const effect=newMoveEffect(kind);effect.phase=MOVE_PRIMITIVES.find(p=>p.kind===kind)!.phases.find(phase=>movePhaseMatchesCategory(phase,category))??effect.phase;return effect;};
  if(!applied)draft.effects=[makeEffect()];
  const types = typeNamesForProject(project);
  function at(path: string): MoveCondition {
    const parts = path.split(".");
    let node = parts[0] === "effects" ? draft.effects[Number(parts[1])].conditions : parts[0] === "requirements" ? draft.prerequisites : draft.conditions;
    for (const index of parts.slice(parts[0] === "effects" ? 2 : 1)) { if (node.kind !== "group") throw Error("Invalid condition path."); node = node.children[Number(index)]; }
    return node;
  }
  function assign(path: string, node: MoveCondition) {
    const parts = path.split(".");
    if (parts.length === 1) { if (parts[0] === "requirements") draft.prerequisites = node; else draft.conditions = node; }
    else if (parts[0] === "effects" && parts.length === 2) draft.effects[Number(parts[1])].conditions = node;
    else { const parent = at(parts.slice(0, -1).join(".")); if (parent.kind === "group") parent.children[Number(parts.at(-1))] = node; }
  }
  function render() {
    draft.conditions = alwaysGroup(draft.conditions); draft.prerequisites = alwaysGroup(draft.prerequisites);
    draft.effects.forEach(e => e.conditions = alwaysGroup(e.conditions));
    root.innerHTML = `<div class="move-recipe-layout"><main><div class="ability-page-heading"><h3>Battle effects</h3><span class="ability-state">${applied ? draftDirty ? "Unsaved draft" : "Custom effects · Shared DLL" : "Custom draft"}</span></div><div class="item-rule-preset"><select data-move-template aria-label="Import move effect template"><option value="">Import effects…</option>${MOVE_RECIPE_LIBRARY.map(t => option(t.sourceId, t.label, "")).join("")}</select><button class="btn -default" type="button" data-move-action="import">Import Effect Template</button></div><label>Base behavior (always)<select data-move-input="base" aria-label="Native base behavior">${option(0, "Ordinary move", draft.nativeBase ?? 0)}${MOVE_NATIVE_BASES.map(n => option(n, project.texts.banks.moves?.[n] ?? `Native move ${n}`, draft.nativeBase ?? 0)).join("")}</select></label><div class="item-rule-effects-heading"><strong>Effects</strong><button type="button" class="btn -default" data-move-action="add" ${draft.effects.length >= 16 ? "disabled" : ""}>+ Effect</button></div>${draft.effects.map((e, i) => {
      const p = MOVE_PRIMITIVES.find(p => p.kind === e.kind)!;
      return `<div class="item-rule-effect" data-move-effect="${i}"><div class="item-rule-effect-heading"><select data-move-input="kind" aria-label="Effect ${i + 1}">${MOVE_PRIMITIVES.map(d => option(d.kind, d.label, e.kind)).join("")}</select><button type="button" class="btn -default" data-move-action="up" data-index="${i}" aria-label="Move effect ${i + 1} up" ${i===0?"disabled":""}>↑</button><button type="button" class="btn -default" data-move-action="down" data-index="${i}" aria-label="Move effect ${i + 1} down" ${i===draft.effects.length-1?"disabled":""}>↓</button><button type="button" class="btn -default" data-move-action="remove" data-index="${i}" aria-label="Remove effect ${i + 1}">×</button></div><div class="item-rule-effect-fields">${p.min === p.max || e.kind === "stages" ? "" : MOVE_EFFECT_VALUE_LABELS[e.kind] ? `<label>Condition / operation<select data-move-input="value" aria-label="Effect ${i + 1} value">${Object.entries(MOVE_EFFECT_VALUE_LABELS[e.kind]).map(([v,label])=>option(v,label,e.value)).join("")}</select></label>` : `<label>${escapeHtml(p.unit || "Value")}<input type="number" min="${p.min}" max="${p.max}" step="${p.step}" data-move-input="value" value="${e.value}" aria-label="Effect ${i + 1} value"></label>`}<label>Timing<select data-move-input="phase" aria-label="Effect ${i + 1} timing">${p.phases.map(v => option(v, phaseLabels[v], e.phase,!movePhaseMatchesCategory(v,category))).join("")}</select></label><label>Recipients<select data-move-input="target" aria-label="Effect ${i + 1} recipients">${moveEffectTargets(e.kind).map(v => option(v, targets[v], e.target)).join("")}</select></label>${p.parameters.map(param => `<label>${escapeHtml(param.label)}${param.labels ? `<select data-move-input="parameter" data-parameter="${param.key}" aria-label="Effect ${i + 1} ${param.label}">${Object.entries(param.labels).map(([v, label]) => option(v, label, e.parameters?.[param.key] ?? param.original)).join("")}</select>` : `<input type="number" data-move-input="parameter" data-parameter="${param.key}" min="${param.min}" max="${param.max}" value="${e.parameters?.[param.key] ?? param.original}" aria-label="Effect ${i + 1} ${param.label}">`}</label>`).join("")}${["statStage","heal","cure","stages","native","status"].includes(e.kind) ? `<label>Chance (%)<input type="number" min="1" max="100" data-move-input="chance" value="${e.chance}" aria-label="Effect ${i + 1} chance"></label>` : ""}${e.phase === "hit" && e.kind !== "flinch" ? `<label><input type="checkbox" data-move-input="secondary" ${e.secondary ? "checked" : ""}>Secondary effect</label>` : ""}</div><details><summary>Effect conditions</summary>${conditionForm(e.conditions, `effects.${i}`, "Conditions", types)}</details></div>`;
    }).join("")}${conditionForm(draft.conditions, "conditions", "Activation conditions", types)}${conditionForm(draft.prerequisites, "requirements", "Use prerequisites", types)}<div class="move-recipe-actions"><button class="btn -default" type="button" data-move-action="apply">Apply move effects</button>${applied ? `<button class="btn -default" type="button" data-move-action="restore">Restore native behavior</button>` : ""}</div><span role="status" data-move-feedback>${escapeHtml(feedback)}</span></main><aside class="ability-reference" aria-label="Move primitive reference"><h3>Primitive reference</h3><table><thead><tr><th>Primitive</th><th>What it does</th><th>Used by templates</th></tr></thead><tbody>${MOVE_PRIMITIVES.map(p => `<tr><td>${escapeHtml(p.label)}</td><td>${escapeHtml(p.description)}</td><td>${escapeHtml(MOVE_RECIPE_LIBRARY.filter(t => t.rule.effects.some(e => e.kind === p.kind)).map(t => t.label).join(", ") || "Custom recipes")}</td></tr>`).join("")}</tbody></table></aside></div>`;
  }
  const updateInput = (event: Event) => {
    const input = event.target as HTMLInputElement, field = input.dataset.moveInput; if (!field) return;
    draftDirty=true;feedback="";
    const badge=root.querySelector<HTMLElement>(".ability-state");if(badge)badge.textContent=applied?"Unsaved draft":"Custom draft";
    const message=root.querySelector<HTMLElement>("[data-move-feedback]");if(message)message.textContent="";
    const index = Number(input.closest<HTMLElement>("[data-move-effect]")?.dataset.moveEffect), e = draft.effects[index], path = input.dataset.path;
    if (path) {
      const c = at(path);
      if (field === "condition-kind") {
        const kind = input.value as Exclude<MoveCondition["kind"], "group">;
        assign(path, kind === "hp" ? { kind, subject: "user", comparison: "lte", percent: 50 } : { kind, subject: "target", value: ["species", "ability", "field", "type"].includes(kind) ? 1 : 0 } as MoveCondition); render();
      } else if (field === "mode" && c.kind === "group") c.mode = input.value as "all" | "any";
      else if (c.kind !== "group") {
        if (field === "subject") c.subject = input.value as "user" | "target";
        else if (field === "comparison" && c.kind === "hp") c.comparison = input.value as "lte";
        else if (field === "condition-value") { if (c.kind === "hp") c.percent = input.value.trim()?Number(input.value):Number.NaN; else c.value = input.value.trim()?Number(input.value):Number.NaN; }
        else if (field === "negate" && c.kind !== "hp") c.negate = input.value === "1";
      }
    } else if (field === "base") { draft.nativeBase = Number(input.value) || undefined; }
    else if (e) {
      if (field === "kind") { draft.effects[index] = makeEffect(input.value); render(); }
      else if (field === "value" || field === "chance") e[field] = input.value.trim() ? Number(input.value) : Number.NaN;
      else if (field === "phase") { e.phase = input.value as typeof e.phase; if (e.phase !== "hit") { e.secondary = false; e.chance = 100; } render(); }
      else if (field === "target") e.target = input.value as typeof e.target;
      else if (field === "secondary") e.secondary = input.checked;
      else if (field === "parameter") (e.parameters ??= {})[input.dataset.parameter!] = input.value.trim()?Number(input.value):Number.NaN;
    }
  };
  root.addEventListener("change", updateInput);
  root.addEventListener("input", event => { if(event.target instanceof HTMLInputElement && event.target.type === "number") updateInput(event); });
  root.addEventListener("click", async event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-move-action]"); if (!button) return;
    event.stopPropagation(); const action = button.dataset.moveAction, path = button.dataset.path;
    try {
      if(action!=="apply"&&action!=="restore")draftDirty=true;
      if (action === "import") { const source = Number(root.querySelector<HTMLSelectElement>("[data-move-template]")!.value), imported = moveRecipeTemplate(source); if (!imported) return; draft = structuredClone(imported.rule); feedback = `${imported.label} draft`; }
      else if (action === "add") draft.effects.push(makeEffect());
      else if (action === "remove") draft.effects.splice(Number(button.dataset.index), 1);
      else if (action === "up" || action === "down") { const from=Number(button.dataset.index),to=from+(action==="up"?-1:1); if(to>=0&&to<draft.effects.length)[draft.effects[from],draft.effects[to]]=[draft.effects[to],draft.effects[from]]; }
      else if ((action === "condition" || action === "group") && path) { const c = at(path); if (c.kind === "group") c.children.push(action === "group" ? { kind: "group", mode: "all", children: [] } : { kind: "hp", subject: "user", comparison: "lte", percent: 50 }); }
      else if (action === "remove-condition" && path) { const parts = path.split("."), parent = at(parts.slice(0, -1).join(".")); if (parent.kind === "group") parent.children.splice(Number(parts.at(-1)), 1); }
      else if (action === "apply") { button.disabled = true; await configureMoveRuleSets(project, [{ moveId: id, rules: validateMoveRule(draft) }]); applied = true;draftDirty=false; root.closest("[data-move-index]")?.querySelector(".expanded-move")?.remove(); feedback = "Applied"; onDirty?.(); }
      else if (action === "restore") { button.disabled = true; await clearMoveRules(project, id); applied = false;draftDirty=false;root.closest("[data-move-index]")?.querySelector(".expanded-move")?.remove(); draft = {...structuredClone(EMPTY_MOVE_RULE),effects:[makeEffect()]}; feedback = "Native behavior restored"; onDirty?.(); }
      render();
    } catch (error) { button.disabled = false; root.querySelector<HTMLElement>("[data-move-feedback]")!.textContent = error instanceof Error ? error.message : String(error); }
  });
  render();
}
