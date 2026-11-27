import { readAscii, readU16, writeU16 } from "../nds/binary";
import { loadOverlayTable } from "../nds/code";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { withProjectMutationLock } from "./codeInjectionInstall";
import { getRomFileBytes } from "./fileSystemModel";
import { isOverlayStaged, projectOverlayTable } from "./overlayEditModel";
import { listCodeInjectionDlls } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import type { RomPatchApplyResult } from "./romPatchModel";
import { parseRpm } from "./rpm";

const TITLE = "Ability Storage Fix";
const NOP = 0x46c0;
const NO_EDITS: readonly (readonly [number, number])[] = [];

const layouts = {
  BW: {
    overlays: [93, 94, 96],
    getMonId: 0x1f340,
    show: 0x37b9c,
    change: 0x37eba,
    faint: 0x178e,
    cache: 0x2588,
    showCall: [0xf00a, 0xff22],
    changeCall: [0xf00a, 0xfd93],
    faintCall: [0xf000, 0xfef9],
    getCall: [0xf06e, 0xfc55],
    cacheField: [0x2086, 0x0080], // BtlvEffect + 0x218
  },
  BW2: {
    overlays: [167, 168, 170],
    getMonId: 0x21380,
    show: 0x3a368,
    change: 0x3a682,
    faint: 0x1bc2,
    cache: 0x2a78,
    showCall: [0xf00c, 0xfc54],
    changeCall: [0xf00c, 0xfac7],
    faintCall: [0xf000, 0xff57],
    getCall: [0xf05e, 0xfdcd],
    cacheField: [0x2022, 0x0100], // BtlvEffect + 0x220
  },
} as const;

const profiles = {
  B: { family: "BW", idCode: "IRBO", bases: [0x021b6100, 0x021f6560, 0x02187f00], cachePointer: 0x0220af20 },
  W: { family: "BW", idCode: "IRAO", bases: [0x021b6120, 0x021f6580, 0x02187f20], cachePointer: 0x0220af40 },
  B2: { family: "BW2", idCode: "IREO", bases: [0x021998c0, 0x021dda60, 0x0217f600], cachePointer: 0x021f4240 },
  W2: { family: "BW2", idCode: "IRDO", bases: [0x02199900, 0x021ddaa0, 0x0217f640], cachePointer: 0x021f4280 },
} as const;

type Profile = (typeof profiles)[keyof typeof profiles];
type PatchSite = {
  overlayId: number;
  offset: number;
  expected: readonly number[];
  edits: readonly (readonly [halfword: number, instruction: number])[];
};
type Inspection =
  | { state: "unsupported" | "unavailable"; message: string }
  | { state: "installed" }
  | { state: "ready"; sites: PatchSite[]; images: Map<number, Uint8Array> };

function patchSites(profile: Profile): PatchSite[] {
  const layout = layouts[profile.family];
  const [battle, effects, ai] = layout.overlays;
  const literal = [profile.cachePointer & 0xffff, profile.cachePointer >>> 16];
  return [
    // GetMonID documents the BattleMon field read directly by GuessAbility.
    { overlayId: battle, offset: layout.getMonId, expected: [0x7e40, 0x4770], edits: NO_EDITS },
    // StartShow already has the revealed Pokémon's ID in r4.
    { overlayId: battle, offset: layout.show, expected: [0x9800, 0x1c31, ...layout.showCall, 0xbdf8], edits: [[0, 0x1c20]] },
    // StartChange has recorded the ID in the popup state at [r5, #0xc].
    { overlayId: battle, offset: layout.change, expected: [0x1c30, 0x1c21, ...layout.changeCall, 0xbdf8], edits: [[0, 0x7b28]] },
    // Fainting still starts its animation. The old position-based clear would erase another Pokémon's entry.
    { overlayId: effects, offset: layout.faint, expected: [0x1c20, 0x2100, ...layout.faintCall, 0xbd10], edits: [[0, NOP], [1, NOP], [2, NOP], [3, NOP]] },
    // Reuse the eight words as a byte array. BattleMon IDs are 0–23 and the AI already consumes one byte.
    { overlayId: effects, offset: layout.cache, expected: [0x4a03, 0x0080, 0x6812, 0x1812, ...layout.cacheField, 0x5011, 0x4770, ...literal], edits: [[1, NOP], [6, 0x5411]] },
    { overlayId: effects, offset: layout.cache + 0x14, expected: [0x4903, 0x0080, 0x6809, 0x1809, ...layout.cacheField, 0x5808, 0x4770, ...literal], edits: [[1, NOP], [6, 0x5c08]] },
    // Pass BattleMon.monId in r0 and keep the retail fallback for unrevealed abilities.
    { overlayId: ai, offset: 0x234a, expected: [0x357c, 0x1c38, ...layout.getCall, 0x55e8, 0x5de8, 0x2800, 0xd14e], edits: [[1, 0x7e70]] },
  ];
}

