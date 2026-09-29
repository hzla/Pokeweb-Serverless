import { type Assets, type Image, rgb555, expand555 } from "./assets";
import type { Diagnostic, Element, Rect } from "./document";

export function blank(width: number, height: number): Image { return { width, height, pixels: new Uint8ClampedArray(width * height * 4) }; }
export function fill(image: Image, rect: Rect, color: string) {
  const rgb = expand555(rgb555(color));
  for (let y = Math.max(0, rect.y); y < Math.min(image.height, rect.y + rect.height); y++) for (let x = Math.max(0, rect.x); x < Math.min(image.width, rect.x + rect.width); x++) image.pixels.set([...rgb, 255], (y * image.width + x) * 4);
}
export function blit(target: Image, source: Image, rect: Rect) {
  for (let y = Math.max(0, rect.y); y < Math.min(target.height, rect.y + rect.height); y++) for (let x = Math.max(0, rect.x); x < Math.min(target.width, rect.x + rect.width); x++) {
    const sx = Math.floor((x - rect.x) * source.width / rect.width), sy = Math.floor((y - rect.y) * source.height / rect.height), s = (sy * source.width + sx) * 4;
    if (source.pixels[s + 3] >= 128) target.pixels.set([...expand555((source.pixels[s] >> 3) | ((source.pixels[s + 1] >> 3) << 5) | ((source.pixels[s + 2] >> 3) << 10)), 255], (y * target.width + x) * 4);
  }
}
export function panel(target: Image, e: Rect, paint: Element["paint"]) {
  fill(target, e, paint.border); const b = paint.borderWidth;
  fill(target, { x: e.x + b, y: e.y + b, width: Math.max(0, e.width - 2 * b), height: Math.max(0, e.height - 2 * b) }, paint.fill);
}
export function text(target: Image, e: Element, value: string, assets: Assets, diagnostics: Diagnostic[], screen: string, spacing?: number) {
  const fg = expand555(rgb555(e.paint.foreground)), shadow = expand555(rgb555(e.paint.shadow));
  const lines: string[] = []; let line = "", width = 0, missing = false; const lineHeight = spacing ?? assets.glyph(e.font, "M")?.height ?? 16;
  for (const char of value) {
    if (char === "\n") { lines.push(line); line = ""; width = 0; continue; }
    const glyph = assets.glyph(e.font, char); if (!glyph) missing = true;
    const advance = glyph?.advance ?? 8;
    if (e.wrap && width + advance > e.width && line) { lines.push(line); line = ""; width = 0; }
    line += char; width += advance;
  }
  lines.push(line); let clipped = lines.length * lineHeight > e.height;
  for (let i = 0; i < lines.length; i++) {
    const glyphs = [...lines[i]].map(c => assets.glyph(e.font, c)), length = glyphs.reduce((n, g) => n + (g?.advance ?? 8), 0);
    if (length > e.width) clipped = true;
    let cursor = e.x + (e.align === "right" ? e.width - length : e.align === "center" ? Math.floor((e.width - length) / 2) : 0);
    for (const glyph of glyphs) {
      if (glyph) for (let y = 0; y < glyph.height; y++) for (let x = 0; x < glyph.width; x++) {
        const level = glyph.pixels[y * glyph.width + x], px = cursor + x, py = e.y + i * lineHeight + y;
        if (level && px >= e.x && py >= e.y && px < e.x + e.width && py < e.y + e.height && px >= 0 && px < target.width && py >= 0 && py < target.height) target.pixels.set([...(level === 1 ? fg : shadow), 255], (py * target.width + px) * 4);
      }
      cursor += glyph?.advance ?? 8;
    }
  }
  if (clipped) diagnostics.push({ severity: "warning", code: "clipped-text", screen, element: e.id, message: "Text is clipped by this element's bounds." });
  if (missing) diagnostics.push({ severity: "error", code: "missing-glyph", screen, element: e.id, message: "The selected native font does not contain one or more characters." });
}
