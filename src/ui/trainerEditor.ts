import { getTrainerFieldConditionsStatus } from "../pokeweb/trainerFieldConditionsModel";
import { attachTrainerFieldInstaller, renderTrainerFieldInstaller } from "./trainerFieldConditions";
import { renderInlineStatus } from "./inlineStatus";
import { publicAsset } from "../assetUrl";
import { BATTLE_TYPES, isGen5Project } from "../pokeweb/constants";
import { enrichTrainerLocations } from "../pokeweb/docGeneratorModel";
import { detectSpecifyTrainerNaturesPatch, specifyTrainerNatures } from "../pokeweb/romPatchModel";
import { readGen5SavePokemon, type Gen5SavePokemon } from "../pokeweb/gen5SaveReader";
import { parseShowdownTeam } from "../pokeweb/testBattleTeam";
import { ensureTrainerSpriteStore, getTrainerClassSpriteImage, hasGen5TrainerSprites } from "../pokeweb/trainerSpriteModel";
import {
  expandTrainerScriptArchive,
  formatTrainerScriptArchiveDetail,
  getTrainerScriptArchiveStatus,
  type TrainerScriptArchiveStatus,
} from "../pokeweb/trainerScriptArchiveModel";
import {
  addTrainer,
  getTrainerAutofills,
  getTrainerCount,
  getTrainerRecord,
  trainerPokemonSpriteSlug,
  type TrainerRecord,
} from "../pokeweb/trainerModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { observeNearViewport } from "./nearViewport";
import { requestEncounterRoll } from "./encounterRollModal";
import { TRAINER_SPRITE_RENDER_VERSION, renderTrainerListRowContent } from "./trainerDetail";
import { attachTrainerDetail, writeClipboardText, type TrainerSelection } from "./trainerInteractions";
import { getPokemonIconImage, type PokemonIconVariant, type RgbaImageData } from "../pokeweb/pokemonSpriteModel";
import "../styles/moveData.css";
import "../styles/trainerData.css";
import "../styles/textData.css";

const TEST_BATTLE_TEAM_STORAGE_PREFIX = "pokeweb.testBattle.teamText";
const TEST_BATTLE_BOX_STORAGE_PREFIX = "pokeweb.testBattle.box";
const trainerEditorState = new WeakMap<ProjectState, TrainerSelection & { testTeamOpen: boolean }>();
const trainerSpriteInstallations = new WeakMap<HTMLElement, { disconnect: () => void }>();
const trainerPokemonIconInstallations = new WeakMap<HTMLElement, { disconnect: () => void }>();

type TrainerBoxPokemon = {
  speciesId: number;
  formIndex: number;
  speciesName: string;
  nickname: string;
  level: number;
  detail: string;
  showdownText: string;
};

