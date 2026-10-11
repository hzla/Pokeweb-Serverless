import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePwanLibraryArchive, type PwanLibraryManifest } from '../src/pokeweb/pwanLibraryModel';
import { writeBundledPwanArchive } from './lib/pwan-library-payload';

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/assets/pwan/library');
const manifest: PwanLibraryManifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
const bytes = new Uint8Array(await readFile(path.join(directory, 'pwan.narc')));
if (bytes.length !== manifest.archiveBytes) throw new Error('Manifest/archive size mismatch');
parsePwanLibraryArchive(manifest, bytes);
const distribution = await writeBundledPwanArchive(directory, bytes);
const report = JSON.parse(await readFile(path.join(directory, 'build-report.json'), 'utf8'));
report.distribution = distribution;
await writeFile(path.join(directory, 'build-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(distribution, null, 2));
