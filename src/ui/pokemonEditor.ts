import { EVO_METHODS, isGen4Project, typeNamesForProject } from "../pokeweb/constants";
import { cascadeWhiteTrainerAbilityName, detectCascadeWhiteRom } from "../pokeweb/cascadeWhiteModel";
import {
  BASE_STAT_FIELDS,
  EV_YIELD_FIELDS,
  MISC_INTEGER_FIELDS,
  PERSONAL_TEXT_FIELDS,
  learnsetMoveLimit,
  getPokemonAutofills,
  getPokemonCount,
  getPokemonRecord,
  getPokemonSummaryRecord,
  type EvolutionSlot,
  type EggMoveSlot,
  type LearnsetMove,
  type PokemonEditorRecord,
  type PokemonSummaryRecord,
  type TmCompatibilitySlot,
  type TutorCompatibilityGroup,
  type TutorCompatibilitySlot,
} from "../pokeweb/pokemonModel";
import {
  getPokemonFormDeletionAvailability,
  type AddPokemonFormResult,
  type DeletePokemonFormResult,
} from "../pokeweb/pokemonFormModel";
import { findPokemonPersonalFormOwner, pokemonPersonalDisplayIds, pokemonSpeciesLabel } from "../pokeweb/pokemonLabels";
import {
  getPokemonTextInfo,
  hasPokemonTextBanks,
  type PokemonTextInfo,
  type PokemonTextLine,
  type PokemonTextSection,
} from "../pokeweb/pokemonTextModel";
import { getPokemonCardFrontSpriteImage } from "../pokeweb/pokemonCardSpriteModel";
import type { RgbaImageData } from "../pokeweb/pokemonSpriteModel";
import type { ProjectState, ReadableRecord } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { attachPokemonInteractions } from "./pokemonInteractions";
import { attachW2uSyncButton, renderW2uSyncButton } from "./w2uLocalSync";
import { pokemonSpriteSlug } from "../pokeweb/spriteSlug";
import evoIcon from "../assets/svgs/evo.svg?raw";
import eggMovesIcon from "../assets/svgs/egg_moves.svg?raw";
import miscDataIcon from "../assets/svgs/misc_data.svg?raw";
import movesIcon from "../assets/svgs/moves.svg?raw";
import movieIcon from "../assets/svgs/movie.svg?raw";
import paintIcon from "../assets/svgs/paint.svg?raw";
import tmsIcon from "../assets/svgs/tms.svg?raw";
import tutorsIcon from "../assets/svgs/tutors.svg?raw";
import soundIcon from "../assets/svgs/sound_move.svg?raw";
import { publicAsset } from "../assetUrl";
import { installPokemonCryPanel, renderPokemonCryPanel } from "./pokemonCryEditor";

const ICONS: Record<string, string> = {
  learnset: movesIcon,
  tms: tmsIcon,
  tutors: tutorsIcon,
  "egg-moves": eggMovesIcon,
  evos: evoIcon,
  personal: miscDataIcon,
  cry: soundIcon,
};
const POKEMON_CARD_SPRITE_RENDER_VERSION = "personal-front-sprite-v2";
const pokemonCardSpriteInstallations = new WeakMap<HTMLElement, { disconnect: () => void }>();

