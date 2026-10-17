#include "runtime.h"
namespace {
using namespace nuzlocke;
template<class F> F api(u32 w){
#ifdef GAME_B2
    if(w>=0x20191d8)w-=44;
#endif
    return reinterpret_cast<F>(w|1);
}
template<class F> F ov(u32 w){
#ifdef GAME_B2
    w-=64;
#endif
    return reinterpret_cast<F>(w|1);
}
struct Selection {u16 excluded;u8 count;};
Selection* active;
template<class T> T& field(const void* p,u32 offset){return *reinterpret_cast<T*>(const_cast<u8*>(static_cast<const u8*>(p))+offset);}
}
extern "C" u32 NuzlockeGenerate(const void* parameters,const u8* table,void* output){
    const u32 count=field<u8>(parameters,0x14);u8 excludedSpecies[MaskBytes];Selection current={};
    if(count&&count<=12&&snapshot(field<void*>(parameters,0),excludedSpecies)){
        current.count=u8(count);for(u32 i=0;i<count;++i)if(bit(excludedSpecies,half(table+i*4)&2047))current.excluded|=u16(1u<<i);
    }
    if(current.excluded&&current.excluded==u16((1u<<current.count)-1)){if(preventAll())return 0;current.excluded=0;}
    Selection* previous=active;active=current.excluded?&current:nullptr;
    const u32 result=ov<u32(*)(const void*,const u8*,void*)>(0x21a0c34)(parameters,table,output);
    active=previous;return result;
}
extern "C" u32 NuzlockeProbability(const u8* weights,u32 count){
    if(!active||count!=active->count)return ov<u32(*)(const u8*,u32)>(0x21a15ec)(weights,count);
    const u32 total=mass(weights,active->excluded,count);if(!total)return ov<u32(*)(const u8*,u32)>(0x21a15ec)(weights,count);
    return pick(weights,active->excluded,count,api<u32(*)(u32)>(0x2005784)(total));
}
extern "C" u32 NuzlockeUniform(u32 count){
    if(!active||count!=active->count)return ov<u32(*)(u32)>(0x21a1678)(count);
    const u32 total=mass(nullptr,active->excluded,count);if(!total)return ov<u32(*)(u32)>(0x21a1678)(count);
    return pick(nullptr,active->excluded,count,api<u32(*)(u32)>(0x2005748)(total));
}
extern "C" u32 NuzlockePreferred(const void* parameters,const u8* table,u32 type){
    if(!active)return ov<u32(*)(const void*,const u8*,u32)>(0x21a1384)(parameters,table,type);
    alignas(4) u8 copy[44],eligible[48];u8 indices[12];u32 count=0;
    for(u32 i=0;i<44;++i)copy[i]=static_cast<const u8*>(parameters)[i];
    for(u32 i=0;i<active->count;++i)if(!(active->excluded&(1u<<i))){indices[count]=u8(i);for(u32 j=0;j<4;++j)eligible[count*4+j]=table[i*4+j];++count;}
    copy[0x14]=u8(count);
    const u32 selected=ov<u32(*)(const void*,const u8*,u32)>(0x21a1384)(copy,eligible,type);
    return selected<count?indices[selected]:255;
}
