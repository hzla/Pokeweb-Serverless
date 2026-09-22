#ifndef W2U_PWAN_ARCHIVE_H
#define W2U_PWAN_ARCHIVE_H

#include "swantypes.h"

#define W2U_PWAN_ARCHIVE_PATH "zz_pokeweb_pwan/pwan.narc"
#define W2U_PWAN_CONFIG_MEMBER_ID 0u

namespace w2u {
namespace pwan_archive {

u32 MemberIdForAsset(u32 assetId);
b32 ReadMemberRange(u32 memberId, u32 offset, void *buffer, u32 size);

} // namespace pwan_archive
} // namespace w2u

#endif // W2U_PWAN_ARCHIVE_H
