#ifndef POKEBW2_SAVE_ENCOUNTER_H
#define POKEBW2_SAVE_ENCOUNTER_H

#include "types.h"
#include "struct_decls.h"

// Block 0x37, the wild encounters' save (encounter_savedata.c, a guessed name): the roaming Pokémon, the swarm, the
// repel and the special Pokémon that were caught

#define ENCOUNT_SAVE_ROAMING_COUNT 2
// The special Pokémon that caughtFlags has a bit for
#define ENCOUNT_SAVE_N_POKE_COUNT 14
// The swarm's locations
#define ENCOUNT_SAVE_SWARM_LOCATION_COUNT 19

// The fields of a roaming Pokémon, for EncountSave_GetRoamingPkmParam
#define ROAMING_PKM_PARAM_ZONE 1
#define ROAMING_PKM_PARAM_IVS 2
#define ROAMING_PKM_PARAM_PERSONALITY 3
#define ROAMING_PKM_PARAM_SPECIES 4
#define ROAMING_PKM_PARAM_HP 5
#define ROAMING_PKM_PARAM_LEVEL 6
#define ROAMING_PKM_PARAM_STATUS 7
#define ROAMING_PKM_PARAM_ACTIVE 8
#define ROAMING_PKM_PARAM_UNK13 9
#define ROAMING_PKM_PARAM_NATURE 10

typedef struct {
    u16 zone;
    u8 nature;
    u32 ivs;
    u32 personality;
    u16 species;
    u16 hp;
    u8 level;
    u8 status;
    // Whether the Pokémon roams
    u8 active;
    u8 unk13;
} RoamingPkm;

struct EncountSave {
    RoamingPkm roamingPkm[ENCOUNT_SAVE_ROAMING_COUNT];
    // Each roaming Pokémon's place in ROAMING_POKEMON_ZONES
    u8 roamingZoneClocks[ENCOUNT_SAVE_ROAMING_COUNT];
    u8 unk2A[ENCOUNT_SAVE_ROAMING_COUNT];
    // An index of overlay 36's swarm table
    u8 swarmLocation;
    u8 repelSteps;
    // The repel that was used last
    u16 repelItem;
    // A bit for each special Pokémon that was caught
    u16 caughtFlags;
};

// The size of the block
u32 EncountSave_GetBlockSize(void);
void EncountSave_Init(EncountSave *save);
void EncountSave_RerollSwarmLocation(SaveControl *save);
// The swarm's location, an index of overlay 36's swarm table
u8 EncountSave_GetSwarmLocation(EncountSave *save);
u8 func_0200dd38(EncountSave *save, u8 index);
u8 EncountSave_GetRoamingPkmZoneClock(EncountSave *save, u8 slot);
// The roaming Pokémon of the slot, whether it roams, and its parameters
BOOL EncountSave_GetRoamingPkmStatus(EncountSave *save, u8 slot);
RoamingPkm *EncountSave_GetRoamingPkm(EncountSave *save, u8 slot);
u32 EncountSave_GetRoamingPkmParam(const RoamingPkm *roamingPkm, u32 param);
void EncountSave_SetRepelSteps(EncountSave *save, u8 steps);
// Takes a step off the repel, and returns whether that was its last
BOOL EncountSave_DecrementRepelSteps(EncountSave *save);
// Whether the repel has run out
BOOL EncountSave_IsRepelDepleted(EncountSave *save);
// Sets the repel that was used last
void EncountSave_SetUsedRepelItemID(EncountSave *save, u16 item);
// The Repel that was used last
u16 EncountSave_GetUsedRepelItemID(EncountSave *save);
int GetAlreadyCaughtNPokeCount(EncountSave *save);
BOOL IsNPokeAlreadyCaught(EncountSave *save, u8 index);
// Marks the special Pokémon of the index caught
void SetNPokeCaught(EncountSave *save, u8 index);

#endif // POKEBW2_SAVE_ENCOUNTER_H
