/* Host-only allocator tests. No ROM or emulator is run. */
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "stream_buffer.c"

static uint32_t frame[12], player[0x17c / 4];
static struct { void *frame; } heap;
static unsigned calls, failLarge, failAll;
static uint32_t sizes[8], seenData;
static void *seenHeap, *seenPlayer;
static DisposeCallback seenDispose;

static void dispose(void *p, uint32_t size, uint32_t a, uint32_t b) {
    (void)p; (void)size; (void)a; (void)b;
}

void *NNS_SndHeapAlloc(void *h, uint32_t size, DisposeCallback cb, void *p, uint32_t data) {
    assert(calls < 8);
    sizes[calls++] = size;
    seenHeap = h; seenPlayer = p; seenDispose = cb; seenData = data;
    if (failAll || (failLarge && size > 4096)) return NULL;
    return (void *)(uintptr_t)0x02100000;
}

static void reset(uint32_t freeBytes) {
    memset(frame, 0, sizeof frame); memset(player, 0, sizeof player);
    frame[0] = 0x46524d48;
    frame[0x24 / 4] = 0x02010000;
    frame[0x28 / 4] = frame[0x24 / 4] + freeBytes + 32;
    heap.frame = frame;
    calls = failLarge = failAll = 0;
    PokewebStreamSetupActive = 1;
}

static void *allocate(uint32_t *size) {
    return PokewebAllocStreamBuffer(&heap, 4096, dispose, player, 0x12345678, size);
}

int main(void) {
    uint32_t size;
    const uint32_t threshold = 32768 + 8192 + 32;
    assert(PokewebChooseStreamBuffer(threshold) == 32768);
    assert(PokewebChooseStreamBuffer(threshold - 1) == 4096);
    assert(PokewebChooseStreamBuffer(0) == 4096);
    assert(PokewebChooseStreamBuffer(UINT32_MAX) == 32768);

    reset(threshold); assert(allocate(&size)); assert(size == 32768 && sizes[0] == size);
    assert(seenHeap == &heap && seenPlayer == player && seenDispose == dispose && seenData == 0x12345678);
    assert(freeSoundBytes(&heap) - size - 32 >= 8192);
    reset(threshold - 32); assert(allocate(&size)); assert(size == 4096 && calls == 1);
    reset(44320); assert(allocate(&size)); assert(size == 32768); // recorded tight battle-state budget
    reset(47200); assert(allocate(&size)); assert(size == 32768);

    reset(100000); PokewebStreamSetupActive = 0;
    assert(allocate(&size)); assert(size == 4096); // title/toggle-only unchanged
    reset(100000);
    assert(PokewebAllocStreamBuffer(&heap, 8192, dispose, player, 9, &size));
    assert(size == 8192 && sizes[0] == 8192 && seenData == 9); // other channel layouts unchanged

    reset(100000); failLarge = 1;
    assert(allocate(&size)); assert(size == 4096 && calls == 2 && sizes[0] == 32768 && sizes[1] == 4096);
    reset(100000); failAll = 1;
    assert(!allocate(&size)); assert(size == 4096 && calls == 2);

    reset(0); player[0x134 / 4] = 0x02101000; player[0x138 / 4] = 32768;
    assert(allocate(&size) == (void *)(uintptr_t)0x02101000 && size == 32768 && calls == 0);
    assert(allocate(&size) == (void *)(uintptr_t)0x02101000 && calls == 0); // no restart leak
    player[0x138 / 4] = 4096;
    assert(allocate(&size) == (void *)(uintptr_t)0x02101000 && size == 4096 && calls == 0);
    // Native rollback clears the player; never reuse a stale patch-held pointer.
    player[0x134 / 4] = player[0x138 / 4] = 0;
    assert(allocate(&size)); assert(size == 4096 && calls == 1);

    reset(100000); frame[0] = 0;
    assert(allocate(&size)); assert(size == 4096);
    reset(100000); frame[0x28 / 4] = frame[0x24 / 4] - 1;
    assert(allocate(&size)); assert(size == 4096);
    reset(100000); frame[0x24 / 4] = UINT32_MAX;
    assert(allocate(&size)); assert(size == 4096);
    reset(100000); heap.frame = NULL;
    assert(allocate(&size)); assert(size == 4096);
    puts("Stream buffer host tests passed: capacity, reserve, fallback, reuse, rollback, ownership, bypass, malformed heap.");
}
