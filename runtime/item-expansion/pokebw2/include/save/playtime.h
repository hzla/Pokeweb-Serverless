#ifndef POKEBW2_SAVE_PLAYTIME_H
#define POKEBW2_SAVE_PLAYTIME_H

#include "types.h"
#include "gfl/heap.h"
#include "struct_decls.h"

#define PLAYTIME_MAX_HOURS 999

struct PlayTime {
    u16 hours;
    u8 minutes;
    u8 seconds;
    // The date and time of the last save
    union {
        u32 lastSaved;
        struct {
            u32 year : 7;
            u32 month : 4;
            u32 day : 5;
            u32 hour : 5;
            u32 minute : 6;
        };
    };
};

PlayTime *setupPlaytimeCounters(HeapID heapId);
void PlayTime_Init(PlayTime *time);
// Adds seconds to the play time, which stops at PLAYTIME_MAX_HOURS:59:59
void updateGameTime(PlayTime *time, u32 addSeconds);
void PlayTime_Copy(PlayTime *dest, const PlayTime *src);
u16 PlayTime_GetHours(PlayTime *time);
u8 PlayTime_GetMinutes(PlayTime *time);
u8 PlayTime_GetSeconds(PlayTime *time);
// Sets the date and time of the last save to now
void PlayTime_SetLastSavedToNow(PlayTime *time);
u32 PlayTime_GetLastSavedYear(PlayTime *time);
u32 PlayTime_GetLastSavedMonth(PlayTime *time);
u32 PlayTime_GetLastSavedDay(PlayTime *time);
u32 PlayTime_GetLastSavedHour(PlayTime *time);
u32 PlayTime_GetLastSavedMinute(PlayTime *time);
// Copy the word with the date and time of the last save out and back
void PlayTime_GetLastSaved(PlayTime *time, u32 *copy);
void PlayTime_SetLastSaved(PlayTime *time, u32 *copy);

#endif // POKEBW2_SAVE_PLAYTIME_H
