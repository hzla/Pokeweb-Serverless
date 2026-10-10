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
  'w2u-integration': process.env.W2U_INTEGRATION_ROOT || path.join(path.dirname(workspace), 'White2Upgrade-w2-integration'),
  'weather-runtime': process.env.WEATHER_RUNTIME_ROOT || path.join(workspace, 'White2Upgrade'),
  pokeweb: app,
  pmc: process.env.PMC_SOURCE_ROOT || path.join(workspace, 'PMC'),
};
const args = process.argv.slice(2);
const check = args.includes('--check');
const onlyArgs = args.filter(arg => arg.startsWith('--only='));
const outAt = args.indexOf('--out');
const outArgs = args.filter(arg => arg.startsWith('--out='));
if (onlyArgs.length > 1 || outArgs.length > 1 || (outAt >= 0 && outArgs.length) ||
    (outAt >= 0 && (!args[outAt + 1] || args[outAt + 1].startsWith('--'))) || outArgs.includes('--out=') ||
    args.some((arg, index) => arg !== '--check' && !arg.startsWith('--only=') &&
      !arg.startsWith('--out=') && arg !== '--out' && !(outAt >= 0 && index === outAt + 1)))
  throw Error('Usage: node patch-sources/refresh.mjs [--check] [--only=GROUP] [--out PATH]');
const outputArgument = outAt >= 0 ? args[outAt + 1] : outArgs[0]?.slice('--out='.length);
const outputRoot = outputArgument ? path.resolve(outputArgument) : undefined;
if (outputRoot && (outputRoot === app || outputRoot.startsWith(app + path.sep)))
  throw Error('Snapshot output must be outside the Pokeweb-Serverless repository');
