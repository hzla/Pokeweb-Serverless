#include "render_math.h"
#include <assert.h>
#include <limits.h>
#include <math.h>
#include <stdio.h>
int main(void){
 unsigned checks=0;
 for(unsigned projection=0;projection<3;++projection)
 for(int x=-4;x<=4;++x)for(int z=-4;z<=4;++z){
  if(!x&&!z)continue;
  for(int pitch=0;pitch<5;++pitch)for(int side=-1;side<=1;++side){
   FwrCamera camera={{x*65536,pitch*65536,z*65536},{0},projection};
   FwPoint ground={100*4096,20*4096,200*4096},anchor={side*8192,0,-8192};
   FwPoint native={ground.x+anchor.x,ground.y,ground.z+anchor.z},out;
   assert(fwr_camera_anchor(&native,&anchor,&camera,&out));
   double length=hypot(x,z),dx=out.x-ground.x,dz=out.z-ground.z;
   assert(fabs((dx*z-dz*x)/length-anchor.x)<16);
   assert(fabs((dx*x+dz*z)/length-anchor.z)<16);
   assert(out.y==native.y);
   if(x==0&&z>0)assert(out.x==native.x&&out.z==native.z);
   ++checks;
  }
 }
 FwPoint native={1,2,3},anchor={8192,0,-8192},out;
 FwrCamera camera={{0,65536,0},{0},2};
 assert(!fwr_camera_anchor(&native,&anchor,&camera,&out)&&out.x==1&&out.y==2&&out.z==3);
 camera.eye.z=65536;camera.projection=3;assert(!fwr_camera_anchor(&native,&anchor,&camera,&out));
 camera.projection=2;anchor.x=8*FW_TILE+1;assert(!fwr_camera_anchor(&native,&anchor,&camera,&out));
 anchor=(FwPoint){8192,1,-8192};assert(!fwr_camera_anchor(&native,&anchor,&camera,&out));
 camera.eye.z=-65536;anchor=(FwPoint){-8192,0,-8192};native.x=INT32_MAX;
 assert(!fwr_camera_anchor(&native,&anchor,&camera,&out));
 printf("Native anchor checks passed: %u camera/projection/facing combinations, canonical-grid equivalence, height preservation and bounded failure.\n",checks);
}
