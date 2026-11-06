import { publicAsset } from "../assetUrl";
import { BATTLE_TYPES, NATURES, TRAINER_AIS, TRAINER_GENDERS, isGen5Project } from "../pokeweb/constants";
import { getMovePreview } from "../pokeweb/pokemonModel";
import {
  genderedPokemonIcons,
  resolvePokemonSpriteId,
  type PokemonIconVariant,
} from "../pokeweb/pokemonSpriteModel";
import type { ProjectState } from "../pokeweb/projectStore";
import {
  getAutofilledTrainerPokemonMoveIds,
  getTrainerPokemonAbilityOptions,
  getTrainerRecord,
  resolveTrainerPokemonGender,
  type TrainerPokemonSlot,
  type TrainerRecord,
} from "../pokeweb/trainerModel";
import { hasGen5TrainerSprites } from "../pokeweb/trainerSpriteModel";
import type { TrainerTextLine } from "../pokeweb/trainerTextModel";
import { escapeHtml } from "./dom";
import { renderTrainerFieldSettings } from "./trainerFieldConditions";
import { renderTrainerLevelCapSetting } from "./trainerLevelCaps";
import { renderGameTextEditor } from "./textHighlight";

export const TRAINER_SPRITE_RENDER_VERSION = "gen5-mcss-ncec-v2";

/** Flags that only matter for scripted or special encounters; folded away by default. */
const SPECIAL_AI_FLAGS = new Set(["Roaming Pokemon", "Safari Zone", "Catching Demo"]);

/** Readable names for trainer dialogue slots, keyed by text type id. */
const TRAINER_TEXT_LABELS: Record<number, string> = {
  0: "Before battle",
  1: "On defeat (in battle)",
  2: "After defeat (overworld)",
  3: "Before battle (double, 1st)",
  5: "After defeat (double, 1st)",
  6: "Not enough Pokémon (double, 1st)",
  7: "Before battle (double, 2nd)",
  9: "After defeat (double, 2nd)",
  10: "Not enough Pokémon (double, 2nd)",
  13: "Before healing",
  14: "After healing",
  15: "Before giving item",
  16: "After defeat (item given)",
  17: "After first hit",
  19: "Last Pokémon sent out",
  20: "Last Pokémon below half HP",
  24: "Not enough Pokémon (triple)",
};

export function trainerDisplayName(trainer: TrainerRecord): string {
  const name = String(trainer.readable.name ?? "").trim();
  return name || `Trainer ${trainer.id}`;
}

/** Changed trainer fields as suffixes of their changelog keys: "data:item_1", "pokemon:0:level_0", "text:0". */
export function editedTrainerFields(project: ProjectState, trainerId: number): Set<string> {
  const prefix = `trainer:${trainerId}:`;
  const textPrefix = `trainer-text:${trainerId}:`;
  const edited = new Set<string>();
  for (const entry of project.actionChangelog?.entries ?? []) {
    if (entry.key.startsWith(prefix)) edited.add(entry.key.slice(prefix.length));
    else if (entry.key.startsWith(textPrefix)) edited.add(`text:${entry.key.slice(textPrefix.length)}`);
  }
  return edited;
}

export function trainerLevelRange(trainer: TrainerRecord): string {
  if (trainer.party.length === 0) return "";
  const levels = trainer.party.map((pok) => pok.level);
  const min = Math.min(...levels);
  const max = Math.max(...levels);
  return min === max ? `Lv ${min}` : `Lv ${min}–${max}`;
}

// ---------- List ----------

export function renderTrainerListRowContent(project: ProjectState, trainerOrId: TrainerRecord | number): string {
  const trainer = typeof trainerOrId === "number" ? getTrainerRecord(project, trainerOrId, { includeTexts: false }) : trainerOrId;
  const edits = editedTrainerFields(project, trainer.id).size;
  return `
    <span class="md-row-id">${trainer.id}</span>
    <span class="td-row-sprite">${renderTrainerSpriteImage(project, trainer)}</span>
    <span class="td-row-main">
      <span class="td-row-line">
        <span class="md-row-name">${escapeHtml(trainerDisplayName(trainer))}${edits ? `<span class="md-edits" title="${edits} change${edits === 1 ? "" : "s"}">${edits}</span>` : ""}</span>
        <span class="td-row-lv">${escapeHtml(trainerLevelRange(trainer))}</span>
      </span>
      <span class="td-row-line">
        <span class="td-row-class">${escapeHtml(String(trainer.readable.class ?? ""))}</span>
        <span class="td-row-party trainer-poks">${trainer.party.map((pok) => renderPartyIcon(project, pok, "td-row-mon")).join("")}</span>
      </span>
    </span>
  `;
}

