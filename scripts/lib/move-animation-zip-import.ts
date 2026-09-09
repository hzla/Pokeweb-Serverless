import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import {
  compileMoveAnimation,
  decompileMoveAnimationBytes,
  parseMoveAnimationScript,
} from "../../src/pokeweb/moveAnimationModel";
import { parseSpaArchive } from "../../src/pokeweb/nitroSpa";
import type { ProjectState } from "../../src/pokeweb/projectStore";
import type { MoveAnimationManifest } from "./move-animation-tooling";

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

export type MoveAnimationZipSpa = {
  id: number;
  archivePath: string;
  bytes: Uint8Array;
  sha256: string;
};

export type MoveAnimationZipBundle = {
  moveId: number;
  animationArchivePath: string;
  animation: Uint8Array;
  animationSha256: string;
  script: string;
  loadSpas: number[];
  backgrounds: number[];
  calledAnimations: number[];
  spas: MoveAnimationZipSpa[];
  ignoredEntries: string[];
};

type ImportedMoveAnimationMetadata = {
  version: 1;
  format: "pokeweb-move-animation-zip-import";
  sourceArchive: { name: string; sha256: string };
  moveId: number;
  animation: { path: string; outputScript: string; sha256: string };
  spas: Array<{ id: number; path: string; output: string; sha256: string }>;
};

export function inspectMoveAnimationZip(
  zipBytes: Uint8Array,
  requestedMoveId?: number,
): MoveAnimationZipBundle {
  if (zipBytes.length > MAX_ARCHIVE_BYTES) throw new Error(`Animation zip exceeds ${MAX_ARCHIVE_BYTES} bytes.`);
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(zipBytes);
  } catch (error) {
    throw new Error(`Could not read animation zip: ${error instanceof Error ? error.message : String(error)}`);
  }

  const files = Object.entries(archive).filter(([name]) => !normalizedArchivePath(name).endsWith("/"));
  const expandedBytes = files.reduce((total, [, bytes]) => total + bytes.length, 0);
  if (expandedBytes > MAX_ARCHIVE_BYTES) throw new Error(`Expanded animation zip exceeds ${MAX_ARCHIVE_BYTES} bytes.`);

  const animationCandidates: Array<{ moveId: number; archivePath: string; bytes: Uint8Array }> = [];
  const spas = new Map<number, MoveAnimationZipSpa>();
  const ignoredEntries: string[] = [];

  for (const [rawName, bytes] of files) {
    const archivePath = normalizedArchivePath(rawName);
    const name = path.posix.basename(archivePath);
    if (archivePath.startsWith("__MACOSX/") || name === ".DS_Store") continue;

    const animationMatch = /^(?:move_(\d+)_animation|5_(\d{8}))\.bin$/iu.exec(name);
    if (animationMatch) {
      animationCandidates.push({
        moveId: parseId(animationMatch[1] ?? animationMatch[2] ?? "", name),
        archivePath,
        bytes,
      });
      continue;
    }

    const spaMatch = /^(?:spa_(\d+)\.spa|6_(\d{8})\.bin)$/iu.exec(name);
    if (spaMatch) {
      const id = parseId(spaMatch[1] ?? spaMatch[2] ?? "", name);
      if (spas.has(id)) throw new Error(`Animation zip contains more than one SPA for ID ${id}.`);
      parseSpaArchive(bytes);
      spas.set(id, { id, archivePath, bytes, sha256: sha256(bytes) });
      continue;
    }

    if (/\.(?:bin|spa)$/iu.test(name)) throw new Error(`Unrecognized binary asset name in animation zip: ${archivePath}`);
    ignoredEntries.push(archivePath);
  }

  if (animationCandidates.length !== 1) {
    throw new Error(`Animation zip must contain exactly one move_<id>_animation.bin or 5_<id>.bin; found ${animationCandidates.length}.`);
  }
  const candidate = animationCandidates[0]!;
  if (requestedMoveId !== undefined && requestedMoveId !== candidate.moveId) {
    throw new Error(`Requested move ${requestedMoveId}, but the animation filename identifies move ${candidate.moveId}.`);
  }

  const script = decompileMoveAnimationBytes(candidate.bytes);
  const roundTrip = compileMoveAnimation({} as ProjectState, candidate.moveId, script);
  if (!bytesEqual(roundTrip, candidate.bytes)) {
    throw new Error(`Move ${candidate.moveId} is not byte-stable after decompile/compile.`);
  }

  const dependencies = scriptDependencies(script);
  const suppliedSpaIds = [...spas.keys()].sort((left, right) => left - right);
  const missingSpas = dependencies.loadSpas.filter((id) => !spas.has(id));
  const unusedSpas = suppliedSpaIds.filter((id) => !dependencies.loadSpas.includes(id));
  if (missingSpas.length) throw new Error(`Animation zip is missing referenced SPA file(s): ${missingSpas.join(", ")}.`);
  if (unusedSpas.length) throw new Error(`Animation zip contains SPA file(s) not loaded by the script: ${unusedSpas.join(", ")}.`);

  return {
    moveId: candidate.moveId,
    animationArchivePath: candidate.archivePath,
    animation: candidate.bytes,
    animationSha256: sha256(candidate.bytes),
    script,
    loadSpas: dependencies.loadSpas,
    backgrounds: dependencies.backgrounds,
    calledAnimations: dependencies.calledAnimations,
    spas: suppliedSpaIds.map((id) => spas.get(id)!),
    ignoredEntries,
  };
}

