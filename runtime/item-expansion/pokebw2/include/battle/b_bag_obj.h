#ifndef POKEBW2_BATTLE_B_BAG_OBJ_H
#define POKEBW2_BATTLE_B_BAG_OBJ_H

#include "types.h"
#include "struct_decls.h"

// The battle bag's OBJ resources and cell actors (b_bag_obj.c, our name)

void BBagObj_Init(BBagWork *wk);
void BBagObj_Exit(BBagWork *wk);
void BBagObj_SetPage(BBagWork *wk, u8 page);

#endif // POKEBW2_BATTLE_B_BAG_OBJ_H
