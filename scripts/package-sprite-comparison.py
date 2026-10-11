#!/usr/bin/env python3
"""Audit and package the self-contained comparison website, not its workspace backups."""
from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import json
from pathlib import Path
import re
import zipfile

DIRECTORIES = ('assets', 'a3i5-assets', 'sources')
FILES = ('index.html', 'manifest.js', 'report.json', 'verification.json',
         'comparison-browser-verification.json', 'a3i5-ranking.json')
HOST_PATH = re.compile(rb'/(?:Users|home|Volumes)/[^\s/"<>]+/|/(?:private/)?var/folders/|[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/]', re.I)
SECRETS = re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9_-]{24,}|(?:api[_-]?key|client[_-]?secret|access[_-]?token)\s*[:=]\s*["\'][^"\'\r\n]{12,}["\']', re.I)
EMAIL = re.compile(rb'\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}\b')


def gif_metadata(data: bytes) -> list[bytes]:
    """Extract extension/trailing bytes without mistaking compressed pixels for contacts."""
    if data[:6] not in (b'GIF87a', b'GIF89a') or len(data) < 13:
        raise ValueError('Invalid source GIF')
    at = 13 + (3 * (2 ** ((data[10] & 7) + 1)) if data[10] & 128 else 0)
    metadata = []

    def subblocks(at: int):
        chunks = []
        while at < len(data) and data[at]:
            size = data[at]
            if at + 1 + size > len(data): raise ValueError('Truncated GIF subblock')
            chunks.append(data[at + 1:at + 1 + size])
            at += size + 1
        if at >= len(data): raise ValueError('Truncated GIF terminator')
        return at + 1, b''.join(chunks)

    while at < len(data):
        kind = data[at]
        at += 1
        if kind == 59:
            metadata.append(data[at:])
            return metadata
        if kind == 33:
            if at >= len(data): raise ValueError('Truncated GIF extension')
            at += 1
            at, value = subblocks(at)
            metadata.append(value)
        elif kind == 44:
            if at + 9 > len(data): raise ValueError('Truncated GIF image')
            flags = data[at + 8]
            at += 9 + (3 * (2 ** ((flags & 7) + 1)) if flags & 128 else 0)
            at += 1  # LZW minimum code size
            at, _ = subblocks(at)
        else:
            raise ValueError('Unknown GIF block')
    raise ValueError('Missing GIF trailer')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('website', type=Path)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--forbid', action='append', default=[])
    args = parser.parse_args()
    root, destination = args.website.resolve(), args.archive.resolve()
    if destination.exists():
        raise ValueError('Archive already exists; choose a fresh versioned filename')
    account = getpass.getuser()
    tokens = args.forbid + ([account] if account.lower() not in ('root', 'user', 'runner', 'admin', 'test') else [])
    if any(not token for token in tokens):
        raise ValueError('Empty audit token')
    paths = [root / name for name in FILES]
    for name in DIRECTORIES:
        paths.extend(sorted((root / name).rglob('*')))
    paths = [p for p in paths if not p.is_dir()]
    failures: list[dict[str, str]] = []
    payloads = 0

    def audit(data: bytes, label: str, *, check_email: bool = True):
        reasons = set()
        # Inspect text, binary string runs, and UTF-16 representations. Never log matches.
        representations = [data]
        for encoding in ('utf-16le', 'utf-16be'):
            representations.append(data.decode(encoding, errors='ignore').encode('utf-8'))
        for value in representations:
            lower = value.lower()
            # Skip expensive regex work on large texture encodings unless a
            # required root/marker is present. This does not skip decoded data.
            host_markers = tuple(b'/'.join((b'', name, b'')) for name in (b'users', b'home', b'volumes')) + (b'/'.join((b'', b'var', b'folders', b'')), b'users\\', b'documents and settings')
            secret_markers = (b'private key', b'key', b'token', b'secret', b'ghp_', b'github_pat_', b'sk-')
            if any(marker in lower for marker in host_markers) and HOST_PATH.search(value): reasons.add('host-specific path')
            if any(marker in lower for marker in secret_markers) and SECRETS.search(value): reasons.add('credential-like string')
            if check_email and b'@' in value and EMAIL.search(value): reasons.add('email address requiring review')
            if any(token.lower().encode() in lower for token in tokens): reasons.add('private audit token')
        failures.extend({'file': label, 'category': reason} for reason in sorted(reasons))

    for index, p in enumerate(paths):
        relative = p.relative_to(root).as_posix()
        if p.is_symlink() or not p.is_file() or p.name.startswith('.'):
            raise ValueError('Unexpected symlink/hidden/non-file website member')
        audit(relative.encode(), relative)
        data = p.read_bytes()
        audit(data, relative, check_email=p.suffix != '.gif')
        if p.suffix == '.gif':
            for metadata in gif_metadata(data): audit(metadata, relative + ':metadata')
        if p.parent.name in ('assets', 'a3i5-assets'):
            # The site's texture bytes are base64 encoded; scanning JS alone is insufficient.
            values = json.loads(data.decode().split('=', 1)[1].strip().removesuffix(';'))
            for kind, value in values.items():
                encoded = value if isinstance(value, str) else value['frames']
                audit(base64.b64decode(encoded, validate=True), relative + ':' + kind, check_email=False)
                payloads += 1
        if index % 500 == 0:
            print(f'Audited {index + 1}/{len(paths)} website files', flush=True)
    if failures:
        print(json.dumps({'passed': False, 'findings': failures}, indent=2))
        return 1

    manifest = json.loads((root / 'report.json').read_text())
    result = {
        'format': 'sprite-website-privacy-audit-v1', 'passed': True,
        'filesAudited': len(paths), 'decodedTexturePayloadsAudited': payloads,
        'spriteSides': manifest['uniqueSides'], 'a3i5Candidates': manifest['a3i5']['eligibleSides'],
        'checks': ['host-specific paths and local account identifiers', 'explicit private-reference tokens',
                   'credential-like strings and email addresses', 'UTF-8/UTF-16 text and binary content',
                   'decoded embedded textures and source GIF bytes', 'relative archive names and metadata'],
        'findings': [],
        'excluded': ['ROMs', 'saves', 'workspace backups', 'emulator logs', 'repository metadata',
                     'duplicate raw exports and the bundled library archive', 'OS extended attributes'],
        'artistCreditsPreserved': True,
        'scope': 'Website delivery files only; pattern checks do not establish asset redistribution rights.',
    }
    readme = (
        'SPRITE CONVERSION COMPARISON\n\n'
        'Extract the entire folder, then open index.html in a modern browser.\n'
        'No server, installation, account or network connection is needed.\n'
        'Keep assets/, a3i5-assets/ and sources/ beside index.html.\n\n'
        'Browse all 1,105 imported sides. Use Color eligibility to filter the 90\n'
        '32-color candidates, then select A3I5 under New output format.\n'
        'Only GIFs with more than 16 visible source colors qualify (excluding\n'
        'transparency). Both original-color and Gen 5 preset previews are included.\n'
        'The previous ROM output remains unchanged for comparison.\n\n'
        'PWAN and A3I5 preview downloads are generated directly by the page.\n'
        'A3I5 data is comparison-only, not an installable runtime module/asset.\n'
        'a3i5-ranking.json ranks color fidelity gains for the same source artwork.\n'
        'It is a visual-review shortlist, not a hardware or memory guarantee.\n\n'
        'ROMs, saves, backups and emulator logs are intentionally not distributed.\n'
        'Original artist credits remain in the manifest and page. Sharing this\n'
        'archive does not change the source artwork licensing or permissions.\n'
    ).encode()
    audit(readme, 'README.txt')
    audit(json.dumps(result).encode(), 'privacy-audit.json')
    if failures:
        raise ValueError('Generated packaging notes failed audit')
    prefix = 'sprite-comparison/'

    def write(archive: zipfile.ZipFile, name: str, data: bytes):
        info = zipfile.ZipInfo(prefix + name, (2026, 10, 10, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        info.extra = b''
        info.comment = b''
        archive.writestr(info, data, compresslevel=6)

    with zipfile.ZipFile(destination, 'x', allowZip64=True) as archive:
        for index, p in enumerate(paths):
            write(archive, p.relative_to(root).as_posix(), p.read_bytes())
            if index % 500 == 0:
                print(f'Compressed {index + 1}/{len(paths)} files', flush=True)
        write(archive, 'README.txt', readme)
        write(archive, 'privacy-audit.json', (json.dumps(result, indent=2) + '\n').encode())
    # Re-audit decompressed ZIP contents, including names/metadata, and check every CRC.
    with zipfile.ZipFile(destination) as archive:
        if archive.testzip() is not None:
            raise ValueError('ZIP integrity check failed')
        for info in archive.infolist():
            if not info.filename.startswith(prefix) or '..' in Path(info.filename).parts or info.extra or info.comment:
                raise ValueError('Unsafe archive metadata')
            audit(info.filename.encode(), info.filename)
            contents = archive.read(info)
            audit(contents, info.filename, check_email=not info.filename.endswith('.gif'))
            if info.filename.endswith('.gif'):
                for metadata in gif_metadata(contents): audit(metadata, info.filename + ':metadata')
    if failures:
        raise ValueError('Final decompressed archive audit failed')
    result.update({'archive': destination.name, 'archiveBytes': destination.stat().st_size,
                   'archiveSha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
                   'archiveMembers': len(paths) + 2, 'zipIntegrityPassed': True, 'zipReauditPassed': True})
    (root / 'privacy-audit.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
