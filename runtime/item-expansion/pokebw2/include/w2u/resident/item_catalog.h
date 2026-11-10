#ifndef W2U_RESIDENT_ITEM_CATALOG_H
#define W2U_RESIDENT_ITEM_CATALOG_H

#include "types.h"

#define W2U_ITEM_CAPACITY 1024
#define W2U_ITEM_MAX (W2U_ITEM_CAPACITY - 1)

BOOL W2U_ItemIsAuthored(u32 item);
u32 W2U_ItemPocket(u32 item);
BOOL W2U_ItemCanHold(u32 item);
BOOL W2U_ItemIsDummy(u32 item);
// Returns a safe native item alias, preserving its character/palette pair.
u32 W2U_ItemIcon(u32 item);
u8 W2U_ItemBattlePockets(u32 item);
u16 W2U_ItemSortRank(u32 item);

#endif // W2U_RESIDENT_ITEM_CATALOG_H
