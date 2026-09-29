import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { readU16, writeU16 } from "../nds/binary";
import { getRomFileBytes } from "../pokeweb/fileSystemModel";
import { parseNitroBackground, renderNitroBackgroundImage } from "../pokeweb/nitroBg";
import type { ProjectState } from "../pokeweb/projectStore";
import { encodePng, expand555, type Image } from "./assets";
import { newProject, newElement, type Binding, type Element, type PhysicalScreen, type Project, type TextSource } from "./document";

/** Resolve native regions into preview artwork and interaction controls. */
export function learnsetTemplate(project: ProjectState, rom: NintendoDSRom): Project {
  const id = rom.filenames.idOf("a/1/2/5"); if (id === undefined) throw new Error("The native tutor graphics archive is missing.");
  const files = new NARC(getRomFileBytes(project, rom, id)).files;
  const decode = (member: number, raw = files[member]) => { const bg = parseNitroBackground(member, raw, files[1], files[0]); return { width: 256, height: 192, pixels: renderNitroBackgroundImage(bg).slice(0, 256 * 192 * 4) }; };
  const nativeTop = decode(4), top: Image = { width: 256, height: 192, pixels: new Uint8ClampedArray(256 * 192 * 4) };
  const nativePalette = (n: number) => [...expand555(readU16(files[0], 40 + n * 2)), 255];
  const rgb = (r: number, g: number, b: number) => [...expand555((r >> 3) | (g >> 3) << 5 | (b >> 3) << 10), 255];
  const colors = [rgb(48, 50, 65), [...expand555(0x24e7), 255], nativePalette(19), [...expand555(0x0c63), 255], [...expand555(0x2929), 255], [...expand555(0x316b), 255], [...expand555(0x5f09), 255], rgb(142, 235, 219), rgb(180, 184, 192), nativePalette(17), rgb(238, 175, 62), rgb(255, 219, 149), rgb(120, 72, 160), nativePalette(17)];
  function rect(x: number, y: number, w: number, h: number, c: number[]) { for (let py = Math.max(0, y); py < Math.min(192, y + h); py++) for (let px = Math.max(0, x); px < Math.min(256, x + w); px++) top.pixels.set(c, (py * 256 + px) * 4); }
  rect(0, 0, 256, 192, colors[1]);
  for (let y = 0; y < 40; y++) rect(0, y, 256, 1, [...nativeTop.pixels.subarray(y * 256 * 4, y * 256 * 4 + 4)]);
  for (let y = 40; y <= 131; y++) {
    rect(0, y, y < 52 ? 100 + y - 40 : 112, 1, colors[9]);
    const cut = y < 44 ? 44 - y : y > 127 ? y - 127 : 0, left = 112 + cut, right = 255 - cut;
    rect(left, y, right - left + 1, 1, colors[y === 40 || y === 131 ? 4 : 13]); rect(left, y, 1, 1, colors[4]); rect(right, y, 1, 1, colors[4]);
    if (y > 40 && y < 131) { rect(left + 1, y, 3, 1, nativePalette(21)); rect(left + 4, y, 1, 1, nativePalette(19)); if (y === 100 || y === 116) rect(left + 4, y, right - left - 4, 1, nativePalette(19)); }
  }
  rect(0, 132, 256, 4, colors[1]); rect(0, 140, 256, 52, colors[5]); rect(0, 136, 25, 1, colors[3]);
  for (let d = 1; d <= 3; d++) { rect(0, 136 + d, 25 + d, 1, colors[3]); rect(16 + d, 136 + d, 1, 1, colors[7]); rect(20 + d, 136 + d, 1, 1, colors[7]); } rect(27, 139, 229, 1, colors[3]);
  const lowerMap = files[2].slice(); for (let y = 8; y < 21; y++) { const row = 36 + y * 64; writeU16(lowerMap, row + 44, readU16(lowerMap, row + 38)); writeU16(lowerMap, row + 42, readU16(lowerMap, row + 36)); for (let x = 18; x <= 20; x++) writeU16(lowerMap, row + x * 2, readU16(lowerMap, row + 34)); }
  const design = newProject(); design.document.name = "Learnset viewer"; const screen = design.document.screens[0]; screen.id = "learnset"; screen.name = "Learnset viewer"; screen.elements = []; design.document.launchers = { party: screen.id };
  screen.shortcuts = { a: { type: "nextEvolution" }, left: { type: "cycleParty", delta: -1 }, right: { type: "cycleParty", delta: 1 }, l: { type: "family", delta: -1 }, r: { type: "family", delta: 1 } };
  function component(kind: Element["kind"], id: string, x: number, y: number, width: number, height: number, physical: PhysicalScreen = "top") {
    const e = newElement(kind, id, physical); Object.assign(e, { name: id.replace(/-/g, " "), x, y, width, height }); e.paint.borderWidth = 0; screen.elements.push(e); return e;
  }
  for (const physical of ["top", "bottom"] as const) {
    const name = `learnset-${physical}`, path = `assets/${name}.png`, image = physical === "top" ? top : decode(2, lowerMap);
    design.document.assets.push({ id: name, name: `Native ${physical} artwork`, path, width: 256, height: 192 }); design.files[path] = encodePng(image);
    component("image", `${physical}-art`, 0, 0, 256, 192, physical).image = { kind: "import", id: name };
  }
  const fontId = rom.filenames.idOf("a/0/2/3");
  if (fontId === undefined) throw new Error("The native font archive is missing.");
  const fontPalette = new NARC(getRomFileBytes(project, rom, fontId)).files[5];
  const fontColor = (index: number) => `#${expand555(readU16(fontPalette, 40 + index * 2)).map(n => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
  const text = (id: string, source: TextSource, x: number, y: number, width: number, height = 15, physical: PhysicalScreen = "top", dark = false) => {
    const e = component("text", id, x, y, width, height, physical); e.text = source; e.paint.foreground = fontColor(dark ? 1 : 15); e.paint.shadow = fontColor(2); return e;
  };
  text("species-name", { binding: "view.name", transform: "upper" }, 8, 4, 152);
  text("party-position", { binding: "party.position" }, 208, 4, 40).align = "right";
  component("image", "type-primary", 136, 0, 32, 16).image = { kind: "typeBinding", binding: "view.type1" };
  component("image", "type-secondary", 172, 0, 32, 16).image = { kind: "typeBinding", binding: "view.type2" };
  for (const [i, label] of ["HP", "Atk", "Def", "Sp.A", "Sp.D", "Spe"].entries()) {
    const binding = ["view.hp", "view.attack", "view.defense", "view.spAttack", "view.spDefense", "view.speed"][i] as Binding, y = 41 + i * 15;
    text(`stat-label-${i}`, { literal: label }, 6, y, 26, 15, "top", true);
    text(`stat-value-${i}`, { binding }, 30, y, 22, 15, "top", true).align = "right";
    component("panel", `stat-track-${i}`, 57, y + 4, 46, 8).paint.fill = "#b4b8c0";
    const bar = component("panel", `stat-fill-${i}`, 57, y + 4, 46, 8); bar.paint.fill = "#eeaf3e"; bar.meter = { binding, maximum: 255 };
    const light = component("panel", `stat-highlight-${i}`, 57, y + 4, 46, 2); light.paint.fill = "#ffdb95"; light.meter = { binding, maximum: 255 };
  }
  for (let i = 0; i < 3; i++) { const e = component("pokemon", `family-${i}`, 120 + 48 * i, 48, 32, 32); e.pokemon = { kind: "family", index: i }; e.paint.border = "#207878"; e.paint.borderWidth = 1; }
  for (let i = 0; i < 3; i++) { const e = text(`ability-${i}`, { binding: `view.ability${i + 1}` as Binding, transform: "title" }, 120, 84 + i * 16, 132, 15, "top", true); if (i === 2) e.paint.foreground = "#7848a0"; }
  text("evolution-heading", { binding: "view.evolutionTitle" }, 8, 140, 192);
  text("evolution-page", { binding: "view.evolutionPage" }, 200, 140, 48).align = "right";
  text("evolution-requirement", { binding: "view.evolutionText" }, 8, 156, 240, 32).wrap = true;
  // Hit regions only: nativeLearnsetPreview paints the native actors/windows.
  const list = component("list", "learnset-list", 20, 70, 216, 96, "bottom");
  list.transparentFill = true; list.list = { source: "learnset", rows: 4, label: { binding: "move.name" } };
  list.neighbors.down = "close";
  for (const [id, x, delta] of [["scroll-down", 8, 1], ["scroll-up", 40, -1]] as const) {
    const e = component("button", id, x, 168, 32, 24, "bottom");
    e.transparentFill = true; e.text = { literal: "" }; e.action = { type: "selectList", list: list.id, delta };
    e.neighbors.up = list.id;
  }
  const close = component("button", "close", 224, 168, 32, 24, "bottom");
  close.transparentFill = true; close.text = { literal: "" }; close.action = { type: "close" }; close.neighbors.up = list.id;
  return design;
}
