import addIcon from "../assets/svgs/add.svg?raw";
import { publicAsset } from "../assetUrl";
import { trainerAbilitySlotMax } from "../pokeweb/cascadeWhiteModel";
import { TRAINER_AIS, isGen5Project } from "../pokeweb/constants";
import { enrichTrainerLocations } from "../pokeweb/docGeneratorModel";
import { detectSpecifyTrainerNaturesPatch, specifyTrainerNatures } from "../pokeweb/romPatchModel";
import { ensureTrainerSpriteStore, getTrainerClassSpriteImage, hasGen5TrainerSprites } from "../pokeweb/trainerSpriteModel";
import {
  expandTrainerScriptArchive,
  formatTrainerScriptArchiveDetail,
  getTrainerScriptArchiveStatus,
  type TrainerScriptArchiveStatus,
} from "../pokeweb/trainerScriptArchiveModel";
import {
  getTrainerAutofills,
  getTrainerCount,
  getTrainerRecord,
  type TrainerPokemonSlot,
  type TrainerRecord,
} from "../pokeweb/trainerModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { attachTrainerInteractions } from "./trainerInteractions";
import { attachW2uSyncButton, renderW2uSyncButton } from "./w2uLocalSync";
import {
  genderedPokemonIcons,
  getPokemonIconImage,
  resolvePokemonSpriteId,
  type PokemonIconVariant,
  type RgbaImageData,
} from "../pokeweb/pokemonSpriteModel";

const TEST_BATTLE_TEAM_STORAGE_PREFIX = "pokeweb.testBattle.teamText";
const TRAINER_SPRITE_RENDER_VERSION = "gen5-mcss-ncec-v2";
const trainerSpriteInstallations = new WeakMap<HTMLElement, { disconnect: () => void }>();
const trainerPokemonIconInstallations = new WeakMap<HTMLElement, { disconnect: () => void }>();

export function renderTrainerEditor(
  project: ProjectState,
  root: HTMLElement,
  onDirty?: () => void,
  onTestBattle?: (trainerId: number, showdownText: string) => Promise<void>,
  onOpenTrainerSprite?: (trainerClassId: number) => void,
): void {
  const trainerNaturePatchStatus = detectSpecifyTrainerNaturesPatch(project);
  const showNatureField = trainerNaturePatchStatus === "patched";
  const savedTestBattleTeamText = readSavedTestBattleTeamText(project);
  const enrichedTrainerLocations = autoEnrichTrainerLocations(project);
  root.innerHTML = `
    <div class="pokemon-filter trainer-filter">
      <div class="filter-title">Search</div>
      <input class="filter-input" id="search-text"/>
      <button class="btn -default" id="search-text-btn" type="button">Search</button>
      <button class="btn -default trainer-add-button" id="add-trainer-btn" type="button" title="Clone the selected trainer, party, name slot, and dialogue table rows">
        <span class="svg">${addIcon}</span>
        Add Trainer
      </button>
      ${renderW2uSyncButton(project, ["trainers"])}
      ${renderTrainerScriptArchivePanel(project)}
      ${renderTrainerNaturePatchPanel(project, trainerNaturePatchStatus)}
      <div class="trainer-test-team">
        <div class="filter-title">Test Team</div>
        <textarea id="test-battle-team-import" class="trainer-test-team-input" spellcheck="false" placeholder="Paste Showdown team import">${escapeHtml(savedTestBattleTeamText)}</textarea>
      </div>
    </div>
    <div class="pokemon-list spreadsheet" id="trainers">
      <div class="expanded-field field-header">
        <div class="expanded-field-main">
          <div class="trainer-id">ID</div>
          <div class="trainer-name">Name</div>
          <div class="trainer-class">Class</div>
          <div class="trainer-btype">Battle Type</div>
          <div class="trainer-moves">Moves</div>
          <div class="trainer-items">Items</div>
          <div class="trainer-poks">Pokemon</div>
        </div>
      </div>
      ${renderTrainerRows(project, showNatureField)}
    </div>
  `;

  if (enrichedTrainerLocations) onDirty?.();
  installTrainerSpriteRendering(project, root);
  installTrainerPokemonIconRendering(project, root);
  installTrainerScriptArchiveControl(project, root, onDirty, onTestBattle, onOpenTrainerSprite);
  installTrainerNaturePatchControl(project, root, onDirty, onTestBattle, onOpenTrainerSprite, trainerNaturePatchStatus);
  attachTrainerInteractions(root, project, {
    onDirty,
    onTestBattle,
    onOpenTrainerSprite,
    autofills: getTrainerAutofills(project),
    renderRow: (trainerId) => renderTrainerRow(project, trainerId),
  });
  attachW2uSyncButton(root, project);
  installTestBattleTeamPersistence(project, root);
}

