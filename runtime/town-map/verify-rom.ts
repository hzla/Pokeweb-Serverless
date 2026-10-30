import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { loadTownMapDraft, applyTownMapDraft, parseTownMapAreas, writeTownMapAreas, moveTownMapArea, editTownMapText, validateTownMapDraft, appendTownMapArea } from "../../src/pokeweb/townMapModel";
import { readTownMapLayer, writeTownMapLayer, TOWN_MAP_LAYERS, equalTownMapBytes, convertTownMapImage, readTownMapTileSet, writeTownMapTileSet, unpackTownMapResource, editTownMapAnimationFrame } from "../../src/pokeweb/townMapGraphics";
import { parsePokemonAnimation } from "../../src/pokeweb/pokemonSpriteModel";
import { renderNitroBackgroundImage } from "../../src/pokeweb/nitroBg";
import { createProjectDocument } from "../../src/pokeweb/projectDocument";
import { openProjectSession } from "../../src/pokeweb/projectSession";
import { installCodeInjectionPatch } from "../../src/pokeweb/codeInjectionInstall";
import { stageCodeInjectionDll } from "../../src/pokeweb/pmcModel";
import { configureFlyDestinationRuntime, getFlyDestinations, applyFlyDestinationEdit } from "../../src/pokeweb/flyDestinationModel";
import { NARC } from "../../src/nds/narc";
import { NintendoDSRom } from "../../src/nds/rom";
import { loadOverlayTable } from "../../src/nds/code";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";

