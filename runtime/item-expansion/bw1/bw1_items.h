// Pokeweb item expansion for Black / White: shared declarations of the Black / White runtime.
//
// Retail names are aletheia's (the Black / White decomp); build.py resolves them to absolute addresses per game.
#ifndef POKEWEB_ITEMS_BW1_H
#define POKEWEB_ITEMS_BW1_H

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef signed short s16;
typedef signed int s32;
typedef int BOOL;
#define TRUE 1
#define FALSE 0
#define NULL ((void *)0)

#define PW_ITEM_CAPACITY 1024
#define PW_NATIVE_LAST 626
#define PW_EXTRA_COUNT (PW_ITEM_CAPACITY - PW_NATIVE_LAST - 1)

#define BAG_POCKET_ITEMS 0
#define BAG_POCKET_MEDICINE 1
#define BAG_POCKET_TMHM 2
#define BAG_POCKET_BERRIES 3
#define BAG_POCKET_KEY_ITEMS 4
#define BAG_POCKET_COUNT 5
#define BAG_POCKET_NONE 0xff
#define BAG_STACK_MAX 999

// One bag slot, as retail.
typedef struct BagSlot {
    u16 itemId;
    u16 quantity;
} BagSlot;

// The bag save block (block 25): a version word and one pool of 1,023 slots, grouped by pocket in pocket order,
// every used slot before every empty one. 0x1000 bytes (retail: five fixed pockets, 0x9c0 bytes).
#define BAG_POOL_SLOTS 1023
#define BAG_POOL_VERSION 0x31425750u // "PWB1"
typedef struct MyItem {
    u32 version;
    BagSlot slots[BAG_POOL_SLOTS];
} MyItem;

// Catalog of item IDs 627-1023, filled in by Pokeweb ("PWIC", the same layout as Black 2 / White 2's).
#define PW_ITEM_AUTHORED 1
#define PW_ITEM_HOLDABLE 2
typedef struct {
    u16 iconChar;
    u16 iconPalette;
    u8 pocket;
    u8 flags;
    u8 battlePockets;
    u8 reserved;
} PwItemEntry;
typedef struct {
    u32 magic;
    u16 version;
    u16 first;
    u16 count;
    u16 reserved;
    PwItemEntry entries[PW_EXTRA_COUNT];
} PwItemCatalog;
#define PW_ITEM_CATALOG_MAGIC 0x43495750 // "PWIC"
extern PwItemCatalog gPwItemCatalog;

// Pockets of the retail IDs 0-626 ("PWIP"), filled in by Pokeweb from the item data. Black / White read an item's
// pocket out of its data file (one file read per query); the pool needs it per slot, so it is tabulated.
typedef struct {
    u32 magic;
    u16 version;
    u16 count;
    u8 pockets[PW_NATIVE_LAST + 1];
} PwItemPockets;
#define PW_ITEM_POCKETS_MAGIC 0x50495750 // "PWIP"
extern PwItemPockets gPwItemPockets;

BOOL PwItem_IsAuthored(u32 item);
u32 PwItem_Pocket(u32 item);
u32 PwItem_MaxStack(u32 item);
const PwItemEntry *PwItem_Entry(u32 item);
BOOL PwBag_Validate(const MyItem *bag);

// A second (third) call site of a redirected call runs the same wrapper.
#define PW_STR2(x) #x
#define PW_STR(x) PW_STR2(x)
#define PW_ALIAS(target) __attribute__((alias(PW_STR(target))))

// Retail (aletheia names).
extern void MI_CpuFill8(void *dst, u8 value, u32 size);
extern void MI_CpuCopy8(const void *src, void *dst, u32 size);
extern void MIi_CpuClear32(u32 value, void *dst, u32 size);
extern u32 FILE_UTIL_GetId(u32 itemId);
extern void *GFL_HEAP_Alloc(u32 heapId, u32 size, int clear, const char *file, u16 line);
extern void GFL_HEAP_Free(void *ptr);

#endif
