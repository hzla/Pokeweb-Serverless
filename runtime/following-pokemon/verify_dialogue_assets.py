"""Execute side-on dialogue reach for each measured installed up/down pose.

The imported harness first checks the complete packaged conversation lifecycle.
Then the asset scan supplies the real descriptor, model and directional gaps.
Native targeting/obstruction services are mocked; artwork decoding is recorded
by the companion TypeScript scanner. No game emulator or rasterizer runs.
"""
import hashlib
import json
import struct
from pathlib import Path
import sys

if len(sys.argv) != 3:
    raise SystemExit('Expected asset scan JSON and output CPU report JSON')
scan_path, report_path = map(Path, sys.argv[1:])
scan = json.loads(scan_path.read_text())
import verify_interactions as harness

assert scan['schemaVersion'] == 1
assert scan['moduleSha256'] == hashlib.sha256(harness.DLL.read_bytes()).hexdigest()
assert scan['summary']['appearances'] == len(scan['records'])
checked = narrow_checked = 0
narrow_species = set()
for record in scan['records']:
    assert len(record['gaps']) == 4 and all(0 <= gap <= 12 for gap in record['gaps'])
    descriptor = bytes.fromhex(record['descriptorHex'])
    assert len(descriptor) == 28 and len(record['poses']) == 4
    for pose in record['poses']:
        assert pose['facing'] in (0, 1) and pose['tick'] in (0, 10) and pose['width'] > 0
        for direction in (2, 3):
            harness.setup(direction, record['species'])
            harness.half(harness.A + 24, pose['facing'])
            harness.half(harness.A + 12, record['modelCode'])
            harness.uc.mem_write(harness.A + 228, descriptor)
            harness.uc.mem_write(harness.F + 1852, bytes(record['gaps']))
            harness.call('fwr_anchor', [harness.A, pose['facing']])
            sign = -1 if direction == 2 else 1
            for sideways in (-6, 0, 6):
                x = z = 10 * 65536 + 32768
                for separation in (16, 17 + record['gaps'][direction]):
                    ax, az = x + sign * separation * 4096, z + sideways * 4096
                    corner = (ax, z)
                    harness.uc.mem_write(harness.P + 68, struct.pack('<3i', x, 0, z))
                    harness.uc.mem_write(harness.A + 68, struct.pack('<3i', ax, 0, az))
                    harness.uc.mem_write(harness.A + 60, struct.pack('<3h', ax // 65536, 0, az // 65536))
                    for index, (sx, sz) in enumerate(((ax, az), corner, (x, z))):
                        harness.uc.mem_write(harness.F + 52 + index * 28,
                            struct.pack('<iiiIIHHBBH', sx, 0, sz, 1, 1, 0, 0, pose['facing'], 3, 1))
                    harness.half(harness.F + 1850, 3)
                    assert harness.call('fwt_reach', [harness.F, harness.P, harness.A, harness.FIELD]) == 1, (
                        record['key'], pose, direction, sideways, separation)
                    checked += 1
                    if pose['width'] <= 16:
                        narrow_checked += 1
                        narrow_species.add(record['species'])
    # Bound the harness spy log when scanning thousands of appearances.
    harness.calls.clear()
result = {
    'assetScanSha256': hashlib.sha256(scan_path.read_bytes()).hexdigest(),
    'moduleSha256': scan['moduleSha256'], 'catalog': scan['summary'],
    'acceptedSideOnCases': checked, 'acceptedNarrowPoseCases': narrow_checked,
    'narrowSpeciesChecked': len(narrow_species), 'failures': [],
    'geometry': 'Up/down follower, player left/right, both poses, lateral -6/0/+6 units, ordinary and maximum configured forward reach.',
    'nativeServicesMocked': True, 'gameEmulatorRun': False,
}
report_path.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
