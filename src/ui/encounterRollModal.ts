import {
  AUTO_ENCOUNTER_TABLE_KEY,
  encounterRollSelectionsForLevel,
  getEncounterRollAreas,
  parseEncounterRollStatics,
  rollEncounterSelections,
  type EncounterRollArea,
  type EncounterRollResult,
  type EncounterRollSelection,
  type EncounterRollStatic,
} from "../pokeweb/encounterRollModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { trainerPokemonSpriteSlug } from "../pokeweb/trainerModel";
import { getEvolutionItems } from "../pokeweb/testTeamEvolution";
import { publicAsset } from "../assetUrl";

const ENCOUNTER_ROLL_PLAN_STORAGE_PREFIX = "pokeweb.encounterRoll.plan";

type SavedEncounterRollPlan = {
  level: string;
  selections: EncounterRollSelection[];
  staticsText: string;
  fishingPercent: string;
  surfPercent: string;
  grassDoublesPercent: string;
  obtainedEvolutionItemIds: number[];
};

export type EncounterRollOutput = {
  encounters: EncounterRollResult[];
  statics: EncounterRollStatic[];
};

export function requestEncounterRoll(project: ProjectState, onRoll: (output: EncounterRollOutput) => void): void {
  const areas = getEncounterRollAreas(project);
  const evolutionItems = getEvolutionItems(project);
  const savedPlan = readSavedEncounterRollPlan(project);
  let selections = validSavedSelections(areas, savedPlan.selections);
  const overlay = document.createElement("div");
  overlay.className = "encounter-roll-modal";
  overlay.innerHTML = `
      <form class="encounter-roll-dialog" role="dialog" aria-modal="true" aria-labelledby="encounter-roll-title">
        <div class="encounter-roll-header">
          <div>
            <div class="encounter-roll-title" id="encounter-roll-title">Roll Encounters</div>
            <div class="encounter-roll-description">One encounter is rolled per area, in the order below. Dupes are rerolled whenever that table still has a new species.</div>
          </div>
          <button class="encounter-roll-close" type="button" data-close aria-label="Close">×</button>
        </div>
        <div class="encounter-roll-tools">
          <div class="encounter-roll-tool">
            <label for="encounter-roll-level">Auto-fill through level</label>
            <div class="encounter-roll-control-row">
              <input id="encounter-roll-level" class="encounter-roll-level" type="number" inputmode="numeric" min="1" max="100" step="1" placeholder="Level">
              <button class="btn -default" type="button" data-populate>Populate Areas</button>
            </div>
          </div>
          <div class="encounter-roll-tool">
            <label for="encounter-roll-add-area">Add encounter area</label>
            <div class="encounter-roll-control-row">
              <select id="encounter-roll-add-area" class="encounter-roll-select" data-add-area></select>
              <select class="encounter-roll-select" data-add-table aria-label="Encounter table"></select>
              <button class="btn -default" type="button" data-add>Add</button>
            </div>
          </div>
          <div class="encounter-roll-tool encounter-roll-table-odds">
            <label>Automatic table chances</label>
            <div class="encounter-roll-odds-fields">
              <label>Fishing <span><input class="encounter-roll-percent" type="number" min="0" max="100" step="1" inputmode="decimal" data-fishing-percent> %</span></label>
              <label>Surf <span><input class="encounter-roll-percent" type="number" min="0" max="100" step="1" inputmode="decimal" data-surf-percent> %</span></label>
              <label>Grass Doubles <span><input class="encounter-roll-percent" type="number" min="0" max="100" step="1" inputmode="decimal" data-doubles-percent> %</span></label>
              <div class="encounter-roll-grass-percent">Regular grass <strong data-grass-percent>100%</strong></div>
            </div>
            <div class="encounter-roll-tool-description">Regular grass uses the remaining percentage. Methods unavailable at the entered level are removed and the valid chances are redistributed.</div>
          </div>
          <div class="encounter-roll-tool encounter-roll-evolution-items">
            <label>Obtained Evo Items</label>
            <div class="encounter-roll-evolution-item-list" data-evolution-items></div>
          </div>
          <div class="encounter-roll-tool encounter-roll-statics">
            <label for="encounter-roll-statics">Statics</label>
            <textarea id="encounter-roll-statics" class="encounter-roll-statics-input" data-statics spellcheck="false" placeholder="Victini @ Charcoal&#10;Level: 15&#10;Timid Nature&#10;IVs: 31 SpA / 31 Spe&#10;- Incinerate"></textarea>
          </div>
        </div>
        <div class="encounter-roll-list-heading">
          <strong>Encounter order</strong>
          <span data-count>0 areas</span>
        </div>
        <div class="encounter-roll-list" data-list></div>
        <div class="encounter-roll-footer">
          <div class="encounter-roll-status" data-status role="status" aria-live="polite"></div>
          <div class="encounter-roll-actions">
            <button class="btn -default" type="button" data-close>Close</button>
            <button class="btn -default encounter-roll-submit" type="submit" data-roll disabled>Roll</button>
          </div>
        </div>
      </form>
  `;

    const form = overlay.querySelector<HTMLFormElement>("form");
    const list = overlay.querySelector<HTMLElement>("[data-list]");
    const count = overlay.querySelector<HTMLElement>("[data-count]");
    const status = overlay.querySelector<HTMLElement>("[data-status]");
    const levelInput = overlay.querySelector<HTMLInputElement>(".encounter-roll-level");
    const areaSelect = overlay.querySelector<HTMLSelectElement>("[data-add-area]");
    const tableSelect = overlay.querySelector<HTMLSelectElement>("[data-add-table]");
    const staticsInput = overlay.querySelector<HTMLTextAreaElement>("[data-statics]");
    const fishingInput = overlay.querySelector<HTMLInputElement>("[data-fishing-percent]");
    const surfInput = overlay.querySelector<HTMLInputElement>("[data-surf-percent]");
    const doublesInput = overlay.querySelector<HTMLInputElement>("[data-doubles-percent]");
    const grassPercent = overlay.querySelector<HTMLElement>("[data-grass-percent]");
    const evolutionItemList = overlay.querySelector<HTMLElement>("[data-evolution-items]");
    const rollButton = overlay.querySelector<HTMLButtonElement>("[data-roll]");

    if (levelInput) levelInput.value = savedPlan.level;
    if (staticsInput) staticsInput.value = savedPlan.staticsText;
    if (fishingInput) fishingInput.value = savedPlan.fishingPercent;
    if (surfInput) surfInput.value = savedPlan.surfPercent;
    if (doublesInput) doublesInput.value = savedPlan.grassDoublesPercent;
    if (evolutionItemList) {
      if (evolutionItems.length === 0) {
        const empty = document.createElement("span");
        empty.className = "encounter-roll-evolution-items-empty";
        empty.textContent = "No item-based evolutions are loaded.";
        evolutionItemList.append(empty);
      } else {
        const allLabel = document.createElement("label");
        allLabel.className = "encounter-roll-evolution-item -all";
        const allCheckbox = document.createElement("input");
        allCheckbox.type = "checkbox";
        allCheckbox.dataset.evolutionItemsAll = "";
        const allName = document.createElement("span");
        allName.textContent = "Check All";
        allLabel.append(allCheckbox, allName);
        evolutionItemList.append(allLabel);
        evolutionItems.forEach((item) => {
          const label = document.createElement("label");
          label.className = "encounter-roll-evolution-item";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.value = String(item.itemId);
          checkbox.checked = savedPlan.obtainedEvolutionItemIds.includes(item.itemId);
          checkbox.dataset.evolutionItem = "";
          const name = document.createElement("span");
          name.textContent = item.itemName;
          label.append(checkbox, name);
          evolutionItemList.append(label);
        });
      }
    }

    const close = () => {
      document.removeEventListener("keydown", onKeydown);
      overlay.remove();
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const setStatus = (message: string, error = false) => {
      if (!status) return;
      status.textContent = message;
      status.classList.toggle("-error", error);
    };
    const persistPlan = () => rememberEncounterRollPlan(project, {
      level: levelInput?.value ?? "",
      selections,
      staticsText: staticsInput?.value ?? "",
      fishingPercent: fishingInput?.value ?? "0",
      surfPercent: surfInput?.value ?? "0",
      grassDoublesPercent: doublesInput?.value ?? "0",
      obtainedEvolutionItemIds: selectedEvolutionItemIds(overlay),
    });
    const updateGrassPercent = () => {
      if (!grassPercent) return;
      const remaining = 100 - percentValue(fishingInput) - percentValue(surfInput) - percentValue(doublesInput);
      grassPercent.textContent = `${remaining}%`;
      grassPercent.classList.toggle("-error", remaining < 0);
    };
    const syncEvolutionItemCheckAll = () => {
      const allInput = overlay.querySelector<HTMLInputElement>("[data-evolution-items-all]");
      const itemInputs = [...overlay.querySelectorAll<HTMLInputElement>("[data-evolution-item]")];
      if (!allInput || itemInputs.length === 0) return;
      const checkedCount = itemInputs.filter((input) => input.checked).length;
      allInput.checked = checkedCount === itemInputs.length;
      allInput.indeterminate = checkedCount > 0 && checkedCount < itemInputs.length;
    };
    const updateRollButton = () => {
      if (rollButton) rollButton.disabled = selections.length === 0 && !staticsInput?.value.trim();
    };
    const selectedArea = (): EncounterRollArea | undefined => areas.find((area) => area.encounterId === Number(areaSelect?.value));
    const renderAddTables = () => {
      if (!tableSelect) return;
      const area = selectedArea();
      tableSelect.replaceChildren(
        option(AUTO_ENCOUNTER_TABLE_KEY, "Automatic · weighted by method"),
        ...(area?.tables ?? []).map((table) => option(table.key, `${table.label} · max Lv. ${table.maxLevel}`)),
      );
      tableSelect.value = AUTO_ENCOUNTER_TABLE_KEY;
    };
    const renderSelections = () => {
      if (!list || !count || !rollButton) return;
      list.replaceChildren();
      count.textContent = `${selections.length} area${selections.length === 1 ? "" : "s"}`;
      updateRollButton();
      if (selections.length === 0) {
        const empty = document.createElement("div");
        empty.className = "encounter-roll-empty";
        empty.textContent = areas.length > 0 ? "Auto-fill by level or add an encounter area." : "No rollable encounter tables are loaded.";
        list.append(empty);
        return;
      }

      selections.forEach((selection, index) => {
        const area = areas.find((candidate) => candidate.encounterId === selection.encounterId);
        if (!area) return;
        const row = document.createElement("div");
        row.className = "encounter-roll-row";
        row.dataset.encounterId = String(area.encounterId);
        const order = document.createElement("div");
        order.className = "encounter-roll-order";
        order.textContent = String(index + 1);
        const name = document.createElement("div");
        name.className = "encounter-roll-area-name";
        name.textContent = area.label;
        const tableField = document.createElement("select");
        tableField.className = "encounter-roll-select encounter-roll-row-table";
        tableField.append(option(AUTO_ENCOUNTER_TABLE_KEY, "Automatic · weighted by method"));
        area.tables.forEach((candidate) => tableField.append(option(candidate.key, `${candidate.label} · max Lv. ${candidate.maxLevel}`)));
        tableField.value = selection.tableKey;
        tableField.addEventListener("change", () => {
          selections[index] = { encounterId: area.encounterId, tableKey: tableField.value };
          row.querySelector(".encounter-roll-result")?.replaceChildren();
          persistPlan();
        });
        const result = document.createElement("div");
        result.className = "encounter-roll-result";
        result.setAttribute("aria-live", "polite");
        const controls = document.createElement("div");
        controls.className = "encounter-roll-row-actions";
        controls.append(
          iconButton("↑", "Move area up", index === 0, () => moveSelection(index, -1)),
          iconButton("↓", "Move area down", index === selections.length - 1, () => moveSelection(index, 1)),
          iconButton("×", "Remove area", false, () => {
            selections.splice(index, 1);
            persistPlan();
            renderSelections();
          }, "-remove"),
        );
        row.append(order, name, tableField, result, controls);
        list.append(row);
      });
    };
    const moveSelection = (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= selections.length) return;
      [selections[index], selections[target]] = [selections[target], selections[index]];
      persistPlan();
      renderSelections();
    };

    if (areaSelect) {
      areaSelect.replaceChildren(...areas.map((area) => option(String(area.encounterId), area.label)));
      areaSelect.addEventListener("change", renderAddTables);
    }
    renderAddTables();
    renderSelections();
    updateGrassPercent();
    syncEvolutionItemCheckAll();

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    overlay.querySelectorAll<HTMLElement>("[data-close]").forEach((button) => button.addEventListener("click", close));
    overlay.querySelector("[data-populate]")?.addEventListener("click", () => {
      try {
        selections = encounterRollSelectionsForLevel(areas, Number(levelInput?.value), true);
        persistPlan();
        setStatus(`Added ${selections.length} encounter area${selections.length === 1 ? "" : "s"}.`);
        renderSelections();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), true);
        levelInput?.focus();
      }
    });
    levelInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      overlay.querySelector<HTMLButtonElement>("[data-populate]")?.click();
    });
    levelInput?.addEventListener("input", persistPlan);
    staticsInput?.addEventListener("input", () => {
      persistPlan();
      updateRollButton();
    });
    [fishingInput, surfInput, doublesInput].forEach((input) => input?.addEventListener("input", () => {
      persistPlan();
      updateGrassPercent();
    }));
    overlay.querySelectorAll<HTMLInputElement>("[data-evolution-item]").forEach((input) => input.addEventListener("change", () => {
      syncEvolutionItemCheckAll();
      persistPlan();
    }));
    overlay.querySelector<HTMLInputElement>("[data-evolution-items-all]")?.addEventListener("change", (event) => {
      const checked = (event.currentTarget as HTMLInputElement).checked;
      overlay.querySelectorAll<HTMLInputElement>("[data-evolution-item]").forEach((input) => {
        input.checked = checked;
      });
      syncEvolutionItemCheckAll();
      persistPlan();
    });
    overlay.querySelector("[data-add]")?.addEventListener("click", () => {
      const area = selectedArea();
      if (!area || !tableSelect?.value) return;
      if (selections.some((selection) => selection.encounterId === area.encounterId)) {
        setStatus("That encounter area is already in the list.", true);
        return;
      }
      selections.push({ encounterId: area.encounterId, tableKey: tableSelect.value });
      persistPlan();
      setStatus("");
      renderSelections();
    });
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (selections.length === 0 && !staticsInput?.value.trim()) return;
      try {
        persistPlan();
        const statics = parseEncounterRollStatics(project, staticsInput?.value ?? "");
        const enteredLevel = Number(levelInput?.value);
        const encounters = rollEncounterSelections(project, selections, Math.random, {
          fishingPercent: percentValue(fishingInput),
          surfPercent: percentValue(surfInput),
          grassDoublesPercent: percentValue(doublesInput),
          maxLevel: Number.isFinite(enteredLevel) && enteredLevel >= 1 ? enteredLevel : undefined,
          obtainedEvolutionItemIds: selectedEvolutionItemIds(overlay),
        });
        renderSelectionResults(overlay, encounters);
        onRoll({ encounters, statics });
        const rolledAreaCount = new Set(encounters.map((encounter) => encounter.encounterId)).size;
        const parts = [
          rolledAreaCount > 0 ? `${rolledAreaCount} encounter${rolledAreaCount === 1 ? "" : "s"}` : "",
          statics.length > 0 ? `${statics.length} static${statics.length === 1 ? "" : "s"}` : "",
        ].filter(Boolean);
        setStatus(
          parts.length > 0 ? `Added ${parts.join(" and ")} to the box.` : "No encounter tables are valid at this level.",
          parts.length === 0,
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), true);
      }
    });
    document.addEventListener("keydown", onKeydown);
    document.body.append(overlay);
    levelInput?.focus();
}

