#include "native.h"
#include "positioning.h"
#define FWP_FILE "rom:/following/positioning.narc"
static uint16_t u16(const uint8_t *p){return p[0]|(uint16_t)p[1]<<8;}
static uint32_t u32(const uint8_t *p){return u16(p)|(uint32_t)u16(p+2)<<16;}
static int read_at(void *file,unsigned at,void *out,unsigned size){
 return CALL(0x02070e55,int(*)(void*,int,unsigned))(file,(int)at,0)&&
  CALL(0x02070e6d,unsigned(*)(void*,void*,unsigned))(file,out,size)==size;
}
static int record(unsigned kind,unsigned row,unsigned count,uint32_t crc,uint8_t *out){
 uint32_t file[32];uint8_t head[84];unsigned length,size,land,surf,at,bytes;
 CALL(0x02070ca9,void(*)(void*))(file);
 if(!CALL(0x02070ecd,int(*)(void*,const char*))(file,FWP_FILE))return 0;
 size=CALL(0x02070ded,unsigned(*)(void*))(file);
 int ok=read_at(file,0,head,sizeof(head));
 if(ok){
  length=u32(head+32);land=u16(head+66);surf=u16(head+68);
  ok=u32(head)==0x4352414eu&&u16(head+4)==0xfeffu&&u16(head+6)==1u&&
   u32(head+8)==size&&u32(head+16)==0x46415442u&&u32(head+20)==20u&&
   u32(head+24)==1u&&u32(head+28)==0u&&u32(head+36)==0x464e5442u&&
   u32(head+40)==16u&&u32(head+52)==0x46494d47u&&
   u32(head+56)==length+8u&&u32(head+60)==0x4f505746u&&
   u16(head+64)==1u&&head[70]==12u&&head[71]==8u&&
   length==24u+land*12u+surf*8u&&size==60u+length&&
   (kind?surf:land)==count&&row<count;
  if(!kind)ok=ok&&u32(head+72)==crc;
  at=84u+(kind?land*12u+row*8u:row*12u);
  bytes=kind?8u:12u;
  if(ok)ok=read_at(file,at,out,bytes);
  if(ok&&!kind)for(unsigned i=0;i<4;++i)if(out[i]>FW_MAX_DIRECTIONAL_GAP)ok=0;
  if(ok&&kind)for(unsigned i=0;i<8;++i){int value=(int8_t)out[i];if(value<-32||value>32)ok=0;}
 }
 CALL(0x02070de1,int(*)(void*))(file);
 return ok;
}
int fwp_land(unsigned row,unsigned count,uint32_t registry_crc,uint8_t out[12]){
 return record(0,row,count,registry_crc,out);
}
#ifdef FW_MOUNT
int fwp_surf(unsigned row,unsigned count,uint8_t out[8]){
 return record(1,row,count,0,out);
}
#endif
