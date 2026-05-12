import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { decodePng, encodePng, roundTripBgr555Color } from "../src/pokeweb/pokemonAnimationAnalysis";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomFile } from "../src/pokeweb/loader";
import { compressLz11Literal, getPokemonSpriteImage, importPokemonAnimationBundle, setPokemonSpriteImage, type RgbaImageData, type RgbColor } from "../src/pokeweb/pokemonSpriteModel";
import { BW2_MESSAGE_BANKS, BW_MESSAGE_BANKS } from "../src/pokeweb/constants";
import { getTextBank, parseTextEntryId } from "../src/pokeweb/textModel";
import {
  buildPokemonAnimationAssetBundle,
  packagePokemonAnimationBundle,
  type PokemonAnimationBuildPart,
  type PokemonAnimationBundleFileIndex,
} from "../src/pokeweb/pokemonSpriteWriters";

type Side = "front" | "back";
type PokemonTarget = { spriteId: number; slug: string; name: string };
type Rect = { x: number; y: number; width: number; height: number };
type FrameEdit = NonNullable<PokemonAnimationBuildPart["frames"]>[number];

type PartSpec = {
  name: string;
  rects?: Rect[];
  match?: (x: number, y: number, color: RgbColor) => boolean;
  pivot?: { x: number; y: number };
  z: number;
  frames: FrameEdit[];
  sourceFrame?: "base" | "best-flame";
  sourceRect?: Rect;
  consume?: boolean;
  allowOverlap?: boolean;
  warning?: string;
};

type GeneratedPart = PokemonAnimationBuildPart & {
  sourceBounds: Rect;
  opaquePixels: number;
  warning?: string;
};

type SideResult = {
  side: Side;
  parts: Array<{ name: string; sourceBounds: Rect; atlas: Rect; spriteX: number; spriteY: number; pivot: { x: number; y: number }; z: number; opaquePixels: number }>;
  assumptions: string[];
  warnings: string[];
  files: string[];
  validation: { missingPixelCount: number; extraPixelCount: number; colorMismatchCount: number; totalMismatchedPixels: number };
};

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const SERVER_ROOT = path.join(REPO_ROOT, "Pokeweb-Serverless");
const WORK_ROOT = path.join(REPO_ROOT, "gen6-sprite-work");
const INPUT_ROM = path.join(REPO_ROOT, "w2backportcanvas-gen6-static.nds");
const OUTPUT_ROM = path.join(REPO_ROOT, "w2backportcanvas-gen6-rigtest-003.nds");
const OUTPUT_ROOT = path.join(WORK_ROOT, "generated-rigs");
const TARGETS: PokemonTarget[] = [
  { spriteId: 1, slug: "quilladin", name: "Quilladin" },
  { spriteId: 2, slug: "fennekin", name: "Fennekin" },
  { spriteId: 3, slug: "braixen", name: "Braixen" },
  { spriteId: 4, slug: "froakie", name: "Froakie" },
];

const TRANSPARENT = [0, 0, 0, 0] as const;
const LOOP = [
  { duration: 8, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1 },
  { duration: 8, x: 0, y: -1, rotation: 0, xScale: 1, yScale: 1.015 },
  { duration: 8, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1 },
  { duration: 8, x: 0, y: 1, rotation: 0, xScale: 1, yScale: 0.985 },
];

