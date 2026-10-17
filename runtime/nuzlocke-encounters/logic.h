#pragma once
#include <stdint.h>
namespace nuzlocke {
using u8=uint8_t;using u16=uint16_t;using u32=uint32_t;
constexpr u32 SpeciesLimit=2048,NodeLimit=4096,MaskBytes=SpeciesLimit/8;
constexpr u32 ConfigMagic=0x455a554e;
inline bool bit(const u8* data,u32 id){return id<SpeciesLimit&&(data[id>>3]&(1u<<(id&7)));}
inline void set(u8* data,u32 id){if(id<SpeciesLimit)data[id>>3]|=u8(1u<<(id&7));}
inline u16 half(const u8* p){return u16(p[0]|u16(p[1])<<8);}
inline u32 word(const u8* p){return u32(half(p))|u32(half(p+2))<<16;}
inline u16 root(u16* parents,u16 id){
    u16 current=id;while(parents[current]!=current)current=parents[current];
    while(parents[id]!=id){const u16 next=parents[id];parents[id]=current;id=next;}
    return current;
}
inline void join(u16* parents,u16 a,u16 b){a=root(parents,a);b=root(parents,b);if(a!=b)parents[b]=a;}
inline u32 mass(const u8* weights,u16 excluded,u32 count){u32 sum=0;for(u32 i=0;i<count;++i)if(!(excluded&(1u<<i)))sum+=weights?weights[i]:1;return sum;}
inline u32 pick(const u8* weights,u16 excluded,u32 count,u32 roll){
    for(u32 i=0;i<count;++i)if(!(excluded&(1u<<i))){const u32 weight=weights?weights[i]:1;if(roll<weight)return i;roll-=weight;}
    return count;
}
inline bool configuration(const u8* data,u32 length){
    return length==20&&word(data)==ConfigMagic&&half(data+4)==1&&half(data+6)==20
        &&word(data+8)<=1&&word(data+12)<=1&&word(data+16)==(word(data+8)^word(data+12)^0xffffffffu);
}
}
