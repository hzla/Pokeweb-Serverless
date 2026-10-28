import { typeNamesForProject } from "../pokeweb/constants";
import { assignItemEffect, clearItemRules, configureItemTypeHealing, formatAddress, inspectItemEffect, updateItemEffectControl } from "../pokeweb/itemEffectsModel";
import { EMPTY_ITEM_RULE } from "../pokeweb/itemRules";
import { installItemRuleEditor, renderItemRuleForm } from "./itemRuleEditor";
import { getItemRecord } from "../pokeweb/moveItemModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

export function renderItemEffects(project: ProjectState, itemId: number): string {
  if (project.session.baseRom !== "BW2") return "";
  const state = inspectItemEffect(project, itemId);
  const name = (id: number) => String(project.texts.banks.items?.[id] ?? `Item ${id}`);
  const selected = state.rules ? -2 : state.typeHealing !== undefined ? -1 : state.nativeSlot ? state.profileId : -3;
  const controls = selected !== -2 && selected !== -1 ? state.controls.map(control => `
    <label class="item-native-control item-native-value"><span>${escapeHtml(control.label)}</span>
      <input type="number" data-item-effect-control="${control.key}" value="${control.value}" min="${control.min}" max="${control.max}" step="${control.step}" aria-label="${escapeHtml(control.label)}">
      ${control.shared.length > 1 ? `<small>Shared: ${escapeHtml(control.shared.map(name).join(", "))}</small>` : ""}
    </label>`).join("") : "";
  return `<section class="item-native-effects" data-item-effect-id="${itemId}">
    <div class="item-native-heading"><strong>Held battle effect</strong><span class="item-native-status ${state.editable ? "-verified" : ""}">${state.editable ? "Verified in ROM" : "Unavailable"}</span></div>
    ${state.editable ? `<label class="item-native-control"><span>Handler assignment</span><select data-item-effect-assignment aria-label="Handler assignment">
      ${state.choices.map(choice => `<option value="${choice.id}" ${selected === choice.id ? "selected" : ""}>${escapeHtml(choice.label)}</option>`).join("")}
      ${state.nativeSlot ? "" : `<option value="-3" ${selected === -3 ? "selected" : ""}>No battle effect</option>`}
      <option value="-1" ${selected === -1 ? "selected" : ""}>Type-restricted healing</option>
      <option value="-2" ${selected === -2 ? "selected" : ""}>Custom effects</option>
    </select></label>${controls}
    <div data-item-rule-editor ${selected === -2 ? "" : "hidden"}>${renderItemRuleForm(project, state.rules ?? structuredClone(EMPTY_ITEM_RULE))}</div>
    <div class="item-type-healing" ${selected === -1 ? "" : "hidden"}>
      <label class="item-native-control"><span>Holder type</span><select data-item-heal-type aria-label="Healing holder type">${typeNamesForProject(project).map((type, id) => `<option value="${id}" ${id === (state.typeHealing ?? 5) ? "selected" : ""}>${escapeHtml(type)}</option>`).join("")}</select></label>
      <label class="item-native-control"><span>Max HP healing divisor</span><input data-item-heal-divisor aria-label="Type healing divisor" type="number" min="1" max="255" value="${state.typeHealing === undefined ? 16 : Number(getItemRecord(project, itemId).raw.gain_values)}"></label>
      <span class="item-native-hint">Other types: no effect</span><button type="button" class="btn -default" data-item-heal-apply>Apply healing</button>
    </div>
    <details class="item-native-details"><summary>Native verification</summary><span>${state.rules ? "Shared ItemEffects.dll · custom rules verified" : state.typeHealing !== undefined ? "Shared ItemEffects.dll · 1 event · native call targets verified" : state.nativeSlot ? `Overlay 167 · ${formatAddress(state.address!)} · ${state.events.length} event callbacks` : "Custom item registration available"}</span><button type="button" class="btn -default" data-item-effect-verify>Recheck ROM</button></details>`
      : `<span class="item-native-hint">${escapeHtml(state.message)}</span>`}
    <span class="item-native-feedback" role="status" aria-live="polite"></span>
  </section>`;
}

