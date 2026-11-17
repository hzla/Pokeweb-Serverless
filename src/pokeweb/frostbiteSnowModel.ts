import bundled from "../assets/codeinjection/frostbiteSnow.json";
import { readAscii, writeU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { loadOverlayTable } from "../nds/code";
import { NARC } from "../nds/narc";
import { recordGenericChange } from "./actionChangelog";
import { BATTLE_RUNTIME_SIGNATURES, battleBranchTarget } from "./battleRuntimeBindings";
import { installCodeInjectionPatch, loadCodeInjectionNarcs } from "./codeInjectionInstall";
import { getRomFileBytes, setRomFileReplacement } from "./fileSystemModel";
import { installSnowscapeAnimation } from "./moveExpansionPatch";
import { updateMoveDescription, updateMoveTextName } from "./moveTextModel";
import { listCodeInjectionDlls, stageCodeInjectionDll } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, writeRpm, type RpmModule, type RpmRelocation } from "./rpm";
import { addTextEntries, commitTextBank, getTextBank, parseTextEntryId } from "./textModel";

export type FrostbiteSnowPatch = "frostbite" | "snow";
type ClimatePatch = FrostbiteSnowPatch | "modern_status";
const names = { frostbite: "Frostbite", snow: "Snow", modern_status: "Modern Status Effects" };
const dllNames = { frostbite: "Frostbite.dll", snow: "Snow.dll", modern_status: "ModernStatus.dll" };
const versions = { frostbite: 3, snow: 1, modern_status: 1 };
const gameCodes = { B: "IRBO", W: "IRAO", B2: "IREO", W2: "IRDO" };
const hailMove = 258;
const nativeBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../gu) ?? [], byte => Number.parseInt(byte, 16));

function gameFor(project: ProjectState): keyof typeof gameCodes | undefined {
  const game = project.session.baseVersion;
  if (game !== "B" && game !== "W" && game !== "B2" && game !== "W2") return;
  const rom = project.originalRomBytes;
  if ((rom ? readAscii(rom, 12, 4) : project.romInfo?.idCode) !== gameCodes[game] || rom && rom[0x1e] !== 0) return;
  return game;
}

function pathFor(patch: ClimatePatch): string {
  return `patches/${dllNames[patch]}`;
}

function installedModule(project: ProjectState, patch: ClimatePatch): boolean {
  return listCodeInjectionDlls(project).some(entry => entry.path.toLowerCase() === pathFor(patch).toLowerCase());
}

function installedMetadata(project: ProjectState, patch: ClimatePatch, rom?: NintendoDSRom): RpmModule["metadata"] | undefined {
  const path = listCodeInjectionDlls(project).find(entry => entry.path.toLowerCase() === pathFor(patch).toLowerCase())?.path;
  if (!path) return;
  const added = project.fileSystem?.additions?.[path];
  if (!added && !rom && project.originalRomBytes) rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
  const id = rom?.filenames.idOf(path);
  const bytes = added ?? (rom && id !== undefined ? getRomFileBytes(project, rom, id) : undefined);
  return bytes && parseRpm(bytes, { allowedMagics: ["DLXF"] }).metadata;
}

function frostbiteDamageTextId(metadata: RpmModule["metadata"] | undefined): number | undefined {
  if (metadata?.PokewebFrostbiteSnow !== "frostbite" || ![1, 2, versions.frostbite].includes(Number(metadata.PokewebFrostbiteSnowVersion))) return;
  const id = metadata.PokewebFrostbiteDamageText;
  if (typeof id === "number" && Number.isInteger(id) && id > 0 && id <= 65532) return id;
}

function currentModule(metadata: RpmModule["metadata"] | undefined, patch: ClimatePatch, combined: boolean): boolean {
  return metadata?.PokewebFrostbiteSnow === patch && metadata.PokewebFrostbiteSnowVersion === versions[patch]
    && (patch === "snow" || metadata.PokewebCombinedStatus === Number(combined));
}

