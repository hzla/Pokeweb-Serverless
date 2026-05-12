import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildPokemonAnimationAssetBundle,
  packagePokemonCustomSpriteBundle,
  packagePokemonAnimationBundle,
  parsePokemonAnimationBundle,
  type PokemonAnimationBuildPart,
  type PokemonAnimationBundleFileIndex,
} from "../src/pokeweb/pokemonSpriteWriters";
import { compressLz11Literal, type PokemonAnimationSide } from "../src/pokeweb/pokemonSpriteModel";
import {
  analyzeMotion,
  analyzePalette,
  decodeGifFrames,
  decodePng,
  encodePng,
  normalizeAnimationFrames,
  palettePng,
  quantizeFrames,
  type AnimationAnalysisFrame,
  type Box,
  type MotionReport,
  type PaletteReport,
} from "../src/pokeweb/pokemonAnimationAnalysis";

type ParsedArgs = {
  command?: string;
  options: Map<string, string[]>;
};

type BundleManifest = {
  name: string;
  sourceGif: string;
  createdAt: string;
  targetSize: { width: number; height: number };
  source: { width: number; height: number; frameCount: number; delaysMs: number[] };
  contentBounds?: Box;
  cropBounds: Box;
  frameCount: number;
  delaysMs: number[];
  frontSprite: string;
  frames: Array<{ index: number; delayMs: number; file: string }>;
  paletteStatus?: { compatible: boolean; opaqueColorCount: number; quantized: boolean };
  warnings: string[];
};

type RigCellsJson = {
  cells?: unknown[];
  parts?: unknown[];
};

type RigPlanJson = {
  parts?: Array<{
    id?: number;
    name?: string;
    suggestedZ?: number;
    z?: number;
    suggestedPivotLocal?: { x?: number; y?: number };
    pivot?: { x?: number; y?: number };
    frames?: unknown[];
    keyframes?: unknown[];
  }>;
};

