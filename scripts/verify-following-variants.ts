import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { NintendoDSRom } from "../src/nds/rom";
import { decodeFollowerPositioningNarc, FOLLOWER_POSITIONING_PATH } from "../src/pokeweb/followingPokemonPositioning";
import { followerKey } from "../src/pokeweb/followingPokemonModel";
import { installFollowerAlpha, readFollowerAlphaInstall, removeFollowerAlpha, setFollowerAlphaEnabled,
  prepareFollowerWorkspace, updateFollowerPositioning, followerRom, readFollowingFile,
  FOLLOWER_LAND_ANCHORS_PATH, FOLLOWER_LAND_RIDER_PATH, FOLLOWER_RUNTIME_REGISTRY_PATH,
  FOLLOWER_SURF_REGISTRY_PATH, FOLLOWER_SURF_RESOURCE_PATH } from "../src/pokeweb/followingPokemonProject";
import { parseRpm } from "../src/pokeweb/rpm";
import { NARC } from "../src/nds/narc";
import { decodeGen5TextBank, encodeGen5TextBank } from "../src/pokeweb/text";

const [cleanPath, legacyPath] = process.argv.slice(2);
if (!cleanPath) throw new Error("Pass an audited clean ROM and optionally its previous combined alpha ROM.");
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "file:") throw new Error(`Unexpected asset URL: ${url}`);
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const mounts = [FOLLOWER_SURF_RESOURCE_PATH, FOLLOWER_SURF_REGISTRY_PATH, FOLLOWER_LAND_RIDER_PATH, FOLLOWER_LAND_ANCHORS_PATH];
const pristine = new NintendoDSRom(new Uint8Array(await readFile(cleanPath)), { fileData: "view" });
const optionsId = pristine.filenames.idOf("a/0/0/2")!;
const editedOptions = new NARC(pristine.files[optionsId]);
const editedEntries = decodeGen5TextBank(editedOptions.files[32]);
editedEntries[0] = [editedEntries[0][0], `${editedEntries[0][1]} TEST`, editedEntries[0][2]];
editedOptions.files[32] = encodeGen5TextBank(editedEntries);
const clean = pristine.save({ files: new Map([[optionsId, editedOptions.save()]]) });
const project = await loadProjectFromRomBytes(clean, basename(cleanPath), { selectedNarcs: [] });
const cleanRom = new NintendoDSRom(clean, { fileData: "view" });
const optionWords = (value: NintendoDSRom) => decodeGen5TextBank(new NARC(value.files[value.filenames.idOf("a/0/0/2")!]).files[32]).map(entry => entry[1]);
const cleanOptions = optionWords(cleanRom);
const optionIds = [6, 21, 22, 30];
const expectedWords = cleanRom.idCode === "IRDI" ? ["SEGUACI", "SÌ", "NO", "Scegli se mostrare i Pokémon che ti seguono."] : ["FOLLOWERS", "ON", "OFF", "Choose whether Pokémon follow you."];
const checkOptions = (value: NintendoDSRom, installed: boolean) => {
 const entries = optionWords(value);
 const changed = entries.findIndex((entry, id) => !optionIds.includes(id) && entry !== cleanOptions[id]);
 if (changed >= 0) throw new Error(`Unowned Options text changed at ${changed}: ${JSON.stringify(entries[changed])} vs ${JSON.stringify(cleanOptions[changed])}.`);
 if (optionIds.some((id, index) => entries[id] !== (installed ? expectedWords[index] : cleanOptions[id]))) throw new Error(`Reserved Options text was not installed or restored: ${JSON.stringify(optionIds.map(id => entries[id]))}`);
};
const unrelatedPath = "a/2/1/4", unrelatedId = cleanRom.filenames.idOf(unrelatedPath);
if (unrelatedId === undefined) throw new Error("Missing unrelated archive used by the preservation check.");
const unrelatedEdit = cleanRom.files[unrelatedId].slice();
unrelatedEdit[unrelatedEdit.length - 1] ^= 1;
project.fileSystem = { ...project.fileSystem, replacements: { ...project.fileSystem?.replacements, [unrelatedId]: unrelatedEdit } };
const checkUnrelatedEdit = (output: NintendoDSRom) => {
  if (output.filenames.idOf(unrelatedPath) !== unrelatedId ||
      !output.files[unrelatedId].every((byte, index) => byte === unrelatedEdit[index]))
    throw new Error("Unrelated ROM edit or file ID changed.");
};
const base = await installFollowerAlpha(project);
if (base.variant !== "base" || base.surfSha256 || base.landRiderSha256) throw new Error("Fresh install was not base-only.");
let exported = await exportModifiedRom(project);
let rom = new NintendoDSRom(exported, { fileData: "view" });
checkUnrelatedEdit(rom);
checkOptions(rom, true);
for (const path of mounts) if (rom.filenames.idOf(path) !== undefined) throw new Error(`Base package contains ${path}`);
if (rom.filenames.idOf("a/0/1/6") !== cleanRom.filenames.idOf("a/0/1/6")) throw new Error("Unrelated file ID moved during base install.");
let reopened = await loadProjectFromRomBytes(exported, "base.nds", { selectedNarcs: [] });
if ((await readFollowerAlphaInstall(reopened))?.variant !== "base") throw new Error("Base receipt did not reopen.");
await setFollowerAlphaEnabled(reopened, false);
await setFollowerAlphaEnabled(reopened, true);
const actorRom = await followerRom(reopened);
const workspace = await prepareFollowerWorkspace(reopened, actorRom);
const entry = workspace.registry.entries[0];
await updateFollowerPositioning(reopened, actorRom, { landKey: followerKey(entry.key), gaps: [1, 2, 3, 4], rider: [[0, 0], [0, 0], [0, 0], [0, 0]] });
exported = await exportModifiedRom(reopened);
reopened = await loadProjectFromRomBytes(exported, "base-authored.nds", { selectedNarcs: [] });
if (!(await readFollowerAlphaInstall(reopened))?.enabled) throw new Error("Enabled base receipt did not reopen.");
const positionRom = await followerRom(reopened);
const rows = decodeFollowerPositioningNarc(readFollowingFile(reopened, positionRom, FOLLOWER_POSITIONING_PATH)!,
  readFollowingFile(reopened, positionRom, FOLLOWER_RUNTIME_REGISTRY_PATH)!);
