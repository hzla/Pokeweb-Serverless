import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  analyzeMotion,
  analyzePalette,
  decodeGifFrames,
  decodePng,
  encodePng,
  normalizeAnimationFrames,
  palettePng,
  type AnimationAnalysisFrame,
  type MotionReport,
  type PaletteReport,
} from "../src/pokeweb/pokemonAnimationAnalysis";
import {
  buildPlaceholderRig,
  boxToJson,
  offsetForVariant,
  paletteToPngBytes,
  parseGen6SpriteCsv,
  pngPaletteToColors,
  prepareStaticSprites,
  staticSpritePngBytes,
  variantFileName,
  type Gen6CsvAsset,
  type Gen6OffsetMap,
  type Gen6SpriteSide,
  type Gen6SpriteVariant,
} from "../src/pokeweb/gen6SpritePipeline";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomFile } from "../src/pokeweb/loader";
import { BW2_MESSAGE_BANKS, BW_MESSAGE_BANKS } from "../src/pokeweb/constants";
import { commitTextBank, getTextBank, parseTextEntryId } from "../src/pokeweb/textModel";
import { compressLz11Literal, importPokemonAnimationBundle, setPokemonPalette, setPokemonSpriteImage, type RgbaImageData, type RgbColor } from "../src/pokeweb/pokemonSpriteModel";
import {
  buildPokemonAnimationAssetBundle,
  packagePokemonAnimationBundle,
  type PokemonAnimationBundleFileIndex,
} from "../src/pokeweb/pokemonSpriteWriters";

type ParsedArgs = {
  command?: PipelineCommand;
  options: Map<string, string[]>;
};

type PipelineCommand = "download" | "static" | "rigs" | "analyze" | "insert" | "all";

type AssetManifest = {
  format: "pokeweb-gen6-sprite-assets-v1";
  createdAt: string;
  csv: string;
  outDir: string;
  assets: Array<
    Gen6CsvAsset & {
      downloadDir: string;
      files: Partial<Record<Gen6SpriteVariant, string>>;
      failures: Partial<Record<Gen6SpriteVariant, string>>;
    }
  >;
};

type VariantManifest = {
  format: "pokeweb-normalized-gif-v1";
  name: string;
  slug: string;
  spriteId: number;
  variant: Gen6SpriteVariant;
  sourceGif: string;
  targetSize: { width: number; height: number };
  source: { width: number; height: number; frameCount: number; delaysMs: number[] };
  contentBounds?: { x: number; y: number; width: number; height: number };
  cropBounds: { x: number; y: number; width: number; height: number };
  offset: { x?: number; y?: number };
  frameCount: number;
  delaysMs: number[];
  frame0: string;
  frames: Array<{ index: number; delayMs: number; file: string }>;
  warnings: string[];
};

type StaticManifest = {
  format: "pokeweb-gen6-static-v1";
  createdAt: string;
  assets: Array<{
    spriteId: number;
    speciesId: number;
    name: string;
    slug: string;
    staticDir: string;
    front?: string;
    back?: string;
    normalPalette?: string;
    shinyPalette?: string;
    warnings: string[];
  }>;
};

type RigManifest = {
  format: "pokeweb-gen6-placeholder-rigs-v1";
  createdAt: string;
  assets: Array<{
    spriteId: number;
    speciesId: number;
    name: string;
    slug: string;
    rigDir: string;
    frontRig?: string;
    backRig?: string;
    frontAnimationPackage?: string;
    backAnimationPackage?: string;
    warnings: string[];
  }>;
};

const VARIANTS: Gen6SpriteVariant[] = ["front", "back", "front-shiny", "back-shiny"];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || args.options.has("help") || args.options.has("h")) {
    printHelp();
    return;
  }

  if (args.command === "download") await downloadCommand(args);
  else if (args.command === "static") await staticCommand(args);
  else if (args.command === "rigs") await rigsCommand(args);
  else if (args.command === "analyze") await analyzeCommand(args);
  else if (args.command === "insert") await insertCommand(args);
  else if (args.command === "all") {
    await downloadCommand(args);
    await staticCommand(args);
    await rigsCommand(args);
    await analyzeCommand(args);
    await insertCommand(args);
  } else {
    throw new Error(`Unknown command: ${args.command}`);
  }
}

