import { applyStarters, getStarterEditorState } from "../pokeweb/starterModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { NATURES } from "../pokeweb/constants";
import { getPokemonPersonalIds } from "../pokeweb/pokemonModel";
import { findPokemonBaseSpeciesId, findPokemonPersonalFormOwner, pokemonSpeciesLabel } from "../pokeweb/pokemonLabels";
import { getPokemonIconImage, getPokemonSpriteImage, resolvePokemonSpriteId, type RgbaImageData } from "../pokeweb/pokemonSpriteModel";
import { gen5InGameTradeTextBankId } from "../pokeweb/ingameTradeModel";
import { getTextBank, parseTextEntryId, updateTextEntry } from "../pokeweb/textModel";
import {
  applyGen5ScriptPokemonGroup,
  scanGen5ScriptPokemon,
  type ScriptPokemonAcquisition,
  type ScriptPokemonEditableField,
  type ScriptPokemonGroup,
} from "../pokeweb/scriptPokemonModel";
import { escapeHtml } from "./dom";
import { publicAsset } from "../assetUrl";
import { pokemonSpriteSlug } from "../pokeweb/spriteSlug";

type StarterEditorOptions = {
  onDirty?: () => void;
};

type ScriptPokemonTab = "starters" | "party_gifts" | "box_gifts" | "eggs" | "wild_battles" | "trades";
type ScriptPokemonAcquisitionTab = Exclude<ScriptPokemonTab, "starters">;

const SCRIPT_POKEMON_TABS: Array<{ id: ScriptPokemonTab; label: string }> = [
  { id: "starters", label: "Starters" },
  { id: "party_gifts", label: "Party Gifts" },
  { id: "box_gifts", label: "Box Gifts" },
  { id: "eggs", label: "Eggs" },
  { id: "wild_battles", label: "Wild Battles" },
  { id: "trades", label: "Trades" },
];

let activeScriptPokemonTab: ScriptPokemonTab = "starters";
const scriptPokemonIconInstallations = new WeakMap<HTMLElement, { disconnect: () => void }>();