async function main(): Promise<void> {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const report = {
    format: "pokeweb-gen6-generated-rig-report-v1",
    createdAt: new Date().toISOString(),
    inputRom: INPUT_ROM,
    outputRom: OUTPUT_ROM,
    guide: path.join(SERVER_ROOT, "docs/pokemon-rig-animation-generation-guide.md"),
    assetsRoot: OUTPUT_ROOT,
    pokemon: [] as Array<PokemonTarget & { outputDir: string; sides: SideResult[]; inserted: string[]; warnings: string[] }>,
    verification: {} as Record<string, unknown>,
  };

  const generated = new Map<string, { rig: RgbaImageData; bundle: Uint8Array; side: Side; result: SideResult }>();
  for (const target of TARGETS) {
    const outputDir = path.join(OUTPUT_ROOT, target.slug);
    await mkdir(outputDir, { recursive: true });
    const targetReport = { ...target, outputDir, sides: [] as SideResult[], inserted: [] as string[], warnings: [] as string[] };
    for (const side of ["front", "back"] as const) {
      const sideResult = await generateSide(target, side, outputDir);
      generated.set(`${target.spriteId}:${side}`, { rig: await readRgbaPng(path.join(outputDir, `${side}_rig_256x128_ds.png`)), bundle: await readBytes(path.join(outputDir, `${side}_animation.pkanimbundle`)), side, result: sideResult });
      targetReport.sides.push(sideResult);
      targetReport.warnings.push(...sideResult.warnings.map((warning) => `${side}: ${warning}`));
    }
    report.pokemon.push(targetReport);
  }

  const project = await loadRom(INPUT_ROM);
  for (const target of TARGETS) {
    const row = report.pokemon.find((entry) => entry.spriteId === target.spriteId)!;
    for (const side of ["front", "back"] as const) {
      const item = generated.get(`${target.spriteId}:${side}`);
      if (!item) throw new Error(`Missing generated ${target.slug} ${side} asset`);
      setPokemonSpriteImage(project, target.spriteId, { kind: "rig", side, gender: "male" }, "normal", item.rig);
      importPokemonAnimationBundle(project, target.spriteId, item.bundle);
      row.inserted.push(`${side}-rig`, `${side}-animation`);
    }
    await writeJson(path.join(row.outputDir, "generated_rig_manifest.json"), row);
  }
  await writeFile(OUTPUT_ROM, await exportModifiedRom(project));

  const verifyProject = await loadRom(OUTPUT_ROM);
  const names = readPokedexNames(verifyProject, TARGETS.map((target) => target.spriteId));
  const loadedAnimations = TARGETS.flatMap((target) =>
    (["front", "back"] as const).map((side) => {
      const image = readInsertedRigImage(verifyProject, target.spriteId, side);
      return { spriteId: target.spriteId, slug: target.slug, side, rigSize: `${image.width}x${image.height}` };
    }),
  );
  report.verification = {
    romLoaded: true,
    pokedexNames: names,
    expectedPokedexNames: Object.fromEntries(TARGETS.map((target) => [target.spriteId, target.name])),
    namesMatch: TARGETS.every((target) => names[target.spriteId] === target.name),
    insertedRigImages: loadedAnimations,
  };
  await writeJson(path.join(OUTPUT_ROOT, "report.json"), report);
  console.log(`Wrote generated rigs to ${OUTPUT_ROOT}`);
  console.log(`Wrote ROM to ${OUTPUT_ROM}`);
  console.log(`Pokedex names: ${JSON.stringify(names)}`);
}