export async function writeMoveAnimationZipWorkspace(options: {
  bundle: MoveAnimationZipBundle;
  outDir: string;
  slug: string;
  sourceArchiveName: string;
  sourceArchiveSha256: string;
  generatorImportPath: string;
}): Promise<string> {
  validateSlug(options.slug);
  try {
    await access(options.outDir);
    throw new Error(`Import workspace already exists: ${options.outDir}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const importedDir = path.join(options.outDir, "imported");
  const generatedDir = path.join(options.outDir, "generated");
  await mkdir(importedDir, { recursive: true });
  await mkdir(generatedDir, { recursive: true });

  const movePadded = options.bundle.moveId.toString().padStart(8, "0");
  const scriptName = `5_${movePadded}_${options.slug.replaceAll("-", "_")}.s`;
  const animationInput = `imported/move_${options.bundle.moveId}_animation.bin`;
  await writeFile(path.join(options.outDir, animationInput), options.bundle.animation);

  const metadata: ImportedMoveAnimationMetadata = {
    version: 1,
    format: "pokeweb-move-animation-zip-import",
    sourceArchive: { name: path.basename(options.sourceArchiveName), sha256: options.sourceArchiveSha256 },
    moveId: options.bundle.moveId,
    animation: {
      path: animationInput,
      outputScript: `generated/${scriptName}`,
      sha256: options.bundle.animationSha256,
    },
    spas: options.bundle.spas.map((spa) => ({
      id: spa.id,
      path: `imported/spa_${spa.id}.spa`,
      output: `generated/6_${spa.id.toString().padStart(8, "0")}.bin`,
      sha256: spa.sha256,
    })),
  };
  for (const [index, spa] of options.bundle.spas.entries()) {
    await writeFile(path.join(options.outDir, metadata.spas[index]!.path), spa.bytes);
  }

  const generatorName = `make-${options.slug}.ts`;
  await writeFile(
    path.join(options.outDir, generatorName),
    `import { generateImportedMoveAnimationAssets } from ${JSON.stringify(options.generatorImportPath)};\n\nawait generateImportedMoveAnimationAssets(import.meta.dirname);\n`,
  );
  await writeFile(path.join(options.outDir, "import.json"), `${JSON.stringify(metadata, null, 2)}\n`);

  const manifest: MoveAnimationManifest = {
    version: 1,
    moveId: options.bundle.moveId,
    slug: options.slug,
    donorMoveIds: [],
    reservedSpaIds: options.bundle.loadSpas,
    generator: generatorName,
    script: `generated/${scriptName}`,
    animation: `generated/5_${movePadded}.bin`,
    spas: metadata.spas.map((spa) => spa.output),
    expect: {
      loadSpas: options.bundle.loadSpas,
      backgrounds: options.bundle.backgrounds,
      forbidSpas: [],
      text: options.bundle.loadSpas.map((id) => `LoadSPA ${id}`),
      maxLoadedSpas: options.bundle.loadSpas.length,
    },
  };
  const manifestPath = path.join(options.outDir, "moveanim.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(options.outDir, "README.md"), importedReadme(options.bundle, options.slug, metadata.sourceArchive.name));
  return manifestPath;
}

export async function generateImportedMoveAnimationAssets(workDir: string): Promise<void> {
  const metadataPath = path.join(workDir, "import.json");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as ImportedMoveAnimationMetadata;
  if (metadata.version !== 1 || metadata.format !== "pokeweb-move-animation-zip-import") {
    throw new Error(`${metadataPath} is not a supported move-animation zip import manifest.`);
  }

  const animation = new Uint8Array(await readFile(path.join(workDir, metadata.animation.path)));
  assertSha256(animation, metadata.animation.sha256, "imported animation");
  const script = decompileMoveAnimationBytes(animation);
  const roundTrip = compileMoveAnimation({} as ProjectState, metadata.moveId, script);
  if (!bytesEqual(roundTrip, animation)) {
    throw new Error(`Imported move ${metadata.moveId} is not byte-stable after decompile/compile.`);
  }

  await mkdir(path.join(workDir, "generated"), { recursive: true });
  await writeFile(path.join(workDir, metadata.animation.outputScript), script);
  for (const spa of metadata.spas) {
    const bytes = new Uint8Array(await readFile(path.join(workDir, spa.path)));
    assertSha256(bytes, spa.sha256, `imported SPA ${spa.id}`);
    parseSpaArchive(bytes);
    await writeFile(path.join(workDir, spa.output), bytes);
  }
  console.log(`Generated move ${metadata.moveId} and ${metadata.spas.length} SPA file(s) from verified imported assets.`);
}

function scriptDependencies(script: string): { loadSpas: number[]; backgrounds: number[]; calledAnimations: number[] } {
  const parsed = parseMoveAnimationScript(script);
  const loadSpas = new Set<number>();
  const backgrounds = new Set<number>();
  const calledAnimations = new Set<number>();
  for (const commands of parsed.scripts.values()) {
    for (const command of commands) {
      if (command.name === "LoadSPA") loadSpas.add(command.params[0] ?? -1);
      else if (command.name === "LoadBackground") backgrounds.add(command.params[0] ?? -1);
      else if (command.name === "CallMoveAnimation") calledAnimations.add(command.params[0] ?? -1);
    }
  }
  return {
    loadSpas: [...loadSpas].filter((id) => id >= 0).sort((left, right) => left - right),
    backgrounds: [...backgrounds].filter((id) => id >= 0).sort((left, right) => left - right),
    calledAnimations: [...calledAnimations].filter((id) => id >= 0).sort((left, right) => left - right),
  };
}

function importedReadme(bundle: MoveAnimationZipBundle, slug: string, sourceArchiveName: string): string {
  const spaLines = bundle.spas.length
    ? bundle.spas.map((spa) => `- SPA ${spa.id}: \`${spa.sha256}\``).join("\n")
    : "- No SPA files";
  return `# ${slug}\n\nActive generator workspace for move ${bundle.moveId}. The generator and its hash-verified imported inputs are the source of truth until finalization.\n\n## Source\n\n- Archive: \`${sourceArchiveName}\`\n- Animation: \`${bundle.animationSha256}\`\n${spaLines}\n\nThe importer treats non-binary archive documents as inert metadata and never executes their contents.\n`;
}

function validateSlug(slug: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) throw new Error(`Invalid slug: ${slug}`);
}

function parseId(value: string, name: string): number {
  const id = Number.parseInt(value, 10);
  if (!Number.isInteger(id) || id < 0) throw new Error(`Invalid numeric ID in ${name}.`);
  return id;
}

function normalizedArchivePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertSha256(bytes: Uint8Array, expected: string, label: string): void {
  const actual = sha256(bytes);
  if (actual !== expected) throw new Error(`${label} SHA-256 changed: expected ${expected}, got ${actual}`);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
