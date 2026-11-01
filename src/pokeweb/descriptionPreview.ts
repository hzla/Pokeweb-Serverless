import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { parseNitroBackground, parseNitroPalette, type NitroPaletteData } from "./nitroBg";
import { layoutBw2Dialogue, parseBw2DialogueFont, type DialogueFont } from "./bw2DialoguePreview";
import type { ProjectState } from "./projectStore";

export type DescriptionKind = "move" | "ability";
export type DescriptionAssets = { font: DialogueFont; ink: NitroPaletteData; lightInk: NitroPaletteData; move: Uint8ClampedArray; ability: Uint8ClampedArray };
export const DESCRIPTION_BOXES = {
  move: { width: 256, height: 48, x: 8, y: 0, lineWidth: 240, rows: 3 },
  ability: { width: 176, height: 48, x: 8, y: 16, lineWidth: 160, rows: 2 },
} as const;

/** Decode only the static Summary panels and normal game font; no ROM artwork is shipped. */
export function decodeDescriptionAssets(font: readonly Uint8Array[], summary: readonly Uint8Array[], bw1 = false): DescriptionAssets {
  const characters = bw1 ? 10 : 12, abilityScreen = bw1 ? 73 : 75, moveScreen = bw1 ? 74 : 76;
  if (!font[0] || !font[6] || !font[7] || !summary[characters] || !summary[abilityScreen] || !summary[moveScreen] || !summary[0]) throw Error("The ROM is missing its Summary description resources.");
  const crop = (screen: number, left: number, top: number, width: number, height: number) => {
    const image = parseNitroBackground(0, summary[screen], summary[characters], summary[0]);
    if (image.warnings.length || left + width > image.width || top + height > image.height) throw Error("Unsupported Summary description graphics.");
    const output = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) output.set(image.rgba.subarray(((top + y) * image.width + left) * 4, ((top + y) * image.width + left + width) * 4), y * width * 4);
    return output;
  };
  return { font: parseBw2DialogueFont(font[0]), ink: parseNitroPalette(font[6]), lightInk: parseNitroPalette(font[7]), move: crop(moveScreen, 0, 104, 256, 48), ability: crop(abilityScreen, 40, 144, 176, 48) };
}
type Cached = { fontId: number; summaryId: number; fontEdit?: Uint8Array; summaryEdit?: Uint8Array; assets: DescriptionAssets };
const cache = new WeakMap<ProjectState, Cached>(), pending = new WeakMap<ProjectState, Promise<DescriptionAssets>>();
export async function loadDescriptionAssets(project: ProjectState): Promise<DescriptionAssets> {
  const cached = cache.get(project);
  if (cached && cached.fontEdit === project.fileSystem?.replacements[cached.fontId] && cached.summaryEdit === project.fileSystem?.replacements[cached.summaryId]) return cached.assets;
  if (pending.has(project)) return pending.get(project)!;
  const loading = (async () => {
    if (!["BW", "BW2"].includes(project.session.baseRom)) throw Error("Description previews support Black/White and Black 2/White 2.");
    const { activeRomMatchesProject, loadActiveRomBytes } = await import("./persistence");
    if (!project.originalRomBytes && !await activeRomMatchesProject(project)) throw Error("Reconnect this project's source ROM to preview its game font.");
    const bytes = project.originalRomBytes ?? await loadActiveRomBytes();
    if (!bytes) throw Error("Source ROM is unavailable.");
    const rom = new NintendoDSRom(bytes, { fileData: "view" });
    if (rom.idCode !== project.romInfo.idCode || bytes.length !== project.romInfo.size) throw Error("Preview resources do not match this project.");
    const bw1 = project.session.baseRom === "BW", fontId = rom.fileId("a/0/2/3"), summaryId = rom.fileId(bw1 ? "a/0/7/8" : "a/0/7/7");
    const fontEdit = project.fileSystem?.replacements[fontId], summaryEdit = project.fileSystem?.replacements[summaryId];
    const font = new NARC((fontEdit ?? rom.files[fontId]).slice()), summary = new NARC((summaryEdit ?? rom.files[summaryId]).slice());
    const assets = decodeDescriptionAssets(font.files, summary.files, bw1);
    cache.set(project, { fontId, summaryId, fontEdit, summaryEdit, assets });
    return assets;
  })();
  pending.set(project, loading);
  try { return await loading; } finally { pending.delete(project); }
}

export function renderDescriptionPreview(assets: DescriptionAssets, kind: DescriptionKind, text: string, name = "") {
  const box = DESCRIPTION_BOXES[kind], rgba = assets[kind].slice();
  const layout = layoutBw2Dialogue(text, assets.font);
  const warnings = layout.warnings.filter(w => !w.includes("exceeds 232px") && !w.includes("below the two-line dialogue box"));
  if (layout.pages.length > 1) warnings.push("Descriptions have one text box; only the first page is shown.");
  const page = layout.pages[0];
  page.widths.forEach((width, row) => {
    if (width > box.lineWidth) warnings.push(`Line ${row + 1}: ${width}px exceeds ${box.lineWidth}px by ${width - box.lineWidth}px.`);
    if (row >= box.rows && width) warnings.push(`Line ${row + 1} is outside the ${box.rows}-line description box.`);
  });
  const draw = (code: number, dx: number, dy: number, palette: NitroPaletteData, left: number, top: number, right: number, bottom: number) => {
    const glyph = assets.font.glyphs.get(code) ?? assets.font.fallback;
    for (let y = 0; y < assets.font.height; y++) for (let x = 0; x < glyph.width; x++) {
      const v = glyph.pixels[y * assets.font.width + x], xx = dx + glyph.left + x, yy = dy + y;
      if (v && xx >= left && xx < right && yy >= top && yy < bottom) rgba.set(palette[v], (yy * box.width + xx) * 4);
    }
  };
  if (kind === "ability") {
    for (const [label, start, right, palette] of [["Ability", 8, 64, assets.lightInk], [name, 72, 168, assets.ink]] as const) {
      let x = start as number;
      for (const char of label) { draw(char.charCodeAt(0), x, 0, palette, start, 0, right, 16); x += (assets.font.glyphs.get(char.charCodeAt(0)) ?? assets.font.fallback).advance; }
    }
  }
  for (const glyph of page.glyphs) draw(glyph.code, box.x + glyph.x, box.y + glyph.y, assets.ink, box.x, box.y, box.x + box.lineWidth, box.height);
  return { rgba, width: box.width, height: box.height, warnings: [...new Set(warnings)], widths: page.widths };
}
