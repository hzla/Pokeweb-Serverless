#ifndef POKEBW2_SAVE_BAG_H
#define POKEBW2_SAVE_BAG_H

#include "types.h"
#include "constants/bag.h"
#include "gfl/heap.h"
#include "struct_decls.h"
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
#include "w2u/resident/item_catalog.h"
#define BAG_POOL_SLOTS 1023
#define BAG_POOL_VERSION 2
#endif

// An item and its count in a pocket (swan's BagItem)
struct BagItem {
    u16 item;
    u16 count;
};

// The slots of each pocket, and of the Free Space, which shows the slots of all of them
#define BAG_ITEMS_MAX 310
#define BAG_KEY_ITEMS_MAX 83
#define BAG_TMS_HMS_MAX 109
#define BAG_MEDICINE_MAX 48
#define BAG_BERRIES_MAX 64
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
#define BAG_FREE_SPACE_MAX BAG_POOL_SLOTS
#else
#define BAG_FREE_SPACE_MAX (BAG_ITEMS_MAX + BAG_KEY_ITEMS_MAX + BAG_TMS_HMS_MAX + BAG_MEDICINE_MAX + BAG_BERRIES_MAX)
#endif

// How many of an item a slot holds
#define BAG_ITEM_COUNT_MAX 999
#define BAG_TM_HM_COUNT_MAX 1

#define BATTLE_BAG_POCKET_COUNT 4

// The bag's save block (swan's BagSave)
struct BagSave {
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
    u32 version;
    BagItem slots[BAG_POOL_SLOTS];
    u32 freeSpace[32];
#else
    BagItem items[BAG_ITEMS_MAX];        // 0x000
    BagItem keyItems[BAG_KEY_ITEMS_MAX]; // 0x4d8
    BagItem tmsHms[BAG_TMS_HMS_MAX];     // 0x624
    BagItem medicine[BAG_MEDICINE_MAX];  // 0x7d8
    BagItem berries[BAG_BERRIES_MAX];    // 0x898
    // A bit for each item that the player moved to the Free Space
    u32 freeSpace[21]; // 0x998
#endif
}; // Native: 0x9ec. Expanded White 2: 0x1080.

// The cursor memory of the bag and of the battle bag, which is not saved
typedef struct BagCursor {
    s16 scrolls[BAG_POCKET_NONE]; // 0x00
    s16 rows[BAG_POCKET_NONE];    // 0x0c
    // The pocket the bag opens on
    u16 pocket;         // 0x18
    u8 freeSpaceFilter; // 0x1a
    u16 unk1C;
    s16 battlePages[BATTLE_BAG_POCKET_COUNT]; // 0x1e
    s16 battleRows[BATTLE_BAG_POCKET_COUNT];  // 0x26
    u16 battleLastItem;                       // 0x2e
    u16 battleLastPocket;                     // 0x30
} BagCursor;                                  // 0x32

