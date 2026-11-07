"""Record checked US revision-0 native map-test entry points; never writes ROMs."""
import argparse
import json
from pathlib import Path
import struct
import ndspy.rom

PROFILES = {
    'W2': ('IRDO', 36, 12, 0x1b178, 0x021a7ef8, 0x0219c8cc, 0x0219cd04),
    'B2': ('IREO', 36, 12, 0x1b178, 0x021a7eb8, 0x0219c88c, 0x0219ccc4),
    'B': ('IRBO', 21, 10, 0x1b4cc, 0x021afcd8, 0x021a5264, 0x021a569c),
    'W': ('IRAO', 21, 10, 0x1b4cc, 0x021afcf8, 0x021a5284, 0x021a56bc),
}

def main():
    parser = argparse.ArgumentParser()
    for key in PROFILES: parser.add_argument('--' + key.lower(), required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(); result = {}
    for version, (code, field, scripts, table, warp, collision, rail) in PROFILES.items():
        rom = ndspy.rom.NintendoDSRom.fromFile(getattr(args, version.lower()))
        if rom.idCode.decode() != code or rom.version != 0: raise ValueError('Expected checked US revision-0 ' + version)
        overlays = rom.loadArm9Overlays([field, scripts]); data = overlays[field].data; base = overlays[field].ramAddress
        if struct.unpack_from('<I', overlays[scripts].data, table + 0xc2 * 4)[0] != warp | 1: raise ValueError('Warp dispatch differs')
        if data[collision - base + 0x9a:collision - base + 0x9a + 6] != bytes.fromhex('201c06b0f8bd'): raise ValueError('Collision epilogue differs')
        if data[rail - base + 0x1e:rail - base + 0x1e + 4] != bytes.fromhex('201c38bd'): raise ValueError('Rail collision epilogue differs')
        result[version] = {'idCode': code, 'revision': 0, 'fieldOverlay': field, 'scriptOverlay': scripts, 'scriptTable': table, 'warpHandler': warp | 1,
            'signatures': [{'address': address, 'hex': bytes(data[address-base:address-base+length]).hex()} for address, length in [(warp,160),(collision,160),(rail,32)]],
            'collisionReturn': collision + 0x9a, 'railCollisionReturn': rail + 0x1e}
    args.output.write_text(json.dumps(result, indent=2) + '\n')

if __name__ == '__main__': main()
