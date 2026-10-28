import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import profiles from "../src/assets/data/itemEffectProfiles.json";
import { readU16, readU32 } from "../src/nds/binary";
import { decompressCode } from "../src/nds/codeCompression";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { getNarcFormats } from "../src/pokeweb/formats";
import { assignItemEffect, buildItemTypeHealingModule, configureItemTypeHealing, hydrateItemEffectsSource, inspectItemEffect, updateItemEffectControl } from "../src/pokeweb/itemEffectsModel";
import { getItemRecord } from "../src/pokeweb/moveItemModel";
import { detectPmcInstallFromRom, getPmcInstallStatus, installPmcBytes } from "../src/pokeweb/pmcModel";
import { createProjectDocument } from "../src/pokeweb/projectDocument";
import { openProjectSession } from "../src/pokeweb/projectSession";
import { createNarcStore, type ProjectState } from "../src/pokeweb/projectStore";
import { updateRpmCodeImageForBase } from "../src/pokeweb/rpm";

const path = process.argv[2], evidenceDir = process.argv[3];
if (!path) throw new Error("Usage: vite-node scripts/verify-item-effects.ts ROM.nds [evidence-directory]");
const input = new Uint8Array(await readFile(path));
const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const inputHash = hash(input);
function load(bytes: Uint8Array): ProjectState {
  const rom = new NintendoDSRom(bytes, { fileData: "view" });
  assert.ok(["IRDO", "IREO"].includes(rom.idCode));
  const id = rom.fileId("a/0/2/4");
  const project = {
    originalRomBytes: bytes, session: { baseRom: "BW2", baseVersion: rom.idCode === "IRDO" ? "W2" : "B2", romName: "Item verification", fairy: true, fileIds: {}, blacklist: [] },
    romInfo: { idCode: rom.idCode, title: rom.name, fileName: "local.nds", size: bytes.length },
    arm9: decompressCode(rom.arm9), overlays: { 167: rom.loadArm9Overlays([167]).get(167)!.data },
    narcs: { items: createNarcStore("items", "a/0/2/4", id, new NARC(rom.files[id])) },
    texts: { banks: { items: Array.from({ length: 639 }, (_, id) => profiles.rows.find(row => row.id === id)?.label ?? `Item ${id}`) } },
    formats: getNarcFormats("BW2"), trpokInfo: [], codeInjection: detectPmcInstallFromRom(rom),
  } as ProjectState;
  hydrateItemEffectsSource(project, rom);
  return project;
}
const project = load(input);
const original = project.overlays[167]!.slice();
const inspected = profiles.rows.map(row => inspectItemEffect(project, row.id));
for (const id of [220, 234, 238, 281]) assert.equal(inspectItemEffect(project, id).editable, true, `Required handler ${id} must be recognized`);
const unavailable = profiles.rows.filter((_, n) => !inspected[n].editable).map(row => row.id);
const choiceEvents = inspectItemEffect(project, 220).events;
assignItemEffect(project, 238, 234);
assert.equal(inspectItemEffect(project, 238).profileId, 234);
updateItemEffectControl(project, 234, "healingDivisor", 8);
updateItemEffectControl(project, 220, "multiplier", 1.75);
assert.deepEqual(inspectItemEffect(project, 220).events, choiceEvents);
const directBytes = await exportModifiedRom(project, { forDsi: false });
const direct = load(directBytes);
assert.equal(inspectItemEffect(direct, 238).profileId, 234);
assert.equal(inspectItemEffect(direct, 234).controls[0].value, 8);
assert.equal(inspectItemEffect(direct, 220).controls[0].value, 1.75);
const directDiff = [...original.keys()].filter(at => original[at] !== direct.overlays[167]![at]);
assert.ok(directDiff.length > 0 && directDiff.length <= 8, "Direct edits must change only the assignment and numeric operands");
const sludge = inspectItemEffect(project, 281);
const nativeModule = buildItemTypeHealingModule(project, 238, 5);
nativeModule.baseAddress = 0x022f0000;
updateRpmCodeImageForBase(nativeModule);
if (!getPmcInstallStatus(project).installed) {
  const file = project.session.baseVersion === "W2" ? "PMC_W2.rpm" : "PMC_B2.rpm";
  installPmcBytes(project, new Uint8Array(await readFile(new URL(`../src/assets/codeinjection/${file}`, import.meta.url))), input);
}
await configureItemTypeHealing(project, 238, 5, 16);
assert.equal(inspectItemEffect(project, 238).typeHealing, 5);
assert.equal(getItemRecord(project, 238).raw.gain_values, 16);
assert.deepEqual(inspectItemEffect(project, 281), sludge);
// Exercise a durable project document, then the real ROM writer, then reopen it.
const restored = openProjectSession(createProjectDocument(project, false));
restored.originalRomBytes = input;
hydrateItemEffectsSource(restored, new NintendoDSRom(input, { fileData: "view" }));
assert.equal(inspectItemEffect(restored, 238).typeHealing, 5);
const typedBytes = await exportModifiedRom(restored, { forDsi: false });
const typed = load(typedBytes);
assert.equal(inspectItemEffect(typed, 238).typeHealing, 5);
assert.equal(getItemRecord(typed, 238).raw.gain_values, 16);
assert.equal(inspectItemEffect(typed, 220).controls[0].value, 1.75);
assignItemEffect(typed, 238, 238);
assert.equal(inspectItemEffect(typed, 238).typeHealing, undefined);
const reset = load(await exportModifiedRom(typed, { forDsi: false }));
assert.equal(inspectItemEffect(reset, 238).profileId, 238);
assert.equal(inspectItemEffect(reset, 238).typeHealing, undefined);
assert.equal(hash(input), inputHash, "The input ROM must remain unchanged");
const rom = new NintendoDSRom(input, { fileData: "view" });
const base = rom.loadArm9Overlays([167]).get(167)!.ramAddress;
const calls: Record<string, number> = {};
for (const [id, profileId] of [[234, 234], [220, 220], [281, 281]]) {
  const state = inspectItemEffect(direct, id), profile = profiles.rows.find(row => row.id === profileId)!;
  profile.events.forEach((event, n) => {
    const signature = profiles.functions[event.handler as keyof typeof profiles.functions];
    for (const call of signature.calls) {
      const address = (state.events[n].address & ~1) + call.offset, at = address - base;
      const high = readU16(direct.overlays[167]!, at), low = readU16(direct.overlays[167]!, at + 2);
      let delta = (high & 0x7ff) << 12 | (low & 0x7ff) << 1;
      if (delta & 0x400000) delta -= 0x800000;
      const service = call.target || (event.handler === "HandlerChoiceBandPower" && call.offset === 0x1a ? "PML_MoveGetCategory" : "");
      if (service) calls[service] = address + 4 + delta;
    }
  });
}
const report = { game: rom.idCode, inputSha256: inputHash, overlayBase: base, recognizedSlots: inspected.filter(state => state.editable).length, unavailable,
  directChangedBytes: directDiff.length, assignmentExportReload: true, parametersExportReload: true,
  typedHealingExportReload: true, typedHealingRemovalExportReload: true, inputUnchanged: true,
  native: { base, calls, leftovers: inspectItemEffect(direct, 234).events[1].address, choiceBand: inspectItemEffect(direct, 220).events[2].address,
    typeHealing: nativeModule.baseAddress + 32 + 20 + 1, factory: nativeModule.baseAddress + 32 + 1, moduleBase: nativeModule.baseAddress + 32 } };
if (evidenceDir) {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(`${evidenceDir}/report.json`, JSON.stringify(report, null, 2));
  await writeFile(`${evidenceDir}/overlay.bin`, direct.overlays[167]!);
  await writeFile(`${evidenceDir}/type-healing.bin`, nativeModule.code);
}
console.log(JSON.stringify(report, null, 2));
