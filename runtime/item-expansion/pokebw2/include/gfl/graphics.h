#ifndef POKEBW2_GFL_GRAPHICS_H
#define POKEBW2_GFL_GRAPHICS_H

#include "types.h"
#include "gfl/heap.h"
#include "nitro/fx.h"
#include "nitro/gx.h"
#include "nnsys/g2d.h"
#include "nnsys/gfd.h"
#include "struct_decls.h"

struct G3DTextDrawResource {
    u16 unk0;
    u16 unk2;
    u32 unk4;
    u32 unk8;
    u32 unkC;
    u32 unk10;
};

BOOL G3DTextDraw_CreateResource(void *texture, const char *texName, u32 a2, const char *plName, const StrBuf *text,
                                u16 a5, u16 a6, u16 color, HeapID heapId, G3DTextDrawResource *resource);
u32 G3DTextDraw_GetTexDimCount(void);
// NitroSDK's GX functions are in nitro/gx.h

#endif // POKEBW2_GFL_GRAPHICS_H
