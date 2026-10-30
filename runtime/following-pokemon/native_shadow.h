#ifndef FW_NATIVE_SHADOW_H
#define FW_NATIVE_SHADOW_H
#include "native.h"
/* Use the native shadow ID for body exclusion. This keeps its edge-colour
 * group and native overlapping-shadow blend suppression intact. */
#define FWN_SHADOW_BODY_ID 2u
void fwn_shadow_draw(void *system,void *camera,void *light,Actor *actor);
#endif
