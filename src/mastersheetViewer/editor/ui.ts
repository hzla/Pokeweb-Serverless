/** Markup helpers shared by the editor's toolbar, pickers, menus and panel, in the viewer's Gen 5 style. */

export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

/** The diagonal hatching at the end of Gen 5 title bars and bands. */
export function hatch(): string {
  return `<svg class="msv-hatch" viewBox="0 0 40 16" aria-hidden="true" focusable="false"><path d="M0 16 6 0h4L4 16ZM10 16 16 0h4l-6 16ZM20 16 26 0h4l-6 16ZM30 16 36 0h4l-6 16Z"/></svg>`;
}

export function titlebar(title: string, tone: "run" | "fight" | "bag" | "mon" = "run"): string {
  return `<header class="msv-titlebar -${tone}"><h2>${esc(title)}</h2>${hatch()}</header>`;
}

export function band(label: string, tone = "", extra = ""): string {
  return `<h3 class="msv-band${tone ? ` -${tone}` : ""}"><span>${esc(label)}</span>${extra}${hatch()}</h3>`;
}

export function button(label: string, action: string, tone: "nav" | "fight" | "tab" = "nav", extra = ""): string {
  return `<button type="button" class="msv-hex -${tone}" data-action="${esc(action)}"${extra}><span>${esc(label)}</span></button>`;
}

/** An image from the ROM, filled in by the viewer once drawn. */
export function image(key: string, className = ""): string {
  return `<span class="msv-asset ${className}"><img data-asset="${esc(key)}" alt="" decoding="async"></span>`;
}

/** Pixel art from rows of characters, drawn as crisp SVG (grips, arrows, ticks). */
export function pixels(rows: string[], colors: Record<string, string>, scale = 2): string {
  const height = rows.length, width = rows[0]!.length;
  let rects = "";
  rows.forEach((row, y) => [...row].forEach((code, x) => {
    if (colors[code]) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${colors[code]}"/>`;
  }));
  return `<svg width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${rects}</svg>`;
}

export const GRIP = pixels(["k..k", "....", "k..k", "....", "k..k"], { k: "currentColor" }, 3);
export const ARROW_UP = pixels(["...k...", "..kkk..", ".kkkkk.", "kkkkkkk"], { k: "currentColor" }, 2);
export const ARROW_DOWN = pixels(["kkkkkkk", ".kkkkk.", "..kkk..", "...k..."], { k: "currentColor" }, 2);
export const CARET = pixels(["kkkkkkk", ".kkkkk.", "..kkk..", "...k..."], { k: "currentColor" }, 2);
export const WARNING = pixels(["...k...", "..kyk..", "..kyk..", ".kyyyk.", ".kykyk.", "kyyyyyk", "kyykyyk", "kkkkkkk"], { k: "#181818", y: "#f8c828" }, 2);