async function generateSide(target: PokemonTarget, side: Side, outputDir: string): Promise<SideResult> {
  resetPacker();
  const staticSprite = await readRgbaPng(path.join(WORK_ROOT, "static", target.slug, `${side}.png`));
  const normalizedDir = path.join(WORK_ROOT, "normalized", target.slug, side);
  const motionReport = await readJson<Record<string, unknown>>(path.join(normalizedDir, "motion_report.json"));
  const framePaths = await readFramePaths(normalizedDir);
  const frames = await Promise.all(framePaths.map(readRgbaPng));
  const palette = await readPalette(path.join(WORK_ROOT, "static", target.slug, "palette_normal.png"));
  const specs = partSpecs(target.slug, side);
  const atlas: RgbaImageData = { width: 256, height: 128, pixels: new Uint8ClampedArray(256 * 128 * 4) };
  const used = new Uint8Array(staticSprite.width * staticSprite.height);
  const parts: GeneratedPart[] = [];
  const warnings: string[] = [];
  const assumptions = [
    `Motion report had ${Array.isArray(motionReport.candidateParts) ? motionReport.candidateParts.length : "unknown"} coarse candidate region(s); semantic boxes were chosen from contact-sheet inspection.`,
    "Central joints use intentional hidden underpaint/overlap where needed; deformation is approximated with small translation, rotation, and scale keyframes.",
  ];

  for (const spec of specs) {
    const source = spec.sourceFrame === "best-flame" ? bestFlameFrame(frames, spec.sourceRect ?? fullRect(staticSprite)) : staticSprite;
    const mask = buildSpecMask(source, spec, used, staticSprite.width, staticSprite.height, palette);
    const bounds = maskBounds(mask, staticSprite.width, staticSprite.height);
    if (!bounds) {
      warnings.push(`${spec.name} produced no visible pixels and was skipped`);
      continue;
    }
    if (spec.sourceFrame !== "best-flame" && spec.consume !== false) markUsed(used, mask);
    const padded = padAndRoundBounds(bounds, staticSprite.width, staticSprite.height, 2);
    const atlasRect = packPart(atlas, source, mask, padded, palette);
    const pivot = spec.pivot ?? { x: Math.round(atlasRect.width / 2), y: Math.round(atlasRect.height / 2) };
    const part: GeneratedPart = {
      name: spec.name,
      cellX: atlasRect.x,
      cellY: atlasRect.y,
      width: atlasRect.width,
      height: atlasRect.height,
      spriteX: padded.x - 48,
      spriteY: 48 - padded.y,
      pivot,
      z: spec.z,
      frames: spec.frames.map((frame) => ({ ...frame, cellIndex: parts.length })),
      sourceBounds: bounds,
      opaquePixels: countMask(mask),
      warning: spec.warning,
    };
    parts.push(part);
    if (spec.warning) warnings.push(spec.warning);
  }

  const remainderMask = buildRemainderMask(staticSprite, used);
  const remainderBounds = maskBounds(remainderMask, staticSprite.width, staticSprite.height);
  if (remainderBounds) {
    const padded = padAndRoundBounds(remainderBounds, staticSprite.width, staticSprite.height, 2);
    const atlasRect = packPart(atlas, staticSprite, remainderMask, padded, palette);
    parts.push({
      name: "body-remainder",
      cellX: atlasRect.x,
      cellY: atlasRect.y,
      width: atlasRect.width,
      height: atlasRect.height,
      spriteX: padded.x - 48,
      spriteY: 48 - padded.y,
      pivot: { x: Math.round(atlasRect.width / 2), y: Math.round(atlasRect.height / 2) },
      z: 0,
      frames: LOOP.map((frame) => ({ ...frame, cellIndex: parts.length })),
      sourceBounds: remainderBounds,
      opaquePixels: countMask(remainderMask),
    });
  }

  const bundle = buildPokemonAnimationAssetBundle({ side, parts, loopDuration: 32 });
  const compressed = {
    side,
    files: Object.fromEntries(
      Object.entries(bundle.files).map(([index, file]) => {
        const fileIndex = Number(index) as PokemonAnimationBundleFileIndex;
        return [fileIndex, shouldCompress(fileIndex) ? compressLz11Literal(file) : file];
      }),
    ) as typeof bundle.files,
  };

  const rigFile = `${side}_rig_256x128_ds.png`;
  const cellsFile = `${side}_rig_cells.json`;
  const planFile = `${side}_rig_plan.json`;
  const animationFile = `${side}_animation.pkanimbundle`;
  const previewFile = `${side}_rig_preview_ds.png`;
  const motionPreviewFile = `${side}_rig_motion_preview_ds.png`;
  const validation = validateFrame0(staticSprite, atlas, parts.filter((part) => part.frames?.[0]?.xScale !== 0 || part.frames?.[0]?.yScale !== 0));
  if (validation.totalMismatchedPixels > 0) warnings.push(`Frame-0 validation has ${validation.totalMismatchedPixels} mismatched pixel(s)`);

  await writeFile(path.join(outputDir, rigFile), encodePng(atlas));
  await writeFile(path.join(outputDir, previewFile), encodePng(renderComposite(atlas, parts, 96, 96, 0)));
  await writeFile(path.join(outputDir, motionPreviewFile), encodePng(renderMotionSheet(atlas, parts)));
  await writeJson(path.join(outputDir, cellsFile), {
    format: "pokeweb-generated-rig-cells-v1",
    side,
    cells: parts.map((part, index) => ({
      id: index,
      name: part.name,
      cellX: part.cellX,
      cellY: part.cellY,
      width: part.width,
      height: part.height,
      spriteX: part.spriteX,
      spriteY: part.spriteY,
      pivot: part.pivot,
      z: part.z,
      frames: part.frames,
    })),
  });
  await writeJson(path.join(outputDir, planFile), {
    format: "pokeweb-generated-rig-plan-v1",
    pokemon: target.name,
    spriteId: target.spriteId,
    side,
    assumptions,
    warnings,
    parts: parts.map((part, index) => ({
      id: index,
      name: part.name,
      sourceBounds: part.sourceBounds,
      suggestedPivotLocal: part.pivot,
      suggestedZ: part.z,
      motion: summarizeFrames(part.frames ?? []),
      notes: part.warning ? [part.warning] : [],
    })),
  });
  await writeFile(path.join(outputDir, animationFile), packagePokemonAnimationBundle(compressed));
  for (const [rawIndex, file] of Object.entries(compressed.files)) {
    if (file) await writeFile(path.join(outputDir, `${side}_file${rawIndex}.bin`), file);
  }

  return {
    side,
    parts: parts.map((part) => ({
      name: part.name ?? "part",
      sourceBounds: part.sourceBounds,
      atlas: { x: part.cellX, y: part.cellY, width: part.width, height: part.height },
      spriteX: part.spriteX,
      spriteY: part.spriteY,
      pivot: part.pivot ?? { x: part.width / 2, y: part.height / 2 },
      z: part.z ?? 0,
      opaquePixels: part.opaquePixels,
    })),
    assumptions,
    warnings,
    files: [rigFile, previewFile, motionPreviewFile, cellsFile, planFile, animationFile],
    validation,
  };
}

