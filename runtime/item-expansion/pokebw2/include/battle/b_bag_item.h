#ifndef POKEBW2_BATTLE_B_BAG_ITEM_H
#define POKEBW2_BATTLE_B_BAG_ITEM_H

#include "types.h"
#include "struct_decls.h"

BOOL BBagItem_CheckLastItem(BBagWork *work);
void BBagItem_SetCursorToLastItem(BBagWork *work);
void BBagItem_MakePocketLists(BBagWork *work);
void BBagItem_MakeShooterList(BBagWork *work);
void BBagItem_MakeDemoList(BBagWork *work);
u16 BBagItem_GetSlotItem(BBagWork *work, int slot);
u16 BBagItem_GetShooterCost(u16 item);
#if defined(WHITE2) && defined(W2U_EXPANDED_ITEMS) && !defined(BLACK2)
BOOL BBagItem_PrepareLists(BBagWork *work);
void BBagItem_FreeLists(BBagWork *work);
#endif

#endif // POKEBW2_BATTLE_B_BAG_ITEM_H
