// Pokeweb item expansion for Black / White: the battle bag (overlay 197).
//
// Retail keeps each battle pocket's items in BagWork.rows[4][36] with a byte count per pocket. With a shared
// 1,023-slot bag a pocket can hold more, so the lists live on the battle bag's heap, one per pocket, sized to what
// the player has. Their header sits in BagWork's unused 0x90 bytes at 0x390 (the work is allocated cleared).
//
// * B_BAG_MAIN_BuildPocketLists is replaced: it builds the heap lists from the pool and the per-item battle pocket
//   bits (archive 232, padded to 1,024 bytes by Pokeweb).
// * B_BAG_MAIN_GetSlotItem and B_BAG_MAIN_SyncCursorToItem are replaced to read the lists.
// * The four drawing functions that read one row (DrawItemName, DrawItemInfo, DrawDescription, DrawItemUsage) are
//   kept: their calls are redirected through wrappers that copy the requested row into rows[pocket][0] and pass
//   index 0, so retail code only ever reads the first inline row.
// * The lists are freed with the work (B_BAG_MAIN_StateExit's GFL_HEAP_Free).
// The "other" menu mode (B_BAG_MAIN_BuildOtherList / InitOtherPage) never builds the lists and stays retail.
#include "bw1_items.h"
#include "bw1_addr.h"
#include "bbag_data.h" // PW_BBAG_FIELD_POCKETS[3], PW_BBAG_BATTLE_POCKETS[4] (the retail tables, read at build time)

typedef struct {
    u16 item;
    u16 count;
} Row;

#define LISTS_MAGIC 0x4c425750 // "PWBL"
typedef struct {
    u32 magic;
    Row *rows[4];
    u16 count[4];
} Lists;

// BagWork / BagMenu (aletheia ov197/b_bag_main.c), the fields used here.
#define WORK_MENU(p) (*(u8 **)(p))
#define WORK_ROWS(p, pocket) ((Row *)((u8 *)(p) + 0x150 + (pocket) * 0x90))
#define WORK_LISTS(p) ((Lists *)((u8 *)(p) + 0x390))
#define WORK_POCKET(p) (*((u8 *)(p) + 0x533))
#define WORK_COUNTS(p) ((u8 *)(p) + 0x535)
#define WORK_PAGES(p) ((u8 *)(p) + 0x539)
#define WORK_KEY_ITEM(p) (*(u16 *)((u8 *)(p) + 0x540))
#define MENU_BAG(m) (*(MyItem **)(m))
#define MENU_HEAP_ID(m) (*(u16 *)((m) + 0xc))
#define MENU_CURSOR_X(m) ((s16 *)((m) + 0x30))
#define MENU_CURSOR_Y(m) ((s16 *)((m) + 0x38))

#define ARC_BATTLE_POCKETS 0xe8

extern BagSlot *MYITEM_SAVEDATA_GetSlot(MyItem *bag, u32 pocket, u32 index);
extern void *ARC_TOOL_LoadMember(u32 arc, u32 member, u32 heap);
extern void B_BAG_MAIN_DrawItemName(void *p, u32 i, int id, int w, int a, int b);
extern void B_BAG_MAIN_DrawItemInfo(void *p, u32 i, int id, int w, int a, int y, int b);
extern void B_BAG_MAIN_DrawDescription(void *p, u32 i);
extern void B_BAG_MAIN_DrawItemUsage(void *p, int i);

// x / 6 for x < 65536, without a division routine.
static u32 Div6(u32 x) {
    return (x * 0xaaabu) >> 18;
}

static Lists *ListsOf(void *p) {
    Lists *lists = WORK_LISTS(p);

    return lists->magic == LISTS_MAGIC ? lists : NULL;
}

static Row ListRow(void *p, u32 pocket, u32 index) {
    Lists *lists = ListsOf(p);
    Row empty = { 0, 0 };

    if (lists == NULL) {
        return index < 36 ? WORK_ROWS(p, pocket)[index] : empty;
    }
    return index < lists->count[pocket] ? lists->rows[pocket][index] : empty;
}

static void FreeLists(void *p) {
    Lists *lists = ListsOf(p);
    u32 i;

    if (lists == NULL) {
        return;
    }
    for (i = 0; i < 4; i++) {
        if (lists->rows[i] != NULL) {
            GFL_HEAP_Free(lists->rows[i]);
        }
    }
    MI_CpuFill8(lists, 0, sizeof(*lists));
}

