import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';

export async function readBundledPwanArchive(directory: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(gunzipSync(await readFile(path.join(directory, 'pwan.narc.gz'))));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return new Uint8Array(await readFile(path.join(directory, 'pwan.narc')));
  }
}

export async function writeBundledPwanArchive(directory: string, archive: Uint8Array) {
  // Node's gzip header has no filename and a zero timestamp, making the shipped
  // payload deterministic and independent of machine-local metadata.
  const compressed = gzipSync(archive, {level: 9});
  if (compressed.length >= 100 * 1024 * 1024) throw new Error('Compressed library exceeds the repository single-file budget');
  if (!gunzipSync(compressed).equals(Buffer.from(archive))) throw new Error('Library compression changed archive bytes');
  await writeFile(path.join(directory, 'pwan.narc.gz'), compressed);
  // Convenient for local diagnostics and older backup tools, but never tracked.
  await writeFile(path.join(directory, 'pwan.narc'), archive);
  return {encoding: 'gzip', compressedBytes: compressed.length, archiveBytes: archive.length,
    archiveSha256: createHash('sha256').update(archive).digest('hex')};
}