export function renderTrainerEditor(
  project: ProjectState,
  root: HTMLElement,
  onDirty?: () => void,
  onTestBattle?: (trainerId: number, showdownText: string) => Promise<void>,
  onOpenTrainerSprite?: (trainerClassId: number) => void,
  onOpenPlayerBackSprite?: () => void,
): void {
  const trainerFieldStatus = getTrainerFieldConditionsStatus(project);
  const trainerNaturePatchStatus = detectSpecifyTrainerNaturesPatch(project);
  const savedTestBattleTeamText = getTrainerTestBattleTeamText(project);
  autoEnrichTrainerLocations(project);

  // Trainer 0 is the game's empty placeholder record.
  const count = getTrainerCount(project);
  const ids = Array.from({ length: Math.max(0, count - (count > 1 ? 1 : 0)) }, (_unused, index) => index + (count > 1 ? 1 : 0));
  const selection = trainerEditorState.get(project) ?? { trainerId: ids[0] ?? 0, slot: 0, testTeamOpen: false };
  if (!ids.includes(selection.trainerId)) selection.trainerId = ids[0] ?? 0;
  trainerEditorState.set(project, selection);

  const records = ids.map((id) => getTrainerRecord(project, id, { includeTexts: false }));
  const classNames = project.texts.banks.tr_classes ?? [];
  const usedClasses = [...new Set(records.map((trainer) => Number(trainer.readable.class_id ?? trainer.raw.class ?? 0)))]
    .sort((a, b) => String(classNames[a] ?? a).localeCompare(String(classNames[b] ?? b)) || a - b);
  const tools = [
    project.session.baseRom === "BW2" ? `<div class="td-tool"><div class="filter-title">Field conditions</div>${renderTrainerFieldInstaller(trainerFieldStatus, true)}</div>` : "",
    renderTrainerNaturePatchPanel(project, trainerNaturePatchStatus),
    renderTrainerScriptArchivePanel(project),
  ].filter(Boolean).join("");

  root.innerHTML = `
    <div class="trainer-data" id="trainer-data">
      <aside class="md-list" aria-label="Trainers">
        <div class="md-filters">
          <input class="md-search" id="search-text" type="search" placeholder="Search trainers, Pokémon, items, dialogue" autocomplete="off" spellcheck="false" aria-label="Search trainers">
          <div class="md-chips td-filter-row">
            <select data-trainer-filter="class" aria-label="Filter by class">
              <option value="">All classes</option>
              ${usedClasses.map((id) => `<option value="${id}">${escapeHtml(String(classNames[id] ?? `Class ${id}`))}</option>`).join("")}
            </select>
            <select data-trainer-filter="battle" aria-label="Filter by battle type">
              <option value="">All battles</option>
              ${BATTLE_TYPES.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="md-rows" id="trainer-list" role="listbox" aria-label="Trainers" tabindex="0">
          ${records.map((trainer) => renderTrainerListRow(project, trainer)).join("")}
        </div>
        ${tools ? `<details class="md-tools"><summary>Tools</summary><div class="td-tools">${tools}</div></details>` : ""}
      </aside>
      <section class="md-detail" id="trainer-detail"></section>
      <aside class="td-drawer" data-test-team-drawer aria-label="Test team"${selection.testTeamOpen ? "" : " hidden"}>
        <div class="td-drawer-head">
          <h2>Test team</h2>
          <button class="btn sm -ghost" type="button" data-test-team-close aria-label="Close test team">×</button>
        </div>
        <p class="td-note">Your side in Test battle. Paste a Showdown team; use Bulbasaur^1 for form 1, and Exp: N to set exact experience instead of Level: N.</p>
        <div class="trainer-test-team">
          <textarea id="test-battle-team-import" class="trainer-test-team-input" spellcheck="false" placeholder="Paste a Showdown team">${escapeHtml(savedTestBattleTeamText)}</textarea>
          ${isGen5Project(project) ? `
            <div class="trainer-save-reader">
              <input id="trainer-save-upload" class="trainer-save-upload" type="file" accept=".sav,.dsv,.srm,application/octet-stream" hidden>
              <div class="trainer-save-actions">
                <label class="btn trainer-save-upload-button" for="trainer-save-upload">Load save</label>
                <button class="btn trainer-roll-encounters-button" type="button" data-roll-encounters>Roll encounters</button>
                <span class="trainer-save-status" aria-live="polite"></span>
              </div>
              <div class="trainer-save-pokemon-box" aria-label="Pokemon from save" hidden></div>
              <button class="btn trainer-box-copy-button" type="button" data-copy-showdown-box hidden>Copy Showdown paste</button>
            </div>
          ` : ""}
        </div>
      </aside>
    </div>
  `;

  const list = root.querySelector<HTMLElement>("#trainer-list")!;
  const detail = root.querySelector<HTMLElement>("#trainer-detail")!;
  const drawer = root.querySelector<HTMLElement>("[data-test-team-drawer]")!;
  const searchInput = root.querySelector<HTMLInputElement>("#search-text")!;
  const classFilter = root.querySelector<HTMLSelectElement>('[data-trainer-filter="class"]')!;
  const battleFilter = root.querySelector<HTMLSelectElement>('[data-trainer-filter="battle"]')!;
  const haystacks = new Map<number, string>();

  const refreshRow = (trainerId: number) => {
    haystacks.delete(trainerId);
    const row = list.querySelector<HTMLElement>(`[data-trainer-row="${trainerId}"]`);
    if (!row) return;
    const template = document.createElement("template");
    template.innerHTML = renderTrainerListRow(project, getTrainerRecord(project, trainerId, { includeTexts: false })).trim();
    const next = template.content.firstElementChild as HTMLElement | null;
    if (!next) return;
    next.classList.toggle("is-selected", row.classList.contains("is-selected"));
    next.setAttribute("aria-selected", row.getAttribute("aria-selected") ?? "false");
    next.style.display = row.style.display;
    row.replaceWith(next);
  };

  const controller = attachTrainerDetail(detail, project, selection, {
    onDirty,
    onTestBattle,
    onOpenTrainerSprite,
    onTrainerChanged: refreshRow,
    getTestTeamText: () => getTrainerTestBattleTeamText(project, root),
    autofills: getTrainerAutofills(project),
    natureField: trainerNaturePatchStatus === "patched",
  });

  const filter = () => {
    const terms = searchInput.value.split(",").map((term) => term.trim().toLowerCase()).filter(Boolean);
    const classId = classFilter.value;
    const battle = battleFilter.value;
    list.querySelectorAll<HTMLElement>("[data-trainer-row]").forEach((row) => {
      const trainerId = Number(row.dataset.trainerRow);
      let show = (!classId || row.dataset.classId === classId) && (!battle || row.dataset.battleType === battle);
      if (show && terms.length) {
        let haystack = haystacks.get(trainerId);
        if (haystack === undefined) {
          haystack = [
            JSON.stringify(getTrainerRecord(project, trainerId)),
            ...(project.docs?.trainerLocations[String(trainerId)] ?? []),
          ].join("\n").toLowerCase();
          haystacks.set(trainerId, haystack);
        }
        show = terms.some((term) => haystack!.includes(term));
      }
      row.style.display = show ? "" : "none";
    });
  };

  const select = (trainerId: number, fromKeyboard = false) => {
    if (selection.trainerId !== trainerId) selection.slot = 0;
    selection.trainerId = trainerId;
    controller.render();
    list.querySelectorAll<HTMLElement>("[data-trainer-row]").forEach((row) => {
      const active = Number(row.dataset.trainerRow) === trainerId;
      row.classList.toggle("is-selected", active);
      row.setAttribute("aria-selected", String(active));
      if (active && fromKeyboard) row.scrollIntoView({ block: "nearest" });
    });
  };

  let searchTimer = 0;
  searchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(filter, 160);
  });
  classFilter.addEventListener("change", filter);
  battleFilter.addEventListener("change", filter);
  list.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-trainer-row]");
    if (row) select(Number(row.dataset.trainerRow));
  });
  list.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const rows = [...list.querySelectorAll<HTMLElement>("[data-trainer-row]")].filter((row) => row.style.display !== "none");
    const index = rows.findIndex((row) => Number(row.dataset.trainerRow) === selection.trainerId);
    const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next) select(Number(next.dataset.trainerRow), true);
  });

  const setTestTeamOpen = (open: boolean) => {
    selection.testTeamOpen = open;
    drawer.hidden = !open;
    document.querySelector<HTMLButtonElement>("#page-actions [data-trainer-team]")?.setAttribute("aria-pressed", String(open));
    if (open) drawer.querySelector<HTMLTextAreaElement>("#test-battle-team-import")?.focus();
  };
  drawer.querySelector("[data-test-team-close]")?.addEventListener("click", () => setTestTeamOpen(false));

  const pageActions = document.getElementById("page-actions");
  if (pageActions) {
    pageActions.innerHTML = `
      <button class="btn" type="button" data-trainer-add title="Clone the selected trainer, its party, name slot and dialogue rows">Add trainer</button>
      <button class="btn" type="button" data-trainer-team aria-pressed="${selection.testTeamOpen}" title="Your side in Test battle">Test team</button>
    `;
    pageActions.querySelector("[data-trainer-team]")?.addEventListener("click", () => setTestTeamOpen(!selection.testTeamOpen));
    pageActions.querySelector("[data-trainer-add]")?.addEventListener("click", () => {
      try {
        const trainer = addTrainer(project, selection.trainerId);
        ids.push(trainer.id);
        list.insertAdjacentHTML("beforeend", renderTrainerListRow(project, trainer));
        onDirty?.();
        filter();
        select(trainer.id, true);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : String(error));
      }
    });
  }

  installTrainerSpriteRendering(project, root);
  installTrainerPokemonIconRendering(project, root);
  installTrainerScriptArchiveControl(project, root, onDirty, onTestBattle, onOpenTrainerSprite, onOpenPlayerBackSprite);
  installTrainerNaturePatchControl(project, root, onDirty, onTestBattle, onOpenTrainerSprite, onOpenPlayerBackSprite, trainerNaturePatchStatus);
  attachTrainerFieldInstaller(project, root, () => {
    onDirty?.();
    renderTrainerEditor(project, root, onDirty, onTestBattle, onOpenTrainerSprite, onOpenPlayerBackSprite);
  });
  installTestBattleTeamPersistence(project, root);
  installTrainerSaveReader(project, root);
  filter();
  select(selection.trainerId, true);
}