function readSavedEncounterRollPlan(project: ProjectState): SavedEncounterRollPlan {
  const fallback: SavedEncounterRollPlan = {
    level: "",
    selections: [],
    staticsText: "",
    fishingPercent: "0",
    surfPercent: "0",
    grassDoublesPercent: "0",
    obtainedEvolutionItemIds: [],
  };
  if (typeof localStorage === "undefined") return fallback;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(encounterRollStorageKey(ENCOUNTER_ROLL_PLAN_STORAGE_PREFIX, project)) ?? "null");
    if (!value || typeof value !== "object") return fallback;
    const saved = value as Partial<SavedEncounterRollPlan>;
    return {
      level: typeof saved.level === "string" ? saved.level : "",
      selections: Array.isArray(saved.selections) ? saved.selections : [],
      staticsText: typeof saved.staticsText === "string" ? saved.staticsText : "",
      fishingPercent: typeof saved.fishingPercent === "string" ? saved.fishingPercent : "0",
      surfPercent: typeof saved.surfPercent === "string" ? saved.surfPercent : "0",
      grassDoublesPercent: typeof saved.grassDoublesPercent === "string" ? saved.grassDoublesPercent : "0",
      obtainedEvolutionItemIds: Array.isArray(saved.obtainedEvolutionItemIds)
        ? saved.obtainedEvolutionItemIds.filter((itemId): itemId is number => Number.isInteger(itemId) && itemId > 0)
        : [],
    };
  } catch {
    return fallback;
  }
}

