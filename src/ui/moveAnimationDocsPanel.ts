import {
  FUTURE_MOVE_ANIMATION_TOOLING,
  MOVE_ANIMATION_WORKFLOW_GUIDES,
  SCRIPT_SPA_BOUNDARY_REFERENCES,
  SPA_FIELD_REFERENCE_DOCS,
  getMoveAnimationCommandDocsByCategory,
} from "../pokeweb/moveAnimationDocumentation";
import type { MoveAnimationCommandDoc, MoveAnimationWorkflowGuide, SpaFieldReference } from "../pokeweb/moveAnimationDocumentation";
import {
  getMoveAnimationCommandAliases,
  getMoveAnimationCommandNameSearchTerms,
  getMoveAnimationDisplayCommandName,
  getMoveAnimationGenericCommandAliases,
} from "../pokeweb/moveAnimationCommandNames";
import { getMoveAnimationParamSemanticHelp } from "../pokeweb/moveAnimationParamSemantics";
import { escapeHtml } from "./dom";

type DocsTab = "commands" | "spa" | "workflows" | "boundary" | "future";

type State = {
  host: HTMLElement;
  tab: DocsTab;
  search: string;
};

export type MoveAnimationDocsPanelController = {
  refresh: () => void;
};

export function installMoveAnimationDocsPanel(host: HTMLElement): MoveAnimationDocsPanelController {
  const state: State = { host, tab: "commands", search: "" };
  host.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-move-doc-tab]");
    if (!button) return;
    const tab = button.dataset.moveDocTab;
    if (!isDocsTab(tab)) return;
    state.tab = tab;
    render(state);
  });
  host.addEventListener("input", (event) => {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-move-doc-search]");
    if (!input) return;
    state.search = input.value;
    render(state);
    const nextInput = state.host.querySelector<HTMLInputElement>("[data-move-doc-search]");
    nextInput?.focus();
    nextInput?.setSelectionRange(nextInput.value.length, nextInput.value.length);
  });
  render(state);
  return { refresh: () => render(state) };
}

function render(state: State): void {
  state.host.innerHTML = `
    <div class="move-animation-docs-panel">
      <div class="move-animation-docs-header">
        <div>
          <h4>Animation Docs</h4>
          <span>Search commands, SPA fields, workflows, and script-vs-SPA boundaries.</span>
        </div>
        <label>
          <span>Search</span>
          <input data-move-doc-search type="search" value="${escapeHtml(state.search)}" placeholder="particle, color, projectile...">
        </label>
      </div>
      <div class="move-animation-doc-tabs" role="tablist" aria-label="Move animation documentation">
        ${docTabButton("commands", "Commands", state.tab)}
        ${docTabButton("spa", "SPA Fields", state.tab)}
        ${docTabButton("workflows", "Workflows", state.tab)}
        ${docTabButton("boundary", "Script vs SPA", state.tab)}
        ${docTabButton("future", "Future Tools", state.tab)}
      </div>
      <div class="move-animation-docs-body">${renderTab(state)}</div>
    </div>
  `;
}

function renderTab(state: State): string {
  if (state.tab === "commands") return renderCommandDocs(state.search);
  if (state.tab === "spa") return renderSpaFieldDocs(state.search);
  if (state.tab === "workflows") return renderWorkflowDocs(state.search);
  if (state.tab === "boundary") return renderBoundaryDocs(state.search);
  return renderFutureToolingDocs(state.search);
}

function renderCommandDocs(search: string): string {
  const groups = getMoveAnimationCommandDocsByCategory()
    .map((group) => ({ ...group, commands: group.commands.filter((doc) => matchesCommand(doc, search)) }))
    .filter((group) => group.commands.length);
  if (!groups.length) return emptyDocs();
  return groups
    .map(
      (group) => `
        <section class="move-animation-doc-section">
          <h5>${escapeHtml(group.category)}</h5>
          <div class="move-animation-doc-list">
            ${group.commands.map(renderCommandDoc).join("")}
          </div>
        </section>
      `,
    )
    .join("");
}