u32 BagSave_GetBlockSize(void);
BOOL BagSave_AddItem(BagSave *bag, u16 item, u16 count, u32 heapId);
// BagSave_AddItem, putting the item first in its pocket
BOOL BagSave_AddItemAsFirst(BagSave *bag, u32 item, u32 count, u32 heapId);
// Whether count of an item fit in the bag
BOOL BagSave_CheckAvailItemSpace(BagSave *bag, u16 item, u16 count, HeapID heapId);
// The pocket an item goes in
u32 BagSave_GetActualItemPocket(BagSave *bag, u16 item);
u16 BagSave_GetItemCountByID(BagSave *bag, u16 item, HeapID heapId);
// Whether the bag holds at least count of an item
BOOL BagSave_CheckAmount(BagSave *bag, u32 item, u32 count, u32 heapId);
BOOL BagSave_SubItem(BagSave *bag, u16 item, u16 count, HeapID heapId);
void BagSave_Init(BagSave *bag);
// Replaces the DNA Splicers that fuse (0) with those that separate, or those that separate (1) with those that fuse
void BagSave_SwitchOwnedDNASplicers(BagSave *bag, u32 from);
// The bag's cursor in each pocket, the pocket the bag opens on and the Free Space's filter, in the cursor that
// GameData_GetBagCursor returns
void BagCursor_GetPocketPosition(BagCursor *cursor, u16 pocket, s16 *row, s16 *scroll);
u16 BagCursor_GetPocket(BagCursor *cursor);
void BagCursor_SetPocketPosition(BagCursor *cursor, u16 pocket, s16 row, s16 scroll);
void BagCursor_SetPocket(BagCursor *cursor, u16 pocket);
// The battle bag's cursor memory, in the same cursor (allocated here): the row and page of a pocket, and the last used
// item and its pocket
BagCursor *BagCursor_Create(HeapID heapId);
void BagCursor_GetBattlePocketPosition(BagCursor *cursor, u16 pocket, s16 *row, s16 *page);
u16 BagCursor_GetBattleLastItem(BagCursor *cursor);
u16 BagCursor_GetBattleLastPocket(BagCursor *cursor);
void BagCursor_SetBattlePositions(BagCursor *cursor, s16 *rows, s16 *pages);
void BagCursor_SetBattleLastItem(BagCursor *cursor, u16 item, u8 pocket);
// The Free Space's filter
u8 BagCursor_GetFreeSpaceFilter(BagCursor *cursor);
void BagCursor_SetFreeSpaceFilter(BagCursor *cursor, u32 filter);
// The bag's Free Space and item slots. Function names from swan, except BagSave_GetOwnedItemFlags and
// BagSave_GetPocketItems Whether an item's Free Space bit is set
BOOL BagSave_IsItemFreeSpaceBit(BagSave *bag, u16 item);
// Whether an item is in the Free Space and in the bag
BOOL BagSave_IsItemInFreeSpace(BagSave *bag, u16 item);
// Sets or clears an item's Free Space bit
void BagSave_MoveBetweenFreeSpace(BagSave *bag, u16 item, BOOL toFreeSpace);
// The pocket that holds an item, or BAG_POCKET_NONE
u32 BagSave_GetExistingItemPocket(BagSave *bag, u16 item);
s32 BagSave_GetPocketItemCount(BagSave *bag, u32 pocket);
// Moves an item to the end of its pocket
void BagSave_ForceItemAsLast(BagSave *bag, u16 item);
// The slot at an index of a pocket, or NULL past its end
BagItem *BagSave_GetItemIndexHandle(BagSave *bag, u32 pocket, u16 index);
// An item's slot in a pocket, or NULL
BagItem *BagSave_GetItemHandle(BagSave *bag, u16 pocket, u16 item);
// The number of slots that hold an item
u32 BagSave_GetUniqueItemCount(BagItem *items, u32 max);
// Sorts the bag's pockets
void sortItemBlocks(BagSave *bag);
void BagSave_CopyPocketRaw(BagSave *bag, BagItem *items, u32 pocket, BOOL load);
// The items of a pocket, with or without those in the Free Space
s32 BagSave_GetPocketItemCountCore(BagSave *bag, u32 pocket, BOOL withFreeSpace);
// How many of an item the bag holds, 0 if its pocket doesn't hold it
u32 BagSave_GetExistingItemCount(BagSave *bag, u16 item);
// Copies a pocket into items, leaving out the items in the Free Space, or back into the pocket
void BagSave_CopyPocket(BagSave *bag, BagItem *items, u32 pocket, BOOL load);
// Sets owned-item flags: W2U_ITEM_CAPACITY bytes in expanded White 2, ITEM_LAST + 1 otherwise.
void BagSave_GetOwnedItemFlags(BagSave *bag, u8 *inBag);
// A pocket's slots and their number
BagItem *BagSave_GetPocketItems(BagSave *bag, u32 pocket, u32 *max);

#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
// Pool handles are borrowed until the next inventory insertion, removal or reorder.
BOOL W2U_BagValidate(const BagSave *bag);
#endif

#endif // POKEBW2_SAVE_BAG_H