function renderSelectionResults(overlay: HTMLElement, encounters: readonly EncounterRollResult[]): void {
  overlay.querySelectorAll<HTMLElement>(".encounter-roll-result").forEach((result) => result.replaceChildren());
  const fallbackSrc = publicAsset("images/pokesprite/-.png");
  encounters.forEach((encounter) => {
    const result = overlay.querySelector<HTMLElement>(`.encounter-roll-row[data-encounter-id="${encounter.encounterId}"] .encounter-roll-result`);
    if (!result) return;
    const image = document.createElement("img");
    image.alt = encounter.speciesName;
    image.loading = "lazy";
    image.src = publicAsset(`images/pokesprite/${trainerPokemonSpriteSlug(encounter.speciesName, encounter.formIndex)}.png`);
    image.addEventListener("error", () => {
      image.src = fallbackSrc;
    }, { once: true });
    const chance = document.createElement("span");
    chance.textContent = `(${formatChance(encounter.effectiveChancePercent)})`;
    const option = document.createElement("span");
    option.className = "encounter-roll-result-option";
    option.title = `${encounter.speciesName} · ${encounter.tableLabel}`;
    option.append(image, chance);
    result.append(option);
  });
}

function formatChance(value: number): string {
  return `${Number(value.toFixed(2))}%`;
}

