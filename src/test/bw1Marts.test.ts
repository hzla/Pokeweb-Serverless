import { describe, expect, it } from "vitest";
import { writeU16, writeU32 } from "../nds/binary";
import { Folder, addFilePath } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import {
  bw1MartLabel, buildBw1MartDll, disableBw1MartExpansion, enableBw1MartExpansion, getBw1MartExpansionStatus, isBw1MartModule,
  parseBw1MartDll, readBw1Marts, setBw1BpItems, setBw1MartItems,
} from "../pokeweb/bw1MartModel";
import { loadProjectFromRomBytes } from "../pokeweb/loader";
import { getMartCount, getMartRecord, getMartSlotLimit, reorderMartSlots, updateMartField } from "../pokeweb/martGrottoModel";
import { listCodeInjectionDlls, stageCodeInjectionDll } from "../pokeweb/pmcModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { parseRpm, writeRpm } from "../pokeweb/rpm";

const BASE = 0x02187f00;
const COUNTS = [2, 11, 14, 17, 18, 19, 7, 8, 9, 11, 7, 11, 4, 3, 11, 8, 8, 9, 8, 8, 4, 9, 16, 2, 16, 6];
const BP_COUNTS = [38, 10];
const POOL = 0x100, TIERS = 0x200, COUNTS_AT = 0x210, BP_COUNTS_AT = 0x230, TABLE = 0x240, BP_TABLE = 0x2b0, LISTS = 0x300;

/** Synthetic Black ROM: overlay 21 with the shop literal pools and retail-sized lists. */
async function fixture(): Promise<ProjectState> {
  const ov = new Uint8Array(0x1400);
  writeU32(ov, POOL, BASE + TIERS); writeU32(ov, POOL + 4, BASE + TABLE); writeU32(ov, POOL + 8, 0x162); writeU32(ov, POOL + 12, BASE + COUNTS_AT);
  writeU32(ov, POOL + 0xa8, BASE + BP_TABLE); writeU32(ov, POOL + 0xac, BASE + BP_COUNTS_AT);
  ov.set([0, 1, 1, 2, 2, 3, 3, 4, 5], TIERS);
  let cursor = LISTS;
  COUNTS.forEach((count, index) => {
    writeU32(ov, TABLE + index * 4, BASE + cursor); ov[COUNTS_AT + index] = count;
    for (let n = 0; n < count; n += 1) writeU16(ov, cursor + n * 2, 1 + ((index + n) % 20));
    cursor += count * 2;
  });
  cursor = (cursor + 3) & ~3;
  BP_COUNTS.forEach((count, index) => {
    writeU32(ov, BP_TABLE + index * 4, BASE + cursor); ov[BP_COUNTS_AT + index] = count;
    for (let n = 0; n < count; n += 1) { writeU16(ov, cursor + n * 8, 40 + n); writeU32(ov, cursor + n * 8 + 4, 1 + n); }
    cursor += count * 8;
  });
  const rom = new NintendoDSRom(new Uint8Array(0x200));
  rom.data.set(new TextEncoder().encode("IRBO"), 12);
  rom.arm9RamAddress = 0x02004000; writeU32(rom.data, 0x28, 0x02004000);
  rom.arm9 = new Uint8Array(0x1000); rom.arm7 = new Uint8Array(4);
  const overlayCount = 237;
  rom.files = Array.from({ length: overlayCount + 3 }, () => new Uint8Array(4));
  rom.arm9OverlayTable = new Uint8Array(overlayCount * 32); rom.filenames = new Folder();
  for (let id = 0; id < overlayCount; ++id) { writeU32(rom.arm9OverlayTable, id * 32, id); writeU32(rom.arm9OverlayTable, id * 32 + 24, id); }
  rom.files[21] = ov; writeU32(rom.arm9OverlayTable, 21 * 32 + 4, BASE); writeU32(rom.arm9OverlayTable, 21 * 32 + 8, ov.length);
  const headers = new NARC(); headers.files = [new Uint8Array(48)];
  for (const [index, path, bytes] of [[0, "a/0/0/2", new NARC().save()], [1, "a/0/0/3", new NARC().save()], [2, "a/0/1/2", headers.save()]] as const) {
    rom.files[overlayCount + index] = bytes; rom.filenames = addFilePath(rom.filenames, path, overlayCount + index);
  }
  const project = await loadProjectFromRomBytes(rom.save({ filenames: rom.filenames }), "fixture.nds", { selectedNarcs: [] });
  project.session.baseRom = "BW"; project.session.baseVersion = "B";
  project.texts.banks.items = Array.from({ length: 640 }, (_unused, id) => id === 0 ? "None" : `Item ${id}`);
  project.codeInjection = { pmc: { overlayId: 237, overlayBaseAddress: 0x02217d20, overlayPath: "overlay/overlay_0237.bin", symbolPath: "codeinjection/RPMSYM-PMC.rpm", gameId: "B" } };
  return project;
}

