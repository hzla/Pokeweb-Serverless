/** Export the audited bundle fixes into the native materializer's existing repair format. */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, stat, realpath } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import { optimizeMoveExpansionAssets } from "../src/pokeweb/moveExpansionAssetOptimization";
import { decompileMoveAnimationBytes, getMoveAnimationParticleIds, parseMoveAnimationScript, remapMoveAnimationParticleIds } from "../src/pokeweb/moveAnimationModel";
import { getGen5BattleSpaWorkspaceBytes } from "../src/pokeweb/nitroSpa";

type Move = { sourceMoveId: number; targetMoveId: number; animation: string; particleIds: number[] };
type Particle = { sourceParticleId: number; particle: string };
type Bundle = { moves: Move[]; particles: Particle[]; credits: unknown[] };
type Repair = { archive: string; member: number; sourcePath: string; sha256: string; replacesSha256: string | null; provenance: object };
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  if (at < 0 || !args[at + 1]) throw new Error(`Missing ${name}. Required: --source --catalog --prior-repairs --out`);
  return path.resolve(args[at + 1]);
};
const source = await realpath(option("--source")), catalogPath = option("--catalog"), prior = await realpath(option("--prior-repairs"));
const requestedOutput = option("--out"), output = path.join(await realpath(path.dirname(requestedOutput)), path.basename(requestedOutput));
const readWithin = async (root: string, relative: string) => {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/u).some(part => part === "..")) throw new Error("Unsafe repair input path.");
  const file = await realpath(path.join(root, relative));
  if (!file.startsWith(root + path.sep)) throw new Error("Repair input escapes its source root.");
  return new Uint8Array(await readFile(file));
};
for (const root of [source, prior, path.resolve(import.meta.dirname, "..")]) {
  const relative = path.relative(root, output);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) throw new Error("Output must be outside source inputs and the checkout.");
}
if (await stat(output).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; })) throw new Error("Output already exists.");
const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as { sourcePins: Record<string, string>; overrides: { archive: string; member: number; provenance?: { project?: string } }[] };
const bundleBytes = new Uint8Array(await readFile(new URL("../src/assets/data/white2upgradeGen6MoveAnimations.zip", import.meta.url)));
const bundled = unzipSync(bundleBytes), bundle = JSON.parse(new TextDecoder().decode(bundled["manifest.json"])) as Bundle;
const memoryEntries = unzipSync(new Uint8Array(await readFile(new URL("../src/test/fixtures/move-expansion/oversize-source-animations.zip", import.meta.url))));
const memory = JSON.parse(new TextDecoder().decode(memoryEntries["manifest.json"])) as Bundle;
const shakeEntries = unzipSync(new Uint8Array(await readFile(new URL("../src/test/fixtures/move-expansion/overlapping-shake-scripts.zip", import.meta.url))));
const shakes = JSON.parse(new TextDecoder().decode(shakeEntries["manifest.json"])) as Bundle;
const bytes = new Map<string, Uint8Array>();
const previous = JSON.parse(await readFile(path.join(prior, "manifest.json"), "utf8")) as { schemaVersion: number; repairs: Repair[] };
if (previous.schemaVersion !== 1) throw new Error("Unknown prior repair schema.");
const repairs: Repair[] = [];
for (const row of previous.repairs) {
  if (path.isAbsolute(row.sourcePath) || row.sourcePath.split(/[\\/]/u).some(part => part === "..")) throw new Error("Unsafe prior repair path.");
  const data = await readWithin(prior, row.sourcePath);
  if (sha(data) !== row.sha256) throw new Error("Prior repair hash differs.");
  bytes.set(row.sourcePath, data); repairs.push(row);
}
const readOwned = async (archive: string, member: number) => {
  const relative = `data/graphics/${archive === "a/0/6/5" ? "move_animations/5" : "move_spas/6"}_${String(member).padStart(8, "0")}.bin`;
  const data = await readWithin(source, relative);
  if (sha(data) !== catalog.sourcePins[relative]) throw new Error(`Native source pin differs: ${relative}`);
  return data;
};
const provenance = { project: "Pokeweb bundled move animations", bundleSha256: sha(bundleBytes),
  memoryFixCommit: "43fb2ee3394a877db6c3ec32abb8ccaba187f13a", shakeFixCommit: "3a98884f089b44e3a8cc6a886a7b25e75d959669", credits: bundle.credits };