async function rigsCommand(args: ParsedArgs): Promise<void> {
  const paths = await pipelinePaths(args);
  const staticManifest = await readJson<StaticManifest>(path.join(paths.manifestsDir, "static.json"));
  await ensureLayout(paths.outDir);
  await mkdir(paths.rigsDir, { recursive: true });
  const rigAssets: RigManifest["assets"] = [];

  for (const asset of staticManifest.assets) {
    const staticDir = path.resolve(paths.outDir, asset.staticDir);
    const rigDir = path.join(paths.rigsDir, asset.slug);
    await mkdir(rigDir, { recursive: true });
    const rigEntry: RigManifest["assets"][number] = {
      spriteId: asset.spriteId,
      speciesId: asset.speciesId,
      name: asset.name,
      slug: asset.slug,
      rigDir: path.relative(paths.outDir, rigDir),
      warnings: [],
    };

    for (const side of ["front", "back"] as const) {
      const spriteFile = asset[side];
      if (!spriteFile) {
        rigEntry.warnings.push(`No ${side} static sprite; placeholder ${side} rig skipped`);
        continue;
      }
      const source = await readRgbaPng(path.join(staticDir, spriteFile));
      const placeholder = buildPlaceholderRig(source);
      const rigName = `${side}_rig_256x128_ds.png`;
      await writeFile(path.join(rigDir, rigName), staticSpritePngBytes(placeholder.rig));
      const bundle = buildPokemonAnimationAssetBundle({
        side,
        parts: [placeholder.part],
        loopDuration: 32,
      });
      const compressed = {
        side,
        files: Object.fromEntries(
          Object.entries(bundle.files).map(([index, file]) => {
            const fileIndex = Number(index) as PokemonAnimationBundleFileIndex;
            return [fileIndex, file && shouldCompressAnimationFile(fileIndex) ? compressLz11Literal(file) : file];
          }),
        ) as typeof bundle.files,
      };
      const packageName = `${side}_placeholder_animation.pkanimbundle`;
      await writeFile(path.join(rigDir, packageName), packagePokemonAnimationBundle(compressed));
      await writeJson(path.join(rigDir, `${side}_placeholder_rig_manifest.json`), {
        format: "pokeweb-placeholder-rig-side-v1",
        side,
        sourceSprite: path.relative(rigDir, path.join(staticDir, spriteFile)),
        rig: rigName,
        animationPackage: packageName,
        part: placeholder.part,
      });
      if (side === "front") {
        rigEntry.frontRig = rigName;
        rigEntry.frontAnimationPackage = packageName;
      } else {
        rigEntry.backRig = rigName;
        rigEntry.backAnimationPackage = packageName;
      }
    }
    await writeJson(path.join(rigDir, "placeholder_rig_manifest.json"), rigEntry);
    rigAssets.push(rigEntry);
  }

  await writeJson(path.join(paths.manifestsDir, "rigs.json"), {
    format: "pokeweb-gen6-placeholder-rigs-v1",
    createdAt: new Date().toISOString(),
    assets: rigAssets,
  } satisfies RigManifest);
  console.log(`Wrote placeholder rigs for ${rigAssets.length} asset row(s) into ${paths.rigsDir}`);
}

