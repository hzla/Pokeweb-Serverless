#ifndef FOLLOWING_LAND_SPEED_H
#define FOLLOWING_LAND_SPEED_H
#include <stdint.h>
/* Returns the native directional command for an ordinary flat-grid step. */
unsigned fwl_step_code(unsigned speed,unsigned nativeCode,int32_t *error);
unsigned fwl_step_frames(unsigned code);
#endif
