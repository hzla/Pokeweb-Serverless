import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
import expansionData from "../src/assets/data/white2upgradeMoveExpansion.json";
import { NARC } from "../src/nds/narc";
import { decompileMoveAnimationBytes, parseMoveAnimationScript } from "../src/pokeweb/moveAnimationModel";

const FIRST_GEN6_MOVE_ID = 560;
const LAST_GEN6_MOVE_ID = 621;
const FIRST_BW2_ONLY_SPA_ID = 733;
const SPA_COMMANDS = new Set([
  "LoadSPA",
  "DoSPAAnimation",
  "DoSPAScreenAnimation",
  "DoSPAAnimation2",
  "DoSPAAllAnimations",
  "DeleteSPA",
  "DoSPAProjectileAnimation",
  "DoSPAProjectileAnimation2",
  "DoSPAProjectileAnimation3",
  "DoSPAProjectileAnimationOrthoCoordinate",
  "DoSPACircleAnimation",
  "DoSPAOrthoCircleAnimation",
]);

type BundleMove = {
  sourceMoveId: number;
  targetMoveId: number;
  animation: string;
  particleIds: number[];
  calledAnimationIds: number[];
  sha256: string;
};

type BundleParticle = {
  sourceParticleId: number;
  particle: string;
  sha256: string;
};

async function main(): Promise<void> {
  const source = path.resolve(process.argv[2] ?? path.resolve(import.meta.dirname, "../../../White2Upgrade-Original-pokeweb"));
  const output = path.resolve(
    process.argv[3] ?? path.resolve(import.meta.dirname, "../src/assets/data/white2upgradeGen6MoveAnimations.zip"),
  );
  const prerequisiteArchivePath = path.resolve(
    process.argv[4] ?? path.join(source, "build-stripped/black2upgrade-expanded-files/a/0/0/6"),
  );
  let prerequisiteArchive: NARC | undefined;
  const moveTargetBySource = new Map(
    expansionData.moves.map((move, index) => [move.sourceId, expansionData.firstTargetMoveId + index] as const),
  );
  const entries: Record<string, Uint8Array> = {};
  const moves: BundleMove[] = [];
  const referencedParticleIds = new Set<number>();

  for (let sourceMoveId = FIRST_GEN6_MOVE_ID; sourceMoveId <= LAST_GEN6_MOVE_ID; sourceMoveId += 1) {
    const targetMoveId = moveTargetBySource.get(sourceMoveId);
    if (targetMoveId === undefined) throw new Error(`Move ${sourceMoveId} is missing from the move-expansion data asset.`);
    const sourcePath = path.join(
      source,
      "data/graphics/move_animations",
      `5_${sourceMoveId.toString().padStart(8, "0")}.bin`,
    );
    const bytes = new Uint8Array(await readFile(sourcePath));
    const parsed = parseMoveAnimationScript(decompileMoveAnimationBytes(bytes));
    const commands = [...parsed.scripts.values()].flat();
    const particleIds = uniqueSorted(
      commands.filter((command) => SPA_COMMANDS.has(command.name)).map((command) => command.params[0] ?? 0),
    );
    const calledAnimationIds = uniqueSorted(
      commands.filter((command) => command.name === "CallMoveAnimation").map((command) => command.params[0] ?? 0),
    );
    particleIds.filter((particleId) => particleId >= FIRST_BW2_ONLY_SPA_ID).forEach((particleId) => referencedParticleIds.add(particleId));
    const archivePath = `move_animations/${sourceMoveId}.bin`;
    entries[archivePath] = bytes;
    moves.push({ sourceMoveId, targetMoveId, animation: archivePath, particleIds, calledAnimationIds, sha256: sha256(bytes) });
  }

  const particles: BundleParticle[] = [];
  for (const sourceParticleId of uniqueSorted(referencedParticleIds)) {
    const sourcePath = path.join(
      source,
      "data/graphics/move_spas",
      `6_${sourceParticleId.toString().padStart(8, "0")}.bin`,
    );
    let bytes: Uint8Array | undefined;
    try {
      bytes = new Uint8Array(await readFile(sourcePath));
    } catch {
      prerequisiteArchive ??= new NARC(new Uint8Array(await readFile(prerequisiteArchivePath)));
      bytes = prerequisiteArchive.files[sourceParticleId]?.slice();
    }
    if (!bytes) {
      throw new Error(
        `Move animations reference particle ${sourceParticleId}, but it is missing from both ${sourcePath} and ${prerequisiteArchivePath}.`,
      );
    }
    const archivePath = `move_spas/${sourceParticleId}.bin`;
    entries[archivePath] = bytes;
    particles.push({ sourceParticleId, particle: archivePath, sha256: sha256(bytes) });
  }

  const manifest = {
    format: "pokeweb-move-expansion-animations",
    version: 1,
    source: "White2Upgrade-Original-pokeweb/data/graphics/move_animations and move_spas, plus BW2 prerequisite particles",
    generation: 6,
    moves,
    particles,
  };
  entries["manifest.json"] = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(output, zipSync(entries, { level: 9, mtime: new Date("1980-01-02T00:00:00Z") }));
  console.log(`Wrote ${moves.length} Gen 6 animations and ${particles.length} prerequisite particle files to ${output}`);
  console.log(`Custom particle IDs: ${particles.map((particle) => particle.sourceParticleId).join(", ") || "none"}`);
}

function uniqueSorted(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

await main();
