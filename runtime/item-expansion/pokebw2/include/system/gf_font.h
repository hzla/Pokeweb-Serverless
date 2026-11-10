#ifndef POKEBW2_SYSTEM_GF_FONT_H
#define POKEBW2_SYSTEM_GF_FONT_H

#include "types.h"
#include "gfl/heap.h"
#include "struct_decls.h"

// Fonts and the colors their glyphs are drawn in (gf_font.c)

// A glyph's placement in its cell: the column it starts at, its width, how far it advances the pen, and its height
typedef struct {
    u8 x;
    u8 width;
    u8 advance;
    u8 height;
} GlyphInfo;

// loadType 0 reads each glyph from the file when it is drawn, and 1 loads them all; with fixedWidth every character
// advances by the default width
Font *GFL_FontCreate(u32 arcId, u32 fileId, u32 loadType, BOOL fixedWidth, HeapID heapId);
void GFL_FontFree(Font *font);

// Draws a character's glyph into dest, a 2x2-tile bitmap's pixels
void GFL_FontGetGlyph(Font *font, u16 c, void *dest, GlyphInfo *info);
u32 GFL_FontGetCharWidth(Font *font, u16 c);
u8 GFL_FontGetCharHeight(Font *font);

// The letter, shadow and background color indices the glyphs are drawn with, and whether they differ from these
void GFL_TextRndGetGlobalColors(u8 *letter, u8 *shadow, u8 *background);
BOOL GFL_TextRndCheckColorIndexChange(u8 letter, u8 shadow, u8 background);
void GFL_TextRndUpdateColorIndexLUT(u8 letter, u8 shadow, u8 background);
// Both call GFL_TextRndUpdateColorIndexLUT(1, 2, 0)
void GFL_TextRndInitColorIndexLUT(void);
void GFL_TextRndResetColorIndexLUT(void);

#endif // POKEBW2_SYSTEM_GF_FONT_H
