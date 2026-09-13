#include "w2u_pwan_archive.h"

#include "nds/fs.h"

// Config v3 needs 16 + 768 * 5 = 3856 bytes at the runtime override cap.
// Keep tools/pwan/build_pwan_narc.py's size guard in sync.
#define W2U_PWAN_CONFIG_CACHE_BYTES 4096u

namespace w2u {
namespace pwan_archive {

struct NarcHeader {
    u32 id;
    u16 bom;
    u16 version;
    u32 fileSize;
    u16 headerSize;
    u16 chunkCount;
};

struct NarcFatHeader {
    u32 id;
    u32 chunkSize;
    u16 fileCount;
    u16 reserved;
};

struct NarcFntHeader {
    u32 id;
    u32 chunkSize;
};

struct NarcFimgHeader {
    u32 id;
    u32 chunkSize;
};

struct NarcFatEntry {
    u32 start;
    u32 end;
};

struct ArchiveCache {
    b32 initialized;
    b32 valid;
    u32 fatEntryOffset;
    u32 fimgDataOffset;
    u16 fileCount;
    b32 lastEntryValid;
    u32 lastEntryMemberId;
    NarcFatEntry lastEntry;
};

struct ConfigCache {
    b32 initialized;
    b32 valid;
    u32 size;
    u8 data[W2U_PWAN_CONFIG_CACHE_BYTES];
};

static ArchiveCache sArchiveCache = {};
static ConfigCache sConfigCache = {};

static void CopyBytes(void *dst, const void *src, u32 size)
{
    u8 *out = (u8 *)dst;
    const u8 *in = (const u8 *)src;
    for (u32 i = 0; i < size; ++i) {
        out[i] = in[i];
    }
}

static b32 ReadExact(FSFile *file, void *buffer, u32 size)
{
    return romfs_fread(file, buffer, size) == size;
}

static b32 SeekRead(FSFile *file, u32 offset, void *buffer, u32 size)
{
    return romfs_fseek(file, offset, IO_SEEK_SET) && ReadExact(file, buffer, size);
}

static b32 InitArchive()
{
    if (sArchiveCache.initialized) {
        return sArchiveCache.valid;
    }

    sArchiveCache.initialized = true;
    sArchiveCache.valid = false;

    FSFile file;
    finit(&file);
    if (!romfs_fopen(&file, W2U_PWAN_ARCHIVE_PATH)) {
        return false;
    }

    NarcHeader header = {};
    NarcFatHeader fat = {};
    NarcFntHeader fnt = {};
    NarcFimgHeader fimg = {};
    b32 ok = SeekRead(&file, 0, &header, sizeof(header));
    if (ok) {
        ok = header.id == 0x4352414Eu &&
             header.bom == 0xFFFEu &&
             header.headerSize == sizeof(NarcHeader) &&
             header.chunkCount == 3u;
    }

    if (ok) {
        ok = SeekRead(&file, header.headerSize, &fat, sizeof(fat)) &&
             fat.id == 0x46415442u &&
             fat.reserved == 0u;
    }

    const u32 fntOffset = header.headerSize + fat.chunkSize;
    if (ok) {
        ok = SeekRead(&file, fntOffset, &fnt, sizeof(fnt)) &&
             fnt.id == 0x464E5442u;
    }

    const u32 fimgOffset = fntOffset + fnt.chunkSize;
    if (ok) {
        ok = SeekRead(&file, fimgOffset, &fimg, sizeof(fimg)) &&
             fimg.id == 0x46494D47u;
    }

    romfs_fclose(&file);

    if (!ok) {
        return false;
    }

    sArchiveCache.fatEntryOffset = header.headerSize + sizeof(NarcFatHeader);
    sArchiveCache.fimgDataOffset = fimgOffset + sizeof(NarcFimgHeader);
    sArchiveCache.fileCount = fat.fileCount;
    sArchiveCache.lastEntryValid = false;
    sArchiveCache.valid = true;
    return true;
}

u32 MemberIdForAsset(u32 assetId)
{
    return assetId + 1u;
}

static b32 ReadMemberEntry(FSFile *file, u32 memberId, NarcFatEntry *entry)
{
    if (sArchiveCache.lastEntryValid && sArchiveCache.lastEntryMemberId == memberId) {
        *entry = sArchiveCache.lastEntry;
        return true;
    }

    const u32 fatOffset = sArchiveCache.fatEntryOffset + memberId * sizeof(NarcFatEntry);
    if (!SeekRead(file, fatOffset, entry, sizeof(*entry)) ||
        entry->end < entry->start) {
        return false;
    }

    sArchiveCache.lastEntryValid = true;
    sArchiveCache.lastEntryMemberId = memberId;
    sArchiveCache.lastEntry = *entry;
    return true;
}

static b32 LoadConfigCache()
{
    if (sConfigCache.initialized) {
        return sConfigCache.valid;
    }

    sConfigCache.initialized = true;
    sConfigCache.valid = false;
    if (!InitArchive() || W2U_PWAN_CONFIG_MEMBER_ID >= sArchiveCache.fileCount) {
        return false;
    }

    FSFile file;
    finit(&file);
    if (!romfs_fopen(&file, W2U_PWAN_ARCHIVE_PATH)) {
        return false;
    }

    NarcFatEntry entry = {};
    b32 ok = ReadMemberEntry(&file, W2U_PWAN_CONFIG_MEMBER_ID, &entry);
    const u32 memberSize = entry.end - entry.start;
    if (ok) {
        ok = memberSize <= W2U_PWAN_CONFIG_CACHE_BYTES;
    }
    if (ok) {
        ok = SeekRead(&file, sArchiveCache.fimgDataOffset + entry.start,
                      sConfigCache.data, memberSize);
    }

    romfs_fclose(&file);
    if (!ok) {
        return false;
    }

    sConfigCache.size = memberSize;
    sConfigCache.valid = true;
    return true;
}

static b32 ReadConfigCacheRange(u32 offset, void *buffer, u32 size)
{
    if (!LoadConfigCache()) return false;
    if (offset > sConfigCache.size || size > sConfigCache.size - offset) {
        return false;
    }
    if (size != 0u) {
        CopyBytes(buffer, sConfigCache.data + offset, size);
    }
    return true;
}

b32 ReadMemberRange(u32 memberId, u32 offset, void *buffer, u32 size)
{
    if (!buffer && size != 0u) return false;
    if (!InitArchive()) return false;
    if (memberId >= sArchiveCache.fileCount) return false;

    if (memberId == W2U_PWAN_CONFIG_MEMBER_ID &&
        ReadConfigCacheRange(offset, buffer, size)) {
        return true;
    }

    FSFile file;
    finit(&file);
    if (!romfs_fopen(&file, W2U_PWAN_ARCHIVE_PATH)) {
        return false;
    }

    NarcFatEntry entry = {};
    b32 ok = ReadMemberEntry(&file, memberId, &entry);
    const u32 memberSize = entry.end - entry.start;
    if (ok) {
        ok = offset <= memberSize &&
             size <= memberSize - offset;
    }
    if (ok && size != 0u) {
        ok = SeekRead(&file, sArchiveCache.fimgDataOffset + entry.start + offset, buffer, size);
    }

    romfs_fclose(&file);
    return ok;
}

} // namespace pwan_archive
} // namespace w2u
