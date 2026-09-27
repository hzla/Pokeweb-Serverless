#include "following.h"
#include "core_api.h"
#define API __attribute__((visibility("default")))
static uint16_t PokewebFollowingCore_ExtensionCount;
/* The overlay-36 field module validates and streams the registry before it
 * publishes the archive bounds. The resident core retains only this count. */
API int PokewebFollowingPublish(unsigned descriptors) {
    PokewebFollowingCore_ExtensionCount=0;
    if (descriptors<=FW_STOCK_ROWS || descriptors>FW_STOCK_ROWS+FW_MAX_ROWS) return 0;
    PokewebFollowingCore_ExtensionCount=descriptors-FW_STOCK_ROWS;
    return 1;
}
API void PokewebFollowingClear(void) { PokewebFollowingCore_ExtensionCount=0; }
API const FwcApi FollowingCoreAPI={FWC_ABI,sizeof(FwcApi),PokewebFollowingPublish,PokewebFollowingClear};
API uint16_t PokewebFollowingObjectRow(uint16_t code) { return fw_object_row(code,PokewebFollowingCore_ExtensionCount); }
