#ifndef POKEBW2_SYSTEM_BMP_MENUWORK_H
#define POKEBW2_SYSTEM_BMP_MENUWORK_H

#include "types.h"
#include "gfl/heap.h"
#include "gfl/msg.h"
#include "gfl/str.h"
#include "struct_decls.h"

// Names from swan (https://github.com/ds-pokemon-hacking/swan, GPL-3.0), except LIST_MENU_END

// The options of a list menu (bmp_menuwork.c): an array of strings and their values, which ends with an option whose
// text is LIST_MENU_END and whose value is the heap the array was allocated from. Options not added yet have no text

typedef struct {
    StrBuf *text;
    s32 value;
} ListMenuOption;

#define LIST_MENU_END ((StrBuf *)-1)

ListMenuOption *ListMenuCore_CreateOptionList(u32 count, u32 heapId);
// Frees the options' strings and the array
void ListMenuCore_FreeOptionList(ListMenuOption *options);
// Adds an option after the last one, with a message or a copy of text, unless the array is full
void ListMenuCore_AppendMsgOption(ListMenuOption *options, MsgData *msgData, u32 messageId, s32 value, HeapID heapId);
void ListMenuCore_AppendStrBufOption(ListMenuOption *options, const StrBuf *text, s32 value, HeapID heapId);
// Frees the options' strings, leaving the array empty
void ListMenuCore_FreeStrBufs(ListMenuOption *options);
// The number of options in the list
u32 ListMenuCore_GetFirstFreeIndex(const ListMenuOption *options);

#endif // POKEBW2_SYSTEM_BMP_MENUWORK_H
