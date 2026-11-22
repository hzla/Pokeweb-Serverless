#include <stdint.h>

enum {
    ARM7_LOAD = 0x02380000,
    ARM7_IMAGE_SIZE = 0x28f84,
    // The second autoload's source follows the first 0x11414-byte source.
    ARM7_SECOND_SOURCE = 0x02380644 + 0x11414,
    NTR_MAIN_ARENA_HI = 0x02fffdc4,
    PXI_ARM7 = 1,
    PXI_FS = 11,
    PXI_OS = 12,
};

extern uint32_t pxi_ready(uint32_t tag, uint32_t processor);

uint32_t select_pmc_floor(const uint32_t *arena_hi, uint32_t arena_lo, const uint32_t *arm7_header) {
    uint32_t arm7_load = arm7_header[2];
    uint32_t arm7_size = arm7_header[3];
    uint32_t arm7_end = arm7_load + arm7_size;
    if (arena_lo >= arm7_end) return arena_lo;

    // The builder pins the ARM7 binary. This range supplied autoload data
    // for upper memory, and the ARM7 registers these callbacks after copying it.
    if ((uintptr_t)arena_hi == NTR_MAIN_ARENA_HI &&
        arm7_load == ARM7_LOAD && arm7_size == ARM7_IMAGE_SIZE &&
        arena_lo >= ARM7_SECOND_SOURCE && pxi_ready(PXI_OS, PXI_ARM7) && pxi_ready(PXI_FS, PXI_ARM7)) {
        return arena_lo;
    }
    return arm7_end;
}
