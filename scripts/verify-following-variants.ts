import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { NintendoDSRom } from "../src/nds/rom";
import { decodeFollowerPositioningNarc, FOLLOWER_POSITIONING_PATH } from "../src/pokeweb/followingPokemonPositioning";
import { followerKey } from "../src/pokeweb/followingPokemonModel";
import { installFollowerAlpha, readFollowerAlphaInstall, removeFollowerAlpha, setFollowerAlphaEnabled,
  prepareFollowerWorkspace, updateFollowerPositioning, followerRom, readFollowingFile, readFollowerDialogueRules, writeFollowerDialogueRules,
  FOLLOWER_LAND_ANCHORS_PATH, FOLLOWER_LAND_RIDER_PATH, FOLLOWER_RUNTIME_REGISTRY_PATH,
  FOLLOWER_SURF_REGISTRY_PATH, FOLLOWER_SURF_RESOURCE_PATH } from "../src/pokeweb/followingPokemonProject";
import { parseRpm } from "../src/pokeweb/rpm";
import { NARC } from "../src/nds/narc";
import { decodeGen5TextBank, encodeGen5TextBank } from "../src/pokeweb/text";

const [cleanPath, previousPath] = process.argv.slice(2);
if (!cleanPath) throw new Error("Pass an audited clean ROM and optionally its previous alpha ROM.");
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
const checkBattle = (output: NintendoDSRom, installed = true) => {
 const suffix = output.idCode === "IREO" ? "B2" : output.idCode === "IRDI" ? "W2I" : "W2";
 const module = parseRpm(output.getFileByName(`patches/PokewebFollowingBattle${suffix}.dll`), { allowedMagics: ["DLXF"] });
 const hooks = module.relocations.filter(r => r.target.module !== "base");
 if (hooks.length !== (installed ? 2 : 0) || hooks.some(r => r.target.module !== "167" || r.target.type !== "FULL_COPY"))
  throw new Error("Battle intro hooks were not installed/removed correctly.");
};
const checkUnrelatedEdit = (output: NintendoDSRom) => {
  if (output.filenames.idOf(unrelatedPath) !== unrelatedId ||
      !output.files[unrelatedId].every((byte, index) => byte === unrelatedEdit[index]))
    throw new Error("Unrelated ROM edit or file ID changed.");
};
const base = await installFollowerAlpha(project);
if (base.variant !== "base" || base.surfSha256 || base.landRiderSha256) throw new Error("Fresh install was not base-only.");
const authoredDialogue = [{zone:42,species:151,text:"{nickname} likes this place.",
  ...(base.dialogueAnimations ? {beforeAnimation:2 as const,afterAnimation:5 as const} : {})}];
await writeFollowerDialogueRules(project, authoredDialogue);
const checkDialogue = async (value: typeof project) => {
  if (JSON.stringify(await readFollowerDialogueRules(value)) !== JSON.stringify(authoredDialogue))
    throw new Error("Authored dialogue or its before/after animations changed.");
  if (base.dialogueAnimations && !(await readFollowerAlphaInstall(value))?.dialogueAnimations)
    throw new Error("Dialogue animation capability did not reopen in the receipt.");
};
let exported = await exportModifiedRom(project);
let rom = new NintendoDSRom(exported, { fileData: "view" });
checkUnrelatedEdit(rom);
checkOptions(rom, true);
checkBattle(rom);
for (const path of mounts) if (rom.filenames.idOf(path) !== undefined) throw new Error(`Base package contains ${path}`);
if (rom.filenames.idOf("a/0/1/6") !== cleanRom.filenames.idOf("a/0/1/6")) throw new Error("Unrelated file ID moved during base install.");
let reopened = await loadProjectFromRomBytes(exported, "base.nds", { selectedNarcs: [] });
if ((await readFollowerAlphaInstall(reopened))?.variant !== "base") throw new Error("Base receipt did not reopen.");
await checkDialogue(reopened);
await setFollowerAlphaEnabled(reopened, false);
await setFollowerAlphaEnabled(reopened, true);
const actorRom = await followerRom(reopened);
const workspace = await prepareFollowerWorkspace(reopened, actorRom);
const entry = workspace.registry.entries[0];
await updateFollowerPositioning(reopened, actorRom, { landKey: followerKey(entry.key), gaps: [1, 2, 3, 4], rider: [[0, 0], [0, 0], [0, 0], [0, 0]] });
exported = await exportModifiedRom(reopened);
reopened = await loadProjectFromRomBytes(exported, "base-authored.nds", { selectedNarcs: [] });
if (!(await readFollowerAlphaInstall(reopened))?.enabled) throw new Error("Enabled base receipt did not reopen.");
await checkDialogue(reopened);
const positionRom = await followerRom(reopened);
const rows = decodeFollowerPositioningNarc(readFollowingFile(reopened, positionRom, FOLLOWER_POSITIONING_PATH)!,
  readFollowingFile(reopened, positionRom, FOLLOWER_RUNTIME_REGISTRY_PATH)!);
