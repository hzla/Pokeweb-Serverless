import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, cp, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NARC } from '../src/nds/narc';
import { validatePwan } from '../src/pokeweb/pwanCompiler';
import { parsePwanLibraryArchive, type PwanLibraryManifest } from '../src/pokeweb/pwanLibraryModel';
import { parseSpriteConfig, SPRITE_PRIORITIES } from './lib/pwan-sprite-refresh';
import { gen6SpriteCredits, joinSpriteCredits, resolveSpriteCredit, type SpriteCreditTracker } from './lib/pwan-sprite-credits';
import { readBundledPwanArchive, writeBundledPwanArchive } from './lib/pwan-library-payload';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map<string, string>();
for (let n = 2; n < process.argv.length; n += 2) {
  if (!process.argv[n]?.startsWith('--') || !process.argv[n + 1]) throw new Error('Expected --option value');
  args.set(process.argv[n]!, process.argv[n + 1]!);
}
const required = (key: string) => { const value = args.get(key); if (!value) throw new Error(`Missing ${key}`); return path.resolve(value); };
const comparison = required('--comparison'), upgrade = required('--upgrade'), inputRom = required('--rom');
const output = required('--output'), trackerPath = required('--tracker'), csvPath = required('--gen6-csv');
const preset = args.get('--preset') ?? 'gen5';
if (preset !== 'gen5' && preset !== 'none') throw new Error('Expected gen5 or none preset');
const variant = preset === 'gen5' ? 'gen5' : 'new';
const read = async (file: string) => new Uint8Array(await readFile(file));
const json = async (file: string, value: unknown) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const report = JSON.parse(await readFile(path.join(comparison, 'report.json'), 'utf8'));
const comparisonBackup = JSON.parse(await readFile(path.join(comparison, 'backup/manifest.json'), 'utf8'));
const config = await read(path.join(upgrade, 'assets/pokeweb_pwan/config.bin'));
const rows = parseSpriteConfig(config);
check(hash(config) === comparisonBackup.configSha256, 'Reviewed sprite mappings no longer match');
check(JSON.stringify(report.priorityOrder) === JSON.stringify(SPRITE_PRIORITIES), 'Unreviewed priority order');
check(report.failures.length === 0 && report.preservedSides === 0, 'Only a fully imported comparison can be promoted');
const libraryDir = path.join(ROOT, 'src/assets/pwan/library');
const manifest: PwanLibraryManifest = JSON.parse(await readFile(path.join(libraryDir, 'manifest.json'), 'utf8'));
const previousBytes = await readBundledPwanArchive(libraryDir), archive = new NARC(previousBytes);
parsePwanLibraryArchive(manifest, previousBytes);
check(hash(archive.files[0]!) === hash(config), 'Library and Upgrade configs differ');
check(rows.length === report.entries && manifest.entries.length === rows.length, 'Entry inventory changed');
const trackers: Array<SpriteCreditTracker & { key: string }> = JSON.parse(await readFile(trackerPath, 'utf8'));
const csvCredits = gen6SpriteCredits(await readFile(csvPath, 'utf8'));
const replacements = new Map<string, Uint8Array>();
const currentHashes: Record<string, string> = {};
const expectedSides = new Set(rows.flatMap(row => (['front', 'back'] as const)
  .filter((_, n) => row.flags & (1 << n)).map(side => `${row.assetIndex}_${side}`)));