function installTestBattleTeamPersistence(project: ProjectState, root: HTMLElement): void {
  const input = root.querySelector<HTMLTextAreaElement>("#test-battle-team-import");
  if (!input) return;
  input.addEventListener("input", () => {
    rememberTestBattleTeamText(project, input.value);
  });
}

function readSavedTestBattleTeamText(project: ProjectState): string {
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

export function renderTrainerRow(project: ProjectState, trainerId: number): string {
  return renderTrainerCard(project, getTrainerRecord(project, trainerId), detectSpecifyTrainerNaturesPatch(project) === "patched");
}

function renderTrainerRows(project: ProjectState, showNatureField: boolean): string {
  const rows: string[] = [];
  for (let trainerId = 0; trainerId < getTrainerCount(project); trainerId += 1) rows.push(renderTrainerCard(project, getTrainerRecord(project, trainerId), showNatureField));
  return rows.join("");
}

function renderTrainerCard(project: ProjectState, trainer: TrainerRecord, showNatureField: boolean): string {
  const trainerName = String(trainer.readable.name ?? `Trainer ${trainer.id}`);
  const location = trainerLocationLabel(project, trainer.id);
  const trainerNameLabel = location ? `${trainerName} - ${location}` : trainerName;
  return `
    <div class="expanded-field filterable trainer-card" data-index="${trainer.id}">
      <div class="expanded-field-main">
        <div class="trainer-id">${trainer.id}</div>
        <button class="field-btn test-battle-btn trainer-row-test-btn" type="button">Test</button>
        <div class="trainer-name">
          ${renderTrainerSprite(project, trainer)}
          <span>${escapeHtml(trainerNameLabel)}</span>
        </div>
        ${editable("trdata", "class", `${trainer.readable.class ?? ""} (${trainer.readable.class_id ?? trainer.raw.class ?? 0})`, "trainer-class", { autofill: "class_names" })}
        ${editable("trdata", "battle_type_1", trainer.readable.battle_type_1, "trainer-btype", { autofill: "battle_types" })}
        <div class="trainer-moves">${checkbox("has_moves", trainer.hasMoves)}</div>
        <div class="trainer-items">
          <div class="add-trpok svg" data-narc="trpok" title="Add Pokemon">${addIcon}</div>
          ${checkbox("has_items", trainer.hasItems)}
        </div>
        <div class="trainer-poks">
          ${trainer.party.map((pok) => renderPartyPreview(project, pok)).join("")}
        </div>
      </div>
      ${renderExpandedTrainer(trainer)}
      ${trainer.party.map((pok) => renderTrainerPokemon(project, trainer, pok, showNatureField)).join("")}
    </div>
  `;
}

function autoEnrichTrainerLocations(project: ProjectState): boolean {
  if (!isGen5Project(project) || !project.narcs.headers || !project.narcs.overworlds) return false;
  const before = JSON.stringify([project.docs?.trainerLocations ?? {}, project.docs?.trainerDiffs ?? {}]);
  try {
    enrichTrainerLocations(project);
  } catch (error) {
    console.warn("Failed to enrich trainer locations", error);
    return false;
  }
  const after = JSON.stringify([project.docs?.trainerLocations ?? {}, project.docs?.trainerDiffs ?? {}]);
  return before !== after;
}

function trainerLocationLabel(project: ProjectState, trainerId: number): string {
  return project.docs?.trainerLocations[String(trainerId)]?.[0] ?? "";
}

function renderTrainerSprite(project: ProjectState, trainer: TrainerRecord): string {
  if (!hasGen5TrainerSprites(project)) return `<img src="${trainer.spritePath}" alt="" onerror="this.style.display='none'">`;
  const trainerClassId = Number(trainer.readable.class_id ?? trainer.raw.class ?? 0);
  const className = String(trainer.readable.class ?? `Trainer class ${trainerClassId}`);
  return `
    <button class="trainer-rom-sprite-link" type="button" data-trainer-class-id="${trainerClassId}" title="Edit ${escapeHtml(className)} sprite" aria-label="Edit ${escapeHtml(className)} sprite">
      <canvas class="trainer-rom-sprite" data-trainer-class-id="${trainerClassId}" data-trainer-sprite-version="${TRAINER_SPRITE_RENDER_VERSION}" width="96" height="96" aria-hidden="true"></canvas>
    </button>
  `;
}

function installTrainerSpriteRendering(project: ProjectState, root: HTMLElement): void {
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

  const intersectionObserver =
    typeof IntersectionObserver === "undefined"
      ? undefined
      : new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const canvas = entry.target as HTMLCanvasElement;
            intersectionObserver?.unobserve(canvas);
            void renderCanvas(canvas);
          }
        });

  const observeCanvas = (canvas: HTMLCanvasElement): void => {
    if (canvas.dataset.trainerSpriteObserved === "true") return;
    canvas.dataset.trainerSpriteObserved = "true";
    if (intersectionObserver) intersectionObserver.observe(canvas);
    else void renderCanvas(canvas);
  };

  const scan = (): void => {
    root.querySelectorAll<HTMLCanvasElement>("canvas.trainer-rom-sprite").forEach(observeCanvas);
  };

  const mutationObserver = new MutationObserver(scan);
  mutationObserver.observe(root, { childList: true, subtree: true });
  scan();

  trainerSpriteInstallations.set(root, {
    disconnect: () => {
      intersectionObserver?.disconnect();
      mutationObserver.disconnect();
    },
  });
}

