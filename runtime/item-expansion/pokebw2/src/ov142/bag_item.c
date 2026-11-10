#include "types.h"
#include "app/bag_item.h"
#include "constants/items.h"
#include "gfl/arc.h"
#include "gfl/heap.h"
#include "gfl/std.h"
#include "nitro/math.h"
#include "pml/item.h"
#include "save/bag.h"
#if defined(WHITE2) && (defined(W2U_MEGA) || defined(W2U_EXPANDED_ITEMS)) && !defined(BLACK2)
#include "w2u/resident/mega_roster.h"
#endif

// The bag's list of the items the player moved to the Free Space, kept in the order the player arranged them

// The slots of the bag's pockets, 310 + 48 + 109 + 64 + 83, more than the Free Space can hold. Adding, filtering and
// compacting only look at the entries up to this one, not up to ITEM_LAST
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
#define BAG_ITEM_LIST_SLOTS ((int)list->capacity - 1)
#define BAG_ITEM_LIST_LAST BAG_ITEM_LIST_SLOTS
#define BAGLIST_ALLOCATE GFL_HeapTryAllocate
#define BAGLIST_SORT_SLOTS (BAG_ITEM_LIST_LAST + 1)
#else
#define BAG_ITEM_LIST_SLOTS 614
#define BAG_ITEM_LIST_LAST ITEM_LAST
#define BAGLIST_ALLOCATE GFL_HeapAllocate
#define BAGLIST_SORT_SLOTS ITEM_LAST
#endif

typedef struct {
    BagItemListEntry entry;
    u32 key;
} BagItemSortEntry;

static s32 BagItemList_CompareSortKey(void *a, void *b);
static void BagItemList_Compact(BagItemList *list);
static void BagItemList_Sort(BagItemList *list, u16 filter);
static void BagItemList_SortByName(BagItemList *list);
static void BagItemList_SortByType(BagItemList *list);

#if defined(WHITE2) && (defined(W2U_MEGA) || defined(W2U_EXPANDED_ITEMS)) && !defined(BLACK2)
static BOOL BagItemList_HasItem(BagItemList *list, u16 item) {
#if defined(W2U_EXPANDED_ITEMS)
    return W2U_ItemIsAuthored(item) && list->inBag[item];
#else
    if (item > ITEM_LAST) {
        return W2U_RosterIsStone(item) && BagSave_GetExistingItemCount(list->bag, item) != 0;
    }
    return list->inBag[item];
#endif
}
#endif

