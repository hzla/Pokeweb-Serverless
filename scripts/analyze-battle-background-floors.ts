import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { readAscii, readU32 } from "../src/nds/binary";
import { buildModelPrimitives, readNitroResources, type Map3dPrimitive } from "../src/pokeweb/map3dModel";

const GRAPHICS_PATH = "a/0/1/1";
const TABLE_PATH = "a/1/5/1";
const RECORD_BYTES = 64;
const NO_RESOURCE = 0xffff;
const SEASONS = ["Spring", "Summer", "Autumn", "Winter"] as const;

type MaterialMetrics = {
  material: string;
  texture: string;
  triangles: number;
  area: number;
  horizontalArea: number;
  projectedArea: number;
  minY: number;
  maxY: number;
  horizontalMinY: number;
  horizontalMaxY: number;
  originHits: number;
  centerCoverage: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

type TextureInfo = { width: number; height: number; format: number };

type ResourceAnalysis = {
  backgrounds: Array<{ index: number; season: string; fallback: boolean }>;
  primitiveCount: number;
  triangleCount: number;
  metrics: MaterialMetrics[];
  textureInfo: Record<string, TextureInfo>;
  paletteByMaterial: Record<string, string>;
  warnings: string[];
};

type BackgroundVariant = {
  index: number;
  resourceId?: number;
  seasons: Array<{ season: string; fallback: boolean }>;
};

type FloorCandidate = MaterialMetrics & TextureInfo & { role: "primary" | "secondary"; confidence: "high" | "medium"; relativeArea: number };

type MaterialAccumulator = MaterialMetrics & { coveredSamples: Set<number> };

const CENTER_SAMPLES = [-30, -15, 0, 15, 30].flatMap((x) => [-45, -30, -15, 0, 15].map((z) => [x, z] as const));

const romPath = process.argv.find((argument) => !argument.startsWith("--") && argument !== process.argv[0] && argument !== process.argv[1]) ?? "../cleanwhite2.nds";
const romBytes = new Uint8Array(await readFile(romPath));
const romHash = createHash("sha256").update(romBytes).digest("hex");
const rom = new NintendoDSRom(romBytes);
const graphics = new NARC(rom.getFileByName(GRAPHICS_PATH));
const table = new NARC(rom.getFileByName(TABLE_PATH));
const rows = table.files[1];
if (!rows || rows.length % RECORD_BYTES !== 0) throw new Error("Unexpected battle-background table layout.");

const resources = new Map<number, ResourceAnalysis>();
const backgroundVariants: BackgroundVariant[] = [];
for (let index = 0; index < rows.length / RECORD_BYTES; index += 1) {
  const springResource = white2Resource(readU32(rows, index * RECORD_BYTES));
  const grouped = new Map<number | undefined, BackgroundVariant>();
  for (let season = 0; season < 4; season += 1) {
    const explicit = white2Resource(readU32(rows, index * RECORD_BYTES + season * 4));
    const resourceId = explicit ?? springResource;
    const variant = grouped.get(resourceId) ?? { index, resourceId, seasons: [] };
    variant.seasons.push({ season: SEASONS[season], fallback: explicit === undefined && resourceId !== undefined });
    grouped.set(resourceId, variant);
    if (resourceId === undefined) continue;
    const current = resources.get(resourceId) ?? analyzeResource(graphics, resourceId);
    current.backgrounds.push({ index, season: SEASONS[season], fallback: explicit === undefined });
    resources.set(resourceId, current);
  }
  backgroundVariants.push(...grouped.values());
}

if (process.argv.includes("--all-packed")) {
  for (let index = 0; index < rows.length / RECORD_BYTES; index += 1) {
    for (let season = 0; season < SEASONS.length; season += 1) {
      const packed = readU32(rows, index * RECORD_BYTES + season * 4);
      const members = [packed & 0xffff, packed >>> 16];
      for (let version = 0; version < members.length; version += 1) {
        const resourceId = members[version] ?? NO_RESOURCE;
        const bytes = graphics.files[resourceId];
        if (resourceId === NO_RESOURCE || !bytes || readAscii(bytes, 0, 4) !== "BMD0") continue;
        const current = resources.get(resourceId) ?? analyzeResource(graphics, resourceId);
        current.backgrounds.push({ index, season: `${SEASONS[season]} ${version === 0 ? "low" : "high"}`, fallback: false });
        resources.set(resourceId, current);
      }
    }
  }
}

const report = { rom: rom.name, idCode: rom.idCode, sha256: romHash, resources: [...resources.entries()].map(([resourceId, value]) => ({ resourceId, ...value })) };
if (process.argv.includes("--summary")) {
  console.log("nsbmd_member,backgrounds,material,texture,palette,width,height,format,role,confidence,center_coverage,projected_area,notes");
  for (const [resourceId, analysis] of [...resources.entries()].sort(([left], [right]) => left - right)) {
    const candidate = floorCandidates(analysis)[0];
    const untexturedBase = analysis.metrics.some((metric) => metric.texture === "(untextured)" && metric.centerCoverage >= 0.5 && metric.projectedArea > 100);
    const values = candidate
      ? [
          String(resourceId),
          analysis.backgrounds.map(({ index, season }) => `${index}:${season}`).join("; "),
          candidate.material,
          candidate.texture,
          analysis.paletteByMaterial[candidate.material] ?? "",
          String(candidate.width),
          String(candidate.height),
          formatName(candidate.format),
          candidate.role,
          candidate.confidence,
          String(candidate.centerCoverage),
          String(candidate.projectedArea),
          untexturedBase ? "Large untextured base plane also present" : "",
        ]
      : [String(resourceId), analysis.backgrounds.map(({ index, season }) => `${index}:${season}`).join("; "), "", "", "", "", "", "", "", "", "", "", "No textured central horizontal surface identified"];
    console.log(values.map(csvCell).join(","));
  }
} else if (process.argv.includes("--write")) {
  const markdownPath = "docs/battle-background-floor-textures-white2.md";
  const csvPath = "docs/battle-background-floor-textures-white2.csv";
  await writeFile(markdownPath, markdownReport(backgroundVariants, resources, report), "utf8");
  await writeFile(csvPath, csvReport(backgroundVariants, resources), "utf8");
  console.log(`Wrote ${markdownPath} and ${csvPath}.`);
} else {
  console.log(JSON.stringify(report, null, 2));
}

function white2Resource(packed: number): number | undefined {
  const low = packed & 0xffff;
  const high = packed >>> 16;
  if (high !== NO_RESOURCE) return high;
  return low === NO_RESOURCE ? undefined : low;
}

function analyzeResource(graphics: NARC, resourceId: number) {
  const bytes = graphics.files[resourceId];
  if (!bytes) throw new Error(`Missing battle-graphics resource ${resourceId}.`);
  const parsed = readNitroResources(bytes);
  const warnings: string[] = [];
  const primitives = buildModelPrimitives(parsed, warnings, { recoverSkippedPieces: true });
  return {
    backgrounds: [] as Array<{ index: number; season: string; fallback: boolean }>,
    primitiveCount: primitives.length,
    triangleCount: primitives.reduce((sum, primitive) => sum + primitive.indices.length / 3, 0),
    metrics: materialMetrics(primitives),
    textureInfo: Object.fromEntries(
      parsed.textures.map((texture) => [
        texture.name,
        { width: texture.params.width(), height: texture.params.height(), format: texture.params.format() },
      ]),
    ),
    paletteByMaterial: Object.fromEntries(
      parsed.models.flatMap((model) => model.materials.map((material) => [material.name, material.paletteName ?? ""])),
    ),
    warnings,
  };
}

function floorCandidates(analysis: ResourceAnalysis): FloorCandidate[] {
  const textured = analysis.metrics.filter((metric) => metric.texture !== "(untextured)" && metric.projectedArea > 0);
  const maxProjectedArea = Math.max(0, ...textured.filter((metric) => !isExcludedSurface(metric.texture)).map((metric) => metric.projectedArea));
  return textured
    .filter((metric) => {
      const relativeArea = maxProjectedArea > 0 ? metric.projectedArea / maxProjectedArea : 0;
      const meaningful = metric.centerCoverage >= 0.08 || metric.originHits > 0 || relativeArea >= 0.15;
      const geometricFallback = metric.centerCoverage >= 0.5 && relativeArea >= 0.15;
      return !isExcludedSurface(metric.texture) && meaningful && (isFloorNamed(metric.texture) || geometricFallback);
    })
    .map((metric) => {
      const relativeArea = maxProjectedArea > 0 ? metric.projectedArea / maxProjectedArea : 0;
      const confidence = metric.centerCoverage >= 0.5 || relativeArea >= 0.75 || (metric.originHits > 0 && relativeArea >= 0.15) ? "high" : "medium";
      const role = confidence === "high" ? "primary" : "secondary";
      return { ...metric, ...(analysis.textureInfo[metric.texture] ?? { width: 0, height: 0, format: 0 }), relativeArea, confidence, role };
    });
}

function isFloorNamed(texture: string): boolean {
  const name = texture.toLowerCase();
  return /(?:^|_)(?:field\d*[a-z]*|fd|ground\d*|floor\d*|road|sand|sea|wave|shadow|cloud(?:_b)?)(?:_|$)/u.test(name) || name === "future_line";
}

function isExcludedSurface(texture: string): boolean {
  const name = texture.toLowerCase();
  if (name === "sky_cloud" || name === "sky_cloud_b") return false;
  return /^(?:efect|effect)_/u.test(name)
    || /(?:^|_)(?:sky|wall|car|ship|stage|steel|light|pillar|frame|base|panel|box|tv|sofa|grave|bench|tree)(?:_|$)/u.test(name)
    || /(?:^|_)roof(?:_\d+)?$/u.test(name);
}

function markdownReport(variants: BackgroundVariant[], analyses: Map<number, ResourceAnalysis>, metadata: typeof report): string {
  const lines = [
    "# Pokémon White 2 battle-background floor textures",
    "",
    `Generated from \`${romPath}\` (game code \`${metadata.idCode}\`, SHA-256 \`${metadata.sha256}\`).`,
    "",
    "This table covers the **field/background NSBMD** selected by `a/1/5/1` and stored in `a/0/1/1`. Pokémon platforms are separate stage models and are not included.",
    "",
    "Candidates are found from actual model geometry: triangles whose plane is at least 75% horizontal are grouped by material/texture, then ranked by projected area and coverage around the battle center. Texture names are used only to reject obvious sky, wall, prop, and effect layers. `fallback` means the season has no explicit model and uses Spring's model.",
    "",
    "| Background | Season(s) | NSBMD member | Floor material → texture | Size / format | Role | Confidence | Notes |",
    "|---:|---|---:|---|---|---|---|---|",
  ];
  for (const variant of variants.sort((a, b) => a.index - b.index || (a.resourceId ?? Number.MAX_SAFE_INTEGER) - (b.resourceId ?? Number.MAX_SAFE_INTEGER))) {
    const seasonText = variant.seasons.map(({ season, fallback }) => `${season}${fallback ? " (fallback)" : ""}`).join("<br>");
    const analysis = variant.resourceId === undefined ? undefined : analyses.get(variant.resourceId);
    const candidates = analysis ? floorCandidates(analysis) : [];
    const untexturedBase = analysis?.metrics.some((metric) => metric.texture === "(untextured)" && metric.centerCoverage >= 0.5 && metric.projectedArea > 100);
    const note = variant.resourceId === undefined
      ? "No field model in this table row."
      : candidates.length === 0
        ? "No textured central horizontal surface was identified."
        : untexturedBase
          ? "Also contains a large untextured base plane."
          : "";
    const materialText = candidates.map((candidate) => `\`${candidate.material}\` → \`${candidate.texture}\``).join("<br>") || "—";
    const sizeText = candidates.map((candidate) => `${candidate.width}×${candidate.height} / ${formatName(candidate.format)}`).join("<br>") || "—";
    const roles = candidates.map((candidate) => candidate.role).join("<br>") || "—";
    const confidence = candidates.map((candidate) => candidate.confidence).join("<br>") || "—";
    lines.push(`| ${variant.index} | ${seasonText} | ${variant.resourceId ?? "—"} | ${materialText} | ${sizeText} | ${roles} | ${confidence} | ${note} |`);
  }
  lines.push(
    "",
    "## Interpretation",
    "",
    "- A **primary** texture covers most of the central horizontal surface or dominates projected floor area.",
    "- A **secondary** texture is a meaningful layered/partial floor surface, such as water, road, edging, or an animated detail plane.",
    "- Compound scenes can require swapping more than one listed texture to recolor the complete visible floor.",
    "- This is deliberately conservative: small horizontal prop surfaces are excluded even when they share a field-like asset family.",
  );
  return `${lines.join("\n")}\n`;
}

function csvReport(variants: BackgroundVariant[], analyses: Map<number, ResourceAnalysis>): string {
  const rows = [["background", "seasons", "nsbmd_member", "material", "texture", "width", "height", "format", "role", "confidence", "center_coverage", "projected_area", "notes"]];
  for (const variant of variants.sort((a, b) => a.index - b.index || (a.resourceId ?? Number.MAX_SAFE_INTEGER) - (b.resourceId ?? Number.MAX_SAFE_INTEGER))) {
    const seasons = variant.seasons.map(({ season, fallback }) => `${season}${fallback ? " (fallback)" : ""}`).join("; ");
    const analysis = variant.resourceId === undefined ? undefined : analyses.get(variant.resourceId);
    const candidates = analysis ? floorCandidates(analysis) : [];
    const untexturedBase = analysis?.metrics.some((metric) => metric.texture === "(untextured)" && metric.centerCoverage >= 0.5 && metric.projectedArea > 100);
    const notes = variant.resourceId === undefined ? "No field model" : untexturedBase ? "Large untextured base plane also present" : candidates.length === 0 ? "No textured central horizontal surface identified" : "";
    if (candidates.length === 0) rows.push([String(variant.index), seasons, String(variant.resourceId ?? ""), "", "", "", "", "", "", "", "", "", notes]);
    for (const candidate of candidates) {
      rows.push([
        String(variant.index), seasons, String(variant.resourceId ?? ""), candidate.material, candidate.texture,
        String(candidate.width), String(candidate.height), formatName(candidate.format), candidate.role, candidate.confidence,
        String(candidate.centerCoverage), String(candidate.projectedArea), notes,
      ]);
    }
  }
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function formatName(format: number): string {
  return ["none", "A3I5", "2-color", "16-color", "256-color", "4×4 compressed", "A5I3", "direct-color"][format] ?? `format ${format}`;
}

function csvCell(value: string): string {
  return /[",\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function materialMetrics(primitives: Map3dPrimitive[]): MaterialMetrics[] {
  const byKey = new Map<string, MaterialAccumulator>();
  for (const primitive of primitives) {
    const material = primitive.material.name;
    const texture = primitive.material.texture?.name ?? "(untextured)";
    const key = `${material}\u0000${texture}`;
    const metric = byKey.get(key) ?? {
      material,
      texture,
      triangles: 0,
      area: 0,
      horizontalArea: 0,
      projectedArea: 0,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
      horizontalMinY: Number.POSITIVE_INFINITY,
      horizontalMaxY: Number.NEGATIVE_INFINITY,
      originHits: 0,
      centerCoverage: 0,
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY,
      maxZ: Number.NEGATIVE_INFINITY,
      coveredSamples: new Set<number>(),
    };
    for (let index = 0; index + 2 < primitive.indices.length; index += 3) {
      const a = vertex(primitive, primitive.indices[index] ?? 0);
      const b = vertex(primitive, primitive.indices[index + 1] ?? 0);
      const c = vertex(primitive, primitive.indices[index + 2] ?? 0);
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const crossLength = Math.hypot(cross[0], cross[1], cross[2]);
      const area = crossLength / 2;
      const horizontal = crossLength > 0 && Math.abs(cross[1]) / crossLength >= 0.75;
      metric.triangles += 1;
      metric.area += area;
      if (horizontal) {
        metric.horizontalArea += area;
        metric.projectedArea += Math.abs(cross[1]) / 2;
        metric.horizontalMinY = Math.min(metric.horizontalMinY, a[1], b[1], c[1]);
        metric.horizontalMaxY = Math.max(metric.horizontalMaxY, a[1], b[1], c[1]);
        if (containsProjectedPoint(a, b, c, 0, 0)) metric.originHits += 1;
        CENTER_SAMPLES.forEach(([x, z], sampleIndex) => {
          if (containsProjectedPoint(a, b, c, x, z)) metric.coveredSamples.add(sampleIndex);
        });
      }
      metric.minX = Math.min(metric.minX, a[0], b[0], c[0]);
      metric.maxX = Math.max(metric.maxX, a[0], b[0], c[0]);
      metric.minY = Math.min(metric.minY, a[1], b[1], c[1]);
      metric.maxY = Math.max(metric.maxY, a[1], b[1], c[1]);
      metric.minZ = Math.min(metric.minZ, a[2], b[2], c[2]);
      metric.maxZ = Math.max(metric.maxZ, a[2], b[2], c[2]);
    }
    byKey.set(key, metric);
  }
  return [...byKey.values()]
    .map((metric) => ({ ...metric, centerCoverage: metric.coveredSamples.size / CENTER_SAMPLES.length }))
    .sort((a, b) => b.projectedArea - a.projectedArea)
    .map(roundMetric);
}

function containsProjectedPoint(a: [number, number, number], b: [number, number, number], c: [number, number, number], x: number, z: number): boolean {
  const denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
  if (Math.abs(denominator) < 1e-9) return false;
  const first = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / denominator;
  const second = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / denominator;
  const third = 1 - first - second;
  return first >= -1e-6 && second >= -1e-6 && third >= -1e-6;
}

function vertex(primitive: Map3dPrimitive, index: number): [number, number, number] {
  const offset = index * 3;
  return [primitive.positions[offset] ?? 0, primitive.positions[offset + 1] ?? 0, primitive.positions[offset + 2] ?? 0];
}

function roundMetric(metric: MaterialMetrics): MaterialMetrics {
  return Object.fromEntries(
    Object.entries(metric)
      .filter(([key]) => key !== "coveredSamples")
      .map(([key, value]) => [key, typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 1_000) / 1_000 : value]),
  ) as MaterialMetrics;
}
