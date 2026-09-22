#include "following.h"
#include "registry.h"
static uint16_t PokewebFollowingRead16(const uint8_t *p) { return p[0] | (uint16_t)p[1] << 8; }
static uint32_t PokewebFollowingRead32(const uint8_t *p) { return PokewebFollowingRead16(p) | (uint32_t)PokewebFollowingRead16(p+2) << 16; }
int fw_registry_validate(const uint8_t *p, size_t size, uint16_t descriptors, uint16_t resources) {
    if (!p || size < 32 || size > 32+16384*24+65535*8) return 0;
    if (p[0]!='F'||p[1]!='W'||p[2]!='D'||p[3]!='B'||PokewebFollowingRead16(p+6)!=FW_ABI) return 0;
    unsigned version=PokewebFollowingRead16(p+4), stride=24;
#ifdef FW_UPGRADE
    if(version==2||version==4)stride=12;else
#endif
    if(version!=1&&version!=3)return 0;
    unsigned count=PokewebFollowingRead16(p+12), zones=PokewebFollowingRead16(p+14);
    if (!count || count>16384 || size!=32+count*stride+zones*8 || PokewebFollowingRead32(p+8)!=size || PokewebFollowingRead32(p+28)) return 0;
    if (descriptors<=FW_STOCK_ROWS || descriptors>FW_STOCK_ROWS+FW_MAX_ROWS || !resources ||
        PokewebFollowingRead16(p+16)!=descriptors || PokewebFollowingRead16(p+18)!=resources || PokewebFollowingRead16(p+20)!=FW_CODE_BASE || PokewebFollowingRead16(p+22)!=FW_STOCK_ROWS) return 0;
    uint32_t crc=0xffffffffu;
    for (size_t i=0;i<size;++i) {
        crc ^= i>=24&&i<28?0:p[i];
        for (unsigned j=0;j<8;++j) crc=(crc>>1)^((crc&1)?0xedb88320u:0);
    }
    if ((crc^0xffffffffu)!=PokewebFollowingRead32(p+24)) return 0;
    uint32_t last=0;
    for (unsigned i=0;i<count;++i) {
        const uint8_t *e=p+32+i*stride;
        unsigned species, row, resource; uint32_t key;
#ifdef FW_UPGRADE
        if(version==2||version==4) {
            key=PokewebFollowingRead32(e);species=key>>11;
            row=PokewebFollowingRead16(e+4);resource=PokewebFollowingRead16(e+6);
            if(!species||species>FW_MAX_SPECIES||((key>>1)&3)>2||(version<3?(e[8]&~7u):((e[8]&192u)||((e[8]>>3)&7)>FW_MAX_SIDE_GAP)))return 0;
        } else
#endif
        {
            species=PokewebFollowingRead16(e);row=PokewebFollowingRead16(e+6);resource=PokewebFollowingRead16(e+8);
            if (!species || species>FW_MAX_SPECIES || e[3]>2 || e[4]>1 || e[5]>1 || (e[10]!=32&&e[10]!=64) || e[11]>1) return 0;
            if(version==3&&e[15]>FW_MAX_SIDE_GAP)return 0;
            for (unsigned j=version==3?16:15;j<24;++j) if (e[j]) return 0;
            key=species*2048+e[2]*8+e[3]*2+e[4];
        }
        if(row<FW_STOCK_ROWS||row>=descriptors||resource>=resources)return 0;
        if (i && key<=last) return 0;
        last=key;
    }
    last=0;
    for (unsigned i=0;i<zones;++i) {
        const uint8_t *e=p+32+count*stride+i*8;
        unsigned zone=PokewebFollowingRead16(e);
        if ((i&&zone<=last)||e[2]>1||e[3]) return 0;
        last=zone;
    }
    return 1;
}

