// The per-game bindings select the native call sites and their Thumb targets.
// All three PMC hooks replace calls in the battle client overlay.

using u32 = unsigned int;
using VM = void;

static VM *owner;

extern "C" VM *TAG_AI_INIT_HOOK(
    const void *battle, void *server, const void *pokemon, u32 flags, u32 heap)
{
    // Client creation precedes AI execution. Explicitly reset state even if
    // the battle overlay, and therefore this module, remains loaded.
    owner = nullptr;
    using Init = VM *(*)(const void *, void *, const void *, u32, u32);
    return reinterpret_cast<Init>(TAG_AI_INIT)(battle, server, pokemon, flags, heap);
}

extern "C" int TAG_AI_THINK_HOOK(VM *vm)
{
    // Returning busy uses the client's normal wait state; it must not execute
    // this VM or acquire any script references while another VM owns the slot.
    if (owner != nullptr && owner != vm)
        return 1;

    owner = vm;
    using Main = int (*)(VM *);
    const int busy = reinterpret_cast<Main>(TAG_AI_THINK)(vm);
    // Preserve ownership across frame yields. The native completion path has
    // released its last script reference before returning false.
    if (!busy)
        owner = nullptr;
    return busy;
}

extern "C" void TAG_AI_EXIT_HOOK(VM *vm)
{
    using Exit = void (*)(VM *);
    reinterpret_cast<Exit>(TAG_AI_EXIT)(vm);
    // Native client teardown destroys the shared script cache as well as the
    // VM. Clear only after that cleanup, including interrupted battles.
    owner = nullptr;
}
