import contentJson from "../assets/data/megaContent.json";
import { unzipSync } from "fflate";
import { recordGenericChange } from "./actionChangelog";
import { ABILITY_IMPORT_LIBRARY } from "./abilityLibrary";
import { createCustomAbility } from "./abilityEffectsModel";
import { loadCodeInjectionNarcs } from "./codeInjectionInstall";
import { getItemExpansionStatus, isItemExpansionInstalled, ITEM_TEXT_BANKS, stageItemExpansion } from "./itemExpansionModel";
import { writeItemSprite } from "./itemSpriteModel";
import { getMegaEvolutionStatus, isMegaEvolutionInstalled, materializeMegaEvolutionTable, megaEvolutionVersion, stageMegaEvolution, type MegaRoute } from "./megaEvolutionModel";
import { allocateMoveExpansionParticleAssets, detectMoveExpansionPatch } from "./moveExpansionPatch";
import { addPokemonForm } from "./pokemonFormModel";
import { detectFairyTypePatch } from "./romPatchModel";
import { updatePokemonField } from "./pokemonModel";
import { installPokemonIconPayload, resolvePokemonIconAddress } from "./pokemonSpriteModel";
import { decodeRecord, markDirty, type ProjectState } from "./projectStore";
import { applyPwanCarrierPatch, loadBundledPwanCarrierTemplate } from "./pwanCarrierPatch";
import { buildPwanOverrideSideFromPwanBytes, findPwanOverrideForSpecies, hasPwanRuntimeDll, installPwanRuntime, resolvePwanSpeciesTarget, upsertPwanOverrideSide } from "./pwanAnimationModel";
import { importPwanLibraryEntryFromLoadedLibrary, loadPwanLibrary } from "./pwanLibraryModel";
import { NintendoDSRom } from "../nds/rom";
import { addTextEntries, commitTextBank, getTextBank } from "./textModel";

/**
 * The Mega Evolution content package: the Mega forms of species 1-649 (stats, types, abilities, weight), their Mega
 * Stones (item IDs 657-780, with the item expansion), animated sprites and icons, Hibiki's transformation
 * animation, the battle messages and the routes, all from the user's White2Upgrade / pokebw2 work
 * (runtime/mega-evolution/content/build_content.py builds the package).
 */

type SpriteSource = { source: string; credits: string };
export type MegaContentForm = {
  key: string;
  name: string;
  species: number;
  baseName: string;
  stats: number[];
  types: number[];
  abilities: number[];
  abilityNames: Record<string, string>;
  abilityDescriptions: Record<string, string>;
  height: number;
  weight: number;
  stone?: number;
  move?: { id: number; name: string };
  library?: string;
  icon?: { male: string; female: string; malePaletteId: number; femalePaletteId: number };
  sprites: Partial<Record<"front" | "back", SpriteSource>>;
};
export type MegaContentStone = { id: number; key: string; name: string; forms: string[]; description: string; icon?: string };
type MegaContent = {
  format: string;
  credits: Array<{ name: string; role: string }>;
  animation: { script: string; particles: Record<string, string>; revealFrame: number };
  genericStoneIcon: string;
  forms: MegaContentForm[];
  stones: MegaContentStone[];
  zipSha256: string;
};

const CONTENT_ZIP_URL = new URL("../assets/mega/megaContent.zip", import.meta.url);
export const MEGA_CONTENT = contentJson as unknown as MegaContent;
export const MEGA_CONTENT_VERSION = 1;
const BATTLE_MESSAGE_BANK = 18;
const STONE_ITEM_TEMPLATE = 229; // Everstone: a held item without a battle function
const PLACEHOLDER = "???";

export type MegaContentStatus = {
  supported: boolean;
  installed: boolean;
  ready: boolean;
  forms: number;
  /** The Mega Pokémon are installed but the transformation animation isn't (installed before it could be). */
  animationMissing: boolean;
  message: string;
};

export type MegaContentReport = {
  forms: Array<{ key: string; name: string; species: number; form: number; trigger: string; credits: string }>;
  stones: number;
  skipped: Array<{ name: string; reason: string }>;
  abilitiesAdded: string[];
  abilityFallbacks: string[];
  typeFallbacks: string[];
  animation: boolean;
};