export function renderPokemonEditor(
  project: ProjectState,
  root: HTMLElement,
  onDirty?: () => void,
  onOpenSprites?: (speciesId: number) => void,
  onOpenPwan?: (speciesId: number) => void,
  onEnsureFormAssets?: () => Promise<void>,
): void {
  root.innerHTML = `
    <div class="pokemon-filter pokemon-filter-personal">
      <div class="filter-title">Search Text</div>
      <input class="filter-input" id="search-text"/>
      <button class="btn -default" id="search-text-btn" type="button">Search</button>
      <div class="filter-title">Generation</div>
      <div class="small-filters gen-filters">
        ${[1, 2, 3, 4, 5].map((gen) => `<button class="btn -default btn-5" data-gen="${gen}" type="button">${gen}</button>`).join("")}
      </div>
      <div class="small-filters type-filters">
        ${typeNamesForProject(project).map((type) => `<button class="btn -default btn-5 -${type.toLowerCase()}" data-ptype="${type.toLowerCase()}" type="button">${type.toUpperCase().slice(0, 3)}</button>`).join("")}
      </div>
      <br>
      <div class="small-filters">Tip: You can right click a value to apply to all</div>
      ${renderW2uSyncButton(project, ["personal", "learnsets", "evolutions"])}
      <div class="evo-method-info" hidden>
        <div class="filter-title">Evolution Methods</div>
        <div class="evo-method-list">
          ${EVO_METHODS.map(
            (method, index) => `
              <div class="evo-method-row">
                <span class="evo-method-id">${index}</span>
                <span>${escapeHtml(method)}</span>
              </div>
            `,
          ).join("")}
        </div>
      </div>
    </div>
    <div class="pokemon-list" id="personals">
      ${renderPokemonCards(project, Boolean(onOpenPwan))}
    </div>
  `;

  attachPokemonInteractions(root, project, {
    onDirty,
    onOpenSprites,
    onOpenPwan,
    renderExpanded: (speciesId) => renderPokemonExpandedSections(project, speciesId),
    renderTextPanel: (speciesId) => renderPokemonTextPanel(getPokemonTextInfo(project, speciesId)),
    installCryPanel: (panel, speciesId) => installPokemonCryPanel(panel, project, speciesId, { onDirty }),
    autofills: getPokemonAutofills(project),
    onEnsureFormAssets,
    onFormAdded: (result: AddPokemonFormResult) => {
      renderPokemonEditor(project, root, onDirty, onOpenSprites, onOpenPwan, onEnsureFormAssets);
      window.requestAnimationFrame(() => {
        root.querySelector<HTMLElement>(`.pokemon-card[data-index='${result.personalId}']`)?.scrollIntoView({ block: "center" });
      });
    },
    onFormDeleted: (result: DeletePokemonFormResult) => {
      renderPokemonEditor(project, root, onDirty, onOpenSprites, onOpenPwan, onEnsureFormAssets);
      window.requestAnimationFrame(() => {
        root.querySelector<HTMLElement>(`.pokemon-card[data-index='${result.speciesId}']`)?.scrollIntoView({ block: "center" });
      });
    },
  });
  attachW2uSyncButton(root, project);
  installPokemonCardSpriteRendering(project, root);
}

export function renderPokemonExpandedSections(project: ProjectState, speciesId: number): string {
  return renderExpanded(project, getPokemonRecord(project, speciesId));
}

function renderPokemonCards(project: ProjectState, showPwanIcon: boolean): string {
  const cards: string[] = [];
  for (const id of pokemonPersonalDisplayIds(project)) {
    cards.push(renderPokemonCard(project, getPokemonSummaryRecord(project, id), showPwanIcon));
  }
  return cards.join("");
}

function renderPokemonCard(project: ProjectState, record: PokemonSummaryRecord, showPwanIcon: boolean): string {
  const pok = record.personal;
  const name = pokemonSpeciesLabel(project, record.id);
  const type1 = String(pok.type_1 ?? "");
  const type2 = String(pok.type_2 ?? "");
  return `
    <div class="pokemon-card filterable" data-gen="${record.gen}" data-index="${record.id}">
      <div class="pokemon-card__info">
        <div class="pokemon-card__header">
          <div class="pokemon-card__img">
            ${renderPokemonCardSprite(project, record.id, name)}
          </div>
        </div>
        ${renderPokemonName(project, record.id, name)}
        <div class="pokemon-types">
          ${editable("personal", "type_1", type1, `pokemon-type -${typeClass(type1)}`, { autofill: "types" })}
          ${editable("personal", "type_2", type2, `pokemon-type -${typeClass(type2)}`, { autofill: "types" })}
        </div>
        <div class="pokemon-card__abilities">
          ${editable("personal", "ability_1", titleizeValue(pok.ability_1), "pokemon-card__ability", { autofill: "abilities" })}
          ${editable("personal", "ability_2", titleizeValue(pok.ability_2), "pokemon-card__ability", { autofill: "abilities" })}
          ${editable("personal", "ability_3", titleizeValue(pok.ability_3), "pokemon-card__ability", { autofill: "abilities" })}
          ${renderCascadeAbilitySlots(project, record.id)}
        </div>
      </div>
      <table class="pokemon-card__table" cellspacing="0">
        <tbody>
          ${BASE_STAT_FIELDS.map(([label, field]) => renderBaseStat(label, field, pok[field])).join("")}
        </tbody>
      </table>
      <div class="personal-icons">
        ${icon("learnset", "Learnset")}
        ${icon("tms", "TMs")}
        ${icon("tutors", "Tutors")}
        ${icon("egg-moves", "Egg Moves")}
        ${icon("evos", "Evolutions")}
        ${icon("personal", "Personal")}
        ${project.session.generation === "gen5" ? icon("cry", "Play, export, or import Pokemon cry") : ""}
        ${spriteIcon()}
        ${showPwanIcon ? pwanIcon() : ""}
      </div>
    </div>
  `;
}