async function downloadCommand(args: ParsedArgs): Promise<void> {
  const paths = await pipelinePaths(args);
  const assets = await loadCsvAssets(args);
  await ensureLayout(paths.outDir);
  const force = args.options.has("force");
  const manifestAssets: AssetManifest["assets"] = [];
  let downloadedCount = 0;
  let skippedCount = 0;
  let failureCount = 0;

  for (const asset of assets) {
    const downloadDir = path.join(paths.downloadsDir, asset.slug);
    await mkdir(downloadDir, { recursive: true });
    const files: Partial<Record<Gen6SpriteVariant, string>> = {};
    const failures: Partial<Record<Gen6SpriteVariant, string>> = {};
    for (const variant of VARIANTS) {
      const url = asset.urls[variant];
      if (!url) continue;
      const filePath = path.join(downloadDir, variantFileName(asset.slug, variant));
      try {
        if (!force && (await exists(filePath))) {
          files[variant] = path.relative(paths.outDir, filePath);
          skippedCount += 1;
          continue;
        }
        const bytes = await downloadGifBytes(url);
        await writeFile(filePath, bytes);
        files[variant] = path.relative(paths.outDir, filePath);
        downloadedCount += 1;
      } catch (error) {
        failures[variant] = errorMessage(error);
        failureCount += 1;
      }
    }
    manifestAssets.push({ ...asset, downloadDir: path.relative(paths.outDir, downloadDir), files, failures });
  }

  await writeJson(path.join(paths.manifestsDir, "assets.json"), {
    format: "pokeweb-gen6-sprite-assets-v1",
    createdAt: new Date().toISOString(),
    csv: path.resolve(paths.csvPath),
    outDir: paths.outDir,
    assets: manifestAssets,
  } satisfies AssetManifest);
  console.log(`Prepared ${manifestAssets.length} asset row(s) in ${paths.downloadsDir} (${downloadedCount} downloaded, ${skippedCount} cached, ${failureCount} failed)`);
}

async function staticCommand(args: ParsedArgs): Promise<void> {
  const paths = await pipelinePaths(args);
  const assets = await loadCsvAssets(args);
  const offsets = await loadOffsets(paths.offsetsPath);
  await ensureLayout(paths.outDir);

  const staticAssets: StaticManifest["assets"] = [];
  for (const asset of assets) {
    const normalizedFrames: Partial<Record<Gen6SpriteVariant, AnimationAnalysisFrame>> = {};
    const normalizationWarnings: string[] = [];
    for (const variant of VARIANTS) {
      const gifPath = path.join(paths.downloadsDir, asset.slug, variantFileName(asset.slug, variant));
      if (!(await exists(gifPath))) continue;
      try {
        const bytes = await readFileBytes(gifPath);
        if (!isGifBytes(bytes)) throw new Error("Downloaded file is not a GIF");
        const normalized = normalizeAnimationFrames(decodeGifFrames(bytes), 96, offsetForVariant(offsets, asset.slug, variant));
        const variantDir = path.join(paths.normalizedDir, asset.slug, variant);
        const framesDir = path.join(variantDir, "frames");
        await mkdir(framesDir, { recursive: true });
        for (const frame of normalized.frames) {
          await writeFile(path.join(framesDir, frameFileName(frame.index)), encodePng(frame));
        }
        const frame0 = normalized.frames[0]!;
        await writeFile(path.join(variantDir, "front_sprite.png"), encodePng(frame0));
        await writeFile(path.join(variantDir, "sprite.png"), encodePng(frame0));
        await rm(path.join(variantDir, "error.json"), { force: true });
        await writeJson(path.join(variantDir, "manifest.json"), {
          format: "pokeweb-normalized-gif-v1",
          name: asset.name,
          slug: asset.slug,
          spriteId: asset.spriteId,
          variant,
          sourceGif: path.relative(variantDir, gifPath),
          targetSize: { width: 96, height: 96 },
          source: normalized.source,
          contentBounds: boxToJson(normalized.contentBounds),
          cropBounds: normalized.cropBounds,
          offset: offsetForVariant(offsets, asset.slug, variant),
          frameCount: normalized.frames.length,
          delaysMs: normalized.frames.map((frame) => frame.delayMs),
          frame0: "front_sprite.png",
          frames: normalized.frames.map((frame) => ({ index: frame.index, delayMs: frame.delayMs, file: path.join("frames", frameFileName(frame.index)) })),
          warnings: normalized.warnings,
        } satisfies VariantManifest);
        normalizedFrames[variant] = frame0;
      } catch (error) {
        const warning = `${variant}: ${errorMessage(error)}`;
        normalizationWarnings.push(warning);
        await writeJson(path.join(paths.normalizedDir, asset.slug, variant, "error.json"), {
          format: "pokeweb-normalized-gif-error-v1",
          name: asset.name,
          slug: asset.slug,
          spriteId: asset.spriteId,
          variant,
          sourceGif: path.relative(path.join(paths.normalizedDir, asset.slug, variant), gifPath),
          error: warning,
        });
      }
    }

    const staticDir = path.join(paths.staticDir, asset.slug);
    await mkdir(staticDir, { recursive: true });
    const staticEntry: StaticManifest["assets"][number] = {
      spriteId: asset.spriteId,
      speciesId: asset.speciesId,
      name: asset.name,
      slug: asset.slug,
      staticDir: path.relative(paths.outDir, staticDir),
      warnings: [...normalizationWarnings],
    };
    if (!normalizedFrames.front && !normalizedFrames.back) {
      staticEntry.warnings.push("No normal front/back frame was available; static sprite generation skipped");
      staticAssets.push(staticEntry);
      continue;
    }

    const prepared = prepareStaticSprites({
      front: normalizedFrames.front,
      back: normalizedFrames.back,
      frontShiny: normalizedFrames["front-shiny"],
      backShiny: normalizedFrames["back-shiny"],
    });
    staticEntry.warnings.push(...prepared.warnings);
    if (prepared.images.front) {
      await writeFile(path.join(staticDir, "front.png"), staticSpritePngBytes(prepared.images.front));
      staticEntry.front = "front.png";
    }
    if (prepared.images.back) {
      await writeFile(path.join(staticDir, "back.png"), staticSpritePngBytes(prepared.images.back));
      staticEntry.back = "back.png";
    }
    await writeFile(path.join(staticDir, "palette_normal.png"), paletteToPngBytes(prepared.normalPalette));
    staticEntry.normalPalette = "palette_normal.png";
    if (prepared.shinyPalette) {
      await writeFile(path.join(staticDir, "palette_shiny.png"), paletteToPngBytes(prepared.shinyPalette));
      staticEntry.shinyPalette = "palette_shiny.png";
    } else {
      staticEntry.warnings.push("No shiny palette source was available; ROM shiny palette will be left unchanged");
    }
    await writeJson(path.join(staticDir, "static_manifest.json"), staticEntry);
    staticAssets.push(staticEntry);
  }

  await writeJson(path.join(paths.manifestsDir, "static.json"), {
    format: "pokeweb-gen6-static-v1",
    createdAt: new Date().toISOString(),
    assets: staticAssets,
  } satisfies StaticManifest);
  console.log(`Wrote static sprites for ${staticAssets.length} asset row(s) into ${paths.staticDir}`);
}