// ---------- Sprites ----------

/** Trainer class sprite: a ROM canvas when the sprite NARC is available, else the bundled image. */
export function renderTrainerSpriteImage(project: ProjectState, trainer: TrainerRecord): string {
  if (!hasGen5TrainerSprites(project)) return `<img src="${trainer.spritePath}" loading="lazy" decoding="async" alt="" onerror="this.style.display='none'">`;
  const trainerClassId = Number(trainer.readable.class_id ?? trainer.raw.class ?? 0);
  return `<canvas class="trainer-rom-sprite" data-trainer-class-id="${trainerClassId}" data-trainer-sprite-version="${TRAINER_SPRITE_RENDER_VERSION}" width="96" height="96" aria-hidden="true"></canvas>`;
}

function renderTrainerSpriteButton(project: ProjectState, trainer: TrainerRecord): string {
  const image = renderTrainerSpriteImage(project, trainer);
  if (!hasGen5TrainerSprites(project)) return image;
  const trainerClassId = Number(trainer.readable.class_id ?? trainer.raw.class ?? 0);
  const label = `Edit ${String(trainer.readable.class ?? `trainer class ${trainerClassId}`)} sprite`;
  return `<button class="trainer-rom-sprite-link" type="button" data-trainer-class-id="${trainerClassId}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${image}</button>`;
}

/**
 * Party icon: a ROM icon canvas (hidden until rendered) plus a dormant bundled
 * fallback whose URL is only assigned when it nears the viewport.
 */
export function renderPartyIcon(project: ProjectState, pok: TrainerPokemonSlot, className: string): string {
  const missingSprite = publicAsset("images/pokesprite/-.png");
  let romIcon = "";
  if (isGen5Project(project) && project.narcs.pokemon_icons) {
    try {
      const spriteId = resolvePokemonSpriteId(project, pok.speciesId, pok.form);
      const variant: PokemonIconVariant = pok.gender === "Female" && genderedPokemonIcons(project, spriteId) ? "female" : "male";
      romIcon = `<canvas class="trainer-pokemon-preview trainer-pokemon-rom-icon" data-trainer-pokemon-sprite-id="${spriteId}" data-trainer-pokemon-icon-variant="${variant}" width="32" height="32" hidden aria-label="${escapeHtml(pok.speciesName)}"></canvas>`;
    } catch {
      // Keep the form-aware static sprite below as a fallback for incomplete ROM data.
    }
  }
  return `<span class="wild ${className}" title="${escapeHtml(`${pok.speciesName} · Lv ${pok.level}`)}">${romIcon}<img class="trainer-pokemon-preview trainer-pokemon-fallback-icon" data-trainer-image-src="${publicAsset(`images/pokesprite/${pok.spriteSlug}.png`)}" loading="lazy" decoding="async" alt="" onerror="this.onerror=null;this.src='${missingSprite}'"></span>`;
}

function itemIconSrc(itemName: string): string {
  return publicAsset(`images/item_sprites/${itemName.normalize("NFKD").replace(/[^a-zA-Z0-9]/gu, "").toLowerCase()}.png`);
}

function hasItem(value: unknown): boolean {
  const name = String(value ?? "").trim();
  return name !== "" && name !== "0" && !/^(none|-+|\?+)$/iu.test(name);
}

// ---------- Detail ----------

