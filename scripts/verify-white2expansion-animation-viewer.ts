import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { NARC } from '../src/nds/narc';
import { NintendoDSRom } from '../src/nds/rom';
import { validatePwan } from '../src/pokeweb/pwanCompiler';
import { readBundledPwanArchive } from './lib/pwan-library-payload';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [trackerArg,romArg] = process.argv.slice(2);
if (!trackerArg || !romArg) throw new Error('Usage: verify-white2expansion-animation-viewer.ts TRACKER_REPO INTEGRATION_ROM');
const root = path.resolve(trackerArg), read = async (p:string)=>new Uint8Array(await readFile(p));
const json = async (p:string)=>JSON.parse(await readFile(p,'utf8'));
const hash = (b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const manifest = await json(path.join(root,'animation-viewer/data/viewer-manifest.json'));
const credits = await json(path.join(root,'data/animation-credits.json'));
const progress = await json(path.join(root,'data/published-progress.json'));
const release = await json(path.join(root,'data/release-manifest.json'));
const romBytes = await read(romArg), rom = new NintendoDSRom(romBytes,{fileData:'view'});
assert.equal(manifest.sourceRomSha256,hash(romBytes));
assert.equal(release.integrationRom.sha256,hash(romBytes));
assert.equal(hash(await read(path.join(root,release.patch.path))),release.patch.sha256);
const save = await read(path.join(root,release.save.path));
assert.equal(hash(save),release.save.sha256);
assert.equal(hash(save.subarray(0,release.save.rawBytes)),release.save.rawSha256);
for (const [key,sourcePath] of [['moveAnimations','a/0/6/5'],['moveSpas','a/0/0/6'],['moveBackgrounds','a/0/9/4']] as const) {
  const row = manifest.archives[key], bytes = await read(path.join(root,'animation-viewer',row.path));
  assert.equal(hash(bytes),row.sha256);
  assert.equal(hash(bytes),hash(rom.getFileByName(sourcePath)));
}
const animations = new NARC(rom.getFileByName('a/0/6/5'));
assert.equal(new Set(manifest.moves.map((m:any)=>m.id)).size,manifest.moves.length);
for (const move of manifest.moves) {
  assert(animations.files[move.animationId ?? move.id]?.length,`Missing move script ${move.id}`);
  assert(move.credits,`Missing move credit ${move.id}`);
  assert.equal(credits.moves.find((m:any)=>m.id===move.id)?.credits,move.credits);
  assert.equal(progress.progress.moves[move.key].verified,false);
}
const library = await json(path.join(repo,'src/assets/pwan/library/manifest.json'));
const libraryBytes = await readBundledPwanArchive(path.join(repo,'src/assets/pwan/library'));
assert.equal(hash(libraryBytes),manifest.pokemonSourceSha256);
const archive = new NARC(libraryBytes), chunks = new Map<string,Record<string,Uint8Array>>();
assert.equal(new Set(manifest.sprites.map((s:any)=>s.id)).size,manifest.sprites.length);
assert.equal(new Set(manifest.sprites.map((s:any)=>s.key)).size,manifest.sprites.length);
let validatedSides = 0;
for (const sprite of manifest.sprites) {
  if (sprite.pwanChunk && !chunks.has(sprite.pwanChunk))
    chunks.set(sprite.pwanChunk,unzipSync(await read(path.join(root,'animation-viewer',sprite.pwanChunk))));
  for (const side of ['front','back'] as const) {
    if (sprite.pwan[side]) {
      const bytes = chunks.get(sprite.pwanChunk)![sprite.pwan[side].path]!;
      assert(bytes,`Missing preview side ${sprite.name}:${side}`);
      validatePwan(bytes); validatedSides++;
    } else if (sprite.native[side]) {
      const bytes = await read(path.join(root,'animation-viewer',sprite.native[side]));
      assert.equal(Buffer.from(bytes.subarray(1,4)).toString(),'PNG');
    } else throw new Error(`No preview or native fallback for ${sprite.name}:${side}`);
  }
}
for (const entry of library.entries) {
  const sprite = manifest.sprites.find((s:any)=>s.speciesId===entry.speciesId&&s.formIndex===entry.formIndex);
  assert(sprite,`Unlisted bundled form ${entry.name}`);
  assert.equal(sprite.credits,entry.credits);
  for (const [side,flag,offset] of [['front','hasFront',1],['back','hasBack',2]] as const) if (entry[flag]) {
    const bytes = chunks.get(sprite.pwanChunk)![sprite.pwan[side].path]!;
    assert.equal(hash(bytes),hash(archive.files[entry.assetIndex*2+offset]!),`Changed bundled pixels/timeline/palette: ${entry.name}:${side}`);
  }
}
console.log(JSON.stringify({passed:true,moves:manifest.moves.length,sprites:manifest.sprites.length,
  bundledPokemon:library.entries.length,validatedAnimatedSides:validatedSides,archivesByteIdenticalToRom:true,
  bundledSpritesByteIdentical:true,saveSourcePayloadPreserved:true},null,2));
