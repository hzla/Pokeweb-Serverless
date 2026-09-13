// Tag Battle Stabilization for US White 2 / IRDO.
// Originally verified with CascadeMarlonBuild.nds and its installed PMC hooks.
// PMC binds this module to overlay 167; all three hooks are call replacements.

using u32 = unsigned int;
using VM = void;

static VM *owner;

extern "C" VM *THUMB_BRANCH_LINK_167_0x21B1848(
    const void *battle, void *server, const void *pokemon, u32 flags, u32 heap)
{
    // Client creation precedes AI execution. Explicitly reset state even if
    // overlay 167, and therefore this module, remains loaded between battles.
    owner = nullptr;
    using Init = VM *(*)(const void *, void *, const void *, u32, u32);
    return reinterpret_cast<Init>(0x0217F641)(battle, server, pokemon, flags, heap);
}

extern "C" int THUMB_BRANCH_LINK_167_0x21B5B92(VM *vm)
{
    // Returning busy uses the client's normal wait state; it must not execute
    // this VM or acquire any script references while another VM owns the slot.
    if (owner != nullptr && owner != vm)
        return 1;

    owner = vm;
    using Main = int (*)(VM *);
    const int busy = reinterpret_cast<Main>(0x0217F6F1)(vm);
    // Preserve ownership across frame yields. The native completion path has
    // released its last script reference before returning false.
    if (!busy)
        owner = nullptr;
    return busy;
}

extern "C" void THUMB_BRANCH_LINK_167_0x21B18E8(VM *vm)
{
    using Exit = void (*)(VM *);
    reinterpret_cast<Exit>(0x0217F7C1)(vm);
    // Native client teardown destroys the shared script cache as well as the
    // VM. Clear only after that cleanup, including interrupted battles.
    owner = nullptr;
}