export function renderTrainerListRow(project: ProjectState, trainer: TrainerRecord): string {
  return `<div class="md-row td-row" role="option" aria-selected="false" data-trainer-row="${trainer.id}" data-class-id="${Number(trainer.readable.class_id ?? trainer.raw.class ?? 0)}" data-battle-type="${escapeHtml(String(trainer.readable.battle_type_1 ?? ""))}">${renderTrainerListRowContent(project, trainer)}</div>`;
}

function installTestBattleTeamPersistence(project: ProjectState, root: HTMLElement): void {
  const input = root.querySelector<HTMLTextAreaElement>("#test-battle-team-import");
  if (!input) return;
  input.addEventListener("input", () => {
    rememberTestBattleTeamText(project, input.value);
  });
}

function installTrainerSaveReader(project: ProjectState, root: HTMLElement): void {
  const upload = root.querySelector<HTMLInputElement>("#trainer-save-upload");
  const input = root.querySelector<HTMLTextAreaElement>("#test-battle-team-import");
  const status = root.querySelector<HTMLElement>(".trainer-save-status");
  const box = root.querySelector<HTMLElement>(".trainer-save-pokemon-box");
  const rollButton = root.querySelector<HTMLButtonElement>("[data-roll-encounters]");
  const copyShowdownButton = root.querySelector<HTMLButtonElement>("[data-copy-showdown-box]");
  if (!upload || !input || !status || !box) return;

  let currentBox = readSavedTrainerBox(project);
  if (currentBox.length > 0) {
    renderTrainerPokemonBox(project, box, input, currentBox);
    box.hidden = false;
    if (copyShowdownButton) copyShowdownButton.hidden = false;
    status.textContent = `${currentBox.length} Pokémon`;
  }

  upload.addEventListener("click", () => {
    upload.value = "";
  });
  upload.addEventListener("change", async () => {
    const file = upload.files?.[0];
    if (!file) return;
    status.classList.remove("-error");
    status.textContent = "Reading…";
    try {
      const pokemon = readGen5SavePokemon(project, new Uint8Array(await file.arrayBuffer()));
      const boxPokemon = pokemon.map(savePokemonForBox);
      currentBox = boxPokemon;
      rememberTrainerBox(project, boxPokemon);
      renderTrainerPokemonBox(project, box, input, boxPokemon);
      status.textContent = `${pokemon.length} Pokémon`;
      box.hidden = pokemon.length === 0;
      if (copyShowdownButton) copyShowdownButton.hidden = pokemon.length === 0;
      if (pokemon.length === 0) {
        status.classList.add("-error");
        status.textContent = "No Pokémon found";
      }
    } catch (error) {
      box.hidden = true;
      box.replaceChildren();
      if (copyShowdownButton) copyShowdownButton.hidden = true;
      status.classList.add("-error");
      status.textContent = error instanceof Error ? error.message : "Could not read save";
    }
  });

  rollButton?.addEventListener("click", () => {
    requestEncounterRoll(project, ({ encounters, statics }) => {
      const boxPokemon: TrainerBoxPokemon[] = [
        ...encounters.map((rolled) => ({
          speciesId: rolled.speciesId,
          formIndex: rolled.formIndex,
          speciesName: rolled.speciesName,
          nickname: "",
          level: rolled.level,
          detail: `${rolled.areaLabel} · ${rolled.tableLabel}`,
          showdownText: rolled.showdownText,
        })),
        ...statics.map((pokemon) => ({
          speciesId: pokemon.speciesId,
          formIndex: pokemon.formIndex,
          speciesName: pokemon.speciesName,
          nickname: "",
          level: pokemon.level,
          detail: "Static",
          showdownText: pokemon.showdownText,
        })),
      ];
      currentBox = boxPokemon;
      rememberTrainerBox(project, boxPokemon);
      renderTrainerPokemonBox(project, box, input, boxPokemon);
      box.hidden = boxPokemon.length === 0;
      if (copyShowdownButton) copyShowdownButton.hidden = boxPokemon.length === 0;
      status.classList.toggle("-error", boxPokemon.length === 0);
      status.textContent = boxPokemon.length > 0 ? `${boxPokemon.length} Pokémon` : "No Pokémon added";
    });
  });

  copyShowdownButton?.addEventListener("click", async () => {
    const showdownText = currentBox
      .map((pokemon) => pokemon.showdownText.trim())
      .filter(Boolean)
      .join("\n\n");
    if (!showdownText) return;
    try {
      await writeClipboardText(showdownText);
      status.classList.remove("-error");
      status.textContent = `Copied ${currentBox.length} Pokémon`;
    } catch (error) {
      status.classList.add("-error");
      status.textContent = error instanceof Error ? error.message : "Could not copy box";
    }
  });

  input.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types.includes("application/x-pokeweb-showdown")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    input.classList.add("-save-drop-target");
  });
  input.addEventListener("dragleave", () => input.classList.remove("-save-drop-target"));
  input.addEventListener("drop", (event) => {
    const showdownText = event.dataTransfer?.getData("application/x-pokeweb-showdown") ?? "";
    input.classList.remove("-save-drop-target");
    if (!showdownText) return;
    event.preventDefault();
    appendShowdownPokemon(input, showdownText);
  });
  input.addEventListener("input", () => syncTrainerBoxActiveState(project, box, input.value));
}

