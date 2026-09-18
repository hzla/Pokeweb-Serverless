#ifndef POKEWEB_STREAM_BUFFER_H
#define POKEWEB_STREAM_BUFFER_H
#include <stdint.h>

enum {
    POKEWEB_STREAM_DEFAULT_BYTES = 0x1000,
    POKEWEB_STREAM_BUFFER_BYTES = 0x8000,
    POKEWEB_STREAM_RESERVE_BYTES = 0x2000,
    POKEWEB_SOUND_BLOCK_BYTES = 32,
};

/* Free bytes are the native allocator's aligned payload capacity. Leave room
 * for both the reserve and the next allocation's bookkeeping. */
static inline uint32_t PokewebChooseStreamBuffer(uint32_t freeBytes) {
    return freeBytes >= POKEWEB_STREAM_BUFFER_BYTES + POKEWEB_STREAM_RESERVE_BYTES + POKEWEB_SOUND_BLOCK_BYTES
        ? POKEWEB_STREAM_BUFFER_BYTES : POKEWEB_STREAM_DEFAULT_BYTES;
}

#endif
