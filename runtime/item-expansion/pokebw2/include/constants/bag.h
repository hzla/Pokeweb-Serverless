#ifndef POKEBW2_CONSTANTS_BAG_H
#define POKEBW2_CONSTANTS_BAG_H

// The bag's pockets, in the order the bag keeps them
#define BAG_POCKET_ITEMS 0
#define BAG_POCKET_MEDICINE 1
#define BAG_POCKET_TMS_HMS 2
#define BAG_POCKET_BERRIES 3
#define BAG_POCKET_KEY_ITEMS 4
// The items the player moved to the Free Space, which stay in their own pockets
#define BAG_POCKET_FREE_SPACE 5
#define BAG_POCKET_NONE 6

// The battle bag's pockets that an item is in (ITEM_PARAM_BATTLE_POCKET), as bits: Master Ball has the first, X Attack
// the second, Potion the third, Cheri Berry the fourth and Full Restore the third and fourth
#define BATTLE_POCKET_BALLS (1 << 0)
#define BATTLE_POCKET_BATTLE_ITEMS (1 << 1)
#define BATTLE_POCKET_HP_PP_RESTORE (1 << 2)
#define BATTLE_POCKET_STATUS_RESTORE (1 << 3)

#endif // POKEBW2_CONSTANTS_BAG_H
