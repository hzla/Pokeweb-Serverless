#ifndef POKEWEB_PWAN_TYPES_H
#define POKEWEB_PWAN_TYPES_H

#include "swantypes.h"

#define W2U_PWAN_CONFIG_MAGIC 0x434E5750u
#define W2U_PWAN_CONFIG_VERSION 3u
#define W2U_PWAN_CONFIG_HEADER_BYTES 16u
#define W2U_PWAN_CONFIG_ENTRY_BYTES 5u
#define W2U_PWAN_CONFIG_FORM_MASK 0x1fu
#define W2U_PWAN_CONFIG_FRONT_FLAG 1u
#define W2U_PWAN_CONFIG_BACK_FLAG 2u

#ifndef W2U_PWAN_DIAGNOSTICS
#define W2U_PWAN_DIAGNOSTICS 0
#endif

#if !W2U_PWAN_DIAGNOSTICS
namespace w2u {
namespace pwan_profile {

struct SinkWord {
    template <typename T>
    SinkWord &operator=(T)
    {
        return *this;
    }

    template <typename T>
    SinkWord &operator+=(T)
    {
        return *this;
    }

    template <typename T>
    SinkWord &operator|=(T)
    {
        return *this;
    }

    template <typename T>
    T operator+(T rhs) const
    {
        return rhs;
    }

    operator u32() const
    {
        return 0;
    }
};

} // namespace pwan_profile
} // namespace w2u
#endif

struct W2U_PwanConfigHeader {
    u32 magic;
    u16 version;
    u16 count;
    u16 maxTimeline;
    u16 reserved;
    u32 entriesOffset;
};

struct W2U_PwanConfigEntry {
    u16 species;
    u16 form;
    u16 flags;
    u16 assetIndex;
};

static inline W2U_PwanConfigEntry W2U_DecodePwanConfigEntry(const u8 *raw)
{
    W2U_PwanConfigEntry entry;
    entry.species = (u16)(((u16)raw[0]) | (((u16)raw[1]) << 8));
    entry.form = (u16)(raw[2] & W2U_PWAN_CONFIG_FORM_MASK);
    entry.flags = (u16)((raw[2] >> 5) & 0x3u);
    entry.assetIndex = (u16)(((u16)raw[3]) | (((u16)raw[4]) << 8));
    return entry;
}

static inline u32 W2U_PwanConfigEntryOffset(const W2U_PwanConfigHeader *header, u32 index)
{
    return header->entriesOffset + index * W2U_PWAN_CONFIG_ENTRY_BYTES;
}

extern "C" {
extern u8 W2U_PwanFrameScratch[0x1200];
extern u8 W2U_PwanTextureScratch[0x3000];
}

#endif
