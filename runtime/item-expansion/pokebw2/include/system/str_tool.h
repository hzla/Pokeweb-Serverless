#ifndef POKEBW2_SYSTEM_STR_TOOL_H
#define POKEBW2_SYSTEM_STR_TOOL_H

#include "types.h"
#include "struct_decls.h"

// Numbers as strings, raw strings, accents and case, and compressed strings (str_tool.c, a guessed name)

// How GFL_WordSetFormatNumber pads a number to its digits
#define NUM_PAD_NONE 0
#define NUM_PAD_SPACE 1
#define NUM_PAD_ZERO 2

// Writes a number in digits characters, the last of which is always printed; ascii picks ASCII digits over full-width
// ones. A negative number gets a minus sign first
void GFL_WordSetFormatNumber(StrBuf *strbuf, s32 number, u32 digits, u32 pad, BOOL ascii);
// Copies at most n characters, the last of which is always the terminator
void wcharsncpy(const u16 *src, u16 *dest, u32 n);
// Returns TRUE if the strings are the same
BOOL wcharscmp(const u16 *a, const u16 *b);
u16 GFL_StrCharToUpperCase(u16 c);
u16 GFL_StrCharRemoveAccents(u16 c);
// Returns TRUE if the strings are the same, taking accented letters as their plain ones
BOOL GFL_StrBufCmpIgnoreAccents(const StrBuf *a, const StrBuf *b);
// Copies src, expanding it if it is compressed, as Trainer names in message file 409 are
void GFL_StrBufUncompress(StrBuf *dest, const StrBuf *src);
BOOL GFL_StrBufIsCompressed(const StrBuf *strbuf);

#endif // POKEBW2_SYSTEM_STR_TOOL_H
