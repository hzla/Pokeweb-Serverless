#ifndef POKEBW2_SYSTEM_TEXT_SPEED_H
#define POKEBW2_SYSTEM_TEXT_SPEED_H

#include "types.h"
#include "struct_decls.h"

// The waits between characters that system/printsys.h's streams take. The file these are in has no name in the ROM

// Sets the save control whose options give the text speed
void saveMainSaveAreaAddress(SaveControl *save);
// Returns the wait between characters for the text speed in the save data, or for a text speed from 0 to 4
s32 TextSpeed_GetCurrentWait(void);
s32 TextSpeed_GetWait(u32 speed);
// The waits of the speeds one step faster and one step slower than the save's
s32 TextSpeed_GetFasterWait(void);
s32 TextSpeed_GetSlowerWait(void);

#endif // POKEBW2_SYSTEM_TEXT_SPEED_H
