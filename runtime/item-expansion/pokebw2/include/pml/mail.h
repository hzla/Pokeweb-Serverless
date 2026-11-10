#ifndef POKEBW2_PML_MAIL_H
#define POKEBW2_PML_MAIL_H

#include "types.h"
#include "gfl/heap.h"
#include "struct_decls.h"
#include "system/pms_data.h"

// Names from swan
typedef struct MailData {
    u32 trainerId;
    u8 trainerGender;
    u8 region;
    u8 gameVersion;
    u8 design;
    u16 trainerName[8];
    u16 unk18[3];
    // The word of the mail's stamp, 0xffff when there is none
    u16 stampWord;
    PMSData message[3];
} MailData;

#define MAIL_COUNT 20
#define MAIL_DESIGN_COUNT 12
#define MAIL_DESIGN_MAX 11

// Whether the mail is filled in, which is when its design is one of the MAIL_DESIGN_COUNT
BOOL MailData_IsValid(const MailData *mail);
// Allocates a blank mail
MailData *CreateMailData(HeapID heapId);
// Empties the mail
void ResetMailData(MailData *mail);
void copyMailMsg(const MailData *src, MailData *dest);
// Empties the mail, then sets its design and the author's info from the game data
void MailData_InitForPlayer(MailData *mail, u32 design, u32 unused, GameData *gameData);
u32 MailData_GetTrainerID(const MailData *mail);
u16 *MailData_GetTrainerName(MailData *mail);
// Sets the mail's author's name
void MailData_SetTrainerName(MailData *mail, const u16 *name);
u8 MailData_GetTrainerGender(const MailData *mail);
u8 MailData_GetDesign(const MailData *mail);
void MailData_SetDesign(MailData *mail, u32 design);
u8 MailData_GetRegion(const MailData *mail);
u8 MailData_GetGameVersion(const MailData *mail);
u16 MailData_GetStampWord(const MailData *mail);
void MailData_SetStampWord(MailData *mail, u16 value);
PMSData *MailData_GetMessage(MailData *mail, u8 index);
void MailData_SetMessage(MailData *mail, const PMSData *src, u8 index);
// The save block of mail, and its size
void *MailBox_GetFromGameData(GameData *gameData);
u32 MailBox_GetSize(void);
// Empties all of the mails of a mailbox
void MailBox_Clear(MailData *mails);
// The mail of the save's mailbox (box 0) or of a Pokémon: the free slot, and clearing, copying and reading a slot's
// mail
s32 MailBox_GetFreeSlot(MailData *mails, u32 box);
void MailBox_ResetMail(MailData *mails, u32 box, u32 index);
void MailBox_SetMail(MailData *mails, u32 box, u32 index, const MailData *mail);
MailData *MailBox_CopyMail(MailData *mails, u32 box, u32 index, HeapID heapId);
s32 MailBox_FindFree(MailData *mails, s32 count);
MailData *MailBox_GetMail(MailData *mails, u32 box, s32 index);

#endif // POKEBW2_PML_MAIL_H
