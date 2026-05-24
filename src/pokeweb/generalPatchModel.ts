import { readAscii, readU32 } from "../nds/binary";
import { loadOverlayTable } from "../nds/code";
import { decompressCode } from "../nds/codeCompression";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { loadActiveRomBytes } from "./persistence";
import type { BaseVersion } from "./constants";
import type { NarcStore, ProjectState } from "./projectStore";

const FAIRY_B2_PATCH_URL = new URL("../assets/patches/fairy-b2.bin", import.meta.url);
const FAIRY_W2_PATCH_URL = new URL("../assets/patches/fairy-w2.bin", import.meta.url);

export type GeneralPatchSection = {
  name: string;
  payload: Uint8Array;
};

export type GeneralPatchApplySummary = {
  changed: boolean;
  overlayIds: number[];
  narcFileIds: number[];
};

type GeneralPatchContext = {
  project: ProjectState;
  rom: NintendoDSRom;
  oldOverlayTable: Uint8Array;
  nextOverlayTable: Uint8Array;
  changed: boolean;
  overlayIds: Set<number>;
  narcFileIds: Set<number>;
};

const FAIRY_PATCH_VERSION: Partial<Record<BaseVersion, string>> = {
  B2: "pokemon b2",
  W2: "pokemon w2",
};

