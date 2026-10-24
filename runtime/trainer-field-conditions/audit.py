"""Compare both native profiles, allowing only their audited pointer relocations."""
from pathlib import Path
import json, struct
import ndspy.rom, ndspy.codeCompression
from profiles import rom_path, address

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parents[1] / 'src/assets/codeinjection'
roms = {game: ndspy.rom.NintendoDSRom.fromFile(rom_path(game)) for game in ['W2', 'B2']}
overlays = {game: rom.loadArm9Overlays([167, 169]) for game, rom in roms.items()}
arms = {game: bytes(ndspy.codeCompression.decompress(rom.arm9)) for game, rom in roms.items()}
manifests = {game: json.loads((ASSETS / ('trainerFieldConditionsManifest.json' if game == 'W2' else 'trainerFieldConditionsB2Manifest.json')).read_text()) for game in roms}
checks = []
for white, black in zip(manifests['W2']['signatures'], manifests['B2']['signatures'], strict=True):
    assert white['label'] == black['label'] and white['module'] == black['module']
    assert black['address'] == address(white['address'], 'B2')
    for game, signature in [('W2', white), ('B2', black)]:
        module, at = signature['module'], signature['address']
        data, base = (arms[game], roms[game].arm9RamAddress) if module == 'ARM9' else (overlays[game][int(module)].data, overlays[game][int(module)].ramAddress)
        assert bytes(data[at-base:at-base+len(signature['expectedHex'])//2]).hex() == signature['expectedHex']
    normalized = bytearray.fromhex(white['expectedHex'])
    for offset in range((-white['address']) % 4, len(normalized)-3, 4):
        value, = struct.unpack_from('<I', normalized, offset)
        struct.pack_into('<I', normalized, offset, address(value, 'B2'))
    assert normalized.hex() == black['expectedHex'], white['label']
    checks.append(white['label'])
print(json.dumps({'result': 'passed', 'profiles': ['IRDO rev0', 'IREO rev0'], 'nativeBindings': checks,
    'scope': 'Exact selected native code/data slices; only audited ARM9 and overlay-167 pointer relocations differ'}, indent=2))
