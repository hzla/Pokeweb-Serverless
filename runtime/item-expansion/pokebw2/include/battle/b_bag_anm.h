#ifndef POKEBW2_BATTLE_B_BAG_ANM_H
#define POKEBW2_BATTLE_B_BAG_ANM_H

#include "types.h"
#include "struct_decls.h"

void BBagAnm_CreateButtons(BBagWork *work);
void BBagAnm_DeleteButtons(BBagWork *work);
void BBagAnm_PutPageButtons(BBagWork *work, u8 page);
void BBagAnm_StartButtonAnm(BBagWork *work, u8 button);
void BBagAnm_MainButtonAnm(BBagWork *work);

#endif // POKEBW2_BATTLE_B_BAG_ANM_H
