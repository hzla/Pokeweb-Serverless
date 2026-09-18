#include "stream_buffer.h"

typedef void (*DisposeCallback)(void *, uint32_t, uint32_t, uint32_t);
extern void *NNS_SndHeapAlloc(void *, uint32_t, DisposeCallback, void *, uint32_t);

/* Set only around our own stream initialization: title playback and a
 * toggle-only installation keep the native allocation policy. */
volatile uint32_t PokewebStreamSetupActive;

static uint32_t word(const void *p, uint32_t offset) {
    return *(const uint32_t *)((const uint8_t *)p + offset);
}

static uint32_t freeSoundBytes(const void *heap) {
    const void *frame = *(void *const *)heap;
    /* Verified US B2/W2 frame-heap layout and 32-byte sound-block header. */
    if (!frame || word(frame, 0) != 0x46524d48) return 0;
    uint32_t head = word(frame, 0x24);
    uint32_t tail = word(frame, 0x28);
    if (head > UINT32_MAX - 31) return 0;
    head = (head + 31) & ~31u;
    if (tail < head || tail - head < POKEWEB_SOUND_BLOCK_BYTES) return 0;
    return (tail - head - POKEWEB_SOUND_BLOCK_BYTES) & ~31u;
}

/* Called only at the verified SetupPlayer allocation site. The assembly
 * adapter also returns *sizeOut in that caller's live r6, so the native player
 * records the actual buffer capacity, including reuse and allocation failure. */
void *PokewebAllocStreamBuffer(void *heap, uint32_t bytes,
        DisposeCallback dispose, void *player, uint32_t data2, uint32_t *sizeOut) {
    *sizeOut = bytes;
    if (!PokewebStreamSetupActive || bytes != POKEWEB_STREAM_DEFAULT_BYTES)
        return NNS_SndHeapAlloc(heap, bytes, dispose, player, data2);

    void *existing = (void *)(uintptr_t)word(player, 0x134);
    uint32_t existingBytes = word(player, 0x138);
    if (existing && existingBytes >= bytes && !(existingBytes & 255)) {
        /* Native rollback clears these fields in its dispose callback. Reuse
         * the live allocation, not a patch-held pointer into an expired heap. */
        *sizeOut = existingBytes;
        return existing;
    }

    uint32_t selected = PokewebChooseStreamBuffer(freeSoundBytes(heap));
    void *result = NNS_SndHeapAlloc(heap, selected, dispose, player, data2);
    if (!result && selected != bytes) {
        selected = bytes;
        result = NNS_SndHeapAlloc(heap, selected, dispose, player, data2);
    }
    *sizeOut = selected;
    return result;
}
