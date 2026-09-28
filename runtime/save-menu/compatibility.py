"""Generate and audit English BW2 save-menu code and art signatures."""
import hashlib
import json
from pathlib import Path

import ndspy.codeCompression
import ndspy.narc
import ndspy.rom

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
TARGETS = {
    'W2': {'rom': ROOT / 'cleanwhite2.nds', 'gameCode': 'IRDO', 'hook': 0x0219d9e4,
           'inputGlobals': [0x0203d0c4, 0x0203d690]},
    'B2': {'rom': ROOT / 'cleanblack2.nds', 'gameCode': 'IREO', 'hook': 0x0219d9a4,
           'inputGlobals': [0x0203d098, 0x0203d664]},
}
W2_FUNCTIONS = [
    0x02039dc9, 0x0203a279, 0x02070e55, 0x02070e6d, 0x02070ca9,
    0x02070ecd, 0x02070ded, 0x02070de1, 0x020201b9, 0x0201fe25,
    0x0201ff35, 0x0201cd25, 0x02020fc1, 0x02021061, 0x02008bf1,
    0x02008de9, 0x02008fb9, 0x0203df29,
]
ART_PATHS = ['a/0/3/0', 'a/0/8/4', 'a/0/2/3']
REQUIRED_PATHS = ART_PATHS + ['a/0/0/2', 'a/0/1/2', 'a/0/8/5', 'a/0/0/7']


def map_data(rom):
    location = ndspy.narc.NARC(rom.getFileByName('a/0/0/2')).files[109]
    headers = ndspy.narc.NARC(rom.getFileByName('a/0/1/2')).files[0]
    points = ndspy.narc.NARC(rom.getFileByName('a/0/8/5')).files[0]
    if len(headers) < 615 * 48 or len(points) < 85 * 54:
        raise ValueError('Map header or marker table is too short')
    return {
        'locationNames': location,
        'mapHeaderNames': bytes(value for i in range(615) for value in headers[i * 48 + 26:i * 48 + 28]),
        'mapPoints': bytes(value for i in range(85) for value in points[i * 54:i * 54 + 8]),
    }


def port_address(address, version):
    if version == 'B2' and 0x02018c00 <= address < 0x02100000:
        return address - 0x2c
    return address


def generate():
    result = {}
    for version, target in TARGETS.items():
        rom = ndspy.rom.NintendoDSRom.fromFile(target['rom'])
        if bytes(rom.idCode).decode() != target['gameCode']:
            raise ValueError(f'{version}: unexpected game code')
        arm9 = ndspy.codeCompression.decompress(rom.arm9)
        overlay = rom.loadArm9Overlays([162])[162]
        at = target['hook'] - overlay.ramAddress
        result[version] = {
            'gameCode': target['gameCode'], 'hook': target['hook'],
            'hookBytes': overlay.data[at:at+16].hex(),
            'functions': [
                {'address': port_address(address, version),
                 'bytes': arm9[(port_address(address, version) & ~1) - rom.arm9RamAddress:
                               (port_address(address, version) & ~1) - rom.arm9RamAddress + 16].hex()}
                for address in W2_FUNCTIONS
            ],
            'inputGlobals': [
                {'address': address, 'bytes': arm9[address - rom.arm9RamAddress:address - rom.arm9RamAddress + 4].hex()}
                for address in target['inputGlobals']
            ],
            'artSha256': {path: hashlib.sha256(rom.getFileByName(path)).hexdigest() for path in ART_PATHS},
            'mapDataSha256': {key: hashlib.sha256(data).hexdigest() for key, data in map_data(rom).items()},
            'requiredPaths': REQUIRED_PATHS,
        }
    return result


def audit(rom, version, manifest=None):
    manifest = manifest or json.loads((HERE / 'compatibility.json').read_text())
    target = manifest[version]
    if bytes(rom.idCode).decode() != target['gameCode']:
        raise ValueError(f'{version}: game code does not match')
    overlay = rom.loadArm9Overlays([162])[162]
    at = target['hook'] - overlay.ramAddress
    if at < 0 or overlay.data[at:at + 16].hex() != target['hookBytes']:
        raise ValueError(f'{version}: save-menu hook differs from the supported layout')
    arm9 = ndspy.codeCompression.decompress(rom.arm9)
    for group in ('functions', 'inputGlobals'):
        for site in target[group]:
            address = site['address'] & ~1
            at = address - rom.arm9RamAddress
            if at < 0 or arm9[at:at + len(site['bytes']) // 2].hex() != site['bytes']:
                raise ValueError(f'{version}: native code signature changed at {address:#010x}')
    for path, expected in target['artSha256'].items():
        if hashlib.sha256(rom.getFileByName(path)).hexdigest() != expected:
            raise ValueError(f'{version}: bundled art differs from {path}')
    for path in target['requiredPaths']:
        if rom.filenames.idOf(path) is None:
            raise ValueError(f'{version}: required archive {path} is missing')
    for name, data in map_data(rom).items():
        if hashlib.sha256(data).hexdigest() != target['mapDataSha256'][name]:
            raise ValueError(f'{version}: embedded map data differs at {name}')
    return target


if __name__ == '__main__':
    (HERE / 'compatibility.json').write_text(json.dumps(generate(), indent=2) + '\n')
    print('Wrote code and art signatures for English Black 2 and White 2.')