export function installItemEffects(root: HTMLElement, project: ProjectState, onDirty?: () => void): void {
  root.querySelectorAll<HTMLElement>(".item-native-effects").forEach(panel => {
    if (panel.dataset.installed) return;
    panel.dataset.installed = "true";
    const itemId = Number(panel.dataset.itemEffectId);
    const feedback = (text: string, error = false) => {
      const status = panel.querySelector<HTMLElement>(".item-native-feedback")!;
      status.textContent = text; status.classList.toggle("-error", error);
    };
    const refresh = (text: string) => {
      const scope = panel.closest<HTMLElement>("#items") ?? root;
      scope.querySelectorAll<HTMLElement>(".item-native-effects").forEach(other => {
        const id = Number(other.dataset.itemEffectId);
        other.outerHTML = renderItemEffects(project, id);
        scope.querySelectorAll<HTMLElement>(`.item-card[data-index="${id}"] [data-narc="item"][data-field-name="gain_values"]`).forEach(field => {
          field.textContent = String(getItemRecord(project, id).readable.gain_values);
        });
      });
      installItemEffects(scope, project, onDirty);
      const status = scope.querySelector<HTMLElement>(`.item-native-effects[data-item-effect-id="${itemId}"] .item-native-feedback`);
      if (status) status.textContent = text;
    };
    panel.querySelector<HTMLSelectElement>("[data-item-effect-assignment]")?.addEventListener("change", event => {
      const select = event.target as HTMLSelectElement;
      panel.querySelector<HTMLElement>(".item-type-healing")!.hidden = select.value !== "-1";
      panel.querySelector<HTMLElement>("[data-item-rule-editor]")!.hidden = select.value !== "-2";
      if (select.value === "-1" || select.value === "-2") {
        panel.querySelectorAll<HTMLElement>(".item-native-value").forEach(control => { control.hidden = true; });
        const status = panel.querySelector<HTMLElement>(".item-native-status")!;
        status.textContent = "Not applied"; status.classList.remove("-verified");
        return;
      }
      try { if (select.value === "-3") clearItemRules(project, itemId); else assignItemEffect(project, itemId, Number(select.value)); onDirty?.(); refresh("Assignment verified in ROM bytes."); }
      catch (error) { const state = inspectItemEffect(project, itemId); select.value = String(state.rules ? -2 : state.typeHealing !== undefined ? -1 : state.nativeSlot ? state.profileId : -3); feedback(message(error), true); }
    });
    const ruleEditor = panel.querySelector<HTMLElement>("[data-item-rule-editor]");
    if (ruleEditor) installItemRuleEditor(ruleEditor, project, itemId, () => { onDirty?.(); refresh("Custom effects installed and verified."); }, () => {
      const status = panel.querySelector<HTMLElement>(".item-native-status")!;
      status.textContent = "Not applied"; status.classList.remove("-verified");
    });
    panel.querySelectorAll<HTMLInputElement>("[data-item-effect-control]").forEach(input => {
      const commit = () => {
        if (!input.isConnected) return;
        try {
          if (input.value.trim() === "") throw new Error("Enter a value.");
          const current = inspectItemEffect(project, itemId).controls.find(control => control.key === input.dataset.itemEffectControl);
          if (current?.value === Number(input.value)) return;
          updateItemEffectControl(project, itemId, input.dataset.itemEffectControl!, Number(input.value));
          onDirty?.(); refresh("Value verified in ROM bytes.");
        } catch (error) { input.classList.add("invalid"); feedback(message(error), true); }
      };
      input.addEventListener("change", commit);
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); commit(); }
      });
    });
    panel.querySelector("[data-item-effect-verify]")?.addEventListener("click", () => {
      const state = inspectItemEffect(project, itemId);
      feedback(state.editable ? "Assignment and native callback signatures match the loaded ROM." : state.message, !state.editable);
    });
    panel.querySelector<HTMLButtonElement>("[data-item-heal-apply]")?.addEventListener("click", async event => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      try {
        await configureItemTypeHealing(project, itemId, Number(panel.querySelector<HTMLSelectElement>("[data-item-heal-type]")!.value), Number(panel.querySelector<HTMLInputElement>("[data-item-heal-divisor]")!.value));
        onDirty?.(); refresh("Type-healing callback installed and verified.");
      } catch (error) { feedback(message(error), true); button.disabled = false; }
    });
  });
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