type Frame0ValidationReport = {
  missingPixelCount: number;
  extraPixelCount: number;
  colorMismatchCount: number;
  totalMismatchedPixels: number;
  missingBounds?: Box;
  extraBounds?: Box;
  colorMismatchBounds?: Box;
  sampleMissingPixels: Array<{ x: number; y: number }>;
  sampleExtraPixels: Array<{ x: number; y: number }>;
  sampleColorMismatchPixels: Array<{ x: number; y: number }>;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || args.options.has("help") || args.options.has("h")) {
    printHelp();
    return;
  }

  if (args.command === "analyze") {
    await analyzeCommand(args);
    return;
  }
  if (args.command === "palette") {
    await paletteCommand(args);
    return;
  }
  if (args.command === "motion") {
    await motionCommand(args);
    return;
  }
  if (args.command === "build-animation") {
    await buildAnimationCommand(args);
    return;
  }
  if (args.command === "build-custom-bundle") {
    await buildCustomBundleCommand(args);
    return;
  }
  if (args.command === "validate-frame0") {
    await validateFrame0Command(args);
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

async function analyzeCommand(args: ParsedArgs): Promise<void> {
  const gifPath = requiredOption(args, "gif");
  const outDir = requiredOption(args, "out");
  const name = requiredOption(args, "name");
  const sourceFrames = decodeGifFrames(await readFileBytes(gifPath));
  const normalized = normalizeAnimationFrames(sourceFrames);
  const framesDir = path.join(outDir, "frames");

  await mkdir(framesDir, { recursive: true });
  for (const frame of normalized.frames) {
    await writeFile(path.join(outDir, frameFile(frame.index)), encodePng(frame));
  }
  await writeFile(path.join(outDir, "front_sprite.png"), encodePng(normalized.frames[0]!));

  const manifest: BundleManifest = {
    name,
    sourceGif: path.resolve(gifPath),
    createdAt: new Date().toISOString(),
    targetSize: { width: 96, height: 96 },
    source: normalized.source,
    contentBounds: normalized.contentBounds,
    cropBounds: normalized.cropBounds,
    frameCount: normalized.frames.length,
    delaysMs: normalized.frames.map((frame) => frame.delayMs),
    frontSprite: "front_sprite.png",
    frames: normalized.frames.map((frame) => ({ index: frame.index, delayMs: frame.delayMs, file: frameFile(frame.index) })),
    warnings: normalized.warnings,
  };
  await writeJson(path.join(outDir, "manifest.json"), manifest);
  await writeHandoffDocs(outDir, manifest);
  console.log(`Analyzed ${normalized.frames.length} frame(s) into ${outDir}`);
}

async function paletteCommand(args: ParsedArgs): Promise<void> {
  const bundleDir = requiredOption(args, "bundle");
  const manifest = await readManifest(bundleDir);
  const frames = await readBundleFrames(bundleDir, manifest);
  const report = analyzePalette(frames);
  const paletteImage = "palette.png";
  const payload: PaletteReport & {
    paletteImage: string;
    quantizedFramesDir?: string;
    quantizedFrontSprite?: string;
    quantizedPaletteImage?: string;
    quantizedColors?: Array<{ r: number; g: number; b: number }>;
    sourceOpaqueColorCount?: number;
  } = { ...report, paletteImage };

  await writeFile(path.join(bundleDir, paletteImage), palettePng(report.colors));

  if (args.options.has("quantize")) {
    const quantized = quantizeFrames(frames);
    const quantizedReport = analyzePalette(quantized.frames);
    const quantizedDir = path.join(bundleDir, "quantized_frames");
    await mkdir(quantizedDir, { recursive: true });
    for (const frame of quantized.frames) {
      await writeFile(path.join(quantizedDir, path.basename(frameFile(frame.index))), encodePng(frame));
    }
    await writeFile(path.join(bundleDir, "front_sprite_quantized.png"), encodePng(quantized.frames[0]!));
    await writeFile(path.join(bundleDir, "palette_quantized.png"), palettePng(quantized.palette));
    Object.assign(payload, {
      ...quantizedReport,
      quantized: true,
      sourceOpaqueColorCount: report.opaqueColorCount,
      quantizedFramesDir: "quantized_frames",
      quantizedFrontSprite: "front_sprite_quantized.png",
      quantizedPaletteImage: "palette_quantized.png",
      quantizedColors: quantized.palette,
      warnings: [...report.warnings, ...quantizedReport.warnings.filter((warning) => !report.warnings.includes(warning))],
    });
  }

  manifest.paletteStatus = {
    compatible: payload.compatible,
    opaqueColorCount: payload.opaqueColorCount,
    quantized: payload.quantized,
  };
  await writeJson(path.join(bundleDir, "palette_report.json"), payload);
  await writeJson(path.join(bundleDir, "manifest.json"), manifest);
  await writeHandoffDocs(bundleDir, manifest, payload);
  console.log(`Wrote palette report for ${manifest.name}: ${payload.opaqueColorCount} opaque color(s)`);
}

async function motionCommand(args: ParsedArgs): Promise<void> {
  const bundleDir = requiredOption(args, "bundle");
  const manifest = await readManifest(bundleDir);
  const frames = await readBundleFrames(bundleDir, manifest);
  const motion = analyzeMotion(frames);
  const diffDir = path.join(bundleDir, "frame_diffs");
  const maskDir = path.join(bundleDir, "motion_masks");

  await mkdir(diffDir, { recursive: true });
  await mkdir(maskDir, { recursive: true });
  for (let index = 0; index < motion.frameDiffs.length; index += 1) {
    const frame = frames[index]!;
    const name = path.basename(frameFile(frame.index));
    await writeFile(path.join(diffDir, name), encodePng({ width: frame.width, height: frame.height, pixels: motion.frameDiffs[index]! }));
    await writeFile(path.join(maskDir, name), encodePng({ width: frame.width, height: frame.height, pixels: maskFromDiff(motion.frameDiffs[index]!) }));
  }
  await writeFile(path.join(bundleDir, "motion_union.png"), encodePng({ width: frames[0]!.width, height: frames[0]!.height, pixels: motion.unionMask }));
  await writeFile(path.join(bundleDir, "stable_mask.png"), encodePng({ width: frames[0]!.width, height: frames[0]!.height, pixels: motion.stableMask }));
  await writeJson(path.join(bundleDir, "motion_report.json"), {
    ...motion.report,
    motionMasksDir: "motion_masks",
    frameDiffsDir: "frame_diffs",
    motionUnionImage: "motion_union.png",
    stableMaskImage: "stable_mask.png",
  });
  const paletteReport = await readJsonIfExists<PaletteReport>(path.join(bundleDir, "palette_report.json"));
  await writeHandoffDocs(bundleDir, manifest, paletteReport, motion.report);
  console.log(`Wrote motion report for ${manifest.name}: ${motion.report.candidateParts.length} candidate region(s)`);
}

async function buildAnimationCommand(args: ParsedArgs): Promise<void> {
  const bundleDir = requiredOption(args, "bundle");
  const outDir = requiredOption(args, "out");
  const side = parseSide(option(args, "side") ?? "front");
  const cellsPath = path.resolve(bundleDir, option(args, "cells") ?? (await findBundleFile(bundleDir, "rig_cells.json")));
  const planPath = await optionalBundlePath(bundleDir, option(args, "plan"), "rig_plan.json");
  const cellsJson = await readJsonFile<RigCellsJson>(cellsPath);
  const planJson = planPath ? await readJsonFile<RigPlanJson>(planPath) : undefined;
  const frameDuration = option(args, "frame-duration") ? Number(option(args, "frame-duration")) : undefined;
  const loopDuration = option(args, "loop-duration") ? Number(option(args, "loop-duration")) : undefined;
  const parts = buildPartsFromRigFiles(cellsJson, planJson);
  const bundle = buildPokemonAnimationAssetBundle({ side, parts, frameDuration, loopDuration });
  const compressed = {
    side,
    files: Object.fromEntries(
      Object.entries(bundle.files).map(([index, file]) => {
        const fileIndex = Number(index) as PokemonAnimationBundleFileIndex;
        return [fileIndex, shouldCompressAnimationFile(fileIndex) ? compressLz11Literal(file) : file];
      }),
    ) as typeof bundle.files,
  };

  await mkdir(outDir, { recursive: true });
  const prefix = side === "front" ? "front" : "back";
  const labels: Partial<Record<PokemonAnimationBundleFileIndex, string>> = {
    4: "ncer",
    5: "nanr",
    6: "nmcr",
    7: "nmar",
    8: "ncec",
    13: "ncer",
    14: "nanr",
    15: "nmcr",
    16: "nmar",
    17: "ncec",
  };
  const writtenFiles: Array<{ index: number; file: string; bytes: number; compressed: boolean }> = [];
  for (const [rawIndex, file] of Object.entries(compressed.files)) {
    if (!file) continue;
    const index = Number(rawIndex) as PokemonAnimationBundleFileIndex;
    const fileName = `${prefix}_${labels[index] ?? `file${index}`}.bin`;
    await writeFile(path.join(outDir, fileName), file);
    writtenFiles.push({ index, file: fileName, bytes: file.length, compressed: shouldCompressAnimationFile(index) });
  }
  const packageName = `${prefix}_animation.pkanimbundle`;
  await writeFile(path.join(outDir, packageName), packagePokemonAnimationBundle(compressed));
  await writeJson(path.join(outDir, `${prefix}_animation_manifest.json`), {
    format: "pokeweb-pokemon-animation-bundle-v1",
    side,
    sourceBundle: path.resolve(bundleDir),
    cells: path.relative(outDir, cellsPath),
    plan: planPath ? path.relative(outDir, planPath) : undefined,
    package: packageName,
    parts: parts.map((part, index) => ({ index, name: part.name ?? `Part ${index}`, z: part.z ?? 0, frames: part.frames?.length ?? 1 })),
    files: writtenFiles,
  });
  console.log(`Built ${side} animation bundle with ${parts.length} part(s): ${path.join(outDir, packageName)}`);
}

async function buildCustomBundleCommand(args: ParsedArgs): Promise<void> {
  const bundleDir = requiredOption(args, "bundle");
  const outDir = requiredOption(args, "out");
  const side = parseSide(option(args, "side") ?? "front");
  const animationPath = await optionalExistingPath(bundleDir, option(args, "animation") ?? "generated-keyed/front_animation.pkanimbundle");
  const frontSpritePath = await optionalBundlePath(bundleDir, option(args, "front-sprite"), "front_sprite.png");
  const backSpritePath = await optionalBundlePath(bundleDir, option(args, "back-sprite"), "back_sprite.png");
  const rigPath = await optionalBundlePath(bundleDir, option(args, "front-rig"), "front_rig_256x128_ds.png");
  const backRigPath = await optionalBundlePath(bundleDir, option(args, "back-rig"), "back_rig_256x128_ds.png");
  const palettePath = await optionalBundlePath(bundleDir, option(args, "palette"), "palette_ds.png");
  const shinyPalettePath = await optionalBundlePath(bundleDir, option(args, "shiny-palette"), "shiny_palette_ds.png");
  const name = option(args, "name") ?? path.basename(bundleDir).replace(/[^a-z0-9_-]+/giu, "_");
  const animation = animationPath ? parsePokemonAnimationBundle(await readFileBytes(animationPath)) : undefined;
  if (animation && animation.side !== side) throw new Error(`Animation bundle side ${animation.side} does not match requested side ${side}`);
  const files = await readExplicitFileSections(bundleDir, args.options.get("file") ?? []);
  const hasPngAssets = Boolean(frontSpritePath || backSpritePath || rigPath || backRigPath);
  if (hasPngAssets && !palettePath) throw new Error("A normal palette PNG is required when bundling sprite or rig PNG assets");
  const normalPalette = palettePath ? await readPalettePngColors(palettePath) : undefined;
  const output = packagePokemonCustomSpriteBundle({
    side,
    animation,
    files,
    frontSpritePng: frontSpritePath ? await remapPngFileToPalette(frontSpritePath, normalPalette!) : undefined,
    backSpritePng: backSpritePath ? await remapPngFileToPalette(backSpritePath, normalPalette!) : undefined,
    frontRigPng: rigPath ? await remapPngFileToPalette(rigPath, normalPalette!) : undefined,
    backRigPng: backRigPath ? await remapPngFileToPalette(backRigPath, normalPalette!) : undefined,
    normalPalettePng: palettePath ? await readFileBytes(palettePath) : undefined,
    shinyPalettePng: shinyPalettePath ? await readFileBytes(shinyPalettePath) : undefined,
  });

  await mkdir(outDir, { recursive: true });
  const packageName = `${name}_${side}_custom.pkmonspritebundle`;
  await writeFile(path.join(outDir, packageName), output);
  await writeJson(path.join(outDir, `${name}_${side}_custom_manifest.json`), {
    format: "pokeweb-custom-sprite-bundle-v1",
    side,
    package: packageName,
    sourceBundle: path.resolve(bundleDir),
    animation: animationPath ? path.relative(outDir, animationPath) : undefined,
    frontSprite: frontSpritePath ? path.relative(outDir, frontSpritePath) : undefined,
    backSprite: backSpritePath ? path.relative(outDir, backSpritePath) : undefined,
    frontRig: rigPath ? path.relative(outDir, rigPath) : undefined,
    backRig: backRigPath ? path.relative(outDir, backRigPath) : undefined,
    normalPalette: palettePath ? path.relative(outDir, palettePath) : undefined,
    shinyPalette: shinyPalettePath ? path.relative(outDir, shinyPalettePath) : undefined,
    rawFiles: Object.keys(files).map(Number).sort((a, b) => a - b),
    bytes: output.length,
  });
  console.log(`Built custom sprite bundle: ${path.join(outDir, packageName)}`);
}

async function validateFrame0Command(args: ParsedArgs): Promise<void> {
  const bundleDir = requiredOption(args, "bundle");
  const outDir = path.resolve(bundleDir, option(args, "out") ?? "frame0_validation");
  const cellsPath = path.resolve(bundleDir, option(args, "cells") ?? (await findBundleFile(bundleDir, "rig_cells.json")));
  const planPath = await optionalBundlePath(bundleDir, option(args, "plan"), "rig_plan.json");
  const rigPath = await optionalBundlePath(bundleDir, option(args, "rig"), "front_rig_256x128_ds.png");
  const frontSpritePath = await optionalBundlePath(bundleDir, option(args, "front-sprite"), "front_sprite.png");
  if (!rigPath) throw new Error("validate-frame0 requires a rig PNG via --rig or *front_rig_256x128_ds.png");
  if (!frontSpritePath) throw new Error("validate-frame0 requires a front sprite PNG via --front-sprite or front_sprite.png");

  const cellsJson = await readJsonFile<RigCellsJson>(cellsPath);
  const planJson = planPath ? await readJsonFile<RigPlanJson>(planPath) : undefined;
  const parts = buildPartsFromRigFiles(cellsJson, planJson);
  const rig = decodePng(await readFileBytes(rigPath));
  const expected = decodePng(await readFileBytes(frontSpritePath));
  const actual = renderFrame0Composite(parts, rig, expected.width, expected.height);
  const report = compareFrame0(expected, actual);
  const diff = frame0DiffImage(expected, actual);

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "frame0_reconstructed.png"), encodePng(actual));
  await writeFile(path.join(outDir, "frame0_diff.png"), encodePng(diff));
  await writeJson(path.join(outDir, "frame0_validation_report.json"), {
    format: "pokeweb-frame0-validation-v1",
    frontSprite: path.relative(outDir, frontSpritePath),
    rig: path.relative(outDir, rigPath),
    cells: path.relative(outDir, cellsPath),
    plan: planPath ? path.relative(outDir, planPath) : undefined,
    ...report,
    warnings: frame0ValidationWarnings(report),
  });
  console.log(
    `Frame 0 validation: ${report.missingPixelCount} missing, ${report.extraPixelCount} extra, ${report.colorMismatchCount} color mismatch(es). Wrote ${outDir}`,
  );
}

