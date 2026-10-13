"""Exercise shipped evolution actor registration with form-specific PWAN data; no game frames."""
import hashlib
import importlib.util
from pathlib import Path
import struct
import subprocess
import tempfile

from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_LR, UC_ARM_REG_PC, UC_CPU_ARM_946

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('pwan_guard_verifier', HERE / 'verify.py')
guards = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guards)

# A base and a form intentionally coexist so falling back to the base is observable.
config = struct.pack('<4sHHII', b'PWNC', 3, 2, 192, 16)
config += struct.pack('<HBH', 503, 3 << 5, 503)
config += struct.pack('<HBH', 503, 1 | (3 << 5), 754)
asset = struct.pack('<4s6H6I', b'PWAN', 1, 96, 96, 4, 2, 2, 12, 4608, 16, 40, 72, 80)
asset += bytes(32) + struct.pack('<4H', 0, 6, 1, 6) + bytes(2 * 4608)

def check(game):
    name = f'PokewebPwanMisc{game}'
    shipped_bytes = (guards.APP / f'src/assets/codeinjection/{name}.dll').read_bytes()
    shipped = guards.read_rpm(shipped_bytes)
    with tempfile.TemporaryDirectory() as directory:
        debug = Path(directory) / f'{name}.dll'
        subprocess.run(['java', '-cp', str(guards.JAR), 'rpm.cli.RPMTool', '-i', str(guards.BUILD / f'{name}.elf'),
                        '--fourcc', 'DLXF', '-o', str(debug), '--esdb', str(guards.SOURCE / f'pmc/{"IREO" if game == "B2" else "IRDO"}.yml'),
                        '--generate-relocations'], check=True, stdout=subprocess.DEVNULL)
        module = guards.read_rpm(debug.read_bytes())
    assert module['code'] == shipped['code'] and module['bss'] == shipped['bss'], 'Diagnostic names do not match shipped code'
    functions = {symbol['name']: guards.BASE + symbol['address'] for symbol in module['symbols']
                 if symbol['type'] == 3 and not symbol['attributes'] & 6}
    register = next(address for name, address in functions.items() if 'evolution_anim' in name and 'RegisterActor' in name)
    read_member = next(address for name, address in functions.items() if 'pwan_archive' in name and 'ReadMemberRange' in name)
    pp_get = 0x0201ccf8 if game == 'B2' else 0x0201cd24
    actor, system, mcss, pokemon = 0x022c0000, 0x022d0000, 0x022d1000, 0x022d2000
    for form, expected in [(0, 503 * 2), (1, 754 * 2), (2, 0xffffffff)]:
        cpu = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
        cpu.ctl_set_cpu_model(UC_CPU_ARM_946)
        cpu.mem_map(0x02000000, 0x1000000)
        cpu.mem_write(guards.BASE, guards.load(shipped))

        def service(cpu, address, size, _):
            if address == pp_get:
                field = cpu.reg_read(UC_ARM_REG_R1)
                assert field in (5, 0x6f), f'Unexpected Pokemon field {field}'
                cpu.reg_write(UC_ARM_REG_R0, 503 if field == 5 else form)
            elif address == read_member:
                member, offset, dest, length = [cpu.reg_read(reg) for reg in guards.REGS]
                data = config if member == 0 else asset
                assert offset + length <= len(data), 'Runtime read exceeds the fixture member'
                cpu.mem_write(dest, data[offset:offset + length])
                cpu.reg_write(UC_ARM_REG_R0, 1)
            else:
                return
            cpu.reg_write(UC_ARM_REG_PC, cpu.reg_read(UC_ARM_REG_LR))

        cpu.hook_add(UC_HOOK_CODE, service)
        guards.call(cpu, register, actor, system, mcss, pokemon)
        active, pwan = struct.unpack('<II', cpu.mem_read(actor, 8))
        assigned = struct.unpack('<I', cpu.mem_read(actor + 28, 4))[0]
        assert active == 1 and assigned == expected and pwan == (form < 2), (game, form, assigned, pwan)
    print(f'{game}: shipped actor selects base 503, form 1 asset 754, and native fallback for unconfigured form 2; register/stack checks passed. SHA256 {hashlib.sha256(shipped_bytes).hexdigest()}')

if __name__ == '__main__':
    check('W2')
    check('B2')
