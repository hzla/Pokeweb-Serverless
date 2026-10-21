// BW2 C-Gear quick actions: read this file first, then follow the includes.
// These .inc files are sections of ONE translation unit, not separate modules.
// Keeping their order preserves private linkage and the existing native ABI.
#include "runtime.h"
#include "native_addresses.h"
#include "../pokenav/logic.h"
#include "../nuzlocke-encounters/runtime.h"
#include "pc.generated.h"
#include "shop.generated.h"
#include "shop_picker.generated.h"
#include "dial.generated.h"

namespace {
#include "bw2/session.inc"
#include "bw2/game_state.inc"
#include "bw2/configuration.inc"
#include "bw2/actors_and_dial.inc"
#include "bw2/resources.inc"
#include "bw2/update.inc"
#include "bw2/requests.inc"
#include "bw2/shop.inc"
} // namespace

#include "bw2/hooks.inc"