export function renderStarterEditor(project: ProjectState, root: HTMLElement, options: StarterEditorOptions = {}): void {
  const state = getStarterEditorState(project);
  const scripted = scanGen5ScriptPokemon(project);
  root.innerHTML = `
    <div class="starter-page">
      <div class="starter-toolbar">
        <div>
          <h2>Script PKMN</h2>
          <span>${escapeHtml(project.session.baseRom)}</span>
        </div>
      </div>
      ${renderTabBar(scripted.groups)}
      <section class="script-pokemon-tab-panel" data-script-pokemon-panel="starters" ${activeScriptPokemonTab === "starters" ? "" : "hidden"}>
        <div class="script-pokemon-heading">
          <div><h2>Starters</h2><p>The dedicated starter selector keeps the selection script, sprites, overlay, and story text synchronized.</p></div>
          <button class="primary-button" type="button" id="starter-apply-btn">Apply Starters</button>
        </div>
        ${state.warnings.map((warning) => `<div class="starter-warning">${escapeHtml(warning)}</div>`).join("")}
        <div class="starter-grid">
          ${state.slots.map((slot) => renderStarterSlot(project, slot.slot, slot.speciesId)).join("")}
        </div>
        <div class="starter-status" id="starter-status"></div>
      </section>
      ${renderScriptedPokemonTabs(project, scripted.groups, scripted.diagnostics.map((diagnostic) => (
        diagnostic.scriptFileId === undefined ? diagnostic.message : `Script ${diagnostic.scriptFileId}: ${diagnostic.message}`
      )))}
      <datalist id="script-pokemon-species-list">${speciesListOptions(project)}</datalist>
      <datalist id="script-pokemon-item-list">${itemListOptions(project)}</datalist>
    </div>
  `;

  root.querySelectorAll<HTMLButtonElement>("[data-script-pokemon-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.scriptPokemonTab as ScriptPokemonTab | undefined;
      if (!tab) return;
      activeScriptPokemonTab = tab;
      root.querySelectorAll<HTMLButtonElement>("[data-script-pokemon-tab]").forEach((candidate) => {
        const selected = candidate.dataset.scriptPokemonTab === tab;
        candidate.classList.toggle("-active", selected);
        candidate.setAttribute("aria-selected", String(selected));
      });
      root.querySelectorAll<HTMLElement>("[data-script-pokemon-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.scriptPokemonPanel !== tab;
      });
    });
  });

  root.querySelector<HTMLButtonElement>("#starter-apply-btn")?.addEventListener("click", () => {
    const speciesIds = [...root.querySelectorAll<HTMLSelectElement>("[data-starter-slot]")].map((select) => Number(select.value));
    const status = root.querySelector<HTMLDivElement>("#starter-status");
    try {
      const nextState = applyStarters(project, speciesIds);
      options.onDirty?.();
      if (status) {
        const saved = `Saved: ${nextState.slots.map((slot) => slot.name).join(", ")}.`;
        status.textContent = nextState.warnings.length > 0 ? `${saved} ${nextState.warnings.join(" ")}` : saved;
      }
      refreshSlotTypes(project, root);
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  root.querySelectorAll<HTMLSelectElement>("[data-starter-slot]").forEach((select) => {
    select.addEventListener("change", () => refreshSlotTypes(project, root));
  });
  refreshSlotTypes(project, root);
  installScriptPokemonGroupIconRendering(project, root);

  installScriptPokemonFieldSynchronization(root);

  root.querySelectorAll<HTMLButtonElement>("[data-script-pokemon-apply]").forEach((button) => {
    button.addEventListener("click", () => {
      const groupKey = button.dataset.scriptPokemonApply;
      const group = button.closest<HTMLElement>("[data-script-pokemon-group]");
      const status = group?.querySelector<HTMLElement>("[data-script-pokemon-status]");
      if (!groupKey || !group) return;
      try {
        const edits = [...group.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-script-pokemon-key]:not(:disabled)")]
          .map((input) => ({ key: input.dataset.scriptPokemonKey!, value: parseScriptPokemonFieldValue(project, input) }));
        const result = applyGen5ScriptPokemonGroup(project, groupKey, edits);
        if (result.fieldsChanged > 0) options.onDirty?.();
        renderStarterEditor(project, root, options);
        const panel = root.querySelector<HTMLElement>(`[data-script-pokemon-panel="${activeScriptPokemonTab}"]`);
        const refreshed = panel?.querySelector<HTMLDetailsElement>(`[data-script-pokemon-group="${cssEscape(groupKey)}"]`);
        if (refreshed) refreshed.open = true;
        const refreshedStatus = refreshed?.querySelector<HTMLElement>("[data-script-pokemon-status]");
        if (refreshedStatus) {
          const summary = `Saved ${result.fieldsChanged} field${result.fieldsChanged === 1 ? "" : "s"}.`;
          refreshedStatus.textContent = result.warnings.length > 0 ? `${summary} ${result.warnings.join(" ")}` : summary;
        }
      } catch (error) {
        if (status) status.textContent = error instanceof Error ? error.message : String(error);
      }
    });
  });

  root.querySelectorAll<HTMLTextAreaElement>("[data-trade-text-entry]").forEach((input) => {
    input.addEventListener("change", () => {
      const bankId = Number(input.dataset.tradeTextBank);
      const flatIndex = Number(input.dataset.tradeTextFlatIndex);
      const status = input.closest<HTMLElement>(".trade-text-shortcut")?.querySelector<HTMLElement>("[data-trade-text-status]");
      try {
        updateTextEntry(project, "message_texts", bankId, flatIndex, input.value);
        root.querySelectorAll<HTMLTextAreaElement>("[data-trade-text-entry]").forEach((linked) => {
          if (linked !== input
            && Number(linked.dataset.tradeTextBank) === bankId
            && Number(linked.dataset.tradeTextFlatIndex) === flatIndex) {
            linked.value = input.value;
          }
        });
        if (status) status.textContent = "Saved";
        options.onDirty?.();
      } catch (error) {
        if (status) status.textContent = error instanceof Error ? error.message : String(error);
      }
    });
  });
}

function renderTabBar(groups: ScriptPokemonGroup[]): string {
  return `
    <div class="script-pokemon-tabs" role="tablist" aria-label="Scripted Pokemon acquisition methods">
      ${SCRIPT_POKEMON_TABS.map((tab) => {
        const count = tab.id === "starters" ? 3 : acquisitionCountForTab(groups, tab.id);
        const selected = activeScriptPokemonTab === tab.id;
        return `<button type="button" role="tab" class="script-pokemon-tab ${selected ? "-active" : ""}" data-script-pokemon-tab="${tab.id}" aria-selected="${selected}">${escapeHtml(tab.label)} <span>${count}</span></button>`;
      }).join("")}
    </div>
  `;
}

function renderScriptedPokemonTabs(project: ProjectState, groups: ScriptPokemonGroup[], warnings: string[]): string {
  const acquisitionTabs = SCRIPT_POKEMON_TABS.filter((tab): tab is { id: ScriptPokemonAcquisitionTab; label: string } => tab.id !== "starters");
  return acquisitionTabs.map((tab) => {
    const tabGroups = groupsForTab(groups, tab.id);
    const count = tabGroups.reduce((sum, group) => sum + group.acquisitionCount, 0);
    return `
      <section class="script-pokemon-tab-panel script-pokemon-section" data-script-pokemon-panel="${tab.id}" ${activeScriptPokemonTab === tab.id ? "" : "hidden"}>
        <div class="script-pokemon-heading">
          <div><h2>${escapeHtml(tab.label)}</h2><p>${escapeHtml(tabDescription(tab.id))}</p></div>
          <span>${count} acquisition${count === 1 ? "" : "s"}</span>
        </div>
        ${warnings.map((warning) => `<div class="starter-warning">${escapeHtml(warning)}</div>`).join("")}
        ${tabGroups.length === 0 ? `<div class="script-pokemon-empty">No ${escapeHtml(tab.label.toLowerCase())} were found.</div>` : tabGroups.map((group) => renderScriptGroup(project, group)).join("")}
      </section>
    `;
  }).join("");
}

function groupsForTab(groups: ScriptPokemonGroup[], tab: Exclude<ScriptPokemonTab, "starters">): ScriptPokemonGroup[] {
  return groups.flatMap((group) => {
    const entries = group.entries.map((entry) => ({
      ...entry,
      acquisitions: entry.acquisitions.filter((acquisition) => acquisitionBelongsToTab(acquisition, tab)),
    })).filter((entry) => entry.acquisitions.length > 0);
    const acquisitions = entries.flatMap((entry) => entry.acquisitions);
    if (acquisitions.length === 0) return [];
    return [{
      ...group,
      entries,
      acquisitionCount: acquisitions.length,
      editableFieldCount: acquisitions.reduce((sum, acquisition) => sum + acquisition.fields.filter((field) => field.editable).length, 0),
    }];
  });
}

function acquisitionCountForTab(groups: ScriptPokemonGroup[], tab: Exclude<ScriptPokemonTab, "starters">): number {
  return groups.reduce((sum, group) => sum + group.entries.reduce((entrySum, entry) => (
    entrySum + entry.acquisitions.filter((acquisition) => acquisitionBelongsToTab(acquisition, tab)).length
  ), 0), 0);
}

function acquisitionBelongsToTab(acquisition: ScriptPokemonAcquisition, tab: Exclude<ScriptPokemonTab, "starters">): boolean {
  if (tab === "party_gifts") return acquisition.kind === "party_gift" || acquisition.kind === "party_gift_ex" || acquisition.kind === "n_gift";
  if (tab === "box_gifts") return acquisition.kind === "box_gift" || acquisition.kind === "box_gift_ex";
  if (tab === "eggs") return acquisition.kind === "egg";
  if (tab === "wild_battles") return acquisition.kind === "wild_battle" || acquisition.kind === "wild_battle_ex";
  return acquisition.kind === "trade";
}

function tabDescription(tab: Exclude<ScriptPokemonTab, "starters">): string {
  if (tab === "party_gifts") return "Pokemon added directly to the player's party, including extended and N-style gifts.";
  if (tab === "box_gifts") return "Pokemon sent directly to storage by BoxAdd and BoxAddEx commands.";
  if (tab === "eggs") return "Scripted eggs added to the party at their fixed level of 1.";
  if (tab === "wild_battles") return "Script-launched wild encounters, including form-aware BW2 encounters and raw battle flags.";
  return "In-game trade records referenced by field-trade commands, plus unreferenced records from the loaded archive.";
}

function renderScriptGroup(project: ProjectState, group: ScriptPokemonGroup): string {
  const title = locationTitle(group);
  const subheader = groupSubheader(group);
  return `
    <details class="script-pokemon-group" data-script-pokemon-group="${escapeHtml(group.key)}">
      <summary>
        <span class="script-pokemon-group-heading"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(subheader)}</small></span>
        <span class="script-pokemon-group-overview">
          ${renderScriptGroupPokemonIcons(project, group)}
          <em>${group.acquisitionCount} acquisition${group.acquisitionCount === 1 ? "" : "s"}</em>
        </span>
      </summary>
      <div class="script-pokemon-group-body">
        ${group.entries.map((entry) => `
          <section class="script-pokemon-entry">
            ${entry.acquisitions.map((acquisition) => renderAcquisition(project, acquisition, group)).join("")}
          </section>
        `).join("")}
        <div class="script-pokemon-actions">
          <span data-script-pokemon-status></span>
          <button class="primary-button" type="button" data-script-pokemon-apply="${escapeHtml(group.key)}" ${group.editableFieldCount === 0 ? "disabled" : ""}>Apply Changes</button>
        </div>
      </div>
    </details>
  `;
}

type ScriptPokemonIconReference = {
  speciesId: number;
  form: number;
  spriteId: number;
  name: string;
};

function renderScriptGroupPokemonIcons(project: ProjectState, group: ScriptPokemonGroup): string {
  const references = scriptGroupPokemonIconReferences(project, group);
  if (references.length === 0) return "";
  return `
    <span class="script-pokemon-group-icons" role="list" aria-label="Referenced Pokemon">
      ${references.map((reference) => {
        const detail = `${reference.name} #${reference.speciesId}${reference.form > 0 ? `, form ${reference.form}` : ""}`;
        const fallback = publicAsset(`images/pokesprite/${pokemonSpriteSlug(reference.name)}.png`);
        return `
          <span class="script-pokemon-group-icon" role="listitem" aria-label="${escapeHtml(detail)}" title="${escapeHtml(detail)}" data-script-pokemon-icon-species="${reference.speciesId}" data-script-pokemon-icon-form="${reference.form}">
            <canvas width="32" height="32" hidden aria-hidden="true" data-script-pokemon-icon-sprite="${reference.spriteId}"></canvas>
            <img src="${escapeHtml(fallback)}" alt="" aria-hidden="true" loading="lazy" onerror="this.style.visibility='hidden'" />
          </span>
        `;
      }).join("")}
    </span>
  `;
}

function scriptGroupPokemonIconReferences(project: ProjectState, group: ScriptPokemonGroup): ScriptPokemonIconReference[] {
  const references = new Map<string, ScriptPokemonIconReference>();
  for (const acquisition of group.entries.flatMap((entry) => entry.acquisitions)) {
    for (const field of acquisition.fields.filter((candidate) => candidate.control === "species" && candidate.value !== undefined)) {
      const speciesId = field.value!;
      const formFieldName = field.name === "givenSpeciesId" ? "givenForm" : field.name === "species" ? "form" : undefined;
      const form = formFieldName === undefined ? 0 : acquisition.fields.find((candidate) => candidate.name === formFieldName)?.value ?? 0;
      let spriteId = speciesId;
      try {
        spriteId = resolvePokemonSpriteId(project, speciesId, form);
      } catch {
        // Expanded or malformed references still receive a labeled fallback icon.
      }
      const key = `${speciesId}:${form}:${spriteId}`;
      if (!references.has(key)) references.set(key, { speciesId, form, spriteId, name: pokemonSpeciesLabel(project, speciesId) });
    }
  }
  return [...references.values()];
}

function installScriptPokemonGroupIconRendering(project: ProjectState, root: HTMLElement): void {
  scriptPokemonIconInstallations.get(root)?.disconnect();
  if (!project.narcs.pokemon_icons) return;
  const imageCache = new Map<number, Promise<RgbaImageData | undefined>>();
  const loadImage = (spriteId: number): Promise<RgbaImageData | undefined> => {
    let cached = imageCache.get(spriteId);
    if (!cached) {
      cached = Promise.resolve()
        .then(() => getPokemonIconImage(project, spriteId, "male"))
        .catch((error) => {
          console.warn(`Failed to render scripted Pokemon icon ${spriteId}`, error);
          return undefined;
        });
      imageCache.set(spriteId, cached);
    }
    return cached;
  };
  const renderCanvas = async (canvas: HTMLCanvasElement): Promise<void> => {
    if (canvas.dataset.scriptPokemonIconRendered) return;
    const spriteId = Number(canvas.dataset.scriptPokemonIconSprite);
    if (!Number.isInteger(spriteId)) return;
    canvas.dataset.scriptPokemonIconRendered = "loading";
    const image = await loadImage(spriteId);
    if (!canvas.isConnected) return;
    if (!image) {
      canvas.dataset.scriptPokemonIconRendered = "missing";
      return;
    }
    const frameHeight = Math.min(image.width, image.height);
    const pixels = new Uint8ClampedArray(image.pixels.slice(0, image.width * frameHeight * 4));
    canvas.width = image.width;
    canvas.height = frameHeight;
    canvas.getContext("2d")?.putImageData(new ImageData(pixels, image.width, frameHeight), 0, 0);
    canvas.hidden = false;
    canvas.closest<HTMLElement>(".script-pokemon-group-icon")?.classList.add("-rom-loaded");
    canvas.dataset.scriptPokemonIconRendered = "true";
  };
  const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const canvas = entry.target as HTMLCanvasElement;
      observer?.unobserve(canvas);
      void renderCanvas(canvas);
    }
  });
  root.querySelectorAll<HTMLCanvasElement>("canvas[data-script-pokemon-icon-sprite]").forEach((canvas) => {
    if (observer) observer.observe(canvas);
    else void renderCanvas(canvas);
  });
  scriptPokemonIconInstallations.set(root, { disconnect: () => observer?.disconnect() });
}

function renderAcquisition(project: ProjectState, acquisition: ScriptPokemonAcquisition, group: ScriptPokemonGroup): string {
  const diagnostics = [
    ...acquisition.warnings,
    acquisition.kind === "egg" ? "Egg level is fixed at 1." : "",
  ].filter(Boolean);
  const normalFields = acquisition.fields.filter((field) => !field.advanced);
  const advancedFields = acquisition.fields.filter((field) => field.advanced);
  const offsetText = acquisition.commandOffsets.length > 0
    ? acquisition.commandOffsets.map((offset) => `0x${offset.toString(16)}`).join(", ")
    : "record only";
  const subheader = [
    acquisition.label,
    acquisition.scriptFileId === undefined ? "No script reference" : `Script file ${acquisition.scriptFileId}`,
    acquisition.entryIndex === undefined ? undefined : `entry ${acquisition.entryIndex}`,
    group.locations.length === 0 ? "Unmapped" : group.locations.map((location) => `header ${location.headerId} ${location.referenceType === "script" ? "script" : "level script"}`).join(", "),
    acquisition.tradeFileId === undefined ? undefined : `trade record ${acquisition.tradeFileId}`,
    `source ${offsetText}`,
  ].filter(Boolean).join(" · ");
  return `
    <article class="script-pokemon-card">
      <div class="script-pokemon-card-head">
        <div><strong>${escapeHtml(locationTitle(group))}</strong><span>${escapeHtml(subheader)}</span></div>
      </div>
      ${acquisition.tradeRecordMissing ? `<div class="starter-warning">The referenced In-game Trades archive record is not loaded or is invalid.</div>` : ""}
      <div class="script-pokemon-fields">${normalFields.map((field) => renderAcquisitionField(project, field)).join("")}</div>
      ${advancedFields.length === 0 ? "" : `
        <details class="script-pokemon-advanced">
          <summary>Advanced raw metadata (${advancedFields.length})</summary>
          <div class="script-pokemon-fields">${advancedFields.map((field) => renderAcquisitionField(project, field)).join("")}</div>
        </details>
      `}
      ${renderTradeTextShortcuts(project, acquisition)}
      ${diagnostics.map((warning) => `<div class="script-pokemon-note">${escapeHtml(warning)}</div>`).join("")}
    </article>
  `;
}

function locationTitle(group: ScriptPokemonGroup): string {
  const names = [...new Set(group.locations.map((location) => location.locationName).filter(Boolean))];
  return names.length > 0 ? names.join(" / ") : "Unmapped";
}

function groupSubheader(group: ScriptPokemonGroup): string {
  const script = group.scriptFileId === undefined ? "No script file reference" : `Script file ${group.scriptFileId}`;
  const headers = group.locations.length === 0
    ? "No owning header"
    : group.locations.map((location) => `header ${location.headerId} (${location.referenceType === "script" ? "script" : "level script"})`).join(", ");
  return `${script} · ${headers}`;
}

function renderTradeTextShortcuts(project: ProjectState, acquisition: ScriptPokemonAcquisition): string {
  if (acquisition.kind !== "trade" || acquisition.tradeRecordMissing) return "";
  const bankId = gen5InGameTradeTextBankId(project.session.baseRom);
  if (bankId === undefined) return "";
  if (!project.narcs.message_texts) return `<div class="script-pokemon-note">Info Text is not loaded, so referenced trade names cannot be displayed.</div>`;
  const fields = [
    { name: "nicknameTextId", label: "Received Pokemon Nickname" },
    { name: "otNameTextId", label: "Original Trainer Name" },
  ];
  return `
    <section class="trade-text-shortcuts">
      <div class="trade-text-shortcuts-head"><strong>Referenced Text Entries</strong><span>Info Text bank ${bankId}; edits save when the field changes.</span></div>
      <div class="trade-text-shortcut-grid">
        ${fields.map(({ name, label }) => {
          const entryId = acquisition.fields.find((field) => field.name === name)?.value;
          if (entryId === undefined) return "";
          const referenced = tradeTextEntry(project, bankId, entryId);
          if (!referenced) return `<div class="trade-text-shortcut"><strong>${escapeHtml(label)}</strong><span>Bank ${bankId}, entry ${entryId} is missing.</span></div>`;
          return `
            <label class="trade-text-shortcut">
              <span>${escapeHtml(label)} · Bank ${bankId}, Entry ${entryId}</span>
              <textarea rows="2" data-trade-text-entry data-trade-text-bank="${bankId}" data-trade-text-flat-index="${referenced.flatIndex}">${escapeHtml(referenced.value)}</textarea>
              <small data-trade-text-status>Referenced by trade field ${escapeHtml(name)}</small>
            </label>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function tradeTextEntry(project: ProjectState, bankId: number, entryId: number): { flatIndex: number; value: string } | undefined {
  try {
    const bank = getTextBank(project, "message_texts", bankId);
    const flatIndex = bank.findIndex((entry) => {
      const meta = parseTextEntryId(entry[0]);
      return meta.block === 0 && meta.entry === entryId;
    });
    return flatIndex < 0 ? undefined : { flatIndex, value: bank[flatIndex]![1] };
  } catch {
    return undefined;
  }
}

function renderAcquisitionField(project: ProjectState, field: ScriptPokemonEditableField): string {
  const disabled = field.editable ? "" : "disabled";
  const title = field.reason ? ` title="${escapeHtml(field.reason)}"` : "";
  const current = field.value ?? field.rawValue ?? 0;
  if (field.control === "bit_flags") return renderBitFlagField(field, current, disabled, title);
  let control: string;
  if (field.control === "species") control = `<input type="text" list="script-pokemon-species-list" value="${escapeHtml(speciesDisplayValue(project, current))}" ${disabled}${title} data-script-pokemon-control="species" data-script-pokemon-key="${escapeHtml(field.key)}" />`;
  else if (field.control === "item") control = `<input type="text" list="script-pokemon-item-list" value="${escapeHtml(itemDisplayValue(project, current))}" ${disabled}${title} data-script-pokemon-control="item" data-script-pokemon-key="${escapeHtml(field.key)}" />`;
  else if (field.control === "nature") control = `<select ${disabled}${title} data-script-pokemon-control="number" data-script-pokemon-key="${escapeHtml(field.key)}">${namedOptions(NATURES, current)}</select>`;
  else if (field.control === "select") control = `<select ${disabled}${title} data-script-pokemon-control="number" data-script-pokemon-key="${escapeHtml(field.key)}">${valueOptions(field.options ?? [], current)}</select>`;
  else control = `<input type="number" value="${current}" min="${field.min}" max="${field.max}" step="1" ${disabled}${title} data-script-pokemon-control="number" data-script-pokemon-key="${escapeHtml(field.key)}" />`;
  return `
    <label class="script-pokemon-field ${field.editable ? "" : "-readonly"}">
      <span>${escapeHtml(field.label)}</span>
      ${control}
      ${field.editable ? "" : `<small>${escapeHtml(field.reason ?? `Runtime value 0x${(field.rawValue ?? 0).toString(16)}`)}</small>`}
    </label>
  `;
}

function renderBitFlagField(
  field: ScriptPokemonEditableField,
  current: number,
  disabled: string,
  title: string,
): string {
  const flags = field.bitFlags ?? [];
  const knownMask = flags.reduce((mask, flag) => mask | flag.mask, 0);
  const unknownBits = current & (~knownMask & 0xffff);
  const categories = [...new Set(flags.map((flag) => flag.category))];
  return `
    <div class="script-pokemon-field script-pokemon-bitfield ${field.editable ? "" : "-readonly"}" data-script-pokemon-bitfield>
      <span>${escapeHtml(field.label)}</span>
      <div class="script-pokemon-bitfield-groups">
        ${categories.map((category) => `
          <fieldset>
            <legend>${escapeHtml(category)}</legend>
            ${flags.filter((flag) => flag.category === category).map((flag) => `
              <label class="script-pokemon-bitflag" title="${escapeHtml(flag.description)}">
                <input type="checkbox" ${current & flag.mask ? "checked" : ""} ${disabled}
                  data-script-pokemon-bit-mask="${flag.mask}"
                  ${flag.exclusiveWith === undefined ? "" : `data-script-pokemon-bit-exclusive="${flag.exclusiveWith}"`} />
                <span><strong>${escapeHtml(flag.label)}</strong><small>0x${flag.mask.toString(16).padStart(4, "0")} · ${escapeHtml(flag.description)}</small></span>
              </label>
            `).join("")}
          </fieldset>
        `).join("")}
      </div>
      <label class="script-pokemon-bitfield-raw">
        <span>Raw 16-bit value</span>
        <input type="number" value="${current}" min="${field.min}" max="${field.max}" step="1" ${disabled}${title}
          data-script-pokemon-control="number" data-script-pokemon-key="${escapeHtml(field.key)}" />
        <small data-script-pokemon-unknown-bits>${unknownBits === 0
          ? `All set bits are recognized (known mask 0x${knownMask.toString(16).padStart(4, "0")}).`
          : `Unknown bits 0x${unknownBits.toString(16).padStart(4, "0")} are preserved.`}</small>
      </label>
      ${field.editable ? "" : `<small>${escapeHtml(field.reason ?? `Runtime value 0x${(field.rawValue ?? 0).toString(16)}`)}</small>`}
    </div>
  `;
}

function installScriptPokemonFieldSynchronization(root: HTMLElement): void {
  const refreshBitfield = (container: HTMLElement) => {
    const raw = container.querySelector<HTMLInputElement>("[data-script-pokemon-key]");
    if (!raw) return;
    const value = Number(raw.value);
    let knownMask = 0;
    container.querySelectorAll<HTMLInputElement>("[data-script-pokemon-bit-mask]").forEach((checkbox) => {
      const mask = Number(checkbox.dataset.scriptPokemonBitMask);
      knownMask |= mask;
      checkbox.checked = Number.isInteger(value) && (value & mask) !== 0;
    });
    const unknown = Number.isInteger(value) ? value & (~knownMask & 0xffff) : 0;
    const note = container.querySelector<HTMLElement>("[data-script-pokemon-unknown-bits]");
    if (note) note.textContent = unknown === 0
      ? `All set bits are recognized (known mask 0x${knownMask.toString(16).padStart(4, "0")}).`
      : `Unknown bits 0x${unknown.toString(16).padStart(4, "0")} are preserved.`;
  };

  const syncValue = (input: HTMLInputElement | HTMLSelectElement) => {
    const key = input.dataset.scriptPokemonKey;
    if (!key) return;
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-script-pokemon-key]").forEach((linked) => {
      if (linked !== input && linked.dataset.scriptPokemonKey === key) linked.value = input.value;
      if (linked.dataset.scriptPokemonKey === key) {
        const bitfield = linked.closest<HTMLElement>("[data-script-pokemon-bitfield]");
        if (bitfield) refreshBitfield(bitfield);
      }
    });
  };

  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-script-pokemon-key]").forEach((input) => {
    input.addEventListener("change", () => syncValue(input));
  });
  root.querySelectorAll<HTMLInputElement>("[data-script-pokemon-bit-mask]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const bitfield = checkbox.closest<HTMLElement>("[data-script-pokemon-bitfield]");
      const raw = bitfield?.querySelector<HTMLInputElement>("[data-script-pokemon-key]");
      if (!bitfield || !raw) return;
      const mask = Number(checkbox.dataset.scriptPokemonBitMask);
      const exclusive = Number(checkbox.dataset.scriptPokemonBitExclusive ?? 0);
      let value = Number(raw.value);
      if (!Number.isInteger(value)) value = 0;
      if (checkbox.checked) value = (value | mask) & ~exclusive;
      else value &= ~mask;
      raw.value = String(value & 0xffff);
      syncValue(raw);
    });
  });
}

function speciesListOptions(project: ProjectState): string {
  return getPokemonPersonalIds(project)
    .filter((id) => id > 0 && id < 0x4000)
    .filter((id) => id < 650 || !findPokemonPersonalFormOwner(project, id))
    .sort((left, right) => left - right).map((id) => (
    `<option value="${escapeHtml(speciesDisplayValue(project, id))}"></option>`
  )).join("");
}

function itemListOptions(project: ProjectState): string {
  const count = Math.max(project.narcs.items?.fileCount ?? 0, project.texts.banks.items?.length ?? 0);
  return Array.from({ length: count }, (_unused, id) => (
    `<option value="${escapeHtml(itemDisplayValue(project, id))}"></option>`
  )).join("");
}

function speciesDisplayValue(project: ProjectState, speciesId: number): string {
  return `${pokemonSpeciesLabel(project, speciesId)} #${speciesId}`;
}

function itemDisplayValue(project: ProjectState, itemId: number): string {
  return `${project.texts.banks.items?.[itemId] ?? `Item ${itemId}`} #${itemId}`;
}

function parseScriptPokemonFieldValue(project: ProjectState, input: HTMLInputElement | HTMLSelectElement): number {
  const control = input.dataset.scriptPokemonControl;
  if (control === "species") return parseSpeciesValue(project, input.value);
  if (control === "item") return parseItemValue(project, input.value);
  const value = Number(input.value);
  if (!Number.isInteger(value)) throw new Error(`${input.value || "Value"} must be an integer.`);
  return value;
}

function parseSpeciesValue(project: ProjectState, input: string): number {
  const referencedId = referencedNumericId(input);
  if (referencedId !== undefined) return referencedId;
  return findPokemonBaseSpeciesId(project, input.trim(), 0x3fff);
}

function parseItemValue(project: ProjectState, input: string): number {
  const referencedId = referencedNumericId(input);
  if (referencedId !== undefined) return referencedId;
  const normalized = normalizeLookupName(input);
  const matches = (project.texts.banks.items ?? []).flatMap((name, itemId) => (
    normalizeLookupName(name) === normalized ? [itemId] : []
  ));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) throw new Error(`Multiple items are named ${input.trim()}; select the entry that includes its #ID.`);
  throw new Error(`Unknown item: ${input.trim()}`);
}

function referencedNumericId(input: string): number | undefined {
  const trimmed = input.trim();
  const direct = /^\d+$/u.exec(trimmed);
  if (direct) return Number(direct[0]);
  const suffix = /#(\d+)\s*$/u.exec(trimmed);
  return suffix ? Number(suffix[1]) : undefined;
}

function normalizeLookupName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function namedOptions(names: readonly string[], selected: number): string {
  const options = Array.from({ length: names.length }, (_unused, id) => (
    `<option value="${id}" ${id === selected ? "selected" : ""}>${id} - ${escapeHtml(names[id] ?? `Value ${id}`)}</option>`
  ));
  if (selected >= names.length) options.push(`<option value="${selected}" selected>${selected} - Value ${selected}</option>`);
  return options.join("");
}

function valueOptions(options: readonly { value: number; label: string }[], selected: number): string {
  const rendered = options.map((option) => (
    `<option value="${option.value}" ${option.value === selected ? "selected" : ""}>${option.value} - ${escapeHtml(option.label)}</option>`
  ));
  if (!options.some((option) => option.value === selected)) {
    rendered.push(`<option value="${selected}" selected>${selected} - Unknown / hacked value</option>`);
  }
  return rendered.join("");
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/gu, "\\$&");
}

