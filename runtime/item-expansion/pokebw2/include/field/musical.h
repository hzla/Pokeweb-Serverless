#ifndef POKEBW2_FIELD_MUSICAL_H
#define POKEBW2_FIELD_MUSICAL_H

// The Pokémon Musical: overlay 12's musical_event.c, which runs a show from the dressing room to the photo, the script
// commands of scrcmd_musical.c, and overlays 209, 210 and 211, which those load

#include "types.h"
#include "app/ircbattlematch.h"
#include "app/musical/mus_item_data.h"
#include "app/musical/musical_shot_sys.h"
#include "app/musical/musical_system.h"
#include "field/mus_comm_func.h"
#include "gfl/heap.h"
#include "gfl/proc.h"
#include "save/save_control.h"
#include "struct_decls.h"
#include "system/game_event.h"

// The musical's communication work, which GameData_SetMusicalCommWork keeps in the game data
struct MusicalCommWork {
    MusicalEventWork *event;
    // Overlay 211's communication work
    void *comm;
    // Overlay 36's menu
    void *menu;
    IrcBattleMatchParam ircMatch;
    u16 *result;
    u16 value;
};

MusicalCommWork *GameData_GetMusicalCommWork(GameData *gameData);
void GameData_SetMusicalCommWork(GameData *gameData, MusicalCommWork *work);

// Overlay 12's musical_event.c
GameEvent *MusicalEvent_Create(GameSystem *gsys, GameData *gameData, u8 slot, BOOL online, MusicalCommWork *comm);
// The position of the player's Pokémon on the stage
u8 MusicalEvent_GetPlayerPos(MusicalEventWork *work);
// The entry order of the Pokémon at a stage position
u8 MusicalEvent_GetEntryIndex(MusicalEventWork *work, u8 pos);
u8 MusicalEvent_GetTopPropKind(MusicalEventWork *work);
// The program's title
StrBuf *MusicalEvent_GetProgramTitle(MusicalEventWork *work, HeapID heapId);
// The points of the Pokémon at a stage position, at most 255
u8 MusicalEvent_GetPoints(MusicalEventWork *work, u8 pos);
u16 MusicalEvent_GetMaxPoints(MusicalEventWork *work);
u16 MusicalEvent_GetMinPoints(MusicalEventWork *work);
// The stage position that finished at a rank
u8 MusicalEvent_GetPosAtRank(MusicalEventWork *work, u8 rank);
u8 MusicalEvent_GetBestPropKind(MusicalEventWork *work, u8 pos);
// The trainer class shown for the owner of the Pokémon at a stage position
u8 MusicalEvent_GetOwnerTrainerClass(MusicalEventWork *work, u8 pos);
// Sets a word to the owner's name, or to the Pokémon's
void MusicalEvent_WordSetOwnerName(MusicalEventWork *work, u8 pos, WordSet *wordSet, u32 wordIndex);
void MusicalEvent_WordSetPokeName(MusicalEventWork *work, u8 pos, WordSet *wordSet, u32 wordIndex);
void MusicalEvent_CheckNetError(MusicalEventWork *work);
// Whether the connection was lost
BOOL MusicalEvent_IsNetError(MusicalEventWork *work);

#endif // POKEBW2_FIELD_MUSICAL_H
