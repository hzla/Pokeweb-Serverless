import { frostbiteSnowLabel } from "../pokeweb/frostbiteSnowModel";
import { canUseAiFeatures } from "../pokeweb/aiFeatureAccess";
import { renderRosterHub } from "./trainerRosterHub";
import { listTrainerRosters, originalRosterKey, poolRecord, rosterPool, trainerHasRosterVariants, type RosterKey } from "../pokeweb/trainerRosterHub";
import { TRAINER_POOL_GROUPS, TRAINER_POOL_MAX_MEMBERS, trainerPoolGroupBit, type TrainerPartyPool, type TrainerPoolMember } from "../pokeweb/trainerPartyPools";
import { hasTrainerMemberCustomization, getTrainerMemberSettings, trainerCustomizationAvailable, type TrainerMemberSettings } from "../pokeweb/trainerCustomizationModel";
import { TRAINER_NICKNAME_MAX_LENGTH } from "../pokeweb/trainerNicknames";
import { STATUS_ICON } from "../pokeweb/gen5UiImages";
import { getTrainerSlotMovePools, getTrainerSlotNickname } from "../pokeweb/trainerRosterModel";
import { hasMoveAlternatives, TRAINER_MOVE_SLOT_MAX, trainerMovePoolProblem, trainerMoveSlotChances, type TrainerMovePools } from "../pokeweb/trainerMovePools";
import { trainerFormOptions, trainerGenderAvailability, trainerMaxHp, trainerStartingHp } from "../pokeweb/trainerSlotFacts";
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
  trainerPokemonSpriteSlug,
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
/** The flags nearly every trainer uses; the rest fold away until needed. */
const COMMON_AI_FLAGS = new Set(["Prioritize Effectiveness", "Evaluate Attacks", "Expert", "Double Battle"]);

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
        <span class="md-row-name">${escapeHtml(trainerDisplayName(trainer))}${safe(() => trainerHasRosterVariants(project, trainer.id), false) ? `<span class="td-row-dice" title="Has alternate parties, pools or rules" aria-label="Varies between battles">⚄</span>` : ""}${edits ? `<span class="md-edits" title="${edits} change${edits === 1 ? "" : "s"}">${edits}</span>` : ""}</span>
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

/** The roster the party cards and slot editor show: the trainer's own party, an alternate party, a pool, or another trainer's party. */
export type RosterView = {
  key: RosterKey;
  kind: "original" | "party" | "pool" | "trainer";
  record: TrainerRecord;
  poolId?: number;
  pool?: TrainerPartyPool;
  /** Another trainer's party: shown, edited there. */
  readonly: boolean;
  limit: number;
};

export function rosterView(project: ProjectState, trainerId: number, key: RosterKey, selectedSlot: number): RosterView {
  const original = (): RosterView => ({ key: originalRosterKey, kind: "original", record: getTrainerRecord(project, trainerId, { includeTexts: false }), readonly: false, limit: 6 });
  if (key === originalRosterKey) return original();
  const tab = safe(() => listTrainerRosters(project, trainerId).find((entry) => entry.key === key), undefined);
  if (!tab || tab.kind === "original") return original();
  if (tab.kind === "trainer") {
    return { key, kind: "trainer", record: getTrainerRecord(project, tab.source, { includeTexts: false }), readonly: true, limit: 6 };
  }
  const pool = tab.poolId === undefined ? undefined : rosterPool(project, tab.poolId);
  if (!pool) return original();
  return {
    key, kind: tab.kind, poolId: tab.poolId, pool, readonly: false, limit: tab.kind === "party" ? 6 : TRAINER_POOL_MAX_MEMBERS,
    record: poolRecord(project, trainerId, pool, selectedSlot),
  };
}