function partSpecs(slug: string, side: Side): PartSpec[] {
  const bob = LOOP.map((frame) => ({ ...frame, cellIndex: 0 }));
  const still: FrameEdit[] = [{ duration: 32, cellIndex: 0, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1 }];
  const tilt = (degrees: number, x = 0, y = 0): FrameEdit[] => [
    { duration: 8, cellIndex: 0, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1 },
    { duration: 8, cellIndex: 0, x, y, rotation: degrees, xScale: 1, yScale: 1 },
    { duration: 8, cellIndex: 0, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1 },
    { duration: 8, cellIndex: 0, x: -x, y, rotation: -degrees, xScale: 1, yScale: 1 },
  ];
  const common = {
    quilladin: {
      front: [
        spec("left arm/claw", [{ x: 20, y: 45, width: 20, height: 22 }], 3, tilt(-4, -1, 0)),
        spec("right arm/claw", [{ x: 60, y: 45, width: 20, height: 22 }], 3, tilt(4, 1, 0)),
        spec("left leg", [{ x: 30, y: 60, width: 17, height: 15 }], 2, tilt(3, 0, 1)),
        spec("right leg", [{ x: 53, y: 59, width: 18, height: 16 }], 2, tilt(-3, 0, 1)),
        spec("head/face/spikes", [{ x: 30, y: 22, width: 39, height: 34 }], 6, tilt(1, 0, 0)),
        spec("green shell/body", [{ x: 25, y: 38, width: 49, height: 31 }], 1, bob),
      ],
      back: [
        spec("left arm/claw", [{ x: 17, y: 45, width: 19, height: 23 }], 3, tilt(-4, -1, 0)),
        spec("right arm/claw", [{ x: 58, y: 45, width: 18, height: 22 }], 3, tilt(4, 1, 0)),
        spec("left leg", [{ x: 22, y: 61, width: 18, height: 15 }], 2, tilt(3, 0, 1)),
        spec("right leg", [{ x: 51, y: 60, width: 20, height: 16 }], 2, tilt(-3, 0, 1)),
        spec("ears/back-spikes", [{ x: 28, y: 23, width: 39, height: 19 }], 5, tilt(1, 0, 0)),
        spec("green shell", [{ x: 23, y: 31, width: 49, height: 35 }], 1, bob),
      ],
    },
    fennekin: {
      front: [
        spec("left ear", [{ x: 29, y: 26, width: 17, height: 24 }], 5, tilt(-4, -1, 0)),
        spec("right ear", [{ x: 50, y: 26, width: 20, height: 25 }], 5, tilt(4, 1, 0)),
        spec("head/face", [{ x: 33, y: 40, width: 28, height: 18 }], 6, tilt(3, 0, -1)),
        spec("tail", [{ x: 55, y: 47, width: 16, height: 18 }], 2, tilt(7, 1, 0)),
        spec("body/legs", [{ x: 35, y: 53, width: 25, height: 18 }], 1, bob),
      ],
      back: [
        spec("left ear", [{ x: 28, y: 26, width: 22, height: 24 }], 5, tilt(-4, -1, 0)),
        spec("right ear", [{ x: 48, y: 26, width: 21, height: 25 }], 5, tilt(4, 1, 0)),
        spec("head/back", [{ x: 35, y: 39, width: 30, height: 18 }], 6, tilt(3, 0, -1)),
        spec("tail", [{ x: 28, y: 50, width: 19, height: 17 }], 2, tilt(-7, -1, 0)),
        spec("body/legs", [{ x: 39, y: 52, width: 22, height: 19 }], 1, bob),
      ],
    },
    braixen: {
      front: [
        spec("left ear", [{ x: 23, y: 14, width: 25, height: 22 }], 6, tilt(-2, 0, 0)),
        spec("right ear", [{ x: 49, y: 14, width: 27, height: 22 }], 6, tilt(2, 0, 0)),
        spec("head/face", [{ x: 32, y: 25, width: 29, height: 24 }], 7, tilt(1, 0, 0)),
        {
          ...spec("arm/wand", [{ x: 55, y: 30, width: 25, height: 29 }], 5, tilt(4, 1, 0)),
          warning: "Intermittent wand flame was not split into a separate cell to keep the first-pass rig at 8 or fewer parts.",
        },
        spec("tail", [{ x: 57, y: 48, width: 20, height: 30 }], 2, tilt(4, 1, 0)),
        spec("torso/skirt/legs", [{ x: 29, y: 42, width: 34, height: 41 }], 3, bob),
      ],
      back: [
        spec("left ear", [{ x: 21, y: 14, width: 26, height: 22 }], 6, tilt(-2, 0, 0)),
        spec("right ear", [{ x: 48, y: 14, width: 26, height: 22 }], 6, tilt(2, 0, 0)),
        spec("head/back", [{ x: 31, y: 25, width: 30, height: 24 }], 7, tilt(1, 0, 0)),
        {
          ...spec("arm/wand", [{ x: 58, y: 29, width: 18, height: 30 }], 5, tilt(4, 1, 0)),
          warning: "Intermittent wand flame was not split into a separate cell to keep the first-pass rig at 8 or fewer parts.",
        },
        spec("tail", [{ x: 25, y: 48, width: 27, height: 32 }], 2, tilt(-4, -1, 0)),
        spec("torso/skirt/legs", [{ x: 32, y: 42, width: 33, height: 41 }], 3, bob),
      ],
    },
    froakie: {
      front: [
        spec("head-body-bubble core", [{ x: 32, y: 35, width: 31, height: 31 }], 5, bob),
        overlapSpec("left arm", [{ x: 29, y: 54, width: 13, height: 17 }], 6, tilt(-3, -1, 0)),
        overlapSpec("right arm", [{ x: 53, y: 54, width: 11, height: 16 }], 6, tilt(3, 1, 0)),
        overlapSpec("feet", [{ x: 33, y: 62, width: 28, height: 10 }], 4, bob),
      ],
      back: [
        spec("head-body-bubble core", [{ x: 33, y: 36, width: 33, height: 30 }], 5, bob),
        overlapSpec("left arm", [{ x: 31, y: 55, width: 12, height: 16 }], 6, tilt(-3, -1, 0)),
        overlapSpec("right arm", [{ x: 55, y: 55, width: 12, height: 16 }], 6, tilt(3, 1, 0)),
        overlapSpec("feet", [{ x: 35, y: 62, width: 30, height: 10 }], 4, bob),
        overlapSpec("rear tail", [{ x: 58, y: 52, width: 9, height: 13 }], 3, tilt(4, 1, 0)),
      ],
    },
  } satisfies Record<string, Record<Side, PartSpec[]>>;
  return common[slug]?.[side] ?? [];
}

