import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBundledMoveAnimationAuthor } from '../src/pokeweb/moveAnimationCredits';
import { moveEffectStatus, previewAnimationId, type TrackerMove } from './lib/white2expansion-progress';
import { joinSpriteCredits } from './lib/pwan-sprite-credits';
import { loadProjectFromRomBytes } from '../src/pokeweb/loader';
import { decodeRecord } from '../src/pokeweb/projectStore';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [upgradeArg, trackerArg, romArg] = process.argv.slice(2);
if (!upgradeArg || !trackerArg || !romArg) throw new Error('Usage: sync-white2expansion-progress.ts UPGRADE_REPO TRACKER_REPO INTEGRATION_ROM');
const upgrade = path.resolve(upgradeArg), tracker = path.resolve(trackerArg);
const json = async (p: string) => JSON.parse(await readFile(p, 'utf8'));
const write = async (p: string, d: unknown) => writeFile(p, JSON.stringify(d, null, 2) + '\n');
const moves: TrackerMove[] = await json(path.join(tracker, 'data/moves.gen6.json'));
const pokemon: any[] = await json(path.join(tracker, 'data/pokemon.gen6.json'));
const progress = await json(path.join(tracker, 'data/published-progress.json'));
const library = await json(path.join(repo, 'src/assets/pwan/library/manifest.json'));
const gmax: any[] = await json(path.join(repo, 'src/assets/pwan/gmax-mega-forms.json'));
const registry = await json(path.join(upgrade, 'src/pokeweb_gameplay/battle_modules/registry.json'));
const defines = await readFile(path.join(upgrade, 'include/moves.h'), 'utf8');
const ids = new Map([...defines.matchAll(/^#define\s+(MOVE_\w+)\s+(\d+)\b/gm)].map(m => [m[1]!, Number(m[2])]));
const managed = new Set<number>(registry.modules.flatMap((m: any) => m.entries.filter((e: any) => e[0] === 'move').map((e: any) => ids.get(e[1]))));
const source = await readFile(path.join(upgrade, 'src/pokeweb_gameplay/w2u_moves.cpp'), 'utf8');
const aliases = new Set([...source.slice(source.indexOf('const W2UVanillaMoveAlias W2U_VANILLA_MOVE_ALIASES[]')).matchAll(/\{ (MOVE_\w+), MOVE_\w+ \}/g)].map(m => ids.get(m[1]!)));
const staged = new Set((await readdir(path.join(upgrade, 'data/graphics/move_animations'))).flatMap(n => /^5_0*(\d+)\.bin$/.exec(n)?.slice(1).map(Number) ?? []));
const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(romArg)), 'integration.nds', {selectedNarcs:['personal']});
const owner = (species: number, form: number): number => {
  if (!form) return species;
  const raw = decodeRecord(project, 'personal', species).raw;
  const first = Number(raw?.form_id ?? 0), count = Number(raw?.num_forms ?? 1);
  if (!first || form >= count) throw new Error(`Missing personal form ${species}:${form}`);
  return first + form - 1;
};
for (const move of moves) {
  let record = '';
  try { record = await readFile(path.join(upgrade, 'data/pml/moves', `${move.id}.toml`), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const effect = moveEffectStatus(move.id, managed.has(move.id), aliases.has(move.id), record);
  const animationId = previewAnimationId(move.id, record, staged);
  Object.assign(move, {credits: move.id === 706 ? 'Volt White 2 QoL' : animationId === move.id
    ? getBundledMoveAnimationAuthor(move.id) : animationId !== undefined ? 'Game Freak (native animation reuse)' : '',
    animationId, implementationNotes: effect.notes});
  move.defaultProgress = {...move.defaultProgress, animation: animationId !== undefined, effectHandler: effect.completed, verified:false};
  progress.progress.moves[move.key] = {...progress.progress.moves[move.key], animation: animationId !== undefined, effectHandler: effect.completed, verified:false};
}
let added = 0;
// Reconcile named forms before pair-based fallback. Old Mega Zygarde rows used
// the 10% form index; otherwise that row steals the separate 10% entry.
for (const entry of library.entries) {
  const named = pokemon.find(r=>r.key===entry.key);
  if (!named || (named.baseSpeciesId ?? named.id) === entry.speciesId && Number(named.form ?? 0) === entry.formIndex) continue;
  const id = owner(entry.speciesId,entry.formIndex);
  if (pokemon.some(r=>r !== named && r.id === id)) throw new Error(`Tracker personal ID collision for ${entry.name}`);
  Object.assign(named,{id,baseSpeciesId:entry.speciesId,form:entry.formIndex});
}
for (const entry of library.entries) {
  const pair = (r: any) => (r.baseSpeciesId ?? r.id) === entry.speciesId && Number(r.form ?? 0) === entry.formIndex;
  let row = pokemon.find(r => r.key === entry.key) ?? pokemon.find(pair);
  if (!row) {
    const personalId = owner(entry.speciesId, entry.formIndex);
    if (pokemon.some(r => r.id === personalId)) throw new Error(`Tracker personal ID collision for ${entry.name}`);
    row = {key:entry.key, id:personalId, constant:`SPECIES_${personalId}`, name:entry.name, kind:entry.kind,
      ...(entry.formIndex ? {baseSpeciesId:entry.speciesId, form:entry.formIndex} : {}), defaultProgress:{}};
    pokemon.push(row); added++;
  }
  row.credits = joinSpriteCredits(entry.spriteSources?.map((s: any) => s.credits) ?? [entry.credits]);
  row.spriteSources = entry.spriteSources ?? [];
  row.assetStatus = 'w2anim TEX4 imported';
  row.runtimeNotes = entry.notes;
  row.animationAssetIndex = entry.assetIndex;
  if (gmax.some(f => f.species === entry.speciesId && f.form === entry.formIndex)) row.megaItem = 'Megite';
  row.defaultProgress = {...row.defaultProgress, personalData:true, partyIcon:Boolean(entry.icon), frontSprite:entry.hasFront, backSprite:entry.hasBack, verified:false};
  progress.progress.pokemon[row.key] = {...row.defaultProgress, ...progress.progress.pokemon[row.key],
    partyIcon:Boolean(entry.icon), frontSprite:entry.hasFront, backSprite:entry.hasBack, verified:false};
}
progress.updatedAt = new Date().toISOString();
await write(path.join(tracker, 'data/moves.gen6.json'), moves);
await write(path.join(tracker, 'data/pokemon.gen6.json'), pokemon);
await write(path.join(tracker, 'data/published-progress.json'), progress);
await write(path.join(tracker, 'data/animation-credits.json'), {
  version:1, updatedAt:progress.updatedAt,
  policy:'Credits follow the selected imported artwork, not the move-effect code. Individual authors are named only where supplied by the reviewed source records.',
  moves:moves.filter(m=>m.defaultProgress?.animation).map(m=>({id:m.id,name:m.name,credits:m.credits,animationId:(m as any).animationId})),
  pokemon:pokemon.map(p=>({id:p.id,name:p.name,credits:p.credits,spriteSources:p.spriteSources ?? []})),
});
console.log(JSON.stringify({moves:moves.length, animations:moves.filter(m=>m.defaultProgress?.animation).length,
  effects:moves.filter(m=>m.defaultProgress?.effectHandler).length, pending:moves.filter(m=>!m.defaultProgress?.effectHandler).map(m=>m.name),
  pokemon:pokemon.length, addedPokemon:added, verified:false},null,2));