const args = process.argv.slice(2), input = args[0], output = args[1]?.startsWith("--") ? undefined : args[1];
const count = Number(args.find(a => a.startsWith("--areas="))?.split("=")[1] ?? 85);
if (!input || output && resolve(output) === resolve(input)) throw new Error("Pass a source ROM and an optional new output path.");
globalThis.fetch = (async input => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "file:") throw new Error("Only bundled local runtime assets are expected.");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
let bytes = new Uint8Array(await readFile(input));
let project = await loadProjectFromRomBytes(bytes, "town-map-source.nds", { selectedNarcs: ["headers", "town_map"] });
if (args.includes("--with-cgear")) {
  const { installCGearQuickActions } = await import("../../src/pokeweb/cgearQuickActionsModel");
  await installCGearQuickActions(project);
}
const migration = args.find(a => a.startsWith("--migrate="))?.split("=")[1];
let preserved: Record<number, { x: number; y: number; z: number }> | undefined;
if (migration) {
  const version = project.session.baseVersion as "B2" | "W2";
  const path = migration === "1.0.0" ? `../../src/test/fixtures/fly-destinations-v1.0.0/${version}.dll` : `../../src/assets/codeinjection/FlyDestinations${version}.dll`;
  preserved = { 326: { x: 51, y: 0, z: 88 }, 490: { x: 56, y: 0, z: 89 } };
  const configured = configureFlyDestinationRuntime(new Uint8Array(await readFile(new URL(path, import.meta.url))), version, { overrides: preserved });
  await installCodeInjectionPatch(project, staged => { stageCodeInjectionDll(staged, `FlyDestinations${version}.dll`, configured); staged.flyDestinations = { overrides: preserved! }; });
  if (args.includes("--embedded")) {
    bytes = await exportModifiedRom(project);
    project = await loadProjectFromRomBytes(bytes, "legacy-fly-source.nds", { selectedNarcs: ["headers", "town_map"] });
  }
}
if (migration && args.includes("--fly-only-migration")) {
  const entries = getFlyDestinations(project), current = entries.find(e => e.enabled)!;
  await applyFlyDestinationEdit(project, current.index, { ...current.landing, enabled: current.enabled, visitFlag: current.visitFlag });
  if (!project.flyDestinations?.townMapCount) throw new Error("Applying unchanged legacy Fly settings did not migrate their runtime.");
}
const draft = await loadTownMapDraft(project);
if (!equalTownMapBytes(writeTownMapAreas(parseTownMapAreas(draft.baseline.areas)), draft.baseline.areas)) throw new Error("Area round trip changed bytes.");
for (const layer of TOWN_MAP_LAYERS) {
  const files = structuredClone(draft.graphics); writeTownMapLayer(files, layer, readTownMapLayer(files, layer));
  for (const [id, data] of files) if (!equalTownMapBytes(data, draft.graphics.get(id)!)) throw new Error(`Unedited graphics member ${id} changed.`);
}
if (args.includes("--image-roundtrip")) for (const layer of TOWN_MAP_LAYERS) {
  const image = readTownMapLayer(draft.graphics, layer), pixels = renderNitroBackgroundImage(image);
  const result = convertTownMapImage(image, pixels, 256, 256, layer.maxTiles), restored = renderNitroBackgroundImage(result.image);
  if (pixels.some((value, i) => value !== restored[i])) throw new Error(`PNG layer conversion changed native pixels: ${layer.label}.`);
  console.log(`${layer.label}: image conversion retained native pixels in ${result.tiles}/${layer.maxTiles} tiles.`);
}
validateTownMapDraft(project, draft);
const a = draft.areas[0], original = structuredClone(a);
moveTownMapArea(a, 1, 1, true);
editTownMapText(draft, 0, 0, "A custom Town Map description.");
const free = Object.values(project.headers!.rows).filter(h => !draft.areas.some(a => a.zone === h.index));
while (draft.areas.length < count) appendTownMapArea(draft, 0, free.shift()!.index);
if (args.includes("--native")) draft.landings[a.zone].x += 1;
if (args.includes("--artwork")) {
  const layer = TOWN_MAP_LAYERS[0], image = readTownMapLayer(draft.graphics, layer);
  image.indexed.tilePixels[1][1] ^= 1; image.indexed.palette[257][1] = (image.indexed.palette[257][1] + 8) % 256; image.indexed.entries[0] = 1 | 1 << 12 | 1 << 10;
  writeTownMapLayer(draft.graphics, layer, image);
  const markers = readTownMapTileSet(draft.graphics, 8, 2); markers.tiles[0][0] ^= 1; writeTownMapTileSet(draft.graphics, 8, 2, markers);
  const shapes = readTownMapTileSet(draft.habitatGraphics, 15, 5); shapes.tiles[0][0] ^= 1; writeTownMapTileSet(draft.habitatGraphics, 15, 5, shapes);
  const originalAnimation = draft.graphics.get(19)!, animation = parsePokemonAnimation(unpackTownMapResource(originalAnimation)); animation.sequences[0].frames[0].duration += 1;
  editTownMapAnimationFrame(draft.graphics, 19, 0, 0, "duration", animation.sequences[0].frames[0].duration);
  draft.areas[0].habitat.x = -12; draft.areas[0].habitat.y = -20;
}
if (args.includes("--failure-checks")) {
  const snapshot = () => structuredClone({ areas: project.narcs.town_map, graphics: project.narcs.town_map_graphics, messages: project.narcs.message_texts, habitats: project.narcs.town_map_species_habitats,
    fileSystem: project.fileSystem, codeInjection: project.codeInjection, patches: project.patches, flyDestinations: project.flyDestinations, arm9: project.arm9, overlays: project.overlays });
  const { isDeepStrictEqual } = await import("node:util");
  const source = new NintendoDSRom(bytes, { fileData: "view" }), overlay = loadOverlayTable(source.arm9OverlayTable, (_id, fileId) => source.files[fileId], new Set([144])).get(144)!;
  project.overlays[144] = overlay.data.slice(); project.overlays[144]![0] ^= 1;
  const before = snapshot(); let rejected = false;
  try { await applyTownMapDraft(project, draft); } catch { rejected = true; }
  if (!rejected || !isDeepStrictEqual(snapshot(), before)) throw new Error("Failed native Apply changed the live project.");
  delete project.overlays[144];
  console.log("Native binding rejection rolled back records, graphics, text, habitat data, PMC and Fly configuration.");
}
await applyTownMapDraft(project, draft);
if (count === 85 && !args.includes("--native") && !migration && project.codeInjection?.modules?.some(m => m.fileName.startsWith("TownMap"))) throw new Error("Ordinary record/artwork edits installed unnecessary native support.");
if (count > 85) {
  const originalHabitats = new NARC(new NintendoDSRom(bytes, { fileData: "view" }).getFileByName("a/1/7/6")).files;
  for (let i = 0; i < originalHabitats.length; i++) {
    const old = originalHabitats[i], current = project.narcs.town_map_species_habitats!.rawFiles[i], stride = old.length === 345 ? 86 : 129;
    for (let season = 0; season < 4; season++) if (!equalTownMapBytes(old.subarray(2 + season * stride, 87 + season * stride), current.subarray(2 + season * 129, 87 + season * 129))) throw new Error("Expansion changed native habitat flags.");
  }
}
if (preserved) for (const [zone, landing] of Object.entries(preserved)) {
  if (JSON.stringify(project.flyDestinations?.overrides[Number(zone)]) !== JSON.stringify(landing)) throw new Error("Migration lost a Fly landing override.");
}
if (migration) {
  const version = project.session.baseVersion;
  if (project.fileSystem?.additions?.[`patches/FlyDestinations${version}.dll`] || project.codeInjection?.modules?.some(m => m.fileName === `FlyDestinations${version}.dll`)) throw new Error("Legacy Fly module was not retired.");
  const entry = getFlyDestinations(project).find(d => d.enabled)!;
  await applyFlyDestinationEdit(project, entry.index, { ...entry.landing, enabled: entry.enabled, visitFlag: entry.visitFlag });
  if (project.fileSystem?.additions?.[`patches/FlyDestinations${version}.dll`]) throw new Error("Standalone Fly editor restored a legacy module.");
  console.log(`Fly ${migration}${args.includes("--embedded") ? " embedded" : " staged"} migration preserved independent Route 4 / Join Avenue overrides; standalone Fly edits use the combined runtime.`);
}
const saved = openProjectSession(structuredClone(createProjectDocument(project, false))); saved.originalRomBytes = bytes;
const restored = await loadTownMapDraft(saved);
if (restored.areas[0].position.x !== original.position.x + 1 || restored.texts[restored.areas[0].description][1] !== "A custom Town Map description.") throw new Error("Project save lost Town Map edits.");
const result = await exportModifiedRom(saved), reopened = await loadProjectFromRomBytes(result, "town-map-export.nds", { selectedNarcs: ["headers", "town_map"] });
const after = await loadTownMapDraft(reopened);
if (after.areas[0].position.x !== original.position.x + 1 || after.texts[after.areas[0].description][1] !== "A custom Town Map description.") throw new Error("ROM export/reload lost edits.");
if (after.areas.length !== count || count > 85 && reopened.flyDestinations?.townMapCount !== count) throw new Error("Expanded area count did not survive export/reload.");
for (const [id, data] of after.graphics) if (!equalTownMapBytes(data, draft.graphics.get(id)!)) throw new Error(`ROM export changed graphics ${id}.`);
for (const [id, data] of after.habitatGraphics) if (!equalTownMapBytes(data, draft.habitatGraphics.get(id)!)) throw new Error(`ROM export changed habitat graphics ${id}.`);
if (args.includes("--artwork") && (after.areas[0].habitat.x !== -12 || after.areas[0].habitat.y !== -20)) throw new Error("Signed habitat coordinates changed.");
console.log(`${project.romInfo.idCode}: ${count} areas; area/graphics no-op round trips, linked movement, text edit, project save and ROM export/reload passed.`);
if (migration && new NintendoDSRom(result, { fileData: "view" }).filenames.idOf(`patches/FlyDestinations${project.session.baseVersion}.dll`) !== undefined) throw new Error("ROM export retained the retired Fly module path.");
if (output) await writeFile(output, result, { flag: "wx" });