export function frostbiteSnowStatus(project: ProjectState, patch: ClimatePatch) {
  const supported = Boolean(gameFor(project));
  let installed = installedModule(project, patch);
  let updateAvailable = false;
  if (supported && installed && patch !== "snow") {
    try {
      const metadata = installedMetadata(project, patch);
      if (patch === "frostbite") updateAvailable = frostbiteDamageTextId(metadata) !== undefined
        && !currentModule(metadata, patch, installedModule(project, "modern_status"));
      else if (metadata) installed = metadata.PokewebFrostbiteSnow === patch;
    } catch {
      // An unrecognized binary is never offered as a supported update.
      if (patch === "modern_status") installed = false;
    }
  }
  return { supported, installed, updateAvailable };
}

export function frostbiteSnowLabel(project: ProjectState, label: string): string {
  if (/^Chance to freeze$/iu.test(label) && installedModule(project, "frostbite")) return "Chance for frostbite";
  if (/\b(?:Freeze|Frozen)\b/u.test(label) && installedModule(project, "frostbite"))
    return label.replace(/\b(?:Freeze|Frozen)\b/gu, "Frostbite");
  if (/\bHail\b/u.test(label) && installedModule(project, "snow")) return label.replace(/\bHail\b/gu, "Snow");
  return label;
}

type Pattern = { offset: number; hex: string; mask?: string };
type RuntimeTemplate = Omit<RpmModule, "code"> & { code: Iterable<number> };
type Site = Pattern & {
  calls: { api: number; offset: number; hex: string }[];
  edits: { offset: number; symbol?: string; branch?: boolean; hex?: string }[];
};
function patternMatches(data: Uint8Array, offset: number, bytes: Uint8Array, mask?: Uint8Array): boolean {
  return offset >= 0 && offset + bytes.length <= data.length
    && bytes.every((value, i) => ((data[offset + i] ^ value) & (mask?.[i] ?? 255)) === 0);
}

function locate(data: Uint8Array, pattern: Pattern, shift: number): number {
  const bytes = nativeBytes(pattern.hex), mask = pattern.mask && nativeBytes(pattern.mask);
  if (patternMatches(data, pattern.offset + shift, bytes, mask || undefined)) return pattern.offset + shift;
  let found = -1;
  for (let offset = 0; offset <= data.length - bytes.length; offset += 2) {
    if (!patternMatches(data, offset, bytes, mask || undefined)) continue;
    if (found !== -1) throw new Error("Ambiguous battle hook signature.");
    found = offset;
  }
  if (found === -1) throw new Error(`Unrecognized battle code near overlay offset 0x${pattern.offset.toString(16)}.`);
  return found;
}

function overlapsHook(module: RpmModule, overlay: string, start: number, size: number): boolean {
  return module.relocations.some(({ target, sourceSymbolIndex }) => {
    if (target.module !== overlay) return false;
    const address = target.address & ~1;
    const width = target.type === "FULL_COPY" ? module.symbols[sourceSymbolIndex]?.size : target.type === "THUMB_BRANCH_SAFESTACK"
      ? 16 : target.type === "THUMB_BRANCH" ? 8 : 4;
    return start < address + (width || 4) && address < start + size;
  });
}

export function buildFrostbiteSnowModule(project: ProjectState, patch: FrostbiteSnowPatch, rom: NintendoDSRom,
  damageText = 0, template = bundled.templates[patch] as RuntimeTemplate, combined = false): RpmModule {
  return buildClimateModule(project, patch, rom, damageText, combined, template);
}