// Each item's place in alphabetical order
// clang-format off
static const u16 sItemNameOrder[ITEM_LAST + 1] = {
    0, 308, 559, 220, 378, 465, 333, 130, 332, 437, 550, 300, 393, 151, 236, 407,
    65, 383, 10, 54, 253, 16, 354, 205, 311, 249, 530, 203, 447, 313, 199, 501,
    277, 324, 162, 163, 237, 446, 167, 310, 159, 309, 273, 22, 464, 247, 399, 259,
    57, 55, 415, 392, 617, 391, 344, 231, 126, 588, 592, 605, 584, 601, 597, 379,
    193, 38, 612, 424, 31, 574, 483, 484, 428, 41, 614, 222, 531, 312, 166, 438,
    529, 326, 183, 547, 570, 275, 551, 25, 360, 27, 515, 517, 337, 239, 246, 229,
    90, 514, 213, 458, 73, 242, 133, 342, 13, 491, 414, 482, 152, 121, 348, 341,
    226, 0, 0, 0, 135, 485, 53, 68, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 535, 4, 299, 223, 178, 462, 542, 257, 287, 439,
    46, 44, 47, 48, 45, 64, 66, 362, 416, 14, 278, 346, 364, 296, 490, 180,
    578, 306, 6, 250, 419, 42, 331, 573, 367, 382, 269, 405, 244, 224, 538, 83,
    307, 410, 335, 507, 351, 571, 150, 21, 339, 356, 567, 448, 611, 72, 268, 486,
    77, 358, 539, 63, 267, 233, 79, 18, 67, 281, 207, 467, 365, 11, 272, 516,
    164, 321, 88, 264, 461, 49, 575, 302, 173, 408, 504, 317, 69, 270, 488, 9,
    74, 505, 123, 122, 498, 168, 196, 294, 470, 318, 276, 141, 283, 502, 235, 323,
    32, 30, 305, 330, 478, 375, 334, 506, 558, 61, 139, 487, 561, 480, 471, 274,
    295, 319, 543, 519, 427, 40, 368, 221, 613, 577, 327, 581, 170, 284, 282, 388,
    555, 186, 409, 198, 618, 320, 260, 271, 124, 33, 255, 499, 240, 91, 225, 70,
    520, 387, 386, 389, 385, 384, 390, 479, 28, 71, 187, 508, 616, 314, 254, 184,
    556, 153, 493, 322, 258, 522, 509, 137, 144, 261, 340, 452, 204, 572, 459, 293,
    404, 398, 157, 303, 149, 420, 417, 418, 245, 138, 403, 56, 450, 554, 234, 51,
    563, 243, 528, 540, 251, 34, 248, 285, 397, 413, 541, 466, 202, 503, 497, 546,
    545, 154, 444, 125, 400, 476, 43, 134, 429, 496, 188, 495, 468, 181, 456, 5,
    552, 174, 185, 442, 15, 544, 292, 460, 155, 349, 8, 197, 161, 175, 469, 191,
    62, 492, 256, 406, 580, 3, 160, 172, 477, 359, 443, 211, 453, 189, 521, 564,
    548, 232, 537, 525, 402, 52, 201, 454, 596, 143, 583, 377, 146, 219, 534, 370,
    562, 526, 190, 557, 89, 194, 533, 524, 568, 129, 0, 0, 171, 289, 463, 380,
    374, 266, 473, 176, 472, 350, 582, 343, 206, 423, 553, 566, 78, 345, 212, 532,
    511, 373, 24, 527, 338, 297, 316, 17, 513, 82, 304, 352, 84, 85, 86, 523,
    475, 565, 214, 474, 12, 560, 23, 136, 37, 494, 75, 58, 20, 512, 426, 290,
    355, 301, 489, 412, 329, 421, 36, 615, 227, 372, 576, 35, 177, 279, 298, 241,
    291, 200, 325, 510, 353, 366, 208, 549, 411, 94, 95, 96, 97, 98, 99, 100,
    101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116,
    117, 118, 119, 120, 265, 288, 425, 39, 165, 395, 169, 192, 457, 7, 422, 449,
    29, 2, 60, 156, 182, 569, 158, 218, 252, 179, 376, 228, 195, 401, 50, 451,
    210, 140, 92, 518, 336, 238, 328, 441, 209, 76, 536, 394, 87, 371, 280, 357,
    145, 381, 396, 142, 19, 26, 361, 81, 431, 434, 433, 436, 430, 435, 432, 59,
    127, 606, 602, 598, 593, 589, 585, 607, 603, 599, 594, 590, 586, 608, 604, 600,
    595, 591, 587, 1, 262, 263, 440, 128, 286, 93, 579, 455, 500, 609, 0, 215,
    216, 217, 610, 315, 131, 132, 363, 347, 481, 369, 230, 80, 147, 148, 445,
};

// clang-format on

static s32 BagItemList_CompareSortKey(void *a, void *b) {
    BagItemSortEntry *entryA = a;
    BagItemSortEntry *entryB = b;

    if (entryA->key == entryB->key) {
        return 0;
    }
    if (entryA->key > entryB->key) {
        return 1;
    }
    return -1;
}

