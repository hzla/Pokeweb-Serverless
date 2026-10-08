"""Build unreleased BW1 Summary candidates from independently pinned inputs.

Candidates and profiles stay in build/. Bundling and normal UI availability
require separate DS gameplay acceptance; this builder does not certify it.
"""
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import ndspy.rom
import ndspy.narc
import ndspy.codeCompression
from build import HERE, BUILD, TOOLS, JAR, VERSION, graphics, run


def call_target(data, address):
    upper, lower = struct.unpack('<HH', data)
    assert upper & 0xf800 == 0xf000
    assert lower & 0xf800 in (0xf800, 0xe800)
    delta = ((upper & 2047) << 12) | ((lower & 2047) << 1)
    if delta & 0x400000:
        delta -= 0x800000
    if lower & 0xf800 == 0xe800:
        return ((address + 4 + delta) & ~3)
    return (address + 4 + delta) | 1


def profile_header(profiles):
    lines = ['#pragma once']
    for name, key in [('nativeApiAddress', 'apis'), ('nativeOverlayAddress', 'native')]:
        lines += [f'inline u32 {name}(u32 reference) {{', '#ifdef GAME_B']
        for game in ('B', 'W'):
            if game == 'W':
                lines += ['#else']
            lines += ['switch (reference) {']
            lines += [f'case {entry["reference"]}: return {entry["address"]};' for entry in profiles[game][key]]
            lines += ['default: __builtin_trap();', '}']
        lines += ['#endif', '}']
    return '\n'.join(lines) + '\n'