static uint32_t stream_crc(uint32_t crc,const uint8_t *p,unsigned size){
 while(size--){crc^=*p++;for(unsigned j=0;j<8;++j)crc=(crc>>1)^((0u-(crc&1u))&0xedb88320u);}
 return crc;
}
/* One caller-owned page; no allocation and no retained callbacks or file handles. */
int fw_registry_stream(FwRegistryInput *in){
 if(!in||!in->read||!in->page||!in->index||in->indexCount!=FW_MAX_SPECIES+2||in->size<32)return 0;
 in->count=in->stride=0;
 uint8_t h[32];
 if(!in->read(in->context,0,h,32))return 0;
 unsigned version=PokewebFollowingRead16(h+4),stride=(version==1||version==3)?24:12;
 if(version!=1&&version!=3
#ifdef FW_UPGRADE
    &&version!=2&&version!=4
#endif
 )return 0;
 unsigned count=PokewebFollowingRead16(h+12),zones=PokewebFollowingRead16(h+14);
 if(h[0]!='F'||h[1]!='W'||h[2]!='D'||h[3]!='B'||PokewebFollowingRead16(h+6)!=FW_ABI||
    !count||count>FW_MAX_ROWS||in->size!=32+count*stride+zones*8||PokewebFollowingRead32(h+8)!=in->size||PokewebFollowingRead32(h+28)||
    in->descriptors<=FW_STOCK_ROWS||in->descriptors>FW_STOCK_ROWS+FW_MAX_ROWS||!in->resources||
    PokewebFollowingRead16(h+16)!=in->descriptors||PokewebFollowingRead16(h+18)!=in->resources||
    PokewebFollowingRead16(h+20)!=FW_CODE_BASE||PokewebFollowingRead16(h+22)!=FW_STOCK_ROWS)return 0;
 uint32_t expected=PokewebFollowingRead32(h+24),outer=stream_crc(~0u,h,32);
 for(unsigned i=24;i<28;++i)h[i]=0;
 uint32_t inner=stream_crc(~0u,h,32),last=0;unsigned next=0;
 for(unsigned first=0;first<count;){
  unsigned n=stride==12?85u:42u;if(n>count-first)n=count-first;
  if(!in->read(in->context,32+first*stride,in->page,n*stride))return 0;
  outer=stream_crc(outer,in->page,n*stride);inner=stream_crc(inner,in->page,n*stride);
  for(unsigned i=0;i<n;++i){
   const uint8_t *e=in->page+i*stride;uint32_t key;unsigned species,row,resource;
   if(stride==12){
    key=PokewebFollowingRead32(e);species=key>>11;
    row=PokewebFollowingRead16(e+4);resource=PokewebFollowingRead16(e+6);
    if(((key>>1)&3)>2||(version<3?(e[8]&~7u):((e[8]&192u)||((e[8]>>3)&7)>FW_MAX_SIDE_GAP)))return 0;
   }else{
    species=PokewebFollowingRead16(e);row=PokewebFollowingRead16(e+6);resource=PokewebFollowingRead16(e+8);
    if(e[3]>2||e[4]>1||e[5]>1||(e[10]!=32&&e[10]!=64)||e[11]>1)return 0;
    if(version==3&&e[15]>FW_MAX_SIDE_GAP)return 0;
    for(unsigned j=version==3?16:15;j<24;++j)if(e[j])return 0;
    key=species*2048+e[2]*8+e[3]*2+e[4];
   }
   if(!species||species>FW_MAX_SPECIES||row<FW_STOCK_ROWS||row>=in->descriptors||resource>=in->resources||((first+i)&&key<=last))return 0;
   while(next<=species)in->index[next++]=(uint16_t)(first+i);
   last=key;
  }
  first+=n;
 }
 while(next<in->indexCount)in->index[next++]=(uint16_t)count;
 last=0;
 for(unsigned first=0;first<zones;){
  unsigned n=FW_REGISTRY_PAGE/8;if(n>zones-first)n=zones-first;
  if(!in->read(in->context,32+count*stride+first*8,in->page,n*8))return 0;
  outer=stream_crc(outer,in->page,n*8);inner=stream_crc(inner,in->page,n*8);
  for(unsigned i=0;i<n;++i){const uint8_t *e=in->page+i*8;unsigned zone=PokewebFollowingRead16(e);
   if(((first+i)&&zone<=last)||e[2]>1||e[3])return 0;
   last=zone;
  }
  first+=n;
 }
 if(~outer!=in->outerCrc||~inner!=expected)return 0;
 in->count=(uint16_t)count;in->stride=(uint16_t)stride;return 1;
}
