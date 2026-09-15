// These are deliberately separate, writable, volatile copies of the retired
// retail subsystems, NOT pointers into SAVE_CONTROL_WORK. Retail clients include
// direct pointer writers and memcpy-based trade rollback, not just setters.
// ARM9 relocations keep this small module resident across overlay transitions.
// The logger still obtains real blocks 29..31 via SaveControl_DataPtrGet.
// New-game initialization and normal save/checksum/copy paths are unchanged.
namespace {
struct RetiredWifiWork {
    unsigned char history[0x1338];
    unsigned char friends[0x7c4];
    unsigned char negotiation[0xd54];
};
static_assert(sizeof(RetiredWifiWork) == 10320,
    "Retired Wi-Fi workspaces must cover the complete retail structures");
RetiredWifiWork* work;

RetiredWifiWork* GetWork()
{
    if (!work) {
        // HEAPID_APP / HEAPID_USER (1) is the long-lived root application heap,
        // created before SAVE_CONTROL_WORK. Do not consume 10 KiB of PMC's
        // much smaller module heap or use a transient field/battle heap.
        using AllocFn = void* (*)(unsigned, unsigned);
        RetiredWifiWork* allocated = static_cast<RetiredWifiWork*>(
            reinterpret_cast<AllocFn>(GUARD_ALLOC_ADDRESS)(1, sizeof(RetiredWifiWork)));
        if (!allocated) return nullptr; // fail closed: NEVER return real save data
        unsigned char* bytes = reinterpret_cast<unsigned char*>(allocated);
        for (unsigned i = 0; i < sizeof(RetiredWifiWork); ++i) bytes[i] = 0;
        work = allocated;
    }
    return work;
}
}

extern "C" void* THUMB_BRANCH_SaveGuardHistory(void*) {
    RetiredWifiWork* p = GetWork(); return p ? p->history : nullptr;
}
extern "C" void* THUMB_BRANCH_SaveGuardFriends(void*) {
    RetiredWifiWork* p = GetWork(); return p ? p->friends : nullptr;
}
extern "C" void* THUMB_BRANCH_SaveGuardNegotiation(void*) {
    RetiredWifiWork* p = GetWork(); return p ? p->negotiation : nullptr;
}