export function getMegaContentStatus(project: ProjectState): MegaContentStatus {
  const supported = Boolean(megaEvolutionVersion(project));
  const installed = Boolean(project.codeInjection?.megaEvolution?.content);
  const status: MegaContentStatus = { supported, installed, ready: false, forms: project.codeInjection?.megaEvolution?.content?.forms.length ?? 0,
    animationMissing: installed && !project.codeInjection?.megaEvolution?.animationMove, message: "" };
  if (!supported) return { ...status, message: "Mega Pokémon support US Black 2 and White 2." };
  if (installed) return { ...status, message: `${status.forms} Mega forms are installed.` };
  if (!isItemExpansionInstalled(project)) {
    const items = getItemExpansionStatus(project); // installed with the Mega content: the Mega Stones use item IDs 657-780
    if (!items.compatible) return { ...status, message: items.message };
  }
  const mega = getMegaEvolutionStatus(project);
  if (!mega.installed && !mega.compatible) return { ...status, message: mega.message };
  return { ...status, ready: true, message: "Ready to install." };
}

/** One line per credit, for the card and the changelog. */
export function megaSpriteCredits(): Array<{ name: string; front: string; back: string }> {
  return MEGA_CONTENT.forms.map((form) => ({ name: form.name, front: form.sprites.front?.credits ?? "—", back: form.sprites.back?.credits ?? "—" }));
}

