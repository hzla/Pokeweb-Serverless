#!/usr/bin/env node
// Refresh source bookkeeping only. Never rebuild or modify bundled binaries.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.dirname(here);
const workspace = path.dirname(app);
const roots = {
  'w2u-runtime': process.env.W2U_RUNTIME_ROOT || path.join(path.dirname(workspace), 'White2Upgrade-Original-pokeweb'),
  'weather-runtime': process.env.WEATHER_RUNTIME_ROOT || path.join(workspace, 'White2Upgrade'),
  pokeweb: app,
  pmc: process.env.PMC_SOURCE_ROOT || path.join(workspace, 'PMC'),
};
const check = process.argv.includes('--check');
const onlyArgs = process.argv.slice(2).filter(arg => arg.startsWith('--only='));
if (onlyArgs.length > 1 || process.argv.slice(2).some(arg => arg !== '--check' && !arg.startsWith('--only='))) throw Error('Usage: node patch-sources/refresh.mjs [--check] [--only=GROUP]');
const only = onlyArgs[0]?.slice('--only='.length);
const manifestPath = path.join(here, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (only !== undefined && !manifest.patches.some(p => p.name === only) && only !== 'pwan-trainer') throw Error(`Unknown source group: ${only}`);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const oldFiles = new Map([...manifest.patches.flatMap(p => p.files), ...manifest.sharedFiles].map(f => [f.path, f]));
const pending = new Map();
const sourcePaths = new Set();
const readAssetManifest = name => JSON.parse(fs.readFileSync(path.join(app, 'src/assets/codeinjection', name), 'utf8'));
const learnset = readAssetManifest('learnsetViewerManifest.json');
const hud = readAssetManifest('battleTypeHudManifest.json');
const following = ['runtime.json', 'black2/runtime.json', 'white2upgrade/runtime.json']
  .map(name => JSON.parse(fs.readFileSync(path.join(app, 'src/assets/following', name), 'utf8')));

function safeJoin(root, relative) {
  const full = path.resolve(root, relative);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw Error(`Unsafe relative path: ${relative}`);
  return full;
}
function normalize(raw) {
  const text = raw.toString('utf8');
  if (text.includes('\0') || text.includes('\ufffd')) throw Error('Not a UTF-8 source file');
  return Buffer.from(text.replace(/\r\n?/g, '\n')
    .replace(/\/(?:Users|home|Volumes)\/[^\s"'`<>]+/g, '<LOCAL_PATH>')
    .replace(/[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\r\n"'`<>]+/g, '<LOCAL_PATH>')
    .replace(/\n*$/, '\n'));
}
function file(group, relative, kind = 'source', originPath = `runtime/${group}/${relative}`) {
  return { path: `${group}/${relative}`, origin: { repository: 'pokeweb', path: originPath }, kind };
}
function runtimeFiles(group) {
  return fs.readdirSync(path.join(app, 'runtime', group), { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(c|cpp|h|py|ts|json|java|yml|md|txt|cjs|s|S)$/.test(entry.name)
      && !(group === 'save-menu' && entry.name === 'assets.generated.h'))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .map(entry => {
      const kind = /\.(md|txt)$/.test(entry.name) ? 'documentation'
        : /\.(json|yml)$/.test(entry.name) ? 'metadata'
        : /^(verify|test|native|compatibility_tests)/.test(entry.name) ? 'test'
        : /\.(py|ts|cjs|java)$/.test(entry.name) ? 'build-tool' : 'source';
      // Keep the bookkeeping README separate from the original runtime notes.
      return file(group, entry.name === 'README.md' ? 'runtime-notes.md' : entry.name, kind, `runtime/${group}/${entry.name}`);
    });
}
const additions = [
  {
    name: 'save-menu', title: 'White 2 save menu',
    artifacts: ['SaveMenuW2.dll'],
    note: 'Version 0.1.9 save-menu PMC module for a pinned White 2 Following Pokémon alpha ROM. Build source and four prepared native-art PNG inputs are copied; the pinned ROM, generated header, and validation captures are excluded. See runtime notes for the exact supported input and validation limits.',
    extra: [
      ...['native-badges.png', 'native-map-marker.png', 'native-map-start-node.png', 'native-map-title.png']
        .map(name => file('save-menu', `assets/${name}`, 'binary-build-input', `runtime/save-menu/${name}`)),
      file('save-menu', 'integration/saveMenuModel.ts', 'support-only', 'src/pokeweb/saveMenuModel.ts'),
      file('save-menu', 'integration/codeInjectionEditor.ts', 'support-only', 'src/ui/codeInjectionEditor.ts'),
      file('save-menu', 'tests/verify-save-menu-update.ts', 'test', 'scripts/verify-save-menu-update.ts'),
    ],
  },
  {
    name: 'trainer-nature', title: 'Specified trainer Pokémon natures',
    artifacts: ['TrainerNatureB2.dll', 'TrainerNatureW2.dll'],
    note: 'Version 1.2.0 PMC modules for US Black 2 and White 2. Includes the build source, both address/metadata profiles, installer and legacy ARM9 migration logic, and an export/reimport verification script.',
    extra: [
      file('trainer-nature', 'integration/trainerNaturePatch.ts', 'support-only', 'src/pokeweb/trainerNaturePatch.ts'),
      file('trainer-nature', 'integration/romPatchModel.ts', 'support-only', 'src/pokeweb/romPatchModel.ts'),
      file('trainer-nature', 'integration/trainerEditor.ts', 'support-only', 'src/ui/trainerEditor.ts'),
      file('trainer-nature', 'tests/romPatchModel.test.ts', 'test', 'src/test/romPatchModel.test.ts'),
      file('trainer-nature', 'tests/verify-trainer-nature-install.ts', 'test', 'scripts/verify-trainer-nature-install.ts'),
    ],
  },
  {
    name: 'following-pokemon', title: 'Following Pokémon',
    artifacts: [
      ...['PokewebFollowingCoreW2.dll', 'PokewebFollowingEventsW2.dll', 'PokewebFollowingFieldW2.dll'].map(name => `following/${name}`),
      ...['PokewebFollowingCoreB2.dll', 'PokewebFollowingEventsB2.dll', 'PokewebFollowingFieldB2.dll'].map(name => `following/black2/${name}`),
      ...['PokewebFollowingCoreW2.dll', 'PokewebFollowingEventsW2.dll', 'PokewebFollowingFieldW2.dll'].map(name => `following/white2upgrade/${name}`),
    ],
    note: `Stock US White 2 ${following[0].version}, stock US Black 2 ${following[1].version}, and White2Upgrade ${following[2].version} bundled runtime variants. Sources, generators, profile metadata, integration, and focused tests are copied. ROMs, sprite archives, save files, generated binaries, and emulator captures are excluded. Artifact hashes identify the exact bundled modules; no binary rebuild is implied.`,
    extra: [
      ...['runtime.json', 'black2/runtime.json', 'white2upgrade/runtime.json'].map(name =>
        file('following-pokemon', `metadata/${name}`, 'metadata', `src/assets/following/${name}`)),
      ...fs.readdirSync(path.join(app, 'runtime/following-pokemon/tests')).filter(name => /\.(c|h|py|json)$/.test(name))
        .sort((a, b) => a.localeCompare(b, 'en')).map(name =>
          file('following-pokemon', `tests/runtime/${name}`, 'test', `runtime/following-pokemon/tests/${name}`)),
      file('following-pokemon', 'integration/followingPokemonProject.ts', 'support-only', 'src/pokeweb/followingPokemonProject.ts'),
      ...['followingPokemon', 'followingPokemonProject', 'followingPokemonItems', 'followingPokemonMemory', 'followingPokemonEditor']
        .map(name => file('following-pokemon', `tests/${name}.test.ts`, 'test', `src/test/${name}.test.ts`)),
      file('following-pokemon', 'tests/verify-following-install.ts', 'test', 'scripts/verify-following-install.ts'),
      file('following-pokemon', 'tests/verify-following-assets.ts', 'test', 'scripts/verify-following-assets.ts'),
    ],
  },
  {
    name: 'pwan-trainer', title: 'PWAN trainer sprites',
    artifacts: ['PokewebPwanTrainerB2.dll', 'PokewebPwanTrainerW2.dll'],
    note: 'Standalone stock-US B2/W2 overlay-168 runtime for front-trainer PWAN animations. It redirects configured graphics to one appended carrier, streams per-instance texture and palette data, and remains independent from the Pokémon PWAN DLLs.',
    runtime: false,
    extra: [
      file('pwan-trainer', 'README.md', 'documentation', 'patch-sources/pwan-trainer/README.md'),
      ...['w2u_trainer_anim.cpp', 'w2u_trainer_hooks.s', 'b2_trainer_hooks.s', 'w2u_pwan_archive.cpp', 'w2u_pwan_archive.h', 'w2u_pwan_frame_scratch.cpp', 'pwan_types.h'].map(name => ({
        path: `pwan-trainer/${name}`,
        origin: { repository: 'w2u-runtime', path: `src/pwan_animation/${name}` },
        kind: 'source',
      })),
      { path: 'pwan-trainer/meson.build', origin: { repository: 'w2u-runtime', path: 'src/pwan_animation/meson.build' }, kind: 'build-tool' },
      ...['trainerPwanCompatibilityModel', 'trainerSpriteModel', 'pokemonSpriteWriters'].map(name =>
        file('pwan-trainer', `integration/${name}.ts`, 'support-only', `src/pokeweb/${name}.ts`)),
      file('pwan-trainer', 'tests/trainerPwanAnimationModel.test.ts', 'test', 'src/test/trainerPwanAnimationModel.test.ts'),
      file('pwan-trainer', 'tests/trainerPwanPalette.test.ts', 'test', 'src/test/trainerPwanPalette.test.ts'),
      file('pwan-trainer', 'tests/lib/trainer-pwan-palette.ts', 'test', 'scripts/lib/trainer-pwan-palette.ts'),
      file('pwan-trainer', 'tests/verify-trainer-pwan-emulator.ts', 'test', 'scripts/verify-trainer-pwan-emulator.ts'),
    ],
  },
  {
    name: 'learnset-viewer', title: 'Standalone LEARNSET party-menu viewer',
    artifacts: ['LearnsetMenuB2.dll', 'LearnsetMenuW2.dll', 'LearnsetViewerB2.dll', 'LearnsetViewerW2.dll'],
    note: `Version ${learnset.version}. PMC-only menu/field and overlay-258 viewer companions; includes the move-list click for successful evolution navigation and summary-page sound for party switching, session-owned evolution graph and icon reuse, species/type header, correct sub-BG palette addressing and no-fade read-only L/R family navigation with virtual species learnsets/info, descendant-first branch browsing, A requirement pages, selected-only native two-pose icon animation, native lower-screen foreground/shadows and matching light upper panels, full-height right-panel left shading with unchanged ability row rules, purple hidden abilities, matching icon transparency, a dark teal selected-sprite frame with brighter title/fin accents unchanged, muted panel border, restored charcoal description body with a dark fin/top strip and no side/bottom borders, four-pixel slate-teal gutter, clipped stats panel, party-position header cue, retail title rails, D-pad party navigation, compact gold base stats, form ability names, cycle-safe three-Pokemon evolution chains, buffered ROM reads, buffered background fix, and two-pixel icon/level spacing. Canonical sources remain in Pokeweb runtime/learnset-viewer.`,
    extra: [
      file('learnset-viewer', 'metadata/learnsetViewerManifest.json', 'metadata', 'src/assets/codeinjection/learnsetViewerManifest.json'),
      file('learnset-viewer', 'integration/learnsetViewerModel.ts', 'support-only', 'src/pokeweb/learnsetViewerModel.ts'),
      file('learnset-viewer', 'tests/learnsetViewerModel.test.ts', 'test', 'src/test/learnsetViewerModel.test.ts'),
      file('learnset-viewer', 'tests/verify-learnset-viewer-install.ts', 'test', 'scripts/verify-learnset-viewer-install.ts'),
    ],
  },
  {
    name: 'battle-type-hud', title: 'Battle Type Icons and Move Effectiveness Preview',
    artifacts: ['TypeIconsB2.dll', 'TypeIconsW2.dll', 'TypeIconsCircularB2.dll', 'TypeIconsCircularW2.dll', 'TypeIconsSolidB2.dll', 'TypeIconsSolidW2.dll', 'MoveEffectivenessB2.dll', 'MoveEffectivenessW2.dll'],
    note: `Independent overlay-168 Type Icons ${hud.games.W2.version}, Circular 0.3.17, Solid 0.3.23, and Move Effectiveness ${hud.moveGames.W2.version} modules, catalog ${hud.version}. Includes generated address/hook headers and private panel geometry. Canonical Pokeweb runtime snapshot originates from work/battle-type-hud; no emulator captures or build binaries are copied.`,
    extra: [
      ...['B2', 'W2'].flatMap(game => [
        file('battle-type-hud', `build/addresses-${game}.h`, 'generated-header'),
        ...['TypeIcons', 'MoveEffectiveness'].map(module => file('battle-type-hud', `build/hooks-${module}-${game}.h`, 'generated-header')),
      ]),
      ...['battleTypeHudManifest.json', 'battleTypeHudPanelExpansion.json'].map(name => file('battle-type-hud', `metadata/${name}`, 'metadata', `src/assets/codeinjection/${name}`)),
      ...['battleTypeHudModel', 'battleTypeHudResources'].flatMap(name => [
        file('battle-type-hud', `integration/${name}.ts`, 'support-only', `src/pokeweb/${name}.ts`),
        file('battle-type-hud', `tests/${name}.test.ts`, 'test', `src/test/${name}.test.ts`),
      ]),
      file('battle-type-hud', 'tests/verify-battle-hud-install.ts', 'test', 'scripts/verify-battle-hud-install.ts'),
    ],
  },
  {
    name: 'bgm-toggle', title: 'Background-music toggle and streamed replacement',
    artifacts: ['BgmToggleB2.dll', 'BgmToggleW2.dll'],
    note: 'Shared US Black 2 / White 2 runtime 3.0.0 for a volume-mute shortcut and a variable-length table of native SDAT stream replacements. ABI 1 single-track migration, per-track updates/removal, and export/reimport are supported. Uses one guarded 32 KiB native output buffer, 4 KiB low-memory fallback, and native heap rollback. The installer retains its 512 MiB export safety limit. Multi-track gameplay verification is pending; host and archive checks do not certify playback.',
    extra: [
      file('bgm-toggle', 'integration/pmcModel.ts', 'support-only', 'src/pokeweb/pmcModel.ts'),
      file('bgm-toggle', 'integration/streamedBgmModel.ts', 'support-only', 'src/pokeweb/streamedBgmModel.ts'),
      file('bgm-toggle', 'integration/rom.ts', 'support-only', 'src/nds/rom.ts'),
      file('bgm-toggle', 'integration/musicEditor.ts', 'support-only', 'src/ui/musicEditor.ts'),
      file('bgm-toggle', 'integration/musicReference.ts', 'support-only', 'src/pokeweb/musicReference.ts'),
      file('bgm-toggle', 'integration/musicEditor.css', 'support-only', 'src/styles/musicEditor.css'),
      file('bgm-toggle', 'integration/projectStore.ts', 'support-only', 'src/pokeweb/projectStore.ts'),
      file('bgm-toggle', 'integration/codeInjectionEditor.ts', 'support-only', 'src/ui/codeInjectionEditor.ts'),
      file('bgm-toggle', 'integration/codeInjection.css', 'support-only', 'src/styles/codeInjection.css'),
      file('bgm-toggle', 'integration/package.json', 'build-tool', 'package.json'),
      file('bgm-toggle', 'tests/pmcModel.test.ts', 'test', 'src/test/pmcModel.test.ts'),
      file('bgm-toggle', 'tests/streamedBgmModel.test.ts', 'test', 'src/test/streamedBgmModel.test.ts'),
      file('bgm-toggle', 'tests/bgmRuntimeMappings.test.ts', 'test', 'src/test/bgmRuntimeMappings.test.ts'),
      file('bgm-toggle', 'tests/musicEditor.test.ts', 'test', 'src/test/musicEditor.test.ts'),
      file('bgm-toggle', 'tests/musicReference.test.ts', 'test', 'src/test/musicReference.test.ts'),
      file('bgm-toggle', 'tests/romExport.test.ts', 'test', 'src/test/romExport.test.ts'),
      file('bgm-toggle', 'tests/verify-streamed-bgm-install.ts', 'test', 'scripts/verify-streamed-bgm-install.ts'),
    ],
  },
];
for (const group of additions) {
  if (only && group.name !== only) continue;
  const updated = { name: group.name, title: group.title, artifacts: group.artifacts.map(name => ({ name })), note: group.note, status: 'source-copied', files: [...(group.runtime === false ? [] : runtimeFiles(group.name)), ...group.extra] };
  const index = manifest.patches.findIndex(p => p.name === group.name);
  if (index === -1) manifest.patches.push(updated);
  else manifest.patches[index] = updated;
}
const artifacts = new Set(manifest.excludedArtifacts.map(name => `codeinjection/${name}`));
for (const patch of manifest.patches) for (const artifact of patch.artifacts) {
  const location = artifact.name.includes('/') ? artifact.name : `codeinjection/${artifact.name}`;
  if (artifacts.has(location)) throw Error(`Duplicate artifact: ${location}`);
  artifacts.add(location);
  if (!only || patch.name === only) artifact.sha256 = hash(fs.readFileSync(safeJoin(path.join(app, 'src/assets'), location)));
}
for (const name of fs.readdirSync(path.join(app, 'src/assets/codeinjection'))) {
  if (!only && /\.(dll|rpm)$/.test(name) && !artifacts.has(`codeinjection/${name}`)) throw Error(`Unaccounted bundled artifact: ${name}`);
}
for (const folder of ['following', 'following/black2', 'following/white2upgrade']) {
  for (const name of fs.readdirSync(path.join(app, 'src/assets', folder))) {
    if (!only && /\.(dll|rpm)$/.test(name) && !artifacts.has(`${folder}/${name}`)) throw Error(`Unaccounted bundled artifact: ${folder}/${name}`);
  }
}
for (const entry of [...manifest.patches.filter(p => !only || p.name === only).flatMap(p => p.files), ...(!only ? manifest.sharedFiles : [])]) {
  if (sourcePaths.has(entry.path)) throw Error(`Duplicate source: ${entry.path}`);
  sourcePaths.add(entry.path);
  const raw = fs.readFileSync(safeJoin(roots[entry.origin.repository], entry.origin.path));
  const normalized = entry.kind === 'binary-build-input' ? raw : normalize(raw);
  const destination = safeJoin(here, entry.path);
  const existing = fs.existsSync(destination) ? fs.readFileSync(destination) : undefined;
  const old = oldFiles.get(entry.path);
  if (existing && !existing.equals(normalized) && (!old || hash(existing) !== old.sha256)) {
    throw Error(`Locally edited snapshot; refusing to overwrite: ${entry.path}`);
  }
  entry.sha256 = hash(normalized);
  entry.normalized = !raw.equals(normalized);
  if (!existing?.equals(normalized)) pending.set(entry.path, normalized);
}
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
if (!fs.readFileSync(manifestPath).equals(manifestBytes)) pending.set('manifest.json', manifestBytes);
if (check && pending.size) throw Error(`Snapshot is stale: ${[...pending.keys()].join(', ')}`);
// All inputs and local-edit guards are checked before any generated copies change.
if (!check) for (const [relative, bytes] of pending) {
  const destination = safeJoin(here, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
}
console.log(`${check ? 'Verified' : 'Refreshed'} ${only || 'all groups'}, ${sourcePaths.size} source entries; ${pending.size} files ${check ? 'need updating' : 'updated'}.`);
