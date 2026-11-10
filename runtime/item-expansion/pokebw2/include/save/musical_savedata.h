#ifndef POKEBW2_SAVE_MUSICAL_SAVEDATA_H
#define POKEBW2_SAVE_MUSICAL_SAVEDATA_H

#include "types.h"
#include "struct_decls.h"

// The musical's save block 0x2a (swan's getAddressOfMusicalDataInfo): the photo of the last finale, the props
// owned and the ones not yet looked at, and the musical's counters

#define MUSICAL_PROP_MAX 100
#define MUSICAL_PROP_BYTES (MUSICAL_PROP_MAX / 8 + 20)

// A prop a Pokémon wears in a musical shot, by the slot it is worn on
typedef struct {
    u16 itemId;
    s16 rotation;
    // The position it is worn at, 10 for none
    u8 pos;
    u8 unk5[3];
} MusicalShotEquip;

typedef struct {
    u16 species;
    u16 sex : 2;
    u16 rare : 1;
    u16 form : 5;
    u32 personality;
    u16 name[8];
    MusicalShotEquip equips[8];
} MusicalShotPoke;

// The photo of a musical's finale, which the musical event fills in and the save keeps. A month of 0 means no photo
typedef struct {
    u32 unk0_0 : 5;
    // A bit for each Pokémon that got the most points
    u32 tops : 4;
    u32 year : 7;
    u32 month : 5;
    u32 day : 6;
    // The player's Pokémon
    u32 player : 2;
    u32 unk0_29 : 3;
    MusicalShotPoke pokes[4];
    u16 title[0x25];
    u8 unk1AE;
    u8 unk1AF;
} MusicalShot;

// A gift of the audience after a show: the top kind of the show (4 for no gift), and whether it holds a prop and which
typedef struct {
    u8 topKind;
    u8 hasProp;
    u16 prop;
} MusicalAudienceGift;

// A prop that the Pokémon wears: its position (10 for none), the prop and its rotation
typedef struct {
    u8 pos;
    u8 unk1;
    u16 itemId;
    s16 rotation;
} MusicalSaveEquip;

struct MusicalSave {
    MusicalShot shot;
    // The props the Pokémon wore last, which the dressing room puts on it again
    MusicalSaveEquip equips[8];
    MusicalAudienceGift audienceGifts[10];
    // A name of 0x25 characters
    u16 name[0x25];
    // The shows played and won, and the points of all the shows, up to 0xffff
    u16 showCount;
    u16 winCount;
    u16 totalPoints;
    // A bit per prop owned, and per prop not yet looked at
    u8 props[MUSICAL_PROP_BYTES];
    u8 newProps[MUSICAL_PROP_BYTES];
    // How many of the props worn in the last show were of each kind, and its points
    u8 propKindCounts[4];
    u8 lastPoints;
    // The program to play, and whether a program was downloaded
    u8 program;
    u8 hasDistProgram;
    // Whether the dressing room has been visited
    u8 dressingRoomVisited;
    // Whether the downloaded props were added
    u8 downloadedProps;
    u8 padding2A1[3];
}; // size: 0x2a4

// The size of the block and its init
u32 MusicalSave_GetSize(void);
void MusicalSave_Init(MusicalSave *musical);
MusicalSave *getAddressOfMusicalDataInfo(SaveControl *save);
void MusicalSave_ClearEquips(MusicalSave *musical);
MusicalSaveEquip *MusicalSave_GetEquips(MusicalSave *musical);
// Whether a musical photo is saved
BOOL MusicalSave_HasShot(MusicalSave *musical);
MusicalShot *MusicalSave_GetShot(MusicalSave *musical);
// Whether a prop is owned, whether it is flagged as new, and giving one
BOOL MusicalSave_HasProp(MusicalSave *musical, u8 prop);
BOOL MusicalSave_IsPropNew(MusicalSave *musical, u8 prop);
void MusicalSave_AddProp(MusicalSave *musical, u8 prop);
// Forgets which props are new
void MusicalSave_ClearNewProps(MusicalSave *musical);
// How many props are owned, and whether all of them are
u32 MusicalSave_CountProps(MusicalSave *musical);
BOOL MusicalSave_HasAllProps(MusicalSave *musical);
MusicalAudienceGift *MusicalSave_GetAudienceGift(MusicalSave *musical, u8 index);
// The shows played and won, and adding one to them, up to 0xffff
u16 MusicalSave_GetShowCount(MusicalSave *musical);
void MusicalSave_IncShowCount(MusicalSave *musical);
u16 MusicalSave_GetWinCount(MusicalSave *musical);
void MusicalSave_IncWinCount(MusicalSave *musical);
u8 MusicalSave_GetPropKindCount(MusicalSave *musical, u8 index);
void MusicalSave_SetPropKindCount(MusicalSave *musical, u8 index, u8 value);
u8 MusicalSave_GetLastPoints(MusicalSave *musical);
void MusicalSave_SetLastPoints(MusicalSave *musical, u8 value);
u8 MusicalSave_GetProgram(MusicalSave *musical);
void MusicalSave_SetProgram(MusicalSave *musical, u8 value);
u8 MusicalSave_HasDistProgram(MusicalSave *musical);
void MusicalSave_SetHasDistProgram(MusicalSave *musical, u8 value);
const u16 *MusicalSave_GetName(MusicalSave *musical);
// The points of all the shows, and adding to them, up to 0xffff
void MusicalSave_AddTotalPoints(MusicalSave *musical, u16 value);
u16 MusicalSave_GetTotalPoints(MusicalSave *musical);
BOOL MusicalSave_GetDressingRoomVisited(MusicalSave *musical);
void MusicalSave_SetDressingRoomVisited(MusicalSave *musical, BOOL value);
// Whether the downloaded props were added, which MusicalSave_SetDownloadedProps sets
u8 MusicalSave_GetDownloadedProps(MusicalSave *musical);
void MusicalSave_SetDownloadedProps(MusicalSave *musical, u8 value);
u8 *MusicalSave_GetProps(MusicalSave *musical);

#endif // POKEBW2_SAVE_MUSICAL_SAVEDATA_H
