#ifndef FOLLOWING_RENDER_MATH_H
#define FOLLOWING_RENDER_MATH_H
#include "following.h"
/* Camera and positions use native 20.12 world units; scale uses native fx16. */
typedef struct { FwPoint eye,target; uint32_t projection; } FwrCamera;
typedef struct { FwPoint position; int32_t sx,sy; } FwrPose;
typedef struct { FwPoint axis; int32_t before,after,policy; } FwrResult;
#define FWR_TIE_MARGIN 512 /* 1/8 world unit; a tile is 16 world units. */
#define FWR_LARGE 1u
#define FWR_NORTH 2u
#define FWR_NORTH_ANCHOR_Z 7
#define FWR_NORTH_ART_Y 2
int fwr_correct(const FwPoint *world,const FwPoint *player_world,
    const FwrPose *native,const FwPoint *player_draw,const FwrCamera *camera,
    unsigned flags,FwrPose *output,FwrResult *result);
#endif
