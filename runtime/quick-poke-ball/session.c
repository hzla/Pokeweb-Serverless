#include "bindings.h"

typedef unsigned short u16;

extern void *BagCursor_Create(u16 heap);

u16 PokewebQuickBallChoice;

void *HOOK_NEW_SESSION(u16 heap) {
    PokewebQuickBallChoice = 0;
    return BagCursor_Create(heap);
}
