#ifndef POKEBW2_BATTLE_B_BAG_UI_H
#define POKEBW2_BATTLE_B_BAG_UI_H

#include "types.h"
#include "struct_decls.h"

// The battle bag's key cursor (b_bag_ui.c, our name)

void BBagUi_CreateCursor(BBagWork *work, u8 page, int pos);
void BBagUi_DeleteCursor(BBagWork *work);
void BBagUi_ChangeCursorPage(BBagWork *work, u8 page, int pos);

#endif // POKEBW2_BATTLE_B_BAG_UI_H
