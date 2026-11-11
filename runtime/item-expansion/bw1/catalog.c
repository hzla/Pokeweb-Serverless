// Pokeweb item expansion for Black / White: the item catalog every Black / White DLL carries its own copy of.
//
// Retail IDs 1-626 always exist; their pockets come from the "PWIP" table. IDs 627-1023 exist once Pokeweb marks
// them authored in the "PWIC" table (an item with a name); anything else reads as no item.
#include "bw1_items.h"

__attribute__((used, section(".data.pwic"))) PwItemCatalog gPwItemCatalog = {
    .magic = PW_ITEM_CATALOG_MAGIC,
    .version = 1,
    .first = PW_NATIVE_LAST + 1,
    .count = PW_EXTRA_COUNT,
};

__attribute__((used, section(".data.pwip"))) PwItemPockets gPwItemPockets = {
    .magic = PW_ITEM_POCKETS_MAGIC,
    .version = 1,
    .count = PW_NATIVE_LAST + 1,
};

const PwItemEntry *PwItem_Entry(u32 item) {
    if (item <= PW_NATIVE_LAST || item >= PW_ITEM_CAPACITY) {
        return NULL;
    }
    return &gPwItemCatalog.entries[item - (PW_NATIVE_LAST + 1)];
}

BOOL PwItem_IsAuthored(u32 item) {
    if (item == 0 || item >= PW_ITEM_CAPACITY) {
        return FALSE;
    }
    if (item <= PW_NATIVE_LAST) {
        return TRUE;
    }
    return (PwItem_Entry(item)->flags & PW_ITEM_AUTHORED) != 0;
}

u32 PwItem_Pocket(u32 item) {
    if (!PwItem_IsAuthored(item)) {
        return BAG_POCKET_NONE;
    }
    if (item <= PW_NATIVE_LAST) {
        return gPwItemPockets.pockets[item];
    }
    return PwItem_Entry(item)->pocket;
}

// TMs and HMs stack to 1, everything else to 999 (retail: by pocket in AddItem).
u32 PwItem_MaxStack(u32 item) {
    return PwItem_Pocket(item) == BAG_POCKET_TMHM ? 1 : BAG_STACK_MAX;
}