function spec(name: string, rects: Rect[], z: number, frames: FrameEdit[]): PartSpec {
  return { name, rects, z, frames };
}

function overlapSpec(name: string, rects: Rect[], z: number, frames: FrameEdit[]): PartSpec {
  return {
    ...spec(name, rects, z, frames),
    allowOverlap: true,
    warning: `${name} includes a small root overlap with the core cell to avoid exposed socket gaps.`,
  };
}

function flameSpec(side: Side, frames: FrameEdit[]): PartSpec {
  return {
    name: "intermittent wand flame",
    sourceFrame: "best-flame",
    sourceRect: side === "front" ? { x: 18, y: 54, width: 22, height: 25 } : { x: 60, y: 51, width: 18, height: 20 },
    z: 8,
    frames,
    match: (_x, _y, color) => color.r > 160 && color.g > 60 && color.g < 210 && color.b < 80,
    warning: "Intermittent Braixen flame was recovered from later frames and remapped to the normal sprite palette; it is an approximation.",
  };
}

function buildSpecMask(source: RgbaImageData, spec: PartSpec, used: Uint8Array, width: number, height: number, palette: RgbColor[]): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if ((source.pixels[offset + 3] ?? 0) < 128) continue;
      if (spec.sourceFrame !== "best-flame" && !spec.allowOverlap && used[y * width + x]) continue;
      if (spec.rects && !spec.rects.some((rect) => contains(rect, x, y))) continue;
      const color = nearestPaletteColor({ r: source.pixels[offset] ?? 0, g: source.pixels[offset + 1] ?? 0, b: source.pixels[offset + 2] ?? 0 }, palette);
      if (spec.match && !spec.match(x, y, color)) continue;
      mask[y * width + x] = 1;
    }
  }
  return mask;
}