async function analyzeCommand(args: ParsedArgs): Promise<void> {
  const paths = await pipelinePaths(args);
  const assets = await loadCsvAssets(args);
  await ensureLayout(paths.outDir);

  for (const asset of assets) {
    const assetAnalysisDir = path.join(paths.analysisDir, `${String(asset.spriteId).padStart(3, "0")}-${asset.slug}`);
    await mkdir(assetAnalysisDir, { recursive: true });
    for (const variant of VARIANTS) {
      const variantDir = path.join(paths.normalizedDir, asset.slug, variant);
      const manifestPath = path.join(variantDir, "manifest.json");
      if (!(await exists(manifestPath))) continue;
      const manifest = await readJson<VariantManifest>(manifestPath);
      const frames = await readVariantFrames(variantDir, manifest);
      const palette = analyzePalette(frames);
      const motion = analyzeMotion(frames);
      await writeFile(path.join(variantDir, "palette.png"), palettePng(palette.colors));
      await writeJson(path.join(variantDir, "palette_report.json"), palette);
      await writeMotionOutputs(variantDir, frames, motion.report, motion.unionMask, motion.stableMask, motion.frameDiffs);

      const analysisVariantDir = path.join(assetAnalysisDir, variant);
      await mkdir(analysisVariantDir, { recursive: true });
      await copyAnalysisFiles(variantDir, analysisVariantDir);
      await writeFile(path.join(analysisVariantDir, "analysis.md"), renderVariantAnalysis(asset, manifest, palette, motion.report));
    }
  }
  console.log(`Wrote analysis material into ${paths.analysisDir}`);
}

