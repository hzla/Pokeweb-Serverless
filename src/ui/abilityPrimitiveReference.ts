import { abilityPrimitiveReference, filterAbilityPrimitiveReference } from "../pokeweb/abilityPrimitiveReference";
import type { AbilityRuleSet } from "../pokeweb/abilityRules";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

export function installAbilityPrimitiveReference(root: HTMLElement, project: ProjectState): (rules: ReadonlyMap<number, AbilityRuleSet>) => void {
  root.innerHTML = `<h2>Primitive reference</h2>
    <input type="search" data-primitive-search aria-label="Search primitive reference" placeholder="Find primitive or ability template">
    <div class="ability-reference-scroll"><table>
      <thead><tr><th scope="col">Primitive</th><th scope="col">What it does</th><th scope="col">Used by templates</th></tr></thead>
      <tbody data-primitive-rows></tbody>
    </table></div>
    <span class="ability-reference-count" data-primitive-count role="status" aria-live="polite"></span>`;
  const search = root.querySelector<HTMLInputElement>("[data-primitive-search]")!;
  const body = root.querySelector<HTMLElement>("[data-primitive-rows]")!;
  const count = root.querySelector<HTMLElement>("[data-primitive-count]")!;
  let rows = abilityPrimitiveReference();
  function render(): void {
    const matching = filterAbilityPrimitiveReference(rows, search.value);
    body.innerHTML = matching.map(row => `<tr><th scope="row">${escapeHtml(row.label)}</th>
      <td>${escapeHtml(row.description)}</td>
      <td>${row.templates.length ? row.templates.map(escapeHtml).join(", ") : `<span class="ability-reference-unused">Custom recipes</span>`}
        ${row.savedAbilities.length ? `<small>Saved: ${row.savedAbilities.map(ability => escapeHtml(`${ability.name} #${ability.id}`)).join(", ")}</small>` : ""}</td></tr>`).join("")
      || `<tr><td colspan="3">No matching primitives.</td></tr>`;
    count.textContent = `${matching.length} of ${rows.length} primitives`;
  }
  search.addEventListener("input", render);
  return rules => {
    rows = abilityPrimitiveReference(rules, project.texts.banks.abilities);
    render();
  };
}
