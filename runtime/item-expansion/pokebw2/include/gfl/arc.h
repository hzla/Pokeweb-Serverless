#ifndef POKEBW2_GFL_ARC_H
#define POKEBW2_GFL_ARC_H

#include "types.h"
#include "gfl/heap.h"
#include "struct_decls.h"

// Archives (arc_tool.c): NARC files, from the file system by the path of each archive ID, or from memory. An ArcTool
// keeps an archive open to read its files

// The file system path of an archive, which an earlier file than arc_tool.c defines (0x020057b8)
const char *GFL_ArcSysGetResourcePath(u32 arcId);
// Sets the paths of the archives, by archive ID
void GFL_ArcSysInit(const char **paths, u32 count);
ArcTool *GFL_ArcSysCreateFileHandle(u32 arcId, HeapID heapId);
ArcTool *GFL_ArcSysCreateMemoryHandle(void *data, u32 size, HeapID heapId);
// Reads a file of the archive at path into a new allocation
void *GFL_ArcSysReadHeapNewDirect(const char *path, u32 fileId, HeapID heapId);
u32 GFL_ArcSysGetDataLength(u32 arcId, u32 fileId);
void GFL_ArcToolCopyDataOfs(ArcTool *handle, u32 fileId, u32 *offset);
u32 GFL_ArcToolGetDataMax(ArcTool *handle);
void GFL_ArcToolFree(ArcTool *handle);
void GFL_ArcToolRead(ArcTool *handle, u32 fileId, void *dest);
// Reads on from where the last read stopped
void GFL_ArcToolReadRaw(ArcTool *handle, u32 size, void *dest);
void GFL_ArcToolReadRange(ArcTool *handle, u32 fileId, u32 offset, u32 size, void *dest);
void GFL_ArcSysRead(void *dest, u32 arcId, u32 fileId);
void GFL_ArcSysReadRange(void *dest, u32 arcId, u32 fileId, u32 offset, u32 size);
void *GFL_ArcSysReadHeapNew(u32 arcId, u32 fileId, HeapID heapId);
// The count of files in the archive
u32 GFL_ArcSysGetDataMax(u32 arcId);
void *GFL_ArcSysReadHeapNewRange(u32 arcId, u32 fileId, HeapID heapId, u32 offset, u32 size);
u32 GFL_ArcToolGetDataLength(ArcTool *handle, u32 fileId);
void *GFL_ArcToolReadHeapNew(ArcTool *handle, u32 fileId, HeapID heapId);
// Read an archive's files in pieces: the offset of a file in the archive, and seeking to an offset and reading from it
u32 GFL_ArcToolGetDataOfs(ArcTool *handle, u32 fileId);
void GFL_ArcToolSeek(ArcTool *handle, u32 offset);
void GFL_ArcToolReadRaw(ArcTool *handle, u32 size, void *dest);

#if defined(WHITE2) && defined(W2U_CHECKED_ITEM_READ) && !defined(BLACK2)
// Exact-size record from the canonical ROM table archive, without allocation.
// destination is private scratch and may be partly changed on FALSE.
BOOL W2U_GFLArcTryReadRecord(u32 arcId, u32 fileId, void *destination, u32 size);
#endif

#endif // POKEBW2_GFL_ARC_H
