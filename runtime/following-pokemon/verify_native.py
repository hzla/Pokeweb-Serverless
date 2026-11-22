"""Exercise native9's packaged body/shadow ownership and artwork cache on ARM946."""
import struct
import sys

import ndspy.rom
from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_WRITE
from unicorn.arm_const import UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_PC, UC_CPU_ARM_946
from verify_packaged import Uc, UC_ARCH_ARM, UC_MODE_THUMB, PACKAGE_BUILD, MODULE_SUFFIX, audit, relocate, load_dependencies

rom = ndspy.rom.NintendoDSRom.fromFile(sys.argv[1])
resources = bytes(rom.getFileByName("a/0/4/8"))
dll = PACKAGE_BUILD / f"PokewebFollowingField{MODULE_SUFFIX}.dll"
_, _, _, _, functions, _ = audit(dll, dll.with_suffix(".elf"))
assert "fwn_shadow_prepare" in functions
base, stop, stack = 0x02300000, 0x02008000, 0x023f0000
actor, system, camera = 0x02210000, 0x02211000, 0x02212000
field_billboard, body_system, body_scene, body_slots, body = [0x02213000 + i * 0x100 for i in range(5)]
shadow_system, shadow_scene, shadow_slots, shadow, task, handle = [0x02214000 + i * 0x200 for i in range(6)]
work = task + 24
vm = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
vm.ctl_set_cpu_model(UC_CPU_ARM_946)
vm.mem_map(0x02000000, 0x400000)
vm.mem_map(0x04000000, 0x10000)
vm.mem_write(base, bytes(relocate(dll, base, load_dependencies(vm))))
reads, opens, offset, fail_open = 0, 0, 0, False
submissions, gpu_writes = [], []


def put(address, value, fmt="I"):
    vm.mem_write(address, struct.pack("<" + fmt, value))


def word(address):
    return struct.unpack("<I", vm.mem_read(address, 4))[0]


def call(name, *arguments):
    for register, value in zip([UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3], list(arguments) + [0] * 4):
        vm.reg_write(register, value)
    for index, value in enumerate(arguments[4:]):
        put(stack + index * 4, value)
    vm.reg_write(UC_ARM_REG_SP, stack)
    vm.reg_write(UC_ARM_REG_LR, stop | 1)
    vm.emu_start((base + functions[name][0]) | 1, stop, count=2000000)
    assert vm.reg_read(UC_ARM_REG_PC) == stop
    assert vm.reg_read(UC_ARM_REG_SP) == stack
    return vm.reg_read(UC_ARM_REG_R0)


def service(cpu, pc, size, unused):
    global reads, opens, offset
    args = [cpu.reg_read(register) for register in [UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2]]
    result = 1
    if pc == 0x02070ca8:
        pass
    elif pc == 0x02070ecc:
        path = b"rom:/a/0/4/8\x00"
        assert bytes(cpu.mem_read(args[1], len(path))) == path
        opens += 1
        result = int(not fail_open)
    elif pc == 0x02070dec:
        result = len(resources)
    elif pc == 0x02070e54:
        offset = args[1]
    elif pc == 0x02070e6c:
        assert offset <= len(resources) and args[2] <= len(resources) - offset
        cpu.mem_write(args[1], resources[offset:offset + args[2]])
        offset += args[2]
        reads += 1
        result = args[2]
    elif pc == 0x02070de0:
        pass
    elif pc == 0x02167240:
        result = 0
    elif pc == 0x0204f684:
        assert cpu.reg_read(UC_ARM_REG_SP) % 8 == 0
        submissions.append((args, bytes(cpu.mem_read(body, 28)), bytes(cpu.mem_read(shadow, 28))))
    else:
        return
    cpu.reg_write(UC_ARM_REG_R0, result)
    cpu.reg_write(UC_ARM_REG_PC, cpu.reg_read(UC_ARM_REG_LR))


