// Pokeweb item expansion for Black / White: the bag as one pool of 1,023 slots (resident, ARM9).
//
// Replaces the retail bag functions (aletheia's MYITEM_SAVEDATA_*) that know the five fixed pockets. A pocket is
// the run of pool slots whose items belong to it; the runs are in pocket order and contiguous, so every retail
// "pocket array" is a slice of the pool and its "size" is the number of items the player has in it. The retail
// array helpers (FindAddSlot, CountUsedSlots, CompactPocket, the sorts, ...) are kept: they work on slices too.
//
// Retail ordering rules are kept: berries are sorted by ID, TMs/HMs by item order, and any other new item goes
// to the front of its pocket.
#include "bw1_items.h"
#include "bw1_addr.h"

extern void MYITEM_SAVEDATA_SortPocketById(BagSlot *slots, u32 count);
extern void MYITEM_SAVEDATA_SortPocketByItemOrder(BagSlot *slots, u32 count);
extern void MYITEM_SAVEDATA_MoveLastUsedToFront(BagSlot *slots, u32 count);

static u32 Pool_Count(const MyItem *bag) {
    u32 count = 0;

    if (bag->version != BAG_POOL_VERSION) {
        return 0;
    }
    while (count < BAG_POOL_SLOTS && bag->slots[count].itemId != 0) {
        count++;
    }
    return count;
}

static BagSlot *Pool_Find(MyItem *bag, u32 item) {
    u32 i;

    if (bag->version != BAG_POOL_VERSION || !PwItem_IsAuthored(item)) {
        return NULL;
    }
    for (i = 0; i < BAG_POOL_SLOTS && bag->slots[i].itemId != 0; i++) {
        if (bag->slots[i].itemId == item) {
            return &bag->slots[i];
        }
    }
    return NULL;
}

// The slice of a pocket.
static BagSlot *Pool_Pocket(MyItem *bag, u32 pocket, u32 *count) {
    u32 used = Pool_Count(bag);
    u32 start = 0;
    u32 end;

    *count = 0;
    if (pocket >= BAG_POCKET_COUNT || bag->version != BAG_POOL_VERSION) {
        return NULL;
    }
    while (start < used && PwItem_Pocket(bag->slots[start].itemId) < pocket) {
        start++;
    }
    end = start;
    while (end < used && PwItem_Pocket(bag->slots[end].itemId) == pocket) {
        end++;
    }
    *count = end - start;
    return &bag->slots[start];
}

BOOL PwBag_Validate(const MyItem *bag) {
    u32 seen[32];
    u32 i;
    u32 lastPocket = 0;
    BOOL ended = FALSE;

    if (bag->version != BAG_POOL_VERSION) {
        return FALSE;
    }
    MI_CpuFill8(seen, 0, sizeof(seen));
    for (i = 0; i < BAG_POOL_SLOTS; i++) {
        u32 item = bag->slots[i].itemId;
        u32 count = bag->slots[i].quantity;
        u32 pocket;

        if (item == 0) {
            if (count != 0) {
                return FALSE;
            }
            ended = TRUE;
            continue;
        }
        if (ended || !PwItem_IsAuthored(item)) {
            return FALSE;
        }
        pocket = PwItem_Pocket(item);
        if (pocket >= BAG_POCKET_COUNT || pocket < lastPocket || count == 0 || count > PwItem_MaxStack(item) ||
            (seen[item >> 5] & (1u << (item & 31)))) {
            return FALSE;
        }
        seen[item >> 5] |= 1u << (item & 31);
        lastPocket = pocket;
    }
    return TRUE;
}

void HOOK_MYITEM_Init(MyItem *bag) {
    MI_CpuFill8(bag, 0, sizeof(*bag));
    bag->version = BAG_POOL_VERSION;
}

u32 HOOK_MYITEM_GetPocket(MyItem *bag, u32 pocket, BagSlot **slots, u32 *count) {
    *slots = Pool_Pocket(bag, pocket, count);
    return pocket;
}

u32 HOOK_MYITEM_GetPocketOfItem(MyItem *bag, u32 itemId, BagSlot **slots, u32 *count, u16 heapId) {
    u32 pocket = PwItem_Pocket(itemId);

    *slots = Pool_Pocket(bag, pocket, count);
    return pocket;
}

// The slot the item would be added to: its own slot when the total stays within the limit; for an item the
// player does not have, NULL when the pool is full, else the first empty slot (which AddItem then moves into
// place; nothing else writes through this pointer).
BagSlot *HOOK_MYITEM_FindAddSlotForItem(MyItem *bag, u16 itemId, u16 quantity, u16 heapId) {
    BagSlot *slot;
    u32 used;

    if (bag->version != BAG_POOL_VERSION || !PwItem_IsAuthored(itemId) || quantity == 0 ||
        quantity > PwItem_MaxStack(itemId)) {
        return NULL;
    }
    slot = Pool_Find(bag, itemId);
    if (slot != NULL) {
        return slot->quantity + quantity <= PwItem_MaxStack(itemId) ? slot : NULL;
    }
    used = Pool_Count(bag);
    return used < BAG_POOL_SLOTS ? &bag->slots[used] : NULL;
}

