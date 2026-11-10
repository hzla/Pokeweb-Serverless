#ifndef POKEBW2_SAVE_TIMESIG_SAVEDATA_H
#define POKEBW2_SAVE_TIMESIG_SAVEDATA_H

#include "types.h"
#include "struct_decls.h"

#define TIMESIG_BADGE_COUNT 8

// The year, month and day a badge was obtained on
typedef struct {
    u8 year;
    u8 month;
    u8 day;
    u8 unk3;
} TimeSigBadgeDate;

// The save block 0x21 (timesig_savedata.c, a guessed name): the trainer card's signature, when each badge was
// obtained, saved badge polish and the time it was last saved at
struct TimeSigSave {
    u32 signature[0x180];
    // The personality the card shows, 0 to 24 (the natures' names), whether the player changed the union view on
    // the card, and whether the signature blinks between its two frames
    u16 personality;
    u8 unionViewChanged;
    u8 signBlinks;
    TimeSigBadgeDate badgeDates[TIMESIG_BADGE_COUNT];
    union {
        s64 seconds;
        struct {
            u32 secondsLow;
            u32 secondsHigh;
        };
    };
    u8 unk62C[0xc];
    u16 badgePolish[TIMESIG_BADGE_COUNT];
    u8 unk648[0x10];
};

u32 TimeSigSave_GetSize(void);
void TimeSigSave_Init(TimeSigSave *timeSig);
void *getTimeSigBlkAddress(SaveControl *save);
// The block's first 0x600 bytes, which the trainer card copies
void *TimeSigSave_GetSignature(void *timeSig);
BOOL TimeSigSave_HasSignature(TimeSigSave *timeSig);
u8 TimeSigSave_IsUnionViewChanged(TimeSigSave *timeSig);
void TimeSigSave_SetUnionViewChanged(TimeSigSave *timeSig);
u16 TimeSigSave_GetPersonality(TimeSigSave *timeSig);
void TimeSigSave_SetPersonality(TimeSigSave *timeSig, u32 value);
void TimeSigSave_SetSignBlinks(TimeSigSave *timeSig, u8 value);
BOOL TimeSigSave_GetSignBlinks(TimeSigSave *timeSig);
void saveSecondsTime(TimeSigSave *timeSig, u32 low, u32 high);
s64 loadSecondsTime(TimeSigSave *timeSig);
TimeSigBadgeDate TimeSigSave_GetBadgeDate(TimeSigSave *timeSig, u32 badgeId);
void setBadgeGetSecondsTime(TimeSigSave *timeSig, u32 badgeId, u32 year, u32 month, u32 day);
u16 TimeSigSave_GetBadgePolish(TimeSigSave *timeSig, u32 badgeId);
void TimeSigSave_SetBadgePolish(TimeSigSave *timeSig, u32 badgeId, u32 polish);

#endif // POKEBW2_SAVE_TIMESIG_SAVEDATA_H