function buildClimateModule(project: ProjectState, patch: ClimatePatch, rom: NintendoDSRom, damageText = 0,
  combined = false, template = bundled.templates[patch] as RuntimeTemplate): RpmModule {
  const game = gameFor(project);
  if (!game) throw new Error("Use a US revision-0 Black, White, Black 2 or White 2 ROM.");
  const profile = bundled.games[game];
  const overlayIds = patch === "frostbite" ? [profile.overlay, profile.clientOverlay] : [profile.overlay];
  const overlays = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
    (_id, fileId) => getRomFileBytes(project, rom, fileId), new Set(overlayIds));
  function overlayCode(id: number) {
    const entry = overlays.get(id);
    if (!entry) throw new Error(`Battle overlay ${id} is missing.`);
    return { base: entry.ramAddress, data: project.overlays[id] ?? entry.data };
  }
  const server = overlayCode(profile.overlay);
  const { code, ...rest } = structuredClone(template);
  const result: RpmModule = { ...rest, code: Uint8Array.from(code) };
  const api = result.symbols.find(symbol => symbol.name === "BattleClimateApi")!;
  const guards: { module: string; address: number; size: number }[] = [];
  function applySite(site: Site, targetModule: string,
    { base, data }: ReturnType<typeof overlayCode>, shift: number) {
    const found = locate(data, site, shift);
    guards.push({ module: targetModule, address: base + found, size: site.hex.length / 2 });
    for (const call of site.calls) {
      if (call.api * 4 >= api.size) continue;
      const target = battleBranchTarget(data, found + call.offset, base), offset = target - base;
      const fairyVariant = patch === "snow" && call.api === 1
        && BATTLE_RUNTIME_SIGNATURES.DoesMonHaveType.variants?.some(pattern =>
          patternMatches(data, offset, nativeBytes(pattern.hex), nativeBytes(pattern.mask)));
      if (!patternMatches(data, offset, nativeBytes(call.hex)) && !fairyVariant)
        throw new Error(`Unrecognized native service for the ${names[patch]} patch.`);
      writeU32(result.code, api.address + call.api * 4, target | 1);
    }
    for (const edit of site.edits) {
      const address = base + found + edit.offset;
      let type: RpmRelocation["target"]["type"], sourceSymbolIndex: number;
      if (edit.symbol) {
        sourceSymbolIndex = result.symbols.findIndex(symbol => symbol.name === edit.symbol);
        type = edit.branch ? "THUMB_BRANCH" : "THUMB_BRANCH_LINK";
      } else {
        const payload = nativeBytes(edit.hex!);
        const joined = new Uint8Array(result.code.length + payload.length);
        joined.set(result.code);
        joined.set(payload, result.code.length);
        sourceSymbolIndex = result.symbols.length;
        result.symbols.push({ name: null, address: result.code.length, size: payload.length, type: "SECTION", attributes: 0 });
        result.code = joined;
        type = "FULL_COPY";
      }
      if (sourceSymbolIndex < 0) throw new Error("The bundled patch is missing a hook.");
      result.relocations.push({ target: { module: targetModule, address, type }, sourceSymbolIndex });
    }
    return found - site.offset;
  }
  let shift = 0;
  const sites = patch === "modern_status" ? [...profile.modern, ...(combined ? [] : [...profile.modernFreeze, profile.damageSite])] : profile[patch];
  for (const site of sites) shift = applySite(site, String(profile.overlay), server, shift);
  const { base, data } = server;
  const bind = (helper: Pattern & { api: number }) =>
    writeU32(result.code, api.address + helper.api * 4, (base + locate(data, helper, shift)) | 1);
  if (patch === "frostbite") {
    applySite(profile.frostbiteSprite, String(profile.clientOverlay), overlayCode(profile.clientOverlay), 0);
    for (const helper of profile.helpers) bind(helper);
    writeU32(result.code, api.address + 36, 0x259);
    writeU32(result.code, api.address + 40, damageText);
  } else if (patch === "modern_status") {
    bind(profile.battleRandom);
    if (result.symbols.some(symbol => symbol.name === "BattleClimateTest")) {
      bind(profile.helpers[2]);
      for (const site of profile.modernProbes) applySite(site, String(profile.overlay), server, shift);
    }
  } else if (api.size >= 20) {
    const id = profile.helpers.find(helper => helper.api === 8)!;
    writeU32(result.code, api.address + 16, (base + locate(data, id, shift)) | 1);
  }
  if ((patch === "frostbite" && combined) || (patch === "modern_status" && !combined)) bind(profile.eventValue);
  for (const { path, target } of listCodeInjectionDlls(project)) {
    if (target !== "patches" || path.toLowerCase() === pathFor(patch).toLowerCase()) continue;
    const id = rom.filenames.idOf(path);
    const bytes = project.fileSystem?.additions?.[path] ?? (id === undefined ? undefined : getRomFileBytes(project, rom, id));
    if (!bytes) continue;
    const peer = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    if (guards.some(guard => overlapsHook(peer, guard.module, guard.address, guard.size)))
      throw new Error(`${names[patch]} has a conflicting battle hook in ${path}.`);
  }
  result.metadata.PMCVersion = "1.0.0";
  result.metadata.PMCModulePriority = 4;
  result.metadata.PokewebFrostbiteSnow = patch;
  result.metadata.PokewebFrostbiteSnowVersion = versions[patch];
  if (patch !== "snow") result.metadata.PokewebCombinedStatus = combined ? 1 : 0;
  if (patch === "frostbite") result.metadata.PokewebFrostbiteDamageText = damageText;
  return result;
}