async function readBundleFrames(bundleDir: string, manifest: BundleManifest): Promise<AnimationAnalysisFrame[]> {
  const frames: AnimationAnalysisFrame[] = [];
  for (const entry of manifest.frames) {
    frames.push(decodePng(await readFileBytes(path.join(bundleDir, entry.file)), entry.index, entry.delayMs));
  }
  return frames;
}

async function readManifest(bundleDir: string): Promise<BundleManifest> {
  return JSON.parse(await readFile(path.join(bundleDir, "manifest.json"), "utf8")) as BundleManifest;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function readPalettePngColors(filePath: string): Promise<Array<{ r: number; g: number; b: number }>> {
  const image = decodePng(await readFileBytes(filePath), 0, 0);
  if (image.width < 16 || image.height < 1) throw new Error("Palette PNG must be at least 16 x 1");
  return Array.from({ length: 16 }, (_, index) => {
    const offset = index * 4;
    return dsRoundColor({
      r: image.pixels[offset] ?? 0,
      g: image.pixels[offset + 1] ?? 0,
      b: image.pixels[offset + 2] ?? 0,
    });
  });
}

async function remapPngFileToPalette(filePath: string, palette: Array<{ r: number; g: number; b: number }>): Promise<Uint8Array> {
  const image = decodePng(await readFileBytes(filePath), 0, 0);
  const next = new Uint8ClampedArray(image.pixels);
  for (let offset = 0; offset < next.length; offset += 4) {
    if ((next[offset + 3] ?? 0) < 128) {
      next[offset] = 0;
      next[offset + 1] = 0;
      next[offset + 2] = 0;
      next[offset + 3] = 0;
      continue;
    }
    const color = nearestPaletteColor({ r: next[offset] ?? 0, g: next[offset + 1] ?? 0, b: next[offset + 2] ?? 0 }, palette);
    next[offset] = color.r;
    next[offset + 1] = color.g;
    next[offset + 2] = color.b;
    next[offset + 3] = 255;
  }
  return encodePng({ width: image.width, height: image.height, pixels: next });
}

function nearestPaletteColor(color: { r: number; g: number; b: number }, palette: Array<{ r: number; g: number; b: number }>): { r: number; g: number; b: number } {
  const usable = palette.slice(1);
  let best = usable[0] ?? { r: 0, g: 0, b: 0 };
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of usable) {
    const distance = (color.r - candidate.r) ** 2 + (color.g - candidate.g) ** 2 + (color.b - candidate.b) ** 2;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function dsRoundColor(color: { r: number; g: number; b: number }): { r: number; g: number; b: number } {
  return {
    r: Math.floor(Math.min(31, Math.ceil(clampByte(color.r) / 8.25)) * 8.25),
    g: Math.floor(Math.min(31, Math.ceil(clampByte(color.g) / 8.25)) * 8.25),
    b: Math.floor(Math.min(31, Math.ceil(clampByte(color.b) / 8.25)) * 8.25),
  };
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

async function writeHandoffDocs(bundleDir: string, manifest: BundleManifest, palette?: PaletteReport, motion?: MotionReport): Promise<void> {
  await writeFile(path.join(bundleDir, "analysis.md"), renderAnalysisMarkdown(manifest, palette, motion));
  await writeFile(path.join(bundleDir, "questions.md"), renderQuestionsMarkdown(manifest, palette, motion));
  await writeFile(path.join(bundleDir, "question_guide.md"), renderQuestionGuideMarkdown());
}

function renderAnalysisMarkdown(manifest: BundleManifest, palette?: PaletteReport, motion?: MotionReport): string {
  const lines = [
    `# ${manifest.name} Animation Analysis`,
    "",
    `- Source GIF: ${manifest.sourceGif}`,
    `- Frames: ${manifest.frameCount}`,
    `- Source size: ${manifest.source.width}x${manifest.source.height}`,
    `- Normalized size: ${manifest.targetSize.width}x${manifest.targetSize.height}`,
    `- Crop bounds: ${formatBox(manifest.cropBounds)}`,
  ];
  if (manifest.contentBounds) lines.push(`- Visible content bounds: ${formatBox(manifest.contentBounds)}`);
  if (manifest.warnings.length > 0) lines.push("", "## Normalize Warnings", ...manifest.warnings.map((warning) => `- ${warning}`));
  if (palette) {
    lines.push("", "## Palette", `- Compatible with Gen 5 15 opaque colors + transparency: ${palette.compatible ? "yes" : "no"}`, `- Opaque colors: ${palette.opaqueColorCount}`, `- Transparent pixels: ${palette.transparentPixelCount}`);
    if (palette.warnings.length > 0) lines.push(...palette.warnings.map((warning) => `- ${warning}`));
  }
  if (motion) {
    lines.push("", "## Motion", `- Changed pixels across animation: ${motion.changedPixelCount}`, `- Changed bounds: ${motion.changedBounds ? formatBox(motion.changedBounds) : "none"}`, `- Candidate moving regions: ${motion.candidateParts.length}`);
    for (const part of motion.candidateParts.slice(0, 12)) {
      lines.push(`- Part ${part.id}: ${part.description}, ${formatBox(part.bounds)}, ${part.changedPixelCount} changed pixel(s), present in ${part.framesPresent.length} frame(s)`);
    }
    if (motion.warnings.length > 0) lines.push("", "## Motion Warnings", ...motion.warnings.map((warning) => `- ${warning}`));
  }
  lines.push("");
  return lines.join("\n");
}

function renderQuestionsMarkdown(manifest: BundleManifest, palette?: PaletteReport, motion?: MotionReport): string {
  const questions = [
    `# ${manifest.name} Rig Planning Questions`,
    "",
    "- Which visible body parts should become independent Gen 5 rig cells?",
  ];
  if (motion && motion.candidateParts.length > 0) {
    questions.push("", "## Regions To Review");
    for (const part of motion.candidateParts.slice(0, 12)) {
      const notes = part.notes.length > 0 ? ` Notes: ${part.notes.join("; ")}.` : "";
      questions.push(`- Part ${part.id}: ${part.description}, ${formatBox(part.bounds)}, visible in ${part.framesPresent.length} motion frame(s).${notes}`);
    }
    questions.push("");
  }
  questions.push(
    "- Please answer using recognizable art labels when possible, such as \"brown tail\", \"yellow waving jagged cloth\", \"left ear tip\", or \"shadow under body\".",
    "- What z-order should overlapping parts use when the source GIF is ambiguous?",
  );
  if (palette && !palette.compatible) {
    questions.push("- The source exceeds the Gen 5 color budget. Should we quantize/remap, hand-pick colors, or adjust the source art first?");
  }
  if (motion?.warnings.some((warning) => warning.includes("transparent in frame 0"))) {
    questions.push("- Some pixels appear only after frame 0. Should those pixels be recovered into the rig atlas from later frames, approximated, or ignored?");
  }
  if (motion?.warnings.some((warning) => warning.includes("disappear"))) {
    questions.push("- Some frame-0 pixels disappear later. Is that intentional occlusion, deformation, or should we split that region into multiple cells?");
  }
  if (motion?.candidateParts.some((part) => part.notes.length > 0)) {
    questions.push("- Several motion regions look sparse/intermittent. Which should be split into smaller pieces, and which should be approximated with rotation/scale?");
  }
  if (motion?.warnings.some((warning) => warning.includes("deformation"))) {
    questions.push("- Some frames look like deformation rather than rigid part motion. Should we approximate with rotation/scale, split the art into more cells, or draw alternate cells?");
  }
  questions.push("- Are any motions better represented by parking/discarding a template part instead of trying to animate it?");
  questions.push("");
  return questions.join("\n");
}

function renderQuestionGuideMarkdown(): string {
  return `# GIF-To-Gen 5 Animation Question Guide

When asking the user about motion analysis, prefer identifiable art language over generic region names.

Good examples:
- "upper-right brown tail region"
- "lower-left yellow waving jagged cloth"
- "left ear tip"
- "face shadow under the head"

Avoid relying only on:
- "candidate region"
- "Part 0"
- "the sparse component"

Part-planning answers should try to include:
- body-part name
- whether it should be one cell or split into smaller cells
- pivot point for rotation
- likely z-order
- whether missing/new pixels should be recovered from later frames, approximated, or ignored

For deformation-like motion, recommend the least complex option that preserves the read:
- Use whole-part x/y translation for simple bounce.
- Add scale only for broad squash/stretch where exact pixels are not critical.
- Split into more cells when bending needs clear hinges, like ears, tails, wings, or cloth tips.
- Draw alternate cells when the silhouette changes in a way rotation/scale cannot explain.
`;
}

function maskFromDiff(diff: Uint8ClampedArray): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(diff.length);
  for (let offset = 0; offset < diff.length; offset += 4) {
    if ((diff[offset + 3] ?? 0) === 0) continue;
    mask[offset] = 255;
    mask[offset + 1] = 255;
    mask[offset + 2] = 255;
    mask[offset + 3] = 255;
  }
  return mask;
}

function frameFile(index: number): string {
  return `frames/frame_${String(index).padStart(3, "0")}.png`;
}

function buildPartsFromRigFiles(cellsJson: RigCellsJson, planJson?: RigPlanJson): PokemonAnimationBuildPart[] {
  const rows = Array.isArray(cellsJson.cells) ? cellsJson.cells : Array.isArray(cellsJson.parts) ? cellsJson.parts : undefined;
  if (!rows) throw new Error("Rig cells JSON must contain a cells or parts array");
  const planParts = new Map<number, NonNullable<RigPlanJson["parts"]>[number]>();
  planJson?.parts?.forEach((part, index) => planParts.set(Number(part.id ?? index), part));
  return rows.map((row, index) => {
    const cell = row as {
      id?: unknown;
      name?: unknown;
      cellX?: unknown;
      cellY?: unknown;
      width?: unknown;
      height?: unknown;
      spriteX?: unknown;
      spriteY?: unknown;
      z?: unknown;
      pivot?: { x?: unknown; y?: unknown };
      atlas?: Partial<Record<"x" | "y" | "width" | "height", unknown>>;
      frames?: unknown[];
      keyframes?: unknown[];
    };
    const id = Number(cell.id ?? index);
    const plan = planParts.get(id) ?? planParts.get(index);
    const atlas = cell.atlas ?? {};
    return {
      name: String(cell.name ?? plan?.name ?? `part_${index}`),
      cellX: numberValue(cell.cellX ?? atlas.x, 0),
      cellY: numberValue(cell.cellY ?? atlas.y, 0),
      width: numberValue(cell.width ?? atlas.width, 0),
      height: numberValue(cell.height ?? atlas.height, 0),
      spriteX: numberValue(cell.spriteX, 0),
      spriteY: numberValue(cell.spriteY, 0),
      pivot: {
        x: numberValue(cell.pivot?.x ?? plan?.pivot?.x ?? plan?.suggestedPivotLocal?.x, numberValue(cell.width ?? atlas.width, 0) / 2),
        y: numberValue(cell.pivot?.y ?? plan?.pivot?.y ?? plan?.suggestedPivotLocal?.y, numberValue(cell.height ?? atlas.height, 0) / 2),
      },
      z: numberValue(cell.z ?? plan?.z ?? plan?.suggestedZ, index),
      frames: parseBuildFrames(cell.frames ?? cell.keyframes ?? plan?.frames ?? plan?.keyframes, index),
    };
  });
}

function parseBuildFrames(value: unknown, cellIndex: number): PokemonAnimationBuildPart["frames"] {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value.map((row) => {
    const frame = row as Partial<Record<"duration" | "cellIndex" | "x" | "y" | "rotation" | "xScale" | "yScale", unknown>>;
    return {
      duration: numberValue(frame.duration, DEFAULT_SCRIPT_FRAME_DURATION),
      cellIndex: numberValue(frame.cellIndex, cellIndex),
      x: numberValue(frame.x, 0),
      y: numberValue(frame.y, 0),
      rotation: numberValue(frame.rotation, 0),
      xScale: numberValue(frame.xScale, 1),
      yScale: numberValue(frame.yScale, 1),
    };
  });
}

function renderFrame0Composite(parts: PokemonAnimationBuildPart[], rig: AnimationAnalysisFrame, width: number, height: number): AnimationAnalysisFrame {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const rigTransparent = transparentColorKey(rig);
  const originX = Math.floor(width / 2);
  const originY = Math.floor(height / 2);
  const sorted = [...parts].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  for (const part of sorted) {
    const frame = part.frames?.[0] ?? { duration: DEFAULT_SCRIPT_FRAME_DURATION, cellIndex: 0, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1 };
    const pivotX = numberValue(part.pivot?.x, part.width / 2);
    const pivotY = numberValue(part.pivot?.y, part.height / 2);
    const rotation = ((frame.rotation ?? 0) * Math.PI) / 180;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const xScale = frame.xScale ?? 1;
    const yScale = frame.yScale ?? 1;
    const pivotScreenX = originX + part.spriteX + (frame.x ?? 0) + pivotX;
    const pivotScreenY = originY - part.spriteY + (frame.y ?? 0) + pivotY;
    for (let localY = 0; localY < part.height; localY += 1) {
      for (let localX = 0; localX < part.width; localX += 1) {
        const sourceX = part.cellX + localX;
        const sourceY = part.cellY + localY;
        if (sourceX < 0 || sourceY < 0 || sourceX >= rig.width || sourceY >= rig.height) continue;
        const sourceOffset = (sourceY * rig.width + sourceX) * 4;
        if (isTransparentPixel(rig.pixels, sourceOffset, rigTransparent)) continue;
        const relX = (localX - pivotX) * xScale;
        const relY = (localY - pivotY) * yScale;
        const outX = Math.round(pivotScreenX + relX * cos - relY * sin);
        const outY = Math.round(pivotScreenY + relX * sin + relY * cos);
        if (outX < 0 || outY < 0 || outX >= width || outY >= height) continue;
        const outOffset = (outY * width + outX) * 4;
        pixels[outOffset] = rig.pixels[sourceOffset] ?? 0;
        pixels[outOffset + 1] = rig.pixels[sourceOffset + 1] ?? 0;
        pixels[outOffset + 2] = rig.pixels[sourceOffset + 2] ?? 0;
        pixels[outOffset + 3] = 255;
      }
    }
  }
  return { index: 0, width, height, delayMs: 0, pixels };
}

function compareFrame0(expected: AnimationAnalysisFrame, actual: AnimationAnalysisFrame): Frame0ValidationReport {
  if (expected.width !== actual.width || expected.height !== actual.height) throw new Error("Frame 0 comparison images must have matching dimensions");
  const expectedTransparent = transparentColorKey(expected);
  const actualTransparent = transparentColorKey(actual);
  let missingPixelCount = 0;
  let extraPixelCount = 0;
  let colorMismatchCount = 0;
  let missingBounds = emptyScriptBounds();
  let extraBounds = emptyScriptBounds();
  let colorMismatchBounds = emptyScriptBounds();
  const sampleMissingPixels: Array<{ x: number; y: number }> = [];
  const sampleExtraPixels: Array<{ x: number; y: number }> = [];
  const sampleColorMismatchPixels: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < expected.height; y += 1) {
    for (let x = 0; x < expected.width; x += 1) {
      const offset = (y * expected.width + x) * 4;
      const expectedOpaque = !isTransparentPixel(expected.pixels, offset, expectedTransparent);
      const actualOpaque = !isTransparentPixel(actual.pixels, offset, actualTransparent);
      if (expectedOpaque && !actualOpaque) {
        missingPixelCount += 1;
        missingBounds = includeScriptPoint(missingBounds, x, y);
        if (sampleMissingPixels.length < 20) sampleMissingPixels.push({ x, y });
      } else if (!expectedOpaque && actualOpaque) {
        extraPixelCount += 1;
        extraBounds = includeScriptPoint(extraBounds, x, y);
        if (sampleExtraPixels.length < 20) sampleExtraPixels.push({ x, y });
      } else if (expectedOpaque && actualOpaque && !sameRgbWithinTolerance(expected.pixels, actual.pixels, offset, 18)) {
        colorMismatchCount += 1;
        colorMismatchBounds = includeScriptPoint(colorMismatchBounds, x, y);
        if (sampleColorMismatchPixels.length < 20) sampleColorMismatchPixels.push({ x, y });
      }
    }
  }
  return {
    missingPixelCount,
    extraPixelCount,
    colorMismatchCount,
    totalMismatchedPixels: missingPixelCount + extraPixelCount + colorMismatchCount,
    missingBounds: scriptBoundsToBox(missingBounds),
    extraBounds: scriptBoundsToBox(extraBounds),
    colorMismatchBounds: scriptBoundsToBox(colorMismatchBounds),
    sampleMissingPixels,
    sampleExtraPixels,
    sampleColorMismatchPixels,
  };
}

function frame0DiffImage(expected: AnimationAnalysisFrame, actual: AnimationAnalysisFrame): AnimationAnalysisFrame {
  const expectedTransparent = transparentColorKey(expected);
  const actualTransparent = transparentColorKey(actual);
  const pixels = new Uint8ClampedArray(expected.width * expected.height * 4);
  for (let y = 0; y < expected.height; y += 1) {
    for (let x = 0; x < expected.width; x += 1) {
      const offset = (y * expected.width + x) * 4;
      const expectedOpaque = !isTransparentPixel(expected.pixels, offset, expectedTransparent);
      const actualOpaque = !isTransparentPixel(actual.pixels, offset, actualTransparent);
      if (expectedOpaque && !actualOpaque) pixels.set([255, 64, 64, 255], offset);
      else if (!expectedOpaque && actualOpaque) pixels.set([64, 160, 255, 255], offset);
      else if (expectedOpaque && actualOpaque && !sameRgbWithinTolerance(expected.pixels, actual.pixels, offset, 18)) pixels.set([255, 220, 64, 255], offset);
      else if (expectedOpaque) pixels.set([120, 220, 150, 180], offset);
    }
  }
  return { index: 0, width: expected.width, height: expected.height, delayMs: 0, pixels };
}

function frame0ValidationWarnings(report: Frame0ValidationReport): string[] {
  const warnings: string[] = [];
  if (report.missingPixelCount > 0) warnings.push("Frame 0 reconstruction is missing front-sprite pixels; likely lost border/interior art or stale cell placement");
  if (report.extraPixelCount > 0) warnings.push("Frame 0 reconstruction has extra pixels; likely duplicated overlap or protruding pixels owned by the wrong cell");
  if (report.colorMismatchCount > 0) warnings.push("Frame 0 reconstruction has color mismatches; check palette rounding/remapping or source asset mismatch");
  return warnings;
}

function transparentColorKey(frame: AnimationAnalysisFrame): [number, number, number] | undefined {
  const alpha = frame.pixels[3] ?? 0;
  if (alpha === 0) return undefined;
  return [frame.pixels[0] ?? 0, frame.pixels[1] ?? 0, frame.pixels[2] ?? 0];
}

function isTransparentPixel(pixels: Uint8ClampedArray, offset: number, key: [number, number, number] | undefined): boolean {
  if ((pixels[offset + 3] ?? 0) === 0) return true;
  return Boolean(key && pixels[offset] === key[0] && pixels[offset + 1] === key[1] && pixels[offset + 2] === key[2]);
}

function sameRgbWithinTolerance(a: Uint8ClampedArray, b: Uint8ClampedArray, offset: number, tolerance: number): boolean {
  return Math.abs((a[offset] ?? 0) - (b[offset] ?? 0)) + Math.abs((a[offset + 1] ?? 0) - (b[offset + 1] ?? 0)) + Math.abs((a[offset + 2] ?? 0) - (b[offset + 2] ?? 0)) <= tolerance;
}

type ScriptBounds = { minX: number; minY: number; maxX: number; maxY: number };

function emptyScriptBounds(): ScriptBounds {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function includeScriptPoint(bounds: ScriptBounds, x: number, y: number): ScriptBounds {
  return { minX: Math.min(bounds.minX, x), minY: Math.min(bounds.minY, y), maxX: Math.max(bounds.maxX, x), maxY: Math.max(bounds.maxY, y) };
}

function scriptBoundsToBox(bounds: ScriptBounds): Box | undefined {
  if (!Number.isFinite(bounds.minX)) return undefined;
  return { x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX + 1, height: bounds.maxY - bounds.minY + 1 };
}

const DEFAULT_SCRIPT_FRAME_DURATION = 6;

function numberValue(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseSide(value: string): PokemonAnimationSide {
  if (value !== "front" && value !== "back") throw new Error("--side must be front or back");
  return value;
}

function shouldCompressAnimationFile(fileIndex: PokemonAnimationBundleFileIndex): boolean {
  return fileIndex === 5 || fileIndex === 14;
}

async function findBundleFile(bundleDir: string, suffix: string): Promise<string> {
  const files = await readdir(bundleDir);
  const found = files.find((file) => file.endsWith(suffix));
  if (!found) throw new Error(`Could not find *${suffix} in ${bundleDir}`);
  return found;
}

async function optionalBundlePath(bundleDir: string, explicit: string | undefined, suffix: string): Promise<string | undefined> {
  if (explicit) return path.resolve(bundleDir, explicit);
  try {
    return path.resolve(bundleDir, await findBundleFile(bundleDir, suffix));
  } catch {
    return undefined;
  }
}

async function optionalExistingPath(bundleDir: string, filePath: string | undefined): Promise<string | undefined> {
  if (!filePath) return undefined;
  const resolved = path.resolve(bundleDir, filePath);
  try {
    await readFile(resolved);
    return resolved;
  } catch {
    return undefined;
  }
}

async function readExplicitFileSections(bundleDir: string, specs: string[]): Promise<Partial<Record<number, Uint8Array>>> {
  const files: Partial<Record<number, Uint8Array>> = {};
  for (const spec of specs) {
    const split = /^(\d+):(.+)$/u.exec(spec);
    if (!split) throw new Error(`Invalid --file entry "${spec}". Expected index:path`);
    const index = Number(split[1]);
    if (!Number.isInteger(index) || index < 0 || index > 19) throw new Error(`Invalid sprite file index: ${split[1]}`);
    files[index] = await readFileBytes(path.resolve(bundleDir, split[2]));
  }
  return files;
}

function formatBox(box: Box): string {
  return `x=${box.x}, y=${box.y}, w=${box.width}, h=${box.height}`;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJsonIfExists<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readFileBytes(filePath: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(filePath));
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const options = new Map<string, string[]>();
  for (let index = 0; index < rest.length; index += 1) {
    const raw = rest[index];
    if (!raw.startsWith("--")) throw new Error(`Unexpected positional argument: ${raw}`);
    const key = raw.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      options.set(key, [...(options.get(key) ?? []), "true"]);
      continue;
    }
    options.set(key, [...(options.get(key) ?? []), next]);
    index += 1;
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

function printHelp(): void {
  console.log(`
Pokemon animation GIF helper

Usage:
  npm run pokemonanim:helper -- analyze --gif /path/to/778_1.gif --out work/mimikyu --name mimikyu-front
  npm run pokemonanim:helper -- palette --bundle work/mimikyu
  npm run pokemonanim:helper -- palette --bundle work/mimikyu --quantize
  npm run pokemonanim:helper -- motion --bundle work/mimikyu
  npm run pokemonanim:helper -- build-animation --bundle work/mimikyu --side front --out work/mimikyu/generated
  npm run pokemonanim:helper -- build-custom-bundle --bundle work/mimikyu --side front --out work/mimikyu/generated-keyed

Commands:
  analyze
    Crop/center a GIF to 96x96 PNG frames, export front_sprite.png, and write manifest.json.
    Options: --gif, --out, --name

  palette
    Validate Gen 5 16-color compatibility and write palette_report.json + palette.png.
    Options: --bundle, optional --quantize

  motion
    Write frame diff images, motion masks, candidate moving regions, and LLM handoff docs.
    Options: --bundle

  build-animation
    Build NCER/NANR/NMCR/NMAR/NCEC files and a .pkanimbundle from rig plan JSON.
    Options: --bundle, --out, optional --side, --cells, --plan, --frame-duration, --loop-duration

  build-custom-bundle
    Pack sprite PNGs, rig PNGs, palette PNGs, animation files, and optional raw file sections into one browser-importable bundle.
    Options: --bundle, --out, optional --side, --animation, --front-sprite, --back-sprite, --front-rig, --back-rig, --palette, --shiny-palette, --file index:path, --name

  validate-frame0
    Render rig cells at keyframe 0 and compare them against front_sprite.png.
    Options: --bundle, optional --out, --cells, --plan, --rig, --front-sprite

Notes:
  V1 emits editable Gen 5 animation files from human-approved rig cells and optional keyframes.
`.trim());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
