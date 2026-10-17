#pragma once
#include <stdint.h>
namespace pokenav {
// Same first-block UTF-16/9-bit representation used by the ROM text editor.
// Unusual multi-block banks stay on the native reader path.
inline bool cachedText(const uint8_t* data,uint32_t size,uint32_t id,uint16_t* out,uint32_t capacity){
    auto half=[](const uint8_t* p){return uint16_t(p[0]|uint16_t(p[1])<<8);};
    auto word=[&](const uint8_t* p){return uint32_t(half(p))|uint32_t(half(p+2))<<16;};
    if(!capacity||size<16||half(data)!=1||id>=half(data+2))return false;
    const uint32_t block=word(data+12),count=half(data+2);
    if(block>size-4)return false;
    const uint32_t length=word(data+block),table=4+count*8;
    if(length<table||length>size-block)return false;
    const uint8_t* entry=data+block+4+id*8;const uint32_t offset=word(entry),n=half(entry+4);
    if(offset<table||offset>length||n>(length-offset)/2||n>4096)return false;
    if(!n){out[0]=65535;return true;}
    const uint8_t* text=data+block+offset;uint16_t key=half(text+(n-1)*2)^65535;
    for(uint32_t i=1;i<n;++i)key=uint16_t((key>>3)|(key<<13));
    uint32_t used=0,acc=0,bits=0;bool compressed=false;
    for(uint32_t i=0;i<n;++i){const uint16_t c=half(text+i*2)^key;key=uint16_t((key<<3)|(key>>13));
        if(!i&&c==0xf100){compressed=true;continue;}
        if(!compressed){if(c==65535)break;if(used+1<capacity)out[used++]=c;}
        else{acc|=uint32_t(c)<<bits;bits+=16;while(bits>=9){const uint16_t v=acc&511;acc>>=9;bits-=9;if(v==511){out[used]=65535;return true;}if(used+1<capacity)out[used++]=v;}}
    }
    out[used]=65535;return true;
}
}