export async function loadFairyTypePatchSections(baseVersion: BaseVersion): Promise<GeneralPatchSection[]> {
  const url = baseVersion === "B2" ? FAIRY_B2_PATCH_URL : baseVersion === "W2" ? FAIRY_W2_PATCH_URL : undefined;
  if (!url) throw new Error("Fairy Type Support is currently available for Black 2 and White 2 only.");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load the Fairy Type Support patch (${response.status}).`);
  return parseGeneralPatch(new Uint8Array(await response.arrayBuffer()));
}

export async function applyFairyTypeGeneralPatch(project: ProjectState): Promise<GeneralPatchApplySummary> {
  if (project.session.baseVersion !== "B2" && project.session.baseVersion !== "W2") {
    throw new Error("Fairy Type Support is currently available for Black 2 and White 2 only.");
  }

  const sections = await loadFairyTypePatchSections(project.session.baseVersion);
  const expectedVersion = FAIRY_PATCH_VERSION[project.session.baseVersion];
  const patchVersion = readPatchVersion(sections);
  if (expectedVersion && patchVersion !== expectedVersion) {
    throw new Error("This Fairy Type Support patch does not match the loaded ROM version.");
  }

  const summary = await applyGeneralPatchSections(project, sections);
  project.session.fairy = true;
  project.patches ??= { dirtyOverlayIds: [], applied: {} };
  project.patches.applied ??= {};
  project.patches.applied.fairyType = true;

  if (summary.changed) {
    recordGenericChange(project, "patches", "Added Fairy Type Support.", "Fairy Type Support", {
      key: "patch:fairyType",
    });
  }

  return summary;
}

export async function applyGeneralPatchSections(project: ProjectState, sections: GeneralPatchSection[]): Promise<GeneralPatchApplySummary> {
  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Reload the ROM before applying ROM patches.");

  const rom = new NintendoDSRom(romBytes);
  const overlayTable = project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable;
  const context: GeneralPatchContext = {
    project,
    rom,
    oldOverlayTable: overlayTable.slice(),
    nextOverlayTable: overlayTable.slice(),
    changed: false,
    overlayIds: new Set(),
    narcFileIds: new Set(),
  };

  for (const section of sections) {
    if (section.name === "version") continue;
    if (section.name === "arm9") applyArm9Patch(context, section.payload);
    else if (section.name === "y9") applyOverlayTablePatch(context, section.payload);
    else if (section.name.startsWith("ov_")) applyOverlayPatch(context, Number(section.name.slice(3)), section.payload);
    else if (section.name.startsWith("narcadd_")) applyNarcPatch(context, section.name, section.payload, true);
    else if (section.name.startsWith("narc_")) applyNarcPatch(context, section.name, section.payload, false);
  }

  context.project.patches ??= { dirtyOverlayIds: [], applied: {} };
  if (!bytesEqual(context.nextOverlayTable, overlayTable)) {
    context.project.patches.arm9OverlayTable = context.nextOverlayTable;
    context.changed = true;
  }

  return {
    changed: context.changed,
    overlayIds: [...context.overlayIds].sort((a, b) => a - b),
    narcFileIds: [...context.narcFileIds].sort((a, b) => a - b),
  };
}

export function parseGeneralPatch(data: Uint8Array): GeneralPatchSection[] {
  const sections: GeneralPatchSection[] = [];
  let offset = 0;

  while (offset < data.length) {
    if (data[offset] !== 0x7b) throw new Error(`Invalid patch section start at 0x${offset.toString(16)}.`);
    offset += 1;

    const nameStart = offset;
    while (offset < data.length && data[offset] !== 0x7c) offset += 1;
    if (offset >= data.length) throw new Error("Invalid patch section header.");
    const name = readAscii(data, nameStart, offset - nameStart);
    offset += 1;

    const length = readU32(data, offset);
    offset += 4;
    if (data[offset] !== 0x3a) throw new Error(`Invalid patch payload marker for ${name}.`);
    offset += 1;

    const payloadEnd = offset + length;
    if (payloadEnd > data.length) throw new Error(`Patch section ${name} extends beyond the file.`);
    const payload = data.slice(offset, payloadEnd);
    offset = payloadEnd;
    if (data[offset] !== 0x7d) throw new Error(`Invalid patch section terminator for ${name}.`);
    offset += 1;

    sections.push({ name, payload });
  }

  return sections;
}

function applyArm9Patch(context: GeneralPatchContext, payload: Uint8Array): void {
  const out = context.project.arm9.length > 0 ? context.project.arm9.slice() : decompressCode(context.rom.arm9);
  let offset = 1;
  while (offset < payload.length) {
    const address = readU32(payload, offset);
    const length = readU32(payload, offset + 4);
    offset += 8;
    ensureRange(out, address, length, "ARM9");
    if (!bytesEqual(out.subarray(address, address + length), payload.subarray(offset, offset + length))) {
      out.set(payload.subarray(offset, offset + length), address);
      context.changed = true;
    }
    offset += length;
  }
  context.project.arm9 = out;
  context.project.arm9Dirty = true;
}

function applyOverlayTablePatch(context: GeneralPatchContext, payload: Uint8Array): void {
  const remove = readU32(payload, 0);
  const add = readU32(payload, 4);
  let table = context.nextOverlayTable;
  if (remove > 0) table = table.slice(0, Math.max(0, table.length - remove));
  if (add > 0) {
    const next = new Uint8Array(table.length + add);
    next.set(table);
    next.set(payload.subarray(8, 8 + add), table.length);
    table = next;
  }

  let offset = 8 + add;
  while (offset + 32 <= payload.length) {
    const overlayId = readU32(payload, offset);
    const tableOffset = overlayId * 32;
    ensureRange(table, tableOffset, 32, `overlay table entry ${overlayId}`);
    if (!bytesEqual(table.subarray(tableOffset, tableOffset + 32), payload.subarray(offset, offset + 32))) {
      table.set(payload.subarray(offset, offset + 32), tableOffset);
    }
    offset += 32;
  }

  if (!bytesEqual(table, context.nextOverlayTable)) {
    context.nextOverlayTable = table;
    context.changed = true;
  }
}

function applyOverlayPatch(context: GeneralPatchContext, overlayId: number, payload: Uint8Array): void {
  if (!Number.isInteger(overlayId)) throw new Error("Invalid overlay patch section.");
  const startAddress = readU32(payload, 0);
  const overlaySize = readU32(payload, 4);
  const oldEntryOffset = overlayId * 32;
  ensureRange(context.oldOverlayTable, oldEntryOffset, 32, `overlay table entry ${overlayId}`);
  const oldStartAddress = readU32(context.oldOverlayTable, oldEntryOffset + 4);

  let overlay = currentOverlayBytes(context, overlayId);
  if (oldStartAddress > startAddress) {
    const expanded = new Uint8Array(overlay.length + oldStartAddress - startAddress);
    expanded.set(overlay, oldStartAddress - startAddress);
    overlay = expanded;
  } else {
    overlay = overlay.slice();
  }
  if (overlay.length < overlaySize) {
    const expanded = new Uint8Array(overlaySize);
    expanded.set(overlay);
    overlay = expanded;
  }

  let changed = false;
  let offset = 16;
  while (offset < payload.length) {
    const address = readU32(payload, offset);
    const length = readU32(payload, offset + 4);
    offset += 8;
    ensureRange(overlay, address, length, `overlay ${overlayId}`);
    if (!bytesEqual(overlay.subarray(address, address + length), payload.subarray(offset, offset + length))) {
      overlay.set(payload.subarray(offset, offset + length), address);
      changed = true;
    }
    offset += length;
  }

  if (changed || !bytesEqual(context.project.overlays[overlayId] ?? new Uint8Array(), overlay)) {
    context.project.overlays[overlayId] = overlay;
    context.project.patches ??= { dirtyOverlayIds: [], applied: {} };
    if (!context.project.patches.dirtyOverlayIds.includes(overlayId)) context.project.patches.dirtyOverlayIds.push(overlayId);
    context.overlayIds.add(overlayId);
    context.changed = true;
  }

  const overlayTableOffset = overlayId * 32;
  if (overlayTableOffset + 32 <= context.nextOverlayTable.length) {
    context.nextOverlayTable[overlayTableOffset + 31] = 2;
  }
}

function applyNarcPatch(context: GeneralPatchContext, sectionName: string, payload: Uint8Array, add: boolean): void {
  const match = /^narc(?:add)?_(\d+)_(\d+)$/u.exec(sectionName);
  if (!match) throw new Error(`Invalid NARC patch section: ${sectionName}`);
  const narcId = Number(match[1]);
  const subfileId = Number(match[2]);
  const fileId = context.rom.fileId(narcPath(narcId));
  const store = loadedNarcStore(context.project, fileId);
  const sourceBytes = store ? saveStoreAsNarc(store) : context.project.fileSystem?.replacements[fileId] ?? context.rom.files[fileId];
  const narc = new NARC(sourceBytes);

  if (add) addNarcFile(narc, subfileId, payload);
  else replaceNarcFile(narc, subfileId, payload);

  const bytes = narc.save();
  context.project.fileSystem ??= { replacements: {} };
  if (!bytesEqual(context.project.fileSystem.replacements[fileId] ?? context.rom.files[fileId], bytes)) {
    context.project.fileSystem.replacements[fileId] = bytes;
    context.changed = true;
  }
  syncLoadedNarcStore(store, narc, subfileId);
  context.narcFileIds.add(fileId);
}

function currentOverlayBytes(context: GeneralPatchContext, overlayId: number): Uint8Array {
  const existing = context.project.overlays[overlayId];
  if (existing && existing.length > 0) return existing;

  const overlays = loadOverlayTable(context.oldOverlayTable, (_id, fileId) => context.rom.files[fileId], new Set([overlayId]));
  const overlay = overlays.get(overlayId);
  if (!overlay) throw new Error(`Could not load overlay ${overlayId} from this ROM.`);
  return overlay.data;
}

function loadedNarcStore(project: ProjectState, fileId: number): NarcStore | undefined {
  return Object.values(project.narcs).find((store): store is NarcStore => !!store && store.fileId === fileId);
}

function syncLoadedNarcStore(store: NarcStore | undefined, narc: NARC, dirtyFileId: number): void {
  if (!store) return;
  store.rawFiles = narc.files;
  store.filenames = narc.filenames;
  store.fileCount = narc.files.length;
  store.records.clear();
  store.dirty.add(dirtyFileId);
}

function saveStoreAsNarc(store: NarcStore): Uint8Array {
  const narc = new NARC();
  narc.files = store.rawFiles;
  if (store.filenames) narc.filenames = store.filenames;
  return narc.save();
}

function replaceNarcFile(narc: NARC, fileId: number, payload: Uint8Array): void {
  if (fileId < 0 || fileId >= narc.files.length) throw new Error(`Patch targets missing NARC file ${fileId}.`);
  narc.files[fileId] = payload.slice();
}

function addNarcFile(narc: NARC, fileId: number, payload: Uint8Array): void {
  while (narc.files.length < fileId) narc.files.push(new Uint8Array());
  if (fileId < narc.files.length) {
    narc.files[fileId] = payload.slice();
  } else {
    narc.files.push(payload.slice());
  }
}

function narcPath(narcId: number): string {
  return `a/${Math.floor(narcId / 100)}/${Math.floor(narcId / 10) % 10}/${narcId % 10}`;
}

function readPatchVersion(sections: GeneralPatchSection[]): string | undefined {
  const section = sections.find((entry) => entry.name === "version");
  return section ? readAscii(section.payload, 0, section.payload.length) : undefined;
}

function ensureRange(data: Uint8Array, offset: number, length: number, label: string): void {
  if (offset + length > data.length) throw new Error(`Patch data extends beyond ${label}.`);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}