function renderTrainerPokemonBox(project: ProjectState, box: HTMLElement, input: HTMLTextAreaElement, pokemon: TrainerBoxPokemon[]): void {
  const fragment = document.createDocumentFragment();
  const fallbackSrc = publicAsset("images/pokesprite/-.png");
  pokemon.forEach((boxPokemon) => {
    const displayName = boxPokemon.nickname || boxPokemon.speciesName;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "trainer-save-pokemon";
    button.draggable = true;
    button.dataset.speciesId = String(boxPokemon.speciesId);
    button.title = `${displayName} · ${boxPokemon.speciesName} · Lv. ${boxPokemon.level} · ${boxPokemon.detail}\nDrag or click to toggle in Test Team`;
    button.setAttribute("aria-label", `Toggle ${displayName} in Test Team`);

    const image = document.createElement("img");
    image.alt = "";
    image.draggable = false;
    image.loading = "lazy";
    image.src = publicAsset(`images/pokesprite/${trainerPokemonSpriteSlug(boxPokemon.speciesName, boxPokemon.formIndex)}.png`);
    image.addEventListener("error", () => {
      image.src = fallbackSrc;
    }, { once: true });
    button.append(image);

    button.addEventListener("dragstart", (event) => {
      if (!event.dataTransfer) return;
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("application/x-pokeweb-showdown", boxPokemon.showdownText);
      event.dataTransfer.setData("text/plain", boxPokemon.showdownText);
      button.classList.add("-dragging");
    });
    button.addEventListener("dragend", () => button.classList.remove("-dragging"));
    button.addEventListener("click", () => {
      if (button.classList.contains("-active")) removeShowdownSpecies(project, input, boxPokemon.speciesId);
      else appendShowdownPokemon(input, boxPokemon.showdownText);
    });
    fragment.append(button);
  });
  box.replaceChildren(fragment);
  syncTrainerBoxActiveState(project, box, input.value);
}

