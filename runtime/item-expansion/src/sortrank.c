// Pokeweb item expansion: the bag's sort-by-name ranks for every item ID, the "PWIR" table Pokeweb fills in
// from the ROM's item names when it installs the patch (retail ranks only cover retail IDs).
#include "catalog.h"

typedef struct {
    u32 magic; // "PWIR"
    u16 version;
    u16 count;
    u16 ranks[PW_ITEM_CAPACITY];
} PwItemRanks;

__attribute__((used, section(".data.pwir"))) PwItemRanks gPwItemRanks = {
    .magic = 0x52495750,
    .version = 1,
    .count = PW_ITEM_CAPACITY,
};

u16 W2U_ItemSortRank(u32 item) {
    return item < PW_ITEM_CAPACITY ? gPwItemRanks.ranks[item] : 0xffff;
}