u32 HOOK_MYITEM_CanAddItem(MyItem *bag, u16 itemId, u16 quantity, u16 heapId) {
    return HOOK_MYITEM_FindAddSlotForItem(bag, itemId, quantity, heapId) != NULL;
}

u32 HOOK_MYITEM_AddItem(MyItem *bag, u16 itemId, u16 quantity, u16 heapId) {
    BagSlot *slot = HOOK_MYITEM_FindAddSlotForItem(bag, itemId, quantity, heapId);
    BagSlot *slots;
    u32 count;
    u32 index;
    u32 pocket;

    if (slot == NULL) {
        return 0;
    }
    if (slot->itemId == itemId) {
        slot->quantity += quantity;
        return 1;
    }
    // A new item: insert it at the end of its pocket's run, then apply the pocket's retail order.
    pocket = PwItem_Pocket(itemId);
    index = slot - bag->slots;
    while (index > 0 && PwItem_Pocket(bag->slots[index - 1].itemId) > pocket) {
        bag->slots[index] = bag->slots[index - 1];
        index--;
    }
    bag->slots[index].itemId = itemId;
    bag->slots[index].quantity = quantity;
    slots = Pool_Pocket(bag, pocket, &count);
    if (pocket == BAG_POCKET_BERRIES) {
        MYITEM_SAVEDATA_SortPocketById(slots, count);
    } else if (pocket == BAG_POCKET_TMHM) {
        MYITEM_SAVEDATA_SortPocketByItemOrder(slots, count);
    } else {
        MYITEM_SAVEDATA_MoveLastUsedToFront(slots, count);
    }
    return 1;
}

BagSlot *HOOK_MYITEM_FindItemSlot(MyItem *bag, u16 itemId, u16 quantity, u16 heapId) {
    BagSlot *slot = Pool_Find(bag, itemId);

    return slot != NULL && slot->quantity >= quantity ? slot : NULL;
}

u32 HOOK_MYITEM_RemoveItem(MyItem *bag, u16 itemId, u16 quantity, u16 heapId) {
    BagSlot *slot = HOOK_MYITEM_FindItemSlot(bag, itemId, quantity, heapId);
    u32 index;
    u32 used;

    if (slot == NULL) {
        return 0;
    }
    slot->quantity -= quantity;
    if (slot->quantity != 0) {
        return 1;
    }
    used = Pool_Count(bag);
    for (index = slot - bag->slots; index + 1 < used; index++) {
        bag->slots[index] = bag->slots[index + 1];
    }
    bag->slots[index].itemId = 0;
    bag->slots[index].quantity = 0;
    return 1;
}

u32 HOOK_MYITEM_HasItem(MyItem *bag, u16 itemId, u16 quantity, u16 heapId) {
    return HOOK_MYITEM_FindItemSlot(bag, itemId, quantity, heapId) != NULL;
}

u32 HOOK_MYITEM_CountUsedSlotsInPocket(MyItem *bag, u32 pocket) {
    u32 count;

    Pool_Pocket(bag, pocket, &count);
    return count;
}

u32 HOOK_MYITEM_GetItemQuantity(MyItem *bag, u16 itemId, u16 heapId) {
    BagSlot *slot = Pool_Find(bag, itemId);

    return slot != NULL ? slot->quantity : 0;
}

// Pool mutations keep every pocket contiguous and free of empty slots.
void HOOK_MYITEM_CompactAllPockets(MyItem *bag) {
}

BagSlot *HOOK_MYITEM_GetSlot(MyItem *bag, u32 pocket, u32 index) {
    u32 count;
    BagSlot *slots = Pool_Pocket(bag, pocket, &count);

    return slots != NULL && index < count ? &slots[index] : NULL;
}

// Copy a pocket to a buffer (toBuffer), or back from it. Copying back only reorders: the buffer must hold exactly
// the pocket's items with their counts (empty slots anywhere), else the bag is left unchanged.
void HOOK_MYITEM_CopyPocket(MyItem *bag, BagSlot *buffer, u32 pocket, int toBuffer) {
    u32 seen[32];
    u32 count;
    u32 i;
    u32 n;
    u32 found = 0;
    BagSlot *slots = Pool_Pocket(bag, pocket, &count);

    if (slots == NULL) {
        return;
    }
    if (toBuffer) {
        MI_CpuCopy8(slots, buffer, count * sizeof(BagSlot));
        return;
    }
    MI_CpuFill8(seen, 0, sizeof(seen));
    // The buffer was filled from this pocket, so its items are within the first (pool size) entries.
    for (i = 0; i < BAG_POOL_SLOTS && found < count; i++) {
        u32 item = buffer[i].itemId;
        BagSlot *slot;

        if (item == 0) {
            if (buffer[i].quantity != 0) {
                return;
            }
            continue;
        }
        slot = Pool_Find(bag, item);
        if (slot == NULL || slot < slots || slot >= slots + count || slot->quantity != buffer[i].quantity ||
            (seen[item >> 5] & (1u << (item & 31)))) {
            return;
        }
        seen[item >> 5] |= 1u << (item & 31);
        found++;
    }
    if (found != count) {
        return;
    }
    for (i = 0, n = 0; n < count; i++) {
        if (buffer[i].itemId != 0) {
            slots[n++] = buffer[i];
        }
    }
}