async function insertCommand(args: ParsedArgs): Promise<void> {
  const paths = await pipelinePaths(args);
  if (!paths.romPath) throw new Error("insert/all requires --rom");
  const romOut = paths.romOutPath ?? defaultRomOut(paths.romPath);
  const staticManifest = await readJson<StaticManifest>(path.join(paths.manifestsDir, "static.json"));
  const rigManifest = await readJsonIfExists<RigManifest>(path.join(paths.manifestsDir, "rigs.json"));
  const romBytes = await readFileBytes(paths.romPath);
  const project = await loadProjectFromRomFile(new File([romBytes], path.basename(paths.romPath)), {
    expandSprites: true,
    selectedNarcs: ["pokemon_sprites"],
  });
  const report: Array<{ spriteId: number; slug: string; name: string; inserted: string[]; skipped: string[]; warnings: string[] }> = [];

  for (const asset of staticManifest.assets) {
    const staticDir = path.resolve(paths.outDir, asset.staticDir);
    const inserted: string[] = [];
    const skipped: string[] = [];
    const warnings = [...asset.warnings];
    if (!asset.normalPalette) {
      skipped.push("normal-palette");
      report.push({ spriteId: asset.spriteId, slug: asset.slug, name: asset.name, inserted, skipped, warnings });
      continue;
    }

    try {
      const normalPalette = await readPalettePng(path.join(staticDir, asset.normalPalette));
      setPokemonPalette(project, asset.spriteId, "normal", normalPalette);
      inserted.push("normal-palette");
    } catch (error) {
      skipped.push("normal-palette");
      warnings.push(errorMessage(error));
    }

    if (asset.shinyPalette) {
      try {
        const shinyPalette = await readPalettePng(path.join(staticDir, asset.shinyPalette));
        setPokemonPalette(project, asset.spriteId, "shiny", shinyPalette);
        inserted.push("shiny-palette");
      } catch (error) {
        skipped.push("shiny-palette");
        warnings.push(errorMessage(error));
      }
    } else {
      skipped.push("shiny-palette");
    }

    await insertSpriteSide(project, asset.spriteId, "front", asset.front ? path.join(staticDir, asset.front) : undefined, inserted, skipped, warnings);
    await insertSpriteSide(project, asset.spriteId, "back", asset.back ? path.join(staticDir, asset.back) : undefined, inserted, skipped, warnings);
    const rigAsset = rigManifest?.assets.find((candidate) => candidate.spriteId === asset.spriteId);
    if (rigAsset) await insertPlaceholderRigAsset(project, paths.outDir, rigAsset, inserted, skipped, warnings);
    if (asset.front || asset.back) {
      try {
        updatePokedexName(project, asset.spriteId, asset.name);
        inserted.push("pokedex-name");
      } catch (error) {
        skipped.push("pokedex-name");
        warnings.push(errorMessage(error));
      }
    } else {
      skipped.push("pokedex-name");
    }
    report.push({ spriteId: asset.spriteId, slug: asset.slug, name: asset.name, inserted, skipped, warnings });
  }

  const out = await exportModifiedRom(project);
  await writeFile(romOut, out);
  await writeJson(path.join(paths.manifestsDir, "insert_report.json"), {
    format: "pokeweb-gen6-static-insert-report-v1",
    createdAt: new Date().toISOString(),
    sourceRom: path.resolve(paths.romPath),
    outputRom: path.resolve(romOut),
    assets: report,
  });
  console.log(`Inserted static sprites into ${romOut}`);
}

async function insertPlaceholderRigAsset(
  project: Awaited<ReturnType<typeof loadProjectFromRomFile>>,
  outDir: string,
  asset: RigManifest["assets"][number],
  inserted: string[],
  skipped: string[],
  warnings: string[],
): Promise<void> {
  const rigDir = path.resolve(outDir, asset.rigDir);
  for (const side of ["front", "back"] as const) {
    const rigFile = side === "front" ? asset.frontRig : asset.backRig;
    const animationPackage = side === "front" ? asset.frontAnimationPackage : asset.backAnimationPackage;
    if (!rigFile || !animationPackage) {
      skipped.push(`${side}-placeholder-rig`);
      skipped.push(`${side}-placeholder-animation`);
      continue;
    }
    try {
      setPokemonSpriteImage(project, asset.spriteId, { kind: "rig", side, gender: "male" }, "normal", await readRgbaPng(path.join(rigDir, rigFile)));
      inserted.push(`${side}-placeholder-rig`);
    } catch (error) {
      skipped.push(`${side}-placeholder-rig`);
      warnings.push(errorMessage(error));
    }
    try {
      importPokemonAnimationBundle(project, asset.spriteId, await readFileBytes(path.join(rigDir, animationPackage)));
      inserted.push(`${side}-placeholder-animation`);
    } catch (error) {
      skipped.push(`${side}-placeholder-animation`);
      warnings.push(errorMessage(error));
    }
  }
}