function renderStarterSlot(project: ProjectState, slot: number, speciesId: number): string {
  const labels = ["Left", "Middle", "Right"];
  const typeName = starterTypeName(project, speciesId);
  const speciesName = pokemonSpeciesLabel(project, speciesId);
  const fallbackSrc = publicAsset(`images/pokesprite/${pokemonSpriteSlug(speciesName)}.png`);
  return `
    <section class="starter-slot">
      <div class="starter-slot-head">
        <h3>${labels[slot] ?? `Slot ${slot + 1}`}</h3>
        <span data-starter-type="${slot}">${escapeHtml(typeName)}</span>
      </div>
      <figure class="starter-graphic-preview" data-starter-graphic-wrap="${slot}">
        <div class="starter-graphic-stage">
          <canvas data-starter-graphic="${slot}" width="96" height="96" hidden role="img" aria-label="Target starter graphic for ${escapeHtml(speciesName)}"></canvas>
          <img data-starter-graphic-fallback="${slot}" src="${escapeHtml(fallbackSrc)}" alt="Target starter graphic for ${escapeHtml(speciesName)}" />
        </div>
        <figcaption>Target Graphic</figcaption>
      </figure>
      <select data-starter-slot="${slot}" aria-label="${escapeHtml(labels[slot] ?? `Slot ${slot + 1}`)} starter">
        ${starterOptions(project, speciesId)}
      </select>
    </section>
  `;
}