def main():
    BUILD.mkdir(exist_ok=True)
    profiles = {game: json.loads((HERE / f'profile-{game}.json').read_text()) for game in ('B', 'W')}
    (BUILD / 'profiles-bw1.generated.h').write_text(profile_header(profiles))
    manifest = {'version': VERSION, 'games': {}}
    generated_graphics = None
    defaults = {'B': HERE.parents[2] / 'cleanblack.nds',
                'W': Path.home() / 'Downloads/cleanroms/cleanwhite.nds'}
    for game, profile in profiles.items():
        rom = ndspy.rom.NintendoDSRom.fromFile(os.environ.get(f'SUMMARY_{game}_ROM', defaults[game]))
        assert bytes(rom.idCode).decode() == profile['idCode'] and rom.version == profile['revision']
        overlay = rom.loadArm9Overlays([profile['overlayId']])[profile['overlayId']]
        assert hashlib.sha256(overlay.data).hexdigest() == profile['overlaySha256']
        arm = ndspy.codeCompression.decompress(rom.arm9)
        signatures = []

        def signature(label, module, address, length, patch=0):
            source, base = (arm, rom.arm9RamAddress) if module == 'ARM9' else (overlay.data, overlay.ramAddress)
            at = address - base
            assert 0 <= at <= len(source) - length
            signatures.append({'label': label, 'module': str(module), 'address': address,
                               'expectedHex': bytes(source[at:at + length]).hex(), 'patchSize': patch})

        assembly = ['.syntax unified', '.thumb']
        for hook in profile['hooks']:
            address, target = int(hook['address'], 16), int(hook['target'], 16)
            at = address - overlay.ramAddress
            assert call_target(overlay.data[at:at + 4], address) == target, (game, hook)
            signature(hook['label'], profile['overlayId'], address, 4, 4)
            symbol = f'THUMB_BRANCH_LINK_{profile["overlayId"]}_0x{address:x}'
            assembly += ['.balign 4', f'.global {symbol}', f'.type {symbol},%function',
                         '.thumb_func', symbol + ':', 'push {r3}', 'ldr r3,1f', 'mov ip,r3',
                         'pop {r3}', 'bx ip', '.balign 4', f'1: .word {hook["label"]}',
                         f'.size {symbol},.-{symbol}']
        for entry in profile['apis']:
            target = int(entry['address'], 16)
            if entry['anchor']:
                address = int(entry['anchor'], 16)
                at = address - overlay.ramAddress
                assert call_target(overlay.data[at:at + 4], address) == target, (game, entry)
            signature('Native API ABI', 'ARM9', target & ~1, 32)
        for entry in profile['native']:
            signature('Native Summary ABI', profile['overlayId'], int(entry['address'], 16), 32)
        # Pin the real numeric draw and SkillUpdate bodies, including their
        # work offsets and unhooked HP-bar reads. No runtime structure guessing.
        for start, length in [(0x21da0b0, 0x354), (0x21d9740, 0x240), (0x21d9e44, 0xa4),
                              (0x21d4f20, 0x2c0), (0x21d5eb4, 0x68)]:
            signature('Native Summary layout', 131, start + (0x20 if game == 'W' else 0), length)
        native_files = list(ndspy.narc.NARC(rom.getFileByName(profile['graphicsArchive'])).files)
        generated = graphics([b'', b''] + native_files, bw1=True)
        if generated_graphics is not None:
            assert generated_graphics == generated, 'BW1 native title/footer graphics differ'
        generated_graphics = generated
        (BUILD / 'graphics-bw1.generated.h').write_text(generated)
        stem = f'SummaryStatViewer{game}'
        asm, obj, hooks, elf = [BUILD / (stem + suffix) for suffix in ('.s', '.o', 'Hooks.o', '.elf')]
        asm.write_text('\n'.join(assembly) + '\n')
        run(TOOLS / 'arm-none-eabi-g++', '-std=c++17', '-mthumb', '-march=armv5t', '-mlong-calls',
            '-Os', '-Wall', '-Wextra', '-Werror', '-fno-exceptions', '-fno-rtti', '-fno-unwind-tables',
            '-fno-asynchronous-unwind-tables', '-ffreestanding', '-fno-builtin', '-fvisibility=hidden',
            f'-DGAME_{game}', '-I', BUILD, '-c', HERE / 'viewer.cpp', '-o', obj)
        run(TOOLS / 'arm-none-eabi-as', '-mthumb', '-march=armv5t', asm, '-o', hooks)
        run(TOOLS / 'arm-none-eabi-g++', '-mthumb', '-march=armv5t', '-nostdlib', '-Wl,-r', obj, hooks, '-o', elf)
        assert not subprocess.check_output([str(TOOLS / 'arm-none-eabi-nm'), '-u', str(elf)]).strip()
        meta, symbols = BUILD / (stem + '.yml'), BUILD / 'bw1-symbols.yml'
        meta.write_text(f'PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: {VERSION}\n')
        symbols.write_text('Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n')
        output = BUILD / (stem + '.dll')
        run('java', '-cp', JAR, 'rpm.cli.RPMTool', '-i', elf, '--fourcc', 'DLXF', '-o', output,
            '--esdb', symbols, '--meta', meta, '--generate-relocations', '--strip')
        data = output.read_bytes()
        header = struct.unpack_from('<I', data, 8)[0]
        info = header + struct.unpack_from('<I', data, header + 8)[0]
        offset, length = struct.unpack_from('<II', data, info + 16)
        code = bytearray(data[offset:offset + length])
        config = code.index(b'SSVCFG1\0')
        code[config + 12:config + 20] = bytes(8)
        fingerprint = 0x811c9dc5
        for value in code:
            fingerprint = ((fingerprint ^ value) * 0x1000193) & 0xffffffff
        manifest['games'][game] = {'idCode': profile['idCode'], 'revision': profile['revision'],
            'overlayId': 131, 'graphicsArchive': profile['graphicsArchive'], 'dsAccepted': False,
            'fileName': output.name, 'codeFingerprint': f'{fingerprint:08x}',
            'bssSize': struct.unpack_from('<I', data, header + 12)[0],
            'sha256': hashlib.sha256(data).hexdigest(), 'signatures': signatures,
            'resources': [{'member': n, 'sha256': hashlib.sha256(native_files[n]).hexdigest()}
                          for n in (3, 9, 11, 65, 69, 75, 76, 78, 129)]}
        print(output.name, len(data), 'candidate; DS acceptance pending')
    (BUILD / 'bw1-candidates.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    main()
