import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NintendoDSRom } from "../src/nds/rom";
import { PWAN_ARCHIVE_PATH, parsePwanArchiveBytes, pwanAssetIndex } from "../src/pokeweb/pwanAnimationModel";
import type { PwanAnimationOverride } from "../src/pokeweb/projectStore";
import type { PwanLibraryEntry, PwanLibraryManifest } from "../src/pokeweb/pwanLibraryModel";

type BuildPwanLibraryOptions = {
  romPath: string;
  trackerPath: string;
  reportsDir: string;
  outDir: string;
};

type TrackerRow = {
  key?: string;
  id?: number;
  name?: string;
  kind?: string;
  baseSpeciesId?: number;
  baseSpecies?: string;
  form?: number;
  spriteForm?: number;
  credits?: string;
  runtimeNotes?: string;
};

type ReportMatch = {
  name?: string;
  key?: string;
  credits: string[];
  notes: string[];
  sources: string[];
};

type ReportIndex = {
  byAssetIndex: Map<number, ReportMatch>;
  bySpeciesForm: Map<string, ReportMatch>;
};

type BuildReport = {
  format: "pokeweb-pwan-library-build-report-v1";
  sourceRom: string;
  archivePath: string;
  archiveBytes: number;
  entryCount: number;
  sideCount: {
    front: number;
    back: number;
    total: number;
  };
  oneSidedEntries: string[];
  missingCredits: string[];
  trackerReportMismatches: Array<{
    id: string;
    name: string;
    trackerCredits: string;
    reportCredits: string;
  }>;
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const WORKSPACE_ROOT = path.resolve(REPO_ROOT, "..");
const W2U_FORM_SPRITE_START = 724;

export function defaultBuildPwanLibraryOptions(): BuildPwanLibraryOptions {
  return {
    romPath: path.join(WORKSPACE_ROOT, "White2Upgrade", "White2Upgrade.nds"),
    trackerPath: path.join(WORKSPACE_ROOT, "White2Expansion", "data", "pokemon.gen6.json"),
    reportsDir: path.join(WORKSPACE_ROOT, "White2Upgrade", "assets", "pokeweb_pwan"),
    outDir: path.join(REPO_ROOT, "src", "assets", "pwan", "library"),
  };
}

export async function buildPwanLibrary(options: BuildPwanLibraryOptions): Promise<{ manifest: PwanLibraryManifest; report: BuildReport }> {
  const romBytes = new Uint8Array(await readFile(options.romPath));
  const rom = new NintendoDSRom(romBytes);
  const archiveFileId = rom.filenames.idOf(PWAN_ARCHIVE_PATH);
  if (archiveFileId === undefined) throw new Error(`ROM does not contain ${PWAN_ARCHIVE_PATH}`);
  const archiveBytes = rom.files[archiveFileId];
  if (!archiveBytes) throw new Error(`ROM file ${archiveFileId} for ${PWAN_ARCHIVE_PATH} is empty.`);
  const overrides = parsePwanArchiveBytes(archiveBytes);
  const trackerRows = JSON.parse(await readFile(options.trackerPath, "utf8")) as TrackerRow[];
  const reportIndex = await loadReportIndex(options.reportsDir);
  const entries = overrides.map((override) => buildManifestEntry(override, trackerRows, reportIndex));
  const frontCount = entries.filter((entry) => entry.hasFront).length;
  const backCount = entries.filter((entry) => entry.hasBack).length;
  const missingCredits = entries.filter((entry) => entry.credits.trim().length === 0).map((entry) => entry.id);
  const trackerReportMismatches = entries.flatMap((entry) => creditMismatch(entry, reportIndex));
  const manifest: PwanLibraryManifest = {
    format: "pokeweb-pwan-library-v1",
    generatedAt: new Date().toISOString(),
    sourceRom: path.relative(REPO_ROOT, options.romPath),
    archivePath: PWAN_ARCHIVE_PATH,
    archiveBytes: archiveBytes.length,
    entryCount: entries.length,
    sideCount: {
      front: frontCount,
      back: backCount,
      total: frontCount + backCount,
    },
    entries: entries.sort((a, b) => a.name.localeCompare(b.name) || a.speciesId - b.speciesId || a.formIndex - b.formIndex || a.assetIndex - b.assetIndex),
  };
  const report: BuildReport = {
    format: "pokeweb-pwan-library-build-report-v1",
    sourceRom: options.romPath,
    archivePath: PWAN_ARCHIVE_PATH,
    archiveBytes: archiveBytes.length,
    entryCount: entries.length,
    sideCount: manifest.sideCount,
    oneSidedEntries: entries.filter((entry) => entry.hasFront !== entry.hasBack).map((entry) => entry.id),
    missingCredits,
    trackerReportMismatches,
  };

  await mkdir(options.outDir, { recursive: true });
  await writeFile(path.join(options.outDir, "pwan.narc"), archiveBytes);
  await writeJson(path.join(options.outDir, "manifest.json"), manifest);
  await writeJson(path.join(options.outDir, "build-report.json"), report);
  return { manifest, report };
}

function buildManifestEntry(override: PwanAnimationOverride, trackerRows: TrackerRow[], reportIndex: ReportIndex): PwanLibraryEntry {
  const assetIndex = pwanAssetIndex(override);
  const formIndex = override.formIndex ?? 0;
  const id = `${override.speciesId}-${formIndex}-${assetIndex}`;
  const tracker = findTrackerRow(trackerRows, override.speciesId, formIndex, assetIndex);
  const report = reportIndex.bySpeciesForm.get(speciesFormKey(override.speciesId, formIndex)) ?? reportIndex.byAssetIndex.get(assetIndex);
  const trackerCredits = normalizeCreditText(tracker?.credits);
  const reportCredits = joinCredits(report?.credits ?? []);
  const credits = trackerCredits || reportCredits;
  const notes = uniqueStrings([tracker?.runtimeNotes, ...(report?.notes ?? [])]).join("; ");
  const name = formIndex > 0 && report?.name ? report.name : tracker?.name ?? report?.name ?? fallbackName(override.speciesId, formIndex);
  const kind = formIndex > 0 && tracker?.kind === "base species" ? "form" : tracker?.kind ?? (formIndex > 0 ? "form" : "base species");
  return {
    id,
    name,
    key: tracker?.key ?? report?.key ?? `PWAN_${override.speciesId}_${formIndex}`,
    kind,
    speciesId: override.speciesId,
    formIndex,
    assetIndex,
    hasFront: Boolean(override.front),
    hasBack: Boolean(override.back),
    credits,
    creditSource: trackerCredits ? "tracker" : reportCredits ? "import-report" : "missing",
    notes: notes || undefined,
  };
}

function findTrackerRow(rows: TrackerRow[], speciesId: number, formIndex: number, assetIndex: number): TrackerRow | undefined {
  if (formIndex > 0) {
    const byBaseForm = rows.find((row) => row.baseSpeciesId === speciesId && Number(row.form ?? 0) === formIndex);
    if (byBaseForm) return byBaseForm;
    const spriteForm = assetIndex - W2U_FORM_SPRITE_START;
    const bySpriteForm = rows.find((row) => Number(row.spriteForm ?? -1) === spriteForm);
    if (bySpriteForm) return bySpriteForm;
  }
  return rows.find((row) => row.id === speciesId) ?? rows.find((row) => row.id === assetIndex);
}

async function loadReportIndex(reportsDir: string): Promise<ReportIndex> {
  const byAssetIndex = new Map<number, ReportMatch>();
  const bySpeciesForm = new Map<string, ReportMatch>();
  const files = (await readdir(reportsDir)).filter((file) => file.endsWith("_import_report.json")).sort();
  for (const file of files) {
    const report = JSON.parse(await readFile(path.join(reportsDir, file), "utf8")) as unknown;
    for (const row of reportRows(report)) {
      const match = reportMatchFromRow(row, report, file);
      if (!match) continue;
      if (match.assetIndex !== undefined) mergeReportMatch(byAssetIndex, match.assetIndex, match);
      if (match.speciesId !== undefined) mergeReportMatch(bySpeciesForm, speciesFormKey(match.speciesId, match.formIndex ?? 0), match);
      if (match.baseSpeciesId !== undefined) mergeReportMatch(bySpeciesForm, speciesFormKey(match.baseSpeciesId, match.formIndex ?? 0), match);
    }
  }
  return { byAssetIndex, bySpeciesForm };
}

function reportRows(report: unknown): unknown[] {
  if (Array.isArray(report)) return report;
  if (!isRecord(report)) return [];
  const rows: unknown[] = [];
  for (const key of ["imported", "forms", "pwanConfigEntries"] as const) {
    const value = report[key];
    if (Array.isArray(value)) rows.push(...value);
  }
  if (Number.isInteger(report.species) || Number.isInteger(report.assetIndex)) rows.push(report);
  return rows;
}

function reportMatchFromRow(row: unknown, report: unknown, source: string): (ReportMatch & { assetIndex?: number; speciesId?: number; baseSpeciesId?: number; formIndex?: number }) | undefined {
  if (!isRecord(row)) return undefined;
  const assetIndex = numberValue(row.assetIndex) ?? assetIndexFromAnyDst(row);
  const speciesId = numberValue(row.species) ?? numberValue(row.id) ?? numberValue(row.personalId);
  const baseSpeciesId = numberValue(row.baseSpeciesId);
  const formIndex = numberValue(row.form);
  if (assetIndex === undefined && speciesId === undefined && baseSpeciesId === undefined) return undefined;
  const reportCredit = isRecord(report) ? stringValue(report.credit) : undefined;
  const rowCredit = stringValue(row.credit) ?? stringValue(row.animator) ?? reportCredit;
  const nestedCredits = isRecord(row.import) ? stringArrayValue(row.import.credits) : [];
  return {
    assetIndex,
    speciesId,
    baseSpeciesId,
    formIndex,
    name: stringValue(row.name) ?? stringValue(row.sourceName) ?? stringValue(row.trackerName),
    key: stringValue(row.key),
    credits: [...(rowCredit ? [rowCredit] : []), ...nestedCredits],
    notes: uniqueStrings([stringValue(row.notes), stringValue(row.runtimeNotes)]),
    sources: [source],
  };
}

function mergeReportMatch(map: Map<number | string, ReportMatch>, key: number | string, next: ReportMatch): void {
  const current = map.get(key);
  if (!current) {
    map.set(key, {
      name: next.name,
      key: next.key,
      credits: uniqueStrings(next.credits),
      notes: uniqueStrings(next.notes),
      sources: uniqueStrings(next.sources),
    });
    return;
  }
  current.name ??= next.name;
  current.key ??= next.key;
  current.credits = uniqueStrings([...current.credits, ...next.credits]);
  current.notes = uniqueStrings([...current.notes, ...next.notes]);
  current.sources = uniqueStrings([...current.sources, ...next.sources]);
}

function creditMismatch(entry: PwanLibraryEntry, reportIndex: ReportIndex): BuildReport["trackerReportMismatches"] {
  if (entry.creditSource !== "tracker") return [];
  const report = reportIndex.bySpeciesForm.get(speciesFormKey(entry.speciesId, entry.formIndex)) ?? reportIndex.byAssetIndex.get(entry.assetIndex);
  const reportCredits = joinCredits(report?.credits ?? []);
  if (!reportCredits || normalizeCreditSet(entry.credits) === normalizeCreditSet(reportCredits)) return [];
  return [{
    id: entry.id,
    name: entry.name,
    trackerCredits: entry.credits,
    reportCredits,
  }];
}

function assetIndexFromAnyDst(value: unknown): number | undefined {
  if (typeof value === "string") return assetIndexFromDst(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = assetIndexFromAnyDst(item);
      if (match !== undefined) return match;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const [key, item] of Object.entries(value)) {
    if (key === "dst" || key === "front" || key === "back" || key === "stats") {
      const match = assetIndexFromAnyDst(item);
      if (match !== undefined) return match;
    }
  }
  return undefined;
}

function assetIndexFromDst(value: string): number | undefined {
  const match = /(?:^|[/\\])(\d+)_(?:front|back)\.pwan$/iu.exec(value);
  return match ? Number(match[1]) : undefined;
}

function speciesFormKey(speciesId: number, formIndex: number): string {
  return `${speciesId}:${formIndex}`;
}

function fallbackName(speciesId: number, formIndex: number): string {
  return formIndex > 0 ? `Pokemon ${speciesId} Form ${formIndex}` : `Pokemon ${speciesId}`;
}

function normalizeCreditText(value: string | undefined): string {
  return joinCredits(value ? splitCredits(value) : []);
}

function joinCredits(values: string[]): string {
  return uniqueStrings(values.flatMap(splitCredits)).join("; ");
}

function splitCredits(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[;,]/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeCreditSet(value: string): string {
  return splitCredits(value)
    .map((credit) => credit.toLowerCase())
    .sort()
    .join(";");
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function numberValue(value: unknown): number | undefined {
  return Number.isInteger(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(argv: string[]): BuildPwanLibraryOptions {
  const defaults = defaultBuildPwanLibraryOptions();
  const options = { ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--rom" && value) {
      options.romPath = path.resolve(value);
      index += 1;
    } else if (arg === "--tracker" && value) {
      options.trackerPath = path.resolve(value);
      index += 1;
    } else if (arg === "--reports-dir" && value) {
      options.reportsDir = path.resolve(value);
      index += 1;
    } else if (arg === "--out-dir" && value) {
      options.outDir = path.resolve(value);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete option: ${arg}`);
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`Build Hzla's bundled PWAN library.

Usage:
  npm run pwan:library -- [--rom ../White2Upgrade/White2Upgrade.nds] [--tracker ../White2Expansion/data/pokemon.gen6.json] [--reports-dir ../White2Upgrade/assets/pokeweb_pwan]
`);
}

if (!process.env.VITEST) {
  const { manifest, report } = await buildPwanLibrary(parseArgs(process.argv.slice(2)));
  console.log(`Wrote ${manifest.entryCount} PWAN library entries to ${path.relative(process.cwd(), defaultBuildPwanLibraryOptions().outDir)}`);
  console.log(`Archive: ${(manifest.archiveBytes / 1024 / 1024).toFixed(1)} MB, sides: ${manifest.sideCount.total} (${manifest.sideCount.front} front, ${manifest.sideCount.back} back)`);
  console.log(`One-sided entries: ${report.oneSidedEntries.length}`);
  console.log(`Missing credits: ${report.missingCredits.length}`);
  console.log(`Tracker/report credit mismatches: ${report.trackerReportMismatches.length}`);
}