if (rows.surf.length || rows.land[(entry.descriptorRow - 1008) * 12] !== 1) throw new Error("Base walking gaps were not saved.");
await removeFollowerAlpha(reopened);
const full = await installFollowerAlpha(reopened, undefined, { riding: true });
if (full.variant !== "full" || !full.surfSha256 || !full.landRiderSha256) throw new Error("Full package was not installed.");
exported = await exportModifiedRom(reopened);
rom = new NintendoDSRom(exported, { fileData: "view" });
checkUnrelatedEdit(rom);
checkOptions(rom, true);
const originalIds = mounts.map(path => rom.filenames.idOf(path));
if (originalIds.some(id => id === undefined)) throw new Error("Full package lacks mount files.");
reopened = await loadProjectFromRomBytes(exported, "full.nds", { selectedNarcs: [] });
if ((await readFollowerAlphaInstall(reopened))?.variant !== "full") throw new Error("Full receipt did not reopen.");
await removeFollowerAlpha(reopened);
const converted = await installFollowerAlpha(reopened, undefined, { riding: false });
if (converted.variant !== "base") throw new Error("Full-to-base conversion failed.");
exported = await exportModifiedRom(reopened);
rom = new NintendoDSRom(exported, { fileData: "view" });
checkUnrelatedEdit(rom);
checkOptions(rom, true);
for (let i = 0; i < mounts.length; i++) {
  if (rom.filenames.idOf(mounts[i]) !== undefined || rom.files[originalIds[i]!].length !== 0)
    throw new Error(`Mount payload was not stripped: ${mounts[i]}`);
}
if (rom.filenames.idOf("a/0/1/6") !== cleanRom.filenames.idOf("a/0/1/6")) throw new Error("Conversion renumbered unrelated files.");
reopened = await loadProjectFromRomBytes(exported, "converted.nds", { selectedNarcs: [] });
if ((await readFollowerAlphaInstall(reopened))?.variant !== "base") throw new Error("Converted base receipt did not reopen.");
const convertedRom = await followerRom(reopened);
const convertedRows = decodeFollowerPositioningNarc(readFollowingFile(reopened, convertedRom, FOLLOWER_POSITIONING_PATH)!,
  readFollowingFile(reopened, convertedRom, FOLLOWER_RUNTIME_REGISTRY_PATH)!);
if (convertedRows.land[(entry.descriptorRow - 1008) * 12] !== 1) throw new Error("Converted walking gaps changed.");
const modulePath = "patches/PokewebFollowingField" + (rom.idCode === "IREO" ? "B2" : rom.idCode === "IRDI" ? "W2I" : "W2") + ".dll";
const module = parseRpm(rom.files[rom.filenames.idOf(modulePath)!], { allowedMagics: ["DLXF"] });
if (module.relocations.some(rel => rel.target.module === "36" && [0x021a4974, 0x021a4d4a, 0x0219d5b4].includes(rel.target.address)))
  throw new Error("Base DLL contains a mount hook.");
console.log("Fresh base, full install, conversion, physical asset strip, receipt reopen and walking gaps passed; no emulator run.");

if (legacyPath) {
  const legacy = await loadProjectFromRomBytes(new Uint8Array(await readFile(legacyPath)), basename(legacyPath), { selectedNarcs: [] });
  if ((await readFollowerAlphaInstall(legacy))?.variant) throw new Error("Legacy receipt unexpectedly declares a variant.");
  if ((await installFollowerAlpha(legacy)).variant !== "full") throw new Error("Legacy upgrade did not retain riding.");
  const upgraded = await loadProjectFromRomBytes(await exportModifiedRom(legacy), "legacy-upgraded.nds", { selectedNarcs: [] });
  if ((await readFollowerAlphaInstall(upgraded))?.variant !== "full") throw new Error("Upgraded legacy receipt did not reopen.");
  console.log("Legacy combined alpha upgraded as full; no emulator run.");
}
