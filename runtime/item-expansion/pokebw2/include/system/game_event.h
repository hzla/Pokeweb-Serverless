#ifndef POKEBW2_SYSTEM_GAME_EVENT_H
#define POKEBW2_SYSTEM_GAME_EVENT_H

// Names, layouts and constants from swan (https://github.com/ds-pokemon-hacking/swan, GPL-3.0)

#include "types.h"
#include "struct_decls.h"

typedef enum {
    GAMEEVENT_CONTINUE = 0x0,
    GAMEEVENT_DONE = 0x1,
    // Runs the current event again in the same frame, such as an event that was just chained
    GAMEEVENT_CONTINUE_DIRECT = 0x21,
} GameEventReturnCode;

typedef GameEventReturnCode (*GameEventCallback)(GameEvent *event, u32 *state, void *data);
// Creates an event for GameEvent_CreateOverlayDelegate, after it loads the event's overlay
typedef GameEvent *(*GameEventProvider)(GameSystem *gsys, void *args);

void GameEvent_ChainNext(GameEvent *event, GameEvent *next);
// Loads an overlay and runs the event that provider, in it, creates with args
GameEvent *GameEvent_CreateOverlayDelegate(GameSystem *gsys, u32 overlayId, GameEventProvider provider, void *args);
// Runs a proc of an overlay, then calls onEnd, if it is given, with arg
GameEvent *EventFieldSubprocessTransition_CreateWithCallback(GameSystem *gsys, Field *field, u32 overlayId,
                                                             const GameProcFunctions *functions, void *param,
                                                             void (*onEnd)(void *arg), void *arg);
GameEvent *GameEvent_Create(GameSystem *gsys, GameEvent *parent, GameEventCallback callback, u32 size);
// Gives the event a new callback and new data of size bytes
void GameEvent_Transplant(GameEvent *event, GameEventCallback callback, u32 size);
void *GameEvent_GetData(GameEvent *event);
GameSystem *GameEvent_GetGameSystem(GameEvent *event);
u32 *GameEvent_GetStatePtr(GameEvent *event);
// Frees the event and runs next in its place: next returns to the event that called this one
void GameEvent_Replace(GameEvent *event, GameEvent *next);
// The event that goes on when this one is done, or NULL
GameEvent *GameEvent_GetReturnEvent(GameEvent *event);
// Runs the current event, and the ones it returns to while they ask for it. Whether the last event ended
BOOL GSYS_UpdateEvents(GameSystem *gsys);
// Starts the event that provider creates, if it creates one and no event is running
BOOL GSYS_FeedEventsFromProvider(GameSystem *gsys, GameEventProvider provider, void *data);

#endif // POKEBW2_SYSTEM_GAME_EVENT_H