export function renderTrainerDetail(project: ProjectState, trainerId: number, selectedSlot: number, natureField: boolean, rosterKey: RosterKey = originalRosterKey): string {
  const trainer = getTrainerRecord(project, trainerId, { includeTexts: true });
  const view = rosterView(project, trainerId, rosterKey, selectedSlot);
  const party = view.record;
  const slot = party.party.find((pok) => pok.slot === selectedSlot) ?? party.party[0];
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
          ${safe(() => trainerHasRosterVariants(project, trainer.id), false) ? `<select class="td-test-roster" data-test-roster aria-label="Roster to fight in Test battle" title="Which roster Test battle fights">
            <option value="shown">Fight the roster shown</option><option value="game">Fight the game's pick</option>
          </select>` : ""}
          <button class="btn -primary" type="button" data-trainer-test>Test battle</button>
          ${isGen5Project(project) && trainer.raw.battle_type_1 === 0 && trainer.party.length && canUseAiFeatures() ? '<button class="btn" type="button" data-balance-report>Balance report</button>' : ""}
          <button class="btn" type="button" data-team-copy ${trainer.party.length ? "" : "disabled"}>Copy team</button>
          <button class="btn" type="button" data-team-import>Import team</button>
        </div>
      </header>
      <div class="td-body">
        <section class="td-party" aria-label="Party">
          <div class="section-bar">Party<span class="td-bar-note">${partyNote(view)}</span></div>
          <div class="td-roster-hub" data-roster-hub>${safe(() => renderRosterHub(project, trainer.id, view.key), "")}</div>
          <div class="td-strip${view.kind === "pool" ? " -pool" : ""}" data-party-strip>${renderTrainerPartyStrip(project, party, slot?.slot ?? -1, view)}</div>
          <div class="td-slot" data-slot-editor>${slot ? renderTrainerSlotEditor(project, party, slot, natureField, view) : renderEmptyParty(view)}</div>
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

export function partyNote(view: RosterView): string {
  if (view.kind === "pool") return `draws ${view.pool?.size ?? 0} of ${view.record.party.length} candidates`;
  return `${view.record.party.length} of 6`;
}

export function renderEmptyParty(view?: RosterView): string {
  if (view?.kind === "pool") return `<p class="td-empty">This pool has no candidates. Add Pokémon for the game to draw from.</p>`;
  if (view?.kind === "party") return `<p class="td-empty">This party is empty. Add a Pokémon.</p>`;
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

const POOL_TAGS = ["", "Lead", "Ace"];

export function renderTrainerPartyStrip(project: ProjectState, trainer: TrainerRecord, selectedSlot: number, view?: RosterView): string {
  const cards = trainer.party.map((pok) => {
    const selected = pok.slot === selectedSlot;
    const item = trainer.hasItems && hasItem(pok.itemName) ? String(pok.itemName) : "";
    const member = view?.pool?.members[pok.slot];
    const nickname = member ? ("pokemon" in member ? member.pokemon.nickname : getTrainerSlotNickname(project, member.trainerId, member.slot))
      : getTrainerSlotNickname(project, trainer.id, pok.slot);
    const tag = member && view?.kind === "pool" && !view.pool?.slotGroups ? POOL_TAGS[member.role] ?? "" : "";
    const groups = member && view?.pool?.slotGroups ? TRAINER_POOL_GROUPS
      .filter((_name, index) => (member.groups ?? 0) & trainerPoolGroupBit(index + 1)).join(" · ") : "";
    const linked = member && !("pokemon" in member) ? `#${member.trainerId}` : "";
    const settings = member && "pokemon" in member ? member.pokemon.settings : view && view.kind !== "original" ? undefined : safe(() => hasTrainerMemberCustomization(project) ? getTrainerMemberSettings(project, trainer.id, pok.slot) : undefined, undefined);
    const movePools = member ? ("pokemon" in member ? member.pokemon.movePools : safe(() => getTrainerSlotMovePools(project, member.trainerId, member.slot), undefined))
      : view && view.kind !== "original" ? undefined : safe(() => getTrainerSlotMovePools(project, trainer.id, pok.slot), undefined);
    const dice = hasMoveAlternatives(movePools) ? `<span class="td-mon-dice" title="Its moves vary between battles" aria-label="Moves vary">⚄</span>` : "";
    return `
      <button class="td-mon${selected ? " is-selected" : ""}" type="button" role="tab" aria-selected="${selected}" data-slot="${pok.slot}"${view && view.kind !== "original" ? "" : ` data-mark-prefix="pokemon:${pok.slot}:"`}>
        ${item ? `<img class="td-item-icon" src="${itemIconSrc(item)}" alt="${escapeHtml(item)}" title="${escapeHtml(item)}" onerror="this.remove()">` : ""}
        ${groups ? `<span class="td-mon-tag" aria-label="Pools ${groups}">${groups}</span>` : ""}
        ${tag ? `<span class="td-mon-tag -${tag.toLowerCase()}">${tag}</span>` : ""}
        ${linked ? `<span class="td-mon-link" title="Linked from trainer ${escapeHtml(linked)}">${escapeHtml(linked)}</span>` : ""}
        <span class="td-mon-icon trainer-poks">${renderPartyIcon(project, pok, "td-mon-sprite")}</span>
        <span class="td-mon-name">${settings?.shiny === 1 ? `<span class="td-shiny-mark" title="Shiny">✦</span>` : ""}${escapeHtml(nickname || pok.speciesName)}${dice}</span>
        <span class="td-mon-meta">${nickname ? `${escapeHtml(pok.speciesName)} · ` : ""}Lv ${pok.level}${renderCardCondition(project, pok, settings)}</span>
      </button>
    `;
  });
  if (!view?.readonly && trainer.party.length < (view?.limit ?? 6)) {
    cards.push(`<button class="td-mon td-mon-add" type="button" data-party-add><span class="td-mon-plus" aria-hidden="true">+</span><span>${view?.kind === "pool" ? "Add candidate" : "Add Pokémon"}</span></button>`);
  }
  return cards.join("");
}

/** A party card's status icon and a small HP bar when the Pokémon starts the battle hurt. */
function renderCardCondition(project: ProjectState, pok: TrainerPokemonSlot, settings: TrainerMemberSettings | undefined): string {
  if (!settings) return "";
  const choice = STATUS_CHOICES[settings.status];
  const status = choice?.icon === undefined ? "" : `<span class="td-status-icon td-card-status" data-g5-ui="status:${choice.icon}" title="${escapeHtml(frostbiteSnowLabel(project, choice.label))}">${choice.text}</span>`;
  const max = settings.hpMode ? safe(() => trainerMaxHp(project, pok.speciesId, pok.form, pok.level, pok.ivs), undefined) : undefined;
  const share = !settings.hpMode ? 100 : max ? (trainerStartingHp(max, settings.hpMode, settings.hp) / max) * 100 : settings.hpMode === 1 ? settings.hp : 100;
  const hp = share < 100 ? `<span class="td-card-hp" title="Starts at ${Math.round(share)}% HP"><span class="${share > 50 ? "-high" : share > 20 ? "-mid" : "-low"}" style="width:${share.toFixed(1)}%"></span></span>` : "";
  return status || hp ? ` ${status}${hp}` : "";
}

/** A row of buttons that pick one value; the pressed one is the current value. */
type Choice = { value: string | number; content: string; title?: string; pressed: boolean; disabled?: boolean; className?: string };
function choiceButtons(attribute: string, field: string, choices: Choice[], label: string): string {
  return `<span class="td-choices" role="group" aria-label="${escapeHtml(label)}">${choices.map((choice) => `<button class="td-choice${choice.className ? ` ${choice.className}` : ""}" type="button" ${attribute}="${escapeHtml(field)}" data-value="${escapeHtml(String(choice.value))}" aria-pressed="${choice.pressed}"${choice.title ? ` title="${escapeHtml(choice.title)}" aria-label="${escapeHtml(choice.title)}"` : ""}${choice.disabled ? " disabled" : ""}>${choice.content}</button>`).join("")}</span>`;
}

/** Status options in the patch's order, with the menus' icon for each (gen5UiImages STATUS_ICON). */
const STATUS_CHOICES: ReadonlyArray<{ label: string; icon?: number; text: string }> = [
  { label: "No status", text: "None" },
  { label: "Paralysis", icon: STATUS_ICON.paralysis, text: "PAR" },
  { label: "Sleep", icon: STATUS_ICON.sleep, text: "SLP" },
  { label: "Freeze", icon: STATUS_ICON.freeze, text: "FRZ" },
  { label: "Burn", icon: STATUS_ICON.burn, text: "BRN" },
  { label: "Poison", icon: STATUS_ICON.poison, text: "PSN" },
  { label: "Toxic (badly poisoned)", icon: STATUS_ICON.toxic, text: "TOX" },
];

/** Shininess, starting HP and starting status: Trainer Customization's per-Pokémon battle settings. */
function renderTrainerCustomization(project: ProjectState, trainerId: number, pok: TrainerPokemonSlot, override?: TrainerMemberSettings, nickname?: string): string {
  // Shown whenever the patch can be used; the first change installs it.
  if (!trainerCustomizationAvailable(project)) return "";
  const slot = pok.slot;
  const settings = override ?? getTrainerMemberSettings(project, trainerId, slot);
  const name = nickname ?? getTrainerSlotNickname(project, trainerId, slot);
  const mark = (field: keyof TrainerMemberSettings) => (override ? "" : `pokemon:${slot}:customization:${field}`);
  // Trainer Pokémon are never shiny unless set, so "Never shiny" reads as Default.
  const shiny = choiceButtons("data-member-choice", "shiny", [
    { value: 0, content: "Default", pressed: settings.shiny !== 1 },
    { value: 1, content: `<span class="td-shiny-mark" aria-hidden="true">✦</span>Shiny`, pressed: settings.shiny === 1 },
  ], "Shininess");
  const status = choiceButtons("data-member-choice", "status", STATUS_CHOICES.map((choice, index) => ({
    value: index,
    title: frostbiteSnowLabel(project, choice.label),
    pressed: settings.status === index,
    className: choice.icon === undefined ? "" : "-status",
    content: choice.icon === undefined ? choice.text : `<span class="td-status-icon" data-g5-ui="status:${choice.icon}">${choice.text}</span>`,
  })), "Starting status");
  const sleep = settings.status === 2
    ? `<span class="td-sleep"><span class="md-unit">Turns</span>${choiceButtons("data-member-choice", "sleepTurns", ["Random", "1", "2", "3"].map((label, index) => ({ value: index, content: label, pressed: settings.sleepTurns === index })), "Sleep turns")}</span>`
    : "";
  return `
    ${formRow("Nickname", override ? "" : `pokemon:${slot}:nickname`, `<input type="text" aria-label="Nickname" data-trainer-nickname maxlength="${TRAINER_NICKNAME_MAX_LENGTH}"
      value="${escapeHtml(name)}" placeholder="${escapeHtml(pok.speciesName)}">`)}
    ${formRow("Shiny", mark("shiny"), shiny)}
    ${formRow("Pre-Dmg", override ? "" : `${mark("hpMode")}|${mark("hp")}`, renderHpBar(project, pok, settings))}
    ${formRow("Pre-Status", override ? "" : `${mark("status")}|${mark("sleepTurns")}`, `<span class="td-status-row">${status}${sleep}</span>`)}
  `;
}

/**
 * Starting HP as the game's HP bar: drag it to start at a share of the maximum, or type an exact number. The number
 * is worked out from the Pokémon's base HP, level and IVs (trainer Pokémon have no EVs).
 */
function renderHpBar(project: ProjectState, pok: TrainerPokemonSlot, settings: TrainerMemberSettings): string {
  const max = trainerMaxHp(project, pok.speciesId, pok.form, pok.level, pok.ivs);
  const percent = settings.hpMode === 1 ? settings.hp : settings.hpMode === 2 && max ? Math.min(100, (settings.hp / max) * 100) : 100;
  const current = max === undefined ? undefined : trainerStartingHp(max, settings.hpMode, settings.hp);
  const share = current !== undefined && max ? (current / max) * 100 : percent;
  const tone = share > 50 ? "-high" : share > 20 ? "-mid" : "-low";
  const mode = settings.hpMode === 0 ? "Full" : settings.hpMode === 1 ? `${settings.hp}%` : "Exact";
  const valueText = current === undefined ? `${Math.round(percent)}%` : `${current} of ${max} HP`;
  return `<span class="td-hp" data-hp-max="${max ?? ""}">
    <span class="td-hp-bar" role="slider" tabindex="0" aria-label="Starting HP" aria-valuemin="1" aria-valuemax="100" aria-valuenow="${Math.round(percent)}" aria-valuetext="${escapeHtml(valueText)}" title="Drag to set the starting HP">
      <span class="td-hp-tag" aria-hidden="true">HP</span>
      <span class="td-hp-track"><span class="td-hp-fill ${tone}" style="width:${share.toFixed(2)}%"></span></span>
    </span>
    ${current === undefined
      ? `<span class="md-unit">${escapeHtml(valueText)}</span>`
      : `<input class="td-hp-number" type="number" min="1" max="${max}" value="${current}" data-hp-exact aria-label="Starting HP (exact)"><span class="md-unit">/ ${max}</span>`}
    <span class="md-unit td-hp-mode">${escapeHtml(mode)}</span>
  </span>`;
}

function renderGenderChoices(project: ProjectState, trainer: TrainerRecord, pok: TrainerPokemonSlot, ownParty = true): string {
  const defaultGender = ownParty ? safe(() => resolveTrainerPokemonGender(project, trainer.id, pok.slot), "") : "";
  const can = safe(() => trainerGenderAvailability(project, pok.speciesId, pok.form), { male: true, female: true });
  const icon = (gender: "male" | "female") => `<span class="td-gender-icon -${gender}" data-g5-ui="gender:${gender}">${gender === "male" ? "♂" : "♀"}</span>`;
  return choiceButtons("data-slot-choice", `gender_${pok.slot}`, [
    { value: "Default", content: "Default", title: defaultGender ? `Default (${defaultGender.toLowerCase()})` : "Default", pressed: pok.gender === "Default" || !TRAINER_GENDERS.includes(pok.gender) },
    { value: "Male", content: icon("male"), title: "Male", pressed: pok.gender === "Male", disabled: !can.male && pok.gender !== "Male" },
    { value: "Female", content: icon("female"), title: "Female", pressed: pok.gender === "Female", disabled: !can.female && pok.gender !== "Female" },
  ], "Gender");
}

function renderAbilityChoices(project: ProjectState, pok: TrainerPokemonSlot): string {
  const options = getTrainerPokemonAbilityOptions(project, pok);
  const nameOf = (label: string) => label.includes(": ") ? label.slice(label.indexOf(": ") + 2) : "";
  const seen = new Set<string>();
  const choices: Choice[] = [];
  for (const option of options) {
    const pressed = option.slot === pok.abilitySlot;
    if (option.slot === 0) {
      choices.push({ value: 0, content: "Default", title: option.label, pressed });
      continue;
    }
    const name = nameOf(option.label);
    // A slot without its own ability (or repeating an earlier one) only shows while it is the one chosen.
    if (!pressed && (!name || name === "-" || seen.has(name.toLowerCase()))) continue;
    seen.add(name.toLowerCase());
    const tag = option.slot === 3 ? "H" : option.slot >= 4 ? `AI${option.slot - 3}` : "";
    choices.push({ value: option.slot, content: `${escapeHtml(titleCaseName(name || option.label))}${tag ? `<span class="td-choice-tag">${tag}</span>` : ""}`, title: option.label, pressed });
  }
  return choiceButtons("data-slot-choice", `ability_${pok.slot}`, choices, "Ability");
}

/** Up to six forms get a button each, showing the form's icon; species with more (Unown, Arceus) keep the number field. */
const MAX_FORM_BUTTONS = 6;
function renderFormField(project: ProjectState, pok: TrainerPokemonSlot): string {
  const forms = safe(() => trainerFormOptions(project, pok.speciesId, pok.speciesName), [] as ReturnType<typeof trainerFormOptions>);
  const current = forms.find((entry) => entry.form === pok.form);
  if (forms.length > 1 && forms.length <= MAX_FORM_BUTTONS && current) {
    return `<span class="td-forms trainer-poks">${choiceButtons("data-slot-choice", `form_${pok.slot}`, forms.map(({ form, label }) => ({
      value: form,
      title: `${label} (form ${form})`,
      pressed: form === pok.form,
      className: "-form",
      content: renderPartyIcon(project, { ...pok, form, spriteSlug: trainerPokemonSpriteSlug(pok.speciesName, form) }, "td-form-icon"),
    })), "Form")}<span class="md-unit td-form-name">${escapeHtml(current.label)}</span></span>`;
  }
  const name = forms.length > 1 ? current?.label ?? "Not a form of this species" : "";
  return `${editable("trpok", `form_${pok.slot}`, pok.form, "", { type: "int-255" })}${name ? `<span class="md-unit td-form-name">${escapeHtml(name)}</span>` : ""}`;
}

function titleCaseName(name: string): string {
  return name === name.toUpperCase() ? name.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (letter) => letter.toUpperCase()) : name;
}

function renderPoolPlacement(pool: TrainerPartyPool, member: TrainerPoolMember): string {
  if (pool.slotGroups) {
    return formRow("Pools", "", choiceButtons("data-pool-group", "group", TRAINER_POOL_GROUPS.map((name, index) => ({
      value: index + 1,
      content: name,
      title: `Pool ${name}`,
      pressed: Boolean((member.groups ?? 0) & trainerPoolGroupBit(index + 1)),
    })), "Slot pools"));
  }
  return formRow("Tag", "", choiceButtons("data-pool-role", "role", POOL_TAGS.map((label, index) => ({
    value: index, content: label || "Any slot", pressed: member.role === index,
    title: ["Any slot in the middle", "Leads the party", "Comes out last"][index],
  })), "Tag"));
}

export function renderTrainerSlotEditor(project: ProjectState, trainer: TrainerRecord, pok: TrainerPokemonSlot, natureField: boolean, view?: RosterView): string {
  const s = pok.slot;
  const iv = Math.floor((pok.ivs * 31) / 255);
  const own = !view || view.kind === "original";
  const full = trainer.party.length >= (view?.limit ?? 6);
  const last = trainer.party.length - 1;
  // Changelog marks belong to the trainer's own party; other rosters have no per-field history.
  const mark = (field: string) => (own ? `pokemon:${s}:${field}_${s}` : "");
  const member = view?.pool?.members[s];
  if (view?.readonly) return renderReadonlySlot(project, pok, view);
  if (member && !("pokemon" in member)) return renderLinkedMember(project, pok, view!, member);
  const pokemon = member && "pokemon" in member ? member.pokemon : undefined;
  const battleStart = renderTrainerCustomization(project, trainer.id, pok, pokemon?.settings, pokemon ? pokemon.nickname ?? "" : undefined);
  const tagRow = view?.kind === "pool" && view.pool && member ? renderPoolPlacement(view.pool, member) : "";
  return `
    <div class="td-slot-head">
      <h2>${view?.kind === "pool" ? "Candidate" : "Pokémon"} ${s + 1}<span class="td-slot-species" data-derived="species">${escapeHtml(pok.speciesName)}</span></h2>
      <div class="td-slot-actions">
        <button class="btn sm -ghost" type="button" data-slot-move="-1" title="Move left" aria-label="Move left" ${s === 0 ? "disabled" : ""}>←</button>
        <button class="btn sm -ghost" type="button" data-slot-move="1" title="Move right" aria-label="Move right" ${s === last ? "disabled" : ""}>→</button>
        <button class="btn sm" type="button" data-slot-duplicate ${full ? 'disabled title="The party is full"' : ""}>Duplicate</button>
        ${own ? `<button class="btn sm" type="button" data-slot-copy title="Copy this set as Showdown text">Copy</button>
        <button class="btn sm" type="button" data-slot-import title="Replace this set from Showdown text">Import</button>` : ""}
        <button class="btn sm -remove" type="button" data-slot-delete>Delete</button>
      </div>
    </div>
    <div class="td-slot-grid expanded-pok" data-sub-index="${s}">
      <div class="md-form">
        ${formRow("Species", mark("species_id"), editable("trpok", `species_id_${s}`, pok.speciesName, "td-species", { autofill: "pokemon_names" }))}
        ${formRow("Level", mark("level"), editable("trpok", `level_${s}`, pok.level, "", { type: "int-100" }))}
        ${formRow("Form", mark("form"), `<span class="td-derived-value" data-derived="form">${renderFormField(project, pok)}</span>`)}
        ${formRow("Gender", mark("gender"), `<span class="td-derived-value" data-derived="gender">${renderGenderChoices(project, trainer, pok, own)}</span>`)}
        ${formRow("Ability", mark("ability"), `<span class="td-derived-value" data-derived="ability">${renderAbilityChoices(project, pok)}</span>`)}
        ${formRow("IVs", mark("ivs"), `${editable("trpok", `ivs_${s}`, pok.ivs, "", { type: "int-255" })}<span class="md-unit" data-derived="iv">IV ${iv} in every stat</span>`)}
        ${natureField || !own
          ? formRow("Nature", mark("nature"), select(`nature_${s}`, [["Auto", `Auto${pok.natureSetting === "Auto" && pok.nature && pok.nature !== "Auto" ? ` (${pok.nature})` : ""}`], ...NATURES.map((nature) => [nature, nature] as [string, string])], pok.natureSetting, "data-slot-select"))
          : formRow("Nature", "", `<span class="td-readonly" data-derived="nature">${escapeHtml(pok.nature)}</span><span class="md-unit" title="Without the trainer nature patch the game derives the nature from the trainer, class and Pokémon. Install Trainer Customization under Tools to choose one.">derived</span>`)}
      </div>
      <div class="td-moves">
        ${renderSlotMoves(project, trainer, pok, member && "pokemon" in member ? member.pokemon.movePools : own ? safe(() => getTrainerSlotMovePools(project, trainer.id, s), undefined) : undefined)}
        <div class="md-form td-held">
          ${formRow("Held item", mark("item_id"), editable("trpok", `item_id_${s}`, trainer.hasItems ? pok.itemName : "", "", { autofill: "items", placeholder: "None" }))}
        </div>
      </div>
      ${battleStart || tagRow ? `<div class="md-form td-battle-start" data-derived="battle-start">${tagRow}${battleStart}</div>` : ""}
    </div>
  `;
}

function renderReadonlySlot(project: ProjectState, pok: TrainerPokemonSlot, view: RosterView): string {
  const owner = view.record.id;
  const nickname = getTrainerSlotNickname(project, owner, pok.slot);
  return `<div class="td-slot-head"><h2>Pokémon ${pok.slot + 1}<span class="td-slot-species">${escapeHtml(nickname ? `${nickname} (${pok.speciesName})` : pok.speciesName)}</span></h2></div>
    <p class="td-roster-note">Lv ${pok.level}${pok.itemName && hasItem(pok.itemName) ? ` · holds ${escapeHtml(String(pok.itemName))}` : ""}${pok.moves.some((move) => hasItem(move)) ? ` · ${pok.moves.filter((move) => hasItem(move)).map((move) => escapeHtml(String(move))).join(", ")}` : ""}</p>
    <p class="td-roster-note">This party belongs to trainer #${owner}; edit it there. <a href="#" data-roster-open-trainer="${owner}">Open trainer #${owner}</a></p>`;
}

function renderLinkedMember(project: ProjectState, pok: TrainerPokemonSlot, view: RosterView, member: { trainerId: number; slot: number; role: number }): string {
  const last = view.record.party.length - 1;
  const nickname = getTrainerSlotNickname(project, member.trainerId, member.slot);
  return `<div class="td-slot-head">
      <h2>Candidate ${pok.slot + 1}<span class="td-slot-species">${escapeHtml(nickname ? `${nickname} (${pok.speciesName})` : pok.speciesName)}</span></h2>
      <div class="td-slot-actions">
        <button class="btn sm -ghost" type="button" data-slot-move="-1" title="Move left" aria-label="Move left" ${pok.slot === 0 ? "disabled" : ""}>←</button>
        <button class="btn sm -ghost" type="button" data-slot-move="1" title="Move right" aria-label="Move right" ${pok.slot === last ? "disabled" : ""}>→</button>
        <button class="btn sm -remove" type="button" data-slot-delete>Remove</button>
      </div>
    </div>
    <p class="td-roster-note">Linked from trainer #${member.trainerId}'s Pokémon ${member.slot + 1}: its species, level, moves and settings come from there.
      <a href="#" data-roster-open-trainer="${member.trainerId}">Open trainer #${member.trainerId}</a>
      <button class="btn sm" type="button" data-pool-unlink>Copy into this pool</button></p>
    <div class="md-form">${view.pool ? renderPoolPlacement(view.pool, member) : ""}</div>`;
}

/** A move's type, category and power cells. */
function moveCells(project: ProjectState, moveId: number, index: string): string {
  const preview = moveId > 0 ? getMovePreview(project, moveId) : undefined;
  return `
    <td data-derived="m${index}-type">${preview?.type ? `<span class="type-plate sm -${typeClass(preview.type)}">${escapeHtml(preview.type)}</span>` : ""}</td>
    <td class="td-move-cat" data-derived="m${index}-cat">${escapeHtml(titleize(preview?.category ?? ""))}</td>
    <td class="r" data-derived="m${index}-pow">${escapeHtml(String(preview?.power ?? "") === "0" ? "—" : String(preview?.power ?? ""))}</td>`;
}

const percentFormat = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 0 });

