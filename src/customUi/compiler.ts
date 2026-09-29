import { type Assets, type Image, expand555 } from "./assets";
import type { Diagnostic, Document, Element, GameData, PhysicalScreen, Screen } from "./document";
import { actionAvailable, resolveText, selectedPokemon, viewInfo, listMoves, type FrameState, type Interaction } from "./interaction";
import { blank, fill, blit, panel, text } from "./raster";
import { drawNativeLearnsetMoves, type CompiledLearnsetPreview } from "./nativeLearnsetPreview";
import { drawSummaryRegion, type CompiledSummaryPreview } from "./summaryPreview";
import { migrateSummaryLayouts } from "./summaryCatalog";
import { validate } from "./validate";

export const LIMITS = { tiles: 768, colors: 256, sprites: 128, backgroundVram: 65536, spriteVram: 32768, heap: 262144, upload: 12288 } as const;
export type Tiles = { width: number; height: number; palette: Uint16Array; tiles: Uint8Array; map: Uint16Array };
export type Budget = { palette: number; tiles: number; sprites: number; videoMemory: number; heap: number; initialUpload: number; frameUpload: number };
export type CompiledScreen = { id: string; background: Record<PhysicalScreen, Tiles>; elements: Element[]; resources: Record<string, Tiles>; budgets: Record<PhysicalScreen, Budget>; nativeLearnset?: CompiledLearnsetPreview; nativeSummary?: CompiledSummaryPreview };
export type Compilation = { version: 1; document: Document; screens: CompiledScreen[]; diagnostics: Diagnostic[]; valid: boolean };
export type Preview = { top: Image; bottom: Image; diagnostics: Diagnostic[] };