function buildRemainderMask(source: RgbaImageData, used: Uint8Array): Uint8Array {
  const mask = new Uint8Array(source.width * source.height);
  for (let index = 0; index < mask.length; index += 1) {
    if ((source.pixels[index * 4 + 3] ?? 0) >= 128 && !used[index]) mask[index] = 1;
  }
  return mask;
}

let packX = 0;
let packY = 0;
let shelfH = 0;

function packPart(atlas: RgbaImageData, source: RgbaImageData, mask: Uint8Array, bounds: Rect, palette: RgbColor[]): Rect {
  if (packX + bounds.width > atlas.width) {
    packX = 0;
    packY += shelfH;
    shelfH = 0;
  }
  if (packY + bounds.height > atlas.height) throw new Error(`Rig atlas overflow while packing ${JSON.stringify(bounds)}`);
  const rect = { x: packX, y: packY, width: bounds.width, height: bounds.height };
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      const sx = bounds.x + x;
      const sy = bounds.y + y;
      const targetOffset = ((rect.y + y) * atlas.width + rect.x + x) * 4;
      if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height || !mask[sy * source.width + sx]) {
        atlas.pixels.set(TRANSPARENT, targetOffset);
        continue;
      }
      const sourceOffset = (sy * source.width + sx) * 4;
      const rounded = nearestPaletteColor(
        { r: source.pixels[sourceOffset] ?? 0, g: source.pixels[sourceOffset + 1] ?? 0, b: source.pixels[sourceOffset + 2] ?? 0 },
        palette,
      );
      atlas.pixels.set([rounded.r, rounded.g, rounded.b, 255], targetOffset);
    }
  }
  packX += bounds.width;
  shelfH = Math.max(shelfH, bounds.height);
  return rect;
}

function resetPacker(): void {
  packX = 0;
  packY = 0;
  shelfH = 0;
}