function inspect(project: ProjectState): Inspection {
  const game = project.session.baseVersion;
  const profile = game === "B" || game === "W" || game === "B2" || game === "W2" ? profiles[game] : undefined;
  const source = project.originalRomBytes;
  if (!profile || project.session.baseRom !== profile.family || project.romInfo.idCode !== profile.idCode
    || (source && (source[0x1e] !== 0 || readAscii(source, 0x0c, 4) !== profile.idCode))) {
    return { state: "unsupported", message: "Requires US revision-0 Black, White, Black 2, or White 2." };
  }
  if (!source) return { state: "unavailable", message: "Load ROM data to check compatibility." };

  try {
    const rom = new NintendoDSRom(source, { fileData: "view" });
    const overlayIds = layouts[profile.family].overlays;
    const overlays = loadOverlayTable(projectOverlayTable(project, rom),
      (_id, fileId) => getRomFileBytes(project, rom, fileId), new Set(overlayIds));
    const images = new Map<number, Uint8Array>();
    for (const [index, id] of overlayIds.entries()) {
      const overlay = overlays.get(id);
      const image = isOverlayStaged(project, id) ? project.overlays[id] : overlay?.data;
      if (!overlay || overlay.ramAddress !== profile.bases[index] || !image || image.length !== overlay.ramSize) {
        throw new Error(`Overlay ${id} has an incompatible layout.`);
      }
      images.set(id, image);
    }

    const sites = patchSites(profile);
    const states = sites.map(({ overlayId, offset, expected, edits }) => {
      const image = images.get(overlayId)!;
      const matches = (patched: boolean) => offset + expected.length * 2 <= image.length &&
        expected.every((stock, index) => readU16(image, offset + index * 2)
          === (patched ? edits.find(([part]) => part === index)?.[1] ?? stock : stock));
      if (matches(false)) return "stock";
      if (edits.length > 0 && matches(true)) return "patched";
      throw new Error(`Battle code differs in overlay ${overlayId} at 0x${(overlays.get(overlayId)!.ramAddress + offset).toString(16)}.`);
    });
    const patched = states.filter(state => state === "patched").length;
    if (patched > 0 && patched !== sites.filter(site => site.edits.length > 0).length) {
      throw new Error("The ROM contains only part of the Ability Storage Fix.");
    }
    checkModuleConflicts(project, rom, sites, overlays);
    return patched > 0 ? { state: "installed" } : { state: "ready", sites, images };
  } catch (error) {
    return { state: "unavailable", message: error instanceof Error ? error.message : String(error) };
  }
}

function checkModuleConflicts(
  project: ProjectState,
  rom: NintendoDSRom,
  sites: PatchSite[],
  overlays: ReadonlyMap<number, { ramAddress: number }>,
): void {
  for (const { path } of listCodeInjectionDlls(project)) {
    const id = rom.filenames.idOf(path);
    const bytes = project.fileSystem?.additions?.[path] ?? (id === undefined ? undefined : getRomFileBytes(project, rom, id));
    if (!bytes?.length) throw new Error(`Cannot check ${path} for overlapping code changes.`);
    const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    if (rpm.relocations.some(({ target, sourceSymbolIndex }) => {
      const address = target.address & ~1;
      const size = target.type === "FULL_COPY" ? rpm.symbols[sourceSymbolIndex]?.size ?? 0
        : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" ? 12
        : target.type === "ARM_BRANCH" ? 8 : 4;
      return sites.some(({ overlayId, offset, expected }) => {
        if (target.module !== String(overlayId)) return false;
        const start = overlays.get(overlayId)!.ramAddress + offset;
        return address < start + expected.length * 2 && address + size > start;
      });
    })) throw new Error(`${TITLE} overlaps ${path}.`);
  }
}

export function getAbilityStorageFixStatus(project: ProjectState): { state: Inspection["state"]; message?: string } {
  const result = inspect(project);
  return result.state === "ready" ? { state: "ready" } : result;
}

export function applyAbilityStorageFix(project: ProjectState): Promise<RomPatchApplyResult> {
  return withProjectMutationLock(project, () => {
    const result = inspect(project);
    const patchId = "abilityStorageFix";
    if (result.state === "installed") return { patchId, status: "already-applied" };
    if (result.state !== "ready") throw new Error(result.message);

    const updated = new Map<number, Uint8Array>();
    for (const { overlayId, offset, edits } of result.sites) {
      if (edits.length === 0) continue;
      const image = updated.get(overlayId) ?? result.images.get(overlayId)!.slice();
      for (const [index, instruction] of edits) writeU16(image, offset + index * 2, instruction);
      updated.set(overlayId, image);
    }
    project.patches ??= { dirtyOverlayIds: [] };
    for (const [id, bytes] of updated) {
      project.overlays[id] = bytes;
      if (!project.patches.dirtyOverlayIds.includes(id)) project.patches.dirtyOverlayIds.push(id);
    }
    recordGenericChange(project, "patches", "Tied revealed abilities to the Pokémon that showed them.", TITLE, {
      key: "patch:ability-storage-fix",
    });
    return { patchId, status: "applied", summary: "Ability Storage Fix staged. Export the ROM to apply it." };
  });
}
