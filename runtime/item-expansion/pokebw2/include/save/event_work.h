#ifndef POKEBW2_SAVE_EVENT_WORK_H
#define POKEBW2_SAVE_EVENT_WORK_H

#include "types.h"
#include "struct_decls.h"

// The saved event work values, EVENT_WORK_0x4000 to EVENT_WORK_0x41ae, and the saved event flags, up to the
// hidden items'
#define EVENT_WORK_COUNT 431
#define EVENT_FLAG_SAVED_COUNT 3064
// The flags from EVENT_FLAG_TEMP_0, which the save does not hold
#define EVENT_FLAG_TEMP_COUNT 64

struct EventWork {
    u16 works[EVENT_WORK_COUNT];
    u8 flags[EVENT_FLAG_SAVED_COUNT / 8];
    // Set with the day's flags reset, cleared when read
    u8 hiddenItemRespawn;
}; // 0x4de

u32 EventWork_GetBlockSize(void);
void EventWork_Init(EventWork *eventWork);
BOOL EventWork_FlagGet(EventWork *eventWork, u16 flag);
void EventWork_FlagReset(EventWork *eventWork, u16 flag);
void EventWork_FlagResetRange(EventWork *eventWork, u16 first, u16 last);
void EventWork_FlagSet(EventWork *eventWork, u16 flag);
// Whether the hidden items that come back may come back today
BOOL EventWork_GetHiddenItemRespawnFlag(EventWork *eventWork);
u16 *EventWork_GetWkPtr(EventWork *eventWork, u16 work);
void EventWork_WorkResetRange(EventWork *eventWork, u16 first, u16 last);
// Clears the flags and work values that last a day
void EventWork_ResetDailyFlags(EventWork *eventWork);

#endif // POKEBW2_SAVE_EVENT_WORK_H