export function renderTrainerDetail(project: ProjectState, trainerId: number, selectedSlot: number, natureField: boolean): string {
  const trainer = getTrainerRecord(project, trainerId, { includeTexts: true });
  const slot = trainer.party.find((pok) => pok.slot === selectedSlot) ?? trainer.party[0];
  const fieldSettings = project.session.baseRom === "BW2" ? renderTrainerFieldSettings(project, trainer.id) : "";
  return `
    <article class="trainer-card td-card" data-index="${trainer.id}">
      <header class="td-head">
        <div class="td-sprite">${renderTrainerSpriteButton(project, trainer)}</div>
        <div class="td-ident">
          <div class="td-title"><h1>${escapeHtml(trainerDisplayName(trainer))}</h1><span class="td-num">#${trainer.id}</span></div>
          <div class="td-meta">
            <label class="td-meta-field" data-mark-fields="data:class">
              <span class="md-label">Class</span>
              ${editable("trdata", "class", trainer.readable.class, "td-class", { autofill: "class_names", label: "Trainer class" })}
            </label>
            <label class="td-meta-field" data-mark-fields="data:battle_type_1">
              <span class="md-label">Battle</span>
              ${select("battle_type_1", BATTLE_TYPES.map((type) => [type, type]), String(trainer.readable.battle_type_1 ?? ""), "data-trainer-select")}
            </label>
            ${renderTrainerLocation(project, trainer.id)}
          </div>
        </div>
        <div class="td-head-actions">
          <button class="btn -primary" type="button" data-trainer-test>Test battle</button>
          <button class="btn" type="button" data-team-copy ${trainer.party.length ? "" : "disabled"}>Copy team</button>
          <button class="btn" type="button" data-team-import>Import team</button>
        </div>
      </header>
      <div class="td-body">
        <section class="td-party" aria-label="Party">
          <div class="section-bar">Party<span class="td-bar-note">${trainer.party.length} of 6</span></div>
          <div class="td-strip" data-party-strip>${renderTrainerPartyStrip(project, trainer, slot?.slot ?? -1)}</div>
          <div class="td-slot" data-slot-editor>${slot ? renderTrainerSlotEditor(project, trainer, slot, natureField) : renderEmptyParty()}</div>
        </section>
        <aside class="td-settings" aria-label="Trainer settings">
          ${renderTrainerSettings(project, trainer)}
        </aside>
      </div>
      ${fieldSettings ? `<section class="td-wide"><div class="section-bar md-gap">Field conditions</div>${fieldSettings}</section>` : ""}
      ${trainer.texts.length ? `
        <section class="td-wide td-dialogue">
          <div data-trainer-dialogue>${renderTrainerDialogue(trainer.texts)}</div>
          <aside class="td-dialogue-preview" aria-label="In-game preview">
            <div class="tx-preview-head"><span class="tx-block-title">In-game preview</span><span class="tx-preview-entry" data-dialogue-preview-label></span></div>
            ${project.session.baseRom === "BW2" ? `<div data-dialogue-preview></div>` : `<p class="td-empty">The in-game preview needs a Black 2 / White 2 project.</p>`}
          </aside>
        </section>
      ` : ""}
    </article>
  `;
}

function renderEmptyParty(): string {
  return `<p class="td-empty">This trainer has no Pokémon. Add one to start building the party.</p>`;
}

function renderTrainerLocation(project: ProjectState, trainerId: number): string {
  const source = project.docs?.trainerLocationSources?.[String(trainerId)]?.[0];
  const location = source?.location ?? project.docs?.trainerLocations[String(trainerId)]?.[0];
  if (!location) return "";
  const label = escapeHtml(location);
  const value = source
    ? `<a class="td-location-link" href="#overworlds/${source.overworldId}" title="Open ${label} in the overworld editor">${label}</a>`
    : `<span>${label}</span>`;
  return `<span class="td-meta-field td-location"><span class="md-label">Location</span>${value}</span>`;
}

export function renderTrainerPartyStrip(project: ProjectState, trainer: TrainerRecord, selectedSlot: number): string {
  const cards = trainer.party.map((pok) => {
    const selected = pok.slot === selectedSlot;
    const item = trainer.hasItems && hasItem(pok.itemName) ? String(pok.itemName) : "";
    return `
      <button class="td-mon${selected ? " is-selected" : ""}" type="button" role="tab" aria-selected="${selected}" data-slot="${pok.slot}" data-mark-prefix="pokemon:${pok.slot}:">
        ${item ? `<img class="td-item-icon" src="${itemIconSrc(item)}" alt="${escapeHtml(item)}" title="${escapeHtml(item)}" onerror="this.remove()">` : ""}
        <span class="td-mon-icon trainer-poks">${renderPartyIcon(project, pok, "td-mon-sprite")}</span>
        <span class="td-mon-name">${escapeHtml(pok.speciesName)}</span>
        <span class="td-mon-meta">Lv ${pok.level}</span>
      </button>
    `;
  });
  if (trainer.party.length < 6) {
    cards.push(`<button class="td-mon td-mon-add" type="button" data-party-add><span class="td-mon-plus" aria-hidden="true">+</span><span>Add Pokémon</span></button>`);
  }
  return cards.join("");
}

