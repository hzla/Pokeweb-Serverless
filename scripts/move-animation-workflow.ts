import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, copyFile, cp, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { analyzeMoveAnimationScript } from "../src/pokeweb/moveAnimationDiagnostics";
import { detectMoveExpansionPatch } from "../src/pokeweb/moveExpansionPatch";
import { compileMoveAnimation, decompileMoveAnimationBytes, getMoveAnimationTargetInfo, parseMoveAnimationScript, remapMoveAnimationParticleIds } from "../src/pokeweb/moveAnimationModel";
import { buildMoveAnimationPreview, loadMoveBackground, loadMoveSpaArchive } from "../src/pokeweb/moveAnimationPreviewModel";
import {
  analyzeMoveAnimationSegments,
  composeMoveAnimationSegments,
  extractMoveAnimationSegment,
  type MoveAnimationPhaseName,
} from "../src/pokeweb/moveAnimationSegments";
import { parseSpaArchive, type SpaArchive } from "../src/pokeweb/nitroSpa";
import type { ProjectState } from "../src/pokeweb/projectStore";
import {
  configOverrideHelp,
  pathKind,
  resolveMoveAnimationWorkflowConfig,
  writableParent,
  type ResolvedMoveAnimationWorkflowConfig,
} from "./lib/move-animation-workflow-config";
import {
  diffSpaArchives,
  hasW2uMoveAnimationRoutingSignature,
  hashFile,
  inspectSpaArchive,
  lintMoveAnimationScript,
  readMoveAnimationManifest,
  scriptTextFromBytesOrText,
  sha256,
  spaIdFromPath,
  type MoveAnimationFileHash,
  type MoveAnimationFinishRecord,
  type MoveAnimationLintReport,
  type MoveAnimationManifest,
  type ResolvedMoveAnimationManifest,
} from "./lib/move-animation-tooling";
import {
  inspectDonorAssets,
  indexMoveEntriesByLogicalId,
  loadDonorRom,
  readMoveAnimationReferenceIndex,
  searchMoveAnimationDonors,
  type DonorAssetInspection,
  type MoveAnimationReferenceEntry,
} from "./lib/move-animation-donors";
import { generateMoveAnimationSnapshots } from "./lib/move-animation-snapshots";

const MOVE_ANIMATION_NARC = "a/0/6/5";
const MOVE_SPA_NARC = "a/0/0/6";
const FIRST_EXPANDED_MOVE_ID = 676;
const SERVERLESS_ROOT = path.resolve(import.meta.dirname, "..");
const MOVE_ANIMATION_REFERENCE = path.join(SERVERLESS_ROOT, "move-animation-reference/move-animation-reference.json");
const FINISH_PHASES = ["generate", "compile", "lint", "stage", "build", "verify", "copy"] as const;

type FinishPhase = (typeof FINISH_PHASES)[number];

type ParsedArgs = {
  command?: string;
  options: Map<string, string[]>;
};

type StageTarget = "mirror" | "build";

type BuiltAssets = {
  romPath: string;
  romSha256: string;
  animationBytes: Uint8Array;
  spaBytes: Map<number, Uint8Array>;
  script: string;
  loadSpas: number[];
  backgrounds: number[];
  calledAnimations: number[];
  logicalTarget: {
    storeName: "move_animations" | "battle_animations";
    sourcePath: string;
    index: number;
    white2UpgradeLayout: boolean;
  };
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || args.options.has("help") || args.options.has("h")) {
    printHelp();
    return;
  }
  const config = await resolveConfig(args);
  switch (args.command) {
    case "brief":
      briefCommand();
      return;
    case "doctor":
      await doctorCommand(config);
      return;
    case "next-spa":
      await nextSpaCommand(args, config);
      return;
    case "find-donor":
      await findDonorCommand(args, config);
      return;
    case "start":
      await startCommand(args, config);
      return;
    case "segments":
      await segmentsCommand(args);
      return;
    case "extract-segment":
      await extractSegmentCommand(args);
      return;
    case "compose":
      await composeCommand(args);
      return;
    case "snapshots":
      await snapshotsCommand(args, config);
      return;
    case "stage":
      await stageCommand(args, config);
      return;
    case "verify-built":
      await verifyBuiltCommand(args, config);
      return;
    case "inspect-script":
      await inspectScriptCommand(args);
      return;
    case "inspect-spa":
      await inspectSpaCommand(args);
      return;
    case "diff-spa":
      await diffSpaCommand(args);
      return;
    case "lint":
      await lintCommand(args, config);
      return;
    case "finish":
      await finishCommand(args, config);
      return;
    case "finalize":
      await finalizeCommand(args, config);
      return;
    case "reopen":
      await reopenCommand(args, config);
      return;
    case "scaffold":
      await scaffoldCommand(args, config);
      return;
    default:
      throw new Error(`Unknown command: ${args.command}`);
  }
}

function briefCommand(): void {
  console.log(`
Move animation workflow quick brief

Core rules
- Visible battle animation belongs in VM move scripts and SPA assets, not C/C++.
- W2U Gen 6+ overrides live in White2Upgrade/data/graphics/move_animations and move_spas.
- Use work/<slug>/ generators as source of truth while active; staged W2U binaries become authoritative after finalization.
- Donor recolors must inspect resource color, texture pixels, child color, alpha, scale, color curves, delay, and behavior.
- Camera target preset is selector 11; target Pokemon sprite is selector 16.

Start here
- npm run moveanim:workflow -- doctor
- npm run moveanim:workflow -- inspect-script --file <animation.bin|script.s>
- npm run moveanim:workflow -- inspect-spa --file <spa.bin>
- npm run moveanim:workflow -- lint --manifest ../work/<slug>/moveanim.json
- npm run moveanim:workflow -- finish --manifest ../work/<slug>/moveanim.json
`.trim());
}

async function doctorCommand(config: ResolvedMoveAnimationWorkflowConfig): Promise<void> {
  console.log(`Move animation workflow configuration (${config.configPath})`);
  for (const key of ["buildRepo", "mirrorRepo", "cleanRom", "outputRom", "java"] as const) {
    console.log(`  ${key}: ${config.values[key]} [${config.sources[key]}]`);
  }

  const checks: Array<{ label: string; ok: boolean; detail: string; required: boolean }> = [];
  const checkDirectory = async (label: string, value: string, required = true) => {
    const ok = (await pathKind(value)) === "directory";
    checks.push({ label, ok, detail: value, required });
  };
  const checkFile = async (label: string, value: string, required = true) => {
    const ok = (await pathKind(value)) === "file";
    checks.push({ label, ok, detail: value, required });
  };
  await checkDirectory("build repository", config.values.buildRepo);
  await checkDirectory("mirror repository", config.values.mirrorRepo);
  await checkDirectory("build animation staging", animationStageDir(config.values.buildRepo));
  await checkDirectory("build SPA staging", spaStageDir(config.values.buildRepo));
  await checkDirectory("mirror animation staging", animationStageDir(config.values.mirrorRepo));
  await checkDirectory("mirror SPA staging", spaStageDir(config.values.mirrorRepo));
  await checkFile("clean ROM", config.values.cleanRom);
  await checkFile("built ROM", builtRomPath(config), false);
  const outputParent = await writableParent(config.values.outputRom);
  checks.push({ label: "output ROM destination", ok: outputParent !== undefined, detail: outputParent ? `${config.values.outputRom} (writable via ${outputParent})` : config.values.outputRom, required: true });

  const java = await runCapture(config.values.java, ["-version"]);
  checks.push({ label: "Java", ok: java.code === 0, detail: java.output.split("\n").find(Boolean) ?? config.values.java, required: true });
  const ninja = await runCapture("ninja", ["--version"]);
  checks.push({ label: "Ninja", ok: ninja.code === 0, detail: ninja.output.split("\n").find(Boolean) ?? "ninja", required: true });

  if ((await pathKind(config.values.cleanRom)) === "file") {
    try {
      const rom = new NintendoDSRom(new Uint8Array(await readFile(config.values.cleanRom)));
      rom.getFileByName(MOVE_ANIMATION_NARC);
      rom.getFileByName(MOVE_SPA_NARC);
      checks.push({ label: "clean ROM archives", ok: true, detail: `${MOVE_ANIMATION_NARC}, ${MOVE_SPA_NARC}`, required: true });
    } catch (error) {
      checks.push({ label: "clean ROM archives", ok: false, detail: error instanceof Error ? error.message : String(error), required: true });
    }
  }

  for (const check of checks) console.log(`${check.ok ? "PASS" : check.required ? "FAIL" : "WARN"}  ${check.label}: ${check.detail}`);
  const failures = checks.filter((check) => check.required && !check.ok);
  if (failures.length) throw new Error(`${failures.length} required doctor check(s) failed. ${configOverrideHelp(config.configPath)}`);
}

