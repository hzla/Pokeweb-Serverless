import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  compile,
  recover,
  validate,
  canUseCurrency,
  pickerScript,
  RECORD_SIZE,
  type Assets,
} from "../systemShops/compiler";
import {
  defaults,
  newShop,
  tmTestShop,
  type Project,
} from "../systemShops/document";
import { NARC } from "../nds/narc";
import { currencyGraphics } from "../systemShops/graphics";
import { untile } from "../cgearButtons/compiler";
import { writeU16, writeU32, readU16, readU32 } from "../nds/binary";
import { decodeGen5TextBank } from "../pokeweb/text";
import { gen5ScriptCommandOffsets } from "../pokeweb/gen5ScriptCommands";
function assets(): Assets {
  const pockets = new Uint8Array(639);
  pockets[450] = 4;
  for (let i = 328; i <= 425; i++) pockets[i] = 2;
  for (let i = 618; i <= 620; i++) pockets[i] = 2;
  const icons = new NARC(),
    art = new Uint8Array(560),
    palette = new Uint8Array(72);
  art.set(new TextEncoder().encode("RGCN"));
  writeU32(art, 40, 512);
  art.fill(0x11, 48);
  palette.set(new TextEncoder().encode("RLCN"));
  icons.files = [art, palette];
  const iconMapping = new Uint8Array(639 * 4);
  for (let i = 0; i < 639; i++) writeU16(iconMapping, i * 4 + 2, 1);
  return {
    icons,
    iconMapping,
    pockets,
    items: Array.from({ length: 639 }, () => new Uint8Array(36)),
    names: new Map([
      [93, "Heart Scale"],
      [450, "Bicycle"],
    ]),
    messages: Array.from({ length: 35 }, (_, i) => [`0_${i}`, `Text ${i}`, 0]),
  };
}
describe("System Shops source and compiler", () => {
  it("recovers the 0.5.5 picker and recompiles it with a return loop", () => {
    const bytes = new Uint8Array(readFileSync(new URL("./fixtures/cgear-quick-actions-v0.5.5/shops.narc", import.meta.url)));
    const old = new NARC(bytes), state = recover(bytes);
    const upgraded = new NARC(compile(state, assets()));
    expect(recover(upgraded.save())).toEqual(state);
    expect(upgraded.files[2]).toEqual(pickerScript(1));
    expect(upgraded.files[2]).not.toEqual(old.files[2]);
    expect(upgraded.files[0][4]).toBe(old.files[0][4]);
  });
  it("uses one shop currency and encodes all twenty TM costs without modifying ROM prices", () => {
    const document = defaults(),
      shop = tmTestShop(document);
    document.shops.push(shop);
    expect(validate(document, assets())).toEqual([]);
    expect(shop.currency).toBe(93);
    const state: Project = { document, applied: structuredClone(document) },
      bytes = compile(state, assets()),
      arc = new NARC(bytes),
      h = arc.files[0];
    expect(h.length).toBe(32 + RECORD_SIZE);
    expect(readU16(h, 8)).toBe(1);
    expect(readU16(h, 34)).toBe(93);
    for (let i = 0; i < 20; i++) {
      expect(readU16(h, 96 + i * 8)).toBe(328 + i);
      expect(readU32(h, 100 + i * 8)).toBe(i + 1);
    }
    expect(recover(bytes)).toEqual(state);
    const menu = decodeGen5TextBank(arc.files[3]).map((e) => e[1]);
    expect(menu).toEqual(["Pokémart", "TM Shop", "Cancel"]);
    const text = decodeGen5TextBank(arc.files[4]);
    expect(text[20][1]).toBe("Heart Scale");
    expect(text[7][1]).toContain("Heart Scale");
    expect(text[7][1]).not.toContain("$");
  });
  it("scales the loaded currency icon into a centered 16px cell and retains its palette", () => {
    const a = assets(),
      [art, palette] = currencyGraphics(93, a.icons, a.iconMapping),
      pixels = untile(art);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++)
        expect(pixels[y * 32 + x]).toBe(
          x >= 8 && x < 24 && y >= 8 && y < 24 ? 1 : 0,
        );
    expect(palette.subarray(40)).toEqual(a.icons.files[1].subarray(40));
    const d = defaults();
    d.shops.push(tmTestShop(d));
    const arc = new NARC(compile({ document: d, applied: d }, a));
    expect(arc.files).toHaveLength(7);
    expect(arc.files[5]).toEqual(art);
    expect(arc.files[6]).toEqual(palette);
  });
  it("filters native non-stackable/key pockets while allowing ordinary stackable currencies", () => {
    const a = assets();
    for (const item of [1, 17, 93, 200])
      expect(canUseCurrency(item, a)).toBe(true);
    for (const item of [0, 328, 421, 450, 618, 999, -1, 1.5])
      expect(canUseCurrency(item, a)).toBe(false);
    const d = defaults();
    d.shops.push(newShop(d));
    d.shops[0].currency = 450;
    expect(validate(d, a).join()).toMatch(/stackable/);
  });
  it("separates applied stock from draft edits through archive recovery", () => {
    const d = defaults();
    d.shops.push(tmTestShop(d));
    const state: Project = { document: d, applied: structuredClone(d) };
    state.document.shops[0].inventory[0].cost = 99;
    const arc = new NARC(compile(state, assets()));
    expect(readU32(arc.files[0], 100)).toBe(1);
    expect(recover(arc.save()).document.shops[0].inventory[0].cost).toBe(99);
    const draft: Project = { document: d };
    expect(readU16(new NARC(compile(draft, assets())).files[0], 8)).toBe(0);
  });
  it("bounds names, counts, IDs, duplicate inventory and per-currency costs", () => {
    const a = assets(),
      d = defaults();
    const s = newShop(d);
    d.shops.push(s);
    s.name = "<script>";
    s.inventory.push({ ...s.inventory[0] });
    s.inventory[0].cost = 0;
    expect(validate(d, a)).toHaveLength(3);
    s.name = "Stock";
    s.inventory = [{ item: 17, cost: 9999999 }];
    expect(validate(d, a)).toEqual([]);
    s.currency = 93;
    expect(validate(d, a).join()).toMatch(/999/);
    s.inventory[0].cost = 999;
    s.inventory = Array.from({ length: 46 }, (_, i) => ({
      item: i + 1,
      cost: 1,
    }));
    expect(validate(d, a).join()).toMatch(/45/);
    d.shops = Array.from({ length: 17 }, (_, i) => ({
      ...s,
      id: i + 1,
      inventory: [{ item: 17, cost: 1 }],
    }));
    expect(validate(d, a).join()).toMatch(/16/);
  });
  it.each(Array.from({ length: 17 }, (_, i) => i))(
    "compiles a trusted picker for %i custom shops",
    (count) => {
      const bytes = pickerScript(count),
        offsets = gen5ScriptCommandOffsets(bytes, "BW2");
      expect(offsets.some((at) => readU16(bytes, at) === 0x149)).toBe(true);
      expect(offsets.filter((at) => readU16(bytes, at) === 0xaf)).toHaveLength(
        count + 2,
      );
    },
  );
  it("rejects source/compiled mismatches while preserving invalid draft edits", () => {
    const d = defaults();
    d.shops.push(tmTestShop(d));
    const arc = new NARC(
      compile({ document: d, applied: structuredClone(d) }, assets()),
    );
    const state = recover(arc.save());
    state.applied!.shops[0].inventory[0].cost = 5;
    arc.files[1] = new TextEncoder().encode(JSON.stringify(state));
    expect(() => recover(arc.save())).toThrow(/differs/);
    state.applied!.shops[0].inventory[0].cost = 1;
    state.document.shops[0].name = "<unfinished>";
    state.document.shops[0].inventory[0].item = Number.NaN;
    arc.files[1] = new TextEncoder().encode(JSON.stringify(state));
    expect(recover(arc.save()).document.shops[0].name).toBe("<unfinished>");
    expect(validate(recover(arc.save()).document, assets()).join()).toMatch(
      /must exist/,
    );
  });
  it.each([0, 2, 3, 4])(
    "rejects corruption in compiled member %i",
    (member) => {
      const d = defaults();
      d.shops.push(tmTestShop(d));
      const arc = new NARC(compile({ document: d, applied: d }, assets()));
      arc.files[member][arc.files[member].length - 1] ^= 1;
      expect(() => recover(arc.save())).toThrow();
    },
  );
});
