import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { NintendoDSRom } from "../nds/rom";
import type { ProjectState } from "../pokeweb/projectStore";
import { nativeLearnsetPreset } from "../customUi/nativeCatalog";
import { romAssets } from "../customUi/romAssets";
import { compile, decodeTiles, preview, type Compilation } from "../customUi/compiler";
import { expand555, rgb555, type Assets, type Image } from "../customUi/assets";
import { fixtures } from "../customUi/fixtures";
import { input, start } from "../customUi/interaction";
import { learnsetMoveLabel } from "../customUi/nativeLearnsetPreview";
import { archive, recoverArchive } from "../customUi/bundle";
import { NARC } from "../nds/narc";
import { parseNitroCellImage } from "../pokeweb/nitroCell";
import { parsePokemonAnimation } from "../pokeweb/pokemonSpriteModel";
import { newElement, newProject, SUMMARY_PAGES } from "../customUi/document";
import { composeSummary } from "../customUi/summaryAssets";
import { addSummaryPage, addStatOverlay } from "../customUi/summaryCatalog";

// Optional local integration fixtures; retail assets are never bundled with tests.
for (const [game, name] of [["W2", "cleanwhite2.nds"], ["B2", "cleanblack2.nds"]] as const) {
  const path = process.env[`CUSTOM_UI_${game}_ROM`] ?? new URL(`../../../${name}`, import.meta.url);
  describe.skipIf(!existsSync(path))(`Native learnset preview (${game} ROM assets)`, () => {
    const design = nativeLearnsetPreset(), sample = structuredClone(fixtures.full);
    const moves = [
      { name: "Flare Blitz", level: 1, type: "Fire", category: "Physical", power: 120, accuracy: 100, pp: 15, description: "The user cloaks itself in fire and charges\nat the target. The user sustains serious\ndamage and may leave the target burned." },
      { name: "Sand-Attack", level: 1, type: "Ground", category: "Status", power: 0, accuracy: 100, pp: 15, description: "An attack." },
      { name: "Bite", level: 5, type: "Dark", category: "Physical", power: 60, accuracy: 100, pp: 25, description: "An attack." },
      { name: "Shock Wave", level: 10, type: "Electric", category: "Special", power: 60, accuracy: 101, pp: 20, description: "An attack." },
    ];
    sample.catalog = { "497:0": { species: 497, form: 0, name: "Fixture", types: ["Grass"], abilities: [], stats: [75, 75, 95, 75, 95, 113], family: [], evolutionPages: [], learnset: moves } };
    let assets: Assets, compiled: Compilation;
    const listId = "learnset-moves_learnset-list";
    beforeAll(() => {
      const rom = new NintendoDSRom(new Uint8Array(readFileSync(path)), { fileData: "view" });
      const project: ProjectState = {
        session: { romName: name, generation: "gen5", baseRom: "BW2", baseVersion: game, fairy: false, fileIds: {}, blacklist: [] },
        romInfo: { title: game, idCode: game === "W2" ? "IRDO" : "IREO", fileName: name, size: 0 },
        arm9: new Uint8Array(), overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
      };
      assets = romAssets(project, rom, design); compiled = compile(design.document, assets);
      expect(compiled.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    }, 30000);
    const pixel = (image: Image, x: number, y: number) => [...image.pixels.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
    function glyphAt(image: Image, character: string, x: number, y: number, color: number) {
      const glyph = assets.glyph(0, character)!;
      for (const level of [1, 2]) {
        const i = glyph.pixels.findIndex(p => p === level); expect(i).toBeGreaterThanOrEqual(0);
        const expected = [...expand555(rgb555(assets.nativeLearnset!.palette[level === 1 ? color : 2])).map(Math.round), 255];
        expect(pixel(image, x + i % glyph.width, y + Math.floor(i / glyph.width))).toEqual(expected);
      }
    }
    function spriteAt(image: Image, name: string, x: number, y: number) {
      const metadata = compiled.screens[0].nativeLearnset!.sprites[name];
      const sprite = decodeTiles(compiled.screens[0].resources[metadata.key]);
      for (let sy = 0; sy < sprite.height; sy++) for (let sx = 0; sx < sprite.width; sx++) {
        const px = x + metadata.x + sx, py = y + metadata.y + sy;
        if (pixel(sprite, sx, sy)[3] && px >= 0 && py >= 0 && px < 256 && py < 192) expect(pixel(image, px, py)).toEqual(pixel(sprite, sx, sy));
      }
    }
    it("uses native windows, row offsets, three-line spacing and both glyph colors", () => {
      const session = start(compiled.document, sample, "party"), result = preview(compiled, assets, sample, session);
      glyphAt(result.bottom, "T", 8, 0, 1); glyphAt(result.bottom, "a", 8, 16, 1); glyphAt(result.bottom, "d", 8, 32, 1);
      glyphAt(result.bottom, "P", 64, 48, 1); glyphAt(result.bottom, "A", 152, 48, 1);
      glyphAt(result.bottom, "1", 66, 72, 15); glyphAt(result.bottom, "P", 184, 72, 1);
      spriteAt(result.bottom, "category-1", 33, 56);
      spriteAt(result.bottom, "type-9", 47, 80);
      expect(result.diagnostics.filter(d => d.element === "learnset-moves" && d.code !== "native-preview")).toEqual([]);
    });
    it("paints authored lower-screen overlays in layer order around the native region", () => {
      const p = nativeLearnsetPreset(), overlay = newElement("panel", "overlay", "bottom");
      Object.assign(overlay, { x: 0, y: 0, width: 8, height: 8 }); overlay.paint.fill = "#ff0000"; overlay.paint.borderWidth = 0;
      const base = preview(compiled, assets, sample, start(compiled.document, sample, "party"));
      p.document.screens[0].elements.push(overlay);
      const above = compile(p.document, assets), rendered = preview(above, assets, sample, start(above.document, sample, "party"));
      expect(pixel(rendered.bottom, 0, 0)).toEqual([255, 0, 0, 255]);
      p.document.screens[0].elements.pop(); p.document.screens[0].elements.unshift(overlay);
      const below = compile(p.document, assets);
      expect(pixel(preview(below, assets, sample, start(below.document, sample, "party")).bottom, 0, 0)).toEqual(pixel(base.bottom, 0, 0));
    });
    it("keeps complete cells, the slanted cursor animation, and native footer graphics", () => {
      expect(assets.nativeLearnset!.sprites["type-9"]).toMatchObject({ width: 32, height: 16, x: -16, y: -8 });
      const session = start(compiled.document, sample, "party");
      const frames = compiled.screens[0].nativeLearnset!.cursor; expect(frames.length).toBeGreaterThan(1);
      for (const frame of frames) {
        const result = preview(compiled, assets, sample, session);
        spriteAt(result.bottom, frame.sprite, 130, 84);
        spriteAt(result.bottom, "down", 8, 168); spriteAt(result.bottom, "up", 40, 168); spriteAt(result.bottom, "back", 224, 168);
        session.frame += frame.duration;
      }
    });
    it("updates category, details and highlighting through touch and button selection", () => {
      const session = start(compiled.document, sample, "party");
      input(compiled.document, sample, session, "down");
      expect(session.stack[0].lists[listId].index).toBe(1);
      spriteAt(preview(compiled, assets, sample, session).bottom, "category-0", 33, 56);
      input(compiled.document, sample, session, { x: 100, y: 150 });
      expect(session.stack[0].lists[listId].index).toBe(3);
      const bottom = preview(compiled, assets, sample, session).bottom;
      spriteAt(bottom, "category-2", 33, 56);
      spriteAt(bottom, compiled.screens[0].nativeLearnset!.cursor[0].sprite, 130, 156);
      const width = [..."---"].reduce((n, c) => n + assets.glyph(0, c)!.advance, 0);
      glyphAt(bottom, "-", 240 - width, 48, 1);
      input(compiled.document, sample, session, { x: 48, y: 180 });
      expect(session.stack[0].lists[listId].index).toBe(2);
      input(compiled.document, sample, session, { x: 18, y: 180 });
      expect(session.stack[0].lists[listId].index).toBe(3);
      input(compiled.document, sample, session, { x: 236, y: 180 }); expect(session.closed).toBe(true);
    });
    it("scrolls without drawing text/icons into adjacent rows and handles empty lists", () => {
      const long = structuredClone(sample); long.catalog!["497:0"].learnset = Array.from({ length: 30 }, (_, i) => ({ ...moves[0], level: i + 1 }));
      const session = start(compiled.document, long, "party");
      for (let i = 0; i < 10; i++) input(compiled.document, long, session, "down");
      expect(session.stack[0].lists[listId]).toEqual({ index: 10, scroll: 7 });
      const bottom = preview(compiled, assets, long, session).bottom;
      glyphAt(bottom, "8", 66, 72, 15); glyphAt(bottom, "1", 66, 144, 15);
      long.catalog!["497:0"].learnset = [];
      expect(preview(compiled, assets, long, start(compiled.document, long, "party")).diagnostics.filter(d => d.severity === "error")).toEqual([]);
    });
    it("uses native measured ellipses and preserves native preview resources in archives", () => {
      expect(learnsetMoveLabel(1, "Flare Blitz", assets)).toBe("1 - Flare Blitz");
      const label = learnsetMoveLabel(100, "A very long edited move name", assets);
      expect(label).toMatch(/^100 - .*\.\.\.$/); expect([...label].reduce((n, c) => n + assets.glyph(0, c)!.advance, 0)).toBeLessThanOrEqual(106);
      const bytes = archive(design, compiled), files = new NARC(bytes).files;
      const index = JSON.parse(new TextDecoder().decode(files.at(-1)!));
      expect(index.screens[0].nativeLearnset).toEqual(compiled.screens[0].nativeLearnset);
      expect(recoverArchive(bytes).document).toEqual(design.document);
    });
  });
}

for (const [game, name] of [["W2", "cleanwhite2.nds"], ["B2", "cleanblack2.nds"]] as const) {
  const path = process.env[`CUSTOM_UI_${game}_ROM`] ?? new URL(`../../../${name}`, import.meta.url);
  describe.skipIf(!existsSync(path))(`Summary layout preview (${game} ROM assets)`, () => {
    it("decodes all four native page backgrounds, previews resized windows and packages EV/IV overlays", () => {
      const rom = new NintendoDSRom(new Uint8Array(readFileSync(path)), { fileData: "view" });
      const project: ProjectState = {
        session: { romName: name, generation: "gen5", baseRom: "BW2", baseVersion: game, fairy: false, fileIds: {}, blacklist: [] },
        romInfo: { title: game, idCode: rom.idCode, fileName: name, size: 0 },
        arm9: new Uint8Array(), overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
      };
      const p = newProject(); p.document.screens = []; p.document.launchers = {};
      SUMMARY_PAGES.forEach(page => addSummaryPage(p.document, page));
      const stats = p.document.screens.find(s => s.target?.page === "stats")!;
      const attack = stats.elements.find(e => e.native === "summary.stats.attack")!; attack.x += 8; attack.width = 96;
      addStatOverlay(p.document, stats, "bottom", "ev"); addStatOverlay(p.document, stats, "top", "iv");
      const a = romAssets(project, rom, p), c = compile(p.document, a);
      expect(c.diagnostics.filter(d => d.severity === "error")).toEqual([]); expect(c.screens).toHaveLength(4);
      for (const s of c.screens) {
        expect(Object.keys(s.resources).filter(k => k.startsWith("rom:summary:"))).toHaveLength(2);
        const session = start({ ...c.document, launchers: { party: s.id } }, fixtures.full, "party"); session.stack[0].moveSelection = { source: "moves", index: 0 };
        const result = preview(c, a, fixtures.full, session);
        expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
        expect(new Set(result.top.pixels).size).toBeGreaterThan(10);
        expect(new Set(result.bottom.pixels).size).toBeGreaterThan(10);
      }
      expect(recoverArchive(archive(p, c))).toEqual(p);
      const windows = c.screens.find(s => s.id === stats.id)!.elements.filter(e => e.id.startsWith(`${attack.id}_`));
      expect(windows.every(e => e.x >= attack.x && e.x + e.width <= attack.x + attack.width)).toBe(true);
    }, 30000);
  });
}

for (const [game, name] of [["W2", "cleanwhite2.nds"], ["B2", "cleanblack2.nds"]] as const) {
  const path = process.env[`CUSTOM_UI_${game}_ROM`] ?? new URL(`../../../${name}`, import.meta.url);
  describe.skipIf(!existsSync(path))(`Summary actors and scrolling (${game})`, () => {
    let assets: Assets, compiled: Compilation, summaryFiles: Uint8Array[];
    const p = newProject(), sample = structuredClone(fixtures.full);
    p.document.screens = []; p.document.launchers = { party: addSummaryPage(p.document, "stats") };
    sample.party[0].nature = "Naive";
    beforeAll(() => {
      const rom = new NintendoDSRom(new Uint8Array(readFileSync(path)), { fileData: "view" });
      const project = { session: { baseRom: "BW2", baseVersion: game }, narcs: {}, texts: { banks: {} }, formats: {}, overlays: {} } as unknown as ProjectState;
      summaryFiles = new NARC(rom.files[rom.filenames.idOf("a/0/7/7")!]).files;
      assets = romAssets(project, rom, p); compiled = compile(p.document, assets);
      expect(compiled.valid).toBe(true);
    });
    const pixel = (image: Image, x: number, y: number) => [...image.pixels.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
    it("scrolls up-left by one pixel every four frames, wrapping the full native map", () => {
      const art = assets.nativeSummary!, layers = Object.fromEntries(["grid", "plate", "title"].map(k => [k, art.layers[`summary:stats:top:${k}`]]));
      const a = composeSummary(layers, 0), b = composeSummary(layers, 3), c = composeSummary(layers, 4);
      expect(b.pixels).toEqual(a.pixels); expect(c.pixels).not.toEqual(a.pixels);
      expect(composeSummary(layers, 1024).pixels).toEqual(a.pixels);
      // A transparent panel pixel must sample (x+1,y+1) from the scroll map.
      let checked = 0;
      for (let y = 0; y < 191; y++) for (let x = 0; x < 255; x++) if (!pixel(layers.plate, x, y)[3] && !pixel(layers.title, x, y)[3]) {
        expect(pixel(c, x, y)).toEqual([...pixel(layers.grid, x + 1, y + 1).slice(0, 3).map(v => Math.round((v >> 3) * 255 / 31)), 255]); checked++;
      }
      expect(checked).toBeGreaterThan(100);
      // RGB555 13/16 + 16/16 hardware blend, not CSS alpha interpolation.
      const x = 200, y = 100, front = pixel(layers.plate, x, y), back = pixel(layers.grid, x, y);
      expect(pixel(a, x, y)).toEqual([...front.slice(0, 3).map((v, i) => Math.round(Math.min(31, ((v >> 3) * 13 + (back[i] >> 3) * 16) >> 4) * 255 / 31)), 255]);
    });
    it("uses the native glyph shadows, nature colors and ability text from the ROM", () => {
      const session = start(compiled.document, sample, "party"), out = preview(compiled, assets, sample, session);
      const check = (char: string, x: number, y: number, fg: number, shadow: number) => {
        const glyph = assets.glyph(0, char)!;
        for (const level of [1, 2]) { const at = glyph.pixels.findIndex(p => p === level); expect(pixel(out.top, x + at % glyph.width, y + Math.floor(at / glyph.width))).toEqual([...expand555(rgb555(assets.nativeSummary!.palette[level === 1 ? fg : shadow])).map(Math.round), 255]); }
      };
      check("S", 65, 121, 15, 9); check("S", 65, 105, 15, 10); check("A", 65, 57, 15, 2);
      expect(assets.summaryPokemon!(sample.party[0]).abilityDescription).toContain("Grass-type");
      expect(out.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    });
    it("preserves the right cap beyond x=127 in every normal and selected move plate", () => {
      const session = start(compiled.document, sample, "party"), rendered = preview(compiled, assets, sample, session);
      const sequences = parsePokemonAnimation(summaryFiles[134]).sequences;
      for (const selected of [false, true]) for (let row = 0; row < 4; row++) {
        const name = `move-${selected ? "selected-" : ""}${row}`, sprite = assets.nativeSummary!.sprites[name];
        // An independently oversized cell canvas includes the entire positive
        // OAM range; a 256px centered canvas silently lost this last 8px strip.
        const reference = parseNitroCellImage(name, summaryFiles[17], summaryFiles[7], summaryFiles[83], sequences[row + (selected ? 5 : 0)].frames[0].cellIndex, 512);
        expect(sprite).toMatchObject({ x: 0, width: 136 });
        let visible = 0, mismatches = 0;
        for (let y = 0; y < sprite.height; y++) for (let x = 128; x < 136; x++) {
          const at = ((256 + sprite.y + y) * reference.width + 256 + x) * 4, expected = [...reference.rgba.slice(at, at + 4)];
          if (pixel(sprite, x, y).some((v, i) => v !== expected[i])) mismatches++;
          if (expected[3]) {
            visible++;
            if (!selected) expect(pixel(rendered.bottom, 8 + x, 16 + row * 32 + sprite.y + y)).toEqual([...expected.slice(0, 3).map(v => Math.round((v >> 3) * 255 / 31)), 255]);
          }
        }
        expect(visible, name).toBeGreaterThan(0);
        expect(mismatches, name).toBe(0);
      }
    });
    it("keeps static Pokémon, move plate and footer pixels fixed while the grid moves", () => {
      const session = start(compiled.document, sample, "party"), a = preview(compiled, assets, sample, session);
      session.frame = 20; const b = preview(compiled, assets, sample, session), native = compiled.screens[0].nativeSummary!;
      expect(b.bottom.pixels).not.toEqual(a.bottom.pixels);
      for (const [name, x, y] of [["move-0", 8, 16], ["back", 232, 168]] as const) {
        const metadata = native.sprites[name], sprite = decodeTiles(compiled.screens[0].resources[metadata.key]);
        for (let sy = 0; sy < sprite.height; sy++) for (let sx = 0; sx < sprite.width; sx++) if (pixel(sprite, sx, sy)[3] && x + metadata.x + sx < 256 && y + metadata.y + sy < 192) expect(pixel(b.bottom, x + metadata.x + sx, y + metadata.y + sy)).toEqual(pixel(a.bottom, x + metadata.x + sx, y + metadata.y + sy));
      }
      const sprite = assets.pokemonSprite!(sample.party[0])!; expect(sprite).toBeDefined();
      for (let y = 0; y < sprite.height; y++) for (let x = 0; x < sprite.width; x++) if (pixel(sprite, x, y)[3]) expect(pixel(b.bottom, 160 + x, 24 + y)).toEqual(pixel(a.bottom, 160 + x, 24 + y));
      const packed = new NARC(archive(p, compiled)).files, metadata = JSON.parse(new TextDecoder().decode(packed.at(-1)!));
      expect(metadata.screens[0].nativeSummary).toEqual(native);
    });
  });
}
