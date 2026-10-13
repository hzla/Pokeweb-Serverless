import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NARC } from '../src/nds/narc';
import { NintendoDSRom } from '../src/nds/rom';
import type { PwanLibraryManifest } from '../src/pokeweb/pwanLibraryModel';
import { compilePwanLibraryIcon } from './lib/pwan-library-icons';
import { readBundledPwanArchive, writeBundledPwanArchive } from './lib/pwan-library-payload';

// Regenerate one named payload without rebuilding or recoloring any animated sides.
const [key, sourceRelative, paletteRomPath] = process.argv.slice(2);
if (!key || !sourceRelative || !paletteRomPath || !/^essentials_pngs\/Icons\/[A-Z0-9_]+\.png$/u.test(sourceRelative)) {
  throw new Error('Expected ENTRY_KEY essentials_pngs/Icons/SOURCE.png PALETTE_ROM.nds');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'src/assets/pwan/library');
const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')) as PwanLibraryManifest;
const entry = manifest.entries.find(candidate => candidate.key === key);
if (!entry?.icon) throw new Error(`Library icon ${key} is missing`);
const archive = new NARC(await readBundledPwanArchive(directory));
const rom = new NintendoDSRom(new Uint8Array(await readFile(paletteRomPath)), { fileData: 'view' });
const icons = new NARC(rom.files[rom.fileId('a/0/0/7')]);
const generated = compilePwanLibraryIcon(new Uint8Array(await readFile(path.join(root, '..', sourceRelative))), icons.files[0]!, archive.files[entry.icon.maleMemberId]!);
archive.files[entry.icon.maleMemberId] = generated.male;
archive.files[entry.icon.femaleMemberId] = generated.female;
entry.icon = { maleMemberId: entry.icon.maleMemberId, femaleMemberId: entry.icon.femaleMemberId, malePaletteId: generated.malePaletteId, femalePaletteId: generated.femalePaletteId, sourcePng: sourceRelative };
const bytes = archive.save();
manifest.archiveBytes = bytes.length;
const distribution = await writeBundledPwanArchive(directory, bytes);
await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const reportPath = path.join(directory, 'build-report.json');
const report = JSON.parse(await readFile(reportPath, 'utf8'));
report.archiveBytes = bytes.length;
report.distribution = distribution;
report.iconRepairs = { ...report.iconRepairs, [key]: { sourcePng: sourceRelative, malePaletteId: generated.malePaletteId, femalePaletteId: generated.femalePaletteId } };
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ key, sourcePng: sourceRelative, palette: generated.malePaletteId, ...distribution }));