describe("BW1 marts", () => {
  it("reads the retail lists from overlay 21 and labels them by shop ID", async () => {
    const project = await fixture();
    const data = readBw1Marts(project);
    expect(data.expanded).toBe(false);
    expect(data.shops.map((items) => items.length)).toEqual(COUNTS);
    expect(data.bpShops.map((items) => items.length)).toEqual(BP_COUNTS);
    expect(data.bpShops[0]![2]).toEqual({ itemId: 42, price: 3 });
    expect(bw1MartLabel(data, 0)).toBe("Poké Mart: 0 badges");
    expect(bw1MartLabel(data, 1)).toBe("Poké Mart: 1–2 badges");
    expect(bw1MartLabel(data, 6)).toBe("Accumula Town");
    expect(bw1MartLabel(data, 27)).toBe("Gear Station: BP TMs");
    expect(getMartCount(project)).toBe(28);
    expect(getMartSlotLimit(project, 0)).toBe(2);
  });

  it("edits in place within the retail size", async () => {
    const project = await fixture();
    setBw1MartItems(project, 1, [5, 6, 7]);
    expect(project.patches?.dirtyOverlayIds).toContain(21);
    expect(readBw1Marts(project).shops[1]).toEqual([5, 6, 7]);
    expect(project.overlays[21]![COUNTS_AT + 1]).toBe(3);
    expect(() => setBw1MartItems(project, 0, [1, 2, 3])).toThrow(/holds at most 2 items/u);
    setBw1BpItems(project, 26, [{ itemId: 50, price: 9 }]);
    expect(readBw1Marts(project).bpShops[0]).toEqual([{ itemId: 50, price: 9 }]);
    expect(project.actionChangelog?.entries.some((entry) => entry.key === "mart:1:items")).toBe(true);
  });

  it("edits through the shared mart fields", async () => {
    const project = await fixture();
    updateMartField(project, 6, "item_0", "None");
    expect(readBw1Marts(project).shops[6]).toHaveLength(6);
    updateMartField(project, 6, "item_6", "Item 99");
    expect(readBw1Marts(project).shops[6]!.at(-1)).toBe(99);
    expect(() => updateMartField(project, 6, "item_7", "Item 98")).toThrow(/holds at most 7/u);
    reorderMartSlots(project, 6, [6, 0, 1, 2, 3, 4, 5]);
    expect(readBw1Marts(project).shops[6]![0]).toBe(99);
    updateMartField(project, 27, "price_0", "77");
    expect(getMartRecord(project, 27).raw.price_0).toBe(77);
    expect(() => updateMartField(project, 0, "item_2", "Item 3")).toThrow(/holds at most 2/u);
  });

  it("moves every list into a module, allows 40 items, and moves them back", async () => {
    const project = await fixture();
    setBw1MartItems(project, 2, [9]);
    await enableBw1MartExpansion(project);
    const path = "patches/PokewebMartsB.dll";
    const bytes = project.fileSystem!.additions![path]!;
    const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    const data = readBw1Marts(project);
    expect(isBw1MartModule(rpm, data.layout)).toBe(true);
    expect(rpm.relocations.filter((entry) => entry.target.module === "21").map((entry) => entry.target.address).sort())
      .toEqual([BASE + POOL + 4, BASE + POOL + 12, BASE + POOL + 0xa8, BASE + POOL + 0xac].sort());
    expect(data.expanded).toBe(true);
    expect(data.shops[2]).toEqual([9]);
    const overlayBefore = project.overlays[21]!.slice();
    setBw1MartItems(project, 0, Array.from({ length: 40 }, (_unused, n) => n + 1));
    setBw1BpItems(project, 27, Array.from({ length: 40 }, (_unused, n) => ({ itemId: 300 + n, price: n })));
    expect(() => setBw1MartItems(project, 0, Array.from({ length: 41 }, (_unused, n) => n + 1))).toThrow(/at most 40/u);
    expect(project.overlays[21]).toEqual(overlayBefore);
    expect(parseBw1MartDll(project.fileSystem!.additions![path]!).shops[0]).toHaveLength(40);
    expect(getMartSlotLimit(project, 5)).toBe(40);
    expect(getBw1MartExpansionStatus(project)).toMatchObject({ installed: true, canUninstall: true, fitsInPlace: false });
    await expect(disableBw1MartExpansion(project)).rejects.toThrow(/holds 2 without expansion/u);
    setBw1MartItems(project, 0, [1]);
    setBw1BpItems(project, 27, [{ itemId: 300, price: 5 }]);
    await disableBw1MartExpansion(project);
    expect(listCodeInjectionDlls(project).some((entry) => /PokewebMarts/u.test(entry.fileName))).toBe(false);
    const back = readBw1Marts(project);
    expect(back.expanded).toBe(false);
    expect(back.shops[0]).toEqual([1]);
    expect(back.bpShops[1]).toEqual([{ itemId: 300, price: 5 }]);
  });

  it("refuses a module that already relocates the shop pool", async () => {
    const project = await fixture();
    const layout = readBw1Marts(project).layout;
    const other = parseRpm(buildBw1MartDll("B", layout, [[1]], [[]]), { allowedMagics: ["DLXF"] });
    stageCodeInjectionDll(project, "Other.dll", writeRpm({ ...other, metadata: { ...other.metadata, PokewebMarts: 0 } }, { ident: "DLXF" }), "patches", project.originalRomBytes);
    await expect(enableBw1MartExpansion(project)).rejects.toThrow(/Other\.dll already patches the shop tables/u);
  });
});

it("keeps working after a browser save drops the ROM bytes", async () => {
  const project = await fixture();
  readBw1Marts(project);
  delete project.originalRomBytes;
  setBw1MartItems(project, 1, [5]);
  delete project.originalRomBytes;
  expect(readBw1Marts(project).shops[1]).toEqual([5]);
});
