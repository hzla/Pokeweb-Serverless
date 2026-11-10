#ifndef POKEBW2_GFL_ARC_UTIL_H
#define POKEBW2_GFL_ARC_UTIL_H

#include "types.h"
#include "gfl/heap.h"
#include "nnsys/g2d.h"
#include "struct_decls.h"

// Graphics files of archives (arc_util.c): loading character, screen and palette files to VRAM and reading them, and
// reading files that may be LZ compressed. The functions that take an ArcTool read from an archive kept open, the
// others open the archive by its ID. A size of 0 loads all of a file

// The palette memory a palette file is loaded to
enum {
    PALTYPE_MAIN_BG,
    PALTYPE_MAIN_OBJ,
    PALTYPE_MAIN_BG_EX,
    PALTYPE_MAIN_OBJ_EX,
    PALTYPE_SUB_BG,
    PALTYPE_SUB_OBJ,
    PALTYPE_SUB_BG_EX,
    PALTYPE_SUB_OBJ_EX,
};

// Load a BG's characters at a character offset, and return the size loaded
u32 GFL_BGSysLoadNCGRStatic(u32 arcId, u32 fileId, u32 bg, u32 offset, u32 size, BOOL compressed, HeapID heapId);
u32 GFL_BGSysLoadArcNCGRStatic(ArcTool *arc, u32 fileId, u32 bg, u32 offset, u32 size, BOOL compressed, HeapID heapId);
// Load a BG's characters where there is space, and return their position and size as for GFL_BGSysAllocChar, or 0
u32 GFL_BGSysLoadNCGRDynamic(u32 arcId, u32 fileId, u32 bg, u32 size, BOOL compressed, HeapID heapId);
u32 GFL_BGSysLoadArcNCGRDynamic(ArcTool *arc, u32 fileId, u32 bg, u32 size, BOOL compressed, HeapID heapId);
// Loads OBJ characters of an engine (0 for main, 1 for sub), and returns the size loaded
u32 loadOBJCharToVram(ArcTool *arc, u32 fileId, u32 engine, u32 offset, u32 size, BOOL compressed, HeapID heapId);
// Load a BG's screen, from offset into it
void loadBGScrToVramByNarcNoReserveNegAlign(u32 arcId, u32 fileId, u8 bg, u32 offset, u32 size, BOOL compressed,
                                            HeapID heapId);
void loadBGScrToVramByFileNoReserveNegAlign(ArcTool *arc, u32 fileId, u32 bg, u32 offset, u32 size, BOOL compressed,
                                            HeapID heapId);
// The same, adding a palette offset to each entry of the screen. The asynchronous load waits for the next VBlank
void loadBGScrToVramByNarcNoReserve(u32 arcId, u32 fileId, u8 bg, u32 offset, u32 palOffset, u32 size, BOOL compressed,
                                    HeapID heapId);
void GFL_G2DIOLoadNSCRSync(ArcTool *arc, u32 fileId, u8 bg, u32 offset, u32 palOffset, u32 size, BOOL compressed,
                           HeapID heapId);
void GFL_G2DIOLoadNSCRAsync(ArcTool *arc, u32 fileId, u8 bg, u32 offset, u32 palOffset, u32 size, BOOL compressed,
                            HeapID heapId);
// Load a palette file to an offset in palette memory of a PALTYPE_*
void GFL_BGSysLoadNCLRDefault(u32 arcId, u32 fileId, u32 type, u32 offset, u32 size, HeapID heapId);
void GFL_G2DIOLoadArcNCLRDefault(ArcTool *arc, u32 fileId, u32 type, u32 offset, u32 size, HeapID heapId);
// The same from srcOffset into the file
void GFL_G2DIOLoadNCLR(u32 arcId, u32 fileId, u32 type, u32 srcOffset, u32 offset, u32 size, HeapID heapId);
void GFL_G2DIOLoadArcNCLR(ArcTool *arc, u32 fileId, u32 type, u32 srcOffset, u32 offset, u32 size, HeapID heapId);
// Read a graphics file, and return the file for GFL_HeapFree, or NULL if it is not of its kind
void *GFL_G2DIOReadBGNCGR(u32 arcId, u32 fileId, BOOL compressed, NNSG2dCharacterData **character, HeapID heapId);
void *GFL_G2DIOReadBGNCGRArc(ArcTool *arc, u32 fileId, BOOL compressed, NNSG2dCharacterData **character, HeapID heapId);
void *GFL_G2DIOReadOBJNCGR(u32 arcId, u32 fileId, BOOL compressed, NNSG2dCharacterData **character, HeapID heapId);
void *GFL_G2DIOReadOBJNCGRArc(ArcTool *arc, u32 fileId, BOOL compressed, NNSG2dCharacterData **character,
                              HeapID heapId);
void *GFL_G2DIOReadNSCR(u32 arcId, u32 fileId, BOOL compressed, NNSG2dScreenData **screen, HeapID heapId);
void *GFL_G2DIOReadNSCRArc(ArcTool *arc, u32 fileId, BOOL compressed, NNSG2dScreenData **screen, HeapID heapId);
void *GFL_G2DIOReadNCLR(u32 arcId, u32 fileId, NNSG2dPaletteData **palette, HeapID heapId);
void *GFL_G2DIOReadNCLRArc(ArcTool *arc, u32 fileId, NNSG2dPaletteData **palette, HeapID heapId);
void *GFL_G2DIOReadNCER(u32 arcId, u32 fileId, BOOL compressed, NNSG2dCellDataBank **cells, HeapID heapId);
void *GFL_G2DIOReadNCERArc(ArcTool *arc, u32 fileId, BOOL compressed, NNSG2dCellDataBank **cells, HeapID heapId);
void *GFL_G2DIOReadNANR(u32 arcId, u32 fileId, BOOL compressed, NNSG2dAnimBankData **anims, HeapID heapId);
void *GFL_G2DIOReadNANRArc(ArcTool *arc, u32 fileId, BOOL compressed, NNSG2dAnimBankData **anims, HeapID heapId);
void *GFL_G2DIOReadNMCR(u32 arcId, u32 fileId, BOOL compressed, NNSG2dMultiCellDataBank **cells, HeapID heapId);
void *GFL_G2DIOReadNMCRArc(ArcTool *arc, u32 fileId, BOOL compressed, NNSG2dMultiCellDataBank **cells, HeapID heapId);
void *GFL_G2DIOReadNMAR(u32 arcId, u32 fileId, BOOL compressed, NNSG2dAnimBankData **anims, HeapID heapId);
void *GFL_G2DIOReadNMARArc(ArcTool *arc, u32 fileId, BOOL compressed, NNSG2dAnimBankData **anims, HeapID heapId);
// Read a file into a new allocation, uncompressing it if it is LZ compressed, and return it, and its size by size
void *GFL_ArcSysReadHeapNewLZ(u32 arcId, u32 fileId, BOOL compressed, HeapID heapId);
void *GFL_ArcSysReadHeapNewLZGetLen(u32 arcId, u32 fileId, BOOL compressed, HeapID heapId, u32 *size);
void *GFL_ArcToolReadHeapNewLZ(ArcTool *arc, u32 fileId, BOOL compressed, HeapID heapId);
void *GFL_ArcToolReadHeapNewLZGetLen(ArcTool *arc, u32 fileId, BOOL compressed, u32 heapId, u32 *size);

#endif // POKEBW2_GFL_ARC_UTIL_H