function renderPokemonName(project: ProjectState, speciesId: number, name: string): string {
  const label = `#${speciesId} ${name}`;
  if (!hasPokemonTextBanks(project)) return `<div class="pokemon-card__name">${escapeHtml(label)}</div>`;
  return `<button class="pokemon-card__name pokemon-name-toggle" type="button" aria-expanded="false" title="Edit Pokemon name and text references">${escapeHtml(label)}</button>`;
}

function renderPokemonTextPanel(info: PokemonTextInfo | undefined): string {
  if (!info) {
    return `
      <div class="expanded-card-content expanded-pokemon-texts">
        <div class="pokemon-text-empty">Pokemon text banks are unavailable for this ROM.</div>
      </div>
    `;
  }
  const formNote =
    info.requestedPersonalId === info.speciesId
      ? ""
      : `<div class="pokemon-text-form-note">This form uses the base species name from Pokemon #${info.speciesId}.</div>`;
  const editableBankCount = info.sections.filter((section) => section.editable).length;
  return `
    <div class="expanded-card-content expanded-pokemon-texts" data-pokemon-text-panel="${info.speciesId}">
      <div class="pokemon-text-editor">
        <label class="pokemon-text-control">
          <span>Pokemon Name</span>
          <input class="pokemon-text-name-input" type="text" value="${escapeHtml(info.title)}" autocomplete="off" spellcheck="false">
        </label>
        <div class="pokemon-text-editor-copy">
          <strong>${info.sections.length} species name bank${info.sections.length === 1 ? "" : "s"}</strong>
          <span>Saving updates ${editableBankCount} English bank${editableBankCount === 1 ? "" : "s"}. Non-English entries are display-only.</span>
          ${formNote}
        </div>
        <div class="pokemon-text-status" aria-live="polite"></div>
      </div>
      <div class="pokemon-text-bank-list">
        ${info.sections.map(renderPokemonTextSection).join("")}
      </div>
    </div>
  `;
}

function renderPokemonTextSection(section: PokemonTextSection): string {
  const kind =
    section.role === "name"
      ? "primary species name"
      : section.role === "uppercase"
        ? "uppercase species name"
        : section.role === "grammar"
          ? "grammar species name"
          : "species name";
  const detail = `${section.language} ${kind}${section.editable ? "" : " · Display only"}`;
  return `
    <section class="pokemon-text-bank-section${section.editable ? "" : " -read-only"}" data-bank-id="${section.bankId}" data-role="${section.role}" data-editable="${section.editable}">
      <div class="pokemon-text-bank-header">
        <span>${escapeHtml(section.title)}</span>
        <small>${escapeHtml(detail)}</small>
      </div>
      ${section.lines.map(renderPokemonTextLine).join("")}
    </section>
  `;
}

function renderPokemonTextLine(line: PokemonTextLine): string {
  return `
    <div class="pokemon-text-line" data-entry-index="${line.flatIndex}">
      <div class="pokemon-text-msg">MSG ${escapeHtml(line.entryLabel)}</div>
      <div class="pokemon-text-value">${escapeHtml(line.text)}</div>
    </div>
  `;
}

function renderPokemonCardSprite(project: ProjectState, speciesId: number, name: string): string {
  const fallbackSrc = publicAsset(`images/pokesprite/${pokemonSpriteSlug(name)}.png`);
  const fallback = `<img class="pokemon-card-fallback-sprite" src="${fallbackSrc}" alt="" loading="lazy" onerror="this.style.display='none'">`;
  const hasPwanFront = Boolean(project.pwanAnimations?.overrides.some((override) => override.front && (override.speciesId === speciesId || override.assetIndex === speciesId)));
  if (!hasPwanFront && !project.narcs.pokemon_sprites) return fallback;
  return `<canvas class="pokemon-card-rom-sprite" data-pokemon-species-id="${speciesId}" data-pokemon-sprite-version="${POKEMON_CARD_SPRITE_RENDER_VERSION}" width="96" height="96" aria-hidden="true"></canvas>${fallback}`;
}