async function nextSpaCommand(args: ParsedArgs, config: ResolvedMoveAnimationWorkflowConfig): Promise<void> {
  const repos = values(args, "repo").length ? values(args, "repo").map((value) => path.resolve(value)) : [config.values.mirrorRepo, config.values.buildRepo];
  const allIds = new Set<number>();
  const scanned: Array<{ dir: string; max: number }> = [];
  try {
    for (const repo of repos) {
      const dir = spaStageDir(repo);
      const ids = await listedIds(dir, /^6_0*(\d+)\.bin$/u);
      ids.forEach((id) => allIds.add(id));
      scanned.push({ dir, max: Math.max(...ids) });
    }
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)} ${configOverrideHelp(config.configPath)}`);
  }
  const ids = [...allIds].sort((a, b) => a - b);
  const max = Math.max(...ids);
  console.log("Move SPA dirs:");
  for (const entry of scanned) console.log(`  ${entry.dir} (max ${entry.max})`);
  console.log(`Highest SPA override: ${max}`);
  console.log(`Next append-style SPA slot: ${max + 1}`);
  const gaps = gapsInRange(ids, Math.max(0, max - 32), max);
  if (gaps.length) console.log(`Recent gaps: ${gaps.join(", ")}`);
}

async function findDonorCommand(args: ParsedArgs, config: ResolvedMoveAnimationWorkflowConfig): Promise<void> {
  const indexPath = path.resolve(option(args, "index") ?? MOVE_ANIMATION_REFERENCE);
  const index = await readMoveAnimationReferenceIndex(indexPath);
  const results = searchMoveAnimationDonors(index, {
    tags: values(args, "tag").flatMap(csvValues),
    sounds: numberValues(args, "sound"),
    text: option(args, "query"),
    noBackground: args.options.has("no-background"),
    limit: option(args, "limit") ? parsePositiveInteger(requiredOption(args, "limit"), "--limit") : 12,
  });
  if (!results.length) throw new Error("No donor moves matched the requested tags, sounds, text, and background constraints.");
  const rom = await loadDonorRom(config.values.cleanRom);
  const enriched = results.map((result) => ({ ...result, inspection: inspectDonorAssets(rom, result.move) }));
  if (args.options.has("json")) {
    console.log(JSON.stringify(enriched.map(({ score, move, matchedTags, inspection }) => ({
      score,
      move,
      matchedTags,
      phases: inspection.phases,
      spaTextures: inspection.spaTextures,
      calledAnimations: inspection.calledAnimations,
      preview: `/#moveAnimation/${move.moveId}`,
    })), null, 2));
    return;
  }
  for (const { score, move, matchedTags, inspection } of enriched) {
    console.log(`\n#${move.moveId} ${move.moveName} score=${score} bytes=${move.byteLength} commands=${move.commandCount} wait~${move.estimatedWaitFrames}f`);
    console.log(`  tags: ${matchedTags.join(",") || move.tags.join(",") || "none"}`);
    console.log(`  phases: ${inspection.phases.map((phase) => `${phase.name}:${phase.label}[${phase.startCommand}-${phase.endCommand}]@${phase.startFrame}-${phase.endFrame}f`).join(" ") || "none"}`);
    console.log(`  SPA: ${move.spaIds.join(",") || "none"}; resources/textures: ${inspection.spaTextures.map((entry) => `${entry.spaId}/${entry.resourceId}=>${entry.textureIds.join("+")}`).join(" ") || "none"}`);
    console.log(`  backgrounds: ${move.backgroundIds.join(",") || "none"}; sounds: ${move.soundIds.join(",") || "none"}; camera: ${move.cameraCommands.join(",") || "none"}`);
    console.log(`  preview: /#moveAnimation/${move.moveId}`);
  }
}

async function startCommand(args: ParsedArgs, config: ResolvedMoveAnimationWorkflowConfig): Promise<void> {
  const moveId = parseMoveId(requiredOption(args, "move"));
  const slug = requiredOption(args, "slug");
  if (!/^[a-z0-9-]+$/u.test(slug)) throw new Error("--slug should use lowercase letters, digits, and dashes only");
  const donorIds = values(args, "donors").flatMap(csvValues).map((value) => parseMoveId(value, "--donors"));
  if (!donorIds.length) throw new Error("start requires --donors <moveId,...>.");
  const outDir = path.resolve(option(args, "out") ?? path.join(config.workspaceRoot, "work", slug));
  if (!isInsideOrEqual(outDir, config.workspaceRoot)) throw new Error(`--out must stay inside ${config.workspaceRoot}.`);
  if ((await pathKind(outDir)) !== "missing") throw new Error(`Move animation workspace already exists: ${outDir}`);

  const index = await readMoveAnimationReferenceIndex(path.resolve(option(args, "index") ?? MOVE_ANIMATION_REFERENCE));
  const moveById = indexMoveEntriesByLogicalId(index);
  const donorEntries = donorIds.map((id) => {
    const move = moveById.get(id);
    if (!move) throw new Error(`Donor move ${id} is absent from ${MOVE_ANIMATION_REFERENCE}.`);
    return move;
  });
  const rom = await loadDonorRom(config.values.cleanRom);
  const inspections = donorEntries.map((move) => inspectDonorAssets(rom, move));
  const defaultSpaCount = inspections[0]!.spaFiles.size;
  const spaCount = option(args, "spa-count") === undefined ? defaultSpaCount : parseNonNegativeInteger(requiredOption(args, "spa-count"), "--spa-count");
  if (spaCount > inspections[0]!.spaFiles.size) throw new Error(`--spa-count ${spaCount} exceeds first donor ${donorIds[0]} SPA count ${inspections[0]!.spaFiles.size}.`);
  const reservedSpaIds = await reserveSpaIds(config, spaCount);

  await mkdir(path.join(outDir, "generated"), { recursive: true });
  for (let index = 0; index < donorEntries.length; index += 1) await writeDonorWorkspace(outDir, donorEntries[index]!, inspections[index]!);

  const firstInspection = inspections[0]!;
  const sourceSpaIds = [...firstInspection.spaFiles.keys()].slice(0, spaCount);
  const spaMap = new Map(sourceSpaIds.map((source, index) => [source, reservedSpaIds[index]!] as const));
  const remappedAnimation = remapMoveAnimationParticleIds(firstInspection.animation, spaMap).bytes;
  const remappedScript = decompileMoveAnimationBytes(remappedAnimation);
  const parsed = parseMoveAnimationScript(remappedScript);
  const loadSpas = new Set<number>();
  const backgrounds = new Set<number>();
  for (const commands of parsed.scripts.values()) for (const command of commands) {
    if (command.name === "LoadSPA") loadSpas.add(command.params[0] ?? -1);
    if (command.name === "LoadBackground") backgrounds.add(command.params[0] ?? -1);
  }
  const padded = moveId.toString().padStart(8, "0");
  const scriptName = `5_${padded}_${slug.replaceAll("-", "_")}.s`;
  const spaNames = reservedSpaIds.map((id) => `6_${id.toString().padStart(8, "0")}.bin`);
  const generatorName = `make-${slug}.ts`;
  const manifest: MoveAnimationManifest = {
    version: 1,
    moveId,
    slug,
    donorMoveIds: donorIds,
    reservedSpaIds,
    generator: generatorName,
    script: `generated/${scriptName}`,
    animation: `generated/5_${padded}.bin`,
    spas: spaNames.map((name) => `generated/${name}`),
    expect: {
      loadSpas: [...loadSpas].filter((id) => id >= 0).sort((left, right) => left - right),
      backgrounds: [...backgrounds].filter((id) => id >= 0).sort((left, right) => left - right),
      forbidSpas: [],
    },
  };
  const generator = makeStartGeneratorTemplate(outDir, donorEntries[0]!, sourceSpaIds, reservedSpaIds, scriptName, spaNames);
  await writeFile(path.join(outDir, generatorName), generator);
  await writeManifest(path.join(outDir, "moveanim.json"), manifest);
  await writeFile(path.join(outDir, "README.md"), renderStartReadme(moveId, slug, donorEntries, reservedSpaIds));
  await runInherited(path.join(SERVERLESS_ROOT, "node_modules/.bin/vite-node"), [path.join(outDir, generatorName)], SERVERLESS_ROOT);
  console.log(`Started move ${moveId} at ${outDir}`);
  console.log(`Donors: ${donorEntries.map((move) => `${move.moveId} ${move.moveName}`).join(", ")}`);
  console.log(`Reserved SPA IDs: ${reservedSpaIds.join(",") || "none"}`);
  console.log(`Next: npm run moveanim:workflow -- segments --file ${path.join(outDir, `donors/move-${donorIds[0]}`, `5_${donorIds[0]!.toString().padStart(8, "0")}.s`)}`);
}

async function segmentsCommand(args: ParsedArgs): Promise<void> {
  const file = path.resolve(requiredOption(args, "file"));
  const analysis = analyzeMoveAnimationSegments(scriptTextFromBytesOrText(new Uint8Array(await readFile(file)), file));
  if (args.options.has("json")) {
    console.log(JSON.stringify(analysis, null, 2));
    return;
  }
  console.log(`${file}: labels=${analysis.labels.join(",")}`);
  for (const range of analysis.inferred) console.log(`${range.name.padEnd(10)} ${range.label}[${range.startCommand}-${range.endCommand}] frames ${range.startFrame}-${range.endFrame}: ${range.commands.join(", ")}`);
}