export function buildModernStatusModule(project: ProjectState, rom: NintendoDSRom, combined: boolean, template?: RuntimeTemplate): RpmModule {
  return buildClimateModule(project, "modern_status", rom, 0, combined, template);
}

/** These leaf edits keep the entry points and calling convention used by the
 * recipe runtime. An unknown hook or a copied body cannot use this exception. */
export function isVerifiedModernStatusImport(path: string, rpm: RpmModule, name: string, address: number, relocation: RpmRelocation): boolean {
  const sites = {
    AbilityStatusNativeCheck: [[0xe0, "ModernElectricTail"]],
    BtlCalc_MakeStatusCondition: [[0x36, "ModernSleepDuration"]],
    sub_21A57C4: [[4, "ModernScaldThawSite"], [0x2a, "ModernThawBlockedSite"]],
  } as const;
  const { target, sourceSymbolIndex } = relocation;
  const site = sites[name as keyof typeof sites]?.find(([offset]) => target.address === address + offset);
  if (!site || path.toLowerCase() !== pathFor("modern_status").toLowerCase() ||
      rpm.metadata.PokewebFrostbiteSnow !== "modern_status" || rpm.metadata.PokewebFrostbiteSnowVersion !== versions.modern_status) return false;
  const expected = bundled.templates.modern_status.symbols.find(symbol => symbol.name === site[1]);
  const actual = rpm.symbols[sourceSymbolIndex];
  return target.type === "THUMB_BRANCH_LINK" &&
    expected !== undefined && actual?.name === expected.name && actual.address === expected.address && actual.size === expected.size &&
    bundled.templates.modern_status.code.slice(expected.address, expected.address + expected.size)
      .every((byte, offset) => rpm.code[actual.address + offset] === byte);
}

const frostbiteDamage = [
  "VAR(258, 0) is hurt\\nby frostbite!",
  "The wild VAR(258, 0) is hurt\\nby frostbite!",
  "The foe's VAR(258, 0) is hurt\\nby frostbite!",
];

// The battle gauge and party menus share this 32×8, 4bpp sprite. Its font,
// palette and other status sprites stay in the same native archive.
const freezeBadge = "60f6ff6f60f5666660f5565560f5ff5660f5665660f666660000000000000000"
  + "ff6ff6ff6ff666666ff556f5ff6f566f6f6ff5666ff6f6ff0000000000000000"
  + "6f6600006f6500006665000056650000556500006f6600000000000000000000"
  + "0000000000000000000000000000000000000000000000000000000000000000";
const frostbiteBadgeRows = [
  "066ffff6fff66fffff66000000000000",
  "065f6665f66f566f6656000000000000",
  "065f6555f66f555f6556000000000000",
  "065fff65fff6555f6556000000000000",
  "065f6665f66f555f6556000000000000",
  "066f6666fff6666f6666000000000000",
];