function installPokemonCardSpriteRendering(project: ProjectState, root: HTMLElement): void {
  pokemonCardSpriteInstallations.get(root)?.disconnect();
  if (!project.narcs.pokemon_sprites && !project.pwanAnimations?.overrides.some((override) => override.front)) return;

  const imageCache = new Map<number, Promise<RgbaImageData | undefined>>();
  const loadImage = (speciesId: number): Promise<RgbaImageData | undefined> => {
    let cached = imageCache.get(speciesId);
    if (!cached) {
      cached = Promise.resolve()
        .then(() => getPokemonCardFrontSpriteImage(project, speciesId))
        .catch((error) => {
          console.warn(`Failed to render Pokemon sprite ${speciesId}`, error);
          return undefined;
        });
      imageCache.set(speciesId, cached);
    }
    return cached;
  };

  const renderCanvas = async (canvas: HTMLCanvasElement): Promise<void> => {
    if (
      (canvas.dataset.pokemonSpriteRendered === "true" && canvas.dataset.pokemonSpriteVersion === POKEMON_CARD_SPRITE_RENDER_VERSION) ||
      canvas.dataset.pokemonSpriteRendered === "loading"
    ) {
      return;
    }
    const speciesId = Number(canvas.dataset.pokemonSpeciesId);
    if (!Number.isInteger(speciesId)) return;
    canvas.dataset.pokemonSpriteVersion = POKEMON_CARD_SPRITE_RENDER_VERSION;
    canvas.dataset.pokemonSpriteRendered = "loading";
    const image = await loadImage(speciesId);
    if (!canvas.isConnected) return;
    if (!image) {
      canvas.hidden = true;
      canvas.dataset.pokemonSpriteRendered = "missing";
      return;
    }
    canvas.width = image.width;
    canvas.height = image.height;
    const pixels = new Uint8ClampedArray(image.pixels.length);
    pixels.set(image.pixels);
    canvas.getContext("2d")?.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
    canvas.classList.add("-loaded");
    canvas.closest<HTMLElement>(".pokemon-card__img")?.classList.add("-rom-loaded");
    canvas.dataset.pokemonSpriteRendered = "true";
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
    if (canvas.dataset.pokemonSpriteObserved === "true") return;
    canvas.dataset.pokemonSpriteObserved = "true";
    if (intersectionObserver) intersectionObserver.observe(canvas);
    else void renderCanvas(canvas);
  };

  const scan = (): void => {
    root.querySelectorAll<HTMLCanvasElement>("canvas.pokemon-card-rom-sprite").forEach(observeCanvas);
  };

  const mutationObserver = new MutationObserver(scan);
  mutationObserver.observe(root, { childList: true, subtree: true });
  scan();

  pokemonCardSpriteInstallations.set(root, {
    disconnect: () => {
      intersectionObserver?.disconnect();
      mutationObserver.disconnect();
    },
  });
}

function renderCascadeAbilitySlots(project: ProjectState, speciesId: number): string {
  if (!detectCascadeWhiteRom(project)) return "";
  return [4, 5, 6]
    .map((slot) => {
      const ability = titleizeValue(cascadeWhiteTrainerAbilityName(project, speciesId, slot) ?? "");
      return `<div class="pokemon-card__ability -readonly" title="Ability ${slot}" aria-label="Ability ${slot}">${escapeHtml(String(ability ?? ""))}</div>`;
    })
    .join("");
}