async function extractSegmentCommand(args: ParsedArgs): Promise<void> {
  const file = path.resolve(requiredOption(args, "file"));
  const out = path.resolve(requiredOption(args, "out"));
  const name = option(args, "name") ?? path.basename(out, path.extname(out));
  const phase = option(args, "phase") as MoveAnimationPhaseName | undefined;
  const segment = extractMoveAnimationSegment(scriptTextFromBytesOrText(new Uint8Array(await readFile(file)), file), name, {
    label: option(args, "label"),
    phase,
    from: option(args, "from") === undefined ? undefined : parseNonNegativeInteger(requiredOption(args, "from"), "--from"),
    to: option(args, "to") === undefined ? undefined : parseNonNegativeInteger(requiredOption(args, "to"), "--to"),
  });
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, segment.script);
  await writeFile(`${out}.segment.json`, `${JSON.stringify(segment, null, 2)}\n`);
  console.log(`Wrote ${name} segment -> ${out}`);
  segment.taskOverlap.forEach((overlap) => console.log(`OVERLAP frame ${overlap.frame}: ${overlap.commands.join(", ")}`));
  segment.omittedSetup.forEach((line) => console.log(`OMITTED SETUP ${line}`));
  segment.omittedCleanup.forEach((line) => console.log(`OMITTED CLEANUP ${line}`));
}

async function composeCommand(args: ParsedArgs): Promise<void> {
  const specs = values(args, "segment");
  if (!specs.length) throw new Error("compose requires one or more --segment name=file#phase or name=file#LABEL:start-end options.");
  const segments = [];
  for (const spec of specs) {
    const parsed = parseSegmentSpec(spec);
    const bytes = new Uint8Array(await readFile(parsed.file));
    segments.push(extractMoveAnimationSegment(scriptTextFromBytesOrText(bytes, parsed.file), parsed.name, parsed.selection));
  }
  const composed = composeMoveAnimationSegments(segments);
  const out = path.resolve(requiredOption(args, "out"));
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, composed.script);
  console.log(`Composed ${segments.length} segment(s) -> ${out}`);
  composed.report.forEach((line) => console.log(line));
}

async function snapshotsCommand(args: ParsedArgs, config: ResolvedMoveAnimationWorkflowConfig): Promise<void> {
  const resolved = await readMoveAnimationManifest(requiredOption(args, "manifest"));
  const sourcePath = (await pathKind(resolved.animationPath)) === "file" ? resolved.animationPath : resolved.scriptPath;
  if (!sourcePath) throw new Error("Snapshot manifest has no generated animation or script.");
  const script = scriptTextFromBytesOrText(new Uint8Array(await readFile(sourcePath)), sourcePath);
  const preferredRom = (await pathKind(builtRomPath(config))) === "file" ? builtRomPath(config) : config.values.cleanRom;
  if ((await pathKind(preferredRom)) !== "file") throw new Error(`Snapshots need the built or clean ROM for donor dependencies. ${configOverrideHelp(config.configPath)}`);
  const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(preferredRom)), path.basename(preferredRom));
  const customSpas = new Map<number, SpaArchive>();
  for (const spaPath of resolved.spaPaths) customSpas.set(spaIdFromPath(spaPath), parseSpaArchive(new Uint8Array(await readFile(spaPath))));
  const preview = await buildMoveAnimationPreview(project, resolved.manifest.moveId, script, {
    loadSpaArchive: (activeProject, spaId) => Promise.resolve(customSpas.get(spaId)).then((archive) => archive ?? loadMoveSpaArchive(activeProject, spaId)),
  });
  const frameOption = option(args, "frames") ?? "auto";
  const frames = frameOption === "auto" ? "auto" : csvValues(frameOption).map((value) => parseNonNegativeInteger(value, "snapshot frame"));
  const outputDirectory = path.join(resolved.directory, "snapshots");
  const report = await generateMoveAnimationSnapshots({ preview, outputDirectory, frames });
  console.log(`Rendered ${report.frames.length} key frame(s) for normal and swapped sides -> ${outputDirectory}`);
  console.log(`Preview warnings=${report.previewWarnings.length}; approximation warnings=${report.approximationWarnings.length}`);
}

async function stageCommand(args: ParsedArgs, config: ResolvedMoveAnimationWorkflowConfig): Promise<void> {
  const moveId = parseMoveId(requiredOption(args, "move"));
  const bin = path.resolve(requiredOption(args, "bin"));
  const spaPaths = values(args, "spa").map((value) => path.resolve(value));
  await stageFiles(config, moveId, bin, spaPaths, stageTargets(args));
}

async function verifyBuiltCommand(args: ParsedArgs, config: ResolvedMoveAnimationWorkflowConfig): Promise<void> {
  const manifestOption = option(args, "manifest");
  const resolved = manifestOption ? await readMoveAnimationManifest(manifestOption) : undefined;
  const moveId = resolved?.manifest.moveId ?? parseMoveId(requiredOption(args, "move"));
  const romPath = path.resolve(option(args, "rom") ?? builtRomPath(config));
  if ((await pathKind(romPath)) !== "file") throw new Error(`Built ROM does not exist: ${romPath}. Build W2U first, or set --rom/--build-repo. ${configOverrideHelp(config.configPath)}`);
  const built = await readBuiltAssets(romPath, moveId, [
    ...numberValues(args, "expect-spa-file"),
    ...(resolved?.spaPaths.map(spaIdFromPath) ?? []),
  ]);
  assertBuiltExpectations(built, moveId, {
    loadSpas: [...numberValues(args, "expect-load-spa"), ...(resolved?.manifest.expect?.loadSpas ?? [])],
    forbidSpas: [...numberValues(args, "forbid-load-spa"), ...(resolved?.manifest.expect?.forbidSpas ?? [])],
    backgrounds: [...numberValues(args, "expect-background"), ...(resolved?.manifest.expect?.backgrounds ?? [])],
    text: [...values(args, "expect-text"), ...(resolved?.manifest.expect?.text ?? [])],
  });
  if (resolved) {
    await assertBuiltMatchesGenerated(resolved, built);
    const generated = await generatedHashes(resolved);
    const mirror = await stagedHashes(resolved, config.values.mirrorRepo);
    const build = await stagedHashes(resolved, config.values.buildRepo);
    assertHashListsEqual(generated, mirror, "generated", "mirror staging");
    assertHashListsEqual(generated, build, "generated", "build staging");
  }
  let route: MoveAnimationFinishRecord["builtRom"]["expandedRoute"] = "not-required";
  if (moveId >= FIRST_EXPANDED_MOVE_ID && (resolved || args.options.has("verify-route"))) route = await verifyExpandedRoute(romPath);
  printBuiltSummary(built, moveId, route, args.options.has("dump-script"));
}

async function inspectScriptCommand(args: ParsedArgs): Promise<void> {
  const file = path.resolve(requiredOption(args, "file"));
  const bytes = new Uint8Array(await readFile(file));
  const script = scriptTextFromBytesOrText(bytes, file);
  const analysis = analyzeMoveAnimationScript(script);
  if (args.options.has("json")) {
    console.log(JSON.stringify({ file, bytes: bytes.length, sha256: sha256(bytes), analysis, script }, null, 2));
    return;
  }
  console.log(`${file} bytes=${bytes.length} sha256=${sha256(bytes)}`);
  console.log(`labels=${analysis.labels.join(", ") || "none"} commands=${analysis.commandCount}`);
  console.log(`LoadSPA=${analysis.loadedSpaIds.join(",") || "none"}`);
  console.log(`spawns=${analysis.spawnedSpaEvents.map((event) => `${event.command}:${event.spaId}/${event.resourceId ?? "all"}@${event.label}:${event.frame}`).join(" ") || "none"}`);
  console.log(`backgrounds=${analysis.backgrounds.filter((event) => event.command === "LoadBackground").map((event) => event.backgroundId).join(",") || "none"}`);
  for (const warning of analysis.warnings) console.log(`WARN ${warning}`);
  console.log("\n" + script);
}

async function inspectSpaCommand(args: ParsedArgs): Promise<void> {
  const file = path.resolve(requiredOption(args, "file"));
  const bytes = new Uint8Array(await readFile(file));
  const resource = option(args, "resource") === undefined ? undefined : parseMoveId(requiredOption(args, "resource"));
  const report = inspectSpaArchive(parseSpaArchive(bytes), resource);
  if (args.options.has("json")) {
    console.log(JSON.stringify({ file, bytes: bytes.length, sha256: sha256(bytes), ...report }, null, 2));
    return;
  }
  console.log(`${file} bytes=${bytes.length} sha256=${sha256(bytes)} resources=${report.resourceCount} textures=${report.textureCount}`);
  report.textures.forEach((texture) => console.log(`texture ${texture.index}: format=${texture.format} size=${texture.dimensions} shared=${texture.sharedTexture ?? "no"} rgba=${texture.rgbaSha256}`));
  for (const item of report.resources) {
    console.log(`\nresource ${item.index}: draw=${item.drawType} emission=${item.emissionType} textures=${item.textureReferences.join(",")}`);
    console.log(`  color=${formatColor(item.color)} colorAnim=${formatJson(item.colorAnim)} alpha=${formatJson(item.alpha)} scale=${formatJson(item.scale)}`);
    console.log(`  basePos=${item.emitterBasePos.join(",")} timing=${formatJson(item.timing)}`);
    console.log(`  rotation=${formatJson(item.rotation)} child=${formatJson(item.child)} behaviors=${formatJson(item.behaviors)}`);
    console.log(`  selfMaintaining=${item.selfMaintaining} followEmitter=${item.followEmitter} peak=${formatJson(item.peak)}`);
  }
  report.warnings.forEach((warning) => console.log(`WARN ${warning}`));
}