export function renderTrainerSlotEditor(project: ProjectState, trainer: TrainerRecord, pok: TrainerPokemonSlot, natureField: boolean): string {
  const s = pok.slot;
  const iv = Math.floor((pok.ivs * 31) / 255);
  const abilityOptions = getTrainerPokemonAbilityOptions(project, pok).map((option) => [String(option.slot), option.label] as [string, string]);
  const defaultGender = safe(() => resolveTrainerPokemonGender(project, trainer.id, s), "");
  const genderOptions = TRAINER_GENDERS.map((gender) => [gender, gender === "Default" && defaultGender ? `Default (${defaultGender.toLowerCase()})` : gender] as [string, string]);
  const full = trainer.party.length >= 6;
  const last = trainer.party.length - 1;
  const mark = (field: string) => `pokemon:${s}:${field}_${s}`;
  return `
    <div class="td-slot-head">
      <h2>Pokémon ${s + 1}<span class="td-slot-species" data-derived="species">${escapeHtml(pok.speciesName)}</span></h2>
      <div class="td-slot-actions">
        <button class="btn sm -ghost" type="button" data-slot-move="-1" title="Move left" aria-label="Move left" ${s === 0 ? "disabled" : ""}>←</button>
        <button class="btn sm -ghost" type="button" data-slot-move="1" title="Move right" aria-label="Move right" ${s === last ? "disabled" : ""}>→</button>
        <button class="btn sm" type="button" data-slot-duplicate ${full ? 'disabled title="The party is full"' : ""}>Duplicate</button>
        <button class="btn sm" type="button" data-slot-copy title="Copy this set as Showdown text">Copy</button>
        <button class="btn sm" type="button" data-slot-import title="Replace this set from Showdown text">Import</button>
        <button class="btn sm -remove" type="button" data-slot-delete>Delete</button>
      </div>
    </div>
    <div class="td-slot-grid expanded-pok" data-sub-index="${s}">
      <div class="md-form">
        ${formRow("Species", mark("species_id"), editable("trpok", `species_id_${s}`, pok.speciesName, "td-species", { autofill: "pokemon_names" }))}
        ${formRow("Level", mark("level"), editable("trpok", `level_${s}`, pok.level, "", { type: "int-100" }))}
        ${formRow("Form", mark("form"), editable("trpok", `form_${s}`, pok.form, "", { type: "int-255" }))}
        ${formRow("Gender", mark("gender"), select(`gender_${s}`, genderOptions, pok.gender, "data-slot-select"))}
        ${formRow("Ability", mark("ability"), select(`ability_${s}`, abilityOptions, String(pok.abilitySlot), "data-slot-select"))}
        ${formRow("IV difficulty", mark("ivs"), `${editable("trpok", `ivs_${s}`, pok.ivs, "", { type: "int-255" })}<span class="md-unit" data-derived="iv">IV ${iv} in every stat</span>`)}
        ${natureField
          ? formRow("Nature", mark("nature"), select(`nature_${s}`, [["Auto", `Auto${pok.natureSetting === "Auto" ? ` (${pok.nature})` : ""}`], ...NATURES.map((nature) => [nature, nature] as [string, string])], pok.natureSetting, "data-slot-select"))
          : formRow("Nature", "", `<span class="td-readonly" data-derived="nature">${escapeHtml(pok.nature)}</span><span class="md-unit" title="Without the trainer nature patch the game derives the nature from the trainer, class and Pokémon. Apply the patch under Tools to choose one.">derived</span>`)}
      </div>
      <div class="td-moves">
        ${renderSlotMoves(project, trainer, pok)}
        <div class="md-form td-held">
          ${formRow("Held item", mark("item_id"), editable("trpok", `item_id_${s}`, trainer.hasItems ? pok.itemName : "", "", { autofill: "items", placeholder: trainer.hasItems ? "" : "None" }))}
        </div>
      </div>
    </div>
  `;
}