function renderExpanded(project: ProjectState, record: PokemonEditorRecord): string {
  const learnsetLimit = learnsetMoveLimit(project);
  const learnsetSpeciesMax = Math.max(1, (project.narcs.learnsets?.fileCount ?? 1) - 1);
  const personalSpeciesMax = Math.max(1, getPokemonCount(project) - 1);
  const canAddLearnsetMove = record.learnset.length < learnsetLimit;
  const learnsetColumnSplit = Math.ceil(record.learnset.length / 2);
  const leftIntegerFields = MISC_INTEGER_FIELDS.filter(([, field]) => field in record.rawPersonal && field !== "height" && field !== "weight");
  const midIntegerFields = MISC_INTEGER_FIELDS.filter(([, field]) => field in record.rawPersonal && (field === "height" || field === "weight"));
  const textFields = PERSONAL_TEXT_FIELDS.filter(([, field]) => field in record.rawPersonal);
  const addFormReady =
    !isGen4Project(project) &&
    Boolean(
      project.narcs.personal &&
        project.narcs.learnsets &&
        project.narcs.evolutions &&
        project.narcs.pokemon_sprites &&
        project.narcs.pokemon_icons &&
        project.narcs.message_texts,
    );
  const formOwner = findPokemonPersonalFormOwner(project, record.id);
  const deletion = formOwner ? getPokemonFormDeletionAvailability(project, record.id) : undefined;
  const deleteFormButton = deletion
    ? `<button class="btn -default personal-delete-form${deletion.deletable ? "" : " invalid"}" data-delete-pokemon-form type="button" ${deletion.deletable ? "" : "disabled"} title="${escapeHtml(deletion.deletable ? "Delete this generated form and its appended files" : deletion.reason)}">Delete Form</button>`
    : "";
  return `
    <div class="expanded-card-content expanded-personal">
      <div class="personal-form-toolbar">
        <div>
          <strong>Add a stat-bearing alternate form</strong>
          <span>Copies the base personal data, learnset, sprites, and icons; evolution data starts empty.</span>
        </div>
        <div class="personal-form-actions">
          ${deleteFormButton}
          <button class="btn -default personal-add-form" data-add-pokemon-form type="button" ${addFormReady ? "" : "disabled"} title="${addFormReady ? "Generate and append all files for a new form" : "Load Personal, Learnsets, Evolutions, Pokemon Sprites, Pokemon Icons, and Message Texts to add a form"}">Add Form</button>
        </div>
      </div>
      <div class="expanded-left">
        ${leftIntegerFields.map(([label, field, max]) => expandedField(label, editable("personal", field, record.personal[field], "expanded-field-value", { type: `int-${max}` }))).join("")}
      </div>
      <div class="expanded-mid">
        ${midIntegerFields.map(([label, field, max]) => expandedField(label, editable("personal", field, record.personal[field], "expanded-field-value", { type: `int-${max}` }))).join("")}
        ${textFields.map(([label, field, autofill]) => expandedField(label, editable("personal", field, record.personal[field], "expanded-field-value", { autofill }))).join("")}
      </div>
      <div class="expanded-right">
        ${EV_YIELD_FIELDS.map(([label, field]) => expandedField(`${label} EVs`, editable("personal", field, record.personal[field], "expanded-field-value ev-field", { type: "int-3" }))).join("")}
      </div>
    </div>
    <div class="expanded-card-content expanded-learnset">
      <div class="learnset-panel">
        <div class="learnset-toolbar">
          <div class="learnset-toolbar-actions">
            <button class="btn -default learnset-action" data-learnset-action="append" type="button" ${canAddLearnsetMove ? "" : "disabled"}>Add Move</button>
            <input class="learnset-copy-source" type="number" inputmode="numeric" min="1" max="${learnsetSpeciesMax}" step="1" placeholder="Species ID" aria-label="Source species ID">
            <button class="btn -default learnset-action" data-learnset-action="copy" type="button">Copy From</button>
          </div>
          <span class="learnset-count">${record.learnset.length}/${learnsetLimit}</span>
        </div>
        <div class="learnset-columns">
          <div class="expanded-left">
            ${record.learnset.slice(0, learnsetColumnSplit).map((move) => renderLearnsetMove(move, canAddLearnsetMove)).join("")}
          </div>
          <div class="expanded-left">
            ${record.learnset.slice(learnsetColumnSplit).map((move) => renderLearnsetMove(move, canAddLearnsetMove)).join("")}
          </div>
        </div>
      </div>
    </div>
    <div class="expanded-card-content expanded-tms">
      ${renderCompatibilityCopyToolbar("tm", "TM/HM", personalSpeciesMax)}
      ${record.tmCompatibility.map((slot) => renderTmCompatibility(slot)).join("")}
    </div>
    <div class="expanded-card-content expanded-tutors">
      ${record.tutorCompatibility.length > 0 ? `${renderCompatibilityCopyToolbar("tutor", "Tutor", personalSpeciesMax)}${record.tutorCompatibility.map((group) => renderTutorGroup(group)).join("")}` : renderUnavailablePanel("BW2 tutor compatibility is not available for this ROM.")}
    </div>
    <div class="expanded-card-content expanded-egg-moves">
      ${record.eggMovesLoaded ? renderEggMoves(record.eggMoves) : renderUnavailablePanel("Egg move data was not loaded for this project. Reload with Pokemon data selected.")}
    </div>
    <div class="expanded-card-content expanded-evos">
      ${evolutionColumns(record.evolutions).map((slots) => renderEvolutionColumn(slots)).join("")}
    </div>
    ${project.session.generation === "gen5" ? renderPokemonCryPanel(record.id) : ""}
  `;
}

