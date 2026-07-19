import { readFile } from "node:fs/promises";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import {
  buildPwanOverrideSide,
  installPwanRuntime,
  listPwanSpeciesTargets,
  materializePwanAnimations,
  PWAN_ARCHIVE_PATH,
  PWAN_B2_RUNTIME_PATHS,
  PWAN_W2_RUNTIME_PATHS,
  resolvePwanSpeciesTarget,
  upsertPwanOverrideSide,
} from "../src/pokeweb/pwanAnimationModel";

const SINGLE_PIXEL_GIF_BASE64 = "R0lGODlhAQABAIABAP///wAAACH5BAEKAAEALAAAAAABAAEAAAICRAEAOw==";

const romPath = process.argv[2];
if (!romPath) throw new Error("Usage: npm run pwan:runtime:verify-b2-install -- cleanblack2.nds");

const bytes = new Uint8Array(await readFile(romPath));
const rom = new NintendoDSRom(bytes);
if (rom.idCode !== "IREO") throw new Error(`Expected stock US Black 2 (IREO), got ${rom.idCode}.`);
const originalPokemonSprites = rom.getFileByName("a/0/0/4");
const project = await loadProjectFromRomBytes(bytes, "cleanblack2.nds", {
  selectedNarcs: ["pokemon_sprites", "personal"],
});
const selectableTargets = listPwanSpeciesTargets(project);
if (!selectableTargets.some((target) => target.requestedSpeciesId === 1 && target.speciesId === 1)) {
  throw new Error("The Black 2 PWAN selector omitted Bulbasaur.");
}
if (selectableTargets.some((target) => target.speciesId > 649)) {
  throw new Error("The Black 2 PWAN selector exposed a non-Gen-5 species target.");
}

const previousFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : String(input));
  const fileName = url.pathname.split("/").pop() ?? "";
  try {
    const relativeAsset = url.pathname.includes("/pwan/carrier-b2/")
      ? `../src/assets/pwan/carrier-b2/${fileName}`
      : `../src/assets/codeinjection/${fileName}`;
    const asset = new Uint8Array(await readFile(new URL(relativeAsset, import.meta.url)));
    return new Response(asset);
  } catch {
    return new Response(undefined, { status: 404 });
  }
}) as typeof fetch;

await installPwanRuntime(project);
await materializePwanAnimations(project, rom);

if (PWAN_B2_RUNTIME_PATHS.some((path) => !project.fileSystem?.additions?.[path])) throw new Error("Not all Black 2 split PWAN runtimes were staged.");
if (PWAN_W2_RUNTIME_PATHS.some((path) => project.fileSystem?.additions?.[path])) throw new Error("A White 2 PWAN runtime was staged into Black 2.");
if ((project.narcs.pokemon_sprites?.dirty.size ?? 0) !== 0) throw new Error("Installing an empty PWAN runtime dirtied native sprite files.");
const originalSpriteFiles = new NARC(originalPokemonSprites).files;
const activeSpriteFiles = project.narcs.pokemon_sprites?.rawFiles ?? [];
if (originalSpriteFiles.length !== activeSpriteFiles.length || originalSpriteFiles.some((file, index) => !equalBytes(file, activeSpriteFiles[index]!))) {
  throw new Error("Installing an empty PWAN runtime changed native sprite NARC members.");
}
const pwanArchive = new NARC(project.fileSystem.additions[PWAN_ARCHIVE_PATH]!);
const configCount = new DataView(pwanArchive.files[0]!.buffer, pwanArchive.files[0]!.byteOffset).getUint16(6, true);
if (configCount !== 0) throw new Error(`Expected an empty PWAN config, got ${configCount} entries.`);

const beforeImport = activeSpriteFiles.map((file) => file.slice());
const target = resolvePwanSpeciesTarget(project, 25);
upsertPwanOverrideSide(project, {
  speciesId: target.speciesId,
  formIndex: target.formIndex,
  assetIndex: target.assetIndex === target.speciesId ? undefined : target.assetIndex,
  side: "front",
  sideData: buildPwanOverrideSide({ fileName: "test.gif", gifBytes: new Uint8Array(Buffer.from(SINGLE_PIXEL_GIF_BASE64, "base64")) }),
  nativePaletteSource: "front",
});
await materializePwanAnimations(project, rom);
const expectedDirty = new Set([0, 2, 4, 5, 6, 7, 8, 18].map((offset) => target.assetIndex * 20 + offset));
const actualDirty = project.narcs.pokemon_sprites?.dirty ?? new Set<number>();
if ([...actualDirty].some((index) => !expectedDirty.has(index)) || [...expectedDirty].some((index) => !actualDirty.has(index))) {
  throw new Error(`Manual Black 2 GIF import dirtied unexpected sprite files: ${[...actualDirty].join(", ")}.`);
}
for (let index = 0; index < activeSpriteFiles.length; index += 1) {
  if (!expectedDirty.has(index) && !equalBytes(beforeImport[index]!, activeSpriteFiles[index]!)) {
    throw new Error(`Manual Black 2 GIF import changed unrelated sprite file ${index}.`);
  }
}
const importedArchive = new NARC(project.fileSystem.additions[PWAN_ARCHIVE_PATH]!);
const importedCount = new DataView(importedArchive.files[0]!.buffer, importedArchive.files[0]!.byteOffset).getUint16(6, true);
if (importedCount !== 1) throw new Error(`Expected one explicit PWAN config entry, got ${importedCount}.`);