/** A move or alternative's weight, with its share of the slot's rolls. */
function moveWeight(slot: number, option: number | "own", weight: number, chance: number, editable: boolean): string {
  return `<span class="td-move-weight"><input type="number" min="${option === "own" ? 0 : 1}" max="65535" step="1" value="${weight}" data-move-weight="${slot}:${option}" aria-label="Weight"${editable ? "" : " disabled"}><span class="md-unit">${percentFormat.format(chance)}</span></span>`;
}

/** An empty alternative row for a move slot, filled in by typing a move. */
export function renderNewMoveAlternative(slot: number): string {
  return `<tr class="td-move-alt -new" data-move-alt-row="${slot}">
    <td><span class="td-move-alt-cell"><span class="td-move-or" aria-hidden="true">or</span>${editable("trmove", `movealt_${slot}_new`, "", "td-move", { autofill: "move_names", label: `Alternative to move ${slot + 1}` })}</span></td>
    <td colspan="5"></td>
  </tr>`;
}

function renderSlotMoves(project: ProjectState, trainer: TrainerRecord, pok: TrainerPokemonSlot, movePools?: TrainerMovePools): string {
  const moveNames = project.texts?.banks.moves ?? [];
  const defaults = trainer.hasMoves ? [] : safe(() => getAutofilledTrainerPokemonMoveIds(project, pok.speciesId, pok.level), [] as number[]);
  // Alternatives need Trainer Customization (installed on first use) and moves of the Pokémon's own to vary from.
  const varied = hasMoveAlternatives(movePools);
  const canEdit = (trainer.hasMoves || varied) && trainerCustomizationAvailable(project);
  // Saved alternatives stay visible (read-only) even when the patch can't be updated here.
  const alternatives = canEdit || varied;
  const ownMoves = [0, 1, 2, 3].map((index) => (trainer.hasMoves ? Math.max(0, moveNames.indexOf(String(pok.moves[index] ?? ""))) : 0));
  const rows = [0, 1, 2, 3].map((index) => {
    const slot = movePools?.[index];
    const alts = slot?.alternatives ?? [];
    const chances = slot && alts.length ? trainerMoveSlotChances(slot, ownMoves[index]!) : [];
    const altRows = alts.map((alt, k) => `
      <tr class="td-move-alt" data-move-alt-row="${index}">
        <td><span class="td-move-alt-cell"><span class="td-move-or" aria-hidden="true">or</span>${editable("trmove", `movealt_${index}_${k}`, moveNames[alt.move] ?? alt.move, "td-move", { autofill: "move_names", label: `Alternative ${k + 1} to move ${index + 1}` })}</span></td>
        ${moveCells(project, alt.move, `${index}-${k}`)}
        <td class="td-move-odds">${moveWeight(index, k, alt.weight, chances[k + 1]?.chance ?? 0, canEdit)}</td>
        <td class="td-move-more">${canEdit ? `<button class="td-move-button" type="button" data-move-alt-remove="${index}:${k}" title="Remove this alternative" aria-label="Remove alternative ${k + 1} to move ${index + 1}">×</button>` : ""}</td>
      </tr>`).join("");
    const extra = alternatives ? `
        <td class="td-move-odds">${alts.length ? moveWeight(index, "own", slot!.weight, chances[0]?.chance ?? 0, canEdit) : ""}</td>
        <td class="td-move-more">${canEdit && alts.length < TRAINER_MOVE_SLOT_MAX ? `<button class="td-move-button" type="button" data-move-alt-add="${index}" title="Add a move this slot can use instead" aria-label="Add an alternative to move ${index + 1}">+</button>` : ""}</td>` : "";
    return renderSlotMoveRow(project, trainer, pok, index, moveNames, defaults, extra) + altRows;
  }).join("");
  const problem = varied && movePools ? trainerMovePoolProblem(movePools, ownMoves) : undefined;
  return `
    <table class="md-table td-move-table${alternatives ? " -alternatives" : ""}" aria-label="Moves">
      <thead><tr><th>Moves</th><th>Type</th><th>Category</th><th class="r">Power</th>${alternatives ? `<th class="td-move-odds">${varied ? "Weight" : ""}</th><th class="td-move-more"></th>` : ""}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${problem ? `<p class="td-roster-problem" role="alert">${escapeHtml(problem)} The game keeps this Pokémon's own moves until it can.</p>` : ""}
    ${varied ? `<p class="td-move-note">Each battle rolls one move per slot by weight, never the same move twice.</p>` : ""}
    <div class="td-moves-foot">
      <button class="btn sm" type="button" data-slot-autofill title="Fill with the last four level-up moves at this level">Autofill moves</button>
    </div>
  `;
}

/** A Pokémon's own move in one slot; `extra` holds the alternative cells when the table has them. */
function renderSlotMoveRow(
  project: ProjectState, trainer: TrainerRecord, pok: TrainerPokemonSlot, index: number, moveNames: readonly string[], defaults: readonly number[], extra: string,
): string {
    const field = `move_${index + 1}_${pok.slot}`;
    const name = trainer.hasMoves ? String(pok.moves[index] ?? "") : "";
    const defaultId = defaults[index] ?? 0;
    const previewId = trainer.hasMoves ? moveNames.indexOf(name) : defaultId;
    const preview = previewId > 0 ? getMovePreview(project, previewId) : undefined;
    const placeholder = !trainer.hasMoves && defaultId > 0 ? moveNames[defaultId] ?? "" : "";
    return `
      <tr data-move-row="${index}" data-mark-fields="pokemon:${pok.slot}:${field}|pokemon:${pok.slot}:autofill-moves|pokemon:${pok.slot}:move-pools"${trainer.hasMoves ? "" : ' class="-default"'}>
        <td>${editable("trpok", field, name, "td-move", { autofill: "move_names", placeholder })}</td>
        <td data-derived="m${index}-type">${preview?.type ? `<span class="type-plate sm -${typeClass(preview.type)}">${escapeHtml(preview.type)}</span>` : ""}</td>
        <td class="td-move-cat" data-derived="m${index}-cat">${escapeHtml(titleize(preview?.category ?? ""))}</td>
        <td class="r" data-derived="m${index}-pow">${escapeHtml(String(preview?.power ?? "") === "0" ? "—" : String(preview?.power ?? ""))}</td>${extra}
      </tr>
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
  const flagOn = (flag: string) => Number(trainer.readable[flag]) > 0;
  const common = TRAINER_AIS.filter((flag) => COMMON_AI_FLAGS.has(flag));
  const more = TRAINER_AIS.filter((flag) => !COMMON_AI_FLAGS.has(flag) && !SPECIAL_AI_FLAGS.has(flag));
  const special = TRAINER_AIS.filter((flag) => SPECIAL_AI_FLAGS.has(flag));
  const moreOn = [...more, ...special].filter(flagOn).length;
  const battleItems = [1, 2, 3, 4].map((n) => formRow(`Battle item ${n}`, `data:item_${n}`, editable("trdata", `item_${n}`, trainer.readable[`item_${n}`], "", { autofill: "items" }))).join("");
  // Most trainers carry no battle items, so four empty rows fold into one line until one is wanted.
  const noBattleItems = [1, 2, 3, 4].every((n) => Number(trainer.raw[`item_${n}`] ?? 0) === 0);
  return `
    <div class="section-bar">Trainer</div>
    ${noBattleItems ? `<details class="td-fold td-battle-items"><summary>Battle items <span class="md-unit">None</span></summary><div class="md-form">${battleItems}</div></details>` : ""}
    <div class="md-form">
      ${noBattleItems ? "" : battleItems}
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
    <div class="td-checks td-ai">${common.map(aiRow).join("")}</div>
    <details class="td-fold td-ai-more"${moreOn ? " open" : ""}>
      <summary>More AI flags${moreOn ? ` <span class="md-unit">${moreOn} on</span>` : ""}</summary>
      <div class="td-checks td-ai">${more.map(aiRow).join("")}</div>
      <div class="td-ai-group">Special encounters</div>
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
  narc: "trdata" | "trpok" | "trtext" | "trmove",
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