async function diffSpaCommand(args: ParsedArgs): Promise<void> {
  const beforePath = path.resolve(requiredOption(args, "before"));
  const afterPath = path.resolve(requiredOption(args, "after"));
  const allow = values(args, "allow").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  const before = parseSpaArchive(new Uint8Array(await readFile(beforePath)));
  const after = parseSpaArchive(new Uint8Array(await readFile(afterPath)));
  const report = diffSpaArchives(before, after, allow);
  if (args.options.has("json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Compared ${beforePath} -> ${afterPath}; differences=${report.differences.length} disallowed=${report.disallowed.length}`);
    for (const difference of report.differences) console.log(`${difference.allowed ? "ALLOW" : "FAIL "} ${difference.path}: ${formatJson(difference.before)} -> ${formatJson(difference.after)}${difference.detail ? ` (${difference.detail})` : ""}`);
  }
  if (report.disallowed.length) throw new Error(`${report.disallowed.length} non-allowlisted SPA semantic difference(s). Add deliberate fields with --allow color,colorAnim.`);
}

async function lintCommand(args: ParsedArgs, config: ResolvedMoveAnimationWorkflowConfig): Promise<void> {
  const resolved = await readMoveAnimationManifest(requiredOption(args, "manifest"));
  const report = await lintResolvedManifest(resolved, config);
  printLintReport(report, args.options.has("json"));
  if (!report.ok) throw new Error(`Move animation lint failed with ${report.issues.filter((issue) => issue.severity === "error").length} error(s).`);
}

async function finishCommand(args: ParsedArgs, config: ResolvedMoveAnimationWorkflowConfig): Promise<void> {
  const manifestPath = path.resolve(requiredOption(args, "manifest"));
  const resume = (option(args, "resume") ?? FINISH_PHASES[0]) as FinishPhase;
  const startIndex = FINISH_PHASES.indexOf(resume);
  if (startIndex < 0) throw new Error(`--resume must be one of ${FINISH_PHASES.join(", ")}`);
  let resolved = await readMoveAnimationManifest(manifestPath);

  for (let index = startIndex; index < FINISH_PHASES.length; index += 1) {
    const phase = FINISH_PHASES[index] ?? "generate";
    console.log(`\n[finish:${phase}]`);
    try {
      if (phase === "generate") {
        await access(resolved.generatorPath, fsConstants.R_OK);
        await runInherited(path.join(SERVERLESS_ROOT, "node_modules/.bin/vite-node"), [resolved.generatorPath], SERVERLESS_ROOT);
        resolved = await readMoveAnimationManifest(manifestPath);
      } else if (phase === "compile") {
        if (!resolved.scriptPath) throw new Error(`Manifest needs "script", or generated/ must contain exactly one 5_${resolved.manifest.moveId.toString().padStart(8, "0")}*.s file.`);
        const source = await readFile(resolved.scriptPath, "utf8");
        const bytes = compileMoveAnimation({} as ProjectState, resolved.manifest.moveId, source);
        await mkdir(path.dirname(resolved.animationPath), { recursive: true });
        await writeFile(resolved.animationPath, bytes);
        console.log(`Compiled ${resolved.scriptPath} -> ${resolved.animationPath} (${bytes.length} bytes)`);
      } else if (phase === "lint") {
        const report = await lintResolvedManifest(resolved, config);
        printLintReport(report, false);
        if (!report.ok) throw new Error(`Lint found ${report.issues.filter((issue) => issue.severity === "error").length} error(s).`);
      } else if (phase === "stage") {
        await stageFiles(config, resolved.manifest.moveId, resolved.animationPath, resolved.spaPaths, ["mirror", "build"]);
      } else if (phase === "build") {
        await runInherited("ninja", ["-C", "build", "White2Upgrade.nds"], config.values.buildRepo, { JAVA: config.values.java });
      } else if (phase === "verify") {
        const record = await verifyFinishAssets(resolved, config);
        printBuiltRecord(record);
      } else {
        const record = await verifyFinishAssets(resolved, config);
        await mkdir(path.dirname(config.values.outputRom), { recursive: true });
        await copyFile(builtRomPath(config), config.values.outputRom);
        const copiedHash = sha256(new Uint8Array(await readFile(config.values.outputRom)));
        if (copiedHash !== record.builtRom.sha256) throw new Error(`Copied ROM hash ${copiedHash} does not match built ROM ${record.builtRom.sha256}.`);
        record.outputRom = { path: config.values.outputRom, sha256: copiedHash };
        record.completedAt = new Date().toISOString();
        resolved.manifest.finish = record;
        delete resolved.manifest.final;
        await writeManifest(resolved.manifestPath, resolved.manifest);
        console.log(`Copied verified ROM -> ${config.values.outputRom}`);
        console.log(`sha256=${copiedHash}`);
      }
    } catch (error) {
      console.error(`Finish stopped in phase "${phase}": ${error instanceof Error ? error.message : String(error)}`);
      console.error(`Resume with: npm run moveanim:workflow -- finish --manifest ${manifestPath} --resume ${phase}`);
      throw error;
    }
  }
  console.log(`\nFinish complete. Finalize after acceptance with: npm run moveanim:workflow -- finalize --manifest ${manifestPath} --archive-work`);
}

async function finalizeCommand(args: ParsedArgs, config: ResolvedMoveAnimationWorkflowConfig): Promise<void> {
  if (!args.options.has("archive-work")) throw new Error("finalize requires --archive-work so finalization cannot silently leave an active one-off workspace.");
  const resolved = await readMoveAnimationManifest(requiredOption(args, "manifest"));
  const recorded = resolved.manifest.finish;
  if (!recorded) throw new Error("Manifest has no successful finish record. Run finish first.");
  const current = await verifyFinishAssets(resolved, config);
  current.outputRom = await hashOutputRom(config.values.outputRom);
  assertFinishHashesEqual(recorded, current);

  const activeWorkRoot = path.join(config.workspaceRoot, "work");
  if (path.dirname(resolved.directory) !== activeWorkRoot || path.basename(resolved.directory) !== resolved.manifest.slug) {
    throw new Error(`Active manifest directory must be ${path.join(activeWorkRoot, resolved.manifest.slug)} before archiving.`);
  }
  const archiveRoot = path.join(activeWorkRoot, "archive");
  const archiveDirectory = path.join(archiveRoot, resolved.manifest.slug);
  if ((await pathKind(archiveDirectory)) !== "missing") throw new Error(`Archive destination already exists: ${archiveDirectory}`);
  await mkdir(archiveRoot, { recursive: true });
  await ensureArchiveReadme(archiveRoot);
  const finalizedAt = new Date().toISOString();
  resolved.manifest.final = { ...recorded, finalizedAt };
  await writeManifest(resolved.manifestPath, resolved.manifest);
  await rename(resolved.directory, archiveDirectory);
  console.log(`Finalized move ${resolved.manifest.moveId}; archived ${resolved.directory} -> ${archiveDirectory}`);
  console.log(`Reopen with: npm run moveanim:workflow -- reopen --move ${resolved.manifest.moveId}`);
}

async function reopenCommand(args: ParsedArgs, config: ResolvedMoveAnimationWorkflowConfig): Promise<void> {
  const moveId = parseMoveId(requiredOption(args, "move"));
  const archiveRoot = path.join(config.workspaceRoot, "work/archive");
  const entries = await readdir(archiveRoot, { withFileTypes: true });
  const matches: ResolvedMoveAnimationManifest[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(archiveRoot, entry.name, "moveanim.json");
    if ((await pathKind(manifestPath)) !== "file") continue;
    const resolved = await readMoveAnimationManifest(manifestPath);
    if (resolved.manifest.moveId === moveId) matches.push(resolved);
  }
  if (matches.length !== 1) throw new Error(matches.length ? `Multiple archived manifests found for move ${moveId}.` : `No archived manifest found for move ${moveId} under ${archiveRoot}.`);
  const archived = matches[0]!;
  const activeDirectory = path.join(config.workspaceRoot, "work", archived.manifest.slug);
  if ((await pathKind(activeDirectory)) !== "missing") throw new Error(`Active workspace already exists: ${activeDirectory}`);
  await cp(archived.directory, activeDirectory, { recursive: true, errorOnExist: true });
  let active = await readMoveAnimationManifest(path.join(activeDirectory, "moveanim.json"));
  if (active.manifest.final) {
    active.manifest.history = [...(active.manifest.history ?? []), { finalizedAt: active.manifest.final.finalizedAt, final: active.manifest.final }];
  }
  delete active.manifest.finish;
  delete active.manifest.final;
  active.manifest.reopenedAt = new Date().toISOString();
  await refreshActiveOutputs(active, config);
  await writeManifest(active.manifestPath, active.manifest);
  active = await readMoveAnimationManifest(active.manifestPath);
  console.log(`Reopened move ${moveId} at ${active.directory}`);
  console.log("Generated animation and SPA outputs were refreshed from staged W2U assets (built ROM fallback enabled).");
}

async function scaffoldCommand(args: ParsedArgs, config: ResolvedMoveAnimationWorkflowConfig): Promise<void> {
  const slug = requiredOption(args, "slug");
  const moveId = parseMoveId(requiredOption(args, "move"));
  if (!/^[a-z0-9-]+$/u.test(slug)) throw new Error("--slug should use lowercase letters, digits, and dashes only");
  const padded = moveId.toString().padStart(8, "0");
  const generatedName = `5_${padded}_${slug.replaceAll("-", "_")}.s`;
  const outDir = path.resolve(option(args, "out") ?? path.join(config.workspaceRoot, "work", slug));
  if (!isInsideOrEqual(outDir, config.workspaceRoot)) throw new Error(`--out must stay inside ${config.workspaceRoot}.`);
  const scriptForCompile = toPosix(path.relative(SERVERLESS_ROOT, path.join(outDir, "generated", generatedName)));
  const binForCompile = toPosix(path.relative(SERVERLESS_ROOT, path.join(outDir, "generated", `5_${padded}.bin`)));
  const manifest: MoveAnimationManifest = {
    version: 1,
    moveId,
    slug,
    generator: `make-${slug}.ts`,
    script: `generated/${generatedName}`,
    animation: `generated/5_${padded}.bin`,
    spas: [],
    expect: { loadSpas: [], backgrounds: [], forbidSpas: [] },
  };
  await mkdir(path.join(outDir, "generated"), { recursive: true });
  await writeFile(path.join(outDir, `make-${slug}.ts`), makeGeneratorTemplate(moveId, generatedName, scriptForCompile, binForCompile));
  await writeManifest(path.join(outDir, "moveanim.json"), manifest);
  console.log(`Created manifest-driven move animation scaffold at ${outDir}`);
}

async function lintResolvedManifest(resolved: ResolvedMoveAnimationManifest, config: ResolvedMoveAnimationWorkflowConfig): Promise<MoveAnimationLintReport> {
  const animationExists = (await pathKind(resolved.animationPath)) === "file";
  const sourcePath = animationExists ? resolved.animationPath : resolved.scriptPath;
  if (!sourcePath) throw new Error("Manifest has no compiled animation and no resolvable script path.");
  const sourceBytes = new Uint8Array(await readFile(sourcePath));
  const script = scriptTextFromBytesOrText(sourceBytes, sourcePath);
  const archives = await loadSpaDependencies(script, resolved.spaPaths, config);
  return lintMoveAnimationScript(script, archives, resolved.manifest.expect);
}

async function loadSpaDependencies(script: string, customSpaPaths: string[], config: ResolvedMoveAnimationWorkflowConfig): Promise<Map<number, SpaArchive>> {
  const archives = new Map<number, SpaArchive>();
  for (const spaPath of customSpaPaths) archives.set(spaIdFromPath(spaPath), parseSpaArchive(new Uint8Array(await readFile(spaPath))));
  const parsed = parseMoveAnimationScript(script);
  const wanted = new Set<number>();
  for (const commands of parsed.scripts.values()) for (const command of commands) if (command.name === "LoadSPA") wanted.add(command.params[0] ?? -1);
  const missing = [...wanted].filter((spaId) => !archives.has(spaId));
  if (!missing.length) return archives;
  if ((await pathKind(config.values.cleanRom)) !== "file") {
    throw new Error(`Lint needs the clean ROM to inspect SPA dependencies ${missing.join(", ")}. ${configOverrideHelp(config.configPath)}`);
  }
  const rom = new NintendoDSRom(new Uint8Array(await readFile(config.values.cleanRom)));
  const moveSpas = new NARC(rom.getFileByName(MOVE_SPA_NARC));
  for (const spaId of missing) {
    const bytes = moveSpas.files[spaId];
    if (bytes) archives.set(spaId, parseSpaArchive(bytes));
  }
  return archives;
}

async function stageFiles(config: ResolvedMoveAnimationWorkflowConfig, moveId: number, animation: string, spaPaths: string[], targets: StageTarget[]): Promise<void> {
  for (const target of targets) {
    const repo = target === "mirror" ? config.values.mirrorRepo : config.values.buildRepo;
    if ((await pathKind(repo)) !== "directory") throw new Error(`${target} repository does not exist: ${repo}. ${configOverrideHelp(config.configPath)}`);
    await copyMoveAnimation(repo, moveId, animation);
    for (const spaPath of spaPaths) await copySpa(repo, spaPath);
  }
}

async function verifyFinishAssets(resolved: ResolvedMoveAnimationManifest, config: ResolvedMoveAnimationWorkflowConfig): Promise<MoveAnimationFinishRecord> {
  const customSpaIds = resolved.spaPaths.map(spaIdFromPath);
  if ((await pathKind(builtRomPath(config))) !== "file") throw new Error(`Built ROM does not exist: ${builtRomPath(config)}. Run the build phase or correct buildRepo. ${configOverrideHelp(config.configPath)}`);
  const built = await readBuiltAssets(builtRomPath(config), resolved.manifest.moveId, customSpaIds);
  assertBuiltExpectations(built, resolved.manifest.moveId, resolved.manifest.expect ?? {});
  await assertBuiltMatchesGenerated(resolved, built);
  const route = resolved.manifest.moveId >= FIRST_EXPANDED_MOVE_ID ? await verifyExpandedRoute(built.romPath) : "not-required";
  const generated = await generatedHashes(resolved);
  const staged = {
    mirror: await stagedHashes(resolved, config.values.mirrorRepo),
    build: await stagedHashes(resolved, config.values.buildRepo),
  };
  assertHashListsEqual(generated, staged.mirror, "generated", "mirror staging");
  assertHashListsEqual(generated, staged.build, "generated", "build staging");
  return {
    completedAt: new Date().toISOString(),
    generated,
    staged,
    builtRom: {
      path: built.romPath,
      sha256: built.romSha256,
      animation: { path: `${built.logicalTarget.sourcePath}:${built.logicalTarget.index}`, bytes: built.animationBytes.length, sha256: sha256(built.animationBytes) },
      spas: customSpaIds.map((spaId) => {
        const bytes = built.spaBytes.get(spaId)!;
        return { path: `${MOVE_SPA_NARC}:${spaId}`, bytes: bytes.length, sha256: sha256(bytes) };
      }),
      expandedRoute: route,
    },
    outputRom: { path: config.values.outputRom, sha256: "pending" },
    dependencies: {
      loadSpas: built.loadSpas,
      backgrounds: built.backgrounds,
      calledAnimations: built.calledAnimations,
      logicalTarget: built.logicalTarget,
      spas: built.loadSpas.map((spaId) => {
        const bytes = built.spaBytes.get(spaId);
        if (!bytes) throw new Error(`${MOVE_SPA_NARC} dependency ${spaId} is missing.`);
        return { path: `${MOVE_SPA_NARC}:${spaId}`, bytes: bytes.length, sha256: sha256(bytes) };
      }),
    },
  };
}

async function readBuiltAssets(romPath: string, moveId: number, spaIds: number[]): Promise<BuiltAssets> {
  const romBytes = new Uint8Array(await readFile(romPath));
  const rom = new NintendoDSRom(romBytes);
  const project = await loadProjectFromRomBytes(romBytes, path.basename(romPath));
  const logicalTarget = getMoveAnimationTargetInfo(project, moveId);
  if (!logicalTarget) throw new Error(`Move ${moveId} does not resolve to a loaded animation member.`);
  const animationStore = project.narcs[logicalTarget.storeName];
  const animationBytes = animationStore?.rawFiles[logicalTarget.index];
  if (!animationBytes) throw new Error(`${logicalTarget.sourcePath} member ${logicalTarget.index} is missing for logical move ${moveId}.`);
  const moveSpas = new NARC(rom.getFileByName(MOVE_SPA_NARC));
  const script = decompileMoveAnimationBytes(animationBytes);
  const parsed = parseMoveAnimationScript(script);
  const loadSpas = new Set<number>();
  const backgrounds = new Set<number>();
  const calledAnimations = new Set<number>();
  let commandCount = 0;
  for (const commands of parsed.scripts.values()) {
    if (!commands.length || !commands.at(-1)?.ends) throw new Error(`Animation label ${commands[0]?.label ?? "<empty>"} does not terminate.`);
    for (const command of commands) {
      commandCount += 1;
      if (command.name === "LoadSPA") loadSpas.add(command.params[0] ?? -1);
      if (command.name === "LoadBackground") backgrounds.add(command.params[0] ?? -1);
      if (command.name === "CallMoveAnimation") calledAnimations.add(command.params[0] ?? -1);
    }
  }
  if (animationBytes.length < 12 || parsed.count < 1 || parsed.headerLabels.length < parsed.count * 14 || commandCount < 2) {
    throw new Error(`Move ${moveId} has an invalid or trivial animation body (${animationBytes.length} bytes, ${commandCount} commands, ${parsed.headerLabels.length} header labels).`);
  }
  const roundTrip = compileMoveAnimation(project, moveId, script);
  if (!bytesEqual(roundTrip, animationBytes)) throw new Error(`Move ${moveId} is not byte-stable after decompile/compile round trip (${sha256(animationBytes)} -> ${sha256(roundTrip)}).`);
  const spaBytes = new Map<number, Uint8Array>();
  for (const spaId of new Set([...spaIds, ...loadSpas])) {
    const bytes = moveSpas.files[spaId];
    if (!bytes) throw new Error(`${MOVE_SPA_NARC} member ${spaId} is missing.`);
    spaBytes.set(spaId, bytes);
  }
  const spaArchives = new Map([...loadSpas].map((spaId) => [spaId, parseSpaArchive(spaBytes.get(spaId)!)] as const));
  const lint = lintMoveAnimationScript(script, spaArchives);
  const dependencyErrors = lint.issues.filter((issue) => issue.severity === "error");
  if (dependencyErrors.length) throw new Error(`Built move ${moveId} failed dependency/lifecycle lint: ${dependencyErrors.map((issue) => `[${issue.code}] ${issue.message}`).join("; ")}`);
  for (const calledMoveId of calledAnimations) {
    if (calledMoveId < 0 || !getMoveAnimationTargetInfo(project, calledMoveId)) throw new Error(`CallMoveAnimation ${calledMoveId} does not resolve to a loaded animation member.`);
  }
  for (const backgroundId of backgrounds) {
    if (backgroundId < 0) throw new Error(`Move ${moveId} contains an invalid background ID ${backgroundId}.`);
    try {
      await loadMoveBackground(project, backgroundId);
    } catch (error) {
      throw new Error(`Move ${moveId} background ${backgroundId} is missing or invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    romPath,
    romSha256: sha256(romBytes),
    animationBytes,
    spaBytes,
    script,
    loadSpas: [...loadSpas].sort((a, b) => a - b),
    backgrounds: [...backgrounds].sort((a, b) => a - b),
    calledAnimations: [...calledAnimations].sort((a, b) => a - b),
    logicalTarget,
  };
}

function assertBuiltExpectations(built: BuiltAssets, moveId: number, expect: MoveAnimationManifest["expect"] = {}): void {
  for (const spaId of expect?.loadSpas ?? []) if (!built.loadSpas.includes(spaId)) throw new Error(`Move ${moveId} does not LoadSPA ${spaId}; saw ${built.loadSpas.join(",") || "none"}.`);
  for (const spaId of expect?.forbidSpas ?? []) if (built.loadSpas.includes(spaId)) throw new Error(`Move ${moveId} unexpectedly LoadSPA ${spaId}.`);
  for (const background of expect?.backgrounds ?? []) if (!built.backgrounds.includes(background)) throw new Error(`Move ${moveId} does not LoadBackground ${background}; saw ${built.backgrounds.join(",") || "none"}.`);
  for (const text of expect?.text ?? []) if (!built.script.includes(text)) throw new Error(`Move ${moveId} script does not include expected text: ${text}`);
}

async function assertBuiltMatchesGenerated(resolved: ResolvedMoveAnimationManifest, built: BuiltAssets): Promise<void> {
  const animation = new Uint8Array(await readFile(resolved.animationPath));
  if (!bytesEqual(animation, built.animationBytes)) throw new Error(`Built ${MOVE_ANIMATION_NARC}:${resolved.manifest.moveId} hash ${sha256(built.animationBytes)} does not match generated ${sha256(animation)}.`);
  for (const spaPath of resolved.spaPaths) {
    const spaId = spaIdFromPath(spaPath);
    const generated = new Uint8Array(await readFile(spaPath));
    const inRom = built.spaBytes.get(spaId);
    if (!inRom || !bytesEqual(generated, inRom)) throw new Error(`Built ${MOVE_SPA_NARC}:${spaId} does not match ${spaPath}.`);
  }
}

async function verifyExpandedRoute(romPath: string): Promise<"frost-patched" | "w2u-patched"> {
  const bytes = new Uint8Array(await readFile(romPath));
  if (hasW2uMoveAnimationRoutingSignature(bytes)) return "w2u-patched";
  const project = await loadProjectFromRomBytes(bytes, path.basename(romPath));
  const status = detectMoveExpansionPatch(project);
  if (status !== "patched") throw new Error(`Expanded-move routing is ${status}; neither the W2U hook nor Frost hook was found, so move IDs ${FIRST_EXPANDED_MOVE_ID}+ can fall back before reaching their direct animation slot.`);
  return "frost-patched";
}

async function generatedHashes(resolved: ResolvedMoveAnimationManifest): Promise<MoveAnimationFileHash[]> {
  return Promise.all([
    hashFile(resolved.animationPath, path.relative(resolved.directory, resolved.animationPath)),
    ...resolved.spaPaths.map((spaPath) => hashFile(spaPath, path.relative(resolved.directory, spaPath))),
  ]);
}

async function stagedHashes(resolved: ResolvedMoveAnimationManifest, repo: string): Promise<MoveAnimationFileHash[]> {
  const animation = path.join(animationStageDir(repo), animationFileName(resolved.manifest.moveId));
  const spas = resolved.spaPaths.map((spaPath) => path.join(spaStageDir(repo), path.basename(spaPath)));
  return Promise.all([
    hashFile(animation, path.relative(repo, animation)),
    ...spas.map((spaPath) => hashFile(spaPath, path.relative(repo, spaPath))),
  ]);
}

function assertHashListsEqual(expected: MoveAnimationFileHash[], actual: MoveAnimationFileHash[], expectedLabel: string, actualLabel: string): void {
  if (expected.length !== actual.length) throw new Error(`${actualLabel} has ${actual.length} files; ${expectedLabel} has ${expected.length}.`);
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index]?.sha256 !== actual[index]?.sha256) throw new Error(`${actualLabel} ${actual[index]?.path} hash ${actual[index]?.sha256} does not match ${expectedLabel} ${expected[index]?.path} hash ${expected[index]?.sha256}.`);
  }
}

function assertFinishHashesEqual(recorded: MoveAnimationFinishRecord, current: MoveAnimationFinishRecord): void {
  assertHashListsEqual(recorded.generated, current.generated, "recorded generated", "current generated");
  assertHashListsEqual(recorded.staged.mirror, current.staged.mirror, "recorded mirror", "current mirror");
  assertHashListsEqual(recorded.staged.build, current.staged.build, "recorded build", "current build");
  if (recorded.builtRom.sha256 !== current.builtRom.sha256) throw new Error("Built ROM changed after finish; run finish again before finalizing.");
  if (recorded.outputRom.sha256 !== current.outputRom.sha256) throw new Error("Output ROM changed after finish; run finish again before finalizing.");
  if (recorded.builtRom.animation.sha256 !== current.builtRom.animation.sha256) throw new Error("Built animation changed after finish.");
  assertHashListsEqual(recorded.builtRom.spas, current.builtRom.spas, "recorded built SPA", "current built SPA");
  assertHashListsEqual(recorded.dependencies.spas, current.dependencies.spas, "recorded dependency SPA", "current dependency SPA");
  if (recorded.dependencies.loadSpas.join(",") !== current.dependencies.loadSpas.join(",")) throw new Error("Loaded SPA dependencies changed after finish.");
  if (recorded.dependencies.backgrounds.join(",") !== current.dependencies.backgrounds.join(",")) throw new Error("Background dependencies changed after finish.");
  if ((recorded.dependencies.calledAnimations ?? []).join(",") !== current.dependencies.calledAnimations.join(",")) throw new Error("Called animation dependencies changed after finish.");
  if (JSON.stringify(recorded.dependencies.logicalTarget) !== JSON.stringify(current.dependencies.logicalTarget)) throw new Error("Logical move-to-animation routing changed after finish.");
  if (current.builtRom.expandedRoute !== recorded.builtRom.expandedRoute) throw new Error("Expanded routing verification changed after finish.");
}

async function hashOutputRom(outputRom: string): Promise<MoveAnimationFinishRecord["outputRom"]> {
  const bytes = new Uint8Array(await readFile(outputRom));
  return { path: outputRom, sha256: sha256(bytes) };
}

async function refreshActiveOutputs(resolved: ResolvedMoveAnimationManifest, config: ResolvedMoveAnimationWorkflowConfig): Promise<void> {
  const builtPath = path.join(animationStageDir(config.values.buildRepo), animationFileName(resolved.manifest.moveId));
  const mirrorPath = path.join(animationStageDir(config.values.mirrorRepo), animationFileName(resolved.manifest.moveId));
  let animationBytes = await firstExistingBytes([builtPath, mirrorPath]);
  let romAssets: BuiltAssets | undefined;
  if (!animationBytes) {
    romAssets = await readBuiltAssets(builtRomPath(config), resolved.manifest.moveId, resolved.spaPaths.map(spaIdFromPath));
    animationBytes = romAssets.animationBytes;
  }
  await mkdir(path.dirname(resolved.animationPath), { recursive: true });
  await writeFile(resolved.animationPath, animationBytes);
  if (resolved.scriptPath) {
    await mkdir(path.dirname(resolved.scriptPath), { recursive: true });
    await writeFile(resolved.scriptPath, decompileMoveAnimationBytes(animationBytes));
  }
  for (const spaPath of resolved.spaPaths) {
    const spaId = spaIdFromPath(spaPath);
    const buildSpa = path.join(spaStageDir(config.values.buildRepo), path.basename(spaPath));
    const mirrorSpa = path.join(spaStageDir(config.values.mirrorRepo), path.basename(spaPath));
    const bytes = await firstExistingBytes([buildSpa, mirrorSpa]) ?? (romAssets ??= await readBuiltAssets(builtRomPath(config), resolved.manifest.moveId, resolved.spaPaths.map(spaIdFromPath))).spaBytes.get(spaId);
    if (!bytes) throw new Error(`Cannot refresh SPA ${spaId} from staged assets or built ROM.`);
    await mkdir(path.dirname(spaPath), { recursive: true });
    await writeFile(spaPath, bytes);
  }
}

async function firstExistingBytes(paths: string[]): Promise<Uint8Array | undefined> {
  for (const candidate of paths) if ((await pathKind(candidate)) === "file") return new Uint8Array(await readFile(candidate));
  return undefined;
}

async function copyMoveAnimation(repo: string, moveId: number, source: string): Promise<void> {
  const targetDir = animationStageDir(repo);
  const target = path.join(targetDir, animationFileName(moveId));
  await mkdir(targetDir, { recursive: true });
  await copyFile(source, target);
  console.log(`Copied ${source} -> ${target}`);
}

async function copySpa(repo: string, source: string): Promise<void> {
  spaIdFromPath(source);
  const targetDir = spaStageDir(repo);
  const target = path.join(targetDir, path.basename(source));
  await mkdir(targetDir, { recursive: true });
  await copyFile(source, target);
  console.log(`Copied ${source} -> ${target}`);
}

function printLintReport(report: MoveAnimationLintReport, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Lint ${report.ok ? "PASS" : "FAIL"}: labels=${report.labels.length} commands=${report.commandCount}`);
  console.log(`Dependencies: SPA=${report.loadSpas.join(",") || "none"} backgrounds=${report.backgrounds.join(",") || "none"}`);
  console.log(`Retail peaks: loaded SPA=${report.metrics.maxLoadedSpas}/16 temporary emitters=${report.metrics.maxTemporaryEmitters}/16 particles=${report.metrics.maxConcurrentParticles} polygon pressure=${report.metrics.maxPolygonPressure}/49`);
  for (const wait of report.waits) console.log(`WAIT ${wait.label}:${wait.frame} kind=${wait.kind} -> ${wait.waitedUntil}; ${wait.activeTasks.join("; ") || "no modeled tasks"}`);
  for (const item of report.issues) {
    const where = item.label ? ` ${item.label}${item.frame === undefined ? "" : `:${item.frame}`}` : "";
    const spa = item.spaId === undefined ? "" : ` SPA ${item.spaId}${item.resourceId === undefined ? "" : `/${item.resourceId}`}`;
    console.log(`${item.severity.toUpperCase()} [${item.code}]${where}${spa} ${item.message}`);
  }
}

function printBuiltSummary(built: BuiltAssets, moveId: number, route: string, dumpScript: boolean): void {
  console.log(`ROM: ${built.romPath} sha256=${built.romSha256}`);
  console.log(`logical move ${moveId} -> ${built.logicalTarget.sourcePath}:${built.logicalTarget.index} (${built.logicalTarget.storeName})`);
  console.log(`animation bytes=${built.animationBytes.length} sha256=${sha256(built.animationBytes)}`);
  console.log(`LoadSPA ids=${built.loadSpas.join(",") || "none"}`);
  console.log(`LoadBackground ids=${built.backgrounds.join(",") || "none"}`);
  console.log(`CallMoveAnimation ids=${built.calledAnimations.join(",") || "none"}`);
  for (const [spaId, bytes] of built.spaBytes) console.log(`${MOVE_SPA_NARC}:${spaId} bytes=${bytes.length} sha256=${sha256(bytes)}`);
  console.log(`expanded route=${route}`);
  if (dumpScript) console.log(built.script);
}

function printBuiltRecord(record: MoveAnimationFinishRecord): void {
  console.log(`Generated/staged/built hashes match for ${record.generated.length} file(s).`);
  console.log(`Built ROM sha256=${record.builtRom.sha256}`);
  console.log(`Expanded route=${record.builtRom.expandedRoute}`);
  console.log(`Dependencies: SPA=${record.dependencies.loadSpas.join(",") || "none"} backgrounds=${record.dependencies.backgrounds.join(",") || "none"} calls=${record.dependencies.calledAnimations.join(",") || "none"}`);
}

async function resolveConfig(args: ParsedArgs): Promise<ResolvedMoveAnimationWorkflowConfig> {
  return resolveMoveAnimationWorkflowConfig({
    serverlessRoot: SERVERLESS_ROOT,
    cli: {
      buildRepo: option(args, "build-repo"),
      mirrorRepo: option(args, "mirror") ?? option(args, "mirror-repo"),
      cleanRom: option(args, "clean-rom"),
      outputRom: option(args, "output-rom"),
      java: option(args, "java"),
    },
  });
}

async function runInherited(command: string, argv: string[], cwd: string, env: Record<string, string> = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, argv, { cwd, env: { ...process.env, ...env }, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? signal ?? "unknown status"}`)));
  });
}

async function runCapture(command: string, argv: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, argv, { env: process.env });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.once("error", (error) => resolve({ code: null, output: error.message }));
    child.once("exit", (code) => resolve({ code, output: output.trim() }));
  });
}

async function listedIds(dir: string, pattern: RegExp): Promise<number[]> {
  const names = await readdir(dir);
  const ids = names.flatMap((name) => {
    const match = pattern.exec(name);
    return match ? [Number.parseInt(match[1] ?? "", 10)] : [];
  });
  if (!ids.length) throw new Error(`No matching files found in ${dir}.`);
  return ids.sort((a, b) => a - b);
}

function gapsInRange(ids: number[], start: number, end: number): number[] {
  const set = new Set(ids);
  const gaps: number[] = [];
  for (let id = start; id <= end; id += 1) if (!set.has(id)) gaps.push(id);
  return gaps;
}

function stageTargets(args: ParsedArgs): StageTarget[] {
  const raw = option(args, "target") ?? "both";
  if (raw === "both") return ["mirror", "build"];
  if (raw === "mirror" || raw === "build") return [raw];
  throw new Error("--target must be mirror, build, or both");
}

async function reserveSpaIds(config: ResolvedMoveAnimationWorkflowConfig, count: number): Promise<number[]> {
  if (count === 0) return [];
  const used = new Set<number>();
  for (const directory of [spaStageDir(config.values.mirrorRepo), spaStageDir(config.values.buildRepo)]) {
    for (const name of await readdir(directory)) {
      const match = /^6_0*(\d+)\.bin$/u.exec(name);
      if (match) used.add(Number.parseInt(match[1] ?? "", 10));
    }
  }
  const activeWork = path.join(config.workspaceRoot, "work");
  if ((await pathKind(activeWork)) === "directory") {
    for (const entry of await readdir(activeWork, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "archive") continue;
      const manifestPath = path.join(activeWork, entry.name, "moveanim.json");
      if ((await pathKind(manifestPath)) !== "file") continue;
      const active = await readMoveAnimationManifest(manifestPath);
      for (const id of active.manifest.reservedSpaIds ?? []) used.add(id);
    }
  }
  const result: number[] = [];
  let candidate = Math.max(0, ...used) + 1;
  while (result.length < count) {
    if (!used.has(candidate)) result.push(candidate);
    candidate += 1;
  }
  return result;
}

async function writeDonorWorkspace(outDir: string, move: MoveAnimationReferenceEntry, inspection: DonorAssetInspection): Promise<void> {
  const directory = path.join(outDir, "donors", `move-${move.moveId}`);
  await mkdir(directory, { recursive: true });
  const padded = move.moveId.toString().padStart(8, "0");
  await writeFile(path.join(directory, `5_${padded}.bin`), inspection.animation);
  await writeFile(path.join(directory, `5_${padded}.s`), inspection.script);
  for (const [spaId, bytes] of inspection.spaFiles) await writeFile(path.join(directory, `6_${spaId.toString().padStart(8, "0")}.bin`), bytes);
  await writeFile(path.join(directory, "inspection.json"), `${JSON.stringify({
    moveId: move.moveId,
    moveName: move.moveName,
    phases: inspection.phases,
    spaTextures: inspection.spaTextures,
    calledAnimations: inspection.calledAnimations,
  }, null, 2)}\n`);
}

function makeStartGeneratorTemplate(
  outDir: string,
  donor: MoveAnimationReferenceEntry,
  sourceSpaIds: number[],
  reservedSpaIds: number[],
  scriptName: string,
  spaNames: string[],
): string {
  const modelImportPath = moduleImportPath(outDir, path.join(SERVERLESS_ROOT, "src/pokeweb/moveAnimationModel"));
  const spaImportPath = moduleImportPath(outDir, path.join(SERVERLESS_ROOT, "src/pokeweb/nitroSpa"));
  const transformImportPath = moduleImportPath(outDir, path.join(SERVERLESS_ROOT, "src/pokeweb/spaTransform"));
  const donorPadded = donor.moveId.toString().padStart(8, "0");
  const mappings = sourceSpaIds.map((source, index) => `  [${source}, ${reservedSpaIds[index]}],`).join("\n");
  const spaCopies = sourceSpaIds.map((source, index) => `{
  const donorSpa = parseSpaArchive(new Uint8Array(await readFile(path.join(WORK_DIR, "donors/move-${donor.moveId}/6_${source.toString().padStart(8, "0")}.bin"))));
  const customSpa = extractSpaResources(donorSpa, donorSpa.resources.map((resource) => resource.index), () => PRESERVE_DONOR_FIELDS).archive;
  await writeFile(path.join(OUT_DIR, "${spaNames[index]}"), serializeSpaArchive(customSpa));
}`).join("\n");
  return `import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { decompileMoveAnimationBytes, remapMoveAnimationParticleIds } from "${modelImportPath}";
import { parseSpaArchive, serializeSpaArchive } from "${spaImportPath}";
import { extractSpaResources, type SpaResourceClonePolicy } from "${transformImportPath}";

const WORK_DIR = import.meta.dirname;
const OUT_DIR = path.join(WORK_DIR, "generated");
const DONOR_ANIMATION = path.join(WORK_DIR, "donors/move-${donor.moveId}/5_${donorPadded}.bin");
const SPA_MAP = new Map<number, number>([
${mappings}
]);
const PRESERVE_DONOR_FIELDS: SpaResourceClonePolicy = {
  color: "preserve",
  alpha: "preserve",
  scale: "preserve",
  texture: "preserve",
  child: "preserve",
  startDelay: "preserve",
  behaviors: "preserve",
};

await mkdir(OUT_DIR, { recursive: true });
const donorBytes = new Uint8Array(await readFile(DONOR_ANIMATION));
const remapped = remapMoveAnimationParticleIds(donorBytes, SPA_MAP);
await writeFile(path.join(OUT_DIR, "${scriptName}"), decompileMoveAnimationBytes(remapped.bytes));
${spaCopies || "// This donor has no custom SPA reservation."}

console.log(\`Wrote ${scriptName}; remapped \${remapped.referencesChanged} SPA reference(s).\`);
`;
}

function renderStartReadme(moveId: number, slug: string, donors: MoveAnimationReferenceEntry[], reservedSpaIds: number[]): string {
  return `# ${slug}\n\nActive generator workspace for move ${moveId}. The generator is the source of truth until finalization.\n\n## Donors\n\n${donors.map((donor) => `- ${donor.moveId}: ${donor.moveName}`).join("\n")}\n\n## Reserved SPAs\n\n${reservedSpaIds.length ? reservedSpaIds.map((id) => `- ${id}`).join("\n") : "None."}\n\nUse the generic \`segments\`, \`extract-segment\`, \`compose\`, \`inspect-spa\`, \`diff-spa\`, and \`lint\` commands. Do not add move-specific inspectors unless the move introduces a genuinely new invariant.\n`;
}

function parseSegmentSpec(spec: string): {
  name: string;
  file: string;
  selection: { label?: string; phase?: MoveAnimationPhaseName; from?: number; to?: number };
} {
  const equals = spec.indexOf("=");
  const hash = spec.lastIndexOf("#");
  if (equals <= 0 || hash <= equals + 1 || hash === spec.length - 1) throw new Error(`Invalid --segment ${spec}; expected name=file#phase or name=file#LABEL:start-end.`);
  const name = spec.slice(0, equals);
  const file = path.resolve(spec.slice(equals + 1, hash));
  const selector = spec.slice(hash + 1);
  const phases: MoveAnimationPhaseName[] = ["setup", "gather", "projectile", "impact", "healing", "background", "cleanup"];
  if (phases.includes(selector as MoveAnimationPhaseName)) return { name, file, selection: { phase: selector as MoveAnimationPhaseName } };
  const match = /^(?:([A-Za-z_][A-Za-z0-9_]*):)?(\d+)-(\d+)$/u.exec(selector);
  if (!match) throw new Error(`Invalid segment selector ${selector}; use a phase name or LABEL:start-end.`);
  return {
    name,
    file,
    selection: {
      label: match[1],
      from: Number.parseInt(match[2] ?? "", 10),
      to: Number.parseInt(match[3] ?? "", 10),
    },
  };
}

function moduleImportPath(fromDirectory: string, modulePath: string): string {
  const relative = toPosix(path.relative(fromDirectory, modulePath));
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function csvValues(value: string): string[] {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function parseNonNegativeInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== value.trim()) throw new Error(`${label} must be a non-negative integer: ${value}`);
  return parsed;
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = parseNonNegativeInteger(value, label);
  if (parsed < 1) throw new Error(`${label} must be at least 1.`);
  return parsed;
}

function makeGeneratorTemplate(moveId: number, generatedName: string, scriptForCompile: string, binForCompile: string): string {
  return `import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const WORK_DIR = import.meta.dirname;
const OUT_DIR = path.join(WORK_DIR, "generated");
const OUT_SCRIPT = path.join(OUT_DIR, "${generatedName}");

await mkdir(OUT_DIR, { recursive: true });
const script = makeScript();
await writeFile(OUT_SCRIPT, script);

console.log(\`Wrote \${OUT_SCRIPT}\`);
console.log(\`script sha256 \${sha256(new TextEncoder().encode(script))}\`);
console.log("Compile with: npm run moveanim:helper -- compile --script ${scriptForCompile} --out ${binForCompile} --move ${moveId}");

function makeScript(): string {
  return \`
TerminateMoveScript
\`.trimStart();
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
`;
}

async function writeManifest(manifestPath: string, manifest: MoveAnimationManifest): Promise<void> {
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function ensureArchiveReadme(archiveRoot: string): Promise<void> {
  const readme = path.join(archiveRoot, "README.md");
  if ((await pathKind(readme)) === "file") return;
  await writeFile(readme, "# Archived Move Animation Work\n\nArchived generators and inspectors are historical records. Ignore this subtree during ordinary donor search, lint, indexing, and agent context collection unless a task explicitly revisits one of these moves. Use `npm run moveanim:workflow -- reopen --move <id>` to create a fresh active copy and refresh its generated assets from W2U staging.\n");
}

function animationStageDir(repo: string): string {
  return path.join(repo, "data/graphics/move_animations");
}

function spaStageDir(repo: string): string {
  return path.join(repo, "data/graphics/move_spas");
}

function animationFileName(moveId: number): string {
  return `5_${moveId.toString().padStart(8, "0")}.bin`;
}

function builtRomPath(config: ResolvedMoveAnimationWorkflowConfig): string {
  return path.join(config.values.buildRepo, "build/White2Upgrade.nds");
}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv[0]?.startsWith("--")) return { command: undefined, options: new Map([[argv[0].slice(2), ["true"]]]) };
  const [command, ...rest] = argv;
  const options = new Map<string, string[]>();
  for (let index = 0; index < rest.length; index += 1) {
    const raw = rest[index];
    if (!raw?.startsWith("--")) throw new Error(`Unexpected positional argument: ${raw}`);
    const key = raw.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) options.set(key, [...(options.get(key) ?? []), "true"]);
    else {
      options.set(key, [...(options.get(key) ?? []), next]);
      index += 1;
    }
  }
  return { command, options };
}

function requiredOption(args: ParsedArgs, key: string): string {
  const value = option(args, key);
  if (!value) throw new Error(`Missing required --${key}`);
  return value;
}

function option(args: ParsedArgs, key: string): string | undefined {
  return args.options.get(key)?.at(-1);
}

function values(args: ParsedArgs, key: string): string[] {
  return args.options.get(key) ?? [];
}

function numberValues(args: ParsedArgs, key: string): number[] {
  return values(args, key).map((value) => parseMoveId(value, `--${key}`));
}

function parseMoveId(value: string, label = "--move"): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative integer: ${value}`);
  return parsed;
}

function formatColor(color: [number, number, number]): string {
  return `#${color.map((component) => Math.round(Math.max(0, Math.min(1, component)) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function formatJson(value: unknown): string {
  return value === undefined ? "none" : JSON.stringify(value, (_key, entry) => typeof entry === "number" && !Number.isInteger(entry) ? Number(entry.toFixed(5)) : entry);
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function isInsideOrEqual(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function printHelp(): void {
  console.log(`
Move animation workflow helper

Configuration precedence: CLI > environment > .moveanim.local.json > portable defaults.
Run "npm run moveanim:workflow -- doctor" to inspect every resolved path.

Commands
  brief
  doctor [--build-repo <dir>] [--mirror <dir>] [--clean-rom <rom>] [--output-rom <rom>] [--java <exe>]
  next-spa [--repo <dir> ...]
  find-donor [--tag <tag> ...] [--sound <id> ...] [--query <text>] [--no-background] [--json]
  start --move <id> --slug <slug> --donors <id,id,...> [--spa-count <count>] [--out <dir>]
  segments --file <animation.bin|script.s> [--json]
  extract-segment --file <animation.bin|script.s> --name <name> (--phase <phase> | --from <n> --to <n>) --out <file>
  compose --segment <name=file#phase|name=file#LABEL:start-end> ... --out <script.s>
  snapshots --manifest ../work/<slug>/moveanim.json [--frames auto|0,10,20]
  inspect-script --file <animation.bin|script.s> [--json]
  inspect-spa --file <spa.bin> [--resource <id>] [--json]
  diff-spa --before <spa> --after <spa> [--allow color,colorAnim] [--json]
  lint --manifest ../work/<slug>/moveanim.json [--json]
  stage --move <id> --bin <animation.bin> [--spa <spa.bin> ...] [--target mirror|build|both]
  verify-built [--rom <built.nds>] (--move <id> | --manifest <moveanim.json>) [expectation options]
  finish --manifest ../work/<slug>/moveanim.json [--resume generate|compile|lint|stage|build|verify|copy]
  finalize --manifest ../work/<slug>/moveanim.json --archive-work
  reopen --move <id>
  scaffold --slug <slug> --move <id> [--out <dir>]

Environment overrides
  MOVEANIM_BUILD_REPO MOVEANIM_MIRROR_REPO MOVEANIM_CLEAN_ROM MOVEANIM_OUTPUT_ROM MOVEANIM_JAVA
`.trim());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
