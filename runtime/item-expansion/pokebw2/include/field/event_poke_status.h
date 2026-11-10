#ifndef POKEBW2_FIELD_EVENT_POKE_STATUS_H
#define POKEBW2_FIELD_EVENT_POKE_STATUS_H

#include "types.h"
#include "struct_decls.h"

// Overlay 20's event_poke_status.c (named after its embedded string): the field events that open the party list or
// the summary screen for a script command, and give back the Pokémon or the move picked. The names are ours

#define OVERLAY_EVENT_POKE_STATUS OVERLAY_ID(20)

// The arguments of the party list events
typedef struct {
    // TRUE once a Pokémon was picked
    u16 *picked;
    // The party slot of the Pokémon picked
    u16 *index;
    // The party list's mode (EventPokeSelect_Create only)
    u32 mode;
} PokeSelectArgs;

// The arguments of the move tutors' party list, where the player chooses who learns a tutor's move
typedef struct {
    u16 *picked;
    u16 *index;
    // A bit for each Pokémon that can learn the move
    u8 learnable;
    u16 move;
} MoveTutorPokeSelectArgs;

// The arguments of the summary screen that picks a move to forget for a new one
typedef struct {
    // TRUE once a move was picked
    u16 *forgot;
    // The slot of the move to forget
    u16 *slot;
    u8 partyIndex;
    u16 move;
    // HMs can be forgotten too
    BOOL forgetHm;
} PokeMoveReplaceArgs;

// Events for GameEvent_CreateOverlayDelegate
// The party list in the mode PokeSelectArgs gives
GameEvent *EventPokeSelect_Create(GameSystem *gsys, void *args);
// The move tutors' party list, with MoveTutorPokeSelectArgs (see scrcmd_shop.c)
GameEvent *EventMoveTutorPokeSelect_Create(GameSystem *gsys, void *args);
// The musical's party list, which can show a Pokémon's summary, with PokeSelectArgs (see scrcmd_musical.c)
GameEvent *EventMusicalPokeSelect_Create(GameSystem *gsys, void *args);
// The summary screen's move page, to forget a move for PokeMoveReplaceArgs' move (see scrcmd_shop.c)
GameEvent *EventPokeMoveReplace_Create(GameSystem *gsys, void *args);

#endif // POKEBW2_FIELD_EVENT_POKE_STATUS_H