void HOOK_BBAG_BuildPocketLists(void *p) {
    u8 *menu = WORK_MENU(p);
    u32 heap = MENU_HEAP_ID(menu);
    MyItem *bag = MENU_BAG(menu);
    u8 *bits = ARC_TOOL_LoadMember(ARC_BATTLE_POCKETS, 0, heap);
    Lists *lists = WORK_LISTS(p);
    u32 pass;
    u32 i;
    u32 j;
    u32 k;

    FreeLists(p);
    for (i = 0; i < 4; i++) {
        lists->count[i] = 0;
    }
    // Pass 0 counts each battle pocket's items, pass 1 fills the lists (retail order: field pockets in table order).
    for (pass = 0; pass < 2; pass++) {
        if (pass == 1) {
            for (i = 0; i < 4; i++) {
                lists->rows[i] = lists->count[i] ? GFL_HEAP_Alloc(heap, lists->count[i] * sizeof(Row), 1, "pw_bbag", 1) : NULL;
                lists->count[i] = 0;
            }
            lists->magic = LISTS_MAGIC;
        }
        for (i = 0; i < 3; i++) {
            BagSlot *slot;

            for (j = 0; (slot = MYITEM_SAVEDATA_GetSlot(bag, PW_BBAG_FIELD_POCKETS[i], j)) != NULL; j++) {
                if (slot->itemId == 0 || slot->quantity == 0 || slot->itemId >= PW_ITEM_CAPACITY) {
                    continue;
                }
                for (k = 0; k < 4; k++) {
                    if (bits[slot->itemId] & (1 << k)) {
                        u32 pocket = PW_BBAG_BATTLE_POCKETS[k];

                        if (pass == 1) {
                            lists->rows[pocket][lists->count[pocket]].item = slot->itemId;
                            lists->rows[pocket][lists->count[pocket]].count = slot->quantity;
                        }
                        lists->count[pocket]++;
                    }
                }
            }
        }
    }
    GFL_HEAP_Free(bits);
    for (i = 0; i < 4; i++) {
        u32 count = lists->count[i];
        s16 *cursorY = MENU_CURSOR_Y(menu);

        WORK_COUNTS(p)[i] = count > 0xff ? 0xff : count;
        WORK_PAGES(p)[i] = count == 0 ? 0 : Div6(count - 1);
        if (WORK_PAGES(p)[i] < cursorY[i]) {
            cursorY[i] = WORK_PAGES(p)[i];
        }
    }
}

u16 HOOK_BBAG_GetSlotItem(void *p, u32 n) {
    u32 pocket = WORK_POCKET(p);
    Row row = ListRow(p, pocket, n + MENU_CURSOR_Y(WORK_MENU(p))[pocket] * 6);

    return row.item != 0 && row.count != 0 ? row.item : 0;
}

void HOOK_BBAG_SyncCursorToItem(void *p) {
    u32 pocket = WORK_POCKET(p);
    u8 *menu = WORK_MENU(p);
    Lists *lists = ListsOf(p);
    u32 count = lists ? lists->count[pocket] : 36;
    u32 i;

    for (i = 0; i < count; i++) {
        if (ListRow(p, pocket, i).item == WORK_KEY_ITEM(p)) {
            MENU_CURSOR_X(menu)[pocket] = i - Div6(i) * 6;
            MENU_CURSOR_Y(menu)[WORK_POCKET(p)] = Div6(i);
            return;
        }
    }
}

// The row the retail drawing function will read, placed in the first inline row.
static u32 Stage(void *p, u32 index) {
    u32 pocket = WORK_POCKET(p);

    if (ListsOf(p) == NULL) {
        return index;
    }
    WORK_ROWS(p, pocket)[0] = ListRow(p, pocket, index);
    return 0;
}

void HOOK_BBAG_DRAW_NAME(void *p, u32 i, int id, int w, int a, int b) {
    B_BAG_MAIN_DrawItemName(p, Stage(p, i), id, w, a, b);
}

void HOOK_BBAG_DRAW_INFO(void *p, u32 i, int id, int w, int a, int y, int b) {
    B_BAG_MAIN_DrawItemInfo(p, Stage(p, i), id, w, a, y, b);
}

void HOOK_BBAG_DRAW_INFO_2(void *p, u32 i, int id, int w, int a, int y, int b) PW_ALIAS(HOOK_BBAG_DRAW_INFO);

void HOOK_BBAG_DRAW_DESCRIPTION(void *p, u32 i) {
    B_BAG_MAIN_DrawDescription(p, Stage(p, i));
}

void HOOK_BBAG_DRAW_USAGE(void *p, int i) {
    B_BAG_MAIN_DrawItemUsage(p, Stage(p, i));
}

// B_BAG_MAIN_StateExit: GFL_HEAP_Free(work).
void HOOK_BBAG_EXIT_FREE(void *p) {
    FreeLists(p);
    GFL_HEAP_Free(p);
}
