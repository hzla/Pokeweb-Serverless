import type { Assets, Image, NativeLearnsetArt } from "./assets";
import { newElement, type Diagnostic, type GameData, type Rect } from "./document";
import { listMoves, type Interaction } from "./interaction";
import { blit, text } from "./raster";

export type CompiledLearnsetPreview = Pick<NativeLearnsetArt, "palette" | "typeNames" | "cursor"> & {
  element: string;
  list: string;
  sprites: Record<string, { key: string; x: number; y: number }>;
};

/** Same 106-pixel level/name label and ellipsis rule as LearnsetDrawLine. */
export function learnsetMoveLabel(level: number, name: string, assets: Assets): string {
  const prefix = `${level} - `;
  const measure = (s: string) => [...s].reduce((n, c) => n + (assets.glyph(0, c)?.advance ?? 8), 0);
  let value = prefix + name;
  if (measure(value) <= 106) return value;
  while (value.length > prefix.length && measure(`${value}...`) > 106) value = value.slice(0, -1);
  return `${value}...`;
}

/** Overlay 258's native windows and actors, with the learnset patch's wider name column. */
export function drawNativeLearnsetMoves(
  target: Image, native: CompiledLearnsetPreview, resource: (key: string) => Image | undefined,
  assets: Assets, data: GameData, session: Interaction, diagnostics: Diagnostic[], screen: string,
): void {
  const state = session.stack.at(-1)!, moves = listMoves("learnset", data, state);
  const list = state.lists[native.list] ?? { index: 0, scroll: 0 }, selected = moves[list.index];
  function sprite(name: string, x: number, y: number) {
    const s = native.sprites[name], image = s && resource(s.key);
    if (image) blit(target, image, { x: x + s.x, y: y + s.y, width: image.width, height: image.height });
  }
  function label(value: string, rect: Rect, white = false, align: "left" | "right" = "left", wrap = false) {
    const e = newElement("text", native.element, "bottom");
    Object.assign(e, rect, { align, wrap });
    // Native 0x440 / 0x3c40 text colors: foreground 1 / 15, authored shadow 2.
    e.paint.foreground = native.palette[white ? 15 : 1]; e.paint.shadow = native.palette[2];
    text(target, e, value, assets, diagnostics, screen, 16);
  }
  label("POWER", { x: 64, y: 48, width: 48, height: 16 });
  label("ACCURACY", { x: 152, y: 48, width: 64, height: 16 });
  if (selected) {
    label(selected.description, { x: 8, y: 0, width: 240, height: 48 }, false, "left", true);
    label(selected.power <= 1 ? "---" : String(selected.power), { x: 112, y: 48, width: 24, height: 16 }, false, "right");
    label(selected.accuracy <= 0 || selected.accuracy > 100 ? "---" : String(selected.accuracy), { x: 216, y: 48, width: 24, height: 16 }, false, "right");
    const category = ["status", "physical", "special"].indexOf(selected.category.toLowerCase());
    if (category >= 0) sprite(`category-${category}`, 33, 56);
    else diagnostics.push({ severity: "warning", code: "move-category", screen, element: native.element, message: `Unknown move category: ${selected.category}.` });
  }
  for (let row = 0; row < 4; row++) {
    const move = moves[list.scroll + row]; if (!move) break;
    const y = 72 + row * 24;
    const type = native.typeNames.findIndex(n => n.toLowerCase() === move.type.toLowerCase());
    if (type >= 0 && native.sprites[`type-${type}`]) sprite(`type-${type}`, 47, y + 8);
    else diagnostics.push({ severity: "warning", code: "move-type", screen, element: native.element, message: `The native tutor has no icon for type ${move.type}.` });
    label(learnsetMoveLabel(move.level ?? 0, move.name, assets), { x: 66, y, width: 106, height: 16 }, true);
    label(`PP ${move.pp}`, { x: 184, y, width: 48, height: 16 });
  }
  const row = list.index - list.scroll;
  if (selected && row >= 0 && row < 4 && state.focus !== `${native.element}_close`) {
    const total = native.cursor.reduce((n, f) => n + f.duration, 0);
    let frame = session.frame % Math.max(1, total);
    for (const f of native.cursor) { if (frame < f.duration) { sprite(f.sprite, 130, 84 + row * 24); break; } frame -= f.duration; }
  }
  sprite("down", 8, 168); sprite("up", 40, 168); sprite("back", 224, 168);
}
