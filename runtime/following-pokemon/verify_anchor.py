"""Execute the packaged follower directional anchor for the selected profile."""
import struct
from verify_packaged import *

field = PACKAGE_BUILD / f'PokewebFollowingField{MODULE_SUFFIX}.dll'
elf = PACKAGE_BUILD / f'PokewebFollowingField{MODULE_SUFFIX}.elf'
_, _, _, _, funcs, _ = audit(field, elf)
base, actor, stop, stack = 0x02300000, 0x02220000, 0x02008000, 0x023f0000
uc = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
uc.ctl_set_cpu_model(UC_CPU_ARM_946)
uc.mem_map(0x02000000, 0x400000)
uc.mem_write(base, bytes(relocate(field, base, load_dependencies(uc))))
target = (base + funcs['fwr_anchor'][0]) | 1

def call(face, descriptor_z=3):
    original = bytearray(256)
    original[243] = descriptor_z & 255
    original[128] = descriptor_z & 255
    uc.mem_write(actor, bytes(original))
    uc.reg_write(UC_ARM_REG_R0, actor)
    uc.reg_write(UC_ARM_REG_R1, face)
    uc.reg_write(UC_ARM_REG_SP, stack)
    uc.reg_write(UC_ARM_REG_LR, stop | 1)
    for i, reg in enumerate(range(UC_ARM_REG_R4, UC_ARM_REG_R11 + 1)):
        uc.reg_write(reg, 0x12340000 + i)
    uc.emu_start(target, stop, count=10000)
    assert uc.reg_read(UC_ARM_REG_PC) == stop
    assert uc.reg_read(UC_ARM_REG_SP) == stack
    for i, reg in enumerate(range(UC_ARM_REG_R4, UC_ARM_REG_R11 + 1)):
        assert uc.reg_read(reg) == 0x12340000 + i
    after = bytearray(uc.mem_read(actor, 256))
    assert after[:128] == original[:128] and after[129:] == original[129:]
    return struct.unpack('b', after[128:129])[0]

for face, expected in ((0, -4), (1, 9), (2, 3), (3, 3), (4, 3)):
    assert call(face) == expected, (MODULE_SUFFIX, face)
assert call(0, -128) == -128  # Out-of-range adjustment leaves the byte intact.
assert call(1, 127) == 127

world, player, pose = actor + 256, actor + 288, actor + 320
player_draw, camera, output, result = actor + 352, actor + 384, actor + 416, actor + 448
depth_target = (base + funcs['fwr_correct'][0]) | 1

def depth(face_flags, xyz, height=0):
    uc.mem_write(world, struct.pack('<3i', 0, height, 65536))
    uc.mem_write(player, bytes(12))
    uc.mem_write(pose, struct.pack('<5i', *xyz, 8192, 8192))
    uc.mem_write(player_draw, bytes(12))
    uc.mem_write(camera, struct.pack('<7i', 0, 760739, 581835, 0, 0, 0, 0))
    uc.mem_write(output, bytes(20))
    uc.mem_write(result, bytes(24))
    for reg, value in zip((UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3),
                          (world, player, pose, player_draw)):
        uc.reg_write(reg, value)
    uc.reg_write(UC_ARM_REG_SP, stack)
    uc.reg_write(UC_ARM_REG_LR, stop | 1)
    uc.mem_write(stack, struct.pack('<4I', camera, face_flags, output, result))
    for i, reg in enumerate(range(UC_ARM_REG_R4, UC_ARM_REG_R11 + 1)):
        uc.reg_write(reg, 0x12340000 + i)
    uc.emu_start(depth_target, stop, count=1000000)
    assert uc.reg_read(UC_ARM_REG_PC) == stop and uc.reg_read(UC_ARM_REG_SP) == stack
    for i, reg in enumerate(range(UC_ARM_REG_R4, UC_ARM_REG_R11 + 1)):
        assert uc.reg_read(reg) == 0x12340000 + i
    return uc.reg_read(UC_ARM_REG_R0), struct.unpack('<6i', uc.mem_read(result, 24))

_, old = depth(0, (0, -6 * 4096, 65536 - 2 * 4096))
applied, north = depth(2, (0, -8 * 4096, 65536 - 9 * 4096))
assert applied == 1 and north[5] == 1
assert old[3] <= north[4] < old[3] + 128, (MODULE_SUFFIX, old, north)
_, lateral = depth(0, (0, -8 * 4096, 65536 - 9 * 4096))
assert lateral[4] < north[4]
_, stair = depth(3, (0, -8 * 4096, 65536 - 9 * 4096), 65536)
_, prior_stair = depth(1, (0, -8 * 4096, 65536 - 9 * 4096), 65536)
assert (stair[4], stair[5]) == (prior_stair[4], prior_stair[5])
print(f'{MODULE_SUFFIX}: packaged directional anchors, north foreground depth and unchanged stair policy passed; no game emulator run.')
