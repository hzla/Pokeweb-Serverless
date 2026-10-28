import redux from "../assets/codeinjection/cgearQuickActionsReduxManifest.json";
import type { NintendoDSRom } from "../nds/rom";
import { getRomFileBytes } from "./fileSystemModel";
import { listCodeInjectionDlls } from "./pmcModel";
import { parseRpm, type RpmModule } from "./rpm";
import type { ProjectState } from "./projectStore";

/** Only the audited flag reader may retain ownership of the Redux repel hook. */
export function isReduxRepel(rpm: RpmModule): boolean {
  const expected = redux.repelModule;
  return rpm.baseAddress === 0 && rpm.bssSize === expected.bssSize && Object.keys(rpm.metadata).length === 0
    && Array.from(rpm.code, byte => byte.toString(16).padStart(2, "0")).join("") === expected.codeHex
    && rpm.symbols.length === expected.symbols.length && expected.symbols.every((symbol, i) => {
      const actual = rpm.symbols[i]!;
      return actual.address === symbol.address && actual.size === symbol.size && actual.type === symbol.type && actual.attributes === symbol.attributes;
    }) && rpm.relocations.length === expected.relocations.length && expected.relocations.every(relocation => rpm.relocations.filter(actual =>
      actual.target.address === relocation.address && actual.target.module === relocation.module && actual.target.type === relocation.type
        && actual.sourceSymbolIndex === relocation.symbol).length === 1);
}

export function findReduxRepel(project: ProjectState, rom: NintendoDSRom): { path: string; bytes: Uint8Array } | undefined {
  if (rom.idCode !== "IRDO" || rom.data[0x1e] !== 0) return;
  const matches: { path: string; bytes: Uint8Array }[] = [];
  for (const module of listCodeInjectionDlls(project)) {
    if (module.target !== "patches") continue;
    const added = Object.keys(project.fileSystem?.additions ?? {}).find(path => path.toLowerCase() === module.path.toLowerCase());
    const id = rom.filenames.idOf(module.path);
    const bytes = added ? project.fileSystem!.additions![added] : id === undefined ? undefined : getRomFileBytes(project, rom, id);
    if (!bytes) continue;
    try { if (isReduxRepel(parseRpm(bytes, { allowedMagics: ["DLXF"] }))) matches.push({ path: module.path, bytes }); }
    catch { /* The normal compatibility scan reports malformed/conflicting DLLs. */ }
  }
  return matches.length === 1 ? matches[0] : undefined;
}
