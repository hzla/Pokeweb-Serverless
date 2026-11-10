#ifndef POKEBW2_APP_ITEMMENU_DISP_H
#define POKEBW2_APP_ITEMMENU_DISP_H

#include "types.h"
#include "struct_decls.h"

// The bag's screens, in overlay 142 (itemmenu_disp.c)

void ItemMenuDisp_ShowBGs(void);
void ItemMenuDisp_Init(ItemMenuWork *work);
void ItemMenuDisp_FreeBGChars(ItemMenuWork *work);
void ItemMenuDisp_ShowTMInfoBGs(ItemMenuWork *work, BOOL show);
void ItemMenuDisp_ShowTMIcons(ItemMenuWork *work, BOOL keys);
void ItemMenuDisp_DrawItemInfo(ItemMenuWork *work);
void ItemMenuDisp_HideItemInfo(ItemMenuWork *work);
void ItemMenuDisp_Exit(ItemMenuWork *work);
void ItemMenuDisp_CreateWindows(ItemMenuWork *work);
void ItemMenuDisp_Update(ItemMenuWork *work);
void ItemMenuDisp_LoadListRes(ItemMenuWork *work);
void ItemMenuDisp_CreateListActors(ItemMenuWork *work);
void ItemMenuDisp_DrawList(ItemMenuWork *work);
void ItemMenuDisp_UpdateListCursor(ItemMenuWork *work);
void ItemMenuDisp_UpdateListRows(ItemMenuWork *work);
void ItemMenuDisp_TouchScrollBar(ItemMenuWork *work);
void ItemMenuDisp_UpdateScrollBar(ItemMenuWork *work);
void ItemMenuDisp_CreatePocketTabs(ItemMenuWork *work);
void ItemMenuDisp_SetPocketTab(ItemMenuWork *work, u32 pocket);
void ItemMenuDisp_ClearMsgWindow(ItemMenuWork *work);
void ItemMenuDisp_OpenItemMenu(ItemMenuWork *work, u32 *msgIds, s32 count);
void ItemMenuDisp_OpenSortMenu(ItemMenuWork *work, u32 *msgIds, s32 count);
void ItemMenuDisp_OpenFilterMenu(ItemMenuWork *work, u8 count);
void ItemMenuDisp_LoadPocketFrame(ItemMenuWork *work, u32 pocket);
void ItemMenuDisp_ShowMessage(ItemMenuWork *work, BOOL a1);
void ItemMenuDisp_ShowMessageNow(ItemMenuWork *work);
void ItemMenuDisp_SetItemMenuMessage(ItemMenuWork *work, u32 item);
BOOL ItemMenuDisp_IsMessageDone(ItemMenuWork *work);
void ItemMenuDisp_CreatePocketWindows(ItemMenuWork *work);
void ItemMenuDisp_FreePocketWindows(ItemMenuWork *work);
void ItemMenuDisp_DrawPocketName(ItemMenuWork *work, u32 pocket);
void ItemMenuDisp_DrawMoney(ItemMenuWork *work);
void ItemMenuDisp_ShowMoney(ItemMenuWork *work);
void ItemMenuDisp_HideMoney(ItemMenuWork *work);
void ItemMenuDisp_OpenYesNoMenu(ItemMenuWork *work);
void ItemMenuDisp_CloseMenu(ItemMenuWork *work);
void ItemMenuDisp_DrawQuantityFrame(ItemMenuWork *work);
void ItemMenuDisp_DrawQuantity(ItemMenuWork *work, s32 quantity);
u32 ItemMenuDisp_GetPocketShortcut(s32 pocket);
void ItemMenuDisp_SetListCursorPalette(ItemMenuWork *work, u32 state);
void ItemMenuDisp_SetButtonsActive(ItemMenuWork *work, BOOL active);
void ItemMenuDisp_SetBackButtonActive(ItemMenuWork *work, BOOL a1);
void ItemMenuDisp_UpdateSortButton(ItemMenuWork *work);
void ItemMenuDisp_SetMoveButtons(ItemMenuWork *work, BOOL a1);
BOOL ItemMenuDisp_SlidePocketTabs(ItemMenuWork *work);
void ItemMenuDisp_FlushWindows(ItemMenuWork *work);

#endif // POKEBW2_APP_ITEMMENU_DISP_H
