#include <cassert>
#include <cstring>

alignas(4) static unsigned char applicationMemory[10320];
static unsigned allocations;
static bool failAllocation;
static void* Allocate(unsigned heap, unsigned size) {
    assert(heap == 1 && size == sizeof(applicationMemory));
    ++allocations;
    return failAllocation ? nullptr : applicationMemory;
}
#define GUARD_ALLOC_ADDRESS (&Allocate)
#include "../src/battle_log/w2u_battle_log_save_guard.cpp"

int main() {
    unsigned char realSave[10320];
    memset(realSave, 0x55, sizeof(realSave));
    memset(applicationMemory, 0xff, sizeof(applicationMemory));
    auto* h = static_cast<unsigned char*>(THUMB_BRANCH_SaveGuardHistory(realSave));
    auto* f = static_cast<unsigned char*>(THUMB_BRANCH_SaveGuardFriends(realSave));
    auto* n = static_cast<unsigned char*>(THUMB_BRANCH_SaveGuardNegotiation(realSave));
    assert(h == applicationMemory && f == h + 0x1338 && n == f + 0x7c4);
    assert(allocations == 1);
    for (unsigned char byte : applicationMemory) assert(byte == 0);
    // Cover all offsets a stock setter, pointer writer, or trade rollback can
    // touch, not just the Geonet bitmap. None may alias any real save byte.
    memset(h, 0x55, 0x1338);
    memset(f, 0xaa, 0x7c4);
    memset(n, 0xff, 0xd54);
    // Exact daily WIFIHISTORY_Update transformation.
    for (unsigned i = 0x348; i < 0x1338; ++i) {
        for (unsigned bit = 0; bit < 8; bit += 2) {
            if (((h[i] >> bit) & 3) == 1) h[i] = (h[i] & ~(3 << bit)) | (2 << bit);
        }
        assert(h[i] == 0xaa);
    }
    for (unsigned char byte : realSave) assert(byte == 0x55);
    assert(THUMB_BRANCH_SaveGuardHistory(nullptr) == h && allocations == 1);
    // No dangerous fallback to the caller's real SAVE_CONTROL_WORK on OOM.
    work = nullptr;
    failAllocation = true;
    assert(THUMB_BRANCH_SaveGuardHistory(realSave) == nullptr);
    assert(THUMB_BRANCH_SaveGuardFriends(realSave) == nullptr);
    assert(THUMB_BRANCH_SaveGuardNegotiation(realSave) == nullptr);
    for (unsigned char byte : realSave) assert(byte == 0x55);
}
