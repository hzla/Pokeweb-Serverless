#!/usr/bin/env python3
"""Build native item signatures from an extracted retail overlay and symbol map.

Inputs stay local. The output contains signatures, item IDs and editable operand
locations; it contains no ROM paths, project identities or decomp checkout paths.
"""
import argparse
import json
import re
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--overlay', type=Path, required=True)
    parser.add_argument('--base', type=lambda s: int(s, 0), required=True)
    parser.add_argument('--symbols', type=Path, required=True)
    parser.add_argument('--handlers', type=Path, required=True)
    parser.add_argument('--items', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    data = args.overlay.read_bytes()
    symbols = {}
    for name, size, address in re.findall(
        r'^(\w+) kind:function\(thumb,size=(0x[\da-f]+)\) addr:(0x[\da-f]+)',
        args.symbols.read_text(), re.M,
    ):
        symbols[name] = (int(address, 16), int(size, 16))
    by_address = {address: name for name, (address, _) in symbols.items()}
    item_ids = {}
    value = -1
    for line in args.items.read_text().splitlines():
        match = re.match(r'^(ITEM_\w+)(?:\s*=\s*(\d+))?', line)
        if match:
            value = int(match[2]) if match[2] else value + 1
            item_ids[match[1]] = value
    text = args.handlers.read_text()
    table = re.search(r'sItemEventAddTable\[\] = \{([\s\S]*?)\n\};', text)[1]
    factories = re.findall(r'\{ (ITEM_\w+), (\w+) \}', table)
    functions = {}

    def signature(name):
        if name in functions:
            return
        address, size = symbols[name]
        body = data[address - args.base:address - args.base + size]
        mask = bytearray([255] * size)
        calls = []
        for offset in range(0, size - 3, 2):
            high = int.from_bytes(body[offset:offset + 2], 'little')
            low = int.from_bytes(body[offset + 2:offset + 4], 'little')
            if high & 0xF800 == 0xF000 and low & 0xF800 in (0xF800, 0xE800):
                displacement = ((high & 0x7FF) << 12) | ((low & 0x7FF) << 1)
                if displacement & 0x400000:
                    displacement -= 0x800000
                target = address + offset + 4 + displacement
                calls.append({'offset': offset, 'target': by_address.get(target, '')})
                mask[offset:offset + 4] = bytes(4)
        for offset in range(0, size - 3):
            if (address + offset) % 4 == 0 and 0x02000000 <= int.from_bytes(body[offset:offset + 4], 'little') < 0x02400000:
                mask[offset:offset + 4] = bytes(4)
        # Only operand bits are variable. Their opcodes/registers stay checked.
        operands = {
            'HandlerLeftoversUse': [(0x34, 0)],
            'HandlerChoiceBandPower': [(6, 0), (0x24, 0x3F), (0x25, 0xF8)],
            'HandlerChoiceSpecsPower': [(6, 0), (0x24, 0x3F), (0x25, 0xF8)],
            'HandlerChoiceScarf': [(0xE, 0), (0x12, 0x3F), (0x13, 0xF8)],
        }
        for offset, kept in operands.get(name, []):
            mask[offset] = kept
        functions[name] = {'hex': body.hex(), 'mask': mask.hex(), 'calls': calls}

    rows = []
    for item, factory in factories:
        if factory == 'NULL':
            continue
        match = re.search(r'static const BattleEventHandlerEntry \*' + factory + r'\([^)]*\) \{[\s\S]*?return (\w+);\n\}', text)
        handlers = re.search(r'static const BattleEventHandlerEntry ' + match[1] + r'\[\] = \{([\s\S]*?)\n\};', text)[1]
        events = []
        for event, callback in re.findall(r'\{ (0x[\da-f]+|\d+), (\w+) \}', handlers):
            signature(callback)
            events.append({'event': int(event, 0), 'handler': callback})
        rows.append({'id': item_ids[item], 'label': item.removeprefix('ITEM_').replace('_', ' ').title(), 'events': events})
    for name in ['ItemEvent_AddItemCore', 'CommonTypeBoostingItem', 'ItemAttackValueToRatio']:
        signature(name)
    # Direct native services used by editable recipes are checked at their real
    # decoded branch targets, rather than importing retail absolute addresses.
    for name in ['HandlerLeftoversUse', 'HandlerChoiceBandPower', 'HandlerChoiceSpecsPower', 'HandlerChoiceScarf', 'HandlerBlackSludge', 'CommonTypeBoostingItem', 'ItemAttackValueToRatio']:
        for call in functions[name]['calls']:
            if call['target']:
                signature(call['target'])
    output = {'version': 1, 'overlayId': 167, 'rows': rows, 'functions': functions}
    args.output.write_text(json.dumps(output, separators=(',', ':')) + '\n')
    print(f'{len(rows)} item profiles; {len(functions)} native signatures')


if __name__ == '__main__':
    main()
