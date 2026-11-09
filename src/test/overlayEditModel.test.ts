import { describe, expect, it } from "vitest";
import { readU32, writeU32 } from "../nds/binary";
import { compressCode, isCodeCompressed } from "../nds/codeCompression";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { buildFileSystemSnapshot } from "../pokeweb/fileSystemModel";
import {
  applyOverlayBytes, getOverlayWorkingBytes, importOverlayBytes, isOverlayStaged, listOverlayInfos,
  overlayChangedByteCount, overlayIdForFile, restoreOriginalOverlay,
} from "../pokeweb/overlayEditModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { makeTwlRom } from "./fixtures/dsiRom";

const BASE = 0x0217c980;
/** Compressible code-like image: repeating Thumb words plus a unique tail. */
const image = (seed: number) => Uint8Array.from({ length: 0x2cc0 }, (_, i) => (i < 0x2c00 ? [0x01, 0x20, 0x00, 0x90, 0x30, 0x1c, seed, 0x1c][i % 8] : (i * 7 + seed) & 0xff));

function fixture(): { project: ProjectState; images: Record<number, Uint8Array> } {
  const images = { 35: image(0x29), 36: image(0x31), 40: new Uint8Array(0x100).fill(7) };
  const table = new Uint8Array(32 * 3);
  const entries: Array<[number, number, Uint8Array, number, number]> = [
    [35, BASE, images[35], 0, 0x01],
    [36, 0x021a0000, images[36], 1, 0x03],
    [40, 0x02300000, images[40], 2, 0x00],
  ];
  const inserted = entries.map(([id, ram, data, fileId, flags], index) => {
    const stored = flags & 1 ? compressCode(data) : data;
    [id, ram, data.length, 0, 0, 0, fileId, (flags << 24) | (flags & 1 ? stored.length : 0)].forEach((value, word) => writeU32(table, index * 32 + word * 4, value));
    return { fileId, bytes: stored };
  });
  const romBytes = new NintendoDSRom(makeTwlRom("IRDO")).save({ arm9OverlayTable: table, insertedFiles: inserted });
  const project: ProjectState = {
    originalRomBytes: romBytes,
    session: { romName: "test", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: "IRDO", fileName: "test.nds", size: romBytes.length },
    arm9: Uint8Array.of(1, 2, 3, 4),
    overlays: {},
    narcs: {},
    texts: { banks: {} },
    formats: {},
    trpokInfo: [],
    codeInjection: { pmc: { overlayId: 40, overlayBaseAddress: 0x02300000, overlayPath: "overlay/overlay_0040.bin", symbolPath: "codeinjection/RPMSYM-PMC.rpm", gameId: "W2" } },
  };
  return { project, images };
}

const rom = (project: ProjectState) => new NintendoDSRom(project.originalRomBytes!);

describe("File System overlay editing", () => {
  it("lists overlays decompressed with their RAM addresses", () => {
    const { project, images } = fixture();
    const r = rom(project);
    expect(listOverlayInfos(project, r).map(({ overlayId, ramAddress, compressed, signed, readOnlyReason }) => ({ overlayId, ramAddress, compressed, signed, readOnly: Boolean(readOnlyReason) }))).toEqual([
      { overlayId: 35, ramAddress: BASE, compressed: true, signed: false, readOnly: false },
      { overlayId: 36, ramAddress: 0x021a0000, compressed: true, signed: true, readOnly: false },
      { overlayId: 40, ramAddress: 0x02300000, compressed: false, signed: false, readOnly: true },
    ]);
    expect(getOverlayWorkingBytes(project, r, 35)).toEqual(images[35]);
    expect(overlayIdForFile(project, r, 1)).toBe(36);
    const snapshot = buildFileSystemSnapshot(project, project.originalRomBytes!);
    expect(snapshot.pathRefs.get("_overlays/overlay_0035.bin")).toEqual({ kind: "overlay", overlayId: 35, path: "_overlays/overlay_0035.bin" });
    expect(isOverlayStaged(project, 35)).toBe(false);
  });

  it("exports a 2-byte edit recompressed with a matching overlay table entry", async () => {
    const { project, images } = fixture();
    const r = rom(project);
    const edited = getOverlayWorkingBytes(project, r, 35).slice();
    edited.set([0xfa, 0xe7], 0x9c);
    applyOverlayBytes(project, r, 35, edited);
    expect(isOverlayStaged(project, 35)).toBe(true);
    expect(overlayChangedByteCount(project, r, 35)).toBe(2);
    expect(images[35]).toEqual(image(0x29));

    const out = new NintendoDSRom(await exportModifiedRom(project));
    const flags = readU32(out.arm9OverlayTable, 28);
    expect(flags >>> 24).toBe(1);
    expect(isCodeCompressed(out.files[0])).toBe(true);
    expect(flags & 0xffffff).toBe(out.files[0].length);
    expect(readU32(out.arm9OverlayTable, 4)).toBe(BASE);
    expect(out.loadArm9Overlays([35]).get(35)?.data).toEqual(edited);
    expect(out.loadArm9Overlays([36]).get(36)?.data).toEqual(images[36]);
  });

  it("writes a signed overlay decompressed and keeps its signed flag", async () => {
    const { project } = fixture();
    const r = rom(project);
    const edited = getOverlayWorkingBytes(project, r, 36).slice();
    edited[0] ^= 0xff;
    applyOverlayBytes(project, r, 36, edited);
    const out = new NintendoDSRom(await exportModifiedRom(project));
    expect(readU32(out.arm9OverlayTable, 32 + 28) >>> 24).toBe(2);
    expect(out.files[1]).toEqual(edited);
    expect(out.loadArm9Overlays([36]).get(36)?.data).toEqual(edited);
  });

  it("imports compressed or decompressed images and refuses size changes and the PMC overlay", () => {
    const { project, images } = fixture();
    const r = rom(project);
    const edited = images[35].slice();
    edited[5] = 0x99;
    expect(importOverlayBytes(project, r, 35, compressCode(edited))).toEqual({ compressed: true });
    expect(getOverlayWorkingBytes(project, r, 35)).toEqual(edited);
    expect(importOverlayBytes(project, r, 35, images[35])).toEqual({ compressed: false });
    expect(() => applyOverlayBytes(project, r, 35, images[35].slice(1))).toThrow(/cannot change size/u);
    expect(() => applyOverlayBytes(project, r, 40, new Uint8Array(0x100))).toThrow(/PMC/u);
  });

  it("restores the original overlay and drops it from export", async () => {
    const { project, images } = fixture();
    const r = rom(project);
    const edited = images[35].slice();
    edited[0] = 0;
    applyOverlayBytes(project, r, 35, edited);
    restoreOriginalOverlay(project, r, 35);
    expect(isOverlayStaged(project, 35)).toBe(false);
    expect(getOverlayWorkingBytes(project, r, 35)).toEqual(images[35]);
    const out = new NintendoDSRom(await exportModifiedRom(project));
    expect(out.loadArm9Overlays([35]).get(35)?.data).toEqual(images[35]);
  });
});
