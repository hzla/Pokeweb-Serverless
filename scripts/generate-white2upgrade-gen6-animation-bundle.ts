import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
import expansionData from "../src/assets/data/white2upgradeMoveExpansion.json";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { decompileMoveAnimationBytes, parseMoveAnimationScript } from "../src/pokeweb/moveAnimationModel";

const FIRST_GEN6_MOVE_ID = 560;
const LAST_GEN6_MOVE_ID = 621;
const FIRST_GEN7_MOVE_ID = 622;
const LAST_GEN7_MOVE_ID = 742;
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
  backgroundIds: number[];
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
  const donorPath = path.resolve(process.argv[5] ?? path.resolve(import.meta.dirname, "../../cleanblack2.nds"));
  const donorBytes = new Uint8Array(await readFile(donorPath));
  const donor = new NintendoDSRom(donorBytes, { fileData: "view" });
  const donorGameCode = new TextDecoder().decode(donorBytes.slice(12, 16));
  if (!/^IR[DE]/u.test(donorGameCode)) throw new Error("Animation dependencies must come from a Black 2 or White 2 ROM.");
  const donorParticles = new NARC(donor.files[donor.fileId("a/0/0/6")]);
  const donorBackgrounds = new NARC(donor.files[donor.fileId("a/0/9/4")]);
  const moveTargetBySource = new Map(
    expansionData.moves.map((move, index) => [move.sourceId, expansionData.firstTargetMoveId + index] as const),
  );
  const animationDirectory = path.join(source, "data/graphics/move_animations");
  const stagedAnimationIds = new Set(
    (await readdir(animationDirectory))
      .map((name) => /^5_0*(\d+)\.bin$/u.exec(name)?.[1])
      .filter((value): value is string => value !== undefined)
      .map(Number),
  );
  const sourceMoveIds = [
    ...integerRange(FIRST_GEN6_MOVE_ID, LAST_GEN6_MOVE_ID),
    ...integerRange(FIRST_GEN7_MOVE_ID, LAST_GEN7_MOVE_ID).filter(
      (moveId) => stagedAnimationIds.has(moveId) && moveTargetBySource.has(moveId),
    ),
  ];
  const entries: Record<string, Uint8Array> = {};
  const moves: BundleMove[] = [];
  const referencedParticleIds = new Set<number>();
  const referencedBackgroundIds = new Set<number>();

  for (const sourceMoveId of sourceMoveIds) {
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
    const unsupported = commands.find((command) => ["CallMoveAnimation", "SetObject", "SetObjectAnimation", "SetTrainer"].includes(command.name));
    if (unsupported) throw new Error(`Move ${sourceMoveId} uses ${unsupported.name}; bundle its external dependencies before shipping it.`);
    const backgroundIds = uniqueSorted(commands.filter((command) => command.name === "LoadBackground").map((command) => command.params[0]));
    particleIds.forEach((particleId) => referencedParticleIds.add(particleId));
    backgroundIds.forEach((backgroundId) => referencedBackgroundIds.add(backgroundId));
    const archivePath = `move_animations/${sourceMoveId}.bin`;
    entries[archivePath] = bytes;
    moves.push({ sourceMoveId, targetMoveId, animation: archivePath, particleIds, backgroundIds, calledAnimationIds, sha256: sha256(bytes) });
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
      bytes = donorParticles.files[sourceParticleId]?.slice();
      if (!bytes) {
        prerequisiteArchive ??= new NARC(new Uint8Array(await readFile(prerequisiteArchivePath)));
        bytes = prerequisiteArchive.files[sourceParticleId]?.slice();
      }
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

  const backgrounds = uniqueSorted(referencedBackgroundIds).map((sourceBackgroundId) => {
    const files = [0, 1, 2].map((part) => {
      const id = sourceBackgroundId + part;
      const bytes = donorBackgrounds.files[id];
      if (!bytes) throw new Error(`BW2 donor is missing background file ${id}.`);
      const path = `move_backgrounds/${id}.bin`;
      entries[path] = bytes;
      return path;
    });
    return { sourceBackgroundId, files, sha256: files.map((path) => sha256(entries[path])) };
  });

  const manifest = {
    format: "pokeweb-move-expansion-animations",
    version: 3,
    source: "White2Upgrade-Original-pokeweb/data/graphics/move_animations and move_spas, plus BW2 particle and background dependencies",
    donor: { gameCode: donorGameCode, sha256: sha256(donorBytes), particles: "a/0/0/6", backgrounds: "a/0/9/4" },
    generations: [6, 7],
    moves,
    particles,
    backgrounds,
  };
  entries["manifest.json"] = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(output, zipSync(entries, { level: 9, mtime: new Date("1980-01-02T00:00:00Z") }));
  const gen6Count = moves.filter((move) => move.sourceMoveId <= LAST_GEN6_MOVE_ID).length;
  const gen7Count = moves.filter((move) => move.sourceMoveId >= FIRST_GEN7_MOVE_ID).length;
  console.log(`Wrote ${gen6Count} Gen 6 and ${gen7Count} Gen 7 animations with ${particles.length} particle files and ${backgrounds.length} background triplets to ${output}`);
}

function uniqueSorted(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function integerRange(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

await main();
