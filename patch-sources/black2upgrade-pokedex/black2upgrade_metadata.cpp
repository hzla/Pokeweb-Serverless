#include "swan/swantypes.h"

// Kept as exported data so artifact and loader-side verification can reject a
// mismatched game, ABI, or expansion-data package before installing the DLL.
extern "C" {
const char PMCGameID[] = "B2";
const u32 Black2UpgradeRuntimeABI = 1u;
const u32 Black2UpgradeDataVersion = 1u;
}
