"""Find retail BW1 candidates for the Learnset Viewer's native bindings.

This read-only research pass writes an ignored inventory, never a shipped
profile or DLL. Matches locate candidate instructions; calling conventions,
work layouts, caller hooks and resources still require independent checks.
"""
import json
import os
from pathlib import Path
import re
import struct

from capstone import Cs, CS_ARCH_ARM, CS_MODE_ARM, CS_MODE_THUMB
import ndspy.codeCompression
import ndspy.rom

HERE = Path(__file__).resolve().parent
WORKSPACE = HERE.parents[2]


def load(path, code):
    rom = ndspy.rom.NintendoDSRom.fromFile(path)
    assert rom.idCode == code and rom.version == 0
    segments = {n: (o.ramAddress, bytes(o.data)) for n, o in rom.loadArm9Overlays().items()}
    segments['ARM9'] = (rom.arm9RamAddress, ndspy.codeCompression.decompress(rom.arm9))
    return segments


def pattern(source, address, length):
    base, data = source
    at = (address & ~1) - base
    code = data[at:at + length]
    assert len(code) == length
    mask = bytearray([255] * length)
    md = Cs(CS_ARCH_ARM, CS_MODE_THUMB if address & 1 else CS_MODE_ARM)
    md.skipdata = True
    for ins in md.disasm(code, address & ~1):
        if ins.mnemonic in ('bl', 'blx'):
            i = ins.address - (address & ~1)
            mask[i:i + ins.size] = bytes(ins.size)
    for i in range(0, length - 3, 4):
        if 0x02000000 <= struct.unpack_from('<I', code, i)[0] < 0x03000000:
            mask[i:i + 4] = bytes(4)
    return code, mask


def matches(source, segments, address, length):
    code, mask = pattern(source, address, length)
    runs = list(re.finditer(b'\xff+', bytes(mask)))
    anchor = max(runs, key=lambda r: r.end() - r.start())
    start, end = anchor.span()
    assert end - start >= 4
    fixed = [i for i, value in enumerate(mask) if value]
    result = []
    for name, (base, data) in segments.items():
        cursor = 0
        while (hit := data.find(code[start:end], cursor)) >= 0:
            cursor = hit + 1
            at = hit - start
            if at < 0 or at + length > len(data) or (base + at) % (2 if address & 1 else 4):
                continue
            if all(data[at + i] == code[i] for i in fixed):
                result.append({'segment': name, 'entry': (base + at) | (address & 1),
                               'matchedBytes': length, 'nativeBytes': data[at:at + length].hex()})
    return result


def call_anchors(source, target, inventory, wanted):
    """Locate ABI candidates via corresponding retail caller instructions.

    BW1 graphics services often changed ISA. Those bodies cannot be matched to
    Thumb BW2 services. An identical caller prefix can still identify its BLX
    destination and mode; this remains research evidence requiring ABI review.
    """
    anchored = {}
    for row in inventory:
        if len(row['candidates']) != 1:
            continue
        candidate = row['candidates'][0]
        src_entry, dst_entry = row['sourceEntry'], candidate['entry']
        if (src_entry & 1) != (dst_entry & 1):
            continue
        src_base, src_data = source[row['sourceSegment']]
        dst_base, dst_data = target[candidate['segment']]
        verified_length = candidate['matchedBytes']
        for length in (128, 256, 512, 1024):
            if (src_entry & ~1) - src_base + length > len(src_data) or (dst_entry & ~1) - dst_base + length > len(dst_data):
                break
            code, mask = pattern(source[row['sourceSegment']], src_entry, length)
            at = (dst_entry & ~1) - dst_base
            if not all(dst_data[at + i] == code[i] for i, value in enumerate(mask) if value):
                break
            verified_length = length
        md = Cs(CS_ARCH_ARM, CS_MODE_THUMB if src_entry & 1 else CS_MODE_ARM)
        source_instructions = md.disasm(src_data[(src_entry & ~1) - src_base:(src_entry & ~1) - src_base + verified_length], src_entry & ~1)
        for ins in source_instructions:
            if ins.mnemonic not in ('bl', 'blx') or not ins.op_str.startswith('#'):
                continue
            called = int(ins.op_str[1:], 0) | (1 if ins.mnemonic == 'bl' and src_entry & 1 else 0)
            if called not in wanted:
                continue
            dst_pc = (dst_entry & ~1) + ins.address - (src_entry & ~1)
            at = dst_pc - dst_base
            other = next(md.disasm(dst_data[at:at + ins.size], dst_pc))
            assert other.mnemonic in ('bl', 'blx') and other.op_str.startswith('#')
            entry = int(other.op_str[1:], 0) | (1 if other.mnemonic == 'bl' and dst_entry & 1 else 0)
            anchored.setdefault(called, []).append({'entry': entry, 'sourceCaller': ins.address,
                'targetCaller': dst_pc, 'targetSegment': candidate['segment'],
                'sourceInstruction': bytes(ins.bytes).hex(), 'targetInstruction': bytes(other.bytes).hex()})
    return anchored


def main():
    source = load(os.environ.get('LEARNSET_W2_ROM', WORKSPACE / 'cleanwhite2.nds'), b'IRDO')
    entries = {}
    for path in [HERE / 'runtime.h', *sorted(HERE.glob('*.cpp'))]:
        text = path.read_text()
        for match in re.finditer(r'native<.*?>\s*\((0x[\da-f]+)\s*,\s*(0x[\da-f]+)\)', text, re.I):
            entry = int(match[1], 16)
            entries.setdefault(entry, []).append(f'{path.name}:{text[:match.start()].count(chr(10)) + 1}')
    entries.update({0x0219fca1: ['MenuCreate'], 0x0219d025: ['MenuSelect'], 0x0215b54d: ['Dispatch']})
    entries.pop(0x0219b9e8)  # A callback data table, not an ARM function.
    output = {}
    for game, default, code in [('B', WORKSPACE / 'cleanblack.nds', b'IRBO'),
                                ('W', Path.home() / 'Downloads/cleanroms/cleanwhite.nds', b'IRAO')]:
        target = load(os.environ.get(f'LEARNSET_{game}_ROM', default), code)
        inventory = []
        for address, references in entries.items():
            segment = 'ARM9' if address < 0x02100000 else 165 if references[0] in ('MenuCreate', 'MenuSelect') else 12 if references[0] == 'Dispatch' else 258
            candidates = []
            for length in (80, 48, 32, 24, 16):
                candidates = matches(source[segment], target, address, length)
                if candidates:
                    break
            inventory.append({'sourceEntry': address, 'sourceSegment': segment, 'references': references,
                              'candidates': candidates, 'reviewedAbi': False})
        anchors = call_anchors(source, target, inventory, entries)
        for row in inventory:
            row['retailCallerCandidates'] = anchors.get(row['sourceEntry'], [])
        output[game] = inventory
        unique = [r for r in inventory if len(r['candidates']) == 1]
        print(f'{game}: {len(unique)}/{len(inventory)} unique instruction candidates; ABI/layout verification pending')
        print('unmatched:', ', '.join(hex(r['sourceEntry']) for r in inventory if not r['candidates']))
        print('additional caller candidates:', sum(not r['candidates'] and bool(r['retailCallerCandidates']) for r in inventory))
    (HERE / 'build').mkdir(exist_ok=True)
    (HERE / 'build/bw1-binding-inventory.json').write_text(json.dumps(output, indent=2) + '\n')


if __name__ == '__main__':
    main()
