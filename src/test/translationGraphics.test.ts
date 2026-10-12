import { describe, expect, it } from "vitest";
import { writeU16, writeU32 } from "../nds/binary";
import { Folder, addFilePath, saveFnt } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { compressLz11Literal } from "../pokeweb/pokemonSpriteModel";
import { loadTranslationProfile } from "../pokeweb/translationProfile";
import { compareTranslationGraphics, openTranslationPreviewRom, renderTranslationGraphic, renderTranslationTileSheet } from "../pokeweb/translationGraphics";
import { renderUntransferredDifferences } from "../ui/translation";
import type { TranslationReport } from "../pokeweb/translationModel";

const stamp = (bytes: Uint8Array, at: number, value: string) => bytes.set(new TextEncoder().encode(value), at);
function tiles(value: number, depth = 3): Uint8Array {
  const bytes = new Uint8Array(48 + (depth === 4 ? 64 : 32));
  stamp(bytes, 0, "RGCN"); writeU16(bytes, 12, 16); writeU16(bytes, 14, 1);
  stamp(bytes, 16, "RAHC"); writeU32(bytes, 20, bytes.length - 16); writeU32(bytes, 28, depth);
  writeU32(bytes, 40, bytes.length - 48); bytes.fill(value, 48); return bytes;
}
function palette(): Uint8Array {
  const bytes = new Uint8Array(72); stamp(bytes, 0, "RLCN"); writeU16(bytes, 12, 16); writeU16(bytes, 14, 1);
  stamp(bytes, 16, "TTLP"); writeU32(bytes, 20, 56); writeU32(bytes, 32, 32);
  writeU16(bytes, 42, 31); writeU16(bytes, 44, 31 << 5); return bytes;
}
function screen(): Uint8Array {
  const bytes = new Uint8Array(38); stamp(bytes, 0, "RCSN"); writeU16(bytes, 12, 16); writeU16(bytes, 14, 1);
  stamp(bytes, 16, "NRCS"); writeU32(bytes, 20, 22); writeU16(bytes, 24, 8); writeU16(bytes, 26, 8); writeU32(bytes, 32, 2); return bytes;
}
function blobRom(resource: Uint8Array) {
  const bytes = new Uint8Array(0x2000), fnt = saveFnt(addFilePath(new Folder(), "a/0/7/7", 0));
  stamp(bytes, 12, "IRDO"); writeU32(bytes, 0x40, 0x200); writeU32(bytes, 0x44, fnt.length);
  writeU32(bytes, 0x48, 0x300); writeU32(bytes, 0x4c, 8); bytes.set(fnt, 0x200);
  writeU32(bytes, 0x300, 0x400); writeU32(bytes, 0x304, 0x400 + resource.length); bytes.set(resource, 0x400);
  const reads: [number, number][] = [];
  const blob = {
    size: bytes.length, arrayBuffer: () => { throw new Error("Full ROM read forbidden"); },
    slice: (start: number, end: number) => { reads.push([start, end]); return new Blob([bytes.slice(start, end)]); },
  } as unknown as Blob;
  return { bytes, blob, reads };
}