const add = (archive: string, member: number, data: Uint8Array, original: Uint8Array | null, detail: object = {}) => {
  if (original !== null && sha(data) === sha(original)) return;
  if (repairs.some(row => row.archive === archive && row.member === member)) throw new Error(`Repair ownership collision ${archive}/${member}`);
  const sourcePath = `bundle-${archive === "a/0/6/5" ? "move" : "spa"}-${member}.bin`;
  bytes.set(sourcePath, data);
  repairs.push({ archive, member, sourcePath, sha256: sha(data), replacesSha256: original === null ? null : sha(original), provenance: { ...provenance, ...detail } });
};
const last = Math.max(...catalog.overrides.filter(row => row.archive === "a/0/0/6" && row.provenance?.project !== "Pokeweb bundled move animations").map(row => row.member));
const terrainIds = new Map([1031, 1032, 1033, 1034].map((id, index) => [id, last + 1 + index]));
if (last >= 65531) throw new Error("No particle-ID space for the terrain banks.");
const remapTerrain = (move: Move, data: Uint8Array) => {
  if (move.sourceMoveId !== 805) return data;
  const parsed = parseMoveAnimationScript(decompileMoveAnimationBytes(data));
  // The shared codec covers all particle opcodes, not only loads/spawns.
  // Native scripts using the old bank numbers remain untouched.
  const fixed = remapMoveAnimationParticleIds(data, terrainIds).bytes;
  const script = decompileMoveAnimationBytes(fixed);
  if (parsed.count !== 5) throw new Error("Terrain Pulse variant layout differs.");
  const expected = getMoveAnimationParticleIds(decompileMoveAnimationBytes(data)).map(id => terrainIds.get(id) ?? id).sort((a, b) => a - b);
  const actual = getMoveAnimationParticleIds(script).sort((a, b) => a - b);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Terrain bank remapping differs: ${JSON.stringify({ expected, actual, loads: script.split("\n").filter(line => line.includes("LoadSPA")) })}`);
  return fixed;
};
const selected = new Set(memory.moves.map(row => row.sourceMoveId));
for (const old of shakes.moves) {
  const current = bundle.moves.find(row => row.sourceMoveId === old.sourceMoveId);
  if (!current) throw new Error("Bundle move disappeared.");
  if (sha(shakeEntries[old.animation]) !== sha(bundled[current.animation])) selected.add(old.sourceMoveId);
}
let nativePyro: ReturnType<typeof optimizeMoveExpansionAssets> | undefined;
for (const move of bundle.moves.filter(row => selected.has(row.sourceMoveId))) {
  const original = await readOwned("a/0/6/5", move.sourceMoveId);
  let fixed = bundled[move.animation];
  if (move.sourceMoveId === 780) {
    const particle = await readOwned("a/0/0/6", 960);
    nativePyro = optimizeMoveExpansionAssets({ moves: [{ ...move, particleIds: [960], bytes: original }], particles: [{ sourceParticleId: 960, bytes: particle }] }, { nativePyro: true });
    fixed = nativePyro.moves[0].bytes;
  } else {
    const candidates = [memory, shakes].flatMap((input, i) => {
      const row = input.moves.find(row => row.sourceMoveId === move.sourceMoveId);
      return row ? [sha((i === 0 ? memoryEntries : shakeEntries)[row.animation])] : [];
    });
    if (!candidates.includes(sha(original))) throw new Error(`Native move ${move.sourceMoveId} has distinct repairs; review before replacing it.`);
  }
  fixed = remapTerrain(move, fixed);
  add("a/0/6/5", move.sourceMoveId, fixed, original, { sourceMoveId: move.sourceMoveId,
    ...(move.sourceMoveId === 805 ? { particleRemaps: Object.fromEntries(terrainIds) } : {}),
    ...(move.sourceMoveId === 780 ? { nativePolicy: "Preserve faster native timing and both additional impact emitters" } : {}) });
}
for (const row of memory.particles) {
  const original = await readOwned("a/0/0/6", row.sourceParticleId);
  if (row.sourceParticleId !== 960 && sha(original) !== sha(memoryEntries[row.particle])) throw new Error(`Native SPA ${row.sourceParticleId} differs from the reviewed source.`);
  const current = bundle.particles.find(p => p.sourceParticleId === row.sourceParticleId);
  if (!current) throw new Error("Missing optimized particle.");
  const fixed = row.sourceParticleId === 960 ? nativePyro!.particles[0].bytes : bundled[current.particle];
  const limit = row.sourceParticleId === 960 ? 0x6000 : 0x4800;
  if (getGen5BattleSpaWorkspaceBytes(fixed) > limit) throw new Error("Particle still exceeds its workspace.");
  add("a/0/0/6", row.sourceParticleId, fixed, original);
}
for (const [oldId, newId] of terrainIds) {
  const row = bundle.particles.find(p => p.sourceParticleId === oldId);
  if (!row) throw new Error("Missing split terrain bank.");
  add("a/0/0/6", newId, bundled[row.particle], null, { sourceParticleId: oldId });
}
await mkdir(output);
for (const [name, data] of bytes) await writeFile(path.join(output, name), data, { flag: "wx" });
await writeFile(path.join(output, "manifest.json"), JSON.stringify({ schemaVersion: 1, repairs }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ selectedMoves: selected.size, repairedMoves: repairs.filter(row => row.sourcePath.startsWith("bundle-move-")).length, optimizedParticles: memory.particles.length,
  terrainIds: Object.fromEntries(terrainIds), bundleSha256: sha(bundleBytes), nativePyro: nativePyro?.report }, null, 2));