function savePokemonForBox(savedPokemon: Gen5SavePokemon): TrainerBoxPokemon {
  return {
    speciesId: savedPokemon.speciesId,
    formIndex: savedPokemon.formIndex,
    speciesName: savedPokemon.speciesName,
    nickname: savedPokemon.nickname,
    level: savedPokemon.level,
    detail: savedPokemon.storage === "party"
      ? `Party ${Number(savedPokemon.partySlot ?? 0) + 1}`
      : `Box ${Number(savedPokemon.box ?? 0) + 1}, slot ${Number(savedPokemon.boxSlot ?? 0) + 1}`,
    showdownText: savedPokemon.showdownText,
  };
}

function appendShowdownPokemon(input: HTMLTextAreaElement, showdownText: string): void {
  const pokemon = showdownText.trim();
  if (!pokemon) return;
  const existing = input.value.trimEnd();
  input.value = existing ? `${existing}\n\n${pokemon}` : pokemon;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function removeShowdownSpecies(project: ProjectState, input: HTMLTextAreaElement, speciesId: number): void {
  input.value = showdownBlocks(input.value)
    .filter((block) => showdownBlockSpeciesId(project, block) !== speciesId)
    .join("\n\n");
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function syncTrainerBoxActiveState(project: ProjectState, box: HTMLElement, showdownText: string): void {
  const activeSpecies = new Set(
    showdownBlocks(showdownText)
      .map((block) => showdownBlockSpeciesId(project, block))
      .filter((speciesId): speciesId is number => speciesId !== undefined),
  );
  box.querySelectorAll<HTMLElement>(".trainer-save-pokemon[data-species-id]").forEach((button) => {
    const active = activeSpecies.has(Number(button.dataset.speciesId));
    button.classList.toggle("-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function showdownBlockSpeciesId(project: ProjectState, block: string): number | undefined {
  try {
    return parseShowdownTeam(project, block)[0]?.speciesId;
  } catch {
    return undefined;
  }
}

function showdownBlocks(text: string): string[] {
  return text
    .replace(/\r\n?/gu, "\n")
    .split(/\n\s*\n/gu)
    .map((block) => block.trim())
    .filter(Boolean);
}

function readSavedTrainerBox(project: ProjectState): TrainerBoxPokemon[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(testBattleBoxStorageKey(project)) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(isSavedTrainerBoxPokemon);
  } catch {
    return [];
  }
}

function rememberTrainerBox(project: ProjectState, pokemon: TrainerBoxPokemon[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(testBattleBoxStorageKey(project), JSON.stringify(pokemon));
  } catch {
    // Browser storage may be unavailable in private or constrained contexts.
  }
}

function isSavedTrainerBoxPokemon(value: unknown): value is TrainerBoxPokemon {
  if (!value || typeof value !== "object") return false;
  const pokemon = value as Partial<TrainerBoxPokemon>;
  return Number.isInteger(pokemon.speciesId)
    && Number(pokemon.speciesId) > 0
    && Number.isInteger(pokemon.formIndex)
    && Number.isInteger(pokemon.level)
    && typeof pokemon.speciesName === "string"
    && typeof pokemon.nickname === "string"
    && typeof pokemon.detail === "string"
    && typeof pokemon.showdownText === "string";
}

function testBattleBoxStorageKey(project: ProjectState): string {
  return `${TEST_BATTLE_BOX_STORAGE_PREFIX}.${project.session.baseVersion}.${project.session.romName}`;
}

export function getTrainerTestBattleTeamText(project: ProjectState, root?: ParentNode): string {
  const input = root?.querySelector<HTMLTextAreaElement>("#test-battle-team-import");
  if (input) return input.value;
  if (typeof localStorage === "undefined") return "";
  try {
    return localStorage.getItem(testBattleTeamStorageKey(project)) ?? "";
  } catch {
    return "";
  }
}

function rememberTestBattleTeamText(project: ProjectState, text: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(testBattleTeamStorageKey(project), text);
  } catch {
    // Browser storage may be unavailable in private or constrained contexts.
  }
}

function testBattleTeamStorageKey(project: ProjectState): string {
  return `${TEST_BATTLE_TEAM_STORAGE_PREFIX}.${project.session.baseVersion}.${project.session.romName}`;
}

/** Inputs of the last enrichment; scanning every overworld and script takes ~0.5 s. */
const trainerLocationSignatures = new WeakMap<ProjectState, string>();

function trainerLocationSignature(project: ProjectState): string {
  const stores = Object.entries(project.narcs)
    .map(([name, store]) => `${name}:${store?.revision ?? 0}:${store?.fileCount ?? 0}`)
    .sort()
    .join(",");
  const overlays = Object.entries(project.overlays ?? {}).map(([id, bytes]) => `${id}:${bytes?.length ?? 0}`).join(",");
  return `${stores}|${overlays}`;
}

function autoEnrichTrainerLocations(project: ProjectState): void {
  if (!isGen5Project(project) || !project.narcs.headers || !project.narcs.overworlds) return;
  const signature = trainerLocationSignature(project);
  if (project.docs?.trainerLocations && trainerLocationSignatures.get(project) === signature) return;
  try {
    enrichTrainerLocations(project);
    trainerLocationSignatures.set(project, signature);
  } catch (error) {
    console.warn("Failed to enrich trainer locations", error);
  }
}

export function stopTrainerImageRendering(root: HTMLElement): void {
  trainerSpriteInstallations.get(root)?.disconnect();
  trainerPokemonIconInstallations.get(root)?.disconnect();
  trainerSpriteInstallations.delete(root);
  trainerPokemonIconInstallations.delete(root);
}

export function installTrainerSpriteRendering(project: ProjectState, root: HTMLElement): void {
  trainerSpriteInstallations.get(root)?.disconnect();
  if (!hasGen5TrainerSprites(project)) return;

  let storePromise: Promise<boolean> | undefined;
  const imageCache = new Map<number, Promise<RgbaImageData | undefined>>();
  const loadImage = (trainerClassId: number): Promise<RgbaImageData | undefined> => {
    let cached = imageCache.get(trainerClassId);
    if (!cached) {
      cached = (async () => {
        storePromise ??= ensureTrainerSpriteStore(project);
        if (!(await storePromise)) return undefined;
        return getTrainerClassSpriteImage(project, trainerClassId);
      })().catch((error) => {
        console.warn(`Failed to render trainer class sprite ${trainerClassId}`, error);
        return undefined;
      });
      imageCache.set(trainerClassId, cached);
    }
    return cached;
  };

  const renderCanvas = async (canvas: HTMLCanvasElement): Promise<void> => {
    if (
      (canvas.dataset.trainerSpriteRendered === "true" && canvas.dataset.trainerSpriteVersion === TRAINER_SPRITE_RENDER_VERSION) ||
      canvas.dataset.trainerSpriteRendered === "loading"
    ) {
      return;
    }
    const trainerClassId = Number(canvas.dataset.trainerClassId);
    if (!Number.isInteger(trainerClassId)) return;
    canvas.dataset.trainerSpriteVersion = TRAINER_SPRITE_RENDER_VERSION;
    canvas.dataset.trainerSpriteRendered = "loading";
    const image = await loadImage(trainerClassId);
    if (!canvas.isConnected) return;
    if (!image) {
      canvas.hidden = true;
      canvas.dataset.trainerSpriteRendered = "missing";
      return;
    }
    canvas.width = image.width;
    canvas.height = image.height;
    const pixels = new Uint8ClampedArray(image.pixels.length);
    pixels.set(image.pixels);
    canvas.getContext("2d")?.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
    canvas.classList.add("-loaded");
    canvas.dataset.trainerSpriteRendered = "true";
  };

  trainerSpriteInstallations.set(root, {
    disconnect: observeNearViewport(root, "canvas.trainer-rom-sprite", (canvas) => void renderCanvas(canvas as HTMLCanvasElement)),
  });
}

function installTrainerPokemonIconRendering(project: ProjectState, root: HTMLElement): void {
  trainerPokemonIconInstallations.get(root)?.disconnect();

  const imageCache = new Map<string, Promise<RgbaImageData | undefined>>();
  const loadImage = (spriteId: number, variant: PokemonIconVariant): Promise<RgbaImageData | undefined> => {
    const cacheKey = `${spriteId}:${variant}`;
    let cached = imageCache.get(cacheKey);
    if (!cached) {
      cached = Promise.resolve()
        .then(() => getPokemonIconImage(project, spriteId, variant))
        .catch((error) => {
          console.warn(`Failed to render Pokemon icon ${spriteId}:${variant}`, error);
          return undefined;
        });
      imageCache.set(cacheKey, cached);
    }
    return cached;
  };

  const renderCanvas = async (canvas: HTMLCanvasElement): Promise<void> => {
    if (canvas.dataset.trainerPokemonIconRendered === "true" || canvas.dataset.trainerPokemonIconRendered === "loading") return;
    const spriteId = Number(canvas.dataset.trainerPokemonSpriteId);
    const variant = canvas.dataset.trainerPokemonIconVariant as PokemonIconVariant | undefined;
    if (!Number.isInteger(spriteId) || (variant !== "male" && variant !== "female")) return;
    canvas.dataset.trainerPokemonIconRendered = "loading";
    const image = await loadImage(spriteId, variant);
    if (!canvas.isConnected) return;
    if (!image) {
      canvas.dataset.trainerPokemonIconRendered = "missing";
      return;
    }

    const frameHeight = Math.min(image.width, image.height);
    const pixels = image.pixels.slice(0, image.width * frameHeight * 4);
    canvas.width = image.width;
    canvas.height = frameHeight;
    canvas.getContext("2d")?.putImageData(new ImageData(pixels, image.width, frameHeight), 0, 0);
    canvas.hidden = false;
    canvas.classList.add("-loaded");
    canvas.dataset.trainerPokemonIconRendered = "true";
  };

  const renderPreview = async (preview: HTMLElement): Promise<void> => {
    const canvas = preview.querySelector<HTMLCanvasElement>("canvas.trainer-pokemon-rom-icon");
    if (canvas) {
      await renderCanvas(canvas);
      if (canvas.dataset.trainerPokemonIconRendered === "true") return;
    }
    const fallback = preview.querySelector<HTMLImageElement>("img[data-trainer-image-src]");
    if (!fallback?.isConnected) return;
    fallback.src = fallback.dataset.trainerImageSrc!;
    delete fallback.dataset.trainerImageSrc;
  };

  trainerPokemonIconInstallations.set(root, {
    // Observe the visible cell, not its initially hidden ROM canvas. Fallback
    // images get a URL only when needed and near the viewport.
    disconnect: observeNearViewport(root, ".trainer-poks .wild", (preview) => void renderPreview(preview)),
  });
}

function renderTrainerScriptArchivePanel(project: ProjectState): string {
  const status = getTrainerScriptArchiveStatus(project);
  if (!status.ok && status.reason === "unsupported") return "";
  const disabled = status.ok && status.canExpand ? "" : "disabled";
  return `
    <div class="trainer-script-panel">
      <div class="filter-title">Global scripts</div>
      <div class="trainer-script-status">
        ${renderInlineStatus(trainerScriptArchiveStatusLabel(status), { className: "patch-badge" })}
        <span>${status.ok ? `file ${status.scriptFileId}` : escapeHtml(project.session.baseVersion)}</span>
      </div>
      <div class="trainer-script-detail">${escapeHtml(formatTrainerScriptArchiveDetail(status))}</div>
      <button class="btn -default trainer-script-expand-btn" id="trainer-script-expand-btn" type="button" ${disabled}>Expand global scripts</button>
    </div>
  `;
}

function renderTrainerNaturePatchPanel(project: ProjectState, status: ReturnType<typeof detectSpecifyTrainerNaturesPatch>): string {
  if (status === "unsupported") return "";
  const buttonDisabled = status === "patched" ? "disabled" : "";
  return `
    <div class="trainer-nature-patch-panel">
      <div class="filter-title">Trainer natures</div>
      <div class="trainer-nature-patch-status">
        ${renderInlineStatus(trainerNatureStatusLabel(status), { className: "patch-badge" })}
        <span>${escapeHtml(project.session.baseVersion)}</span>
      </div>
      <button class="btn -default trainer-nature-patch-btn" id="trainer-nature-patch-btn" type="button" ${buttonDisabled}>${escapeHtml(trainerNatureButtonLabel(status))}</button>
    </div>
  `;
}

function installTrainerScriptArchiveControl(
  project: ProjectState,
  root: HTMLElement,
  onDirty: (() => void) | undefined,
  onTestBattle: ((trainerId: number, showdownText: string) => Promise<void>) | undefined,
  onOpenTrainerSprite: ((trainerClassId: number) => void) | undefined,
  onOpenPlayerBackSprite?: () => void,
): void {
  const status = getTrainerScriptArchiveStatus(project);
  const button = root.querySelector<HTMLButtonElement>("#trainer-script-expand-btn");
  if (!button || !status.ok || !status.canExpand) return;
  button.addEventListener("click", () => {
    const previousText = button.textContent ?? "Expand global scripts";
    button.disabled = true;
    button.textContent = "Expanding...";
    try {
      const result = expandTrainerScriptArchive(project);
      if (result.addedEntries > 0) onDirty?.();
      renderTrainerEditor(project, root, onDirty, onTestBattle, onOpenTrainerSprite, onOpenPlayerBackSprite);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
      button.disabled = false;
      button.textContent = previousText;
    }
  });
}

function installTrainerNaturePatchControl(
  project: ProjectState,
  root: HTMLElement,
  onDirty: (() => void) | undefined,
  onTestBattle: ((trainerId: number, showdownText: string) => Promise<void>) | undefined,
  onOpenTrainerSprite: ((trainerClassId: number) => void) | undefined,
  onOpenPlayerBackSprite: (() => void) | undefined,
  status: ReturnType<typeof detectSpecifyTrainerNaturesPatch>,
): void {
  const button = root.querySelector<HTMLButtonElement>("#trainer-nature-patch-btn");
  if (!button || status === "patched") return;
  button.addEventListener("click", async () => {
    if (!window.confirm("Install the PMC trainer nature runtime? Existing inline trainer nature hooks will be migrated.\n\nExport the ROM after applying to keep this change.")) return;
    const previousText = button.textContent ?? trainerNatureButtonLabel(status);
    button.disabled = true;
    button.textContent = "Applying...";
    try {
      const result = await specifyTrainerNatures(project);
      if (result.status === "applied") onDirty?.();
      renderTrainerEditor(project, root, onDirty, onTestBattle, onOpenTrainerSprite, onOpenPlayerBackSprite);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
      button.disabled = false;
      button.textContent = previousText;
    }
  });
}

function trainerScriptArchiveStatusLabel(status: TrainerScriptArchiveStatus): string {
  if (!status.ok) {
    if (status.reason === "missing") return "Missing";
    if (status.reason === "unrecognized") return "Unknown";
    return "Unsupported";
  }
  if (status.outOfRangeTrainerIds.length) return "Range limit";
  if (status.needsExpansion) return "Needs sync";
  if (status.helperTrainerIds.length) return "Helper slots";
  return "Ready";
}


function trainerNatureStatusLabel(status: ReturnType<typeof detectSpecifyTrainerNaturesPatch>): string {
  if (status === "patched") return "Applied";
  if (status === "legacy") return "Migration available";
  if (status === "unknown") return "Signature unknown";
  if (status === "unsupported") return "Unsupported";
  return "Ready";
}

function trainerNatureButtonLabel(status: ReturnType<typeof detectSpecifyTrainerNaturesPatch>): string {
  if (status === "patched") return "Applied";
  if (status === "legacy") return "Migrate patch";
  return "Apply patch";
}

