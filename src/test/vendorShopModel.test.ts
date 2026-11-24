import { describe, expect, it } from "vitest";
import { readU16, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import type { NintendoDSRom } from "../nds/rom";
import { readBattlePointShop, setBattlePointShop } from "../pokeweb/battlePointShopModel";
import { getBlackCityOffers, getJoinAvenueGoods, getJoinAvenueShops, setBlackCityOffer, setJoinAvenueOffer } from "../pokeweb/localShopModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { specialVendorEntries } from "../pokeweb/specialVendorModel";
import { decodeGen5TextBank, encodeGen5TextBank } from "../pokeweb/text";

describe("stock and prices for native shops", () => {
  it.each([
    ["IREO", 0x0217f600, 0x51318, 0x51808, 0x514a8],
    ["IRDO", 0x0217f640, 0x5130c, 0x517fc, 0x5149c],
  ] as const)("stages the shared BW2 BP stock for %s", (id, base, count, items, machines) => {
    const project = makeProject();
    const rom = { idCode: id } as NintendoDSRom;
    const overlay = Buffer.alloc(0x55b68);
    project.overlays[36] = overlay;
    writeU16(overlay, 0x2d254, 0x481f);
    writeU16(overlay, 0x2d25e, 0x5dc0);
    writeU32(overlay, 0x2d2d4, base + 0x55b60);
    writeU32(overlay, 0x2d2d8, base + count);
    writeU32(overlay, 0x55b60, base + items);
    writeU32(overlay, 0x55b64, base + machines);
    setBattlePointShop(project, rom, 0, [{ itemId: 2, price: 123 }, { itemId: 3, price: 14 }]);
    setBattlePointShop(project, rom, 1, [{ itemId: 618, price: 0 }]);

    expect(overlay[count]).toBe(0);
    expect(project.patches?.dirtyOverlayIds).toEqual([36]);
    expect(readBattlePointShop(project, rom, 0)).toEqual({ capacity: 42, entries: [{ itemId: 2, price: 123 }, { itemId: 3, price: 14 }] });
    expect(readBattlePointShop(project, rom, 1)).toEqual({ capacity: 18, entries: [{ itemId: 618, price: 0 }] });
    expect(() => setBattlePointShop(project, rom, 1, [{ itemId: 2, price: 40 }])).toThrow("TM or HM");
    expect(() => setBattlePointShop(project, rom, 0, [{ itemId: 2, price: 0 }])).toThrow("1 to 9,999");
    project.overlays[36]![0x2d254] = 0;
    expect(() => readBattlePointShop(project, rom, 0)).toThrow("unsupported overlay 36 layout");
  });

  it("isolates an edit to a shop rank even when multiple shops share a goods record", () => {
    const project = makeProject();
    const shops = words(25 * 3, []);
    shops.fill(0xff);
    for (const id of [1, 2]) {
      const offset = id * 50;
      writeU16(shops, offset, 7);
      writeU16(shops, offset + 2, 0);
      writeU16(shops, offset + 4, id - 1);
      writeU16(shops, offset + 18, 0);
    }
    const goods = words(10, [1, 1, 4, 5, 20, 2, 1, 0, 1005, 1005]);
    const rom = withArchive("a/2/4/4", [Uint8Array.of(29), shops, goods, Uint8Array.of(42)]);
    project.texts.storyTexts = [];
    project.texts.storyTexts[609] = Array.from({ length: 6 }, (_, id) => [String(id), id === 4 ? "Rare Lunch" : "", 0]);

    setJoinAvenueOffer(project, rom, 1, 0, { templateId: 0, price: 350 });
    const after = getJoinAvenueShops(project, rom);
    expect(after.map(({ goodIds }) => goodIds)).toEqual([[1], [0]]);
    expect(getJoinAvenueGoods(project, rom).map(({ label, price }) => [label, price])).toEqual([["Rare Lunch", 200], ["Rare Lunch", 350]]);
    const replacement = new NARC(project.fileSystem!.replacements[0]);
    expect([...replacement.files[3]]).toEqual([42]);
    expect(readU16(replacement.files[2], 20 + 16)).toBe(1005);
    expect(readU16(new NARC(rom.files[0]).files[2], 8)).toBe(20);

    setJoinAvenueOffer(project, rom, 1, 1, { itemId: 3, quantity: 12, price: 40 });
    expect(getJoinAvenueShops(project, rom)[0].goodIds).toEqual([1, 2]);
    expect(getJoinAvenueGoods(project, rom)[2]).toMatchObject({ itemId: 3, quantity: 12, price: 40 });
    expect(() => setJoinAvenueOffer(project, rom, 1, 0, { itemId: 2, quantity: 2, price: 43 })).toThrow("multiples of 10");
    setJoinAvenueOffer(project, rom, 1, 0, null);
    expect(getJoinAvenueShops(project, rom).map(({ goodIds }) => goodIds)).toEqual([[2], [0]]);
  });

  it("writes only the paid offer fields of the selected BW1 Black City resident", () => {
    const project = makeProject("BW");
    const rows = Array.from({ length: 30 }, () => new Uint8Array(48).fill(1));
    const rom = withArchive("a/1/5/4", rows);
    setBlackCityOffer(project, rom, 6, 3, 54000);
    expect(getBlackCityOffers(project, rom)[6]).toEqual({ resident: 6, itemId: 3, price: 54000 });
    const { files } = new NARC(project.fileSystem!.replacements[0]);
    expect([...files[5]]).toEqual([...rows[5]]);
    expect(files[6][0x27]).toBe(1);
    expect(files[6][0x2c]).toBe(1);
    expect(readU16(new NARC(rom.files[0]).files[6], 0x28)).toBe(257);
  });

  it("changes the vending operands and matching dialogue while preserving other script and text edits", () => {
    const project = makeProject();
    const files: Uint8Array[] = Array.from({ length: 1264 }, () => new Uint8Array());
    const vending = words(0x160, []);
    writeU16(vending, 0xe9, 0x28);
    writeU16(vending, 0xeb, 0x8021);
    writeU16(vending, 0xed, 30);
    writeU16(vending, 0xef, 0x28);
    writeU16(vending, 0xf1, 0x8022);
    writeU16(vending, 0xf3, 200);
    vending[0x150] = 47;
    files[1263] = vending;
    const banks: Uint8Array[] = Array.from({ length: 665 }, () => new Uint8Array());
    banks[664] = encodeGen5TextBank(Array.from({ length: 8 }, (_, i) => [`0_${i}`, i === 6 ? "Item 30VAR(48387, 1)$200" : "Unrelated $200", 0]));
    const scriptArchive = new NARC();
    scriptArchive.files = files;
    const textArchive = new NARC();
    textArchive.files = banks;
    const rom = {
      fileId: (path: string) => path === "a/0/5/6" ? 0 : 1,
      files: [scriptArchive.save(), textArchive.save()],
    } as unknown as NintendoDSRom;
    // The loaded script store can already contain staged changes from elsewhere in Pokeweb.
    project.narcs.scripts = { name: "scripts", fileId: 0, sourcePath: "a/0/5/6", fileCount: files.length, rawFiles: files, records: new Map(), dirty: new Set([1263]) };
    const entry = specialVendorEntries({ project, rom }, "scripts", 0)[0];
    expect(entry.values.map(({ value }) => value)).toEqual([30, 200]);
    entry.save([17, 275]);
    expect(specialVendorEntries({ project, rom }, "scripts", 0)[0].values.map(({ value }) => value)).toEqual([17, 275]);
    expect(vending[0xed]).toBe(30);
    expect(project.narcs.scripts.rawFiles[1263][0x150]).toBe(47);
    const lines = decodeGen5TextBank(new NARC(project.fileSystem!.replacements[1]).files[664]);
    expect(lines[6][1]).toBe("Item 17VAR(48387, 1)$275");
    expect(lines[0][1]).toBe("Unrelated $200");
    expect(() => entry.save([18, 300])).toThrow("This vendor changed");
  });

  it("keeps nearby overlay changes when making base and per-level Day Care fees independent", () => {
    const project = makeProject();
    const native = 0x3df8c;
    const data = new Uint8Array(native + 14);
    data.set(Uint8Array.of(0x08, 0xb5, 0xff, 0xf7, 0xeb, 0xff, 0x41, 0x1c, 0x64, 0x20, 0x48, 0x43, 0x08, 0xbd), native);
    data[0x42] = 39;
    project.overlays[36] = data;
    project.patches = { dirtyOverlayIds: [165, 36] };
    const arm9OverlayTable = new Uint8Array(32);
    writeU32(arm9OverlayTable, 0, 36);
    writeU32(arm9OverlayTable, 8, data.length);
    const rom = { idCode: "IREO", arm9OverlayTable } as NintendoDSRom;
    const context = { project, rom };
    specialVendorEntries(context, "daycare", 0)[0].save([125, 60]);
    const next = project.overlays[36]!;
    expect(next[0x42]).toBe(39);
    expect(project.patches.dirtyOverlayIds).toEqual([165, 36]);
    expect(specialVendorEntries(context, "daycare", 0)[0].values.map(({ value }) => value)).toEqual([125, 60]);
    specialVendorEntries(context, "daycare", 0)[0].save([100, 100]);
    expect(Buffer.compare(project.overlays[36]!, data)).toBe(0);
  });
});

function words(size: number, values: number[]): Uint8Array {
  const result = new Uint8Array(size * 2);
  values.forEach((value, index) => writeU16(result, index * 2, value));
  return result;
}

function withArchive(path: string, files: Uint8Array[]): NintendoDSRom {
  const archive = new NARC();
  archive.files = files;
  return { filenames: { idOf: (name: string) => name === path ? 0 : undefined }, files: [Buffer.from(archive.save())] } as unknown as NintendoDSRom;
}

function makeProject(baseRom: "BW" | "BW2" = "BW2"): ProjectState {
  return {
    session: { romName: "Shops", baseRom, baseVersion: baseRom === "BW" ? "B" : "B2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "Shops", idCode: "TEST", fileName: "shops.nds", size: 0 },
    arm9: new Uint8Array(), overlays: {}, narcs: {}, formats: {}, trpokInfo: [],
    texts: { banks: { items: Array.from({ length: 620 }, (_, id) => `Item ${id}`) } },
  };
}
