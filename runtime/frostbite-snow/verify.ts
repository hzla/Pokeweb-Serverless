import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { buildFrostbiteSnowModule, buildModernStatusModule, frostbiteSnowLabel, frostbiteSnowStatus, installFrostbiteSnowPatch, type FrostbiteSnowPatch } from "../../src/pokeweb/frostbiteSnowModel";
import { getMoveTextInfo } from "../../src/pokeweb/moveTextModel";
import { getTextBank } from "../../src/pokeweb/textModel";
import { configureAbilityRuleSets, inspectAbilityEffects } from "../../src/pokeweb/abilityEffectsModel";
import { abilityImport } from "../../src/pokeweb/abilityLibrary";
import { configureMoveRuleSets, inspectMoveEffects } from "../../src/pokeweb/moveEffectsModel";
import { MOVE_ALWAYS, newMoveEffect } from "../../src/pokeweb/moveRules";
import { configureItemRuleSets, inspectItemEffect } from "../../src/pokeweb/itemEffectsModel";
import { NintendoDSRom } from "../../src/nds/rom";
import { NARC } from "../../src/nds/narc";
import { installBundledPmc, stageCodeInjectionDll } from "../../src/pokeweb/pmcModel";
import { parseRpm, writeRpm } from "../../src/pokeweb/rpm";
import { decompileMoveAnimation, getMoveAnimationParticleIds } from "../../src/pokeweb/moveAnimationModel";

