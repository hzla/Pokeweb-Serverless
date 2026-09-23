"""Read-only US Black 2/White 2 revision-0 binary verifier. No patch is installed."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import ndspy.rom
import ndspy.narc
import ndspy.codeCompression

HERE = Path(__file__).resolve().parent

def verify(path):
    data = Path(path).read_bytes()
    code = data[12:16].decode('ascii', errors='replace')
    contract_name = 'black2-contract.json' if code == 'IREO' else 'contract.json'
    contract = json.loads((HERE / contract_name).read_text())
    target = contract['target']
    if data[12:16].decode('ascii', errors='replace') != target['gameCode'] or data[30] != target['revision']:
        raise ValueError('Requires stock US Black 2 or White 2 revision 0')
    if hashlib.sha256(data).hexdigest() != target['sha256']:
        raise ValueError('Input does not match the pinned clean ROM SHA-256')
    rom = ndspy.rom.NintendoDSRom(data)
    overlays = rom.loadArm9Overlays(sorted({int(h["segment"]) for h in contract["hooks"]+contract.get("nativeAdapters",[]) if h["segment"]!="ARM9"}))
    segments = {'ARM9': (rom.arm9RamAddress, ndspy.codeCompression.decompress(rom.arm9))}
    segments.update({str(i): (o.ramAddress, o.data) for i, o in overlays.items()})
    results = []
    for h in contract['hooks']:
        base, segment = segments[h['segment']]
        expected = bytes.fromhex(h['expectedHex'])
        at = h['address'] - base
        if at < 0 or bytes(segment[at:at + len(expected)]) != expected:
            raise ValueError('Binary signature mismatch: ' + h['id'])
        if sum(h['instructionSizes']) != h['patchBytes']:
            raise ValueError('Partial instruction in patch: ' + h['id'])
        if h['kind'] == 'FULL_COPY' and h['address'] % 4:
            raise ValueError('PMC ABS32 copy target must be word-aligned')
        results.append({'id': h['id'], 'bytesMatch': True, 'status': h['status']})
    for adapter in contract.get('nativeAdapters',[]):
        base,segment=segments[adapter['segment']]
        at=adapter['address']-base;expected=bytes.fromhex(adapter['expectedHex'])
        if not expected or at<0 or at+len(expected)>len(segment) or bytes(segment[at:at+len(expected)])!=expected:raise ValueError('Native adapter signature mismatch: '+adapter['id'])
    spec = contract['registry']
    registry = ndspy.narc.NARC(rom.getFileByName(spec['path'])).files
    if len(registry) != 1 or len(registry[0]) != 4 + spec['stockRows'] * spec['stride']:
        raise ValueError('Unexpected native registry length')
    if struct.unpack_from('<I', registry[0])[0] != spec['stockRows']:
        raise ValueError('Unexpected native registry count')
    resources = ndspy.narc.NARC(rom.getFileByName(contract['resources']['path'])).files
    if len(resources) != contract['resources']['stockMembers']:
        raise ValueError('Unexpected resource count')
    # Exhaustively compare retail object ranges to the actual registry row IDs.
    ids = [struct.unpack_from('<H', registry[0], 4 + i * 28)[0] for i in range(spec['stockRows'])]
    expected_ids = list(range(0x179)) + list(range(0x1000, 0x126c)) + list(range(0x2000, 0x200b))
    if ids != expected_ids:
        raise ValueError('Retail object-code row ordering differs')
    return {'target': target, 'hooks': results, 'registryRows': len(ids), 'resourceMembers': len(resources),
            'runtimeTested': False, 'releaseGates': contract['releaseGates']}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    report = verify(args.rom)
    output = json.dumps(report, indent=2) + '\n'
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(output)
    print(output)
