#ifndef POKEBW2_SAVE_MEMORY_LINK_SAVEDATA_H
#define POKEBW2_SAVE_MEMORY_LINK_SAVEDATA_H

#include "types.h"
#include "struct_decls.h"

// The Memory Link's data (memory_link_savedata.c, a descriptive name): what was read from up to three Black or White
// saves to unlock the memories. The save keeps it at 0x68 of SaveControl, and the data that ov331 reads has it after
// the key information.

#define MEMORY_LINK_PLAYER_COUNT 3
#define MEMORY_LINK_FLAG_COUNT 16
#define MEMORY_LINK_VAR_COUNT 3
#define MEMORY_LINK_MEMORY_COUNT 8
#define MEMORY_LINK_UNK2C_COUNT 6

// The player of a Black or White save
typedef struct {
    u32 id;
    u16 name[8];
    u8 gender;
    u8 version;
    // Set in the Memory Link's data once the save is linked
    u8 linked;
} MemoryLinkPlayer; // size: 0x18

// What a Black or White save gives to unlock the memories
typedef struct {
    // Bits from event flags and from a word of block 52
    u8 flags[MEMORY_LINK_FLAG_COUNT / 8];
    // Event work variables
    u16 vars[MEMORY_LINK_VAR_COUNT];
    // The musical props owned
    u8 props[0x20];
    // The points of all the musical's shows and the shows played, from the save's musical block (MusicalSave)
    u16 musicalTotalPoints;
    u16 musicalShowCount;
    u8 unk2C[MEMORY_LINK_UNK2C_COUNT][0x3c];
} MemoryLinkMemories; // size: 0x194

// The summary of a Black or White save that is linked (ov332's wb_save_convert.c makes it)
typedef struct {
    MemoryLinkPlayer player;
    MemoryLinkMemories memories;
} MemoryLinkData; // size: 0x1ac

// The Memory Link's data in the save. Each player is the one whose save gave a part of the memories: the flags and
// variables, the musical props, and unk2C
typedef struct MemoryLinkSave {
    MemoryLinkPlayer players[MEMORY_LINK_PLAYER_COUNT];
    MemoryLinkMemories memories;
} MemoryLinkSave; // size: 0x1dc

// What MemoryLinkSave_GetValue gives
enum {
    MEMORY_LINK_KIND_MUSICAL_TOTAL_POINTS,
    MEMORY_LINK_KIND_MUSICAL_SHOW_COUNT,
    // Copies an entry of unk2C to dest
    MEMORY_LINK_KIND_UNK2C_0,
    MEMORY_LINK_KIND_UNK2C_5 = MEMORY_LINK_KIND_UNK2C_0 + MEMORY_LINK_UNK2C_COUNT - 1,
    // Copies a player to dest, if there is one
    MEMORY_LINK_KIND_PLAYER_0,
    MEMORY_LINK_KIND_PLAYER_2 = MEMORY_LINK_KIND_PLAYER_0 + MEMORY_LINK_PLAYER_COUNT - 1,
    // Copies the musical props to dest, if there is one, and gives their address
    MEMORY_LINK_KIND_PROPS,
};

// Clears the data
void zero476Bytes(MemoryLinkSave *link);
// Links a Black or White save: TRUE when it unlocked a memory
BOOL MemoryLinkSave_Merge(MemoryLinkSave *link, const MemoryLinkData *data, SaveControl *save);
// TRUE when no save is linked yet, or when the save's player (ID, name, gender) is the one of every part that the
// save would change
BOOL MemoryLinkSave_CanMerge(MemoryLinkSave *link, const MemoryLinkData *data, SaveControl *save);
// A value of a kind, MEMORY_LINK_KIND_*, copied to dest for some kinds
u32 MemoryLinkSave_GetValue(MemoryLinkSave *link, u32 kind, void *dest);
// A flag and a variable of the memories
BOOL MemoryLinkSave_IsMemoryFlagSet(MemoryLinkSave *link, int index);
u16 MemoryLinkSave_GetVar(MemoryLinkSave *link, u32 index);
// Whether a player's slot is linked, and the player's gender and name
BOOL MemoryLinkSave_IsPlayerLinked(MemoryLinkSave *link, int index);
u8 MemoryLinkSave_GetPlayerGender(MemoryLinkSave *link, u32 index);
const u16 *MemoryLinkSave_GetPlayerName(MemoryLinkSave *link, u32 index);
// Whether a memory is unlocked, and the event work that marks it seen
BOOL MemoryLinkSave_CheckMemoryCondition(MemoryLinkSave *link, u32 memory);
u32 MemoryLink_GetMemoryEventWork(u32 memory);

#endif // POKEBW2_SAVE_MEMORY_LINK_SAVEDATA_H
