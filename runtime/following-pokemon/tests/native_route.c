#include "native_route.h"
#include <assert.h>
#include <limits.h>
#include <stdio.h>
static FwSample sample(int x,int y,int z,unsigned dir){return (FwSample){.x=x*4096,.y=y*4096,.z=z*4096,.generation=1,.space=1,.kind=FW_WORLD,.direction=dir,.duration=1};}
static void line(unsigned gap,unsigned speed,unsigned dir){
 FwFollower f;fw_init(&f,1);FwNativeRoute route;fwn_route_reset(&route);
 for(unsigned d=0;d<4;++d)f.directional_gap[d]=(uint8_t)gap;
 FwPoint current={0};FwSample out;
 for(unsigned n=0;n<128;n+=speed){
  int x=dir==2?-(int)n:dir==3?(int)n:0,z=dir==0?-(int)n:dir==1?(int)n:0;
  FwSample s=sample(x,0,z,dir);
  int result=fwn_route_step(&route,&f,&s,&current,&out);assert(result>=0);
  if(result==1){
   int behind=dir<2?(s.z-out.z):(s.x-out.x);if(behind<0)behind=-behind;
   assert(behind>=(int)(16+gap)*4096-64&&behind<=(int)(16+gap)*4096+64);
   current=(FwPoint){out.x,out.y,out.z};f.state=FW_FOLLOWING;
  }
 }
}
int main(void){
 assert(sizeof(FwNativeRoute)==1852); /* Heading state occupies existing padding. */
 for(unsigned gap=0;gap<=20;++gap)for(unsigned speed=1;speed<=4;speed*=2)for(unsigned dir=0;dir<4;++dir)line(gap,speed,dir);
 assert(fw_tile(-1)==-1&&fw_tile(-FW_TILE)==-1&&fw_tile(-FW_TILE-1)==-2&&fw_tile(FW_TILE)==1);
 FwFollower f;fw_init(&f,1);FwSample out;
 uint8_t gaps[4]={0};
 for(int x=0;x<=48;x+=3){FwSample s=sample(x,x/3,0,3);int ok=fw_trail_push_directional(&f.trail,&s,&out,gaps);assert(ok>=0);if(ok)assert(out.y>=out.x/3-1&&out.y<=out.x/3+1);}
 for(int z=3;z<35;z+=3){FwSample s=sample(48,16,z,1);assert(fw_trail_push_directional(&f.trail,&s,&out,gaps)==1);assert(out.z==0||out.x==48*4096);}
 FwTrail saved=f.trail;FwPoint delta={32*FW_TILE,0,-32*FW_TILE};assert(fw_trail_translate(&f.trail,&delta));
 assert(f.trail.samples[f.trail.head].x==saved.samples[saved.head].x+delta.x);
 delta=(FwPoint){INT32_MAX,0,0};saved=f.trail;assert(!fw_trail_translate(&f.trail,&delta));assert(f.trail.samples[f.trail.head].x==saved.samples[saved.head].x);
 unsigned direction,tiles;for(unsigned code=0x69;code<=0x98;++code){assert(fwn_pedestrian(code,&direction,&tiles));assert(direction<4);assert(tiles==(code>=0x75&&code<=0x78?3u:0u));}
 assert(!fwn_pedestrian(0x68,&direction,&tiles)&&!fwn_pedestrian(0x99,&direction,&tiles));
 assert(fwn_large_indoor(2,0)&&!fwn_large_indoor(2,1)&&!fwn_large_indoor(0,0));
 FwPoint a={0},b={4*FW_TILE,0,0};assert(fwn_reposition(&a,&b));b.x=FW_TILE;assert(!fwn_reposition(&a,&b));
 FwNativeRoute r;fwn_route_reset(&r);fw_init(&f,1);FwPoint current={0};
 for(int x=0;x<=64;++x){FwSample s=sample(x,0,0,3);if(fwn_route_step(&r,&f,&s,&current,&out)==1){current=(FwPoint){out.x,out.y,out.z};f.state=FW_FOLLOWING;}}
 FwSample standing=sample(64,0,0,2);fwn_route_step(&r,&f,&standing,&current,&out);
 assert(r.player.direction==3); /* Face-only turns must not erase incoming travel. */
 for(int x=63;x>=0;--x){FwSample s=sample(x,0,0,2);FwPoint old=current;int result=fwn_route_step(&r,&f,&s,&current,&out);if(result<0){fprintf(stderr,"reverse x=%d count=%u dist=%u swap=%u progress=%u\n",x,f.trail.count,f.trail.distance,r.swapping,r.progress);assert(0);}if(result){current=(FwPoint){out.x,out.y,out.z};assert(current.x-old.x<=4*4096&&old.x-current.x<=4*4096);}}
 /* Half-unit slow walking must fit bounded history even with the largest gap. */
 fw_init(&f,1);fwn_route_reset(&r);current=(FwPoint){0};for(unsigned i=0;i<4;++i)f.directional_gap[i]=20;
 for(int n=0;n<400;++n){FwSample slow=sample(0,0,0,3);slow.x=n*2048;
  int ok=fwn_route_step(&r,&f,&slow,&current,&out);assert(ok>=0);
  if(ok){current=(FwPoint){out.x,out.y,out.z};f.state=FW_FOLLOWING;}
  assert(f.trail.count<FW_TRAIL_CAPACITY);
 }
 FwSample wrong=sample(200,0,0,3);wrong.generation=2;
 assert(fwn_route_step(&r,&f,&wrong,&current,&out)==-1&&f.trail.count==0);
 /* Continuous rail headings travel with their recorded poses. Reversals
  * invert both the heading and its rail input key, without changing layout. */
 fw_init(&f,1);fwn_route_reset(&r);current=(FwPoint){0};
 for(int x=0;x<=64;++x){
  FwSample s=sample(x,0,0,3);s.rail=0x4000;s.connection=FWN_RAIL_HEADING|3u;
  if(fwn_route_step(&r,&f,&s,&current,&out)==1){current=(FwPoint){out.x,out.y,out.z};f.state=FW_FOLLOWING;}
 }
 for(int x=63;x>=0;--x){
  FwSample s=sample(x,0,0,2);s.rail=0xc000;s.connection=FWN_RAIL_HEADING|2u;
  int ok=fwn_route_step(&r,&f,&s,&current,&out);assert(ok>=0);
  if(ok){assert(fwn_has_heading(&out)&&out.rail==0xc000&&(out.connection&3u)==2&&out.direction==2);current=(FwPoint){out.x,out.y,out.z};}
 }
 FwSample grid=sample(0,0,0,0);assert(!fwn_has_heading(&grid));grid.kind=FW_RAIL;grid.connection=FWN_RAIL_HEADING;assert(!fwn_has_heading(&grid));
 fw_init(&f,1);fwn_route_reset(&r);current=(FwPoint){0};for(unsigned i=0;i<4;++i)f.directional_gap[i]=20;
 for(int n=0;n<400;++n){
  FwSample s=sample(0,0,0,3);s.x=n*2048;s.rail=(uint16_t)(0x4000+n);s.connection=FWN_RAIL_HEADING|3u;
  int ok=fwn_route_step(&r,&f,&s,&current,&out);assert(ok>=0&&f.trail.count<FW_TRAIL_CAPACITY);
  if(ok){assert(fwn_has_heading(&out));current=(FwPoint){out.x,out.y,out.z};f.state=FW_FOLLOWING;}
 }
 FwTrail angular={0};angular.count=2;angular.distance=FW_TILE;uint8_t no_gap[4]={0};
 angular.samples[0]=sample(0,0,0,3);angular.samples[1]=sample(16,0,0,3);
 angular.samples[0].rail=0xfff0;angular.samples[1].rail=0x10;
 angular.samples[0].connection=angular.samples[1].connection=FWN_RAIL_HEADING|3u;
 assert(fw_trail_pose(&angular,no_gap,FW_TILE/2,&out)&&out.rail==0);
 puts("Native route: 252 direction/gap/speed scenarios, slopes, corners, reversal continuity, tile floor, atomic translation, movement classes, indoor size policy passed.");
}
