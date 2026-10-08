import { loadOverlayTable } from "../nds/code";
import { NintendoDSRom } from "../nds/rom";
import contract from "../../runtime/double-battle-fix/black1-contract.json";
import { getRomFileBytes } from "./fileSystemModel";
import type { ProjectState } from "./projectStore";
import { parseRpm } from "./rpm";

export function assertBlack1DoubleBattleFixDll(bytes: Uint8Array): void {
  const module = parseRpm(bytes, { allowedMagics: ["DLXF"] });
  const targets = module.relocations.map(({ target }) => `${target.module}:${target.address & ~1}:${target.type}`).sort();
  const expected = [0x021ae0cc, 0x021aebb0].map(address => `21:${address}:THUMB_BRANCH`).sort();
  if (module.metadata.PMCGameID !== "B" || module.metadata.PMCVersion !== "1.0.0"
    || module.bssSize !== 0 || targets.join("|") !== expected.join("|")) {
    throw new Error("The bundled Black 1 double battle DLL does not match the supported trainer hooks.");
  }
}

/** Validate the active executable windows, including raw replacements and DLL hooks. */
export function assertBlack1DoubleBattleFixCompatible(project: ProjectState, romBytes: Uint8Array): void {
  const rom = new NintendoDSRom(romBytes, { fileData: "view" });
  if (rom.idCode !== contract.idCode || romBytes[0x1e] !== contract.revision) {
    throw new Error("The Black 1 double battle fix requires US Black (IRBO), revision 0.");
  }
  const overlays = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
    (_id, fileId) => getRomFileBytes(project, rom, fileId), new Set([10, 21]));
  for (const signature of contract.signatures) {
    const overlay = overlays.get(signature.overlayId);
    const expectedBase = contract.overlayBases[String(signature.overlayId) as keyof typeof contract.overlayBases];
    const offset = signature.address - expectedBase;
    const expected = signature.hex.match(/../g)!.map(byte => Number.parseInt(byte, 16));
    const candidates = [overlay?.data, project.overlays[signature.overlayId] ?? overlay?.data];
    if (overlay?.ramAddress !== expectedBase || candidates.some(data =>
      !data || expected.some((byte, index) => data[offset + index] !== byte))) {
      throw new Error(`Black 1 trainer code differs at ${signature.name} in overlay ${signature.overlayId}. This ROM is incompatible with the bundled double battle fix.`);
    }
  }
  const paths = new Set([
    ...Object.keys(project.fileSystem?.additions ?? {}),
    ...(project.codeInjection?.modules ?? []).map(module => module.path),
    ...["patches", "lib"].flatMap(directory => {
      const folder = rom.filenames.folders.find(([name]) => name === directory)?.[1];
      return folder?.files.map(name => `${directory}/${name}`) ?? [];
    }),
  ]);
  for (const path of paths) {
    if (!path.toLowerCase().endsWith(".dll")) continue;
    const fileId = rom.filenames.idOf(path);
    const bytes = project.fileSystem?.additions?.[path]
      ?? (fileId === undefined ? undefined : getRomFileBytes(project, rom, fileId));
    if (!bytes) continue;
    let module;
    try { module = parseRpm(bytes, { allowedMagics: ["DLXF"] }); } catch { continue; }
    const conflicts = module.relocations.some(relocation => relocation.target.module === "21"
      && [0x021ae0cc, 0x021aebb0].some(address => {
        const start = relocation.target.address & ~1;
        const size = relocation.target.type === "FULL_COPY"
          ? module.symbols[relocation.sourceSymbolIndex]?.size ?? 0
          : relocation.target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : 8;
        return start < address + 8 && start + size > address;
      }));
    if (conflicts && (path !== "patches/DoubleBattleFixB.dll"
      || module.metadata.PMCGameID !== "B" || module.metadata.PMCVersion !== "1.0.0")) {
      throw new Error(`Conflicting Black 1 double battle hooks in ${path}. Remove that patch before installing.`);
    }
  }
}
