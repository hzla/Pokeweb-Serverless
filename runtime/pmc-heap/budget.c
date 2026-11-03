#include <stdint.h>
/* Called before BW1 creates its two static game heaps. DSi uses its native
 * TWL table; the copied DS table is not selected there. No heap API calls. */
__attribute__((visibility("default"))) uint32_t PmcHeapBudget(uint32_t *specs, uint32_t lo, uint32_t hi) {
    if (hi > 0x02400000u) return 1;
    if (hi < 200u * 1024u || lo > hi - 200u * 1024u) return 0;
    uint32_t available = hi - 200u * 1024u - lo;
    uint32_t needed = specs[0] + specs[2] + 0x6000u;
    if (needed <= available) return 1;
    uint32_t cut = (needed - available + 31u) & ~31u;
    if (cut > 0x20000u || specs[2] < cut + 0x40000u) return 0;
    specs[2] -= cut;
    return 1;
}