async function loadContentFiles(): Promise<Record<string, Uint8Array>> {
  const response = await fetch(CONTENT_ZIP_URL);
  if (!response.ok) throw new Error("Could not load the Mega content package.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hex !== MEGA_CONTENT.zipSha256) throw new Error("The bundled Mega content package is invalid; reload Pokeweb.");
  return unzipSync(bytes);
}

function file(files: Record<string, Uint8Array>, name: string): Uint8Array {
  const bytes = files[name];
  if (!bytes) throw new Error(`The Mega content package is missing ${name}.`);
  return bytes;
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

/** A national ability ID as this ROM knows it: retail IDs as they are, newer ones by name or from the library. */
async function resolveAbility(project: ProjectState, form: MegaContentForm, id: number, report: MegaContentReport): Promise<number | undefined> {
  if (id <= 164) return id;
  const name = form.abilityNames[String(id)];
  if (!name) return undefined;
  const names = project.texts.banks.abilities ?? [];
  const existing = names.findIndex((candidate) => normalize(candidate ?? "") === normalize(name));
  if (existing > 0) return existing;
  const template = ABILITY_IMPORT_LIBRARY.find((entry) => entry.id === id);
  if (!template) return undefined;
  const created = await createCustomAbility(project, template.defaultName, template.rule, form.abilityDescriptions[String(id)]);
  report.abilitiesAdded.push(template.defaultName);
  return created;
}

function setPersonal(project: ProjectState, personalId: number, field: string, value: number): void {
  updatePokemonField(project, personalId, "personal", field, String(value));
}

function appendTriplets(project: ProjectState, texts: string[][]): number {
  const bank = getTextBank(project, "message_texts", BATTLE_MESSAGE_BANK);
  const first = bank.length;
  addTextEntries(project, "message_texts", BATTLE_MESSAGE_BANK, texts.length * 3);
  const grown = getTextBank(project, "message_texts", BATTLE_MESSAGE_BANK);
  texts.flat().forEach((text, index) => { grown[first + index][1] = text; });
  commitTextBank(project, "message_texts", BATTLE_MESSAGE_BANK);
  return first;
}

/** The battle messages: each a player / wild / foe triplet, as the battle picks them by the first argument. */
function installMessages(project: ProjectState): { reacting: number; evolved: number; wish: number } {
  const first = appendTriplets(project, [
    [
      "VAR(258, 0)'s VAR(265, 1) is reacting\\nto VAR(256, 2)'s Mega Ring!",
      "The wild VAR(258, 0)'s VAR(265, 1)\\nis reacting to VAR(256, 2)'s Mega Ring!",
      "The foe's VAR(258, 0)'s VAR(265, 1)\\nis reacting to VAR(256, 2)'s Mega Ring!",
    ],
    [
      "VAR(258, 0) has Mega Evolved!",
      "The wild VAR(258, 0) has Mega Evolved!",
      "The foe's VAR(258, 0) has Mega Evolved!",
    ],
    [
      "VAR(256, 1)'s fervent wish has\\nreached VAR(258, 0)!",
      "VAR(256, 1)'s fervent wish has\\nreached the wild VAR(258, 0)!",
      "VAR(256, 1)'s fervent wish has\\nreached the foe's VAR(258, 0)!",
    ],
  ]);
  return { reacting: first, evolved: first + 3, wish: first + 6 };
}

function stoneRecord(project: ProjectState): Uint8Array {
  const record = project.narcs.items!.rawFiles[STONE_ITEM_TEMPLATE].slice();
  // White2Upgrade's Mega Stones: no price, no hold effect, no Fling, Items pocket, no battle use, sorted last.
  record[0] = 0; record[1] = 0; record[2] = 0; record[3] = 0; record[4] = 0; record[5] = 0; record[6] = 0; record[7] = 0;
  record[8] = 31; record[9] = 0; record[10] = 0; record[11] = 0; record[12] = 0; record[13] = 1; record[14] = 0; record[15] = 255;
  return record;
}

function article(name: string): string {
  return `VAR(48385)${/^[aeiou]/iu.test(name) ? "an" : "a"} VAR(65280, 255)${name}`;
}

function installStones(project: ProjectState, romBytes: Uint8Array, files: Record<string, Uint8Array>, stones: MegaContentStone[]): void {
  const store = project.narcs.items!;
  const banks = {
    names: getTextBank(project, "message_texts", ITEM_TEXT_BANKS.names),
    descriptions: getTextBank(project, "message_texts", ITEM_TEXT_BANKS.descriptions),
    plurals: getTextBank(project, "message_texts", ITEM_TEXT_BANKS.plurals),
    articles: getTextBank(project, "message_texts", ITEM_TEXT_BANKS.articles),
  };
  for (const stone of stones) {
    const current = banks.names[stone.id]?.[1]?.trim() ?? "";
    if (current && current !== PLACEHOLDER && current !== stone.name) {
      throw new Error(`Item ${stone.id} is already "${current}"; the Mega Stones need IDs ${stones[0].id}-${stones.at(-1)!.id}.`);
    }
  }
  for (const stone of stones) {
    store.rawFiles[stone.id] = stoneRecord(project);
    store.records.delete(stone.id);
    markDirty(project, "items", stone.id);
    banks.names[stone.id][1] = stone.name;
    banks.descriptions[stone.id][1] = stone.description;
    banks.plurals[stone.id][1] = `${stone.name}s`;
    banks.articles[stone.id][1] = article(stone.name);
  }
  for (const bank of Object.values(ITEM_TEXT_BANKS)) commitTextBank(project, "message_texts", bank);
  for (const stone of stones) {
    const pixels = new Uint8ClampedArray(file(files, stone.icon ?? MEGA_CONTENT.genericStoneIcon));
    writeItemSprite(project, romBytes, stone.id, { width: 32, height: 32, pixels }, 0, 0, false);
  }
}

/** Hibiki's animation, with its particles appended to the SPA archive, as a member past the move expansion's 1,000. */
const BATTLE_EFFECT_FIRST = 0x231; // effect IDs from here read the battle-effect archive a/0/6/6 (ID - 0x231)

/**
 * Hibiki's transformation animation and its particles. With Move Expansion it goes past member 1,000 of the move
 * animations (played as its ID + 115, the expansion's routing); without it, at the end of the battle-effect archive,
 * which the retail engine plays for any effect ID from 0x231 (ID - 0x231). Returns the effect ID for the table.
 */
function installAnimation(project: ProjectState, files: Record<string, Uint8Array>, remap: (bytes: Uint8Array, map: Map<number, number>) => Uint8Array,
  viaMoveExpansion: boolean): number {
  const particles = project.narcs.move_spas!;
  const allocation = allocateMoveExpansionParticleAssets(particles, Object.entries(MEGA_CONTENT.animation.particles)
    .map(([id, name]) => ({ sourceParticleId: Number(id), bytes: file(files, name) })));
  for (const id of allocation.addedIds) markDirty(project, "move_spas", id);
  const script = remap(file(files, MEGA_CONTENT.animation.script), allocation.particleIdMap);
  if (viaMoveExpansion) {
    const animations = project.narcs.move_animations!;
    const member = Math.max(1000, animations.rawFiles.length);
    while (animations.rawFiles.length < member) animations.rawFiles.push(animations.rawFiles[0].slice());
    animations.rawFiles[member] = script;
    animations.fileCount = animations.rawFiles.length;
    animations.records.delete(member);
    markDirty(project, "move_animations", member);
    return member + 115;
  }
  const effects = project.narcs.battle_animations!;
  let member = effects.rawFiles.findIndex((existing) => existing.length === script.length && existing.every((byte, index) => byte === script[index]));
  if (member < 0) {
    member = effects.rawFiles.length;
    effects.rawFiles.push(script);
    effects.fileCount = effects.rawFiles.length;
    effects.records.delete(member);
    markDirty(project, "battle_animations", member);
  }
  return BATTLE_EFFECT_FIRST + member;
}

async function stageAnimation(project: ProjectState, rom: NintendoDSRom, files: Record<string, Uint8Array>): Promise<number> {
  const viaMoveExpansion = detectMoveExpansionPatch(project) === "patched";
  loadCodeInjectionNarcs(project, rom, ["move_spas", viaMoveExpansion ? "move_animations" : "battle_animations"]);
  const { remapMoveAnimationAssets } = await import("./moveAnimationModel");
  return installAnimation(project, files, (bytes, map) => remapMoveAnimationAssets(bytes, map, new Map(), "BW2").bytes, viaMoveExpansion);
}

/** Adds the transformation animation to a project whose Mega Pokémon were installed without it. */
export async function stageMegaAnimation(project: ProjectState): Promise<number> {
  const config = project.codeInjection?.megaEvolution;
  if (!config?.content) throw new Error("Install Mega Evolution first.");
  if (!project.originalRomBytes) throw new Error("Reload the ROM before installing the Mega content.");
  const animationMove = await stageAnimation(project, new NintendoDSRom(project.originalRomBytes, { fileData: "view" }), await loadContentFiles());
  project.codeInjection!.megaEvolution = { ...config, animationMove, revealFrame: MEGA_CONTENT.animation.revealFrame };
  materializeMegaEvolutionTable(project);
  recordGenericChange(project, "code_injection", "Mega Evolution: Hibiki's transformation animation.", "Mega Evolution", { key: "code-injection:mega-animation" });
  return animationMove;
}

/**
 * Installs the package on a staged project (through installCodeInjectionPatch): the runtime if needed, then every
 * Mega form whose species exists. Needs Item Expansion; the PWAN runtime must be installed first
 * (installMegaContent does both).
 */
export async function stageMegaContent(project: ProjectState): Promise<MegaContentReport> {
  const status = getMegaContentStatus(project);
  if (!status.ready) throw new Error(status.message);
  if (!project.originalRomBytes) throw new Error("Reload the ROM before installing the Mega content.");
  const rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
  if (!isItemExpansionInstalled(project)) await stageItemExpansion(project);
  loadCodeInjectionNarcs(project, rom, ["personal", "learnsets", "evolutions", "pokemon_sprites", "pokemon_icons", "message_texts", "items"]);
  if (!isMegaEvolutionInstalled(project) || getMegaEvolutionStatus(project).updateAvailable) await stageMegaEvolution(project);
  const [files, library, carrier] = await Promise.all([
    loadContentFiles(),
    loadPwanLibrary(),
    loadBundledPwanCarrierTemplate(project.session.baseVersion === "B2" ? "B2" : "W2"),
  ]);
  const report: MegaContentReport = { forms: [], stones: 0, skipped: [], abilitiesAdded: [], abilityFallbacks: [], typeFallbacks: [], animation: false };
  const typeCount = detectFairyTypePatch(project) === "patched" ? 18 : 17; // type 17 is Fairy
  const moveNames = project.texts.banks.moves ?? [];
  const routes: MegaRoute[] = [];
  const formsInstalled: Array<{ key: string; name: string; species: number; form: number; credits: { front: string; back: string } }> = [];

  for (const form of MEGA_CONTENT.forms) {
    let moveTrigger: number | undefined;
    if (form.move) {
      moveTrigger = moveNames.findIndex((name) => normalize(name ?? "") === normalize(form.move!.name));
      if (moveTrigger <= 0) { report.skipped.push({ name: form.name, reason: `needs the move ${form.move.name} (Move Expansion)` }); continue; }
    }
    const base = decodeRecord(project, "personal", form.species).raw;
    if (!base) { report.skipped.push({ name: form.name, reason: "the species is missing" }); continue; }
    const added = addPokemonForm(project, form.species);
    const personalId = added.personalId;
    const stats: Array<[string, number]> = [["base_hp", form.stats[0]], ["base_atk", form.stats[1]], ["base_def", form.stats[2]],
      ["base_speed", form.stats[3]], ["base_spatk", form.stats[4]], ["base_spdef", form.stats[5]]];
    for (const [field, value] of stats) setPersonal(project, personalId, field, value);
    form.types.forEach((type, slot) => {
      if (type < typeCount) setPersonal(project, personalId, `type_${slot + 1}`, type);
      else report.typeFallbacks.push(`${form.name} (Fairy needs the Fairy type patch)`);
    });
    for (let slot = 0; slot < 3; slot++) {
      const ability = await resolveAbility(project, form, form.abilities[slot], report);
      if (ability === undefined) {
        if (slot === 0) report.abilityFallbacks.push(`${form.name}: ${form.abilityNames[String(form.abilities[slot])] ?? form.abilities[slot]}`);
        continue; // the form keeps its base form's ability in this slot
      }
      setPersonal(project, personalId, `ability_${slot + 1}`, ability);
    }
    setPersonal(project, personalId, "weight", form.weight);
    setPersonal(project, personalId, "height", Math.round(form.height / 10));

    // Sprites: the PWAN library's entry, then any side only White2Upgrade has (credited "Unknown").
    if (form.library) importPwanLibraryEntryFromLoadedLibrary(project, personalId, form.library, library, carrier);
    const target = resolvePwanSpeciesTarget(project, personalId);
    let extraSides = false;
    for (const side of ["front", "back"] as const) {
      const sprite = form.sprites[side];
      if (!sprite || sprite.source === "library") continue;
      upsertPwanOverrideSide(project, {
        speciesId: target.speciesId, formIndex: target.formIndex, assetIndex: target.assetIndex === target.speciesId ? undefined : target.assetIndex,
        side, sideData: buildPwanOverrideSideFromPwanBytes(file(files, sprite.source), `White2Upgrade/${form.name}/${side}.pwan`),
      });
      extraSides = true;
    }
    if (extraSides) applyPwanCarrierPatch(project, findPwanOverrideForSpecies(project, personalId)!, carrier);
    if (form.icon) {
      installPokemonIconPayload(project, target.assetIndex, {
        male: file(files, form.icon.male), female: file(files, form.icon.female), malePaletteId: form.icon.malePaletteId, femalePaletteId: form.icon.femalePaletteId,
      }, resolvePokemonIconAddress(project, target.speciesId, target.formIndex, target.assetIndex));
    }
    routes.push(moveTrigger !== undefined
      ? { species: form.species, trigger: moveTrigger, sourceForm: 0, targetForm: added.formIndex, moveTrigger: true }
      : { species: form.species, trigger: form.stone!, sourceForm: 0, targetForm: added.formIndex });
    formsInstalled.push({ key: form.key, name: form.name, species: form.species, form: added.formIndex,
      credits: { front: form.sprites.front?.credits ?? "—", back: form.sprites.back?.credits ?? "—" } });
    report.forms.push({ key: form.key, name: form.name, species: form.species, form: added.formIndex,
      trigger: moveTrigger !== undefined ? form.move!.name : `item ${form.stone}`,
      credits: `front: ${form.sprites.front?.credits ?? "—"}; back: ${form.sprites.back?.credits ?? "—"}` });
  }

  const usedStones = new Set(routes.filter((route) => !route.moveTrigger).map((route) => route.trigger));
  const stones = MEGA_CONTENT.stones.filter((stone) => usedStones.has(stone.id));
  installStones(project, project.originalRomBytes, files, stones);
  report.stones = stones.length;

  const messages = installMessages(project);
  const animationMove = await stageAnimation(project, rom, files);
  report.animation = true;

  const config = project.codeInjection!.megaEvolution!;
  const existing = config.routes.filter((route) => !routes.some((added) => added.species === route.species && added.trigger === route.trigger));
  project.codeInjection!.megaEvolution = {
    ...config,
    routes: [...existing, ...routes],
    messages,
    animationMove,
    revealFrame: MEGA_CONTENT.animation.revealFrame,
    autoFoes: true,
    content: { version: MEGA_CONTENT_VERSION, forms: formsInstalled, stones: stones.map((stone) => stone.id) },
  };
  materializeMegaEvolutionTable(project);
  recordGenericChange(project, "code_injection",
    `Mega content: ${formsInstalled.length} Mega forms, ${stones.length} Mega Stones${animationMove ? ", Hibiki's transformation animation" : ""}. ` +
    `Mega Evolution by Dararo; battle UI and animation by Hibiki; sprites by ${[...new Set(formsInstalled.flatMap((form) => [form.credits.front, form.credits.back]))]
      .filter((credit) => credit !== "—").join("; ")}.`,
    "Mega Evolution", { key: "code-injection:mega-content" });
  return report;
}

/** The PWAN runtime (the sprites are streamed PWAN), then the package through the given staged installer. */
export async function installMegaContent(
  project: ProjectState,
  install: (stage: (staged: ProjectState) => Promise<MegaContentReport>) => Promise<MegaContentReport>,
): Promise<MegaContentReport> {
  const status = getMegaContentStatus(project);
  if (!status.ready) throw new Error(status.message);
  if (!hasPwanRuntimeDll(project)) await installPwanRuntime(project);
  return install((staged) => stageMegaContent(staged));
}