function pixel555(pixels: Uint8ClampedArray, pos: number): number { return (pixels[pos] >> 3) | ((pixels[pos + 1] >> 3) << 5) | ((pixels[pos + 2] >> 3) << 10); }
function colorDistance(a: number, b: number) { return ((a & 31) - (b & 31)) ** 2 + ((a >> 5 & 31) - (b >> 5 & 31)) ** 2 + ((a >> 10 & 31) - (b >> 10 & 31)) ** 2; }
function paletteFor(colors: Map<number, number>, max: number): number[] {
  const values = [...colors.keys()].sort((a, b) => a - b);
  if (values.length <= max) return values;
  const boxes: number[][] = [values];
  while (boxes.length < max) {
    let best = -1, bestScore = -1, channel = 0;
    for (const [i, box] of boxes.entries()) {
      if (box.length < 2) continue;
      for (let c = 0; c < 3; c++) {
        let min = 31, maxValue = 0, weight = 0;
        for (const v of box) { const n = v >> (c * 5) & 31; min = Math.min(min, n); maxValue = Math.max(maxValue, n); weight += colors.get(v)!; }
        const score = (maxValue - min) * Math.sqrt(weight);
        if (score > bestScore) { best = i; bestScore = score; channel = c; }
      }
    }
    if (best < 0) break;
    const box = boxes[best].sort((a, b) => (a >> (channel * 5) & 31) - (b >> (channel * 5) & 31) || a - b);
    const total = box.reduce((n, c) => n + colors.get(c)!, 0); let weight = 0, split = 1;
    for (; split < box.length; split++) { weight += colors.get(box[split - 1])!; if (weight >= total / 2) break; }
    boxes.splice(best, 1, box.slice(0, split), box.slice(split));
  }
  return boxes.filter(b => b.length).map(box => {
    let total = 0; const sum = [0, 0, 0];
    for (const color of box) { const w = colors.get(color)!; total += w; for (let c = 0; c < 3; c++) sum[c] += (color >> (c * 5) & 31) * w; }
    return Math.round(sum[0] / total) | Math.round(sum[1] / total) << 5 | Math.round(sum[2] / total) << 10;
  });
}
/** Deterministic RGB555 quantization, transparent index zero, deduplicated 8×8 tiles. */
export function encodeTiles(image: Image): Tiles {
  const colors = new Map<number, number>();
  for (let p = 0; p < image.pixels.length; p += 4) if (image.pixels[p + 3] >= 128) { const c = pixel555(image.pixels, p); colors.set(c, (colors.get(c) ?? 0) + 1); }
  const palette = [0, ...paletteFor(colors, 255)], lookup = new Map<number, number>();
  for (const color of colors.keys()) { let best = 1, distance = Infinity; for (let i = 1; i < palette.length; i++) { const d = colorDistance(color, palette[i]); if (d < distance) { best = i; distance = d; } } lookup.set(color, best); }
  const width = Math.ceil(image.width / 8), height = Math.ceil(image.height / 8), map = new Uint16Array(width * height), tiles: Uint8Array[] = [], indexes = new Map<string, number>();
  for (let ty = 0; ty < height; ty++) for (let tx = 0; tx < width; tx++) {
    const tile = new Uint8Array(64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const px = tx * 8 + x, py = ty * 8 + y, at = (py * image.width + px) * 4;
      if (px < image.width && py < image.height && image.pixels[at + 3] >= 128) tile[y * 8 + x] = lookup.get(pixel555(image.pixels, at))!;
    }
    const key = tile.join(","); let index = indexes.get(key);
    if (index === undefined) { index = tiles.length; indexes.set(key, index); tiles.push(tile); }
    map[ty * width + tx] = index;
  }
  const pixels = new Uint8Array(tiles.length * 64); tiles.forEach((tile, i) => pixels.set(tile, i * 64));
  return { width: image.width, height: image.height, palette: Uint16Array.from(palette), tiles: pixels, map };
}
export function decodeTiles(resource: Tiles): Image {
  const { width, height, palette, tiles, map } = resource, pixels = new Uint8ClampedArray(width * height * 4), columns = Math.ceil(width / 8);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const tile = map[(y >> 3) * columns + (x >> 3)], index = tiles[tile * 64 + (y & 7) * 8 + (x & 7)];
    pixels.set([...expand555(palette[index] ?? 0), index ? 255 : 0], (y * width + x) * 4);
  }
  return { width, height, pixels };
}
const resourceKey = (e: Element) => e.image?.kind === "import" ? `import:${e.image.id}` : e.image?.kind === "type" ? `type:${e.image.type}` : e.image?.kind === "rom" ? `rom:${e.image.key}` : undefined;
export function compile(document: Document, assets: Assets): Compilation {
  if (document.screens.some(s => s.target && s.target.layoutVersion !== 1)) { document = structuredClone(document); migrateSummaryLayouts(document); }
  if (document.screens.some(s => s.elements.some(e => e.kind === "native"))) {
    const errors = validate(document);
    if (!errors.some(d => d.severity === "error") && assets.resolveNative) {
      const result = compile(assets.resolveNative(document), assets);
      for (const screen of result.screens) {
        const region = document.screens.find(s => s.id === screen.id)?.elements.find(e => e.kind === "native" && e.native === "learnset.moves" && !e.hidden);
        const summary = document.screens.find(s => s.id === screen.id)?.elements.filter(e => e.native?.startsWith("summary.") && !e.hidden);
        if (summary?.length && assets.nativeSummary) {
          const art = assets.nativeSummary, sprites: CompiledSummaryPreview["sprites"] = {}, layers: Record<string, string> = {};
          for (const [name, sprite] of Object.entries(art.sprites)) { const key = `native-summary:${name}`; screen.resources[key] = encodeTiles(sprite); sprites[name] = { key, x: sprite.x, y: sprite.y }; }
          const page = document.screens.find(s => s.id === screen.id)!.target!.page;
          for (const [name, layer] of Object.entries(art.layers)) if (name === "footer" || name.startsWith(`summary:${page}:`)) { const key = `native-summary:${name}`; screen.resources[key] = encodeTiles(layer); layers[name] = key; }
          screen.nativeSummary = { regions: Object.fromEntries(summary.map(e => [`${e.id}__native`, structuredClone(e)])), layers, sprites, palette: art.palette, platePalette: art.platePalette, hpPalette: art.hpPalette, typeNames: art.typeNames };
        } else if (summary?.length) { result.diagnostics.push({ severity: "error", code: "summary-preview", screen: screen.id, message: "Native Summary resources are unavailable." }); result.valid = false; }
        if (!region) continue;
        const art = assets.nativeLearnset;
        if (!art) { result.diagnostics.push({ severity: "error", code: "native-preview", screen: screen.id, element: region.id, message: "The ROM's native move-list resources are unavailable." }); result.valid = false; continue; }
        const sprites: CompiledLearnsetPreview["sprites"] = {};
        for (const [name, sprite] of Object.entries(art.sprites)) {
          const key = `native-learnset:${name}`;
          screen.resources[key] = encodeTiles(sprite);
          sprites[name] = { key, x: sprite.x, y: sprite.y };
        }
        screen.nativeLearnset = { element: region.id, list: `${region.id}_learnset-list`, palette: art.palette, typeNames: art.typeNames, cursor: art.cursor, sprites };
      }
      if (document.screens.some(s => s.target)) result.diagnostics.push({ severity: "warning", code: "summary-preview", message: "Summary preview uses native graphics, scrolling backgrounds and static Pokémon sprites. Ribbon actors and native navigation are not yet simulated; Summary installation hooks are not implemented." });
      result.diagnostics.push({ severity: "warning", code: "native-preview", message: "Native preview uses ROM graphics and glyphs. In-game transitions and upper-panel behavior still require emulator verification." }); return result;
    }
    return { version: 1, document, screens: [], diagnostics: [...errors, { severity: "error", code: "native-preview", message: "Load a supported BW2 ROM to preview these native regions." }], valid: false };
  }
  const diagnostics = validate(document), result: Compilation = { version: 1, document: structuredClone(document), screens: [], diagnostics, valid: false };
  if (diagnostics.some(d => d.severity === "error")) return result;
  for (const screen of document.screens) {
    const resources: Record<string, Tiles> = {};
    for (const e of screen.elements) {
      const key = resourceKey(e); if (key && !resources[key]) {
        const image = assets.image(key);
        if (!image) diagnostics.push({ severity: "error", code: "missing-asset", screen: screen.id, element: e.id, message: `Asset ${key} is unavailable in this ROM/project.` });
        else resources[key] = encodeTiles(image);
      }
      if ((e.kind === "text" || e.kind === "button" || e.kind === "list") && !assets.glyph(e.font, "M")) diagnostics.push({ severity: "error", code: "missing-font", screen: screen.id, element: e.id, message: `Native font ${e.font} is unavailable.` });
      if (e.kind === "pokemon" && (e.width !== 32 || e.height !== 32)) diagnostics.push({ severity: "error", code: "icon-size", screen: screen.id, element: e.id, message: "Native Pokémon icons require a 32×32 sprite." });
      if (e.kind === "pokemon" && e.pokemon.kind === "fixed") for (let pose = 0; pose < 2; pose++) {
        const image = assets.icon(e.pokemon.species, e.pokemon.form, pose), key = `icon:${e.pokemon.species}:${e.pokemon.form}:${pose}`;
        if (!image) diagnostics.push({ severity: "error", code: "missing-icon", screen: screen.id, element: e.id, message: "This species/form has no supported native icon." });
        else resources[key] = encodeTiles(image);
      }
    }
    const background = {} as Record<PhysicalScreen, Tiles>, budgets = {} as Record<PhysicalScreen, Budget>;
    for (const physical of ["top", "bottom"] as const) {
      const art = blank(256, 192); fill(art, { x: 0, y: 0, width: 256, height: 192 }, screen.background[physical]);
      // Flatten only the static prefix; later static elements retain their drawing order.
      for (const e of screen.elements.filter(e => e.screen === physical && !e.hidden)) {
        if ((e.kind !== "panel" && e.kind !== "image") || e.meter) break;
        if (e.kind === "panel" && !e.transparentFill) panel(art, e, e.paint);
        const key = resourceKey(e); if (key && resources[key]) blit(art, decodeTiles(resources[key]), e);
      }
      background[physical] = encodeTiles(art);
      const elements = screen.elements.filter(e => e.screen === physical && !e.hidden), sprites = elements.filter(e => e.kind === "pokemon").length;
      const windowBytes = elements.filter(e => ["text", "button", "list"].includes(e.kind)).reduce((n, e) => n + Math.ceil(e.width / 8) * Math.ceil(e.height / 8) * 32, 0);
      const tiles = background[physical].tiles.length / 64;
      const frameUpload = sprites * 512 + Math.min(windowBytes, 49152);
      const backgroundBytes = background[physical].tiles.length + 2048;
      const videoMemory = backgroundBytes + windowBytes + 2048 + sprites * 1024;
      budgets[physical] = { palette: background[physical].palette.length, tiles, sprites, videoMemory, heap: 49152 + windowBytes + sprites * 2048 + 8192, initialUpload: videoMemory, frameUpload };
      if (backgroundBytes + windowBytes + 2048 > LIMITS.backgroundVram || sprites * 1024 > LIMITS.spriteVram || sprites > LIMITS.sprites) diagnostics.push({ severity: "error", code: "vram-budget", screen: screen.id, message: `${physical} screen exceeds the reserved graphics memory budget.` });
      if (frameUpload > LIMITS.upload) diagnostics.push({ severity: "warning", code: "upload-budget", screen: screen.id, message: `${physical} screen needs ${frameUpload} bytes for a full dynamic refresh; split uploads across display updates before revealing changes.` });
    }
    if (budgets.top.heap + budgets.bottom.heap > LIMITS.heap) diagnostics.push({ severity: "error", code: "heap-budget", screen: screen.id, message: "Screen exceeds the 256 KiB runtime allocation budget." });
    result.screens.push({ id: screen.id, background, elements: structuredClone(screen.elements), resources, budgets });
  }
  result.valid = !diagnostics.some(d => d.severity === "error"); return result;
}
const decodedResources = new WeakMap<Tiles, Image>();
function decodeResource(resource: Tiles): Image { let image = decodedResources.get(resource); if (!image) { image = decodeTiles(resource); decodedResources.set(resource, image); } return image; }
export function preview(compilation: Compilation, assets: Assets, data: GameData, session: Interaction): Preview {
  const state = session.stack.at(-1)!, compiled = compilation.screens.find(s => s.id === state.screen), source = compilation.document.screens.find(s => s.id === state.screen);
  const diagnostics = [...compilation.diagnostics], top = blank(256, 192), bottom = blank(256, 192);
  if (!compiled || !source) return { top, bottom, diagnostics };
  for (const physical of ["top", "bottom"] as const) {
    const target = physical === "top" ? top : bottom; target.pixels.set(decodeResource(compiled.background[physical]).pixels);
    let nativePainted = false;
    for (const original of compiled.elements.filter(e => e.screen === physical && !e.hidden)) {
      const nativeRegion = compiled.nativeSummary?.regions[original.id];
      if (nativeRegion) { drawSummaryRegion(target, nativeRegion, compiled.nativeSummary!, key => compiled.resources[key] && decodeResource(compiled.resources[key]), assets, data, session, diagnostics, source.id); continue; }
      if (physical === "bottom" && compiled.nativeLearnset && original.id.startsWith(`${compiled.nativeLearnset.element}_`)) {
        if (!nativePainted) { const nativeArt = resourceKey(original); if (nativeArt && compiled.resources[nativeArt]) blit(target, decodeTiles(compiled.resources[nativeArt]), original); drawNativeLearnsetMoves(target, compiled.nativeLearnset, key => compiled.resources[key] && decodeTiles(compiled.resources[key]), assets, data, session, diagnostics, source.id); nativePainted = true; }
        continue;
      }
      const disabled = original.disabled || original.kind === "button" && !actionAvailable(original.action, data, state);
      const appearance = disabled ? "disabled" : session.pressed === original.id ? "pressed" : state.focus === original.id ? "focused" : undefined;
      const e = { ...original, paint: { ...original.paint, ...(appearance ? original.states[appearance] : {}) } };
      if (["panel", "button", "list"].includes(e.kind) && !e.transparentFill) panel(target, e.meter ? { ...e, width: Math.max(0, Math.min(e.width, Math.round(e.width * Number(resolveText({ binding: e.meter.binding }, data, state)) / e.meter.maximum))) } : e, e.paint);
      const key = resourceKey(e); if (key && compiled.resources[key]) blit(target, decodeTiles(compiled.resources[key]), e);
      if (e.image?.kind === "typeBinding") { const value = resolveText({ binding: e.image.binding }, data, state), image = value ? assets.image(`type-name:${value}`) : undefined; if (image) blit(target, decodeTiles(encodeTiles(image)), e); }
      if ((e.kind === "text" || e.kind === "button") && (e.moveIndex === undefined || !selectedPokemon(data, state)?.egg && !!selectedPokemon(data, state)?.moves[e.moveIndex])) text(target, e, resolveText(e.text, data, state, e.moveIndex === undefined ? undefined : { move: selectedPokemon(data, state)?.moves[e.moveIndex] }), assets, diagnostics, source.id);
      if (e.kind === "pokemon") {
        const p = e.pokemon.kind === "fixed" ? e.pokemon : e.pokemon.kind === "family" ? viewInfo(data, state)?.family[e.pokemon.index] : data.party[e.pokemon.slot === "selected" ? state.selectedParty : e.pokemon.slot];
        if (p) {
          const identity = state.view ?? selectedPokemon(data, state);
          const familyCount = viewInfo(data, state)?.family.length ?? 0;
          if (e.pokemon.kind === "family") {
            e.x += (3 - familyCount) * 24;
            if (p.species === identity?.species && p.form === identity.form && e.paint.borderWidth) {
              const box = { x: e.x - 2, y: e.y - 2, width: 36, height: 36 };
              fill(target, { ...box, height: 1 }, e.paint.border); fill(target, { ...box, y: box.y + box.height - 1, height: 1 }, e.paint.border);
              fill(target, { ...box, width: 1 }, e.paint.border); fill(target, { ...box, x: box.x + box.width - 1, width: 1 }, e.paint.border);
            }
          }
          const pose = e.animate && (e.pokemon.kind !== "family" || p.species === identity?.species && p.form === identity.form) ? Math.floor(session.frame / 8) % 2 : 0, key = `icon:${p.species}:${p.form}:${pose}`;
          const image = compiled.resources[key] ? decodeTiles(compiled.resources[key]) : assets.icon(p.species, p.form, pose, "egg" in p && !!p.egg);
          if (image) blit(target, decodeTiles(encodeTiles(image)), e);
          else diagnostics.push({ severity: "warning", code: "missing-icon", screen: source.id, element: e.id, message: "The preview Pokémon has no icon in the loaded ROM." });
        }
      }
      if (e.kind === "list") drawList(target, e, data, state, assets, diagnostics, source);
    }
  }
  return { top, bottom, diagnostics };
}
function drawList(target: Image, e: Element, data: GameData, state: FrameState, assets: Assets, diagnostics: Diagnostic[], screen: Screen) {
  const list = state.lists[e.id] ?? { index: 0, scroll: 0 }, p = selectedPokemon(data, state);
  const items = e.list.source === "party" ? data.party : listMoves(e.list.source, data, state), height = Math.floor(e.height / e.list.rows);
  for (let row = 0; row < e.list.rows; row++) {
    const index = list.scroll + row; if (index >= items.length) break;
    const cell = { ...e, x: e.x + 2, y: e.y + row * height, width: e.width - 4, height, paint: { ...e.paint, ...(index === list.index ? e.states.focused : {}) } };
    if (index === list.index) {
      if (!e.transparentFill) fill(target, cell, cell.paint.fill);
      else { fill(target, { ...cell, height: 1 }, cell.paint.border); fill(target, { ...cell, y: cell.y + cell.height - 1, height: 1 }, cell.paint.border); }
    }
    const context = e.list.source === "party" ? { pokemon: data.party[index] } : { move: listMoves(e.list.source as "moves" | "learnset", data, state)[index] };
    if (e.list.columns?.length) for (const column of e.list.columns) {
      const value = resolveText(column.text, data, state, context);
      if (column.kind === "typeIcon") { const image = assets.image(`type-name:${value}`); if (image) blit(target, image, { x: e.x + column.x, y: cell.y, width: 32, height: 16 }); }
      else text(target, { ...cell, x: e.x + column.x, width: column.width, align: column.align }, value, assets, diagnostics, screen.id);
    }
    else text(target, cell, resolveText(e.list.label, data, state, context), assets, diagnostics, screen.id);
  }
}