describe("ROM-only translation graphics", () => {
  it("reads the file tables and requested resource slices without loading the whole ROM", async () => {
    const fixture = blobRom(Uint8Array.of(1, 2, 3)), rom = await openTranslationPreviewRom(fixture.blob);
    expect(fixture.reads).toHaveLength(3);
    expect(await rom.readFile("a/0/7/7")).toEqual(Uint8Array.of(1, 2, 3));
    expect(fixture.reads.at(-1)).toEqual([0x400, 0x403]);
    await expect(rom.readFile("missing")).rejects.toThrow("Missing");
    writeU32(fixture.bytes, 0x304, fixture.bytes.length + 1);
    const invalid = await openTranslationPreviewRom(fixture.blob);
    await expect(invalid.readFile("a/0/7/7")).rejects.toThrow("outside");
  });
  it("rejects cyclic directory tables before traversing them", async () => {
    const fixture = blobRom(new Uint8Array());
    const firstEntries = new DataView(fixture.bytes.buffer).getUint32(0x200, true);
    writeU16(fixture.bytes, 0x200 + firstEntries + 2, 0xf000);
    await expect(openTranslationPreviewRom(fixture.blob)).rejects.toThrow("cyclic");
  });
  it("decodes 4bpp and 8bpp pixels using only supplied palette data and exposes grayscale fallback", () => {
    const image = renderTranslationTileSheet(tiles(0x21), palette());
    expect(Array.from(image.rgba.slice(0, 8))).toEqual([248, 0, 0, 255, 0, 248, 0, 255]);
    expect(Array.from(renderTranslationTileSheet(tiles(2, 4), palette()).rgba.slice(0, 4))).toEqual([0, 248, 0, 255]);
    expect(renderTranslationTileSheet(tiles(0)).rgba[3]).toBe(0);
    expect(renderTranslationTileSheet(tiles(1)).warnings[0]).toContain("Grayscale");
    expect(() => renderTranslationTileSheet(tiles(1).slice(0, -1))).toThrow("truncated");
  });
  it.each(["white2", "black2"] as const)("finds compressed %s Summary artwork changes and renders the matching US and donor components", async game => {
    const profile = await loadTranslationProfile("italian", game), baseline = profile.files.find(file => file.path === "a/0/7/7")!;
    const archive = (value: number) => {
      const n = new NARC(); n.files = Array.from({ length: baseline.members! }, () => new Uint8Array());
      n.files[2] = palette(); n.files[11] = compressLz11Literal(tiles(value));
      for (const member of [67, 71, 77, 78]) n.files[member] = screen();
      return n.save();
    };
    const rom = (code: string, value: number) => ({ gameCode: code, revision: 0, readFile: async (path: string) => {
      if (path !== "a/0/7/7") throw new Error("Not in fixture"); return archive(value);
    } });
    const source = rom(profile.sourceCode, 0x11), donor = rom(profile.donorCode, 0x22), catalog = await compareTranslationGraphics(source, donor);
    const graphic = catalog.graphics.find(g => g.member === 67)!;
    expect(graphic).toMatchObject({ kind: "background", character: 11, palette: 2 });
    const a = await renderTranslationGraphic(source, graphic), b = await renderTranslationGraphic(donor, graphic);
    expect(a?.warnings).toEqual([]); expect(b?.warnings).toEqual([]);
    expect(Array.from(a!.rgba.slice(0, 4))).toEqual([248, 0, 0, 255]);
    expect(Array.from(b!.rgba.slice(0, 4))).toEqual([0, 248, 0, 255]);
    await expect(compareTranslationGraphics(source, donor, "french")).rejects.toThrow("does not match");
    await expect(compareTranslationGraphics(source, rom(game === "black2" ? "IRDI" : "IREI", 0x22))).rejects.toThrow("matching the US game");
  });
  it("shows retained native edits separately from retail regional differences and escapes donor content", () => {
    const report = { records: [
      { path: "arm9", scope: "section", action: "retained", change: "regional-and-hack", reason: "US code retained" },
      { path: "overlay/arm9/36", scope: "file", action: "retained", change: "regional", reason: "US overlay retained" },
      { path: "<new>", scope: "file", action: "skipped", change: "hack", reason: "<script>" },
      { path: "imported", scope: "member", action: "imported", change: "hack", donor: { sha256: "same" }, output: { sha256: "same" } },
      { path: "a/0/0/3", member: 436, scope: "member", action: "imported", change: "regional", donor: { sha256: "regional" }, output: { sha256: "trimmed" }, omittedEntries: 8 },
    ] } as unknown as TranslationReport;
    const html = renderUntransferredDifferences(report);
    expect(html).toContain("2 donor edits · 2 regional differences");
    expect(html).toContain("1 native sections or overlays");
    expect(html).toContain("&lt;new&gt;"); expect(html).not.toContain("<script>"); expect(html).not.toContain("imported</th>");
    expect(html).toContain("8 extra regional entries omitted"); expect(html).toContain("partially imported");
  });
});
