// Pokeweb item expansion: the bounded item catalog every item-expansion DLL carries its own copy of.
//
// Retail items (1..PW_NATIVE_LAST) keep their retail classification (pocket table, holdable and dummy bitsets,
// icon table). Items PW_NATIVE_LAST+1..1023 are described by the "PWIC" table, which Pokeweb fills in when it
// installs the patch. An item without the AUTHORED flag does not exist: it reads as item 0 everywhere.
#ifndef POKEWEB_ITEM_EXPANSION_CATALOG_H
#define POKEWEB_ITEM_EXPANSION_CATALOG_H

#include "types.h"

#define PW_ITEM_CAPACITY 1024
#define PW_NATIVE_LAST 638
#define PW_EXTRA_COUNT (PW_ITEM_CAPACITY - PW_NATIVE_LAST - 1)

#define PW_ITEM_AUTHORED 1
#define PW_ITEM_HOLDABLE 2

typedef struct {
    u16 iconChar;     // member of the item icon archive (ITEM_FILE_ICON_CHAR)
    u16 iconPalette;  // member of the item icon archive (ITEM_FILE_ICON_PLTT)
    u8 pocket;        // BAG_POCKET_*
    u8 flags;         // PW_ITEM_*
    u8 battlePockets; // bits as in archive 228
    u8 reserved;
} PwItemEntry;

typedef struct {
    u32 magic;   // "PWIC"
    u16 version; // 1
    u16 first;   // PW_NATIVE_LAST + 1
    u16 count;   // PW_EXTRA_COUNT
    u16 reserved;
    PwItemEntry entries[PW_EXTRA_COUNT];
} PwItemCatalog;

#define PW_ITEM_CATALOG_MAGIC 0x43495750 // "PWIC"

extern PwItemCatalog gPwItemCatalog;

// The pokebw2 catalog API the vendored code calls.
BOOL W2U_ItemIsAuthored(u32 item);
u32 W2U_ItemPocket(u32 item);
BOOL W2U_ItemCanHold(u32 item);
BOOL W2U_ItemIsDummy(u32 item);
u8 W2U_ItemBattlePockets(u32 item);
u16 W2U_ItemSortRank(u32 item);

#endif
