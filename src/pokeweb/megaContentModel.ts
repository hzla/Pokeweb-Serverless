import contentJson from "../assets/data/megaContent.json";
import { unzipSync } from "fflate";
import { recordGenericChange } from "./actionChangelog";
import { ABILITY_IMPORT_LIBRARY } from "./abilityLibrary";
import { createCustomAbilities } from "./abilityEffectsModel";
import { loadCodeInjectionNarcs } from "./codeInjectionInstall";
import { getItemExpansionStatus, isItemExpansionInstalled, itemFamily, stageItemExpansion } from "./itemExpansionModel";
import { writeItemSprite } from "./itemSpriteModel";
import { megaFormSuffix, nameMegaForm } from "./megaEditorModel";
import { UNIVERSAL_STONE_CLASSES, getMegaEvolutionStatus, isMegaEvolutionInstalled, materializeMegaEvolutionTable, megaEvolutionVersion, stageMegaEvolution, type MegaRoute } from "./megaEvolutionModel";
import { allocateMoveExpansionParticleAssets, detectMoveExpansionPatch } from "./moveExpansionPatch";
import { addPokemonForm } from "./pokemonFormModel";
import { addFairyTypeSupport, addMoveExpansion, detectFairyTypePatch } from "./romPatchModel";
import { updatePokemonField } from "./pokemonModel";
import { installPokemonIconPayload, resolvePokemonIconAddress } from "./pokemonSpriteModel";
import { decodeRecord, markDirty, type ProjectState } from "./projectStore";
import { applyPwanCarrierPatch, loadBundledPwanCarrierTemplate } from "./pwanCarrierPatch";
import { buildPwanOverrideSideFromPwanBytes, findPwanOverrideForSpecies, hasPwanRuntimeDll, installPwanRuntime, resolvePwanSpeciesTarget, upsertPwanOverrideSide } from "./pwanAnimationModel";
import { importPwanLibraryEntryFromLoadedLibrary, listLoadedPwanLibraryEntries, loadPwanLibrary } from "./pwanLibraryModel";
import { NintendoDSRom } from "../nds/rom";
import { loadActiveRomBytes } from "./persistence";
import { addTextEntries, commitTextBank, getTextBank } from "./textModel";

/**
 * The Mega Evolution content package: the Mega forms of species 1-649 (stats, types, abilities, weight), their Mega
 * Stones (item IDs 657-780, with the item expansion), animated sprites and icons, Hibiki's transformation
 * animation, the battle messages and the routes, all from the user's White2Upgrade / pokebw2 work
 * (runtime/mega-evolution/content/build_content.py builds the package).
 *
 * Black / White take the same package: their sprite, icon, item and battle-effect archives have Black 2 / White 2's
 * formats (the Mega sprites stream through the animated sprite streaming runtime); the battle messages go to Black /
 * White's own bank and the animation script drops the Black 2 / White 2-only background commands.
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
/** The battle's "set" messages (player / wild / foe triplets, command 0x5b): the same bank in both games' order. */
const battleMessageBank = (project: ProjectState) => (project.session.baseRom === "BW" ? 14 : 18);
const STONE_ITEM_TEMPLATE = 229; // Everstone: a held item without a battle function
const PLACEHOLDER = "???";

export type MegaContentStatus = {
  supported: boolean;
  installed: boolean;
  ready: boolean;
  forms: number;
  /** The Mega Pokémon are installed but the transformation animation isn't (installed before it could be). */
  animationMissing: boolean;
  /** The Mega Pokémon were installed before the Mega Ring was part of the package (set ringItem to 0 to go without). */
  ringMissing: boolean;
  /** The Mega Pokémon were installed before the universal stones (Megite, Megite X, Y, Z, G). */
  universalMissing: boolean;
  /** G-Max Megas installed (of GMAX_MEGAS). */
  gmaxForms: number;
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
  /** Move Expansion, which Mega Rayquaza (Dragon Ascent) needs: installed by this install, already there, or not possible. */
  moveExpansion?: "installed" | "present" | "unavailable";
  /** Fairy Type Support was installed with the Mega Pokémon. */
  fairyTypeInstalled?: boolean;
  /** The universal stones' item IDs (Megite, Megite X, Y, Z, G), when this install added them. */
  universalStones?: number[];
  /** G-Max Megas this install added. */
  gmax?: string[];
};