vm.hook_add(UC_HOOK_CODE, service)
vm.hook_add(UC_HOOK_MEM_WRITE, lambda cpu, access, address, size, value, unused: gpu_writes.append((address, value)), begin=0x04000400, end=0x04000600)
put(actor, 1)
put(actor + 8, 7, "H")
put(actor + 10, 42, "H")
put(actor + 12, 0x3000, "H")
put(actor + 136, system)
put(system + 40, field_billboard)
put(field_billboard + 4, body_system)
for owner, scene, slots, billboard in [(body_system, body_scene, body_slots, body), (shadow_system, shadow_scene, shadow_slots, shadow)]:
    put(owner + 4, scene)
    put(owner + 24, slots)
    put(owner + 28, 1, "H")
    put(scene + 8, billboard)
    put(scene + 12, 2, "H")
    put(scene + 14, 1, "H")
put(body, 1, "H")
put(body + 18, 8192, "h")
put(body + 20, 8192, "h")
put(shadow, 0xc001, "H")
put(shadow + 18, 4096, "h")
put(shadow + 20, 4096, "h")
put(shadow + 24, 512, "H")
put(shadow_slots + 36, work)
put(task, 1)
for at, callback in [(188, 0x021a3c61), (196, 0x021a3d15), (200, 0x021a3d69)]:
    put(task + at, callback)
put(work + 4, handle)
put(work + 8, actor)
for at, identity in [(12, 7), (14, 0x3000), (16, 42)]:
    put(work + at, identity, "H")
put(handle + 16, shadow_system)
put(handle + 20, shadow_scene)

# Native file input is bounded, cached for a selected appearance, and retried
# after an identity change or explicit reset. Unsupported images retain fallback.
call("fwn_shadow_reset")
call("fwn_shadow_prepare", actor)
first_reads, first_opens = reads, opens
call("fwn_shadow_prepare", actor)
assert reads == first_reads and opens == first_opens == 1
put(actor + 12, 0x3001, "H")
call("fwn_shadow_prepare", actor)
assert opens == 2
put(actor + 12, 0x3000, "H")
call("fwn_shadow_reset")
fail_open = True
call("fwn_shadow_prepare", actor)
fail_open = False
assert opens == 3

checks = 0
for eye in [(0, 800000, 600000), (600000, 800000, 0), (-600000, 800000, 400000)]:
    vm.mem_write(camera + 32, struct.pack("<3i", *eye))
    for sprite_y in [0, 5, -5]:
        for bob in [0, 6144]:
            vm.mem_write(body + 4, struct.pack("<3i", 65536, bob, 131072))
            vm.mem_write(shadow + 4, struct.pack("<3i", 60000, -1024, 125000))
            before = [bytes(vm.mem_read(address, length)) for address, length in [(actor, 256), (body, 28), (shadow, 28), (task, 224)]]
            call("fwn_draw", body_system, camera, 0, actor, sprite_y & 0xffffffff)
            assert submissions[-1][0] == [body_system, camera, 0]
            call("fwn_shadow_draw", shadow_system, camera, 0, actor)
            assert submissions[-1][0] == [shadow_system, camera, 0]
            shown = submissions[-1][2]
            assert struct.unpack_from("<3i", shown, 4) == (65536, -1024, 131072)
            assert shown[:4] == before[2][:4] and shown[16:] == before[2][16:]
            assert before == [bytes(vm.mem_read(address, length)) for address, length in [(actor, 256), (body, 28), (shadow, 28), (task, 224)]]
            assert not gpu_writes
            checks += 1

for address, value, fmt in [(work + 8, 0, "I"), (work + 12, 8, "H"), (work + 14, 0x3002, "H"), (work + 16, 43, "H"), (work + 20, 1, "I"), (task + 188, 0, "I")]:
    original = bytes(vm.mem_read(address, struct.calcsize(fmt)))
    put(address, value, fmt)
    native = bytes(vm.mem_read(shadow, 28))
    call("fwn_shadow_draw", shadow_system, camera, 0, actor)
    assert submissions[-1][2] == native
    vm.mem_write(address, original)
    checks += 1

print(f"{MODULE_SUFFIX}: {checks} packaged native body/shadow ownership, terrain height, restore and cache cases passed; native draw and filesystem services isolated.")
