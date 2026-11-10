#ifndef FW_NATIVE_SHADOW_H
#define FW_NATIVE_SHADOW_H
#include "native.h"
void fwn_shadow_reset(void);
void fwn_shadow_prepare(Actor *actor);
void fwn_shadow_draw(void *system,void *camera,void *light,Actor *actor);
#endif