export type MegaContentOptions = {
  /** Also install the G-Max Megas (G-Max artwork as Megas with the base form's stats, types and abilities). */
  gmax?: boolean;
};

export function getMegaContentStatus(project: ProjectState): MegaContentStatus {
  const supported = Boolean(megaEvolutionVersion(project));
  const installed = Boolean(project.codeInjection?.megaEvolution?.content);
  const status: MegaContentStatus = { supported, installed, ready: false, forms: project.codeInjection?.megaEvolution?.content?.forms.length ?? 0,
    animationMissing: installed && !project.codeInjection?.megaEvolution?.animationMove,
    ringMissing: installed && project.codeInjection?.megaEvolution?.ringItem === undefined,
    universalMissing: installed && !project.codeInjection?.megaEvolution?.universalStones,
    gmaxForms: project.codeInjection?.megaEvolution?.content?.forms.filter((form) => form.key.startsWith("GMAX_MEGA_")).length ?? 0, message: "" };
  if (!supported) return { ...status, message: "Mega Pokémon support US Black, White, Black 2 and White 2." };
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

/**
 * National ability IDs as this ROM knows them: retail IDs as they are, newer ones by name or created from the ability
 * library, all new ones in one runtime build. Unknown IDs map to undefined (the form keeps its base ability there).
 */
export async function resolveAbilities(project: ProjectState, forms: ReadonlyArray<Pick<MegaContentForm, "abilities" | "abilityNames" | "abilityDescriptions">>,
  report: Pick<MegaContentReport, "abilitiesAdded">): Promise<Map<number, number | undefined>> {
  const resolved = new Map<number, number | undefined>();
  const names = project.texts.banks.abilities ?? [];
  const toCreate: Array<{ national: number; name: string; rules: (typeof ABILITY_IMPORT_LIBRARY)[number]["rule"]; description?: string }> = [];
  for (const form of forms) {
    for (const id of form.abilities) {
      if (resolved.has(id) || toCreate.some((entry) => entry.national === id)) continue;
      if (id <= 164) { resolved.set(id, id); continue; }
      const name = form.abilityNames[String(id)];
      const existing = name ? names.findIndex((candidate) => normalize(candidate ?? "") === normalize(name)) : -1;
      if (existing > 0) { resolved.set(id, existing); continue; }
      const template = name ? ABILITY_IMPORT_LIBRARY.find((entry) => entry.id === id) : undefined;
      if (!template) { resolved.set(id, undefined); continue; }
      toCreate.push({ national: id, name: template.defaultName, rules: template.rule, description: form.abilityDescriptions[String(id)] });
    }
  }
  const created = await createCustomAbilities(project, toCreate.map(({ name, rules, description }) => ({ name, rules, description })));
  toCreate.forEach((entry, index) => { resolved.set(entry.national, created[index]); report.abilitiesAdded.push(entry.name); });
  return resolved;
}

function setPersonal(project: ProjectState, personalId: number, field: string, value: number): void {
  updatePokemonField(project, personalId, "personal", field, String(value));
}

function appendTriplets(project: ProjectState, texts: string[][]): number {
  const bankId = battleMessageBank(project);
  const bank = getTextBank(project, "message_texts", bankId);
  const first = bank.length;
  addTextEntries(project, "message_texts", bankId, texts.length * 3);
  const grown = getTextBank(project, "message_texts", bankId);
  texts.flat().forEach((text, index) => { grown[first + index][1] = text; });
  commitTextBank(project, "message_texts", bankId);
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
  const textBanks = itemFamily(project).textBanks;
  const banks = {
    names: getTextBank(project, "message_texts", textBanks.names),
    descriptions: getTextBank(project, "message_texts", textBanks.descriptions),
    plurals: getTextBank(project, "message_texts", textBanks.plurals),
    articles: getTextBank(project, "message_texts", textBanks.articles),
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
  for (const bank of Object.values(textBanks)) commitTextBank(project, "message_texts", bank);
  for (const stone of stones) {
    const pixels = new Uint8ClampedArray(file(files, stone.icon ?? MEGA_CONTENT.genericStoneIcon));
    writeItemSprite(project, romBytes, stone.id, { width: 32, height: 32, pixels }, 0, 0, false);
  }
}

/**
 * The Mega Ring: the key item the player needs in the bag to Mega Evolve (the runtime's ringItem). White2Upgrade's
 * item: ID 124, an unused retail slot in all four games (so a retail save can hold it), its data (Key Items, important,
 * no price, sort index 23), text and icon.
 */
export const MEGA_RING_ITEM = 124;
const MEGA_RING = {
  name: "Mega Ring",
  plural: "Mega Rings",
  description: "This ring contains an untold power that\\nsomehow enables Pokémon carrying Mega\\nStones to Mega Evolve in battle.",
};

/**
 * Black 2 / White 2 read a retail item's pocket from ARM9's table (pokebw2's sItemPockets; the item expansion's bag
 * validator too), Black / White from the item data (the expansion's PWIP table is filled from it at export).
 */
const BW2_ITEM_POCKET_TABLE: Partial<Record<string, number>> = { B2: 0x0208f4d0, W2: 0x0208f4fc };
const KEY_ITEMS_POCKET = 4;

function installMegaRing(project: ProjectState, romBytes: Uint8Array, files: Record<string, Uint8Array>): void {
  const textBanks = itemFamily(project).textBanks;
  const names = getTextBank(project, "message_texts", textBanks.names);
  const current = names[MEGA_RING_ITEM]?.[1]?.trim() ?? "";
  if (current && current !== PLACEHOLDER && current !== MEGA_RING.name) {
    throw new Error(`Item ${MEGA_RING_ITEM} is already "${current}"; the Mega Ring needs that ID.`);
  }
  const record = stoneRecord(project);
  record[8] = 0x3f; record[9] = 0x02; // natural gift type none (31), important, field pocket Key Items (4)
  record[13] = 0; record[15] = 23; // item class 0, sort index 23
  project.narcs.items!.rawFiles[MEGA_RING_ITEM] = record;
  project.narcs.items!.records.delete(MEGA_RING_ITEM);
  markDirty(project, "items", MEGA_RING_ITEM);
  const pocketTable = BW2_ITEM_POCKET_TABLE[project.session.baseVersion];
  if (pocketTable !== undefined) {
    if (!project.arm9.length) throw new Error("Reload the ROM before installing the Mega Ring.");
    project.arm9[pocketTable - new NintendoDSRom(romBytes, { fileData: "view" }).arm9RamAddress + MEGA_RING_ITEM] = KEY_ITEMS_POCKET;
    project.arm9Dirty = true;
  }
  names[MEGA_RING_ITEM][1] = MEGA_RING.name;
  getTextBank(project, "message_texts", textBanks.descriptions)[MEGA_RING_ITEM][1] = MEGA_RING.description;
  getTextBank(project, "message_texts", textBanks.plurals)[MEGA_RING_ITEM][1] = MEGA_RING.plural;
  getTextBank(project, "message_texts", textBanks.articles)[MEGA_RING_ITEM][1] = article(MEGA_RING.name);
  for (const bank of Object.values(textBanks)) commitTextBank(project, "message_texts", bank);
  // The package's generic stone icon is White2Upgrade's Mega Ring icon.
  writeItemSprite(project, romBytes, MEGA_RING_ITEM, { width: 32, height: 32, pixels: new Uint8ClampedArray(file(files, MEGA_CONTENT.genericStoneIcon)) }, 0, 0, false);
}

/** Custom Mega Stones go after the package's stones (657-780), in Item Expansion's free placeholder slots. */
export const CUSTOM_MEGA_STONE_IDS = { first: 781, last: 1023 } as const;

/**
 * Creates a Mega Stone for a custom Mega Evolution in the first free item slot from 781: White2Upgrade's stone item
 * data (no price, no hold effect), name, plural, article, a description naming the Pokémon and the generic stone icon.
 * Needs Item Expansion. Returns the item ID.
 */
export async function stageCustomMegaStone(project: ProjectState, stone: { name: string; pokemon: string; description?: string }): Promise<number> {
  const name = stone.name.trim();
  if (!name) throw new Error("Name the Mega Stone.");
  if (name.length > 16) throw new Error("Item names fit 16 characters.");
  if (!isItemExpansionInstalled(project)) throw new Error("Mega Stones need Item Expansion (install Mega Evolution first).");
  project.originalRomBytes ??= await loadActiveRomBytes();
  if (!project.originalRomBytes) throw new Error("Reload the ROM before adding a Mega Stone.");
  const rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
  loadCodeInjectionNarcs(project, rom, ["items", "message_texts"]);
  const names = getTextBank(project, "message_texts", itemFamily(project).textBanks.names);
  const taken = names.findIndex((entry, id) => id > 0 && entry?.[1]?.trim().toLowerCase() === name.toLowerCase());
  if (taken > 0) throw new Error(`Item ${taken} is already called ${name}.`);
  let id: number = CUSTOM_MEGA_STONE_IDS.first;
  const free = (candidate: number) => {
    const current = names[candidate]?.[1]?.trim() ?? "";
    return !current || current === PLACEHOLDER;
  };
  while (id <= CUSTOM_MEGA_STONE_IDS.last && !free(id)) id++;
  if (id > CUSTOM_MEGA_STONE_IDS.last || !names[id] || !project.narcs.items!.rawFiles[id]) throw new Error(`No free item slot between ${CUSTOM_MEGA_STONE_IDS.first} and ${CUSTOM_MEGA_STONE_IDS.last}.`);
  const description = stone.description?.trim() || `One of the mysterious Mega Stones.\\nHave ${stone.pokemon} hold it, and it\\ncan Mega Evolve in battle.`;
  installStones(project, project.originalRomBytes, await loadContentFiles(), [{ id, key: `CUSTOM_${id}`, name, forms: [], description }]);
  recordGenericChange(project, "items", `Mega Stone: ${name} (item ${id}).`, "Mega Evolution", { key: `items:mega-stone:${id}` });
  return id;
}

/**
 * The universal stones: each lets any Pokémon Mega Evolve into its Mega form of that kind ("-Mega", "-Mega-X" ...;
 * megaEvolutionModel's route classes). Five consecutive item IDs, in class order.
 */
export const UNIVERSAL_STONES = UNIVERSAL_STONE_CLASSES.map((kind) => {
  const name = kind ? `Megite ${kind}` : "Megite";
  return { name, description: `A Mega Stone for any Pokémon with\\na Mega${kind ? ` ${kind}` : ""} form: hold it, and it can\\nMega Evolve in battle.` };
});

/**
 * G-Max artwork as Megas (White2Upgrade's import, the PWAN library's "GMAX_MEGA_" entries of species 1-649), with the
 * base form's stats, types and abilities. A species that already has a Mega gets "-Mega-G" and "<its stone> G"; the
 * others get "-Mega" and a stone of their own.
 */
export const GMAX_MEGAS: ReadonlyArray<{ key: string; species: number; stone: string; iconOf?: string }> = [
  { key: "GMAX_MEGA_VENUSAUR_2", species: 3, stone: "Venusaurite G", iconOf: "Venusaurite" },
  { key: "GMAX_MEGA_CHARIZARD_3", species: 6, stone: "Charizardite G", iconOf: "Charizardite X" },
  { key: "GMAX_MEGA_BLASTOISE_2", species: 9, stone: "Blastoisinite G", iconOf: "Blastoisinite" },
  { key: "GMAX_MEGA_BUTTERFREE_1", species: 12, stone: "Butterfreeite" },
  { key: "GMAX_MEGA_PIKACHU_17", species: 25, stone: "Pikachuite" },
  { key: "GMAX_MEGA_MEOWTH_3", species: 52, stone: "Meowthite" },
  { key: "GMAX_MEGA_MACHAMP_1", species: 68, stone: "Machampite" },
  { key: "GMAX_MEGA_GENGAR_2", species: 94, stone: "Gengarite G", iconOf: "Gengarite" },
  { key: "GMAX_MEGA_KINGLER_1", species: 99, stone: "Kinglerite" },
  { key: "GMAX_MEGA_LAPRAS_1", species: 131, stone: "Laprasite" },
  { key: "GMAX_MEGA_EEVEE_2", species: 133, stone: "Eeveeite" },
  { key: "GMAX_MEGA_SNORLAX_1", species: 143, stone: "Snorlaxite" },
  { key: "GMAX_MEGA_GARBODOR_1", species: 569, stone: "Garbodorite" },
];

/** Free item slots for the added stones: the rest of the package's range (740-780), then the custom stones' range. */
const EXTRA_STONE_RANGES: Array<[number, number]> = [[740, 780], [CUSTOM_MEGA_STONE_IDS.first, CUSTOM_MEGA_STONE_IDS.last]];

function freeItemIds(project: ProjectState, count: number, consecutive: boolean, taken: Set<number>): number[] {
  const names = getTextBank(project, "message_texts", itemFamily(project).textBanks.names);
  const free = (id: number) => !taken.has(id) && Boolean(names[id] && project.narcs.items!.rawFiles[id]) &&
    (!names[id][1]?.trim() || names[id][1].trim() === PLACEHOLDER);
  const out: number[] = [];
  for (const [first, last] of EXTRA_STONE_RANGES) {
    for (let id = first; id <= last && out.length < count; id++) {
      if (!free(id)) { if (consecutive) out.length = 0; continue; }
      out.push(id);
    }
    if (out.length === count) break;
    if (consecutive) out.length = 0;
  }
  if (out.length < count) throw new Error(`No ${consecutive ? `${count} consecutive` : count} free item slots for the Mega Stones (740-1023).`);
  out.forEach((id) => taken.add(id));
  return out;
}

/**
 * The universal stones (if missing) and, with `gmax`, the G-Max Megas that are missing, with their stones and routes.
 * On a staged project whose Mega content is installed (stageMegaContent calls it; so does Update Mega Evolution).
 */
export async function stageMegaExtras(project: ProjectState, options: MegaContentOptions = {}): Promise<{
  universalStones?: number[]; gmax: MegaContentReport["forms"]; stones: number;
}> {
  const config = project.codeInjection?.megaEvolution;
  if (!config?.content) throw new Error("Install Mega Evolution first.");
  if (!project.originalRomBytes) throw new Error("Reload the ROM before installing the Mega content.");
  const rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
  loadCodeInjectionNarcs(project, rom, ["personal", "learnsets", "evolutions", "pokemon_sprites", "pokemon_icons", "message_texts", "items"]);
  const files = await loadContentFiles();
  const taken = new Set<number>();
  const result: { universalStones?: number[]; gmax: MegaContentReport["forms"]; stones: number } = { gmax: [], stones: 0 };
  const stones: MegaContentStone[] = [];
  let universalStones = config.universalStones;
  if (!universalStones) {
    const ids = freeItemIds(project, UNIVERSAL_STONES.length, true, taken);
    UNIVERSAL_STONES.forEach((stone, index) => stones.push({ id: ids[index], key: `UNIVERSAL_${index}`, name: stone.name, forms: [], description: stone.description }));
    universalStones = ids[0];
    result.universalStones = ids;
  }
  const routes: MegaRoute[] = [];
  const formsInstalled: NonNullable<typeof config.content>["forms"] = [];
  if (options.gmax) {
    const library = await loadPwanLibrary();
    const carrier = await loadBundledPwanCarrierTemplate(project.session.baseVersion === "B2" ? "B2" : "W2");
    const have = new Set(config.content.forms.map((form) => form.key));
    for (const gmax of GMAX_MEGAS) {
      if (have.has(gmax.key) || !decodeRecord(project, "personal", gmax.species).raw) continue;
      const entry = listLoadedPwanLibraryEntries(library).find((candidate) => candidate.key === gmax.key);
      if (!entry) throw new Error(`The PWAN library has no ${gmax.key}.`);
      const baseName = entry.name.split("-")[0];
      const suffix = entry.name.slice(baseName.length + 1); // "Mega" or "Mega-G"
      const name = `Mega ${baseName}${suffix === "Mega-G" ? " G" : ""}`;
      // addPokemonForm copies the base form's personal record: the base form's stats, types and abilities.
      const added = addPokemonForm(project, gmax.species);
      nameMegaForm(project, added.personalId, suffix);
      importPwanLibraryEntryFromLoadedLibrary(project, added.personalId, entry.id, library, carrier);
      const [id] = freeItemIds(project, 1, false, taken);
      const icon = gmax.iconOf ? MEGA_CONTENT.stones.find((stone) => stone.name === gmax.iconOf)?.icon : undefined;
      stones.push({ id, key: `${gmax.key}_STONE`, name: gmax.stone, forms: [gmax.key], icon,
        description: `One of the mysterious Mega Stones.\\nHave ${baseName} hold it, and it\\ncan Mega Evolve in battle.` });
      routes.push({ species: gmax.species, trigger: id, sourceForm: 0, targetForm: added.formIndex });
      const credits = { front: entry.credits ?? "—", back: entry.credits ?? "—" };
      formsInstalled.push({ key: gmax.key, name, species: gmax.species, form: added.formIndex, credits });
      result.gmax.push({ key: gmax.key, name, species: gmax.species, form: added.formIndex, trigger: `item ${id}`, credits: `front: ${credits.front}; back: ${credits.back}` });
    }
  }
  if (stones.length) installStones(project, project.originalRomBytes, files, stones);
  result.stones = stones.length - (result.universalStones?.length ?? 0);
  project.codeInjection!.megaEvolution = {
    ...config,
    universalStones,
    routes: [...config.routes, ...routes],
    content: { ...config.content, forms: [...config.content.forms, ...formsInstalled], stones: [...config.content.stones, ...stones.map((stone) => stone.id)] },
  };
  materializeMegaEvolutionTable(project);
  if (stones.length) {
    recordGenericChange(project, "code_injection",
      [result.universalStones ? `universal stones ${UNIVERSAL_STONES.map((stone) => stone.name).join(", ")} (items ${result.universalStones[0]}-${result.universalStones.at(-1)})` : "",
        result.gmax.length ? `${result.gmax.length} G-Max Megas (${result.gmax.map((form) => form.name).join(", ")}; the base forms' stats; sprites by Smogon/Sprites Animados Contributors)` : ""]
        .filter(Boolean).join("; ").replace(/^./u, (first) => `Mega Evolution: ${first}`) + ".",
      "Mega Evolution", { key: "code-injection:mega-extras" });
  }
  return result;
}

/** Hibiki's animation, with its particles appended to the SPA archive, as a member past the move expansion's 1,000. */
const BATTLE_EFFECT_FIRST = 0x231; // effect IDs from here read the battle-effect archive (ID - 0x231): a/0/6/6, a/0/6/7 in Black / White

/**
 * Hibiki's transformation animation and its particles. With Move Expansion on Black 2 / White 2 it goes past member
 * 1,000 of the move animations (played as its ID + 115, the expansion's routing); otherwise at the end of the
 * battle-effect archive, which the retail engine plays for any effect ID from 0x231 (ID - 0x231). Black / White's
 * Move Expansion routes expanded moves through the move command (the runtime's direct call never passes it) and
 * leaves effect IDs from 0x231 alone, so Black / White always use the battle-effect archive. Returns the effect ID.
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
  const viaMoveExpansion = project.session.baseRom !== "BW" && detectMoveExpansionPatch(project) === "patched";
  loadCodeInjectionNarcs(project, rom, ["move_spas", viaMoveExpansion ? "move_animations" : "battle_animations"]);
  const { remapMoveAnimationAssets } = await import("./moveAnimationModel");
  const target = project.session.baseRom === "BW" ? "BW" : "BW2";
  return installAnimation(project, files, (bytes, map) => remapMoveAnimationAssets(bytes, map, new Map(), target).bytes, viaMoveExpansion);
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

/** Adds the Mega Ring to a project whose Mega Pokémon predate it, and makes Mega Evolution need it. */
export async function stageMegaRing(project: ProjectState): Promise<void> {
  const config = project.codeInjection?.megaEvolution;
  if (!config?.content) throw new Error("Install Mega Evolution first.");
  if (!project.originalRomBytes) throw new Error("Reload the ROM before installing the Mega content.");
  loadCodeInjectionNarcs(project, new NintendoDSRom(project.originalRomBytes, { fileData: "view" }), ["message_texts", "items"]);
  installMegaRing(project, project.originalRomBytes, await loadContentFiles());
  project.codeInjection!.megaEvolution = { ...config, ringItem: MEGA_RING_ITEM };
  materializeMegaEvolutionTable(project);
  recordGenericChange(project, "code_injection", `Mega Evolution: the Mega Ring (item ${MEGA_RING_ITEM}), needed to Mega Evolve.`, "Mega Evolution",
    { key: "code-injection:mega-ring" });
}

/**
 * Installs the package on a staged project (through installCodeInjectionPatch): the runtime if needed, then every
 * Mega form whose species exists. Needs Item Expansion; the PWAN runtime must be installed first
 * (installMegaContent does both).
 */
export async function stageMegaContent(project: ProjectState, options: MegaContentOptions = {}): Promise<MegaContentReport> {
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

  const installable = MEGA_CONTENT.forms.flatMap((form) => {
    let moveTrigger: number | undefined;
    if (form.move) {
      moveTrigger = moveNames.findIndex((name) => normalize(name ?? "") === normalize(form.move!.name));
      if (moveTrigger <= 0) { report.skipped.push({ name: form.name, reason: `needs the move ${form.move.name} (Move Expansion)` }); return []; }
    }
    if (!decodeRecord(project, "personal", form.species).raw) { report.skipped.push({ name: form.name, reason: "the species is missing" }); return []; }
    return [{ form, moveTrigger }];
  });
  const abilities = await resolveAbilities(project, installable.map(({ form }) => form), report);

  for (const { form, moveTrigger } of installable) {
    const added = addPokemonForm(project, form.species);
    const personalId = added.personalId;
    nameMegaForm(project, personalId, megaFormSuffix(form.name, form.baseName));
    const stats: Array<[string, number]> = [["base_hp", form.stats[0]], ["base_atk", form.stats[1]], ["base_def", form.stats[2]],
      ["base_speed", form.stats[3]], ["base_spatk", form.stats[4]], ["base_spdef", form.stats[5]]];
    for (const [field, value] of stats) setPersonal(project, personalId, field, value);
    form.types.forEach((type, slot) => {
      if (type < typeCount) setPersonal(project, personalId, `type_${slot + 1}`, type);
      else report.typeFallbacks.push(`${form.name} (Fairy needs the Fairy type patch)`);
    });
    for (let slot = 0; slot < 3; slot++) {
      const ability = abilities.get(form.abilities[slot]);
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
  installMegaRing(project, project.originalRomBytes, files);

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
    ringItem: MEGA_RING_ITEM,
    content: { version: MEGA_CONTENT_VERSION, forms: formsInstalled, stones: stones.map((stone) => stone.id) },
  };
  const extras = await stageMegaExtras(project, options);
  report.universalStones = extras.universalStones;
  report.gmax = extras.gmax.map((form) => form.name);
  report.stones += extras.stones;
  report.forms.push(...extras.gmax);
  materializeMegaEvolutionTable(project);
  recordGenericChange(project, "code_injection",
    `Mega content: ${formsInstalled.length} Mega forms, ${stones.length} Mega Stones, the Mega Ring (item ${MEGA_RING_ITEM}, needed to Mega Evolve)${animationMove ? ", Hibiki's transformation animation" : ""}. ` +
    `Mega Evolution by Dararo; battle UI and animation by Hibiki; sprites by ${[...new Set(formsInstalled.flatMap((form) => [form.credits.front, form.credits.back]))]
      .filter((credit) => credit !== "—").join("; ")}.`,
    "Mega Evolution", { key: "code-injection:mega-content" });
  return report;
}

/** The PWAN runtime (the sprites are streamed PWAN), then the package through the given staged installer. */
export async function installMegaContent(
  project: ProjectState,
  install: (stage: (staged: ProjectState) => Promise<MegaContentReport>) => Promise<MegaContentReport>,
  options: MegaContentOptions = {},
): Promise<MegaContentReport> {
  const status = getMegaContentStatus(project);
  if (!status.ready) throw new Error(status.message);
  if (!hasPwanRuntimeDll(project)) await installPwanRuntime(project);
  // Fairy Type Support first, so the Fairy Megas get their type (and Move Expansion its Fairy moves); then Move
  // Expansion, so the content adds Mega Rayquaza (Dragon Ascent) and, on Black 2 / White 2, routes the animation.
  const fairyBefore = detectFairyTypePatch(project);
  if (fairyBefore === "unpatched") await addFairyTypeSupport(project, { updateModernFairyTypings: true });
  let moveExpansion: MegaContentReport["moveExpansion"] = "present";
  const moveState = detectMoveExpansionPatch(project);
  if (moveState === "unpatched" || moveState === "routing-only") {
    await addMoveExpansion(project);
    moveExpansion = "installed";
  } else if (moveState !== "patched") {
    moveExpansion = "unavailable";
  }
  const report = await install((staged) => stageMegaContent(staged, options));
  return { ...report, moveExpansion, fairyTypeInstalled: fairyBefore === "unpatched" && detectFairyTypePatch(project) === "patched" };
}
