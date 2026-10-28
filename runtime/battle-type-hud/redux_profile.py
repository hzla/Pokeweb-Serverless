"""Prepare exact White 2 Redux graphics profiles and bundle adapted HUD DLLs.

Only panel fingerprints, reversible structural edits and the renderer's small
background samples are saved. Input ROMs and complete native artwork stay local.
"""
from pathlib import Path
import hashlib, json, shutil, struct
import ndspy.rom, ndspy.narc, ndspy.codeCompression, ndspy.lz10
from rpm_read import read_rpm
from panel_expansion import apply_edits

HERE = Path(__file__).resolve().parent

def sha(data):
    return hashlib.sha256(data).hexdigest()

def fingerprint(data):
    value = 0x811c9dc5
    for byte in data:
        value = ((value ^ byte) * 0x1000193) & 0xffffffff
    return f'{value:08x}'

def prepare(path):
    rom = ndspy.rom.NintendoDSRom.fromFile(path)
    assert bytes(rom.idCode) == b'IRDO' and rom.version == 0, 'Expected US White 2 revision 0.'
    native = json.loads((HERE / 'profile-TypeIcons-W2.json').read_text())
    overlays = rom.loadArm9Overlays([167, 168])
    blobs = {n: (o.ramAddress, bytes(o.data)) for n, o in overlays.items()}
    blobs[0] = (rom.arm9RamAddress, ndspy.codeCompression.decompress(rom.arm9))
    for signature in [*native['signatures'], *[dict(h, segment=168) for h in native['hooks']]]:
        base, data = blobs[signature['segment']]
        at = signature['address'] - base
        expected = bytes.fromhex(signature['bytes'])
        assert data[at:at + len(expected)] == expected, f'Native code mismatch: {signature["name"]}'
    narc = ndspy.narc.NARC(rom.getFileByName('a/0/1/1'))
    raw = {int(member): bytes(narc.files[int(member)]) for member in native['resources']}
    raw = {n: ndspy.lz10.decompress(data) if data[0] == 0x10 else data for n, data in raw.items()}
    # The palette allocation, NCER OAM layout, animations and HP number art
    # remain exactly native. Only the five audited NCGR images may differ.
    for member, expected in native['resources'].items():
        if int(member) not in (434, 435, 438, 441, 444):
            assert sha(raw[int(member)]) == expected, f'Unsupported non-image resource {member}'
    assert len(raw[438]) == 2096 and raw[438][:4] == b'RGCN'
    assert struct.unpack_from('<I', raw[438], 40)[0] == 2048
    edits = []
    for at, value in ((8, 2352), (20, 2336), (40, 2304)):
        edits.append(dict(offset=at, old=raw[438][at:at + 4].hex(), new=struct.pack('<I', value).hex()))
    edits.append(dict(offset=2096, old='', new=bytes(256).hex()))
    expanded = apply_edits(raw[438], edits)
    expansion = {'438': dict(originalSha256=sha(raw[438]), patchedSha256=sha(expanded), edits=edits, previous=[]),
                 '439': json.loads((HERE / 'panel-expansion.json').read_text())['439']}
    resources = {}
    for member, data in raw.items():
        entry = dict(nativeSha256=sha(data), nativeFingerprint=fingerprint(data))
        if str(member) in expansion:
            changed = apply_edits(data, expansion[str(member)]['edits'])
            entry.update(expandedSha256=sha(changed), expandedFingerprint=fingerprint(changed))
            assert apply_edits(changed, expansion[str(member)]['edits'], True) == data
        resources[str(member)] = entry
    backgrounds = []
    for member in (438, 435, 444, 441):
        data = raw[member][48:]
        packed = bytearray(221)
        for y in range(17):
            for x in range(26):
                row = y + 15
                index = ((row // 8) * 8 + x // 8) * 32 + (row % 8) * 4 + x // 2 % 4
                color = data[index] >> ((x & 1) * 4) & 15
                color = 2 if color in (4, 15) else color
                i = y * 26 + x
                packed[i // 2] |= color << ((i & 1) * 4)
        backgrounds.append(packed)
    header = '// White 2 Redux: checked x=0..25, y=15..31 panel samples.\n'
    header += 'constexpr u8 PanelBackground[4][221] = {\n'
    header += ''.join('  {' + ','.join(map(str, b)) + '},\n' for b in backgrounds) + '};\n'
    (HERE / 'redux-background.h').write_text(header)
    profile = dict(id='redux', label='Redux', game='W2', romCode='IRDO', revision=0,
                   graphicsArchive='a/0/1/1', resources=resources, panelExpansion=expansion)
    (HERE / 'redux-profile.json').write_text(json.dumps(profile, indent=2) + '\n')

def bundle():
    assets = HERE.parents[1] / 'src/assets/codeinjection'
    manifest = json.loads((HERE / 'redux-profile.json').read_text())
    manifest['games'] = {'W2': dict(variants={}, builds={})}
    game = manifest['games']['W2']
    types = ['NULL', 'VALUE', 'FUNCTION_ARM', 'FUNCTION_THM', 'SECTION']
    for module, variant, version, label in (
        ('TypeIcons', 'letters', '0.3.18-redux', 'Hexagonal letters'),
        ('TypeIconsCircular', 'circular', '0.3.18-circular-redux', 'Circular icons'),
        ('TypeIconsSolid', 'solid', '0.3.24-solid-redux', 'Angular HUD wedges'),
    ):
        name = f'{module}ReduxW2.dll'
        data = (HERE / 'build' / name).read_bytes()
        rpm = read_rpm(data)
        assert rpm['bss'] == 364 and rpm['metadata']['PMCVersion'] == version
        assert len([r for r in rpm['relocations'] if r['module'] != 'base']) == 17
        game['variants'][variant] = dict(label=label, version=version, dllSha256=sha(data))
        game['builds'][version] = dict(codeHex=rpm['code'].hex(), bssSize=rpm['bss'],
            relocations=rpm['relocations'], symbols=[dict(address=s['address'], type=types[s['type']], attributes=s['attributes']) for s in rpm['symbols']])
        shutil.copyfile(HERE / 'build' / name, assets / name)
    (assets / 'battleTypeHudReduxManifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