function updatePokedexName(project: Awaited<ReturnType<typeof loadProjectFromRomFile>>, spriteId: number, name: string): void {
  const mappings = project.session.baseRom === "BW2" ? BW2_MESSAGE_BANKS : BW_MESSAGE_BANKS;
  const bankId = mappings.find(([, bankName]) => bankName === "pokedex")?.[0];
  if (bankId === undefined) throw new Error("Could not resolve Pokedex text bank");
  const bank = getTextBank(project, "message_texts", bankId);
  let updated = false;
  for (const entry of bank) {
    if (parseTextEntryId(entry[0]).entry !== spriteId) continue;
    entry[1] = name;
    updated = true;
  }
  if (!updated) throw new Error(`Pokedex text entry ${spriteId} does not exist`);
  commitTextBank(project, "message_texts", bankId);
}

async function insertSpriteSide(
  project: Awaited<ReturnType<typeof loadProjectFromRomFile>>,
  spriteId: number,
  side: Gen6SpriteSide,
  filePath: string | undefined,
  inserted: string[],
  skipped: string[],
  warnings: string[],
): Promise<void> {
  if (!filePath) {
    skipped.push(side);
    return;
  }
  try {
    const image = await readRgbaPng(filePath);
    setPokemonSpriteImage(project, spriteId, { kind: "sprite", side, gender: "male" }, "normal", image);
    inserted.push(side);
  } catch (error) {
    skipped.push(side);
    warnings.push(errorMessage(error));
  }
}

async function writeMotionOutputs(
  variantDir: string,
  frames: AnimationAnalysisFrame[],
  report: MotionReport,
  unionMask: Uint8ClampedArray,
  stableMask: Uint8ClampedArray,
  frameDiffs: Uint8ClampedArray[],
): Promise<void> {
  const diffDir = path.join(variantDir, "frame_diffs");
  const maskDir = path.join(variantDir, "motion_masks");
  await mkdir(diffDir, { recursive: true });
  await mkdir(maskDir, { recursive: true });
  for (let index = 0; index < frameDiffs.length; index += 1) {
    const frame = frames[index]!;
    const fileName = frameFileName(frame.index);
    await writeFile(path.join(diffDir, fileName), encodePng({ width: frame.width, height: frame.height, pixels: frameDiffs[index]! }));
    await writeFile(path.join(maskDir, fileName), encodePng({ width: frame.width, height: frame.height, pixels: maskFromDiff(frameDiffs[index]!) }));
  }
  await writeFile(path.join(variantDir, "motion_union.png"), encodePng({ width: frames[0]!.width, height: frames[0]!.height, pixels: unionMask }));
  await writeFile(path.join(variantDir, "stable_mask.png"), encodePng({ width: frames[0]!.width, height: frames[0]!.height, pixels: stableMask }));
  await writeJson(path.join(variantDir, "motion_report.json"), {
    ...report,
    motionMasksDir: "motion_masks",
    frameDiffsDir: "frame_diffs",
    motionUnionImage: "motion_union.png",
    stableMaskImage: "stable_mask.png",
  });
}

async function copyAnalysisFiles(sourceDir: string, targetDir: string): Promise<void> {
  const names = [
    "manifest.json",
    "front_sprite.png",
    "sprite.png",
    "palette.png",
    "palette_report.json",
    "motion_report.json",
    "motion_union.png",
    "stable_mask.png",
  ];
  for (const name of names) {
    const source = path.join(sourceDir, name);
    if (await exists(source)) await copyFile(source, path.join(targetDir, name));
  }
}

