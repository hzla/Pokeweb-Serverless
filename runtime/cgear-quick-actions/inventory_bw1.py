"""Find candidate BW1 bindings in independently loaded US retail segments.

The ignored inventory is an audit aid, not an accepted runtime profile. Native
calling modes, structures, hook callers and request ownership need review.
"""
import importlib.util, json
from pathlib import Path
from elftools.elf.elffile import ELFFile
import ndspy.rom, ndspy.codeCompression

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('party_inventory', HERE.parent / 'party-quick-actions/inventory_bw1.py')
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
REFERENCE, WORKSPACE = shared.REFERENCE, shared.WORKSPACE

def main():
    sources = []
    with (REFERENCE / 'main.tef').open('rb') as stream:
        elf = ELFFile(stream)
        symbols = list(elf.get_section_by_name('.symtab').iter_symbols())
        bases, modes, raw = {}, {}, {}
        for section in elf.iter_sections():
            bases.setdefault(section.name, section['sh_addr'])
        for symbol in symbols:
            if symbol.name in ('$t', '$a', '$d'):
                modes.setdefault(symbol['st_shndx'], []).append((symbol['st_value'], symbol.name))
        for values in modes.values():
            values.sort()
        for symbol in symbols:
            if symbol['st_info']['type'] != 'STT_FUNC':
                continue
            section = elf.get_section(symbol['st_shndx']).name
            if section not in ('main', 'fieldmap', 'notwifi', 'cgear'):
                continue
            if section == 'main' and not symbol.name.startswith((
                'GAMEDATA_', 'GAMESYSTEM_', 'GMEVENT_', 'GFL_', 'GFUser_', 'MYITEM_',
                'CGEAR_', 'ENCOUNT_', 'MISC_', 'CONFIG_', 'POKEPARTY_', 'PP_', 'PokeParty_',
            )):
                continue
            if section not in raw:
                raw[section] = (REFERENCE / f'{section}.TWL.FLX.sbin').read_bytes()
            address, size = symbol['st_value'], symbol['st_size']
            offset = address - bases[section]
            if offset < 0 or size < 4:
                continue
            mapping = [v for v in modes.get(symbol['st_shndx'], []) if v[0] <= address]
            thumb = bool(mapping and mapping[-1][1] == '$t')
            sources.append((symbol.name, section, address, raw[section][offset:offset+size], thumb))
    output = {}
    for game, path in [('B', WORKSPACE / 'cleanblack.nds'), ('W', Path.home() / 'Downloads/cleanroms/cleanwhite.nds')]:
        rom = ndspy.rom.NintendoDSRom.fromFile(str(path))
        assert rom.idCode == (b'IRBO' if game == 'B' else b'IRAO') and rom.version == 0
        overlays = rom.loadArm9Overlays([10, 21, 29])
        segments = {'main': (rom.arm9RamAddress, ndspy.codeCompression.decompress(rom.arm9)),
                    **{str(k): (v.ramAddress, bytes(v.data)) for k, v in overlays.items()}}
        rows = {}
        for name, section, address, code, thumb in sources:
            segment = {'main': 'main', 'cgear': '29', 'notwifi': '10', 'fieldmap': '21'}[section]
            hits = []
            for length in sorted({min(len(code), n) for n in [80, 48, 32, 24, 16, 12, 8, 4]}, reverse=True):
                hits = shared.find(code[:length], shared.masked(code[:length], address, thumb), {segment: segments[segment]}, thumb)
                if hits:
                    break
            key = f'{section}:{name}'
            rows[key] = {'reference': address, 'section': section, 'mode': 'Thumb' if thumb else 'ARM',
                         'size': len(code), 'candidates': hits, 'reviewed': False}
        output[game] = rows
        print(game, len(rows), 'functions;', sum(len(v['candidates']) == 1 for v in rows.values()), 'unique candidates')
    (HERE / 'build').mkdir(exist_ok=True)
    (HERE / 'build/bw1-reference-inventory.json').write_text(json.dumps(output, indent=2) + '\n')

if __name__ == '__main__':
    main()