function renderSlotMoves(project: ProjectState, trainer: TrainerRecord, pok: TrainerPokemonSlot): string {
  const moveNames = project.texts?.banks.moves ?? [];
  const defaults = trainer.hasMoves ? [] : safe(() => getAutofilledTrainerPokemonMoveIds(project, pok.speciesId, pok.level), [] as number[]);
  const rows = [0, 1, 2, 3].map((index) => {
    const field = `move_${index + 1}_${pok.slot}`;
    const name = trainer.hasMoves ? String(pok.moves[index] ?? "") : "";
    const defaultId = defaults[index] ?? 0;
    const previewId = trainer.hasMoves ? moveNames.indexOf(name) : defaultId;
    const preview = previewId > 0 ? getMovePreview(project, previewId) : undefined;
    const placeholder = !trainer.hasMoves && defaultId > 0 ? moveNames[defaultId] ?? "" : "";
    return `
      <tr data-mark-fields="pokemon:${pok.slot}:${field}|pokemon:${pok.slot}:autofill-moves"${trainer.hasMoves ? "" : ' class="-default"'}>
        <td>${editable("trpok", field, name, "td-move", { autofill: "move_names", placeholder })}</td>
        <td data-derived="m${index}-type">${preview?.type ? `<span class="type-plate sm -${typeClass(preview.type)}">${escapeHtml(preview.type)}</span>` : ""}</td>
        <td class="td-move-cat" data-derived="m${index}-cat">${escapeHtml(titleize(preview?.category ?? ""))}</td>
        <td class="r" data-derived="m${index}-pow">${escapeHtml(String(preview?.power ?? "") === "0" ? "—" : String(preview?.power ?? ""))}</td>
      </tr>
    `;
  }).join("");
  return `
    <table class="md-table td-move-table" aria-label="Moves">
      <thead><tr><th>Moves</th><th>Type</th><th>Category</th><th class="r">Power</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="td-moves-foot">
      <button class="btn sm" type="button" data-slot-autofill title="Fill with the last four level-up moves at this level">Autofill moves</button>
    </div>
  `;
}

function renderTrainerSettings(project: ProjectState, trainer: TrainerRecord): string {
  const checkRow = (field: string, label: string, checked: boolean, hint = "") => `
    <label class="md-check td-check" data-mark-fields="data:${field}">
      <input type="checkbox" data-trainer-check="${field}" ${checked ? "checked" : ""}>
      <span>${escapeHtml(label)}</span>${hint ? `<span class="md-unit">${escapeHtml(hint)}</span>` : ""}
    </label>
  `;
  const aiRow = (flag: string) => `
    <label class="md-check td-check td-ai-flag" data-mark-fields="data:${escapeHtml(flag)}" title="Right-click to set or clear this flag on every trainer">
      <input type="checkbox" data-trainer-ai="${escapeHtml(flag)}" ${Number(trainer.readable[flag]) > 0 ? "checked" : ""}>
      <span>${escapeHtml(sentenceCase(flag))}</span>
    </label>
  `;
  const regular = TRAINER_AIS.filter((flag) => !SPECIAL_AI_FLAGS.has(flag));
  const special = TRAINER_AIS.filter((flag) => SPECIAL_AI_FLAGS.has(flag));
  const specialOn = special.filter((flag) => Number(trainer.readable[flag]) > 0).length;
  return `
    <div class="section-bar">Trainer</div>
    <div class="md-form">
      ${[1, 2, 3, 4].map((n) => formRow(`Battle item ${n}`, `data:item_${n}`, editable("trdata", `item_${n}`, trainer.readable[`item_${n}`], "", { autofill: "items" }))).join("")}
      ${formRow("Prize money", "data:money", editable("trdata", "money", trainer.readable.money, "", { type: "int-255" }))}
      ${formRow("Reward item", "data:reward_item", editable("trdata", "reward_item", trainer.readable.reward_item, "", { autofill: "items" }))}
      ${renderTrainerLevelCapSetting(project, trainer.id)}
    </div>
    <div class="td-checks">
      ${checkRow("heal", "Heals the player after battle", Number(trainer.readable.heal) > 0)}
      ${checkRow("has_moves", "Custom moves", trainer.hasMoves)}
      ${checkRow("has_items", "Held items", trainer.hasItems)}
    </div>
    <div class="section-bar md-gap">AI</div>
    <div class="td-checks td-ai">${regular.map(aiRow).join("")}</div>
    <details class="td-ai-special"${specialOn ? " open" : ""}>
      <summary>Special encounters${specialOn ? ` (${specialOn} on)` : ""}</summary>
      <div class="td-checks td-ai">${special.map(aiRow).join("")}</div>
    </details>
  `;
}