function renderComposite(rig: RgbaImageData, parts: PokemonAnimationBuildPart[], width: number, height: number, frameIndex: number): RgbaImageData {
  const out: RgbaImageData = { width, height, pixels: new Uint8ClampedArray(width * height * 4) };
  const sorted = [...parts].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  for (const part of sorted) {
    const frame = part.frames?.[frameIndex % part.frames.length] ?? { duration: 8, cellIndex: 0, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1 };
    if ((frame.xScale ?? 1) === 0 || (frame.yScale ?? 1) === 0) continue;
    const pivot = part.pivot ?? { x: part.width / 2, y: part.height / 2 };
    const radians = ((frame.rotation ?? 0) * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const pivotScreenX = 48 + part.spriteX + (frame.x ?? 0) + pivot.x;
    const pivotScreenY = 48 - part.spriteY + (frame.y ?? 0) + pivot.y;
    for (let y = 0; y < part.height; y += 1) {
      for (let x = 0; x < part.width; x += 1) {
        const sourceOffset = ((part.cellY + y) * rig.width + part.cellX + x) * 4;
        if ((rig.pixels[sourceOffset + 3] ?? 0) < 128) continue;
        const relX = (x - pivot.x) * (frame.xScale ?? 1);
        const relY = (y - pivot.y) * (frame.yScale ?? 1);
        const outX = Math.round(pivotScreenX + relX * cos - relY * sin);
        const outY = Math.round(pivotScreenY + relX * sin + relY * cos);
        if (outX < 0 || outY < 0 || outX >= width || outY >= height) continue;
        out.pixels.set(rig.pixels.subarray(sourceOffset, sourceOffset + 4), (outY * width + outX) * 4);
      }
    }
  }
  return out;
}

function renderMotionSheet(rig: RgbaImageData, parts: PokemonAnimationBuildPart[]): RgbaImageData {
  const frameCount = 4;
  const frameWidth = 96;
  const frameHeight = 96;
  const sheet: RgbaImageData = { width: frameWidth * frameCount, height: frameHeight, pixels: new Uint8ClampedArray(frameWidth * frameCount * frameHeight * 4) };
  for (let index = 0; index < sheet.pixels.length; index += 4) sheet.pixels.set([28, 31, 45, 255], index);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frame = renderComposite(rig, parts, frameWidth, frameHeight, frameIndex);
    for (let y = 0; y < frameHeight; y += 1) {
      for (let x = 0; x < frameWidth; x += 1) {
        const sourceOffset = (y * frameWidth + x) * 4;
        if ((frame.pixels[sourceOffset + 3] ?? 0) < 128) continue;
        const targetOffset = (y * sheet.width + frameIndex * frameWidth + x) * 4;
        sheet.pixels.set(frame.pixels.subarray(sourceOffset, sourceOffset + 4), targetOffset);
      }
    }
  }
  return sheet;
}

function validateFrame0(expected: RgbaImageData, rig: RgbaImageData, parts: PokemonAnimationBuildPart[]): SideResult["validation"] {
  const actual = renderComposite(rig, parts, expected.width, expected.height, 0);
  let missingPixelCount = 0;
  let extraPixelCount = 0;
  let colorMismatchCount = 0;
  for (let offset = 0; offset < expected.pixels.length; offset += 4) {
    const expectedOpaque = (expected.pixels[offset + 3] ?? 0) >= 128;
    const actualOpaque = (actual.pixels[offset + 3] ?? 0) >= 128;
    if (expectedOpaque && !actualOpaque) missingPixelCount += 1;
    else if (!expectedOpaque && actualOpaque) extraPixelCount += 1;
    else if (expectedOpaque && actualOpaque) {
      const diff =
        Math.abs((expected.pixels[offset] ?? 0) - (actual.pixels[offset] ?? 0)) +
        Math.abs((expected.pixels[offset + 1] ?? 0) - (actual.pixels[offset + 1] ?? 0)) +
        Math.abs((expected.pixels[offset + 2] ?? 0) - (actual.pixels[offset + 2] ?? 0));
      if (diff > 18) colorMismatchCount += 1;
    }
  }
  return { missingPixelCount, extraPixelCount, colorMismatchCount, totalMismatchedPixels: missingPixelCount + extraPixelCount + colorMismatchCount };
}

function bestFlameFrame(frames: RgbaImageData[], rect: Rect): RgbaImageData {
  let best = frames[0]!;
  let bestScore = -1;
  for (const frame of frames) {
    let score = 0;
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) {
        if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) continue;
        const offset = (y * frame.width + x) * 4;
        const r = frame.pixels[offset] ?? 0;
        const g = frame.pixels[offset + 1] ?? 0;
        const b = frame.pixels[offset + 2] ?? 0;
        if ((frame.pixels[offset + 3] ?? 0) >= 128 && r > 160 && g > 50 && g < 220 && b < 90) score += 1;
      }
    }
    if (score > bestScore) {
      best = frame;
      bestScore = score;
    }
  }
  return best;
}

function maskBounds(mask: Uint8Array, width: number, height: number): Rect | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : undefined;
}

