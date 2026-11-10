#ifndef POKEBW2_APP_MUSICAL_MUSICAL_SYSTEM_H
#define POKEBW2_APP_MUSICAL_MUSICAL_SYSTEM_H

// Overlay 210's musical_system.c (named after its string): the musical's Pokémon, made from a party Pokémon or from
// a photo's record, and the program's data, loaded from one of the built-in programs' archives or from a downloaded
// program in the save data

#include "types.h"
#include "gfl/heap.h"
#include "struct_decls.h"

// The musical's data
struct Ov210Work {
    // The program: 0 to 3 for the built-in ones, 4 or more for the downloaded one
    u8 program;
    void *unk4;
    // The archive of the program's messages
    void *msgArc;
    // The program's script for overlay 209's stage, a table of the offsets of its scripts
    u32 *script;
    // One allocation holding the sizes of the three sound files, then the files
    u32 *soundData;
    // The program's sound data, which the stage passes to the sound functions
    void *sound[3];
    // The sizes of unk4, msgArc and script
    u32 size[3];
    // The size of soundData
    u32 soundDataSize;
};

// A prop a Pokémon wears on the stage
typedef struct {
    u16 itemId;
    s16 unk2;
    // The slot it is worn on
    u8 slot;
} MusicalPokeEquip;

// A Pokémon on the stage
struct MusicalPoke {
    // Who frees it: 0 the event, 1 the communication, 2 the stage; 4 when it is made
    u32 owner;
    // The party Pokémon it was made from, or NULL
    PartyPkm *pkm;
    u16 species;
    u8 sex;
    u8 form;
    u8 rare;
    u32 personality;
    MusicalPokeEquip equips[9];
    u16 points;
    u16 unk4C[4];
    BOOL unk54[9];
    u16 unk78;
};

// Whether a party Pokémon can join the musical: not an egg, and not in a form it would lose in a box
BOOL MusicalSystem_CanJoin(PartyPkm *pkm);
MusicalPoke *MusicalSystem_InitPokeFromPkm(PartyPkm *pkm, HeapID heapId);
MusicalPoke *MusicalSystem_InitPoke(u16 species, u8 sex, u8 form, u8 rare, u32 personality, HeapID heapId);
Ov210Work *MusicalSystem_InitProgramData(HeapID heapId);
void MusicalSystem_FreeProgramData(Ov210Work *work);
// Loads a program's data
void MusicalSystem_LoadProgramData(Ov210Work *work, SaveControl *save, GameData *gameData, u8 program, HeapID heapId);

#endif // POKEBW2_APP_MUSICAL_MUSICAL_SYSTEM_H
