import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readU16 } from "../src/nds/binary";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { syncEncountersToDexHabitats } from "../src/pokeweb/encounterModel";
import { getNarcFormats } from "../src/pokeweb/formats";
import { materializeProjectEdits } from "../src/pokeweb/projectMaterialize";
import { createNarcStore, type ProjectState } from "../src/pokeweb/projectStore";

// Verify against physical encounter bytes, independently of the editor decoder.
function expectedFlags(files: Uint8Array[], pools: number[]): Map<number, number[]> {
  const flags = new Map<number, number[]>();
  for (const pool of pools) {
    const bytes = files[pool];
    for (let season = 0; season < 4; season += 1) {
      const base = bytes.length === 232 ? 0 : season * 232;
      let offset = base + 8;
      [12, 12, 12, 5, 5, 5, 5].forEach((count, kind) => {
        for (let slot = 0; slot < count; slot += 1) {
          const species = readU16(bytes, offset + slot * 4) % 2048;
          if (species && bytes[base + kind]) {
            const entry = flags.get(species) ?? Array<number>(12).fill(0);
            entry[season * 3 + (kind < 3 ? 0 : kind < 5 ? 1 : 2)] = 1;
            flags.set(species, entry);
          }
        }
        offset += count * 4;
      });
    }
  }
  return new Map([...flags].sort(([a], [b]) => a - b));
}

const args = process.argv.slice(2);
if (!(args.length === 1 || args.length === 3 && args[1] === "--output")) {
  throw new Error("Usage: vite-node scripts/verify-habitat-sync.ts ROM.nds [--output NEW.nds]");
}
const [input, , output] = args;
if (output && resolve(output) === resolve(input)) throw new Error("Output must not replace the input ROM.");
const bytes = new Uint8Array(await readFile(input));
const originalHash = createHash("sha256").update(bytes).digest("hex");
const rom = new NintendoDSRom(bytes, { fileData: "view" });
if (!/^(IRE|IRD)[A-Z]$/u.test(rom.idCode)) throw new Error("A BW2 ROM is required.");
const encounterId = rom.fileId("a/1/2/7"), habitatId = rom.fileId("a/2/9/6");
const encounters = new NARC(rom.files[encounterId]), habitats = new NARC(rom.files[habitatId]);
const originalHabitatFiles = habitats.files.map(file => file.slice());
const project: ProjectState = {
  session: { romName: "verification", baseVersion: rom.idCode.startsWith("IRE") ? "B2" : "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
  romInfo: { title: rom.name, idCode: rom.idCode, fileName: "verification.nds", size: bytes.length },
  arm9: new Uint8Array(), overlays: {}, trpokInfo: [], texts: { banks: {} }, formats: getNarcFormats("BW2"),
  narcs: {
    encounters: createNarcStore("encounters", "a/1/2/7", encounterId, encounters),
    habitats: createNarcStore("habitats", "a/2/9/6", habitatId, habitats),
  },
};
const result = await syncEncountersToDexHabitats(project);
materializeProjectEdits(project);
habitats.files = project.narcs.habitats!.rawFiles;
const synced = habitats.save();
const reloaded = new NARC(synced);
const members = (file: Uint8Array) => new Map(Array.from({ length: readU16(file, 8) }, (_, i) =>
  [readU16(file, 10 + i * 28), [...file.slice(12 + i * 28, 24 + i * 28)]] as const).sort(([a], [b]) => a - b));
const changed = reloaded.files.flatMap((file, id) => {
  const count = readU16(file, 8);
  assert.ok(count <= 30 && file.length === 10 + count * 28, `Invalid habitat ${id} size`);
  const entries = members(file);
  assert.equal(entries.size, count, `Duplicate species in habitat ${id}`);
  assert.ok(!entries.has(0), `Empty species in habitat ${id}`);
  for (let method = 0; method < 3; method += 1) {
    const seasonal = [...entries.values()].some(flags => [1, 2, 3].some(season => flags[season * 3 + method] !== flags[method]));
    const present = [...entries.values()].some(flags => [0, 1, 2, 3].some(season => flags[season * 3 + method] !== 0));
    assert.equal(file[method], Number(seasonal));
    assert.equal(file[method + 3], Number(present));
  }
  const original = originalHabitatFiles[id];
  return isDeepStrictEqual(members(original), entries) && isDeepStrictEqual(original.slice(0, 8), file.slice(0, 8)) ? [] : [id];
});
console.log(`Habitat content/header changes: ${changed.length} of ${reloaded.files.length}${changed.length ? ` (${changed.join(", ")})` : ""}.`);
for (const [id, pools] of [[0, [104, 105]], [8, [125]], [9, [106]], [41, [10, 11]], [46, [117]], [52, [2]]] as const) {
  const file = reloaded.files[id];
  const actual = members(file);
  assert.deepEqual(actual, expectedFlags(encounters.files, [...pools]), `Habitat ${id} must use encounter pools ${pools.join(", ")}`);
  console.log(`Habitat ${id}: pools ${pools.join(", ")}, ${actual.size} species, header ${[...file.slice(0, 6)].join(" ")}`);
}
await syncEncountersToDexHabitats(project);
assert.deepEqual(habitats.save(), synced, "Sync must be idempotent");
assert.equal(project.narcs.encounters!.dirty.size, 0);
if (output) {
  const exported = rom.save({ files: new Map([[habitatId, synced]]), allowDamagedDsi: true,
    onWarning: warning => console.warn(warning), preserveOriginalLength: true });
  const loaded = new NintendoDSRom(exported, { fileData: "view" });
  assert.equal(loaded.files.length, rom.files.length);
  for (let id = 0; id < rom.files.length; id += 1) {
    assert.deepEqual(loaded.files[id], id === habitatId ? synced : rom.files[id], `Unexpected changes in file ${id}`);
  }
  assert.deepEqual(loaded.arm9, rom.arm9);
  assert.deepEqual(loaded.arm7, rom.arm7);
  assert.deepEqual(loaded.arm9OverlayTable, rom.arm9OverlayTable);
  assert.deepEqual(loaded.arm7OverlayTable, rom.arm7OverlayTable);
  await writeFile(output, exported, { flag: "wx" });
  console.log("Wrote a separate ROM; only the habitat archive payload changed.");
}
assert.equal(createHash("sha256").update(await readFile(input)).digest("hex"), originalHash);
console.log(`Verified ${result.habitats} habitats, ${result.species} species entries; original ROM unchanged.`);