void BagItemList_Init(BagItemList *list, BagSave *bag, u32 filter, HeapID heapId) {
    int i;
    int count;
    u32 pocket;

    list->bag = bag;
    count = 0;
    list->heapId = heapId;
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
    list->capacity = 1;
    for (pocket = 0; pocket < BAG_POCKET_FREE_SPACE; pocket++) {
        list->capacity += BagSave_GetPocketItemCountCore(bag, pocket, TRUE);
    }
    list->entries = GFL_HeapTryAllocate(heapId, list->capacity * sizeof(*list->entries), TRUE, __FILE__, __LINE__);
    if (list->entries == NULL) {
        list->capacity = 0;
        return;
    }
    BagSave_GetOwnedItemFlags(bag, list->inBag);
    for (i = 1; i < W2U_ITEM_CAPACITY; i++) {
#else
    MI_CpuFill8(list->entries, 0, sizeof(list->entries));
#if defined(WHITE2) && (defined(W2U_MEGA) || defined(W2U_EXPANDED_ITEMS)) && !defined(BLACK2)
    for (i = 0; i <= W2U_RosterItemLast(); i++) {
#else
    for (i = 0; i <= BAG_ITEM_LIST_LAST; i++) {
#endif
#endif
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
        if (list->inBag[i] && BagSave_IsItemFreeSpaceBit(list->bag, i)) {
            pocket = W2U_ItemPocket(i);
#else
        if (BagSave_IsItemInFreeSpace(list->bag, i)) {
            pocket = BagSave_GetExistingItemPocket(list->bag, i);
#endif
            if (pocket != BAG_POCKET_NONE) {
                list->entries[count].item = i;
                list->entries[count].pocket = pocket;
                list->entries[count].shown = TRUE;
                count++;
            } else {
                list->entries[count].item = ITEM_NONE;
                list->entries[count].pocket = BAG_POCKET_NONE;
                list->entries[count].shown = FALSE;
            }
        } else {
            list->entries[count].item = ITEM_NONE;
            list->entries[count].pocket = BAG_POCKET_NONE;
            list->entries[count].shown = FALSE;
        }
    }
    list->empty.item = ITEM_NONE;
    list->empty.count = 0;
    BagItemList_SetFilter(list, filter);
}

void BagItemList_Exit(BagItemList *list) {
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
    if (list->entries != NULL) {
        GFL_HeapFree(list->entries);
        list->entries = NULL;
    }
    list->capacity = 0;
#endif
}

BagItem *BagItemList_GetItem(BagItemList *list, u16 pocket, u16 index) {
    BagItem *item;
    BagItemListEntry *entry;
    int i;
    u32 count;
    BOOL found;

    count = 0;
    if (pocket != BAG_POCKET_FREE_SPACE) {
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
        u32 slots;
        BagItem *items = BagSave_GetPocketItems(list->bag, pocket, &slots);

        // Reacquire the current span: insertion and sorting may move saved slots.
        for (i = 0; i < slots; i++) {
            if (!BagSave_IsItemFreeSpaceBit(list->bag, items[i].item)) {
                if (count == index) {
                    return &items[i];
                }
                count++;
            }
        }
        return &list->empty;
#else
        for (i = 0; i <= BAG_ITEM_LIST_LAST; i++) {
            item = BagSave_GetItemIndexHandle(list->bag, pocket, i);
            if (item == NULL) {
                return &list->empty;
            }
            if (!BagSave_IsItemInFreeSpace(list->bag, item->item)) {
                if (count == index) {
                    break;
                }
                count++;
            }
        }
#endif
    } else {
        found = FALSE;
        for (i = 0; i <= BAG_ITEM_LIST_LAST; i++) {
            entry = &list->entries[i];
            if (entry->shown == TRUE && entry->item != ITEM_NONE) {
                if (count == index) {
                    found = TRUE;
                    break;
                }
                count++;
            }
        }
        if (!found) {
            item = &list->empty;
        } else {
            item = BagSave_GetItemHandle(list->bag, entry->pocket, entry->item);
            if (item == NULL) {
                item = &list->empty;
            }
        }
    }
    return item;
}

void BagItemList_Remove(BagItemList *list, u16 index, BOOL release) {
    BagItemListEntry *entry;
    u32 count = 0;
    int i;

    for (i = 0; i <= BAG_ITEM_LIST_LAST; i++) {
        entry = &list->entries[i];
        if (entry->shown == TRUE && entry->item != ITEM_NONE) {
            if (count == index) {
                if (release == TRUE) {
                    BagSave_MoveBetweenFreeSpace(list->bag, entry->item, FALSE);
                }
                BagSave_ForceItemAsLast(list->bag, list->entries[i].item);
                list->entries[i].item = ITEM_NONE;
                list->entries[i].pocket = BAG_POCKET_NONE;
                list->entries[i].shown = FALSE;
                break;
            }
            count++;
        }
    }
    BagItemList_Compact(list);
}

void BagItemList_Add(BagItemList *list, u32 item, s16 pocket) {
    int i;

#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
    if (!W2U_ItemIsAuthored(item) || BagSave_GetExistingItemPocket(list->bag, item) != pocket) {
        return;
    }
    for (i = 0; i <= BAG_ITEM_LIST_LAST; i++) {
        if (list->entries[i].item == item) {
            return;
        }
    }
#endif
    for (i = 0; i <= BAG_ITEM_LIST_SLOTS; i++) {
        if (list->entries[i].item == ITEM_NONE) {
            BagSave_MoveBetweenFreeSpace(list->bag, item, TRUE);
            list->entries[i].item = item;
            list->entries[i].pocket = pocket;
            list->entries[i].shown = TRUE;
            return;
        }
    }
}

// Moves the empty entries to the end
static void BagItemList_Compact(BagItemList *list) {
    BagItemListEntry temp;
    int i;
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
    int next = 0;

    for (i = 0; i <= BAG_ITEM_LIST_SLOTS; i++) {
        if (list->entries[i].item != ITEM_NONE) {
            if (i != next) {
                temp = list->entries[next];
                list->entries[next] = list->entries[i];
                list->entries[i] = temp;
            }
            next++;
        }
    }
#else
    int j;

    for (i = 0; i <= BAG_ITEM_LIST_SLOTS - 1; i++) {
        for (j = i + 1; j <= BAG_ITEM_LIST_SLOTS; j++) {
            if (list->entries[i].item == ITEM_NONE) {
                temp = list->entries[i];
                list->entries[i] = list->entries[j];
                list->entries[j] = temp;
            }
        }
    }
#endif
}

s32 BagItemList_CountInPocket(BagItemList *list, u32 pocket) {
    int i;
    s32 count = 0;

    for (i = 0; i <= BAG_ITEM_LIST_LAST; i++) {
        if (pocket == list->entries[i].pocket && list->entries[i].item != ITEM_NONE) {
            count++;
        }
    }
    return count;
}

void BagItemList_SetFilter(BagItemList *list, u16 filter) {
    u32 pockets[] = {
        BAG_POCKET_ITEMS,   BAG_POCKET_ITEMS,   BAG_POCKET_MEDICINE,
        BAG_POCKET_TMS_HMS, BAG_POCKET_BERRIES, BAG_POCKET_KEY_ITEMS,
    };
    int i;

#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
    if (filter >= NELEMS(pockets)) {
        filter = BAG_ITEM_FILTER_ALL;
    }
#endif
    for (i = 0; i <= BAG_ITEM_LIST_SLOTS; i++) {
        if (filter == BAG_ITEM_FILTER_ALL) {
            list->entries[i].shown = TRUE;
        } else if (list->entries[i].pocket == pockets[filter]) {
            list->entries[i].shown = TRUE;
        } else {
            list->entries[i].shown = FALSE;
        }
    }
    BagItemList_Sort(list, filter);
}

u32 BagItemList_CountShown(BagItemList *list, u32 pocket) {
    BagItem *items;
    u32 count = 0;
    u32 slots;
    u32 i;

    BagSave_GetOwnedItemFlags(list->bag, list->inBag);
    if (pocket != BAG_POCKET_FREE_SPACE) {
        items = BagSave_GetPocketItems(list->bag, pocket, &slots);
        for (i = 0; i < slots; i++) {
            if (items[i].item != ITEM_NONE &&
#if defined(WHITE2) && (defined(W2U_MEGA) || defined(W2U_EXPANDED_ITEMS)) && !defined(BLACK2)
                BagItemList_HasItem(list, items[i].item) &&
#else
                list->inBag[items[i].item] &&
#endif
                !BagSave_IsItemFreeSpaceBit(list->bag, items[i].item)) {
                count++;
            }
        }
    } else {
        for (i = 0; i <= BAG_ITEM_LIST_LAST; i++) {
            if (list->entries[i].item != ITEM_NONE &&
#if defined(WHITE2) && (defined(W2U_MEGA) || defined(W2U_EXPANDED_ITEMS)) && !defined(BLACK2)
                BagItemList_HasItem(list, list->entries[i].item) &&
#else
                list->inBag[list->entries[i].item] &&
#endif
                list->entries[i].shown == TRUE) {
                count++;
            }
        }
    }
    return count;
}

static void BagItemList_Sort(BagItemList *list, u16 filter) {
    switch (filter) {
    case BAG_ITEM_FILTER_ALL:
        BagItemList_SortByName(list);
        break;
    case BAG_ITEM_FILTER_ITEMS:
    case BAG_ITEM_FILTER_MEDICINE:
    case BAG_ITEM_FILTER_TMS_HMS:
    case BAG_ITEM_FILTER_BERRIES:
    case BAG_ITEM_FILTER_KEY_ITEMS:
        BagItemList_SortByType(list);
        break;
    }
}

static void BagItemList_SortByName(BagItemList *list) {
    int i;
    BagItemSortEntry *sort;
    s32 count;

    sort = BAGLIST_ALLOCATE(list->heapId, sizeof(BagItemSortEntry) * BAGLIST_SORT_SLOTS, FALSE, "bag_item.c", 525);
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
    if (sort == NULL) {
        return;
    }
#endif
    count = BagSave_GetPocketItemCount(list->bag, BAG_POCKET_FREE_SPACE);
    for (i = 0; i < count; i++) {
#if defined(WHITE2) && (defined(W2U_MEGA) || defined(W2U_EXPANDED_ITEMS)) && !defined(BLACK2)
        u16 item = list->entries[i].item;
        u16 order;
#if defined(W2U_EXPANDED_ITEMS)
        order = W2U_ItemSortRank(item);
#else
        order = item <= ITEM_LAST ? sItemNameOrder[item] : item;
#endif

        sort[i].key = item + ((u32)order << 16);
#else
        sort[i].key = list->entries[i].item + (sItemNameOrder[list->entries[i].item] << 16);
#endif
        sort[i].entry = list->entries[i];
    }
    MATH_QSort(sort, count, sizeof(BagItemSortEntry), BagItemList_CompareSortKey, NULL);
    for (i = 0; i < count; i++) {
        list->entries[i] = sort[i].entry;
    }
    GFL_HeapFree(sort);
}

static void BagItemList_SortByType(BagItemList *list) {
    BagItemSortEntry *sort;
    int i;
    s32 count;
    BagItemListEntry *entry;
    ArcTool *arc;
    void *data;

    sort = BAGLIST_ALLOCATE(list->heapId, sizeof(BagItemSortEntry) * BAGLIST_SORT_SLOTS, FALSE, "bag_item.c", 566);
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
    if (sort == NULL) {
        return;
    }
#endif
    count = BagSave_GetPocketItemCount(list->bag, BAG_POCKET_FREE_SPACE);
    arc = PML_ItemArcHandleCreate(list->heapId);
    for (i = 0; i < count; i++) {
        entry = &list->entries[i];
        data = PML_ItemArcHandleReadFile(arc, entry->item, list->heapId);
        // By the item's kind, then its place among them
        sort[i].key = (PML_ItemGetParam(data, ITEM_PARAM_KIND) << 28) +
                      (PML_ItemGetParam(data, ITEM_PARAM_SORT_INDEX) << 16) + entry->item;
        sort[i].entry = *entry;
        GFL_HeapFree(data);
    }
    GFL_ArcToolFree(arc);
    MATH_QSort(sort, count, sizeof(BagItemSortEntry), BagItemList_CompareSortKey, NULL);
    for (i = 0; i < count; i++) {
        list->entries[i] = sort[i].entry;
    }
    GFL_HeapFree(sort);
}