function padAndRoundBounds(bounds: Rect, imageWidth: number, imageHeight: number, pad: number): Rect {
  const x = Math.max(0, bounds.x - pad);
  const y = Math.max(0, bounds.y - pad);
  const maxX = Math.min(imageWidth, bounds.x + bounds.width + pad);
  const maxY = Math.min(imageHeight, bounds.y + bounds.height + pad);
  return { x, y, width: roundUp8(maxX - x), height: roundUp8(maxY - y) };
}

function markUsed(used: Uint8Array, mask: Uint8Array): void {
  for (let index = 0; index < used.length; index += 1) if (mask[index]) used[index] = 1;
}

function countMask(mask: Uint8Array): number {
  return mask.reduce((sum, value) => sum + value, 0);
}

function nearestPaletteColor(color: RgbColor, palette: RgbColor[]): RgbColor {
  const rounded = roundTripBgr555Color(color);
  let best = palette[0] ?? rounded;
  let bestDistance = Infinity;
  for (const candidate of palette) {
    const distance = (candidate.r - rounded.r) ** 2 + (candidate.g - rounded.g) ** 2 + (candidate.b - rounded.b) ** 2;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

async function readFramePaths(dir: string): Promise<string[]> {
  const manifest = await readJson<{ frames: Array<{ file: string }> }>(path.join(dir, "manifest.json"));
  return manifest.frames.map((frame) => path.join(dir, frame.file));
}

async function readRgbaPng(filePath: string): Promise<RgbaImageData> {
  const decoded = decodePng(await readBytes(filePath));
  return { width: decoded.width, height: decoded.height, pixels: decoded.pixels };
}

async function readPalette(filePath: string): Promise<RgbColor[]> {
  const image = await readRgbaPng(filePath);
  const colors: RgbColor[] = [];
  for (let index = 0; index < 16; index += 1) {
    const offset = index * 4;
    colors.push({ r: image.pixels[offset] ?? 0, g: image.pixels[offset + 1] ?? 0, b: image.pixels[offset + 2] ?? 0 });
  }
  return colors;
}

async function loadRom(filePath: string): Promise<Awaited<ReturnType<typeof loadProjectFromRomFile>>> {
  const bytes = await readBytes(filePath);
  return loadProjectFromRomFile(new File([bytes], path.basename(filePath)), {
    expandSprites: true,
    selectedNarcs: ["pokemon_sprites"],
  });
}

function readPokedexNames(project: Awaited<ReturnType<typeof loadProjectFromRomFile>>, spriteIds: number[]): Record<number, string> {
  const mappings = project.session.baseRom === "BW2" ? BW2_MESSAGE_BANKS : BW_MESSAGE_BANKS;
  const bankId = mappings.find(([, bankName]) => bankName === "pokedex")?.[0];
  if (bankId === undefined) throw new Error("Could not resolve Pokedex text bank");
  const bank = getTextBank(project, "message_texts", bankId);
  const wanted = new Set(spriteIds);
  const names: Record<number, string> = {};
  for (const entry of bank) {
    const id = parseTextEntryId(entry[0]).entry;
    if (wanted.has(id)) names[id] = entry[1];
  }
  return names;
}

function readInsertedRigImage(project: Awaited<ReturnType<typeof loadProjectFromRomFile>>, spriteId: number, side: Side): RgbaImageData {
  return getPokemonSpriteImage(project, spriteId, { kind: "rig", side, gender: "male" }, "normal");
}

async function readBytes(filePath: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(filePath));
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

function fullRect(image: RgbaImageData): Rect {
  return { x: 0, y: 0, width: image.width, height: image.height };
}

function roundUp8(value: number): number {
  return Math.max(8, Math.ceil(value / 8) * 8);
}

function shouldCompress(fileIndex: PokemonAnimationBundleFileIndex): boolean {
  return fileIndex === 5 || fileIndex === 14;
}

function summarizeFrames(frames: FrameEdit[]): string {
  const moving = frames.some((frame) => frame.x !== 0 || frame.y !== 0 || frame.rotation !== 0 || frame.xScale !== 1 || frame.yScale !== 1);
  return moving ? `${frames.length} keyed SRT frame(s)` : "static frame";
}

await main();
