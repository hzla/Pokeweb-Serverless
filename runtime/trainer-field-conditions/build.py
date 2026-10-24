"""Build the US revision-0 Black 2 / White 2 trainer field conditions runtimes."""
from pathlib import Path
import os, subprocess, json, tempfile, argparse
from profiles import PROFILES, address as native_address, rom_path
import ndspy.rom, ndspy.codeCompression
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
WS = REPO.parent
BUILD = HERE / 'build'
ASSETS = REPO / 'src/assets/codeinjection'
TOOLS = Path(os.environ.get('ARM_TOOLCHAIN_BIN', WS / 'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
JAR = Path(os.environ.get('RPM_TOOL_JAR', WS / 'pw2-build-work/ctrmap/CTRMap.jar'))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--game', choices=PROFILES, action='append', help='Default: build both games')
games = parser.parse_args().game or list(PROFILES)
BUILD.mkdir(exist_ok=True)
def run(*args): subprocess.run([str(a) for a in args], check=True)
for game in games:
    profile_build = BUILD / game
    profile_build.mkdir(exist_ok=True)
    rom = ndspy.rom.NintendoDSRom.fromFile(rom_path(game))
    assert bytes(rom.idCode).decode() == PROFILES[game] and rom.version == 0
    arm = bytes(ndspy.codeCompression.decompress(rom.arm9))
    overlays = rom.loadArm9Overlays([167, 169])
    signatures = []
    def signature(label, module, address, size, patch=0):
        address = native_address(address, game)
        data, base = (arm, rom.arm9RamAddress) if module == 'ARM9' else (overlays[int(module)].data, overlays[int(module)].ramAddress)
        raw = bytes(data[address-base:address-base+size])
        assert len(raw) == size
        signatures.append(dict(label=label, module=module, address=address, expectedHex=raw.hex(), patchSize=patch))
        return raw
    # Pin the entire first-turn sequence: the hook must run before opening weather
    # and switch-in abilities, once only for the server, in every battle format.
    assert signature('Opening field-status call', '167', 0x0219f5da, 4, 4) == bytes.fromhex('fcf7e1fc')
    assert signature('Opening ability activation call', '167', 0x0219f688, 4, 4) == bytes.fromhex('01f02eff')
    signature('First-turn setup and entry order', '167', 0x0219f5c8, 0xd2)
    for label, module, address, size in [
        ('Field status accessor', '167', 0x0219bfa0, 6),
        ('Native animation queue', '167', 0x021b1474, 0x54),
        ('Native message queue', '167', 0x021b1610, 0x60),
        ('Native active position lookup', '167', 0x021abb90, 16),
        ('Native slot to position mapping', '167', 0x0219c638, 0x32),
        ('Native side classification', '167', 0x0219d35c, 16),
        ('Native entry ability activation', '167', 0x021a14e8, 16),
        ('Permanent condition', '167', 0x021ce240, 20),
        ('Timed condition', '167', 0x021ce1c0, 0x2c),
        ('Field effect API', '167', 0x021d5a34, 32),
        ('Weather query', '167', 0x021d59f0, 16),
        ('Weather change API', '167', 0x021a76a8, 40),
        ('Side effect API', '169', 0x06898c10, 0xb0),
        ('Field expiration', '167', 0x021d5de4, 0x6c),
        ('Side expiration', '169', 0x06898d54, 0x78),
    ]: signature(label, module, address, size)
    for address in [0x02070ca8, 0x02070ecc, 0x02070e6c, 0x02070dec, 0x02070e54, 0x02070de0]:
        signature('Native file service', 'ARM9', address, 12)
    obj = profile_build / 'runtime.o'
    run(TOOLS / 'arm-none-eabi-g++', '-std=c++17', '-mthumb', '-mcpu=arm946e-s', '-mlong-calls', '-Os', '-Wall', '-Wextra', '-Werror',
        '-fno-exceptions', '-fno-rtti', '-fno-unwind-tables', '-fno-asynchronous-unwind-tables', '-ffreestanding', '-fno-builtin',
        '-fvisibility=hidden', *(['-DGAME_BLACK2'] if game == 'B2' else []), '-c', HERE / 'runtime.cpp', '-o', obj)
    hook = profile_build / 'hook.o'
    assembly = (HERE / 'hook.s').read_text()
    for value in [0x0219f5da, 0x0219f688]:
        assembly = assembly.replace(f'0x{value:08x}', f'0x{native_address(value, game):08x}')
    hook_source = profile_build / 'hook.s'
    hook_source.write_text(assembly)
    run(TOOLS / 'arm-none-eabi-as', '-mthumb', '-mcpu=arm946e-s', hook_source, '-o', hook)
    elf = profile_build / f'TrainerFieldConditions{game}.elf'
    run(TOOLS / 'arm-none-eabi-g++', '-nostdlib', '-Wl,-r', obj, hook, '-o', elf)
    assert not subprocess.check_output([TOOLS / 'arm-none-eabi-nm', '-u', elf]).strip()
    meta = profile_build / 'metadata.yml'
    meta.write_text(f'PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: 0.1.1\n')
    esdb = profile_build / 'symbols.yml'
    esdb.write_text('Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\n  - ID: 167\n    Name: 167\n    Type: OVERLAY\nSymbols: []\n')
    filename = f'TrainerFieldConditions{game}.dll'
    with tempfile.TemporaryDirectory(dir=profile_build) as tmp:
        candidate = Path(tmp) / filename
        run('java', '-cp', JAR, 'rpm.cli.RPMTool', '-i', elf, '--fourcc', 'DLXF', '-o', candidate, '--esdb', esdb,
            '--meta', meta, '--generate-relocations', '--strip')
        raw = candidate.read_bytes()
        assert raw[:4] == b'DLXF'
        (ASSETS / filename).write_bytes(raw)
    # Inspect using the same parser as the app. Output includes code and relocations,
    # allowing installation to reject renamed, duplicate and conflicting modules.
    description = profile_build / 'runtime.json'
    run(REPO / 'node_modules/.bin/vite-node', HERE / 'inspect.ts', ASSETS / filename, description)
    manifest = dict(version='0.1.1', idCode=PROFILES[game], fileName=filename, hooks=[s for s in signatures if s['patchSize']],
                    signatures=signatures, **json.loads(description.read_text()))
    (ASSETS / ('trainerFieldConditionsManifest.json' if game == 'W2' else 'trainerFieldConditionsB2Manifest.json')).write_text(json.dumps(manifest, indent=2) + '\n')
    # Fixed-address image for CPU checks; the bundled DLL is separately validated.
    run(TOOLS / 'arm-none-eabi-g++', '-nostdlib', '-Wl,-Ttext=0x02300000,-e,TrainerFieldStart', obj, hook, '-o', profile_build / 'cpu.elf')
    print(filename, len(raw), 'bytes')
