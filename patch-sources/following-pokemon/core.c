#include "following.h"
#include "registry.h"
#include "core_api.h"
#define API __attribute__((visibility("default")))
static uint16_t PokewebFollowingCore_ExtensionCount;
/* Called only after the field owner has obtained the actual archive bounds.
 * A failed/repeated configuration revokes old bounds before returning. */
API int PokewebFollowingConfigure(const uint8_t *registry, unsigned size, uint16_t descriptors, uint16_t resources) {
    PokewebFollowingCore_ExtensionCount=0;
    if (!fw_registry_validate(registry,size,descriptors,resources)) return 0;
    PokewebFollowingCore_ExtensionCount=descriptors-FW_STOCK_ROWS;
    return 1;
}
API void PokewebFollowingClear(void) { PokewebFollowingCore_ExtensionCount=0; }
API int PokewebFollowingConfigureStream(FwRegistryInput *in) {
 PokewebFollowingCore_ExtensionCount=0;
 if(!fw_registry_stream(in))return 0;
 PokewebFollowingCore_ExtensionCount=in->descriptors-FW_STOCK_ROWS;
 return 1;
}
API const FwcApi FollowingCoreAPI={FWC_ABI,sizeof(FwcApi),PokewebFollowingConfigure,PokewebFollowingClear,PokewebFollowingConfigureStream};
API uint16_t PokewebFollowingObjectRow(uint16_t code) { return fw_object_row(code,PokewebFollowingCore_ExtensionCount); }
