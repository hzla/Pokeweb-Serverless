// Pokeweb item expansion for Black / White: the field bag (overlay 70).
//
// The bag screen lists a pocket straight from the pool, so it shows any number of items. Two retail paths assume
// a pocket fits in 310 slots:
// * Moving an item (SELECT) works on a copy of the pocket in ItemMenuWork.items[310]. The copy now lives in a
//   heap buffer of 1,023 slots (on the bag's own heap 0xe); its pointer is kept in the first word of the unused
//   retail array. The retail calls that fill the copy and write it back are redirected to the buffer, and the
//   functions that read the copy are replaced; the buffer is freed when the bag closes.
// * Sorting (ITEMMENU_SortPocket) used 310-entry heap buffers; it is replaced with buffers sized to the pocket.
#include "bw1_items.h"
#include "bw1_addr.h"

typedef struct {
    u32 key;
    BagSlot item;
} SortEntry;

// ItemMenuWork (aletheia ov070/itemmenu_types.h), the fields used here.
#define WORK_BAG(work) (*(MyItem **)((u8 *)(work) + 0x18))
#define WORK_ITEMS(work) ((u8 *)(work) + 0x20)
#define WORK_HEAP_ID(work) (*(u16 *)((u8 *)(work) + 0x544))
#define WORK_POCKET(work) (*(int *)((u8 *)(work) + 0x80c))
#define WORK_USING_COPY(work) (*(u32 *)((u8 *)(work) + 0x81c))
#define WORK_FROM_ITEMS(items) ((void *)((u8 *)(items) - 0x20))

extern void MYITEM_SAVEDATA_CopyPocket(MyItem *bag, BagSlot *buffer, u32 pocket, int toBuffer);
extern BagSlot *MYITEM_SAVEDATA_GetSlot(MyItem *bag, u32 pocket, u32 index);
extern u32 MYITEM_SAVEDATA_CountUsedSlots(const BagSlot *slots, u32 count);
extern u32 MYITEM_SAVEDATA_CountUsedSlotsInPocket(MyItem *bag, u32 pocket);
extern void ITEMMENU_FreePalAnmSlots(void *work);
extern int ITEMMENU_CompareSortEntries(SortEntry *left, SortEntry *right);
extern void *FILE_UTIL_CreateItemArcHandle(u32 heap);
extern void *FILE_UTIL_LoadArcMember(void *arc, u32 item, u32 heap);
extern u32 FILE_UTIL_GetItemRecordParam(void *record, u32 prop);
extern void ARC_TOOL_DeleteHandle(void *arc);
extern void MATH_QSort(void *base, u32 count, u32 size, int (*compare)(SortEntry *, SortEntry *), u32 unused);

#define MOVE_BUFFER_BYTES (BAG_POOL_SLOTS * sizeof(BagSlot))

static BagSlot *MoveBuffer(void *work) {
    BagSlot **slot = (BagSlot **)WORK_ITEMS(work);

    if (*slot == NULL) {
        *slot = GFL_HEAP_Alloc(WORK_HEAP_ID(work), MOVE_BUFFER_BYTES, 1, "pw_bag", 1);
    }
    return *slot;
}

// TaskBagMain: MI_CpuFill8(work->items, 0, 0x4d8) before entering move mode.
void HOOK_BAG_MOVE_CLEAR(void *items, u8 value, u32 size) {
    MI_CpuFill8(MoveBuffer(WORK_FROM_ITEMS(items)), 0, MOVE_BUFFER_BYTES);
}

// TaskBagMain (fill the copy) and TaskListInput (write it back): MYITEM_SAVEDATA_CopyPocket on work->items.
void HOOK_BAG_MOVE_COPY(MyItem *bag, void *items, u32 pocket, int toBuffer) {
    MYITEM_SAVEDATA_CopyPocket(bag, MoveBuffer(WORK_FROM_ITEMS(items)), pocket, toBuffer);
}

void HOOK_BAG_MOVE_COPY_2(MyItem *bag, void *items, u32 pocket, int toBuffer) PW_ALIAS(HOOK_BAG_MOVE_COPY);
void HOOK_BAG_MOVE_COPY_3(MyItem *bag, void *items, u32 pocket, int toBuffer) PW_ALIAS(HOOK_BAG_MOVE_COPY);

// ITEMMENU_Exit: ITEMMENU_FreePalAnmSlots(work), then free the move buffer before the bag's heap is deleted.
void HOOK_BAG_EXIT_FREE(void *work) {
    BagSlot **slot = (BagSlot **)WORK_ITEMS(work);

    ITEMMENU_FreePalAnmSlots(work);
    if (*slot != NULL) {
        GFL_HEAP_Free(*slot);
        *slot = NULL;
    }
}

BagSlot *HOOK_ITEMMENU_GetSlot(void *work, int index) {
    if (WORK_USING_COPY(work)) {
        return index >= 0 && index < BAG_POOL_SLOTS ? &MoveBuffer(work)[index] : NULL;
    }
    return MYITEM_SAVEDATA_GetSlot(WORK_BAG(work), (u16)WORK_POCKET(work), (u16)index);
}

int HOOK_ITEMMENU_GetItemCount(void *work) {
    if (WORK_USING_COPY(work)) {
        return MYITEM_SAVEDATA_CountUsedSlots(MoveBuffer(work), BAG_POOL_SLOTS);
    }
    return MYITEM_SAVEDATA_CountUsedSlotsInPocket(WORK_BAG(work), WORK_POCKET(work));
}

void HOOK_ITEMMENU_SwapSlots(void *work, int indexA, int indexB) {
    BagSlot *items = MoveBuffer(work);
    BagSlot saved = items[indexA];

    items[indexA] = items[indexB];
    items[indexB] = saved;
}

// Sort the shown pocket by the items' sort keys (retail: parameters 0xf and 0x11, then the ID).
void HOOK_ITEMMENU_SortPocket(void *work) {
    u32 heap = WORK_HEAP_ID(work);
    u32 count = MYITEM_SAVEDATA_CountUsedSlotsInPocket(WORK_BAG(work), WORK_POCKET(work));
    SortEntry *ents;
    BagSlot *items;
    void *arc;
    u32 i;

    if (count == 0) {
        return;
    }
    ents = GFL_HEAP_Alloc(heap, count * sizeof(SortEntry), 0, "pw_bag", 2);
    items = GFL_HEAP_Alloc(heap, count * sizeof(BagSlot), 0, "pw_bag", 3);
    MYITEM_SAVEDATA_CopyPocket(WORK_BAG(work), items, WORK_POCKET(work), 1);
    arc = FILE_UTIL_CreateItemArcHandle(heap);
    for (i = 0; i < count; i++) {
        void *data = FILE_UTIL_LoadArcMember(arc, items[i].itemId, heap);
        u32 kind = FILE_UTIL_GetItemRecordParam(data, 0xf);

        ents[i].key = (kind << 28) + (FILE_UTIL_GetItemRecordParam(data, 0x11) << 16) + items[i].itemId;
        ents[i].item = items[i];
        GFL_HEAP_Free(data);
    }
    ARC_TOOL_DeleteHandle(arc);
    MATH_QSort(ents, count, sizeof(SortEntry), ITEMMENU_CompareSortEntries, 0);
    for (i = 0; i < count; i++) {
        items[i] = ents[i].item;
    }
    MYITEM_SAVEDATA_CopyPocket(WORK_BAG(work), items, WORK_POCKET(work), 0);
    GFL_HEAP_Free(items);
    GFL_HEAP_Free(ents);
}