function renderCompatibilityCopyToolbar(kind: "tm" | "tutor", label: string, speciesMax: number): string {
  return `
    <div class="compatibility-copy-toolbar">
      <input class="learnset-copy-source compatibility-copy-source" type="number" inputmode="numeric" min="1" max="${speciesMax}" step="1" placeholder="Species ID" aria-label="${label} compatibility source species ID">
      <button class="btn -default compatibility-copy-action" data-compatibility-copy="${kind}" type="button">Copy From</button>
    </div>
  `;
}

function evolutionColumns(slots: EvolutionSlot[]): EvolutionSlot[][] {
  const size = Math.ceil(slots.length / 3);
  return [slots.slice(0, size), slots.slice(size, size * 2), slots.slice(size * 2)];
}

function renderBaseStat(label: string, field: string, value: unknown): string {
  const numeric = Number(value) || 0;
  return `
    <tr>
      <td><strong>${label}</strong></td>
      <td data-narc="personal" data-type="int-255" data-field-name="${field}" contenteditable="true">${numeric}</td>
      <td>
        <div class="pokemon-card__graph-wrapper">
          <div class="pokemon-card__graph -medium" style="width: calc(100% * (${numeric} / 255));"></div>
        </div>
      </td>
    </tr>
  `;
}

function renderLearnsetMove(move: LearnsetMove, canInsert: boolean): string {
  return `
    <div class="expanded-field multi learnset-row" data-learnset-index="${move.index}">
      <div data-require="move-name" data-narc="learnset" data-field-name="lvl_learned_${move.index}" data-type="int-100" class="move-level" contenteditable="true">${move.level}</div>
      ${editable("learnset", `move_id_${move.index}`, move.moveName, "move-name", { autofill: "move_names", require: "move-level" })}
      <div class="move-type"><button class="btn -${typeClass(move.type)} -active" type="button">${escapeHtml(String(move.type).toUpperCase().slice(0, 3))}</button></div>
      <div class="move-cat">${escapeHtml(String(move.category).slice(0, 3))}</div>
      <div class="move-power">${escapeHtml(String(move.power))}</div>
      <div class="move-accuracy">${escapeHtml(String(move.accuracy))}</div>
      <div class="learnset-row-actions">
        <button class="learnset-icon-button" data-learnset-action="insert" data-learnset-index="${move.index + 1}" title="Insert move below" type="button" ${canInsert ? "" : "disabled"}>+</button>
        <button class="learnset-icon-button -danger" data-learnset-action="delete" data-learnset-index="${move.index}" title="Delete move" type="button">×</button>
      </div>
    </div>
  `;
}

function renderEvolutionColumn(slots: EvolutionSlot[]): string {
  return `
    <div class="expanded-left">
      ${slots
        .map((slot) => {
          const paramOptions = slot.paramAutofill ? { autofill: slot.paramAutofill } : { type: "int-65535" };
          return `
            ${expandedField("Method", editable("evolution", `method_${slot.index}`, slot.method, "evo-value", { autofill: "evo_methods" }))}
            ${expandedField("Parameter", editable("evolution", `param_${slot.index}`, slot.param, "evo-value", paramOptions))}
            ${expandedField("Evolves to", editable("evolution", `target_${slot.index}`, slot.target, "evo-value", { autofill: "pokemon_names" }))}
          `;
        })
        .join("")}
    </div>
  `;
}

function renderTmCompatibility(slot: TmCompatibilitySlot): string {
  return `
    <div class="cell tm ${slot.enabled ? "-active" : ""}" data-field-name="tms" data-narc="personal" data-kind="${slot.kind}" data-index="${slot.index}">
      ${escapeHtml(slot.label)}<br>
      ${escapeHtml(slot.moveName)}
    </div>
  `;
}