function updateFrostbiteBadge(project: ProjectState, rom: NintendoDSRom, first: boolean): void {
  const id = rom.filenames.idOf(first ? "a/0/8/3" : "a/0/8/2");
  if (id === undefined) return;
  const archive = new NARC(getRomFileBytes(project, rom, id)), characters = archive.files[12];
  const offset = 304;
  if (!characters || readAscii(characters, 0, 4) !== "RGCN" || !patternMatches(characters, offset, nativeBytes(freezeBadge))) return;
  for (const [y, row] of frostbiteBadgeRows.entries()) {
    for (let x = 0; x < 32; x += 2) {
      const tile = x >> 3, within = (x & 7) >> 1;
      characters[offset + tile * 32 + y * 4 + within] = Number.parseInt(row[x], 16) | Number.parseInt(row[x + 1], 16) << 4;
    }
  }
  setRomFileReplacement(project, id, archive.save());
}

function frostbiteText(project: ProjectState, bank: number): number {
  const rows = getTextBank(project, "message_texts", bank);
  for (const row of rows) {
    row[1] = row[1].replace(/was\\nfrozen solid!/gu, "got\\nfrostbite!")
      .replace(/is\\nalready frozen solid!/gu, "already has\\nfrostbite!")
      .replace(/cannot be\\nfrozen solid!/gu, "cannot get\\nfrostbite!")
      .replace(/is\\nfrozen solid!/gu, "has\\nfrostbite!")
      .replace(/thawed out!/gu, "recovered from\\nfrostbite!")
      .replace(/thawed out (due to|because of|from)/gu, "recovered from frostbite $1")
      .replace(/melted the ice!/gu, "cured its frostbite!");
  }
  const next = Math.max(...rows.filter(row => parseTextEntryId(row[0]).block === 0)
    .map(row => parseTextEntryId(row[0]).entry)) + 1;
  if (!Number.isInteger(next) || next > 65532) throw new Error("The battle text bank cannot fit the Frostbite messages.");
  addTextEntries(project, "message_texts", bank, frostbiteDamage.length);
  for (const row of rows) {
    const { block, entry } = parseTextEntryId(row[0]);
    if (block === 0 && entry >= next) row[1] = frostbiteDamage[entry - next];
  }
  commitTextBank(project, "message_texts", bank);
  return next;
}

function updateConditionDescriptions(project: ProjectState, patch: FrostbiteSnowPatch, first: boolean): void {
  const tables = [[first ? 53 : 63, patch === "snow" ? [282] : [20, 153]], [first ? 183 : 375,
    patch === "snow" ? [81, 115, 117] : [40]]] as const;
  for (const [bank, ids] of tables) {
    let changed = false;
    for (const row of getTextBank(project, "message_texts", bank)) {
      if (!ids.includes(parseTextEntryId(row[0]).entry)) continue;
      const text = patch === "snow" ? row[1].replace(/\bhail(?:storm)?\b/giu, "snow")
        : row[1].replace(/defrosts(\\n| )a frozen Pokémon/gu, "cures$1frostbite")
          .replace(/a frozen(\\n| )Pokémon/gu, "a frostbitten$1Pokémon")
          .replace(/from freezing/gu, "from frostbite");
      changed ||= text !== row[1];
      row[1] = text;
    }
    if (changed) commitTextBank(project, "message_texts", bank);
  }
}

function snowText(project: ProjectState, first: boolean): void {
  for (const bank of first ? [14, 15] : [17, 18, 19]) {
    const rows = getTextBank(project, "message_texts", bank);
    for (const row of rows) {
      row[1] = row[1].replace(/The hail crashes down/gu, "Snow continues to fall")
        .replace(/\b[Hh]ail\b/gu, word => word === "Hail" ? "Snow" : "snow");
    }
    commitTextBank(project, "message_texts", bank);
  }
  updateMoveTextName(project, hailMove, "Snowscape");
  updateMoveDescription(project, hailMove, "It snows for five turns. Ice-type\\nPokémon have higher Defense.");
}