const [path, mode = "both"] = process.argv.slice(2);
assert(path, "Supply a ROM path and optional verification mode.");
globalThis.fetch = (async (value: URL | RequestInfo) => {
  const target = value instanceof Request ? value.url : String(value);
  const url = target.startsWith("/src/assets/") ? new URL(`../..${target}`, import.meta.url) : new URL(target);
  if (url.protocol !== "file:") throw Error("Only local fixtures are supported.");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const load = (bytes: Uint8Array) => loadProjectFromRomBytes(bytes, "frostbite-snow.nds", {
  selectedNarcs: ["personal", "items", "message_texts", "moves", "move_animations", "move_spas"],
});
let project = await load(new Uint8Array(await readFile(path)));
if (mode.startsWith("modern")) {
  const frostFirst = mode !== "modern-reverse";
  const combined = mode !== "modern-only" && mode !== "modern-thaw-move";
  const withRecipes = mode === "modern-recipes" || mode === "modern-reverse";
  const addAbilities = async () => {
    await configureAbilityRuleSets(project, [
      { abilityId: 165, name: "Corrosion", rules: abilityImport(212).rule },
      { abilityId: 166, name: "Poison Puppetr", rules: abilityImport(310).rule },
      { abilityId: 167, name: "Status Guard", rules: {
        effects: [{ kind: "abilityRecipe:damageGuard", value: 1, parameters: { sources: 3 } }],
        conditions: { kind: "group", mode: "all", children: [] },
      } },
    ]);
  };
  if (mode === "modern-conflict") {
    await installFrostbiteSnowPatch(project, "frostbite");
    const source = new NintendoDSRom(project.originalRomBytes!, { fileData: "view" });
    const conflict = buildModernStatusModule(project, source, true);
    conflict.relocations = conflict.relocations.filter(site => conflict.symbols[site.sourceSymbolIndex]?.name === "ModernElectricTail");
    assert.equal(conflict.relocations.length, 1);
    stageCodeInjectionDll(project, "ConflictingStatus.dll", writeRpm(conflict, { ident: "DLXF" }));
    const before = project.fileSystem;
    await assert.rejects(installFrostbiteSnowPatch(project, "modern_status"), /conflicting battle hook/u);
    assert.equal(project.fileSystem, before);
    console.log("Conflicting modern status hook rejected atomically");
    process.exit(0);
  }
  const patches = !combined ? ["modern_status"] as const
    : frostFirst ? ["frostbite", "modern_status"] as const : ["modern_status", "frostbite"] as const;
  let legacyDamageText: number | undefined;
  let legacyText: Uint8Array[] | undefined;
  if (mode === "modern-upgrade") {
    await installFrostbiteSnowPatch(project, "frostbite");
    const legacy = parseRpm(project.fileSystem!.additions!["patches/Frostbite.dll"], { allowedMagics: ["DLXF"] });
    legacy.metadata.PokewebFrostbiteSnowVersion = 2;
    legacyDamageText = Number(legacy.metadata.PokewebFrostbiteDamageText);
    stageCodeInjectionDll(project, "Frostbite.dll", writeRpm(legacy, { ident: "DLXF" }));
    project = await load(await exportModifiedRom(project));
    legacyText = project.narcs.message_texts!.rawFiles;
  }
  if (withRecipes && frostFirst) await addAbilities();
  for (const patch of patches) {
    if (legacyText && patch === "frostbite") continue;
    assert.equal(await installFrostbiteSnowPatch(project, patch), true);
  }
  if (mode === "modern-thaw-move") {
    const rule = { effects: [newMoveEffect("thawTargets")], conditions: MOVE_ALWAYS, prerequisites: MOVE_ALWAYS };
    await configureMoveRuleSets(project, [{ moveId: 503, rules: rule }]);
  }
  if (withRecipes) {
    if (!frostFirst) await addAbilities();
    await installFrostbiteSnowPatch(project, "snow");
    await configureMoveRuleSets(project, [{ moveId: 33, rules: {
      effects: [newMoveEffect("damageWeather")], conditions: MOVE_ALWAYS, prerequisites: MOVE_ALWAYS,
    } }]);
    await configureItemRuleSets(project, [{ itemId: 238, rules: {
      effects: [{ kind: "attack", value: 1.25 }], conditions: { kind: "group", mode: "all", children: [] }, consumable: false,
    } }]);
  }
  const exportAndReopen = await load(await exportModifiedRom(project));
  if (mode === "modern-thaw-move") assert.equal(inspectMoveEffects(exportAndReopen).rules.size, 1);
  const exported = await exportModifiedRom(exportAndReopen);
  const rom = new NintendoDSRom(exported, { fileData: "view" });
  const parsed = (file: string) => parseRpm(rom.files[rom.fileId(`patches/${file}.dll`)], { allowedMagics: ["DLXF"] });
  const modern = parsed("ModernStatus");
  assert.equal(modern.metadata.PokewebCombinedStatus, Number(combined));
  const owns = (rpm: typeof modern, name: string) =>
    rpm.relocations.some(r => r.target.module !== "base" && rpm.symbols[r.sourceSymbolIndex]?.name === name);
  for (const name of ["ModernNaturalThawSite", "ModernScaldThawSite", "FrostbiteDamageSite"])
    assert.equal(owns(modern, name), !combined);
  if (combined) {
    const frostbite = parsed("Frostbite");
    assert.ok(owns(frostbite, "FrostbiteDamageSite"));
    assert.equal(frostbite.metadata.PokewebCombinedStatus, 1);
    assert.equal(frostbiteSnowLabel(exportAndReopen, "Chance to freeze"), "Chance for frostbite");
    if (legacyText) {
      assert.equal(frostbite.metadata.PokewebFrostbiteDamageText, legacyDamageText);
      assert.deepEqual(exportAndReopen.narcs.message_texts!.rawFiles, legacyText);
    }
  }
  for (const patch of patches) {
    assert.deepEqual(frostbiteSnowStatus(exportAndReopen, patch), { supported: true, installed: true, updateAvailable: false });
    assert.equal(await installFrostbiteSnowPatch(exportAndReopen, patch), false);
  }
  if (withRecipes) {
    assert.equal(inspectAbilityEffects(exportAndReopen).rules.size, 3);
    assert.equal(inspectMoveEffects(exportAndReopen).rules.size, 1);
    assert.equal(inspectItemEffect(exportAndReopen, 238).rules?.effects[0].value, 1.25);
  }
  console.log(project.session.baseVersion, mode, "export, reload and re-export passed");
  process.exit(0);
}
if (mode === "conflict") {
  await installBundledPmc(project);
  const rom = new NintendoDSRom(project.originalRomBytes!, { fileData: "view" });
  const peer = buildFrostbiteSnowModule(project, "frostbite", rom);
  const client = project.session.baseRom === "BW" ? "94" : "168";
  peer.relocations = peer.relocations.filter(relocation => relocation.target.module === client);
  assert.equal(peer.relocations.length, 1);
  stageCodeInjectionDll(project, "Conflict.dll", writeRpm(peer, { ident: "DLXF" }));
  const before = project.fileSystem;
  await assert.rejects(installFrostbiteSnowPatch(project, "frostbite"), /conflicting battle hook/u);
  assert.equal(project.fileSystem, before);
  assert.equal(frostbiteSnowStatus(project, "frostbite").installed, false);
  const [hook] = peer.relocations;
  const overlayId = Number(hook.target.module), overlay = rom.loadArm9Overlays([overlayId]).get(overlayId)!;
  project.overlays[overlayId] = overlay.data.slice();
  project.overlays[overlayId][hook.target.address - overlay.ramAddress - 2] ^= 0x80;
  await assert.rejects(installFrostbiteSnowPatch(project, "frostbite"), /Unrecognized battle code/u);
  console.log("Battle sprite hook and byte conflicts rejected before publishing");
  process.exit(0);
}
if (mode === "upgrade") {
  await installFrostbiteSnowPatch(project, "frostbite");
  const path = "patches/Frostbite.dll";
  const client = project.session.baseRom === "BW" ? "94" : "168";
  const v1 = parseRpm(project.fileSystem!.additions![path], { allowedMagics: ["DLXF"] });
  v1.relocations = v1.relocations.filter(relocation => relocation.target.module !== client);
  v1.metadata.PokewebFrostbiteSnowVersion = 1;
  stageCodeInjectionDll(project, "Frostbite.dll", writeRpm(v1, { ident: "DLXF" }));
  const legacy = await load(await exportModifiedRom(project));
  assert.equal(frostbiteSnowStatus(legacy, "frostbite").updateAvailable, true);
  assert.equal(await installFrostbiteSnowPatch(legacy, "frostbite"), true);
  const exported = await exportModifiedRom(legacy);
  const upgraded = await load(exported);
  assert.equal(frostbiteSnowStatus(upgraded, "frostbite").updateAvailable, false);
  assert.equal(await installFrostbiteSnowPatch(upgraded, "frostbite"), false);
  assert.deepEqual(upgraded.narcs.message_texts!.rawFiles, legacy.narcs.message_texts!.rawFiles);
  const rom = new NintendoDSRom(exported, { fileData: "view" });
  const v2 = parseRpm(rom.files[rom.fileId(path)], { allowedMagics: ["DLXF"] });
  assert.equal(v2.metadata.PokewebFrostbiteDamageText, v1.metadata.PokewebFrostbiteDamageText);
  const sprite = v2.relocations.find(relocation => relocation.target.module === client)!;
  assert.equal(sprite.target.type, "FULL_COPY");
  const payload = v2.symbols[sprite.sourceSymbolIndex];
  assert.deepEqual(v2.code.slice(payload.address, payload.address + payload.size), Uint8Array.of(3, 0x22));
  console.log(project.session.baseVersion, "Frostbite v1 upgraded in place and round-tripped");
  process.exit(0);
}
const patches: FrostbiteSnowPatch[] = mode === "frostbite" || mode === "snow" ? [mode]
  : mode === "reverse" ? ["snow", "frostbite"] : ["frostbite", "snow"];
const beforeMove = project.narcs.moves!.rawFiles[258].slice();
if (mode === "recipes") {
  await configureAbilityRuleSets(project, [{ abilityId: 165, name: "Mega Hail", rules: abilityImport(1003).rule }]);
  await configureMoveRuleSets(project, [{ moveId: 33, rules: {
    effects: [newMoveEffect("damageWeather")], conditions: MOVE_ALWAYS, prerequisites: MOVE_ALWAYS,
  } }]);
}
for (const patch of patches) {
  assert.equal(await installFrostbiteSnowPatch(project, patch), true);
  assert.equal(await installFrostbiteSnowPatch(project, patch), false);
}
if (mode === "recipes")
  await configureItemRuleSets(project, [{ itemId: 238, rules: {
    effects: [{ kind: "attack", value: 1.25 }], conditions: { kind: "group", mode: "all", children: [] }, consumable: false,
  } }]);
const bytes = await exportModifiedRom(project);
const reopened = await load(bytes);
for (const patch of patches) {
  assert.deepEqual(frostbiteSnowStatus(reopened, patch), { supported: true, installed: true, updateAvailable: false });
  assert.equal(await installFrostbiteSnowPatch(reopened, patch), false);
}
assert.deepEqual(reopened.narcs.moves!.rawFiles[258], beforeMove);
if (patches.includes("snow")) {
  assert.equal(getMoveTextInfo(reopened, 258)?.title, "Snowscape");
  assert.deepEqual(reopened.narcs.move_animations!.rawFiles[258], project.narcs.move_animations!.rawFiles[258]);
  assert.equal(reopened.narcs.move_spas!.fileCount, project.narcs.move_spas!.fileCount);
  const particles = getMoveAnimationParticleIds(decompileMoveAnimation(reopened, 258));
  assert.equal(particles.length, 1);
  assert.ok(reopened.narcs.move_spas!.rawFiles[particles[0]]?.length);
  assert.equal(frostbiteSnowLabel(reopened, "Hail"), "Snow");
}
if (patches.includes("frostbite")) {
  assert.equal(frostbiteSnowLabel(reopened, "Freeze"), "Frostbite");
  assert.equal(getTextBank(reopened, "message_texts", reopened.session.baseRom === "BW" ? 14 : 18)
    .filter(row => row[1].includes("is hurt\\nby frostbite!")).length, 3);
  const uiPath = project.session.baseRom === "BW" ? "a/0/8/3" : "a/0/8/2";
  const before = new NintendoDSRom(project.originalRomBytes!, { fileData: "view" });
  const after = new NintendoDSRom(bytes, { fileData: "view" });
  const stock = new NARC(before.files[before.fileId(uiPath)]).files[12];
  const patched = new NARC(after.files[after.fileId(uiPath)]).files[12];
  assert.notDeepEqual(patched.subarray(304, 432), stock.subarray(304, 432));
  assert.deepEqual(patched.subarray(0, 304), stock.subarray(0, 304));
  assert.deepEqual(patched.subarray(432), stock.subarray(432));
}
if (mode === "recipes") {
  assert.equal(inspectAbilityEffects(reopened).rules.size, 1);
  assert.equal(inspectMoveEffects(reopened).rules.size, 1);
  assert.equal(inspectItemEffect(reopened, 238).rules?.effects[0].value, 1.25);
}
console.log(project.session.baseVersion, mode, "export, reopen and reinstall passed");