function renderCommandDoc(doc: MoveAnimationCommandDoc): string {
  const displayName = doc.currentPokewebName || getMoveAnimationDisplayCommandName(doc.name);
  const legacyLabel = displayName === doc.name ? "" : ` · legacy ${doc.name}`;
  return `
    <article class="move-animation-doc-card">
      <div class="move-animation-doc-card-title">
        <strong>${escapeHtml(displayName)}</strong>
        <span>${escapeHtml(doc.hex)} · ${escapeHtml(commandBoundaryLabel(doc.category, doc.name))}${escapeHtml(legacyLabel)}</span>
      </div>
      <p>${escapeHtml(doc.description)}</p>
      ${doc.params.length ? `<div class="move-animation-doc-param-list">${doc.params.map((param) => `<div><code>${escapeHtml(param.name)}</code><span>${escapeHtml(param.description)}${renderParamSemanticText(displayName, param.index)}</span></div>`).join("")}</div>` : ""}
      ${doc.notes.length ? `<ul>${doc.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>` : ""}
    </article>
  `;
}

function renderParamSemanticText(commandName: string, paramIndex: number): string {
  const help = getMoveAnimationParamSemanticHelp(commandName, paramIndex);
  if (!help) return "";
  if (help.kind === "fx32") {
    return help.unit === "world"
      ? ` Accepts FX32 world units like 1px, 0.5px, and 2px; raw 4096 remains valid.`
      : ` Accepts FX32 multipliers like 1x, 0.5x, and 2x.`;
  }
  const values = help.values?.map((value) => `${value.name} (${value.value})`).join(", ");
  if (!values) return "";
  return ` Values: ${values}.`;
}

function renderSpaFieldDocs(search: string): string {
  const fields = SPA_FIELD_REFERENCE_DOCS.filter((field) => matchesSpaField(field, search));
  if (!fields.length) return emptyDocs();
  const groups = new Map<string, SpaFieldReference[]>();
  for (const field of fields) groups.set(field.group, [...(groups.get(field.group) ?? []), field]);
  return [...groups.entries()]
    .map(
      ([group, docs]) => `
        <section class="move-animation-doc-section">
          <h5>${escapeHtml(group)}</h5>
          <div class="move-animation-doc-list">${docs.map(renderSpaFieldDoc).join("")}</div>
        </section>
      `,
    )
    .join("");
}

function renderSpaFieldDoc(doc: SpaFieldReference): string {
  return `
    <article class="move-animation-doc-card">
      <div class="move-animation-doc-card-title">
        <strong>${escapeHtml(doc.title)}</strong>
        <span><code>${escapeHtml(doc.key)}</code></span>
      </div>
      <p>${escapeHtml(doc.description)}</p>
      <div class="move-animation-doc-note">${escapeHtml(doc.scriptBoundary)}</div>
      <div class="move-animation-doc-columns">
        <div><strong>Donor notes</strong><ul>${doc.donorNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul></div>
        <div><strong>Examples</strong><ul>${doc.vanillaExamples.map((example) => `<li>${escapeHtml(example)}</li>`).join("")}</ul></div>
      </div>
    </article>
  `;
}

function renderWorkflowDocs(search: string): string {
  const guides = MOVE_ANIMATION_WORKFLOW_GUIDES.filter((guide) => matchesWorkflow(guide, search));
  if (!guides.length) return emptyDocs();
  return `<div class="move-animation-doc-list">${guides.map(renderWorkflowGuide).join("")}</div>`;
}

function renderWorkflowGuide(guide: MoveAnimationWorkflowGuide): string {
  return `
    <article class="move-animation-doc-card">
      <div class="move-animation-doc-card-title">
        <strong>${escapeHtml(guide.title)}</strong>
        <span>${escapeHtml(guide.level)}</span>
      </div>
      <p>${escapeHtml(guide.summary)}</p>
      <div class="move-animation-doc-columns">
        <div><strong>Pure script</strong><ul>${guide.pureScript.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
        <div><strong>Requires SPA</strong><ul>${guide.requiresSpa.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
      </div>
      <div><strong>Checklist</strong><ul>${guide.checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
    </article>
  `;
}

function renderBoundaryDocs(search: string): string {
  const refs = SCRIPT_SPA_BOUNDARY_REFERENCES.filter((reference) => matchesText([reference.topic, reference.pureScript, reference.requiresSpa, ...reference.examples], search));
  if (!refs.length) return emptyDocs();
  return `
    <div class="move-animation-doc-list">
      ${refs
        .map(
          (reference) => `
            <article class="move-animation-doc-card">
              <div class="move-animation-doc-card-title"><strong>${escapeHtml(reference.topic)}</strong><span>Boundary</span></div>
              <div class="move-animation-doc-columns">
                <div><strong>Pure script</strong><p>${escapeHtml(reference.pureScript)}</p></div>
                <div><strong>Requires SPA</strong><p>${escapeHtml(reference.requiresSpa)}</p></div>
              </div>
              <ul>${reference.examples.map((example) => `<li>${escapeHtml(example)}</li>`).join("")}</ul>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderFutureToolingDocs(search: string): string {
  const notes = FUTURE_MOVE_ANIMATION_TOOLING.filter((note) => matchesText([note.title, note.description], search));
  if (!notes.length) return emptyDocs();
  return `<div class="move-animation-doc-list">${notes.map((note) => `<article class="move-animation-doc-card"><div class="move-animation-doc-card-title"><strong>${escapeHtml(note.title)}</strong><span>Planned</span></div><p>${escapeHtml(note.description)}</p></article>`).join("")}</div>`;
}

function docTabButton(tab: DocsTab, label: string, activeTab: DocsTab): string {
  return `<button class="move-animation-doc-tab ${tab === activeTab ? "-active" : ""}" type="button" role="tab" aria-selected="${tab === activeTab}" data-move-doc-tab="${tab}">${escapeHtml(label)}</button>`;
}

function isDocsTab(value: string | undefined): value is DocsTab {
  return value === "commands" || value === "spa" || value === "workflows" || value === "boundary" || value === "future";
}

function matchesCommand(doc: MoveAnimationCommandDoc, search: string): boolean {
  return matchesText(
    [
      doc.name,
      doc.currentPokewebName,
      getMoveAnimationDisplayCommandName(doc.name),
      ...getMoveAnimationCommandAliases(doc.name),
      ...getMoveAnimationCommandNameSearchTerms(doc.name),
      ...getMoveAnimationGenericCommandAliases(doc.opcode),
      doc.category,
      doc.description,
      doc.handlerMacro,
      ...doc.notes,
      ...doc.params.flatMap((param) => [param.name, param.description]),
    ],
    search,
  );
}

function matchesSpaField(field: SpaFieldReference, search: string): boolean {
  return matchesText([field.key, field.title, field.group, field.description, field.scriptBoundary, ...field.donorNotes, ...field.vanillaExamples], search);
}

function matchesWorkflow(guide: MoveAnimationWorkflowGuide, search: string): boolean {
  return matchesText([guide.title, guide.level, guide.summary, ...guide.pureScript, ...guide.requiresSpa, ...guide.checklist], search);
}

function matchesText(values: string[], search: string): boolean {
  const normalized = search.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => value.toLowerCase().includes(normalized));
}

function commandBoundaryLabel(category: string, name: string): string {
  if (name.startsWith("DoSPA")) return "Script + SPA";
  if (name === "LoadSPA" || name === "DeleteSPA") return "SPA dependency";
  if (category === "Particles") return "Script + SPA";
  return "Pure script";
}

function emptyDocs(): string {
  return `<div class="move-animation-doc-empty">No documentation matched the current search.</div>`;
}
