#ifndef POKEBW2_SAVE_TRAINER_DATA_SAVEDATA_H
#define POKEBW2_SAVE_TRAINER_DATA_SAVEDATA_H

#include "types.h"
#include "save/config.h"
#include "save/player_info.h"
#include "save/playtime.h"
#include "struct_decls.h"

#define TRAINER_DATA_MARKER_COUNT 22
#define TRAINER_DATA_MARKER_SET 0xc21e

// The save block of the options, the player's info and the play time (trainer_data_savedata.c, a guessed name)
struct TrainerDataSave {
    Config config;
    PlayerInfo playerInfo;
    PlayTime playTime;
    // Set by the intro's save of a new game, which a load then treats as no save
    u8 isIntroSave;
    u8 unk2D[3];
    // Each is TRAINER_DATA_MARKER_SET once something has happened
    u16 markers[TRAINER_DATA_MARKER_COUNT];
    // The save count of each extra save block
    u32 extraSaveCounts[21];
};

u32 getSizeofTrainerData(void);
void TrainerDataSave_Init(TrainerDataSave *data);
PlayerInfo *SaveControl_GetPlayerInfo(SaveControl *save);
TrainerDataSave *getTrainerDataBlkAddress(SaveControl *save);
// The play time: hours and minutes
PlayTime *SaveControl_GetPlayTime(SaveControl *save);
u8 TrainerDataSave_IsIntroSave(SaveControl *save);
void TrainerDataSave_SetIntroSave(SaveControl *save);
void TrainerDataSave_ClearIntroSave(SaveControl *save);
BOOL TrainerDataSave_IsMarkerSet(SaveControl *save, u32 index);
void TrainerDataSave_SetMarker(SaveControl *save, u32 index);
void TrainerDataSave_ClearMarker(SaveControl *save, u32 index);
u32 *TrainerDataSave_GetExtraSaveCount(SaveControl *save, u32 index);
// Copy the player's info from the player state, and back
void TrainerDataSave_StorePlayerInfo(SaveControl *save, PlayerState *state);
void TrainerDataSave_LoadPlayerInfo(SaveControl *save, PlayerState *state);

#endif // POKEBW2_SAVE_TRAINER_DATA_SAVEDATA_H
