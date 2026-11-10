#ifndef POKEBW2_APP_BAG_H
#define POKEBW2_APP_BAG_H

#include "types.h"
#include "field/player_action.h"
#include "gfl/heap.h"
#include "gfl/overlay.h"
#include "gfl/proc.h"
#include "save/bag.h"
#include "struct_decls.h"

// The bag, overlay 142 (itemmenu.c and bag_item.c)
#define OVERLAY_BAG OVERLAY_ID(142)

// What the bag is started with, 0x4c bytes that BagParam_Create (bag_param.c) allocates
struct BagProcessData {
    GameData *gameData;
    TrainerDataSave *trainerData;
    PlayerInfo *playerInfo;
    // The bag's cursor in each pocket, which BagCursor_GetPocketPosition and the functions after it read and set
    void *cursor;
    // The Free Space's filter
    u32 freeSpaceFilter;
    BagSave *bag;
    PlayerActionPerms perms;
    u32 mode;
    BOOL isCycling;
    // Whether the Dowsing MCHN is on the lower screen
    BOOL dowsingActive;
    // What the player did, 0 for nothing
    u32 result;
    u32 item;
};

extern const GameProcFunctions BAG_PROC_FUNCTIONS;

// Creates the bag's data for a mode, in the main module, with a copy of the perms when they are given
BagProcessData *BagParam_Create(GameData *gameData, const PlayerActionPerms *perms, u32 mode, HeapID heapId);

#endif // POKEBW2_APP_BAG_H