export function renderTrainerDialogue(texts: TrainerTextLine[]): string {
  const row = (line: TrainerTextLine) => `
    <div class="td-line" data-mark-fields="text:${line.typeId}">
      <span class="md-label" title="${escapeHtml(`${line.label}${line.bankIndex === undefined ? "" : ` · text ${line.bankIndex}`}`)}">${escapeHtml(TRAINER_TEXT_LABELS[line.typeId] ?? line.label)}</span>
      ${renderGameTextEditor(line.value, `data-trainer-text="${line.typeId}" aria-label="${escapeHtml(TRAINER_TEXT_LABELS[line.typeId] ?? line.label)}"`, line.exists ? "" : "Not used")}
      ${line.exists ? `<button class="btn sm -ghost td-line-delete" type="button" data-text-delete="${line.typeId}" title="Remove this dialogue line" aria-label="Remove this dialogue line">×</button>` : "<span></span>"}
    </div>
  `;
  const used = texts.filter((line) => line.exists);
  const unused = texts.filter((line) => !line.exists);
  return `
    <div class="section-bar md-gap">Dialogue<span class="td-bar-note">${used.length} line${used.length === 1 ? "" : "s"}</span></div>
    <div class="td-lines">${used.map(row).join("") || `<p class="td-empty">No dialogue yet. Add a line below.</p>`}</div>
    ${unused.length ? `<details class="td-unused"><summary>${unused.length} unused line${unused.length === 1 ? "" : "s"}</summary><div class="td-lines">${unused.map(row).join("")}</div></details>` : ""}
  `;
}

// ---------- Helpers ----------

function formRow(label: string, markFields: string, value: string): string {
  return `<span class="md-label"${markFields ? ` data-mark-fields="${escapeHtml(markFields)}"` : ""}>${escapeHtml(label)}</span><span class="md-value">${value}</span>`;
}

function select(field: string, options: Array<[string, string]>, current: string, attribute: "data-trainer-select" | "data-slot-select"): string {
  const known = options.some(([value]) => value === current);
  return `<select ${attribute}="${escapeHtml(field)}">${known ? "" : `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)}</option>`}${options
    .map(([value, label]) => `<option value="${escapeHtml(value)}"${value === current ? " selected" : ""}>${escapeHtml(label)}</option>`)
    .join("")}</select>`;
}

function editable(
  narc: "trdata" | "trpok" | "trtext",
  field: string,
  value: unknown,
  className: string,
  options: { autofill?: string; type?: string; placeholder?: string; label?: string } = {},
): string {
  const autofill = options.autofill ? ` data-autofill="${options.autofill}"` : "";
  const type = options.type ? ` data-type="${options.type}"` : "";
  const placeholder = options.placeholder ? ` data-placeholder="${escapeHtml(options.placeholder)}"` : "";
  const label = options.label ? ` aria-label="${escapeHtml(options.label)}"` : "";
  return `<div autocorrect="off" spellcheck="false" data-narc="${narc}" data-field-name="${escapeHtml(field)}" class="${className}" contenteditable="true"${autofill}${type}${placeholder}${label}>${escapeHtml(String(value ?? ""))}</div>`;
}

function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function typeClass(type: string): string {
  return type.toLowerCase().replace(/[^a-z0-9_-]+/gu, "");
}

function titleize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : "";
}

function sentenceCase(value: string): string {
  const text = value.replace(/Pokemon/gu, "Pokémon");
  return text.charAt(0) + text.slice(1).toLowerCase().replace(/pokémon/gu, "Pokémon");
}