function installTrainerPokemonIconRendering(project: ProjectState, root: HTMLElement): void {
  trainerPokemonIconInstallations.get(root)?.disconnect();
  if (!isGen5Project(project) || !project.narcs.pokemon_icons) return;

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

  const intersectionObserver =
    typeof IntersectionObserver === "undefined"
      ? undefined
      : new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const canvas = entry.target as HTMLCanvasElement;
            intersectionObserver?.unobserve(canvas);
            void renderCanvas(canvas);
          }
        });

  const observeCanvas = (canvas: HTMLCanvasElement): void => {
    if (canvas.dataset.trainerPokemonIconObserved === "true") return;
    canvas.dataset.trainerPokemonIconObserved = "true";
    if (intersectionObserver) intersectionObserver.observe(canvas);
    else void renderCanvas(canvas);
  };

  const scan = (): void => {
    root.querySelectorAll<HTMLCanvasElement>("canvas.trainer-pokemon-rom-icon").forEach(observeCanvas);
  };

  const mutationObserver = new MutationObserver(scan);
  mutationObserver.observe(root, { childList: true, subtree: true });
  scan();

  trainerPokemonIconInstallations.set(root, {
    disconnect: () => {
      intersectionObserver?.disconnect();
      mutationObserver.disconnect();
    },
  });
}

function renderExpandedTrainer(trainer: TrainerRecord): string {
  return `
    <div class="expanded-card-content expanded-trainer">
      <div class="expanded-left">
        ${[1, 2, 3, 4]
          .map((n) => expandedField(`Item ${n}`, editable("trdata", `item_${n}`, trainer.readable[`item_${n}`], "tr-item", { autofill: "items" })))
          .join("")}
        ${trainer.texts.length ? `<div class="show-bottom">Texts</div>` : ""}
      </div>
      <div class="expanded-left">
        ${expandedField("Money", editable("trdata", "money", trainer.readable.money, "tr-item", { type: "int-255" }))}
        ${expandedField("Reward", editable("trdata", "reward_item", trainer.readable.reward_item, "tr-item", { autofill: "items" }))}
        ${expandedField("Heal?", editable("trdata", "heal", trainer.readable.heal, "tr-item", { type: "int-1" }))}
      </div>
      <div class="expanded-right trainer-ai" data-narc="trdata">
        ${TRAINER_AIS.map((ai) => `<div class="choosable-text choosable-prop ${Number(trainer.readable[ai]) > 0 ? "-active" : ""}" data-field-name="${escapeHtml(ai)}" title="Right click to set for all trainers">${escapeHtml(ai)}</div>`).join("")}
      </div>
      ${renderTrainerTexts(trainer)}
    </div>
  `;
}

