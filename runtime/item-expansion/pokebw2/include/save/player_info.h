#ifndef POKEBW2_SAVE_PLAYER_INFO_H
#define POKEBW2_SAVE_PLAYER_INFO_H

#include "types.h"
#include "gfl/heap.h"
#include "gfl/str.h"
#include "struct_decls.h"

#define GENDER_MALE 0
#define GENDER_FEMALE 1

struct PlayerInfo {
    u16 name[8];
    u32 id;
    // The GameSpy profile ID
    s32 profileId;
    u8 country;
    u8 province;
    u8 region;
    // The game version the player started on, VERSION_BLACK2 or VERSION_WHITE2
    u8 version;
    // The look of the player in the Union Room and on the Wi-Fi, 0 to 7 for a male player and 8 to 15 for a female
    u8 unionView;
    u8 gender;
    u8 unk1E[2];
};

u16 *GetPlayerName(PlayerInfo *info);
// Copies at most n characters of a name, as wcharsncpy does
void copyName(const u16 *src, u16 *dest, u32 n);
u32 PlayerInfo_GetSize(void);
u32 getTrainerGender(const PlayerInfo *info);
u16 getTrainerID(PlayerInfo *info);
u8 PlayerInfo_GetVersion(PlayerInfo *info);
u8 TrainerInfo_GetRegion(PlayerInfo *info);
// The player's GameSpy profile ID
s32 PlayerInfo_GetProfileId(PlayerInfo *info);
void PlayerInfo_InitProfileId(PlayerInfo *info, s32 profileId);
u8 PlayerInfo_GetUnionView(const PlayerInfo *info);
u32 getIDAsUInt(PlayerInfo *info);
void setTrainerGender(PlayerInfo *info, u32 gender);
PlayerInfo *PlayerInfo_Create(u32 heapId);
void PlayerInfo_Init(PlayerInfo *info);
void copyTrainerName(PlayerInfo *info, const u16 *name);
// Copies a player's info
void PlayerInfo_Copy(const PlayerInfo *src, PlayerInfo *dest);
// Whether the name is empty (all 8 characters 0)
BOOL PlayerInfo_IsNameEmpty(const PlayerInfo *info);
void copyTrainerNameFromStrbuf(PlayerInfo *info, const StrBuf *name);
void setIDAsUInt(PlayerInfo *info, u32 id);
// A new game sets this to a random 0 to 7, plus 8 for a female player
void PlayerInfo_SetUnionView(PlayerInfo *info, u8 value);
// The region of the player's country
u8 TrainerInfo_GetRegion(PlayerInfo *info);
void PlayerInfo_SetVersion(PlayerInfo *info, u8 value);
void PlayerInfo_SetRegion(PlayerInfo *info, u8 value);
void PlayerInfo_SetCountryAndProvince(PlayerInfo *info, int a1, int a2);

#endif // POKEBW2_SAVE_PLAYER_INFO_H