const only = onlyArgs[0]?.slice('--only='.length);
const manifestPath = path.join(here, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.sourceRepositories['w2u-integration'] = 'White2Upgrade-w2-integration';
manifest.purpose = 'Canonical source provenance and on-demand external export; not a build input or binary-reproducibility claim.';
for (const patch of manifest.patches) if (patch.status === 'source-copied') patch.status = 'source-available';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const oldFiles = new Map([...manifest.patches.flatMap(p => p.files), ...manifest.sharedFiles].map(f => [f.path, f]));
const pending = new Map();
const sourcePaths = new Set();
const snapshotIndexPath = outputRoot ? path.join(outputRoot, '.patch-sources-index.json') : undefined;
const priorIndex = snapshotIndexPath && fs.existsSync(snapshotIndexPath)
  ? JSON.parse(fs.readFileSync(snapshotIndexPath, 'utf8')) : undefined;
if (priorIndex && (priorIndex.format !== 1 || typeof priorIndex.files !== 'object'))
  throw Error('Invalid external snapshot index');
const snapshotHashes = only ? { ...(priorIndex?.files || {}) } : {};
const staleSnapshotPaths = [];
const readAssetManifest = name => JSON.parse(fs.readFileSync(path.join(app, 'src/assets/codeinjection', name), 'utf8'));
const learnset = readAssetManifest('learnsetViewerManifest.json');
const hud = readAssetManifest('battleTypeHudManifest.json');
const summary = readAssetManifest('summaryStatViewerManifest.json');
const partyMenu = readAssetManifest('menuEvolutionBw1Manifest.json');
const bw1Status = profiles => profiles.B?.dsAccepted && profiles.W?.dsAccepted
  ? 'US revision-0 BW1 DS gameplay and visual acceptance is recorded for the exact bundled builds; live DSi acceptance remains pending.'
  : 'US revision-0 BW1 normal installation is disabled pending DS gameplay and visual acceptance in both games; live DSi acceptance remains pending.';
const following = ['runtime.json', 'black2/runtime.json', 'white2upgrade/runtime.json', 'white2italy/runtime.json']
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
    .filter(entry => entry.isFile() && /\.(c|cpp|h|py|ts|json|java|yml|md|txt|cjs|s|S)$/.test(entry.name))
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
    name: 'bw1-ui-release', title: 'BW1 Graphical/UI release acceptance', runtime: false, artifacts: [],
    note: 'Shared tested-profile and exact-artifact DS acceptance ledger, bundler guard and verifier. Changed bindings, DLLs or party-menu dependencies require fresh acceptance. This is DS-mode emulator evidence, not live DSi or a general heap-capacity claim.',
    extra: [
      file('bw1-ui-release', 'bw1_release.py', 'build-tool', 'runtime/bw1_release.py'),
      file('bw1-ui-release', 'verify_bw1_release.py', 'test', 'runtime/verify_bw1_release.py'),
      file('bw1-ui-release', 'bw1-ui-acceptance.json', 'metadata', 'runtime/bw1-ui-acceptance.json'),
      file('bw1-ui-release', 'BW1_UI_RELEASE.md', 'documentation', 'runtime/BW1_UI_RELEASE.md'),
    ],
  },
  {
    name: 'battle-counters', title: 'Individual PK5 battle counters and KO moves', runtime: false,
    artifacts: ['Black1BattleCounters.dll', 'White1BattleCounters.dll', 'Black2UpgradeBattleCounters.dll', 'White2UpgradeBattleCounters.dll'],
    note: `Shared PK5 counter storage and pending-move format. BW1 runtime 8 adds immediate KO learning through separately verified native overlay-93 profiles; BW2 retains its existing runtime and artifacts. Includes bounded BW1 archive reads and the local memory helper. ${bw1Status(partyMenu.games)} Compiled checks remain separate from gameplay observations.`,
    extra: [
      ...['w2u_pk5_battle_counters.cpp', 'w2u_bw1_memory.cpp'].map(name => ({ path: `battle-counters/${name}`, origin: { repository: 'w2u-runtime', path: `src/battle_log/${name}` }, kind: 'source' })),
      { path: 'battle-counters/include/w2u_bw1_menu_profile.h', origin: { repository: 'w2u-runtime', path: 'include/w2u_bw1_menu_profile.h' }, kind: 'header' },
      ...['verify_pk5_battle_counters.py', 'verify_bw1_party_menu.py', 'test_ko_move_pending.cpp'].map(name => ({ path: `battle-counters/tests/${name}`, origin: { repository: 'w2u-runtime', path: `tools/${name}` }, kind: 'test' })),
    ],
  },
  {
    name: 'enhanced-party-menu', title: 'Enhanced Party Menu and Battle Log Integration',
    artifacts: ['MenuEvolutionB.dll', 'MenuEvolutionW.dll', 'MenuEvolutionB2.dll', 'MenuEvolutionW2.dll'],
    note: `EVOLVE, RELEARN, post-battle KO evolution and field-script counters, with the BW1 runtime-8 counter dependency. ${bw1Status(partyMenu.games)} Isolated compiled verification covers native PK5 routines, mode-aware pointer fixtures, hooks and cleanup separately from gameplay evidence. Existing BW2 artifacts and dependency contracts are retained.`,
    extra: [
      ...['w2u_menu_evolution.cpp', 'w2u_menu_evolution_script_api.cpp', 'w2u_bw1_memory.cpp'].map(name => ({ path: `enhanced-party-menu/${name}`, origin: { repository: 'w2u-runtime', path: `src/battle_log/${name}` }, kind: 'source' })),
      ...['w2u_bw1_menu_profile.h', 'w2u_menu_evolution_logic.h', 'w2u_menu_relearn_logic.h', 'w2u_menu_evolution_script_api.h', 'w2u_ko_move_pending.h'].map(name => ({ path: `enhanced-party-menu/include/${name}`, origin: { repository: 'w2u-runtime', path: `include/${name}` }, kind: 'source' })),
      ...['build_bw1_menu_evolution.py', 'verify_bw1_party_menu.py', 'verify_pk5_battle_counters.py', 'test_menu_evolution_logic.cpp', 'test_menu_relearn_logic.cpp', 'test_ko_move_pending.cpp'].map(name => ({ path: `enhanced-party-menu/tools/${name}`, origin: { repository: 'w2u-runtime', path: `tools/${name}` }, kind: name.startsWith('build') ? 'build-tool' : 'test' })),
      ...['menu_evolution_b2_meta.yml', 'menu_evolution_w2_meta.yml'].map(name => ({ path: `enhanced-party-menu/metadata/${name}`, origin: { repository: 'w2u-runtime', path: `pmc/${name}` }, kind: 'metadata' })),
      file('enhanced-party-menu', 'integration/menuEvolutionModel.ts', 'source', 'src/pokeweb/menuEvolutionModel.ts'),
      file('enhanced-party-menu', 'integration/battleLogModel.ts', 'support-only', 'src/pokeweb/battleLogModel.ts'),
      file('enhanced-party-menu', 'metadata/menuEvolutionBw1Manifest.json', 'metadata', 'src/assets/codeinjection/menuEvolutionBw1Manifest.json'),
      file('enhanced-party-menu', 'tests/menuEvolutionBw1.test.ts', 'test', 'src/test/menuEvolutionBw1.test.ts'),
      file('enhanced-party-menu', 'tests/menuEvolutionModel.test.ts', 'test', 'src/test/menuEvolutionModel.test.ts'),
    ],
  },
  {
    name: 'double-battle-fix', title: 'Single-NPC double-battle fix',
    artifacts: ['DoubleBattleFixB.dll', 'DoubleBattleFixB2.dll', 'DoubleBattleFixW2.dll'],
    status: 'partial-source-available',
    note: 'Black 1 has a new source implementation and builder for US IRBO revision 0. Original B2/W2 implementation source remains unavailable; the retained W2 staging script embeds a binary payload and does not establish B2/W2 reproducibility. Native CPU and ROM export checks are separate from full in-game battle acceptance.',
    extra: [
      { path: 'double-battle-fix/support/stage_double_battle_fix.py', origin: { repository: 'w2u-runtime', path: 'tools/stage_double_battle_fix.py' }, kind: 'support-only' },
      file('double-battle-fix', 'integration/pmcModel.ts', 'support-only', 'src/pokeweb/pmcModel.ts'),
      file('double-battle-fix', 'integration/doubleBattleFixCompatibility.ts', 'source', 'src/pokeweb/doubleBattleFixCompatibility.ts'),
      file('double-battle-fix', 'integration/codeInjectionEditor.ts', 'support-only', 'src/ui/codeInjectionEditor.ts'),
      file('double-battle-fix', 'tests/doubleBattleFix.test.ts', 'test', 'src/test/doubleBattleFix.test.ts'),
      file('double-battle-fix', 'tests/codeInjectionEditor.test.ts', 'test', 'src/test/codeInjectionEditor.test.ts'),
      file('double-battle-fix', 'tests/verify-black1-double-battle-fix.ts', 'test', 'scripts/verify-black1-double-battle-fix.ts'),
    ],
  },
  {
    name: 'dsi-compatibility', title: 'Bundled patch DS/DSi memory audit', artifacts: [],
    note: 'Source and binary inventory for 4 MiB pointer assumptions, with isolated packaged PWAN guard checks. This is not full game or hardware certification.',
    extra: [],
  },
  {
    name: 'summary-stat-viewer', title: 'Summary IV/EV viewer',
    artifacts: ['SummaryStatViewerB2.dll', 'SummaryStatViewerW2.dll', 'SummaryStatViewerB.dll', 'SummaryStatViewerW.dll'],
    note: `Independent B2/W2 native Summary Stats variants and shared footer tab, plus separately built US revision-0 B/W companions. ${bw1Status(summary.games)} Canonical source and configuration metadata are recorded; compiled and DS gameplay checks remain separate.`,
    extra: [
      file('summary-stat-viewer', 'metadata/summaryStatViewerManifest.json', 'metadata', 'src/assets/codeinjection/summaryStatViewerManifest.json'),
      file('summary-stat-viewer', 'integration/summaryStatViewerModel.ts', 'support-only', 'src/pokeweb/summaryStatViewerModel.ts'),
      file('summary-stat-viewer', 'tests/summaryStatViewerModel.test.ts', 'test', 'src/test/summaryStatViewerModel.test.ts'),
    ],
  },
  {
    name: 'level-caps', title: 'Hard level caps',
    artifacts: ['HardLevelCapsB2.dll', 'HardLevelCapsW2.dll'],
    note: 'US Black 2 / White 2 PMC modules. Runtime source, builder, verifier, and installer are inventoried; availability does not establish historical binary reproducibility.',
    extra: [
      file('level-caps', 'integration/levelCapsModel.ts', 'support-only', 'src/pokeweb/levelCapsModel.ts'),
      file('level-caps', 'tests/verify-level-caps-install.ts', 'test', 'scripts/verify-level-caps-install.ts'),
    ],
  },
  {
    name: 'infinite-candy', title: 'Infinite Rare Candy',
    artifacts: ['InfiniteCandyB2.dll', 'InfiniteCandyW2.dll'],
    note: 'US Black 2 / White 2 PMC modules. Runtime source, builder, verifier, and installer are inventoried; availability does not establish historical binary reproducibility.',
    extra: [
      file('infinite-candy', 'integration/infiniteCandyModel.ts', 'support-only', 'src/pokeweb/infiniteCandyModel.ts'),
      file('infinite-candy', 'tests/verify-infinite-candy-install.ts', 'test', 'scripts/verify-infinite-candy-install.ts'),
    ],
  },
  {
    name: 'debug-helpers', title: 'White 2 Debug Helpers',
    artifacts: ['WalkThroughWallsW2.dll', 'InstantBattleVictoryW2.dll'],
    note: 'Independent US White 2 0.1.0 alpha developer DLLs: player grid collision toggle and local wild/trainer victory shortcut. Native code/CPU and export checks are distinct from full gameplay coverage.',
    extra: [
      file('debug-helpers', 'integration/testingPatchesModel.ts', 'support-only', 'src/pokeweb/testingPatchesModel.ts'),
      file('debug-helpers', 'integration/codeInjectionEditor.ts', 'support-only', 'src/ui/codeInjectionEditor.ts'),
      file('debug-helpers', 'tests/testingPatchesModel.test.ts', 'test', 'src/test/testingPatchesModel.test.ts'),
      file('debug-helpers', 'tests/verify-testing-patches-install.ts', 'test', 'scripts/verify-testing-patches-install.ts'),
    ],
  },
  {
    name: 'instant-text', title: 'White 2 Instant Fast Text',
    artifacts: ['InstantFastTextW2.dll'],
    note: 'Independent US White 2 0.1.0 QoL DLL. Fast uses a bounded 128-character native stream budget; Slow/Normal and saved settings are preserved. Shares builder and CPU verifier with debug-helpers.',
    extra: [
      file('instant-text', 'integration/testingPatchesModel.ts', 'support-only', 'src/pokeweb/testingPatchesModel.ts'),
      file('instant-text', 'tools/shared-build.py', 'build-tool', 'runtime/debug-helpers/build.py'),
      file('instant-text', 'tests/shared-verify.py', 'test', 'runtime/debug-helpers/verify.py'),
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
      ...['CoreW2', 'EventsW2', 'FieldW2', 'OptionsW2', 'BattleW2', 'EventsW2Base', 'FieldW2Base'].map(name => `following/PokewebFollowing${name}.dll`),
      ...['CoreB2', 'EventsB2', 'FieldB2', 'OptionsB2', 'BattleB2', 'EventsB2Base', 'FieldB2Base'].map(name => `following/black2/PokewebFollowing${name}.dll`),
      ...['CoreW2', 'EventsW2', 'FieldW2', 'OptionsW2', 'BattleW2', 'EventsW2Base', 'FieldW2Base'].map(name => `following/white2upgrade/PokewebFollowing${name}.dll`),
      ...['CoreW2I', 'EventsW2I', 'FieldW2I', 'OptionsW2I', 'BattleW2I', 'EventsW2IBase', 'FieldW2IBase'].map(name => `following/white2italy/PokewebFollowing${name}.dll`),
    ],
    note: `Stock US White 2 ${following[0].version}, stock US Black 2 ${following[1].version}, White2Upgrade ${following[2].version}, and Italian White 2 ${following[3].version} bundled runtime variants. Sources, generators, profile metadata, integration, and focused tests are recorded. ROMs, sprite archives, save files, binary payloads, and emulator captures are excluded from source exports. Artifact hashes identify the exact bundled modules; no binary rebuild is implied.`,
    extra: [
      ...['runtime.json', 'black2/runtime.json', 'white2upgrade/runtime.json', 'white2italy/runtime.json'].map(name =>
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
    artifacts: ['LearnsetMenuB2.dll', 'LearnsetMenuW2.dll', 'LearnsetViewerB2.dll', 'LearnsetViewerW2.dll', 'LearnsetMenuB.dll', 'LearnsetMenuW.dll', 'LearnsetViewerB.dll', 'LearnsetViewerW.dll'],
    note: `BW2 version ${learnset.version}, with separately compiled US revision-0 B/W ${learnset.games.B.version} companions using independent native profiles and overlays 10/91/173. ${bw1Status(learnset.games)} Shared read-only party/family navigation, session-owned graph/icons, native fonts/type resources and private text are retained. The installer validates fingerprints/native bindings/resources, rejects conflicts, commits PMC/text/both DLLs atomically, and preserves configured IDs and edited private text across update/reinstall/export/reopen. Compiled native-mode DS/extended-memory fixtures do not establish live DSi acceptance or native heap capacity. Canonical sources remain in Pokeweb runtime/learnset-viewer.`,
    extra: [
      file('learnset-viewer', 'metadata/learnsetViewerManifest.json', 'metadata', 'src/assets/codeinjection/learnsetViewerManifest.json'),
      file('learnset-viewer', 'integration/learnsetViewerModel.ts', 'support-only', 'src/pokeweb/learnsetViewerModel.ts'),
      file('learnset-viewer', 'tests/learnsetViewerModel.test.ts', 'test', 'src/test/learnsetViewerModel.test.ts'),
      file('learnset-viewer', 'tests/learnsetViewerBw1.test.ts', 'test', 'src/test/learnsetViewerBw1.test.ts'),
      file('learnset-viewer', 'tests/verify-learnset-viewer-install.ts', 'test', 'scripts/verify-learnset-viewer-install.ts'),
    ],
  },
  {
    name: 'battle-type-hud', title: 'Battle Type Icons and Move Effectiveness Preview',
    artifacts: ['TypeIconsB2.dll', 'TypeIconsW2.dll', 'TypeIconsCircularB2.dll', 'TypeIconsCircularW2.dll', 'TypeIconsSolidB2.dll', 'TypeIconsSolidW2.dll', 'MoveEffectivenessB2.dll', 'MoveEffectivenessW2.dll',
      ...['B', 'W'].flatMap(game => ['TypeIcons', 'TypeIconsCircular', 'TypeIconsSolid', 'MoveEffectiveness'].map(module => `${module}${game}.dll`))],
    note: `Independent overlay-168 Type Icons ${hud.games.W2.version}, Circular ${hud.games.W2.variants.circular.version}, Solid ${hud.games.W2.variants.solid.version}, and Move Effectiveness ${hud.moveGames.W2.version} modules, catalog ${hud.version}. BW1 icons and move preview use overlay 94 and independent native profiles. Icons: ${bw1Status(hud.games)} Move preview: ${bw1Status(hud.moveGames)} Includes generated address/hook headers, reversible panel geometry, and isolated DS/extended-RAM checks. Canonical source is runtime/battle-type-hud; no emulator captures or build binaries are copied.`,
    extra: [
      ...['B2', 'W2'].flatMap(game => [
        file('battle-type-hud', `build/addresses-${game}.h`, 'generated-header'),
        ...['TypeIcons', 'MoveEffectiveness'].map(module => file('battle-type-hud', `build/hooks-${module}-${game}.h`, 'generated-header')),
      ]),
      ...['B', 'W'].flatMap(game => [
        file('battle-type-hud', `build/addresses-${game}.h`, 'generated-header'),
        file('battle-type-hud', `build/hooks-TypeIcons-${game}.h`, 'generated-header'),
        file('battle-type-hud', `build/addresses-MoveEffectiveness-${game}.h`, 'generated-header'),
        file('battle-type-hud', `build/hooks-MoveEffectiveness-${game}.h`, 'generated-header'),
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
    name: 'party-quick-actions', title: 'Party Menu leveling, healing, HP, XP and status toolbar',
    artifacts: ['PartyQuickActionsB2.dll', 'PartyQuickActionsW2.dll'],
    note: 'Independent English revision-0 BW2 PMC toolbar 0.1.5 with nine transparent bottom-bar controls, native Full Restore art with cancellable confirmation before healing non-fainted party members with the potion recovery sound, optional read-only saved-flag gating with native menu fallback, confirmed XP edging and nickname acknowledgement, L/A navigation with the native party movement sound, a one-pixel selector following the native fade, status toggles, required Infinite Candy and in-place migration from 0.1.0/0.1.1/0.1.2/0.1.3/0.1.4. Retail profile, compiled CPU, installer and DS emulator evidence are recorded separately. Native graphics are extracted by the builder; source exports omit ROMs, saves and emulator captures. Hardware and general hack compatibility remain unverified.',
    extra: [
      file('party-quick-actions', 'integration/partyQuickActionsModel.ts', 'support-only', 'src/pokeweb/partyQuickActionsModel.ts'),
      file('party-quick-actions', 'tests/partyQuickActionsModel.test.ts', 'test', 'src/test/partyQuickActionsModel.test.ts'),
      file('party-quick-actions', 'metadata/partyQuickActionsManifest.json', 'metadata', 'src/assets/codeinjection/partyQuickActionsManifest.json'),
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
if (only !== undefined && !manifest.patches.some(p => p.name === only) && !additions.some(p => p.name === only)) throw Error(`Unknown source group: ${only}`);
for (const group of additions) {
  if (only && group.name !== only) continue;
  const updated = { name: group.name, title: group.title, artifacts: group.artifacts.map(name => ({ name })), note: group.note, status: group.status || 'source-available', files: [...(group.runtime === false ? [] : runtimeFiles(group.name)), ...group.extra] };
  const index = manifest.patches.findIndex(p => p.name === group.name);
  if (index === -1) manifest.patches.push(updated);
  else manifest.patches[index] = updated;
}
const pmcPatch = manifest.patches.find(patch => patch.name === 'pmc');
if (!pmcPatch) throw Error('PMC source provenance is missing');
if (!pmcPatch.artifacts.some(artifact => artifact.name === 'PMC_W2I.rpm'))
  pmcPatch.artifacts.push({ name: 'PMC_W2I.rpm' });
pmcPatch.note = 'W2I retargets the pinned W2 loader through the audited Pokeweb adapter; B2/W2 framework sources remain in the PMC checkout. External toolchains and libraries are not vendored.';
for (const [name, origin] of [
  ['build-italian-pmc.ts', 'scripts/build-italian-pmc.ts'],
  ['inspect-pmc.ts', 'scripts/inspect-pmc.ts'],
]) if (!pmcPatch.files.some(entry => entry.path === `pmc/integration/${name}`))
  pmcPatch.files.push(file('pmc', `integration/${name}`, 'build-tool', origin));
pmcPatch.files = pmcPatch.files.filter(entry => entry.path !== 'pmc/integration/inspect-italian-pmc.ts');
// Shared mode-aware memory helper used by the split sprite runtimes.
for (const [name, origin, kind, repository] of [
  ['include/util/main_ram.h', 'include/util/main_ram.h', 'source', 'w2u-integration'],
  ['include/swan/nds/hw.h', 'include/swan/nds/hw.h', 'source', 'w2u-integration'],
  ['tests/test_main_ram.py', 'tools/tests/test_main_ram.py', 'test', 'w2u-integration'],
  ['tests/check_pwan_substitute_runtime.py', 'tools/tests/check_pwan_substitute_runtime.py', 'test', 'w2u-runtime'],
]) {
  const existing = manifest.sharedFiles.find(entry => entry.path === `shared/${name}`);
  if (existing) existing.origin = { repository, path: origin };
  else manifest.sharedFiles.push({ path: `shared/${name}`, origin: { repository, path: origin }, kind });
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
for (const folder of ['following', 'following/black2', 'following/white2upgrade', 'following/white2italy']) {
  for (const name of fs.readdirSync(path.join(app, 'src/assets', folder))) {
    if (!only && /\.(dll|rpm)$/.test(name) && !artifacts.has(`${folder}/${name}`)) throw Error(`Unaccounted bundled artifact: ${folder}/${name}`);
  }
}
for (const entry of [...manifest.patches.filter(p => !only || p.name === only).flatMap(p => p.files), ...(!only ? manifest.sharedFiles : [])]) {
  if (sourcePaths.has(entry.path)) throw Error(`Duplicate source: ${entry.path}`);
  sourcePaths.add(entry.path);
  const origin = safeJoin(roots[entry.origin.repository], entry.origin.path);
  if (!fs.existsSync(origin)) throw Error(`Missing canonical source origin for ${entry.path}: ${entry.origin.repository}/${entry.origin.path}`);
  const raw = fs.readFileSync(origin);
  const normalized = entry.kind === 'binary-build-input' ? raw : normalize(raw);
  const destination = outputRoot ? safeJoin(outputRoot, entry.path) : undefined;
  const existing = destination && fs.existsSync(destination) ? fs.readFileSync(destination) : undefined;
  const old = oldFiles.get(entry.path);
  const priorHash = priorIndex?.files[entry.path] || old?.sha256;
  if (existing && !existing.equals(normalized) && (!priorHash || hash(existing) !== priorHash)) {
    throw Error(`Locally edited snapshot; refusing to overwrite: ${entry.path}`);
  }
  entry.sha256 = hash(normalized);
  snapshotHashes[entry.path] = entry.sha256;
  entry.normalized = !raw.equals(normalized);
  if (outputRoot && !existing?.equals(normalized)) pending.set(entry.path, normalized);
}
if (outputRoot) {
  const untracked = [];
  const inspect = folder => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) inspect(full);
      else if (entry.isFile()) {
        const relative = path.relative(outputRoot, full).split(path.sep).join('/');
        if (relative !== '.patch-sources-index.json' && !sourcePaths.has(relative) && !priorIndex?.files[relative])
          untracked.push(relative);
      }
    }
  };
  if (fs.existsSync(outputRoot)) inspect(outputRoot);
  if (untracked.length) throw Error(`Untracked files in snapshot output: ${untracked.join(', ')}`);
  for (const [relative, expectedHash] of Object.entries(priorIndex?.files || {})) {
    if (sourcePaths.has(relative) || (only && !relative.startsWith(`${only}/`))) continue;
    const destination = safeJoin(outputRoot, relative);
    if (fs.existsSync(destination)) {
      if (hash(fs.readFileSync(destination)) !== expectedHash)
        throw Error(`Locally edited stale snapshot; refusing to remove: ${relative}`);
      staleSnapshotPaths.push(relative);
    }
    delete snapshotHashes[relative];
  }
  const ordered = Object.fromEntries(Object.entries(snapshotHashes).sort(([a], [b]) => a.localeCompare(b, 'en')));
  const indexBytes = Buffer.from(JSON.stringify({ format: 1, files: ordered }, null, 2) + '\n');
  if (!fs.existsSync(snapshotIndexPath) || !fs.readFileSync(snapshotIndexPath).equals(indexBytes))
    pending.set('.patch-sources-index.json', indexBytes);
}
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
if (!fs.readFileSync(manifestPath).equals(manifestBytes)) pending.set('manifest.json', manifestBytes);
if (check && (pending.size || staleSnapshotPaths.length))
  throw Error(`Source manifest or requested snapshot is stale: ${[...pending.keys(), ...staleSnapshotPaths].join(', ')}`);
// All inputs and local-edit guards are checked before any output changes.
if (!check) {
  for (const relative of staleSnapshotPaths) fs.unlinkSync(safeJoin(outputRoot, relative));
  for (const [relative, bytes] of pending) {
    const destination = relative === 'manifest.json' ? manifestPath : safeJoin(outputRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
  }
}
console.log(`${check ? 'Verified' : 'Refreshed'} ${only || 'all groups'}, ${sourcePaths.size} source entries; ${pending.size} manifest or external snapshot files ${check ? 'need updating' : 'updated'}.`);