function renderTrainerTexts(trainer: TrainerRecord): string {
  if (trainer.texts.length === 0) return "";
  return `
    <div class="expanded-bottom trainer-texts">
      ${trainer.texts
        .map(
          (line) => `
            <div class="expanded-field">
              <div class="expanded-field-main">
                <div class="msg-id">${escapeHtml(`${line.label}${line.bankIndex === undefined ? "" : ` (${line.bankIndex})`}`)}</div>
                ${editable("trtext", `text_${line.typeId}_entry_${line.entryIndex}`, line.value, `log-text no-validate empty-text ${line.exists ? "" : "-empty"}`)}
                ${line.exists ? `<button class="field-btn del-btn delete-trtext" type="button" data-type-id="${line.typeId}" title="Delete trainer text row">Delete</button>` : ""}
              </div>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderTrainerPokemon(project: ProjectState, trainer: TrainerRecord, pok: TrainerPokemonSlot, showNatureField: boolean): string {
  return `
    <div data-sub-index="${pok.slot}" class="expanded-card-subcontent expanded-pok expanded-pok-${pok.slot}">
      <div class="expanded-left">
        ${expandedField("Species", editable("trpok", `species_id_${pok.slot}`, pok.speciesName, "tr-item trpok-name", { autofill: "pokemon_names" }))}
        ${expandedField("Level", editable("trpok", `level_${pok.slot}`, pok.level, "tr-item trpok-lvl", { type: "int-100" }))}
        ${expandedField(`Ability Slot (${pok.abilityName})`, editable("trpok", `ability_${pok.slot}`, pok.abilitySlot, "tr-item", { type: `int-${trainerAbilitySlotMax(project)}` }))}
        ${expandedField("Gender", editable("trpok", `gender_${pok.slot}`, pok.gender, "tr-item", { autofill: "genders" }))}
        ${expandedField(`IVs: (${pok.nature})`, editable("trpok", `ivs_${pok.slot}`, pok.ivs, "tr-item", { type: "int-255" }), "iv-label")}
        ${showNatureField ? expandedField("Nature", editable("trpok", `nature_${pok.slot}`, pok.natureSetting, "tr-item", { autofill: "natures" })) : ""}
        ${expandedField("Form", editable("trpok", `form_${pok.slot}`, pok.form, "tr-item", { type: "int-255" }))}
      </div>
      <div class="expanded-left">
        ${expandedField("Held Item", editable("trpok", `item_id_${pok.slot}`, trainer.hasItems ? pok.itemName : "", "tr-item", { autofill: "items", check: "has-items" }))}
        ${[1, 2, 3, 4].map((move) => expandedField(`Move ${move}`, editable("trpok", `move_${move}_${pok.slot}`, trainer.hasMoves ? pok.moves[move - 1] : "", "tr-item trpok-mov", { autofill: "move_names", check: "has-moves" }))).join("")}
        <div class="expanded-field btn-field-right multi">
          <div class="autofill-btn field-btn" data-narc="trpok">Autofill Moves</div>
          <div class="copy-showdown-btn field-btn" data-narc="trpok">Copy</div>
          <button class="import-showdown-btn field-btn" type="button" data-narc="trpok">Import</button>
          <div class="delete-trpok del-btn field-btn" data-narc="trpok">Delete</div>
        </div>
      </div>
    </div>
  `;
}

function renderTrainerScriptArchivePanel(project: ProjectState): string {
  const status = getTrainerScriptArchiveStatus(project);
  if (!status.ok && status.reason === "unsupported") return "";
  const badgeClass = trainerScriptArchiveBadgeClass(status);
  const disabled = status.ok && status.canExpand ? "" : "disabled";
  return `
    <div class="trainer-script-panel">
      <div class="filter-title">Global Scripts</div>
      <div class="trainer-script-status">
        <span class="patch-badge ${badgeClass}">${escapeHtml(trainerScriptArchiveStatusLabel(status))}</span>
        <span>${status.ok ? `file ${status.scriptFileId}` : escapeHtml(project.session.baseVersion)}</span>
      </div>
      <div class="trainer-script-detail">${escapeHtml(formatTrainerScriptArchiveDetail(status))}</div>
      <button class="btn -default trainer-script-expand-btn" id="trainer-script-expand-btn" type="button" ${disabled}>Expand Global Scripts</button>
    </div>
  `;
}

function renderTrainerNaturePatchPanel(project: ProjectState, status: ReturnType<typeof detectSpecifyTrainerNaturesPatch>): string {
  if (status === "unsupported") return "";
  const badgeClass = status === "patched" ? "-ok" : status === "unknown" ? "-warn" : "";
  const buttonDisabled = status === "patched" ? "disabled" : "";
  return `
    <div class="trainer-nature-patch-panel">
      <div class="filter-title">Natures</div>
      <div class="trainer-nature-patch-status">
        <span class="patch-badge ${badgeClass}">${escapeHtml(trainerNatureStatusLabel(status))}</span>
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
): void {
  const status = getTrainerScriptArchiveStatus(project);
  const button = root.querySelector<HTMLButtonElement>("#trainer-script-expand-btn");
  if (!button || !status.ok || !status.canExpand) return;
  button.addEventListener("click", () => {
    const previousText = button.textContent ?? "Expand Global Scripts";
    button.disabled = true;
    button.textContent = "Expanding...";
    try {
      const result = expandTrainerScriptArchive(project);
      if (result.addedEntries > 0) onDirty?.();
      renderTrainerEditor(project, root, onDirty, onTestBattle, onOpenTrainerSprite);
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
  status: ReturnType<typeof detectSpecifyTrainerNaturesPatch>,
): void {
  const button = root.querySelector<HTMLButtonElement>("#trainer-nature-patch-btn");
  if (!button || status === "patched") return;
  button.addEventListener("click", async () => {
    if (!window.confirm("Apply this ARM9 patch to enable explicit trainer Pokémon natures?\n\nExport the ROM after applying to keep this change.")) return;
    const previousText = button.textContent ?? trainerNatureButtonLabel(status);
    button.disabled = true;
    button.textContent = "Applying...";
    try {
      const result = await specifyTrainerNatures(project);
      if (result.status === "applied") onDirty?.();
      renderTrainerEditor(project, root, onDirty, onTestBattle, onOpenTrainerSprite);
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
  if (status.outOfRangeTrainerIds.length) return "Range Limit";
  if (status.needsExpansion) return "Needs Sync";
  if (status.helperTrainerIds.length) return "Helper Slots";
  return "Ready";
}

function trainerScriptArchiveBadgeClass(status: TrainerScriptArchiveStatus): string {
  if (!status.ok) return "-warn";
  if (status.needsExpansion || status.helperTrainerIds.length || status.outOfRangeTrainerIds.length) return "-warn";
  return "-ok";
}

function trainerNatureStatusLabel(status: ReturnType<typeof detectSpecifyTrainerNaturesPatch>): string {
  if (status === "patched") return "Applied";
  if (status === "unknown") return "Signature unknown";
  if (status === "unsupported") return "Unsupported";
  return "Ready";
}

function trainerNatureButtonLabel(status: ReturnType<typeof detectSpecifyTrainerNaturesPatch>): string {
  if (status === "patched") return "Applied";
  return "Apply Patch";
}

function renderPartyPreview(project: ProjectState, pok: TrainerPokemonSlot): string {
  const missingSprite = publicAsset("images/pokesprite/-.png");
  let romIcon = "";
  if (isGen5Project(project) && project.narcs.pokemon_icons) {
    try {
      const spriteId = resolvePokemonSpriteId(project, pok.speciesId, pok.form);
      const variant: PokemonIconVariant = pok.gender === "Female" && genderedPokemonIcons(project, spriteId) ? "female" : "male";
      romIcon = `<canvas class="trainer-pokemon-preview trainer-pokemon-rom-icon" data-trainer-pokemon-sprite-id="${spriteId}" data-trainer-pokemon-icon-variant="${variant}" data-show="pok-${pok.slot}" width="32" height="32" hidden aria-label="${escapeHtml(pok.speciesName)}"></canvas>`;
    } catch {
      // Keep the form-aware static sprite below as a fallback for incomplete ROM data.
    }
  }
  return `
    <div class="wild">
      ${romIcon}
      <img class="trainer-pokemon-preview trainer-pokemon-fallback-icon" src="${publicAsset(`images/pokesprite/${pok.spriteSlug}.png`)}" alt="" data-show="pok-${pok.slot}" onerror="this.src='${missingSprite}'">
    </div>
  `;
}

function expandedField(label: string, value: string, labelClass = "expanded-trlabel"): string {
  return `
    <div class="expanded-field">
      <div class="${labelClass}">${escapeHtml(label)}</div>
      ${value}
    </div>
  `;
}

function editable(
  narc: "trdata" | "trpok" | "trtext",
  field: string,
  value: unknown,
  className: string,
  options: { autofill?: string; type?: string; check?: string } = {},
): string {
  const autofill = options.autofill ? ` data-autocomplete-spy data-autofill="${options.autofill}"` : "";
  const type = options.type ? ` data-type="${options.type}"` : "";
  const check = options.check ? ` data-check="${options.check}"` : "";
  return `<div autocorrect="off" data-narc="${narc}" data-field-name="${field}" class="${className}" contenteditable="true"${autofill}${type}${check}>${escapeHtml(String(value ?? ""))}</div>`;
}

function checkbox(field: string, checked: boolean): string {
  return `
    <label class="container" data-narc="trdata">
      <input class="trainer-tmp-flag ${field.replace("_", "-")} choosable-prop ${checked ? "-active" : ""}" data-field-name="${field}" type="checkbox" ${checked ? "checked" : ""}>
      <span class="checkmark"></span>
    </label>
  `;
}
