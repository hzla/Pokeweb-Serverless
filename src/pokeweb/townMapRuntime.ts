import { NintendoDSRom } from "../nds/rom";
import { loadOverlayTable } from "../nds/code";
import { sha256Hex } from "../nds/sha256";
import { configureFlyDestinationRuntime, getFlyDestinations, readFlyDestinationRuntime, validateFlyDestinationEdit, type FlyDestinationState } from "./flyDestinationModel";
import { getRomFileBytes, ensureFileSystemState } from "./fileSystemModel";
import { installCodeInjectionPatch, loadCodeInjectionNarcs } from "./codeInjectionInstall";
import { listCodeInjectionDlls, stageCodeInjectionDll, loadBundledPmcBytes } from "./pmcModel";
import { decodeRecord, markDirty, type ProjectState } from "./projectStore";
import { parseRpm, writeRpm, setRpmBaseAddress, updateRpmCodeImageForBase, writeRelocationDataByType } from "./rpm";
import type { TownMapDraft } from "./townMapModel";
import { equalTownMapBytes } from "./townMapGraphics";
import contract from "../assets/data/bw2TownMapNativeContract.json";
import { townMapCapacity, assertTownMapCapacity } from "./townMapCapacity";

type Version = "B2" | "W2";
const URLS = { B2: new URL("../assets/codeinjection/TownMapB2.dll", import.meta.url), W2: new URL("../assets/codeinjection/TownMapW2.dll", import.meta.url) };
export function townMapModuleBytes(project: ProjectState, rom: NintendoDSRom, version: Version): Uint8Array | undefined {
  const path = `patches/TownMap${version}.dll`;
  const addition = Object.entries(project.fileSystem?.additions ?? {}).find(([p]) => p.toLowerCase() === path.toLowerCase());
  if (addition) return addition[1];
  const id = rom.filenames.idOf(path);
  return id === undefined || project.fileSystem?.tombstones?.[id] ? undefined : getRomFileBytes(project, rom, id);
}
export function configureTownMapRuntime(bytes: Uint8Array, version: Version, areas: TownMapDraft["areas"], state: FlyDestinationState): Uint8Array {
  if (areas.length < 85 || areas.length > 128) throw new Error("Town Map runtime supports 85–128 records.");
  const configured = configureFlyDestinationRuntime(bytes, version, state), rpm = parseRpm(configured, { allowedMagics: ["DLXF"] });
  const symbol = rpm.symbols.find(s => s.name === "TownMapRuntimeConfig");
  if (!symbol || symbol.size !== 268 || symbol.address + symbol.size > rpm.code.length) throw new Error("Town Map runtime configuration is missing.");
  const config = new DataView(rpm.code.buffer, rpm.code.byteOffset + symbol.address, symbol.size);
  if (config.getUint32(0, true) !== 0x50414d54 || config.getUint32(4, true) !== 1) throw new Error("Town Map runtime configuration has an unsupported format.");
  config.setUint32(8, areas.length, true);
  const originalRecords = contract[version].stockRecordZones;
  const order = contract[version].habitatZones.map(zone => {
    const index = originalRecords.indexOf(zone);
    if (index < 0) throw new Error("Native habitat order does not match Town Map records.");
    return areas[index].zone;
  });
  order.push(...areas.slice(85).map(a => a.zone));
  if (new Set(order).size !== areas.length) throw new Error("Town Map areas must have unique map headers.");
  for (let i = 0; i < 128; i++) config.setUint16(12 + i * 2, order[i] ?? 65535, true);
  return writeRpm(rpm, { ident: "DLXF" });
}
export async function validateTownMapNativeContract(project: ProjectState, version: Version): Promise<void> {
  const rom = new NintendoDSRom(project.originalRomBytes!, { fileData: "view" });
  if (rom.idCode !== (version === "B2" ? "IREO" : "IRDO") || project.originalRomBytes![30] !== 0) throw new Error("Town Map runtime needs the matching US revision-0 ROM.");
  const ids = new Set(contract[version].ranges.filter(r => r.module !== "ARM9").map(r => Number(r.module)));
  const overlays = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable, (_id, fileId) => getRomFileBytes(project, rom, fileId), ids);
  for (const range of contract[version].ranges) {
    const overlay = overlays.get(Number(range.module)), data = range.module === "ARM9" ? project.arm9 : project.overlays[Number(range.module)] ?? overlay?.data;
    const offset = range.address - (range.module === "ARM9" ? rom.arm9RamAddress : overlay?.ramAddress ?? 0);
    if (!data || offset < 0 || offset + range.size > data.length) throw new Error("Town Map native binding is outside its module.");
    if (sha256Hex(data.subarray(offset, offset + range.size)) !== range.sha256) {
      // PMC replaces the overlay loader's entry. Accept only the exact bundled
      // replacement, including its active wrapper bytes and all remaining code.
      const prefix = "pmcPrefixHex" in range ? String(range.pmcPrefixHex) : "";
      const pmc = project.codeInjection?.pmc;
      let accepted = false;
      if (range.module === "ARM9" && prefix && pmc?.overlayBaseAddress !== undefined) {
        const pristine = data.slice(offset, offset + range.size);
        pristine.set(Uint8Array.from(prefix.match(/../gu)!.map(b => parseInt(b, 16))));
        if (sha256Hex(pristine) === range.sha256) {
          const bundled = parseRpm(await loadBundledPmcBytes(version)); setRpmBaseAddress(bundled, pmc.overlayBaseAddress); updateRpmCodeImageForBase(bundled);
          const pmcId = rom.filenames.idOf(pmc.overlayPath);
          const activeBytes = project.fileSystem?.additions?.[pmc.overlayPath] ?? (pmcId === undefined ? undefined : getRomFileBytes(project, rom, pmcId));
          if (activeBytes) {
            const active = parseRpm(activeBytes);
            const hooks = bundled.relocations.filter(r => r.target.module === "ARM9" && r.target.address >= range.address && r.target.address < range.address + range.size);
            accepted = hooks.length > 0;
            for (const hook of hooks) {
              const symbol = bundled.symbols[hook.sourceSymbolIndex];
              if (!symbol?.size || !equalTownMapBytes(bundled.code.subarray(symbol.address, symbol.address + symbol.size), active.code.subarray(symbol.address, symbol.address + symbol.size))) accepted = false;
              writeRelocationDataByType(bundled, hook, pristine, hook.target.address, range.address);
            }
            accepted &&= equalTownMapBytes(pristine, data.subarray(offset, offset + range.size));
          }
        }
      }
      if (!accepted) throw new Error(`Town Map native binding differs in ${range.module} at 0x${range.address.toString(16)}.`);
    }
  }
  for (const module of listCodeInjectionDlls(project)) {
    if (module.path.toLowerCase() === `patches/TownMap${version}.dll`.toLowerCase()) continue;
    const fileId = rom.filenames.idOf(module.path);
    if (fileId !== undefined && project.fileSystem?.tombstones?.[fileId]) continue;
    const bytes = Object.entries(project.fileSystem?.additions ?? {}).find(([p]) => p.toLowerCase() === module.path.toLowerCase())?.[1]
      ?? (fileId === undefined ? undefined : getRomFileBytes(project, rom, fileId));
    if (!bytes) throw new Error(`Could not inspect ${module.fileName}.`);
    const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    for (const r of rpm.relocations) {
      if (r.target.module === "base") continue;
      const size = r.target.type === "FULL_COPY" ? rpm.symbols[r.sourceSymbolIndex]?.size ?? 0 : r.target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : r.target.type.endsWith("BRANCH") ? 8 : 4;
      if (contract[version].hooks.some(h => h.module === r.target.module && r.target.address < h.address + (h.type === "THUMB_BRANCH" ? 8 : 4) && r.target.address + size > h.address))
        throw new Error(`${module.fileName} already changes a Town Map runtime hook.`);
    }
  }
}
function retireFlyModule(project: ProjectState, rom: NintendoDSRom, version: Version): void {
  const path = `patches/FlyDestinations${version}.dll`, state = ensureFileSystemState(project);
  const addition = Object.entries(state.additions ?? {}).find(([p]) => p.toLowerCase() === path.toLowerCase());
  const id = rom.filenames.idOf(path);
  const bytes = addition?.[1] ?? (id === undefined || state.tombstones?.[id] ? undefined : getRomFileBytes(project, rom, id));
  if (!bytes) return;
  const old = readFlyDestinationRuntime(bytes, version);
  if (old.townMapCount !== undefined) throw new Error("Unexpected Town Map module at the legacy Fly path.");
  if (addition) delete state.additions![addition[0]];
  if (id !== undefined) { state.replacements[id] = new Uint8Array(); (state.tombstones ??= {})[id] = path; }
  if (project.codeInjection?.modules) project.codeInjection.modules = project.codeInjection.modules.filter(m => m.path.toLowerCase() !== path.toLowerCase());
}
/** Existing habitat slots retain their native order; appended places use linked encounters. */
export function buildTownMapSpeciesHabitats(project: ProjectState, draft: TownMapDraft, version: Version): Uint8Array[] {
  const files = project.narcs.town_map_species_habitats!.rawFiles, originalRecords = contract[version].stockRecordZones;
  const nativeOrder = contract[version].habitatZones;
  const changed = draft.areas.map((a, i) => ({ a, i })).filter(({ a, i }) => i >= 85 || a.zone !== originalRecords[i]);
  const species = changed.map(({ a, i }) => {
    const header = project.headers!.rows[a.zone + 1], pool = Number(header.encounter_id ?? (Number(header.enc_data_id) & 255));
    const result = new Map<number, number[]>();
    if (!Number.isInteger(pool) || pool < 0 || pool >= (project.narcs.encounters?.fileCount ?? 0)) return { i, result };
    const raw = decodeRecord(project, "encounters", pool).raw;
    if (!raw) throw new Error(`Could not decode encounters for map ${a.zone}.`);
    const seasonal = project.narcs.encounters!.rawFiles[pool].length > 232 || project.narcs.encounters!.dirty.has(pool);
    for (let season = 0; season < 4; season++) {
      const prefix = seasonal ? ["spring", "summer", "fall", "winter"][season] : "spring";
      ["grass", "grass_doubles", "grass_special", "surf", "surf_special", "super_rod", "super_rod_special"].forEach((method, bit) => {
        if (!Number(raw[`${prefix}_${method}_rate`])) return;
        for (let slot = 0; slot < (bit < 3 ? 12 : 5); slot++) {
          const id = Number(raw[`${prefix}_${method}_slot_${slot}`] ?? 0) % 2048;
          if (!id || id > files.length) continue;
          const flags = result.get(id) ?? [0, 0, 0, 0]; flags[season] |= 1 << bit; result.set(id, flags);
        }
      });
    }
    return { i, result };
  });
  return files.map((file, speciesIndex) => {
    if (file.length !== 345 && file.length !== 517) throw new Error(`Species habitat ${speciesIndex + 1} has an unsupported layout.`);
    const oldCount = file.length === 345 ? 85 : 128, result = new Uint8Array(517), seasons: Uint8Array[] = [];
    for (let season = 0; season < 4; season++) {
      const flags = new Uint8Array(128); flags.set(file.subarray(2 + season * (oldCount + 1), 2 + season * (oldCount + 1) + 85));
      for (const custom of species) {
        const at = custom.i < 85 ? nativeOrder.indexOf(originalRecords[custom.i]) : custom.i;
        flags[at] = custom.result.get(speciesIndex + 1)?.[season] ?? 0;
      }
      seasons.push(flags); result[1 + season * 129] = Number(!flags.some(Boolean)); result.set(flags, 2 + season * 129);
    }
    result[0] = Number(seasons.slice(1).every(s => equalTownMapBytes(s, seasons[0])));
    return result;
  });
}
/** Native installation is staged on a detached project and published with the editor transaction. */
export async function prepareTownMapRuntime(project: ProjectState, draft: TownMapDraft): Promise<void> {
  const version = project.session.baseVersion as Version;
  if (version !== "B2" && version !== "W2" || !project.originalRomBytes) throw new Error("Town Map source ROM is unavailable.");
  const rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" }), own = townMapModuleBytes(project, rom, version);
  const before = new DataView(draft.baseline.areas.buffer, draft.baseline.areas.byteOffset, draft.baseline.areas.byteLength);
  const oldLandings = new Map(getFlyDestinations({ ...project, narcs: { ...project.narcs, town_map: { ...project.narcs.town_map!, rawFiles: [draft.baseline.areas] } } }).map(d => [d.zone, d]));
  const overrides = { ...project.flyDestinations?.overrides };
  let needed = Boolean(own) || draft.areas.length !== 85;
  draft.areas.forEach((a, i) => {
    if (i >= draft.baseline.areas.length / 54 || before.getUint16(i * 54, true) !== a.zone || before.getUint16(i * 54 + 24, true) !== a.fly
      || before.getUint16(i * 54 + 30, true) !== a.arrivalFlag || a.visibilityFlag === 61443) needed = true;
    const old = oldLandings.get(a.zone), landing = draft.landings[a.zone];
    if (landing && (!old || JSON.stringify(landing) !== JSON.stringify(old.landing))) { overrides[a.zone] = landing; needed = true; }
    if (old) validateFlyDestinationEdit(old, { ...(landing ?? old.landing), enabled: Boolean(a.fly), visitFlag: a.arrivalFlag });
  });
  if (!needed) return;
  const state: FlyDestinationState = { overrides: Object.fromEntries(Object.entries(overrides).filter(([zone]) => draft.areas.some(a => a.zone === Number(zone)))), townMapCount: draft.areas.length };
  if (own) readFlyDestinationRuntime(own, version);
  const response = await fetch(URLS[version]); if (!response.ok) throw new Error(`Could not load Town Map support (${response.status}).`);
  const bytes = configureTownMapRuntime(new Uint8Array(await response.arrayBuffer()), version, draft.areas, state);
  await installCodeInjectionPatch(project, async staged => {
    retireFlyModule(staged, rom, version);
    await validateTownMapNativeContract(staged, version);
    loadCodeInjectionNarcs(staged, rom, ["town_map_species_habitats", "encounters"]);
    const files = buildTownMapSpeciesHabitats(staged, draft, version), store = staged.narcs.town_map_species_habitats!;
    const order = contract[version].stockRecordZones.map(zone => contract[version].habitatZones.indexOf(zone));
    assertTownMapCapacity(townMapCapacity(draft, files, order));
    files.forEach((bytes, id) => { if (!equalTownMapBytes(bytes, store.rawFiles[id])) { store.rawFiles[id] = bytes; markDirty(staged, "town_map_species_habitats", id); } });
    stageCodeInjectionDll(staged, `TownMap${version}.dll`, bytes);
    staged.flyDestinations = state;
  });
}