const alternatePersonalId = Array.from(
  { length: Math.max(0, (project.narcs.personal?.fileCount ?? 0) - 650) },
  (_value, index) => 650 + index,
).find((candidate) => {
  try {
    const candidateTarget = resolvePwanSpeciesTarget(project, candidate);
    return candidateTarget.speciesId <= 649 && candidateTarget.formIndex > 0 && candidateTarget.assetIndex > 649;
  } catch {
    return false;
  }
});
if (alternatePersonalId === undefined) throw new Error("Could not resolve a legitimate Gen 5 alternate-form personal entry.");
const alternateTarget = resolvePwanSpeciesTarget(project, alternatePersonalId);
if (!selectableTargets.some((target) => target.requestedSpeciesId === alternatePersonalId)) {
  throw new Error(`The Black 2 PWAN selector omitted alternate-form personal record ${alternatePersonalId}.`);
}
const testSide = buildPwanOverrideSide({ fileName: "test.gif", gifBytes: new Uint8Array(Buffer.from(SINGLE_PIXEL_GIF_BASE64, "base64")) });
upsertPwanOverrideSide(project, {
  speciesId: target.speciesId,
  formIndex: target.formIndex,
  assetIndex: target.assetIndex === target.speciesId ? undefined : target.assetIndex,
  side: "back",
  sideData: testSide,
  nativePaletteSource: "front",
});
upsertPwanOverrideSide(project, {
  speciesId: alternateTarget.speciesId,
  formIndex: alternateTarget.formIndex,
  assetIndex: alternateTarget.assetIndex,
  side: "front",
  sideData: testSide,
  nativePaletteSource: "front",
});
upsertPwanOverrideSide(project, {
  speciesId: alternateTarget.speciesId,
  formIndex: alternateTarget.formIndex,
  assetIndex: alternateTarget.assetIndex,
  side: "back",
  sideData: testSide,
  nativePaletteSource: "front",
});
await materializePwanAnimations(project, rom);
const allCarrierOffsets = [0, 2, 4, 5, 6, 7, 8, 9, 11, 13, 14, 15, 16, 17, 18, 19];
const expectedFinalDirty = new Set([
  ...allCarrierOffsets.map((offset) => target.assetIndex * 20 + offset),
  ...allCarrierOffsets.map((offset) => alternateTarget.assetIndex * 20 + offset),
]);
const finalDirty = project.narcs.pokemon_sprites?.dirty ?? new Set<number>();
if ([...finalDirty].some((index) => !expectedFinalDirty.has(index)) || [...expectedFinalDirty].some((index) => !finalDirty.has(index))) {
  throw new Error(`Normal/alternate-form imports dirtied unexpected sprite files: ${[...finalDirty].join(", ")}.`);
}
for (let index = 0; index < activeSpriteFiles.length; index += 1) {
  if (!expectedFinalDirty.has(index) && !equalBytes(beforeImport[index]!, activeSpriteFiles[index]!)) {
    throw new Error(`Normal/alternate-form imports changed unrelated sprite file ${index}.`);
  }
}
const finalArchive = new NARC(project.fileSystem.additions[PWAN_ARCHIVE_PATH]!);
const finalCount = new DataView(finalArchive.files[0]!.buffer, finalArchive.files[0]!.byteOffset).getUint16(6, true);
if (finalCount !== 2) throw new Error(`Expected normal and alternate-form PWAN entries, got ${finalCount}.`);
globalThis.fetch = previousFetch;
console.log(`Black 2 PWAN install passed: all three split DLLs stage, empty install preserves native sprites, and manual normal/form imports patch only their selected front/back carriers (form personal ${alternatePersonalId} -> asset ${alternateTarget.assetIndex}).`);

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
  return true;
}
