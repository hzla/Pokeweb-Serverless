// Audit working sources and staged changes, including binary file contents.
// Report filenames only: never repeat the sensitive matched content in logs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync, readlinkSync } from 'node:fs';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some(arg => !['--staged', '--index', '--self-test'].includes(arg))) {
  console.error('Usage: node scripts/check-source-privacy.mjs [--staged | --index | --self-test]');
  process.exit(2);
}
const localPaths = [
  /\/(?:Users|home|Volumes)\/[^\s/"'`<>]+\//,
  /[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+[^\r\n"'`<>]+/,
  /\/(?:private\/)?var\/folders\//,
];
const username = userInfo().username;
// Common service-account names are not personally identifying and would
// otherwise flag ordinary source identifiers such as "root" and "test".
const personalUsername = username.length >= 4 && !['root', 'user', 'test', 'runner', 'admin', 'ubuntu', 'node'].includes(username.toLowerCase());
function sensitive(data) {
  return ['utf8', 'utf16le'].some(encoding => {
    const text = data.toString(encoding);
    return localPaths.some(pattern => pattern.test(text))
      || (personalUsername && text.toLowerCase().includes(username.toLowerCase()));
  });
}
if (args.includes('--self-test')) {
  const unix = ['', 'Users', 'sample-user', 'repo', 'file.txt'].join('/');
  const windows = ['C:', 'Users', 'sample-user', 'repo', 'file.txt'].join('\\');
  const temp = ['', 'var', 'folders', 'xx', 'sample', 'T', 'capture.png'].join('/');
  for (const sample of [unix, windows, temp]) {
    assert(sensitive(Buffer.from(sample)));
    assert(sensitive(Buffer.from(sample, 'utf16le')));
  }
  assert(!sensitive(Buffer.from('runtime/learnset-viewer/build/IRDO-ov12.bin: file format binary')));
  console.log('Privacy checker self-tests passed.');
  process.exit(0);
}
const staged = args.includes('--staged') || args.includes('--index');
const git = argv => execFileSync('git', argv, { cwd: root, maxBuffer: 128 * 1024 * 1024 });
const listing = args.includes('--index') ? ['ls-files', '-z', '--cached']
  : staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']
    : ['ls-files', '-z', '--cached', '--others', '--exclude-standard'];
const files = [...new Set(git(listing).toString('utf8').split('\0').filter(Boolean))];
let checked = 0;
const violations = [];
for (const file of files) {
  let bytes;
  if (staged) {
    bytes = git(['show', `:${file}`]);
  } else {
    const full = path.join(root, file);
    let stat;
    try { stat = lstatSync(full); } catch (error) {
      if (error.code === 'ENOENT') continue; // Deleted working file.
      throw error;
    }
    if (stat.isDirectory()) continue; // Submodule contents are a separate repo.
    bytes = stat.isSymbolicLink() ? Buffer.from(readlinkSync(full)) : readFileSync(full);
  }
  ++checked;
  if (sensitive(bytes)) violations.push(file);
}
if (violations.length) {
  console.error(`${staged ? 'Index' : 'Working files'}: private machine information detected in ${violations.length} file(s):`);
  for (const file of violations) console.error(`  ${file}`);
  console.error('Use repository-relative paths or environment configuration. No files were modified.');
  process.exitCode = 1;
} else {
  console.log(`Privacy check passed: ${checked} ${staged ? 'staged' : 'working/commit-eligible'} files.`);
}
