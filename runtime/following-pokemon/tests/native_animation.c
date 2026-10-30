#include "render_math.h"
#include <assert.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
int main(void){
 unsigned checks=0;
 for(unsigned projection=0;projection<3;++projection)
 for(int x=-4;x<=4;++x)for(int z=-4;z<=4;++z){
  if(!x&&!z)continue;
  for(int y=0;y<=8;++y){
   FwrCamera camera={{x*65536,y*65536,z*65536},{0,0,0},projection};
   FwPoint anchor={100*4096,20*4096,200*4096};
   for(int bob=-8*4096;bob<=8*4096;bob+=2048){
    FwPoint native=anchor;native.y+=bob;FwPoint out;
    assert(fwr_animation_plane(&native,bob,&camera,&out));
    long long depth=(long long)(out.x-anchor.x)*x+(long long)(out.y-anchor.y)*y+(long long)(out.z-anchor.z)*z;
    assert(llabs(depth)<=64); /* Fixed-point projection roundoff, no depth bias. */
    /* Removing the normal component preserves orthographic screen location. */
    long long rx=(long long)(out.x-native.x)*z-(long long)(out.z-native.z)*x;
    assert(llabs(rx)<=16);++checks;
   }
  }
 }
 FwrCamera bad={{0,0,0},{0,0,0},2};FwPoint p={1,2,3},out;
 assert(!fwr_animation_plane(&p,4096,&bad,&out)&&out.x==1&&out.y==2&&out.z==3);
 bad.eye.z=4096;bad.eye.y=4096;bad.projection=3;assert(!fwr_animation_plane(&p,4096,&bad,&out));
 bad.projection=2;assert(!fwr_animation_plane(&p,8*FW_TILE+1,&bad,&out));
 p=(FwPoint){INT32_MAX,INT32_MAX,INT32_MAX};assert(!fwr_animation_plane(&p,-4096,&bad,&out));
 assert(!fwr_animation_plane(&p,4096,0,&out));
 printf("Animation-plane checks passed: %u camera/projection/bob combinations; invalid views and overflow rejected.\n",checks);
}