function starterOptions(project: ProjectState, selectedSpeciesId: number): string {
  const count = Math.min(project.narcs.personal?.fileCount ?? 650, 650);
  const names = project.texts.banks.pokedex ?? [];
  const options: string[] = [];
  for (let speciesId = 1; speciesId < count; speciesId += 1) {
    const name = names[speciesId] ?? `Pokemon ${speciesId}`;
    options.push(`<option value="${speciesId}" ${speciesId === selectedSpeciesId ? "selected" : ""}>${speciesId} - ${escapeHtml(name)}</option>`);
  }
  return options.join("");
}

function refreshSlotTypes(project: ProjectState, root: HTMLElement): void {
  root.querySelectorAll<HTMLSelectElement>("[data-starter-slot]").forEach((select) => {
    const slot = Number(select.dataset.starterSlot);
    const speciesId = Number(select.value);
    const type = root.querySelector<HTMLElement>(`[data-starter-type="${slot}"]`);
    if (type) type.textContent = starterTypeName(project, speciesId);
    refreshStarterGraphic(project, root, slot, speciesId);
  });
}

function refreshStarterGraphic(project: ProjectState, root: HTMLElement, slot: number, speciesId: number): void {
  const wrap = root.querySelector<HTMLElement>(`[data-starter-graphic-wrap="${slot}"]`);
  const canvas = root.querySelector<HTMLCanvasElement>(`[data-starter-graphic="${slot}"]`);
  const fallback = root.querySelector<HTMLImageElement>(`[data-starter-graphic-fallback="${slot}"]`);
  if (!wrap || !canvas || !fallback) return;
  const speciesName = pokemonSpeciesLabel(project, speciesId);
  const label = `Target starter graphic for ${speciesName}`;
  wrap.classList.remove("-rom-loaded");
  canvas.hidden = true;
  canvas.setAttribute("aria-label", label);
  fallback.alt = label;
  fallback.src = publicAsset(`images/pokesprite/${pokemonSpriteSlug(speciesName)}.png`);
  if (!project.narcs.pokemon_sprites) return;
  try {
    const image = getPokemonSpriteImage(project, speciesId, { kind: "sprite", side: "front", gender: "male" }, "normal");
    canvas.width = image.width;
    canvas.height = image.height;
    const pixels = new Uint8ClampedArray(image.pixels.length);
    pixels.set(image.pixels);
    canvas.getContext("2d")?.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
    canvas.hidden = false;
    wrap.classList.add("-rom-loaded");
  } catch (error) {
    console.warn(`Failed to render starter target graphic ${speciesId}`, error);
  }
}

function starterTypeName(project: ProjectState, speciesId: number): string {
  const raw = project.narcs.personal?.rawFiles[speciesId];
  if (!raw) return "Unknown";
  const typeId = raw[6] ?? 0;
  return ["Normal", "Fighting", "Flying", "Poison", "Ground", "Rock", "Bug", "Ghost", "Steel", "Fire", "Water", "Grass", "Electric", "Psychic", "Ice", "Dragon", "Dark", "Fairy"][typeId] ?? "Unknown";
}
