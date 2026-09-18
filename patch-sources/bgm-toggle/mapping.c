#include <stdint.h>

/* ABI 2: relative table offset keeps variable-length configuration relocatable.
 * Called only when the BGM ID changes or the game explicitly restarts music. */
uint32_t PokewebFindBgmStream(const void *config, uint32_t sequence)
{
    const uint16_t *header = config;
    const uint32_t *words = config;
    if (words[0] != 0x53424750 || header[2] != 2 || !(header[3] & 2)
        || header[7] != 10 || sequence >= 0xffff)
        return 0xffff;
    const uint16_t *entries = (const uint16_t *)((const uint8_t *)config + words[2]);
    uint32_t low = 0, high = header[6];
    while (low < high) {
        uint32_t mid = low + (high - low) / 2;
        const uint16_t *entry = entries + mid * 5;
        if (entry[0] == sequence) return entry[1];
        if (entry[0] < sequence) low = mid + 1;
        else high = mid;
    }
    return 0xffff;
}
