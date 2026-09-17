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
if (only !== undefined && !manifest.patches.some(p => p.name === only)) throw Error(`Unknown source group: ${only}`);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const oldFiles = new Map([...manifest.patches.flatMap(p => p.files), ...manifest.sharedFiles].map(f => [f.path, f]));
const pending = new Map();
const sourcePaths = new Set();
const readAssetManifest = name => JSON.parse(fs.readFileSync(path.join(app, 'src/assets/codeinjection', name), 'utf8'));
const learnset = readAssetManifest('learnsetViewerManifest.json');
const hud = readAssetManifest('battleTypeHudManifest.json');

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
    .filter(entry => entry.isFile() && /\.(cpp|h|py|ts|json|java|yml|md|txt|cjs)$/.test(entry.name))
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
    name: 'learnset-viewer', title: 'Standalone LEARNSET party-menu viewer',
    artifacts: ['LearnsetMenuB2.dll', 'LearnsetMenuW2.dll', 'LearnsetViewerB2.dll', 'LearnsetViewerW2.dll'],
    note: `Version ${learnset.version}. PMC-only menu/field and overlay-258 viewer companions; includes correct sub-BG palette addressing and no-fade read-only L/R family navigation with virtual species learnsets/info, descendant-first branch browsing, A requirement pages, selected-only native two-pose icon animation, native lower-screen foreground/shadows and matching light upper panels, full-height right-panel left shading with unchanged ability row rules, purple hidden abilities, matching icon transparency, a dark teal selected-sprite frame with brighter title/fin accents unchanged, muted panel border, restored charcoal description body with a dark fin/top strip and no side/bottom borders, four-pixel slate-teal gutter, clipped stats panel, party-position header cue, retail title rails, D-pad party navigation, compact gold base stats, form ability names, cycle-safe three-Pokemon evolution chains, buffered ROM reads, buffered background fix, and two-pixel icon/level spacing. Canonical sources remain in Pokeweb runtime/learnset-viewer.`,
    extra: [
      file('learnset-viewer', 'metadata/learnsetViewerManifest.json', 'metadata', 'src/assets/codeinjection/learnsetViewerManifest.json'),
      file('learnset-viewer', 'integration/learnsetViewerModel.ts', 'support-only', 'src/pokeweb/learnsetViewerModel.ts'),
      file('learnset-viewer', 'tests/learnsetViewerModel.test.ts', 'test', 'src/test/learnsetViewerModel.test.ts'),
      file('learnset-viewer', 'tests/verify-learnset-viewer-install.ts', 'test', 'scripts/verify-learnset-viewer-install.ts'),
    ],
  },
  {
    name: 'battle-type-hud', title: 'Battle Type Icons and Move Effectiveness Preview',
    artifacts: ['TypeIconsB2.dll', 'TypeIconsW2.dll', 'MoveEffectivenessB2.dll', 'MoveEffectivenessW2.dll'],
    note: `Independent overlay-168 Type Icons ${hud.games.W2.version} and Move Effectiveness ${hud.moveGames.W2.version} modules, catalog ${hud.version}. Includes generated address/hook headers and private panel geometry. Canonical Pokeweb runtime snapshot originates from work/battle-type-hud; no emulator captures or build binaries are copied.`,
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
];
for (const group of additions) {
  if (only && group.name !== only) continue;
  const updated = { name: group.name, title: group.title, artifacts: group.artifacts.map(name => ({ name })), note: group.note, status: 'source-copied', files: [...runtimeFiles(group.name), ...group.extra] };
  const index = manifest.patches.findIndex(p => p.name === group.name);
  if (index === -1) manifest.patches.push(updated);
  else manifest.patches[index] = updated;
}
const artifacts = new Set(manifest.excludedArtifacts);
for (const patch of manifest.patches) for (const artifact of patch.artifacts) {
  if (artifacts.has(artifact.name)) throw Error(`Duplicate artifact: ${artifact.name}`);
  artifacts.add(artifact.name);
  if (!only || patch.name === only) artifact.sha256 = hash(fs.readFileSync(safeJoin(path.join(app, 'src/assets/codeinjection'), artifact.name)));
}
for (const name of fs.readdirSync(path.join(app, 'src/assets/codeinjection'))) {
  if (!only && /\.(dll|rpm)$/.test(name) && !artifacts.has(name)) throw Error(`Unaccounted bundled artifact: ${name}`);
}
for (const entry of [...manifest.patches.filter(p => !only || p.name === only).flatMap(p => p.files), ...(!only ? manifest.sharedFiles : [])]) {
  if (sourcePaths.has(entry.path)) throw Error(`Duplicate source: ${entry.path}`);
  sourcePaths.add(entry.path);
  const raw = fs.readFileSync(safeJoin(roots[entry.origin.repository], entry.origin.path));
  const normalized = normalize(raw);
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