if (rows.surf.length || rows.land[(entry.descriptorRow - 1008) * 12] !== 1) throw new Error("Base walking gaps were not saved.");
await removeFollowerAlpha(reopened);
await checkDialogue(reopened);
checkBattle(new NintendoDSRom(await exportModifiedRom(reopened), { fileData: "view" }), false);
const full = await installFollowerAlpha(reopened, undefined, { riding: true });
if (full.variant !== "full" || !full.surfSha256 || !full.landRiderSha256) throw new Error("Full package was not installed.");
exported = await exportModifiedRom(reopened);
rom = new NintendoDSRom(exported, { fileData: "view" });
checkUnrelatedEdit(rom);
checkOptions(rom, true);
checkBattle(rom);
const originalIds = mounts.map(path => rom.filenames.idOf(path));
if (originalIds.some(id => id === undefined)) throw new Error("Full package lacks mount files.");
reopened = await loadProjectFromRomBytes(exported, "full.nds", { selectedNarcs: [] });
if ((await readFollowerAlphaInstall(reopened))?.variant !== "full") throw new Error("Full receipt did not reopen.");
await checkDialogue(reopened);
await removeFollowerAlpha(reopened);
const converted = await installFollowerAlpha(reopened, undefined, { riding: false });
if (converted.variant !== "base") throw new Error("Full-to-base conversion failed.");
exported = await exportModifiedRom(reopened);
rom = new NintendoDSRom(exported, { fileData: "view" });
checkUnrelatedEdit(rom);
checkOptions(rom, true);
checkBattle(rom);
for (let i = 0; i < mounts.length; i++) {
  if (rom.filenames.idOf(mounts[i]) !== undefined || rom.files[originalIds[i]!].length !== 0)
    throw new Error(`Mount payload was not stripped: ${mounts[i]}`);
}
if (rom.filenames.idOf("a/0/1/6") !== cleanRom.filenames.idOf("a/0/1/6")) throw new Error("Conversion renumbered unrelated files.");
reopened = await loadProjectFromRomBytes(exported, "converted.nds", { selectedNarcs: [] });
if ((await readFollowerAlphaInstall(reopened))?.variant !== "base") throw new Error("Converted base receipt did not reopen.");
await checkDialogue(reopened);
const convertedRom = await followerRom(reopened);
const convertedRows = decodeFollowerPositioningNarc(readFollowingFile(reopened, convertedRom, FOLLOWER_POSITIONING_PATH)!,
  readFollowingFile(reopened, convertedRom, FOLLOWER_RUNTIME_REGISTRY_PATH)!);
if (convertedRows.land[(entry.descriptorRow - 1008) * 12] !== 1) throw new Error("Converted walking gaps changed.");
const modulePath = "patches/PokewebFollowingField" + (rom.idCode === "IREO" ? "B2" : rom.idCode === "IRDI" ? "W2I" : "W2") + ".dll";
const module = parseRpm(rom.files[rom.filenames.idOf(modulePath)!], { allowedMagics: ["DLXF"] });
if (module.relocations.some(rel => rel.target.module === "36" && [0x021a4974, 0x021a4d4a, 0x0219d5b4].includes(rel.target.address)))
  throw new Error("Base DLL contains a mount hook.");
console.log(`Fresh base, full install, conversion, physical asset strip, receipt reopen, walking gaps and authored dialogue${base.dialogueAnimations ? " with before/after animations" : ""} passed; no emulator run.`);

if (previousPath) {
  const previous = await loadProjectFromRomBytes(new Uint8Array(await readFile(previousPath)), basename(previousPath), { selectedNarcs: [] });
  const before = await readFollowerAlphaInstall(previous);
  if (!before?.enabled) throw new Error("Previous alpha installation was not recognized.");
  const expectedVariant = before.variant ?? "full";
  const updated = await installFollowerAlpha(previous);
  if (updated.variant !== expectedVariant) throw new Error("Previous alpha upgrade changed its installed variant.");
  if (updated.dialogueAnimations) await writeFollowerDialogueRules(previous, authoredDialogue);
  const upgraded = await loadProjectFromRomBytes(await exportModifiedRom(previous), "previous-upgraded.nds", { selectedNarcs: [] });
  const reopened = await readFollowerAlphaInstall(upgraded);
  if (reopened?.variant !== expectedVariant || reopened.version !== updated.version || reopened.moduleSha256 !== updated.moduleSha256)
    throw new Error("Upgraded previous alpha receipt did not reopen with the current DLL.");
  if (updated.dialogueAnimations) await checkDialogue(upgraded);
  console.log(`Previous ${before.variant ?? "legacy combined"} alpha upgraded as ${expectedVariant}; no emulator run.`);
}
