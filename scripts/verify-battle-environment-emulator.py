"""Cold-boot a verify-battle-environment.ts fixture and check native selections.

Requires the melonDS Python API and MELONDS_HEADLESS_LIB. All inputs are copied
to a temporary directory; no startup input or emulator state is supplied.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import tempfile


def run(directory):
    from melonds import MelonDS
    manifest = json.loads((directory / 'test.json').read_text())
    source = directory / 'test.nds'
    save = directory / 'test.sav'
    assert hashlib.sha256(source.read_bytes()).hexdigest() == manifest['romSha256']
    assert hashlib.sha256(save.read_bytes()).hexdigest() == manifest['saveSha256']
    selection = manifest['selection']
    result = {'buttonsPressed': 0}
    errors, callbacks = [], []
    with tempfile.TemporaryDirectory(prefix='battle-environment-') as temporary:
        rom = Path(temporary) / 'test.nds'
        shutil.copyfile(source, rom)
        shutil.copyfile(save, rom.with_suffix('.sav'))
        emulator = MelonDS()
        def checked(callback):
            def invoke(cpu, address):
                try:
                    callback()
                except Exception as error:
                    errors.append(error)
            return invoke
        registers = emulator.memory.register_arm9
        def field():
            result['backgroundIndex'] = registers.r1
            assert registers.r1 == selection['backgroundIndex']
            result['backgroundFrame'] = emulator.frame_count
        def platform():
            result['platformIndex'] = registers.r1
            if selection.get('platformIndex') is not None:
                assert registers.r1 == selection['platformIndex']
        def resource():
            if registers.r0 == 11:
                resources = result.setdefault('resources', [])
                if registers.r1 not in resources:
                    resources.append(registers.r1)
        def reset():
            # The edited leaf function has written both outputs before bx lr.
            def vector(address):
                return [struct.unpack('<i', emulator.memory.read_long(address + i * 4).to_bytes(4, 'little'))[0] / 4096 for i in range(3)]
            result['camera'] = {'position': vector(registers.r0), 'target': vector(registers.r1)}
            for key in ('position', 'target'):
                assert result['camera'][key] == [selection['camera']['pose'][key][axis] for axis in ('x', 'y', 'z')]
        def command():
            if emulator.memory.read_long(registers.r1) == 0:
                result.setdefault('commandFrame', emulator.frame_count)
        def trainer():
            if registers.r1 == 167:
                setup = registers.r3
                data = emulator.memory.read_long(setup + 0x4c)
                result['trainerId'] = emulator.memory.read_long(data)
                assert result['trainerId'] == selection['trainerId']
        try:
            for address, callback in [(0x021de130, field), (0x021ddb0c, platform), (0x02049370, resource),
                                      (0x021deada, reset), (0x021cef18, command), (0x02016e38, trainer)]:
                callbacks.append(emulator.memory.register_exec(address, checked(callback)))
            emulator.open(rom)
            for _ in range(1800):
                emulator.cycle()
                if errors:
                    raise errors[0]
                if result.get('commandFrame') and emulator.frame_count >= result['commandFrame'] + 30:
                    break
            assert result.get('commandFrame'), 'Battle command menu was not reached'
            assert result.get('backgroundIndex') == selection['backgroundIndex']
            assert result.get('platformIndex') is not None
            assert manifest['backgroundResource'] in result.get('resources', [])
            if selection.get('platformIndex') is not None:
                assert manifest['platformResource'] in result.get('resources', [])
            assert result.get('camera'), 'Native camera reset was not observed'
            result['passed'] = True
        finally:
            emulator.screenshot().save(directory / 'environment-native.png')
            emulator.destroy()
            (directory / 'environment-native.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    run(parser.parse_args().directory)
