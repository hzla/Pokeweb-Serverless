#include "shadow_metrics.h"
static unsigned u16(const uint8_t *p){return p[0]|(unsigned)p[1]<<8;}
static unsigned u32(const uint8_t *p){return u16(p)|(unsigned)u16(p+2)<<16;}
static int read_bytes(const FwnShadowInput *in,unsigned at,void *out,unsigned size){
 return at<=in->size&&size<=in->size-at&&in->read(in->context,at,out,size);
}
static int opaque(unsigned value,unsigned format,unsigned zero){
 if(format==1)return value>>5;
 if(format==6)return value>>3;
 if(format==7)return value&0x8000u;
 return !zero||value;
}
static int width(const FwnShadowInput *in,unsigned at,unsigned bytes,unsigned w,
                 unsigned format,unsigned zero,unsigned *maximum){
 uint8_t page[512];unsigned first=w,last=0,pixel=0;
 unsigned bits=format==2?2:format==3?4:format==7?16:8;
 for(unsigned done=0;done<bytes;){
  unsigned count=bytes-done;if(count>sizeof(page))count=sizeof(page);
  if(!read_bytes(in,at+done,page,count))return 0;
  for(unsigned b=0;b<count;++b){
   unsigned value=page[b],n=8/bits;
   if(bits==16){value=u16(page+b);++b;n=1;}
   for(unsigned i=0;i<n;++i,++pixel){
    unsigned v=bits==16?value:(value>>(i*bits))&((1u<<bits)-1u);
    if(opaque(v,format,zero)){unsigned x=pixel%w;if(x<first)first=x;if(x>last)last=x;}
   }
  }
  done+=count;
 }
 if(first<w&&last-first+1>*maximum)*maximum=last-first+1;
 return 1;
}
int fwn_shadow_measure(const FwnShadowInput *in,unsigned resource,unsigned *diameter){
 uint8_t h[60],entry[8];unsigned fat,member,end,filename,image,tex=0,texSize=0;
 if(!in||!in->read||!diameter||in->size>0x1fffffffu||!read_bytes(in,0,h,28)||
    u32(h)!=0x4352414eu||!((u16(h+4)==0xfeffu&&u16(h+6)==1)||
                          (u16(h+4)==0xfffeu&&u16(h+6)==0x100u))||u32(h+8)!=in->size||
    u16(h+12)!=16||u16(h+14)!=3||u32(h+16)!=0x46415442u||
    u32(h+24)>65535||resource>=u32(h+24))return 0;
 fat=u32(h+20);
 if(fat!=12+u32(h+24)*8||fat>in->size-16||
    !read_bytes(in,28+resource*8,entry,8))return 0;
 member=u32(entry);end=u32(entry+4);filename=16+fat;
 if(!read_bytes(in,filename,h,8)||u32(h)!=0x464e5442u||u32(h+4)<8||
    u32(h+4)>in->size-filename)return 0;
 image=filename+u32(h+4);
 if(!read_bytes(in,image,h,8)||u32(h)!=0x46494d47u||u32(h+4)<8||
    u32(h+4)!=in->size-image||end<member||end>u32(h+4)-8)return 0;
 member+=image+8;end+=image+8;
 if(end-member<20||end-member>0x40000u||!read_bytes(in,member,h,20)||
    u32(h)!=0x30585442u||u16(h+4)!=0xfeffu||u16(h+6)!=1||
    u32(h+8)!=end-member||u16(h+12)!=16||!u16(h+14)||u16(h+14)>4)return 0;
 unsigned blocks=u16(h+14);
 for(unsigned i=0;i<blocks;++i){
  if(16+4*blocks>end-member||!read_bytes(in,member+16+4*i,entry,4))return 0;
  unsigned offset=u32(entry);
  if(offset<16+4*blocks||offset>end-member-8||!read_bytes(in,member+offset,entry,8))return 0;
  unsigned size=u32(entry+4);
  if(size<8||size>end-member-offset)return 0;
  if(u32(entry)==0x30584554u){if(tex)return 0;tex=member+offset;texSize=size;}
 }
 if(!tex||texSize<60||!read_bytes(in,tex,h,60))return 0;
 unsigned data=u32(h+20),dataSize=u16(h+12)*8,dict=u16(h+14);
 if(data>texSize||dataSize>texSize-data||dict>texSize-16||!read_bytes(in,tex+dict,h,12))return 0;
 unsigned frames=h[1],dictSize=u16(h+2);
 if(!frames||frames>16||dictSize<16+28*frames||dictSize>texSize-dict||
    u16(h+4)!=8||u16(h+6)!=12+4*frames||u32(h+8)!=0x17fu)return 0;
 unsigned records=dict+12+frames*4;
 if(!read_bytes(in,tex+records,h,4)||u16(h)!=8||u16(h+2)!=4+frames*8)return 0;
 unsigned maximum=0;
 for(unsigned i=0;i<frames;++i){
  if(!read_bytes(in,tex+records+4+i*8,entry,8))return 0;
  unsigned params=u16(entry+2),format=(params>>10)&7;
  unsigned w=8u<<((params>>4)&7),height=8u<<((params>>7)&7);
  if(w>64||height>64||!format||format==5)return 0;
  unsigned bits=format==2?2:format==3?4:format==7?16:8;
  unsigned size=w*height*bits/8,offset=u16(entry)*8;
  if(offset>dataSize||size>dataSize-offset||!width(in,tex+data+offset,size,w,format,params&0x2000u,&maximum))return 0;
 }
 if(!maximum)return 0;
 /* Field bodies use 7/8 world units per pixel. Half their widest opaque
  * span is a grounded default; transparent canvas padding has no influence. */
 unsigned result=(maximum*7+8)/16;
 if(result<8)result=8;
 if(result>32)result=32;
 *diameter=result;return 1;
}