function stageClimateModule(project: ProjectState, patch: ClimatePatch, module: RpmModule): void {
  stageCodeInjectionDll(project, dllNames[patch], writeRpm(module, { ident: "DLXF" }));
}

export async function installFrostbiteSnowPatch(project: ProjectState, patch: ClimatePatch): Promise<boolean> {
  if (!gameFor(project)) throw new Error("Use a US revision-0 Black, White, Black 2 or White 2 ROM.");
  return installCodeInjectionPatch(project, async staged => {
    const rom = new NintendoDSRom(staged.originalRomBytes!, { fileData: "view" });
    const first = staged.session.baseRom === "BW";
    const exists = installedModule(staged, patch);
    const metadata = exists ? installedMetadata(staged, patch, rom) : undefined;
    const companion = patch === "modern_status" ? "frostbite" : "modern_status";
    const combined = patch !== "snow" && installedModule(staged, companion);
    const peer = combined ? installedMetadata(staged, companion, rom) : undefined;
    if (patch === "modern_status") {
      const damageText = frostbiteDamageTextId(peer);
      if (combined && damageText === undefined) throw new Error("The installed Frostbite DLL is unrecognized.");
      if (exists && (metadata?.PokewebFrostbiteSnow !== patch || metadata.PokewebFrostbiteSnowVersion !== versions[patch]))
        throw new Error("The installed Modern Status Effects DLL is unrecognized.");
      if (currentModule(metadata, patch, combined) && (!combined || currentModule(peer, "frostbite", true))) return false;
      stageClimateModule(staged, patch, buildModernStatusModule(staged, rom, combined));
      if (damageText !== undefined && !currentModule(peer, "frostbite", true))
        stageClimateModule(staged, "frostbite", buildClimateModule(staged, "frostbite", rom, damageText, true));
      recordGenericChange(staged, "code_injection", "Installed Modern Status Effects.", names[patch], { key: "install-modern-status" });
      return true;
    }

    const damageText = frostbiteDamageTextId(metadata);
    if (exists && !currentModule(metadata, patch, combined) && (patch !== "frostbite" || damageText === undefined))
      throw new Error(`The installed ${names[patch]} DLL is unrecognized.`);
    if (combined && peer?.PokewebFrostbiteSnow !== "modern_status")
      throw new Error("The installed Modern Status Effects DLL is unrecognized.");
    if (currentModule(metadata, patch, combined) && (!combined || currentModule(peer, "modern_status", true))) return false;
    if (combined && !currentModule(peer, "modern_status", true)) {
      if (!currentModule(peer, "modern_status", false)) throw new Error("The installed Modern Status Effects version is unsupported.");
      stageClimateModule(staged, "modern_status", buildModernStatusModule(staged, rom, true));
    }
    const module = buildClimateModule(staged, patch, rom, damageText, combined);
    if (exists) {
      stageClimateModule(staged, patch, module);
      recordGenericChange(staged, "message_texts", "Updated Frostbite.", "Frostbite", { key: "update-frostbite" });
      return true;
    }
    loadCodeInjectionNarcs(staged, rom, ["message_texts"]);
    if (patch === "snow") {
      snowText(staged, first);
      await installSnowscapeAnimation(staged, hailMove);
    } else {
      const id = frostbiteText(staged, first ? 14 : 18);
      const api = module.symbols.find(symbol => symbol.name === "BattleClimateApi")!;
      writeU32(module.code, api.address + 40, id);
      module.metadata.PokewebFrostbiteDamageText = id;
      updateFrostbiteBadge(staged, rom, first);
    }
    updateConditionDescriptions(staged, patch, first);
    stageClimateModule(staged, patch, module);
    recordGenericChange(staged, "message_texts", `Installed ${names[patch]}.`, names[patch], { key: `install-${patch}` });
    return true;
  });
}