function percentValue(input: HTMLInputElement | null): number {
  const value = Number(input?.value || 0);
  return Number.isFinite(value) ? value : 0;
}

function selectedEvolutionItemIds(overlay: HTMLElement): number[] {
  return [...overlay.querySelectorAll<HTMLInputElement>("[data-evolution-item]:checked")]
    .map((input) => Number(input.value))
    .filter((itemId) => Number.isInteger(itemId) && itemId > 0);
}

function rememberEncounterRollPlan(project: ProjectState, plan: SavedEncounterRollPlan): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(encounterRollStorageKey(ENCOUNTER_ROLL_PLAN_STORAGE_PREFIX, project), JSON.stringify(plan));
  } catch {
    // Browser storage may be unavailable in private or constrained contexts.
  }
}

function validSavedSelections(areas: readonly EncounterRollArea[], selections: readonly EncounterRollSelection[]): EncounterRollSelection[] {
  const seenAreas = new Set<number>();
  const valid: EncounterRollSelection[] = [];
  for (const selection of selections) {
    if (!selection || !Number.isInteger(selection.encounterId) || typeof selection.tableKey !== "string" || seenAreas.has(selection.encounterId)) continue;
    const area = areas.find((candidate) => candidate.encounterId === selection.encounterId);
    if (selection.tableKey !== AUTO_ENCOUNTER_TABLE_KEY && !area?.tables.some((table) => table.key === selection.tableKey)) continue;
    if (!area) continue;
    seenAreas.add(selection.encounterId);
    valid.push({ encounterId: selection.encounterId, tableKey: selection.tableKey });
  }
  return valid;
}

function encounterRollStorageKey(prefix: string, project: ProjectState): string {
  return `${prefix}.${project.session.baseVersion}.${project.session.romName}`;
}

function option(value: string, label: string): HTMLOptionElement {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

function iconButton(label: string, title: string, disabled: boolean, onClick: () => void, extraClass = ""): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `encounter-roll-row-button ${extraClass}`.trim();
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}
