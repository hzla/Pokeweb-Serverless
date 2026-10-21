import fs from "node:fs";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { createCameraRectangle, decodeCameraRegions, encodeCameraRegions, loadFieldCamera, saveFieldCamera, readFieldCameraBindings } from "../src/pokeweb/fieldCameraModel";
import { loadMap3dPlayerSprite } from "../src/pokeweb/map3dModel";
import { FIELD_CAMERA_LOOKUP_ADDRESS } from "../src/pokeweb/fieldCameraLookup";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
const sourcePath = process.argv[2];
if (!sourcePath) throw new Error("Usage: npx vite-node scripts/verify-field-camera.ts SOURCE.nds [OUTPUT.nds]");
const project = await loadProjectFromRomBytes(fs.readFileSync(sourcePath), "camera-verification.nds", { selectedNarcs: ["headers"] });
const source = new NintendoDSRom(project.originalRomBytes!, { fileData: "view" });
const archive = new NARC(source.getFileByName("a/1/5/6"));
for (const [i, member] of archive.files.entries()) {
  if (Buffer.compare(member, encodeCameraRegions(decodeCameraRegions(member)))) throw new Error(`Member ${i} round trip failed.`);
}
const bindings = readFieldCameraBindings(project.arm9!, source.arm9RamAddress);
console.log(`Lossless camera members: ${archive.files.length}; native bindings: ${bindings.length}`);
for (const b of bindings) {
  const doc = await loadFieldCamera(project, b.zoneId);
  console.log(JSON.stringify({ zone: b.zoneId, preset: doc.presetId, regions: doc.regions.length, shared: doc.sharedZones, boundaries: doc.boundaries }));
}
const doc = await loadFieldCamera(project, 561), regions = structuredClone(doc.regions);
const first = regions[0]; if (first.kind !== "rectangle") throw new Error("Expected native rectangle.");
const beforeArm = project.arm9!.slice();
first.start.pitch += 1; saveFieldCamera(project, doc, regions);
const armDiffs = project.arm9!.reduce<number[]>((out, n, i) => { if (n !== beforeArm[i]) out.push(i); return out; }, []);
if (!armDiffs.length || armDiffs.some(i => i < doc.bindingOffset! || i >= doc.bindingOffset! + 2)) throw new Error("Camera isolation changed unrelated ARM9 bytes.");
const newDoc = await loadFieldCamera(project, 370);
if (newDoc.memberId !== undefined) throw new Error("Expected Route 13 to have no native binding.");
const newRegion = { ...createCameraRectangle(newDoc.preset, 10, 20), start: { ...newDoc.preset, pitch: 22 }, end: { ...newDoc.preset, pitch: 22 } };
saveFieldCamera(project, newDoc, [newRegion]);
if (newDoc.layout.kind !== "indexed") throw new Error("Camera archive was not expanded.");
for (const gender of ["male", "female"] as const) {
  const player = loadMap3dPlayerSprite(project, source, gender);
  if (!player || Object.values(player.framesByDirection).some(frames => !frames?.[0].rgba.some(n => n))) throw new Error(`${gender} player billboard did not decode.`);
  if (process.env.CAMERA_VERIFY_ARTIFACTS) {
    fs.mkdirSync(process.env.CAMERA_VERIFY_ARTIFACTS, { recursive: true });
    for (const [direction, frames] of Object.entries(player.framesByDirection)) {
      const frame = frames![0], png = new PNG({ width: frame.width * 5, height: frame.height * 5 });
      for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
        const pixel = (Math.floor(y / 5) * frame.width + Math.floor(x / 5)) * 4;
        png.data.set(frame.rgba.subarray(pixel, pixel + 4), (y * png.width + x) * 4);
      }
      fs.writeFileSync(`${process.env.CAMERA_VERIFY_ARTIFACTS}/player-${gender}-${direction}.png`, PNG.sync.write(png));
      console.log(`Player ${gender} ${direction}: ${frame.name}`);
    }
  }
}
const expandedArm = project.arm9!.slice();
const exported = await exportModifiedRom(project, { preserveOriginalLength: false });
const result = new NintendoDSRom(exported, { fileData: "view" });
const reloaded = await loadProjectFromRomBytes(exported, "camera-result.nds", { selectedNarcs: ["headers"] });
const created = await loadFieldCamera(reloaded, 370);
if (created.regions.length !== 1 || Math.abs((created.regions[0] as typeof newRegion).start.pitch - 22) > 0.006) throw new Error("New zone camera did not survive export/reload.");
const after = await loadFieldCamera(reloaded, 561), sibling = await loadFieldCamera(reloaded, 564);
if (after.memberId === sibling.memberId || Math.abs((after.regions[0] as typeof first).start.pitch - first.start.pitch) > 0.006) throw new Error("Edited camera did not survive export/reload.");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const changed: string[] = [];
for (let id = 0; id < source.files.length; id++) if (hash(source.files[id]) !== hash(result.files[id])) changed.push(String(id));
const expected = String(source.fileId("a/1/5/6"));
const resultingArchive = new NARC(result.getFileByName("a/1/5/6"));
for (let i = 0; i < archive.files.length; i++) if (hash(archive.files[i]) !== hash(resultingArchive.files[i])) throw new Error(`Original camera member ${i} changed during isolation.`);
if (changed.join(",") !== expected) throw new Error(`Unrelated NitroFS files changed: ${changed}`);
if (hash(archive.files[7]) !== hash(encodeCameraRegions(sibling.regions))) throw new Error("Shared sibling camera changed.");
const at = FIELD_CAMERA_LOOKUP_ADDRESS - source.arm9RamAddress;
const prefix = newDoc.layout.firstZoneMember;
if (after.memberId! < prefix || sibling.memberId! < prefix) throw new Error("Native bindings were not migrated.");
const artifactDir = process.env.CAMERA_VERIFY_ARTIFACTS;
if (artifactDir) {
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(`${artifactDir}/expanded-arm9.bin`, expandedArm);
  fs.writeFileSync(`${artifactDir}/member-lengths.json`, JSON.stringify(resultingArchive.files.map(f => f.length)));
}
console.log(`Previously unbound zone 370 exported and reloaded; ${resultingArchive.files.length - prefix} zone slots; 48-byte native selector at 0x${(at + source.arm9RamAddress).toString(16)}.`);
console.log(`Export/reload passed; edited zone isolated; only NitroFS file ${expected} changed.`);
if (process.argv[3]) fs.writeFileSync(process.argv[3], exported);
