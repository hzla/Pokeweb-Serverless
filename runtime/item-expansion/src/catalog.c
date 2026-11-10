// Pokeweb item expansion: catalog queries. Retail IDs keep retail behaviour; IDs above it use the PWIC table.
#include "catalog.h"
#include "constants/bag.h"

// Retail tables in ARM9 (resolved through the ESDB).
extern const u8 sItemPockets[PW_NATIVE_LAST + 1];
extern const u32 DUMMY_ITEMS[];
extern const u32 UNHOLDABLE_ITEMS[];

__attribute__((used, section(".data.pwic"))) PwItemCatalog gPwItemCatalog = {
    .magic = PW_ITEM_CATALOG_MAGIC,
    .version = 1,
    .first = PW_NATIVE_LAST + 1,
    .count = PW_EXTRA_COUNT,
};

static const PwItemEntry *PwItem_Entry(u32 item) {
    if (item <= PW_NATIVE_LAST || item >= PW_ITEM_CAPACITY) {
        return NULL;
    }
    return &gPwItemCatalog.entries[item - (PW_NATIVE_LAST + 1)];
}

BOOL W2U_ItemIsAuthored(u32 item) {
    const PwItemEntry *entry;

    if (item == 0 || item >= PW_ITEM_CAPACITY) {
        return FALSE;
    }
    if (item <= PW_NATIVE_LAST) {
        return TRUE;
    }
    entry = PwItem_Entry(item);
    return (entry->flags & PW_ITEM_AUTHORED) != 0;
}

u32 W2U_ItemPocket(u32 item) {
    if (!W2U_ItemIsAuthored(item)) {
        return BAG_POCKET_NONE;
    }
    if (item <= PW_NATIVE_LAST) {
        return sItemPockets[item];
    }
    return PwItem_Entry(item)->pocket;
}

BOOL W2U_ItemCanHold(u32 item) {
    if (item <= PW_NATIVE_LAST) {
        return (UNHOLDABLE_ITEMS[item >> 5] & (1u << (item & 31))) == 0;
    }
    return W2U_ItemIsAuthored(item) && (PwItem_Entry(item)->flags & PW_ITEM_HOLDABLE) != 0;
}

BOOL W2U_ItemIsDummy(u32 item) {
    if (item <= PW_NATIVE_LAST) {
        return (DUMMY_ITEMS[item >> 5] & (1u << (item & 31))) != 0;
    }
    return !W2U_ItemIsAuthored(item);
}

u8 W2U_ItemBattlePockets(u32 item) {
    if (item <= PW_NATIVE_LAST || !W2U_ItemIsAuthored(item)) {
        return 0;
    }
    return PwItem_Entry(item)->battlePockets;
}
