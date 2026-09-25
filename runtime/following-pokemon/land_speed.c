#include "land_speed.h"
#include <limits.h>
unsigned fwl_step_frames(unsigned code){
 switch(code&~3u){case 0x54:return 1;case 0x14:return 2;case 0x50:return 3;
 case 0x10:case 0x58:return 4;case 0x4c:return 6;case 0x0c:return 8;default:return 0;}
}
unsigned fwl_step_code(unsigned speed,unsigned nativeCode,int32_t *error){
 unsigned base=nativeCode&~3u,dir=nativeCode&3u;
 if(!error || (base!=0x0cu&&base!=0x58u&&base!=0x10u))return nativeCode;
 if(speed>255)speed=255;
 unsigned rate=100+3*speed;if(rate>800)rate=800;
 static const uint8_t length[6]={1,2,3,4,6,8};
 static const uint8_t command[6]={0x54,0x14,0x50,0x10,0x4c,0x0c};
 int target=*error+800,best=INT_MAX;unsigned picked=0;
 for(unsigned i=0;i<6;++i){
  int distance=target-(int)length[i]*(int)rate;
  if(distance<0)distance=-distance;
  if(distance<best){best=distance;picked=i;}
 }
 *error=target-(int)length[picked]*(int)rate;
 return command[picked]+dir;
}
