import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { addRomFile, getRomFileBytes, setRomFileReplacement } from "./fileSystemModel";
import { getPokemonPalettes, resolvePokemonSpriteId, type RgbColor } from "./pokemonSpriteModel";
import { pwanPalette } from "./pwanCompiler";
import type { ProjectState, PwanAnimationOverride } from "./projectStore";
import { applyPaletteDelta, decodeNaturePalettes, encodeNaturePalettes, NATURE_PALETTE_PATH, naturePaletteKey, naturePaletteTarget, paletteDelta, rgbFrom555, type NaturePaletteRecord, type NaturePaletteSource, type NaturePaletteTarget } from "./naturePaletteData";

const sources = new WeakMap<ProjectState, { id?: number; bytes?: Uint8Array; revision: number }>();
const romCache = new WeakMap<Uint8Array, NintendoDSRom>();
export function hydrateNaturePalettes(project: ProjectState, rom: NintendoDSRom): void {
  const id = rom.filenames.idOf(NATURE_PALETTE_PATH);
  sources.set(project, { id, bytes: id === undefined ? undefined : rom.files[id].slice(), revision: rom.data[0x1e] });
}
export function naturePaletteFile(project: ProjectState): Uint8Array | undefined {
  const additions = project.fileSystem?.additions ?? {};
  const path = Object.keys(additions).find(p => p.toLowerCase() === NATURE_PALETTE_PATH);
  if (path) return additions[path];
  const source = sources.get(project);
  if (source?.id !== undefined) return project.fileSystem?.replacements?.[source.id] ?? source.bytes;
  if (!project.originalRomBytes) return undefined;
  let rom = romCache.get(project.originalRomBytes);
  if (!rom) { rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" }); romCache.set(project.originalRomBytes, rom); }
  const id = rom.filenames.idOf(NATURE_PALETTE_PATH);
  return id === undefined ? undefined : getRomFileBytes(project, rom, id);
}
function writeTable(project: ProjectState, records: NaturePaletteRecord[]): void {
  const bytes = encodeNaturePalettes(records);
  let id = sources.get(project)?.id;
  if (id === undefined && project.originalRomBytes) {
    let rom = romCache.get(project.originalRomBytes);
    if (!rom) { rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" }); romCache.set(project.originalRomBytes, rom); }
    id = rom.filenames.idOf(NATURE_PALETTE_PATH);
  }
  if (id === undefined) addRomFile(project, NATURE_PALETTE_PATH, bytes);
  else {
    const duplicate = Object.keys(project.fileSystem?.additions ?? {}).find(p => p.toLowerCase() === NATURE_PALETTE_PATH);
    if (duplicate) delete project.fileSystem!.additions![duplicate];
    setRomFileReplacement(project, id, bytes);
  }
}
export function naturePalettesSupported(project: ProjectState): boolean {
  return project.session.baseRom === "BW2" && ((project.session.baseVersion === "W2" && project.romInfo?.idCode === "IRDO") || (project.session.baseVersion === "B2" && project.romInfo?.idCode === "IREO"))
    && (project.originalRomBytes?.[0x1e] ?? sources.get(project)?.revision ?? -1) === 0
    && (project.narcs.personal?.fileCount ?? 0) <= 1024 && !project.w2animAnimations;
}
export function getNaturePaletteRecords(project: ProjectState): NaturePaletteRecord[] {
  const file = naturePaletteFile(project);
  return file ? decodeNaturePalettes(file) : [];
}
export function naturePaletteBase(project: ProjectState, spriteId: number, source: NaturePaletteSource, shiny: boolean): RgbColor[] {
  if (source === "native") return getPokemonPalettes(project, spriteId)[shiny ? "shiny" : "normal"];
  const side = source === "pwan-front" ? "front" : "back";
  // Runtime keys use the native sprite form, rather than PWAN's separate asset index.
  const override = project.pwanAnimations?.overrides.find(o => resolvePokemonSpriteId(project, o.speciesId, o.formIndex ?? 0) === spriteId);
  if (!override?.[side]) throw new Error(`No PWAN ${side} palette exists for this form.`);
  return Array.from(pwanPalette(override[side]!.pwanBytes), rgbFrom555);
}
export function getNaturePalette(project: ProjectState, target: NaturePaletteTarget, base = naturePaletteBase(project, target.spriteId, target.source, target.shiny)): { palette: RgbColor[]; mask: number } {
  const key = naturePaletteKey(target), record = getNaturePaletteRecords(project).find(r => r.key === key);
  return { palette: applyPaletteDelta(base, record), mask: record?.mask ?? 0 };
}
export function setNaturePalette(project: ProjectState, target: NaturePaletteTarget, palette: RgbColor[]): void {
  if (!naturePalettesSupported(project)) throw new Error("Nature palettes require US revision-0 retail Black 2 or White 2.");
  const key = naturePaletteKey(target), records = getNaturePaletteRecords(project).filter(r => r.key !== key);
  const record = paletteDelta(target, naturePaletteBase(project, target.spriteId, target.source, target.shiny), palette);
  if (record) records.push(record);
  writeTable(project, records);
  recordGenericChange(project, "pokemon_sprites", "Updated nature palette.", `Sprite ${target.spriteId}`, { key: `nature-palette:${key}` });
}
export function resetNaturePalette(project: ProjectState, target: NaturePaletteTarget, color?: number): void {
  const key = naturePaletteKey(target), records = getNaturePaletteRecords(project);
  if (color !== undefined && (!Number.isInteger(color) || color < 1 || color > 15)) throw new Error("Invalid palette index.");
  const filtered: NaturePaletteRecord[] = [];
  for (const r of records) {
    if (r.key !== key) { filtered.push(r); continue; }
    if (color === undefined) continue;
    const colors: number[] = []; let j = 0;
    for (let i = 1; i < 16; ++i) if (r.mask & (1 << i)) { if (i !== color) colors.push(r.colors[j]); ++j; }
    const mask = r.mask & ~(1 << color);
    if (mask) filtered.push({ key, mask, colors });
  }
  writeTable(project, filtered);
  recordGenericChange(project, "pokemon_sprites", "Reset nature palette overrides.", `Sprite ${target.spriteId}`, { key: `nature-palette:${key}` });
}
export function resetNaturePaletteSource(project: ProjectState, spriteId: number, source: NaturePaletteSource): void {
  writeTable(project, getNaturePaletteRecords(project).filter(r => { const t = naturePaletteTarget(r.key); return t.spriteId !== spriteId || t.source !== source; }));
}
export function countNaturePaletteSource(project: ProjectState, spriteId: number, source: NaturePaletteSource): number {
  return getNaturePaletteRecords(project).filter(r => { const t = naturePaletteTarget(r.key); return t.spriteId === spriteId && t.source === source; }).length;
}
export class NaturePaletteReplacementError extends Error {
  constructor(public readonly count: number, public readonly sides: string[]) {
    super(`Replacing ${sides.join(" and ")} changes its color indexes and resets ${count} nature palette${count === 1 ? "" : "s"}.`);
    this.name = "NaturePaletteReplacementError";
  }
}
/** Call before replacing an imported asset; unchanged palette layouts retain edits. */
export function protectPwanNaturePalettes(project: ProjectState, previous: PwanAnimationOverride | undefined, next: PwanAnimationOverride, reset = false): void {
  const records = getNaturePaletteRecords(project);
  if (!records.length) return;
  const spriteId = resolvePokemonSpriteId(project, next.speciesId, next.formIndex ?? 0);
  const changed: NaturePaletteSource[] = [];
  let count = 0;
  for (const side of ["front", "back"] as const) {
    if (!next[side]) continue;
    const a = previous?.[side] && pwanPalette(previous[side]!.pwanBytes), b = pwanPalette(next[side]!.pwanBytes);
    if (a && a.every((color, i) => color === b[i])) continue;
    const source = `pwan-${side}` as NaturePaletteSource;
    const affected = records.filter(r => { const t = naturePaletteTarget(r.key); return t.spriteId === spriteId && t.source === source; }).length;
    if (affected) { changed.push(source); count += affected; }
  }
  if (!changed.length) return;
  if (!reset) throw new NaturePaletteReplacementError(count, changed.map(s => s.replace("pwan-", "PWAN ")));
  writeTable(project, records.filter(r => { const t = naturePaletteTarget(r.key); return t.spriteId !== spriteId || !changed.includes(t.source); }));
}
