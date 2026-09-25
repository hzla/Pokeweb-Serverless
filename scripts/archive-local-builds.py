#!/usr/bin/env python3
"""Archive ignored historical follower/LEARNSET outputs by same-volume rename.

Dry-run is the default. The manifest lives outside the repository alongside the
moved files. Restore refuses to overwrite any existing source path.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ARCHIVE = REPO.parent / '.pokeweb-local-archive'
MANIFEST = ARCHIVE / 'build-archive-manifest.json'
FOLLOWER = REPO / 'runtime/following-pokemon/build'
LEARNSET = REPO / 'runtime/learnset-viewer/build'
KEEP_FOLLOWER_DIRS = {'python', 'stock', 'black2', 'white2upgrade', 'white2italy'}
EXTENSIONS = {'.nds', '.sav', '.dsv', '.dst', '.mln'}


def candidates():
    result = []
    for item in FOLLOWER.iterdir():
        if item.is_dir() and item.name not in KEEP_FOLLOWER_DIRS:
            result.append(item)
        elif item.is_file() and item.suffix.lower() in EXTENSIONS:
            result.append(item)
    for profile in sorted(KEEP_FOLLOWER_DIRS - {'python'}):
        root = FOLLOWER / profile
        if not root.exists():
            continue
        for item in root.iterdir():
            if item.is_dir() and ('test' in item.name or 'manual' in item.name or 'rom' in item.name):
                result.append(item)
            elif item.is_file() and item.suffix.lower() in EXTENSIONS:
                result.append(item)
    for item in LEARNSET.iterdir():
        if item.is_file() and item.suffix.lower() in EXTENSIONS:
            result.append(item)
        elif item.is_dir() and item.name != 'python':
            result.append(item)
    return sorted(result)


def files_in(item):
    return sorted(p for p in item.rglob('*') if p.is_file()) if item.is_dir() else [item]


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def inventory(items):
    entries = []
    for item in items:
        origin = item.relative_to(REPO)
        rows = [{'path': str(p.relative_to(item)) if item.is_dir() else '.',
                 'size': p.stat().st_size, 'sha256': digest(p)} for p in files_in(item)]
        entries.append({'original': str(origin), 'archive': str(Path('builds') / origin),
                        'kind': 'directory' if item.is_dir() else 'file', 'files': rows})
    return entries


def totals(entries):
    return {'items': len(entries), 'files': sum(len(e['files']) for e in entries),
            'bytes': sum(row['size'] for e in entries for row in e['files'])}


def restore(entries, sample):
    if sample:
        entries = [e for e in entries if e['original'] == sample]
        if not entries:
            raise SystemExit(f'No archived item: {sample}')
    # Check the complete selection before moving any entry.
    for entry in entries:
        src = ARCHIVE / entry['archive']
        dst = REPO / entry['original']
        if dst.exists():
            raise SystemExit(f'Restore target already exists: {dst}')
        if not src.exists():
            raise SystemExit(f'Archive entry missing: {src}')
        for row in entry['files']:
            p = src / row['path'] if entry['kind'] == 'directory' else src
            if p.stat().st_size != row['size'] or digest(p) != row['sha256']:
                raise SystemExit(f'Archive hash mismatch: {p}')
        if src.stat().st_dev != REPO.stat().st_dev:
            raise SystemExit(f'Cross-volume rename refused: {src}')
    moved = []
    try:
        for entry in entries:
            src = ARCHIVE / entry['archive']
            dst = REPO / entry['original']
            dst.parent.mkdir(parents=True, exist_ok=True)
            src.rename(dst)
            moved.append((src, dst))
    except Exception:
        for src, dst in reversed(moved):
            dst.rename(src)
        raise
    return entries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--restore', action='store_true')
    parser.add_argument('--verify', action='store_true')
    parser.add_argument('--sample', help='Original repo-relative item to restore')
    args = parser.parse_args()
    if args.verify:
        data = json.loads(MANIFEST.read_text())
        expected_files = set()
        for entry in data['entries']:
            base = ARCHIVE / entry['archive']
            for row in entry['files']:
                path = base / row['path'] if entry['kind'] == 'directory' else base
                expected_files.add(path)
                if path.stat().st_size != row['size'] or digest(path) != row['sha256']:
                    raise SystemExit(f'Archive hash mismatch: {path}')
        actual_files = {p for p in (ARCHIVE / 'builds').rglob('*') if p.is_file()}
        if actual_files != expected_files:
            raise SystemExit(f'Archive inventory mismatch: {len(expected_files - actual_files)} missing, {len(actual_files - expected_files)} extra files')
        print(json.dumps({'verified': totals(data['entries'])}, indent=2))
        return
    if args.restore:
        data = json.loads(MANIFEST.read_text())
        moved = restore(data['entries'], args.sample)
        if args.sample:
            data['entries'] = [e for e in data['entries'] if e not in moved]
            temporary = MANIFEST.with_suffix('.tmp')
            temporary.write_text(json.dumps(data, indent=2) + '\n')
            temporary.replace(MANIFEST)
        else:
            MANIFEST.unlink()
        print(json.dumps({'restored': totals(moved)}, indent=2))
        return
    if args.sample:
        parser.error('--sample requires --restore')
    items = candidates()
    if not args.apply:
        count = sum(len(files_in(item)) for item in items)
        size = sum(p.stat().st_size for item in items for p in files_in(item))
        print(json.dumps({'dryRun': True, 'items': len(items), 'files': count,
                          'bytes': size, 'archive': str(ARCHIVE)}, indent=2))
        return
    previous = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {'version': 1, 'entries': []}
    if previous.get('version') != 1:
        raise SystemExit('Unsupported archive manifest version')
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    if os.stat(ARCHIVE).st_dev != os.stat(REPO).st_dev:
        raise SystemExit('Archive must be on the same volume')
    entries = inventory(items)
    for entry in entries:
        if (ARCHIVE / entry['archive']).exists():
            raise SystemExit(f"Archive target already exists: {ARCHIVE / entry['archive']}")
    moved = []
    try:
        for entry in entries:
            src = REPO / entry['original']
            dst = ARCHIVE / entry['archive']
            dst.parent.mkdir(parents=True, exist_ok=True)
            src.rename(dst)
            moved.append((src, dst))
        temporary = MANIFEST.with_suffix('.tmp')
        temporary.write_text(json.dumps({'version': 1, 'entries': previous['entries'] + entries}, indent=2) + '\n')
        temporary.replace(MANIFEST)
    except Exception:
        for src, dst in reversed(moved):
            dst.rename(src)
        raise
    print(json.dumps({'archived': totals(entries), 'manifest': str(MANIFEST)}, indent=2))

if __name__ == '__main__':
    main()
