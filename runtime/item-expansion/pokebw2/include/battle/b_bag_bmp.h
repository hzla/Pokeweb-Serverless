#ifndef POKEBW2_BATTLE_B_BAG_BMP_H
#define POKEBW2_BATTLE_B_BAG_BMP_H

#include "types.h"
#include "struct_decls.h"

void BBagBmp_Init(BBagWork *work);
void BBagBmp_Exit(BBagWork *work);
void BBagBmp_DrawPage(BBagWork *work, u8 page);
void BBagBmp_DrawSlots(BBagWork *work);
void BBagBmp_PrintPageNumber(BBagWork *work);
void BBagBmp_OpenMessage(BBagWork *work);
void BBagBmp_FlushWindows(BBagWork *work);
void BBagBmp_TransferPage(BBagWork *work);

#endif // POKEBW2_BATTLE_B_BAG_BMP_H
