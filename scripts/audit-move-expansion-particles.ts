import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import expansion from "../src/assets/data/white2upgradeMoveExpansion.json";
import { decompileMoveAnimationBytes, getMoveAnimationParticleIds } from "../src/pokeweb/moveAnimationModel";
import { getMoveExpansionParticleWorkspaceBytes, MOVE_EXPANSION_PARTICLE_WORKSPACE_BYTES, parseMoveExpansionAnimationBundle } from "../src/pokeweb/moveExpansionPatch";
import { parseSpaArchive } from "../src/pokeweb/nitroSpa";

const args = process.argv.slice(2);
const outputIndex = args.indexOf("--out");
if (outputIndex < 0 || !args[outputIndex + 1]) throw new Error("Usage: vite-node scripts/audit-move-expansion-particles.ts --out /external/path/audit.json");
const output = path.resolve(args[outputIndex + 1]);
const repo = path.resolve(import.meta.dirname, "..");
if (output.startsWith(`${repo}${path.sep}`) && !output.startsWith(path.join(repo, "work") + path.sep)) {
  throw new Error("Write diagnostics outside the repository or under ignored work/.");
}
const bytes = new Uint8Array(await readFile(new URL("../src/assets/data/white2upgradeGen6MoveAnimations.zip", import.meta.url)));
const bundle = parseMoveExpansionAnimationBundle(bytes);
const names = new Map(expansion.moves.map(move => [move.sourceId, move.name]));
const particles = bundle.particles.map(particle => {
  const spa = parseSpaArchive(particle.bytes);
  const requiredBytes = getMoveExpansionParticleWorkspaceBytes(particle.bytes);
  return {
    sourceParticleId: particle.sourceParticleId,
    sha256: createHash("sha256").update(particle.bytes).digest("hex"),
    resourceCount: spa.resources.length,
    behaviorCount: spa.resources.reduce((sum, resource) => sum + resource.behaviors.length, 0),
    textureCount: spa.textures.length,
    requiredBytes,
    retailOverflowBytes: Math.max(0, requiredBytes - 0x4800),
    workspaceHeadroomBytes: MOVE_EXPANSION_PARTICLE_WORKSPACE_BYTES - requiredBytes,
  };
});
const byId = new Map(particles.map(particle => [particle.sourceParticleId, particle]));
const moves = bundle.moves.map(move => {
  // Inspect every script variant and branch, independently of manifest lists.
  const particleIds = getMoveAnimationParticleIds(decompileMoveAnimationBytes(move.bytes)).sort((a, b) => a - b);
  if (JSON.stringify(particleIds) !== JSON.stringify([...move.particleIds].sort((a, b) => a - b))) {
    throw new Error(`Move ${move.targetMoveId} particle commands disagree with its manifest.`);
  }
  for (const id of particleIds) if (!byId.has(id)) throw new Error(`Move ${move.targetMoveId} is missing SPA ${id}.`);
  const overflowingParticleIds = particleIds.filter(id => byId.get(id)!.retailOverflowBytes > 0);
  return {
    sourceMoveId: move.sourceMoveId, targetMoveId: move.targetMoveId, name: names.get(move.sourceMoveId),
    particleIds, overflowingParticleIds,
    largestWorkspaceBytes: Math.max(0, ...particleIds.map(id => byId.get(id)!.requiredBytes)),
  };
});
const overflowingParticles = particles.filter(particle => particle.retailOverflowBytes > 0).map(particle => ({
  ...particle,
  moves: moves.filter(move => move.particleIds.includes(particle.sourceParticleId)).map(({ sourceMoveId, targetMoveId, name }) => ({ sourceMoveId, targetMoveId, name })),
}));
const report = {
  format: "pokeweb-move-expansion-particle-audit", version: 2,
  bundleSha256: createHash("sha256").update(bytes).digest("hex"),
  method: "Static inspection of every packaged script variant and referenced SPA; no emulator execution.",
  allocation: { managerBytes: 0x4c, emitterCapacity: 24, emitterBytes: 0x9c, particleCapacity: 200, particleBytes: 0x44, resourceBytes: 0x20, behaviorBytes: 8, textureBytes: 0x14, workspaceBytes: MOVE_EXPANSION_PARTICLE_WORKSPACE_BYTES },
  limitations: "Covers native particle-workspace allocation, not visual fidelity, sound design, timing, emitter/particle exhaustion, texture VRAM capacity, other engine limits, or arbitrary custom ROM changes.",
  summary: { moves: moves.length, particles: particles.length, retailOverflowParticles: overflowingParticles.length, retailOverflowMoves: moves.filter(move => move.overflowingParticleIds.length > 0).length, largestWorkspaceBytes: Math.max(...particles.map(particle => particle.requiredBytes)), minimumHeadroomBytes: Math.min(...particles.map(particle => particle.workspaceHeadroomBytes)) },
  overflowingParticles, moves, particles,
};
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report.summary, output }, null, 2));