async function readVariantFrames(variantDir: string, manifest: VariantManifest): Promise<AnimationAnalysisFrame[]> {
  const frames: AnimationAnalysisFrame[] = [];
  for (const frame of manifest.frames) {
    frames.push(decodePng(await readFileBytes(path.join(variantDir, frame.file)), frame.index, frame.delayMs));
  }
  return frames;
}

async function loadCsvAssets(args: ParsedArgs): Promise<Gen6CsvAsset[]> {
  const paths = await pipelinePaths(args);
  const limit = numberOption(args, "limit");
  return parseGen6SpriteCsv(await readFile(paths.csvPath, "utf8"), { startSpriteId: numberOption(args, "start-id") ?? 1, limit });
}

async function pipelinePaths(args: ParsedArgs): Promise<{
  csvPath: string;
  outDir: string;
  downloadsDir: string;
  normalizedDir: string;
  staticDir: string;
  rigsDir: string;
  analysisDir: string;
  manifestsDir: string;
  offsetsPath: string;
  romPath?: string;
  romOutPath?: string;
}> {
  const outDir = path.resolve(option(args, "out") ?? "../gen6-sprite-work");
  return {
    csvPath: path.resolve(option(args, "csv") ?? "../gen6sprites.csv"),
    outDir,
    downloadsDir: path.join(outDir, "downloads"),
    normalizedDir: path.join(outDir, "normalized"),
    staticDir: path.join(outDir, "static"),
    rigsDir: path.join(outDir, "rigs"),
    analysisDir: path.join(outDir, "analysis"),
    manifestsDir: path.join(outDir, "manifests"),
    offsetsPath: path.join(outDir, "offsets.json"),
    romPath: option(args, "rom") ? path.resolve(option(args, "rom")!) : undefined,
    romOutPath: option(args, "rom-out") ? path.resolve(option(args, "rom-out")!) : undefined,
  };
}

async function ensureLayout(outDir: string): Promise<void> {
  for (const dir of ["downloads", "normalized", "static", "rigs", "analysis", "manifests"]) {
    await mkdir(path.join(outDir, dir), { recursive: true });
  }
  const offsetsPath = path.join(outDir, "offsets.json");
  if (!(await exists(offsetsPath))) await writeJson(offsetsPath, {});
}

async function loadOffsets(offsetsPath: string): Promise<Gen6OffsetMap> {
  if (!(await exists(offsetsPath))) return {};
  return readJson<Gen6OffsetMap>(offsetsPath);
}

async function downloadGifBytes(url: string): Promise<Uint8Array> {
  const errors: string[] = [];
  for (const candidate of candidateDownloadUrls(url)) {
    try {
      const response = await fetch(candidate, { redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!isGifBytes(bytes)) throw new Error("response is not a GIF");
      return bytes;
    } catch (error) {
      errors.push(`${candidate}: ${errorMessage(error)}`);
    }
  }
  throw new Error(`Could not download a GIF. Tried ${errors.join("; ")}`);
}

function candidateDownloadUrls(url: string): string[] {
  const out = [url];
  const match = /attachment(\d+)/iu.exec(url);
  if (match) out.push(`https://www.smogon.com/forums/attachments/${match[1]}/`);
  return Array.from(new Set(out));
}

function isGifBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;
}

async function readPalettePng(filePath: string): Promise<RgbColor[]> {
  return pngPaletteToColors(decodePng(await readFileBytes(filePath)));
}

async function readRgbaPng(filePath: string): Promise<RgbaImageData> {
  const image = decodePng(await readFileBytes(filePath));
  return { width: image.width, height: image.height, pixels: image.pixels };
}

function maskFromDiff(diff: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(diff.length);
  for (let offset = 0; offset < diff.length; offset += 4) {
    if ((diff[offset + 3] ?? 0) === 0) continue;
    out[offset] = 255;
    out[offset + 1] = 255;
    out[offset + 2] = 255;
    out[offset + 3] = 255;
  }
  return out;
}