check(report.sprites.length === expectedSides.size && new Set(report.sprites.map((p: any) => p.id)).size === expectedSides.size, 'Duplicate or missing comparison sides');
const spriteReports = [];
for (const page of report.sprites) {
  check(expectedSides.delete(page.id) && page.id === `${page.asset}_${page.side}`, `Unexpected comparison side ${page.id}`);
  check(page.status === 'imported' && SPRITE_PRIORITIES.includes(page.group), `Unreviewed source ${page.id}`);
  check(!page.source.startsWith('/') && !page.source.includes('..') && page.source.startsWith(`${page.group}/`), 'Unsafe source path');
  const current = await read(path.join(upgrade, 'assets/pokeweb_pwan', `${page.id}.pwan`));
  const currentHash = hash(current), member = page.asset * 2 + (page.side === 'front' ? 1 : 2);
  check(currentHash === page.hashes.new || currentHash === page.hashes.gen5, `Upgrade asset changed since review: ${page.id}`);
  check(hash(archive.files[member]!) === currentHash, `Library differs from Upgrade: ${page.id}`);
  const selected = await read(path.join(comparison, variant, `${page.id}.pwan`));
  validatePwan(selected);
  check(hash(selected) === page.hashes[variant], `Reviewed preset hash changed: ${page.id}`);
  currentHashes[page.id] = currentHash;
  replacements.set(page.id, selected);
  archive.files[member] = selected;
  const entry = manifest.entries.find(e => e.speciesId === page.species && e.formIndex === page.form);
  check(entry, `No manifest entry for ${page.id}`);
  const tracker = trackers.find(t => t.key === entry!.key);
  const credit = resolveSpriteCredit({group: page.group, relative: page.source, side: page.side}, tracker, csvCredits);
  spriteReports.push({...page, ...credit, selectedPreset: preset, selectedSha256: hash(selected)});
}
check(expectedSides.size === 0, 'Missing reviewed sides');
const changedCredits = [];
for (const entry of manifest.entries) {
  const row = rows.find(r => r.speciesId === entry.speciesId && r.formIndex === entry.formIndex);
  check(row?.assetIndex === entry.assetIndex && !!(row.flags & 1) === entry.hasFront && !!(row.flags & 2) === entry.hasBack, `Manifest routing changed: ${entry.name}`);
  const sources = (['front', 'back'] as const).filter(side => side === 'front' ? entry.hasFront : entry.hasBack).map(side => {
    const page = spriteReports.find(p => p.id === `${entry.assetIndex}_${side}`)!;
    return {side, source: page.source, credits: page.credits, creditBasis: page.creditBasis};
  });
  const credits = joinSpriteCredits(sources.map(s => s.credits));
  if (entry.credits !== credits) changedCredits.push({id: entry.id, name: entry.name, previous: entry.credits, credits});
  entry.credits = credits;
  entry.creditSource = 'import-report';
  entry.spriteSources = sources;
  entry.notes = `Approved priority GIFs; nearest-neighbor resizing; TEX4 with 15 visible RGB555 colors. Gen 5 preset ${preset === 'gen5' ? 'enabled (+15% saturation, +10% contrast)' : 'disabled'}. Front/back source attributions recorded separately; timing and placement preserved.`;
}
const bytes = archive.save();
manifest.archiveBytes = bytes.length;
manifest.generatedAt = new Date().toISOString();
parsePwanLibraryArchive(manifest, bytes);
const previousArchive = new NARC(previousBytes), selectedMembers = new Set(spriteReports.map(p => p.asset * 2 + (p.side === 'front' ? 1 : 2)));
check(previousArchive.files.length === archive.files.length, 'Archive member count changed');
for (let n = 0; n < archive.files.length; n++) if (!selectedMembers.has(n)) {
  check(hash(archive.files[n]!) === hash(previousArchive.files[n]!), `Non-sprite archive member changed: ${n}`);
}
// Refuse to reuse a backup destination, then preserve all current state before
// changing either repository. No save or emulator state is read or written.
const romBytes = await read(inputRom);
await mkdir(output);
await mkdir(path.join(output, 'backup'));
await cp(path.join(upgrade, 'assets/pokeweb_pwan'), path.join(output, 'backup/w2u-pwan'), {recursive: true});
await cp(libraryDir, path.join(output, 'backup/pokeweb-library'), {recursive: true});
await copyFile(inputRom, path.join(output, 'backup/White2Upgrade-before-preset.nds'));
await json(path.join(output, 'backup/manifest.json'), {format: 'sprite-preset-backup-v1', sourceRom: path.basename(inputRom), romSha256: hash(romBytes), configSha256: hash(config), librarySha256: hash(previousBytes), assetHashes: currentHashes, savesTouched: false});
const promotion = {format: 'pokeweb-sprite-preset-promotion-v1', preset, textureFormat: 'TEX4', visibleColors: 15, sourceRom: path.basename(inputRom), sourceRomSha256: hash(romBytes), comparison: path.basename(comparison), priorityOrder: SPRITE_PRIORITIES, entries: rows.length, uniqueSides: replacements.size, importedSides: replacements.size, preservedSides: 0, missingSources: [], failures: [], changedCredits, sprites: spriteReports, iconsUnchanged: true, mappingsUnchanged: true, a3i5Installed: false, savesTouched: false};
await json(path.join(output, 'promotion.json'), promotion);
for (const [id, selected] of replacements) await writeFile(path.join(upgrade, 'assets/pokeweb_pwan', `${id}.pwan`), selected);
const distribution = await writeBundledPwanArchive(libraryDir, bytes);
await json(path.join(libraryDir, 'manifest.json'), manifest);
const buildReport = JSON.parse(await readFile(path.join(libraryDir, 'build-report.json'), 'utf8'));
buildReport.archiveBytes = bytes.length;
buildReport.distribution = distribution;
buildReport.refresh = {...buildReport.refresh, preset, textureFormat: 'TEX4', visibleColors: 15, comparison: path.basename(comparison), sourceRomSha256: hash(romBytes)};
buildReport.credits = {updatedEntries: changedCredits.length, perSideSources: true, policy: 'Selected-source attribution; completed CSV animator entries or exact-stem tracker credits only. Reservations and stale mixed-source credits are not used.'};
await json(path.join(libraryDir, 'build-report.json'), buildReport);
await json(path.join(upgrade, 'assets/pokeweb_pwan/sprite_refresh_report.json'), promotion);
console.log(JSON.stringify({preset, entries: rows.length, uniqueSides: replacements.size, archiveBytes: bytes.length, updatedCredits: changedCredits.length, backup: path.basename(output), iconsUnchanged: true, savesTouched: false}, null, 2));
