import manifest from "../assets/codeinjection/levelCapsManifest.json";
import { readU32, writeU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { getRomFileBytes } from "./fileSystemModel";
import { listCodeInjectionDlls } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, writeRpm, type RpmModule } from "./rpm";

export type LevelCapsVersion = "B2" | "W2";
export type LevelCapsRuntime = { itemId: number; legacy: boolean; path: string; fileName: string };
const TYPES = ["NULL", "VALUE", "FUNCTION_ARM", "FUNCTION_THM", "SECTION"] as const;
const hex = (bytes: Uint8Array) => Array.from(bytes, v => v.toString(16).padStart(2, "0")).join("");

/** Accept only the audited legacy or configurable runtime and its relocations. */
export function inspectLevelCapsRuntime(rpm: RpmModule, game: LevelCapsVersion): { itemId: number; legacy: boolean } | undefined {
  const builds = manifest.games[game];
  for (const [kind, expected] of Object.entries(builds)) {
    if (rpm.metadata.PMCGameID !== game || rpm.metadata.PMCVersion !== expected.version || rpm.metadata.PMCModulePriority !== 4
      || rpm.baseAddress !== 0 || rpm.bssSize !== expected.bssSize || rpm.symbols.length !== expected.symbols.length
      || rpm.relocations.length !== expected.relocations.length) continue;
    const offset = kind === "current" ? builds.current.itemIdOffset : undefined;
    if (offset !== undefined && offset + 4 > rpm.code.length) continue;
    const id = offset === undefined ? 622 : readU32(rpm.code, offset);
    if (id < 1 || id > 638 || id === 50) continue;
    const normalized = rpm.code.slice(); if (offset !== undefined) writeU32(normalized, offset, 622);
    if (hex(normalized) !== expected.codeHex) continue;
    if (!expected.symbols.every((symbol, i) => {
      const actual = rpm.symbols[i]!;
      return actual.address === symbol.address && actual.size === symbol.size && actual.type === TYPES[symbol.type] && actual.attributes === symbol.attributes;
    })) continue;
    if (!expected.relocations.every(r => rpm.relocations.filter(actual =>
      actual.target.address === r.address && actual.target.module === r.module && actual.target.type === r.type && actual.sourceSymbolIndex === r.symbol
    ).length === 1)) continue;
    return { itemId: id, legacy: kind === "legacy" };
  }
}
export function getLevelCapsRuntime(project: ProjectState): LevelCapsRuntime | undefined {
  const version = project.session.baseVersion;
  if ((version !== "B2" && version !== "W2") || !project.originalRomBytes) return;
  const entry = listCodeInjectionDlls(project).find(m => m.target === "patches" && m.fileName.toLowerCase() === `hardlevelcaps${version}.dll`.toLowerCase());
  if (!entry) return;
  try {
    const rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
    const staged = Object.keys(project.fileSystem?.additions ?? {}).find(path => path.toLowerCase() === entry.path.toLowerCase());
    const id = rom.filenames.idOf(entry.path);
    const bytes = staged ? project.fileSystem!.additions![staged] : id === undefined ? undefined : getRomFileBytes(project, rom, id);
    const runtime = bytes && inspectLevelCapsRuntime(parseRpm(bytes, { allowedMagics: ["DLXF"] }), version);
    if (runtime) return { ...runtime, path: entry.path, fileName: entry.fileName };
  } catch { /* Unknown runtimes must not be changed automatically. */ }
}
export function configureLevelCapsRuntime(bytes: Uint8Array, game: LevelCapsVersion, itemId: number): Uint8Array {
  const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
  const runtime = inspectLevelCapsRuntime(rpm, game);
  if (!runtime || runtime.legacy || runtime.itemId !== 622 || !Number.isInteger(itemId) || itemId < 1 || itemId > 638 || itemId === 50)
    throw new Error("The bundled Hard Level Caps runtime failed its configuration check.");
  if (itemId === 622) return bytes;
  writeU32(rpm.code, manifest.games[game].current.itemIdOffset, itemId);
  const configured = writeRpm(rpm, { ident: "DLXF" });
  if (inspectLevelCapsRuntime(parseRpm(configured, { allowedMagics: ["DLXF"] }), game)?.itemId !== itemId)
    throw new Error("Hard Level Caps configuration failed verification.");
  return configured;
}