function renderVariantAnalysis(asset: Gen6CsvAsset, manifest: VariantManifest, palette: PaletteReport, motion: MotionReport): string {
  const lines = [
    `# ${asset.spriteId} ${asset.name} ${manifest.variant}`,
    "",
    `- Slug: ${asset.slug}`,
    `- Source GIF: ${manifest.sourceGif}`,
    `- Source size: ${manifest.source.width}x${manifest.source.height}`,
    `- Frames: ${manifest.frameCount}`,
    `- Crop bounds: ${formatBox(manifest.cropBounds)}`,
    `- Offset: x ${manifest.offset.x ?? 0}, y ${manifest.offset.y ?? 0}`,
    `- Palette compatible: ${palette.compatible ? "yes" : "no"}`,
    `- Opaque colors: ${palette.opaqueColorCount}`,
    `- Motion changed pixels: ${motion.changedPixelCount}`,
  ];
  if (motion.changedBounds) lines.push(`- Motion bounds: ${formatBox(motion.changedBounds)}`);
  if (manifest.warnings.length > 0 || palette.warnings.length > 0 || motion.warnings.length > 0) {
    lines.push("", "## Warnings");
    for (const warning of [...manifest.warnings, ...palette.warnings, ...motion.warnings]) lines.push(`- ${warning}`);
  }
  if (motion.candidateParts.length > 0) {
    lines.push("", "## Candidate Motion Regions");
    for (const part of motion.candidateParts.slice(0, 12)) lines.push(`- ${part.id}: ${part.description}, ${formatBox(part.bounds)}, ${part.changedPixelCount} changed pixel(s)`);
  }
  lines.push("");
  return lines.join("\n");
}

function frameFileName(index: number): string {
  return `frame_${String(index).padStart(3, "0")}.png`;
}

function formatBox(box: { x: number; y: number; width: number; height: number }): string {
  return `${box.x},${box.y} ${box.width}x${box.height}`;
}

function defaultRomOut(romPath: string): string {
  const parsed = path.parse(romPath);
  return path.join(parsed.dir, `${parsed.name}-gen6-static${parsed.ext}`);
}

async function readFileBytes(filePath: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(filePath));
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function readJsonIfExists<T>(filePath: string): Promise<T | undefined> {
  if (!(await exists(filePath))) return undefined;
  return readJson<T>(filePath);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [rawCommand, ...rest] = argv;
  const command = rawCommand as PipelineCommand | undefined;
  const options = new Map<string, string[]>();
  for (let index = 0; index < rest.length; index += 1) {
    const raw = rest[index]!;
    if (!raw.startsWith("--")) continue;
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

function option(args: ParsedArgs, key: string): string | undefined {
  return args.options.get(key)?.at(-1);
}

function numberOption(args: ParsedArgs, key: string): number | undefined {
  const value = option(args, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${key} must be a number`);
  return parsed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shouldCompressAnimationFile(fileIndex: PokemonAnimationBundleFileIndex): boolean {
  return fileIndex === 5 || fileIndex === 14;
}

function printHelp(): void {
  console.log(`
Gen 6 sprite import pipeline

Usage:
  npm run gen6sprites:pipeline -- all --csv ../gen6sprites.csv --rom ../w2backportcanvas.nds --out ../gen6-sprite-work --rom-out ../w2backportcanvas-gen6-static.nds

Commands:
  download  Download GIF URL fields from the CSV.
  static    Crop downloaded GIFs to 96x96 and write frame-0 static sprites/palettes.
  rigs      Generate one-cell full-sprite placeholder rigs and bob animations.
  analyze   Write palette/motion reports and LLM-friendly analysis folders.
  insert    Insert generated static sprites into a new ROM copy.
  all       Run download, static, rigs, analyze, and insert.

Options:
  --csv       CSV path. Default: ../gen6sprites.csv
  --out       Work directory. Default: ../gen6-sprite-work
  --rom       Source ROM path for insert/all.
  --rom-out   Output ROM path. Default: source name + -gen6-static.nds
  --limit     Process the first N downloadable CSV rows for smoke tests.
  --start-id  First compact sprite ID. Default: 1
  --force     Redownload existing GIF files.
`.trim());
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