function renderTutorGroup(group: TutorCompatibilityGroup): string {
  return `
    <section class="tutor-group">
      <h3>${escapeHtml(group.label)}</h3>
      <div class="tutor-grid">
        ${group.slots.map((slot) => renderTutorCompatibility(slot)).join("")}
      </div>
    </section>
  `;
}

function renderTutorCompatibility(slot: TutorCompatibilitySlot): string {
  return `
    <div class="cell tutor ${slot.enabled ? "-active" : ""}" data-field-name="tutors" data-narc="personal" data-tutor-field="${slot.field}" data-index="${slot.index}">
      ${escapeHtml(slot.label)}<br>
      ${escapeHtml(slot.moveName)}
    </div>
  `;
}

function renderEggMoves(moves: EggMoveSlot[]): string {
  const canInsert = true;
  return `
    <div class="learnset-panel egg-move-panel">
      <div class="learnset-toolbar">
        <button class="btn -default egg-move-action" data-egg-move-action="append" type="button">Add Move</button>
        <span class="learnset-count">${moves.length} egg move${moves.length === 1 ? "" : "s"}</span>
      </div>
      <div class="learnset-columns">
        <div class="expanded-left">
          ${moves.slice(0, Math.ceil(moves.length / 2)).map((move) => renderEggMove(move, canInsert)).join("")}
        </div>
        <div class="expanded-left">
          ${moves.slice(Math.ceil(moves.length / 2)).map((move) => renderEggMove(move, canInsert)).join("")}
        </div>
      </div>
    </div>
  `;
}

function renderEggMove(move: EggMoveSlot, canInsert: boolean): string {
  return `
    <div class="expanded-field multi egg-move-row" data-egg-move-index="${move.index}">
      ${editable("egg_moves", `move_id_${move.index}`, move.moveName, "move-name", { autofill: "move_names" })}
      <div class="move-type"><button class="btn -${typeClass(move.type)} -active" type="button">${escapeHtml(String(move.type).toUpperCase().slice(0, 3))}</button></div>
      <div class="move-cat">${escapeHtml(String(move.category).slice(0, 3))}</div>
      <div class="move-power">${escapeHtml(String(move.power))}</div>
      <div class="move-accuracy">${escapeHtml(String(move.accuracy))}</div>
      <div class="learnset-row-actions">
        <button class="learnset-icon-button" data-egg-move-action="insert" data-egg-move-index="${move.index + 1}" title="Insert move below" type="button" ${canInsert ? "" : "disabled"}>+</button>
        <button class="learnset-icon-button -danger" data-egg-move-action="delete" data-egg-move-index="${move.index}" title="Delete move" type="button">×</button>
      </div>
    </div>
  `;
}

function renderUnavailablePanel(message: string): string {
  return `<div class="expanded-empty">${escapeHtml(message)}</div>`;
}

function expandedField(label: string, value: string): string {
  return `
    <div class="expanded-field">
      <div class="expanded-field-name">${escapeHtml(label)}</div>
      ${value}
    </div>
  `;
}

function editable(
  narc: "personal" | "learnset" | "evolution" | "egg_moves",
  field: string,
  value: unknown,
  className: string,
  options: { autofill?: string; type?: string; require?: string } = {},
): string {
  const autofill = options.autofill ? ` data-autocomplete-spy data-autofill="${options.autofill}"` : "";
  const type = options.type ? ` data-type="${options.type}"` : "";
  const require = options.require ? ` data-require="${options.require}"` : "";
  return `<div autocorrect="off" data-narc="${narc}" data-field-name="${field}" class="${className}" contenteditable="true"${autofill}${type}${require}>${escapeHtml(String(value ?? ""))}</div>`;
}

function icon(expand: string, label: string): string {
  return `<div class="expand-card exp-${expand} card-icon expand-action" data-expand="${expand}" title="${label}">${ICONS[expand]}</div>`;
}

function spriteIcon(): string {
  return `<div class="expand-card card-icon sprite-editor-action paintbrush-icon" title="Sprite Editor">${paintIcon}</div>`;
}

function pwanIcon(): string {
  return `<button class="expand-card card-icon pwan-editor-action pwan-movie-icon" title="PWAN Animation Editor" type="button">${movieIcon}</button>`;
}

function typeClass(type: string): string {
  return type.toLowerCase().replace(/[^a-z0-9_-]+/gu, "");
}

function titleize(value: string): string {
  return value
    .split(/\s+/u)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join(" ");
}

function titleizeValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return titleize(value);
}
