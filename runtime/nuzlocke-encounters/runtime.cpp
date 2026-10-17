#include "runtime.h"
namespace nuzlocke {
namespace {
template<class F> F api(u32 w){
#ifdef GAME_B2
    if(w>=0x20191d8)w-=44;
#endif
    return reinterpret_cast<F>(w|1);
}
void* allocate(u32 size){return api<void*(*)(u32,u32)>(0x2039dc8)(1,size);}
void release(void* p){if(p)api<void(*)(void*)>(0x203a278)(p);}
struct Cache {u16 parents[NodeLimit];u32 count;bool checked,enabled,prevent,ready;};
Cache cache;
struct Reader {
    u32 file[20],size,count,image,imageSize,fatAt,fatSize,dataAt,dataSize;bool opened;
    u8 fat[1024],data[4096];
    bool read(u32 offset,void* out,u32 length){return opened&&offset<=size&&length<=size-offset
        &&api<u32(*)(void*,u32,u32)>(0x2070e54)(file,offset,0)
        &&api<int(*)(void*,void*,u32)>(0x2070e6c)(file,out,length)==int(length);}
    bool window(u32 offset,u8* out,u32 length,bool table){
        if(offset>size||length>size-offset)return false;
        u8* buffer=table?fat:data;u32& at=table?fatAt:dataAt;u32& n=table?fatSize:dataSize;
        const u32 capacity=table?sizeof(fat):sizeof(data);
        if(length>capacity)return read(offset,out,length);
        if(offset<at||offset-at>n||length>n-(offset-at)){at=offset;n=size-at<capacity?size-at:capacity;if(!read(at,buffer,n)){n=0;return false;}}
        for(u32 i=0;i<length;++i)out[i]=buffer[offset-at+i];
        return true;
    }
    void close(){if(opened)api<u32(*)(void*)>(0x2070de0)(file);opened=false;}
    bool open(const char* path){
        close();fatAt=fatSize=dataAt=dataSize=0;count=image=imageSize=0;
        api<void(*)(void*)>(0x2070ca8)(file);opened=api<u32(*)(void*,const char*)>(0x2070ecc)(file,path)!=0;if(!opened)return false;
        size=api<u32(*)(void*)>(0x2070dec)(file);u8 h[16];
        if(size<44||size>2097152||!read(0,h,16)||word(h)!=0x4352414e||(word(h+4)!=0x0100fffe&&word(h+4)!=0x0001feff)
            ||word(h+8)!=size||half(h+12)!=16||half(h+14)!=3)return false;
        if(!read(16,h,12)||word(h)!=0x46415442)return false;
        const u32 fatLength=word(h+4);count=half(h+8);if(!count||count>NodeLimit||fatLength<12+count*8||fatLength>size-16)return false;
        u32 at=16+fatLength;if(!read(at,h,8)||word(h)!=0x464e5442||word(h+4)<8||word(h+4)>size-at)return false;
        at+=word(h+4);if(!read(at,h,8)||word(h)!=0x46494d47||word(h+4)<8||word(h+4)!=size-at)return false;
        image=at+8;imageSize=size-image;return true;
    }
    u32 member(u32 id,u8* out,u32 capacity,bool prefix=false){
        u8 h[8];if(!image||id>=count||!window(28+id*8,h,8,true))return 0;
        const u32 begin=word(h),end=word(h+4);if(begin>end||end>imageSize||begin==end||(!prefix&&end-begin>capacity))return 0;
        const u32 n=end-begin<capacity?end-begin:capacity;return window(image+begin,out,n,false)?n:0;
    }
};
bool modulePresent(){
    u32 file[20]={};api<void(*)(void*)>(0x2070ca8)(file);
#ifdef GAME_B2
    const char* name="rom:/patches/NuzlockeStyleEncountersB2.dll";
#else
    const char* name="rom:/patches/NuzlockeStyleEncountersW2.dll";
#endif
    if(!api<u32(*)(void*,const char*)>(0x2070ecc)(file,name))return false;
    u8 h[4];const bool ok=api<int(*)(void*,void*,u32)>(0x2070e6c)(file,h,4)==4&&word(h)==0x46584c44;
    api<u32(*)(void*)>(0x2070de0)(file);return ok;
}
bool prepare(){
    if(cache.checked)return cache.enabled&&cache.ready;
    auto* reader=static_cast<Reader*>(allocate(sizeof(Reader)));if(!reader)return false;
    *reader={};u8 bytes[192];bool valid=false;
    if(reader->open("rom:/nuzlocke/encounters.narc")&&reader->member(0,bytes,sizeof(bytes))==20&&configuration(bytes,20)){
        cache.enabled=word(bytes+8)!=0;cache.prevent=word(bytes+12)!=0;
        valid=true;
    }
    reader->close();
    if(!valid||!cache.enabled||!modulePresent()){cache.checked=true;cache.enabled=false;release(reader);return false;}
    if(reader->open("rom:/a/0/1/6")){
        cache.count=reader->count;
        for(u32 i=0;i<cache.count;++i)cache.parents[i]=u16(i);
        valid=true;
        for(u32 id=1;id<cache.count&&valid;++id){
            valid=reader->member(id,bytes,33,true)==33;if(!valid)break;
            const u32 first=half(bytes+28),forms=bytes[32];
            if(forms>1&&first&&first<cache.count&&forms-1<=cache.count-first)
                for(u32 f=0;f+1<forms;++f)join(cache.parents,u16(id),u16(first+f));
        }
    }else valid=false;
    reader->close();
    if(valid&&reader->open("rom:/a/0/1/9")&&reader->count>1&&reader->count<=cache.count){
        for(u32 id=1;id<reader->count&&valid;++id){
            const u32 n=reader->member(id,bytes,sizeof(bytes));valid=n!=0;
            for(u32 at=0;valid&&at<n;at+=6){if(n-at<6){valid=false;break;}const u32 target=half(bytes+at+4);if(half(bytes+at)&&target&&target<cache.count&&target<SpeciesLimit)join(cache.parents,u16(id),u16(target));}
        }
    }else valid=false;
    reader->close();release(reader);
    cache.ready=valid;cache.checked=valid;return valid;
}
}
bool preventAll(){return cache.prevent;}
bool snapshot(void* game,u8* excluded){
    if(!game||!excluded||!prepare())return false;
    void* save=api<void*(*)(void*)>(0x2017934)(game);if(!save)return false;
    void* dex=api<void*(*)(void*)>(0x200d184)(save);if(!dex)return false;
    u8 caughtRoots[NodeLimit/8]={};
    const u32 count=cache.count<SpeciesLimit?cache.count:SpeciesLimit;
    for(u32 id=1;id<count;++id)if(api<u32(*)(void*,u32)>(0x200d660)(dex,id)){
        const u32 family=root(cache.parents,u16(id));caughtRoots[family>>3]|=u8(1u<<(family&7));
    }
    for(u32 i=0;i<MaskBytes;++i)excluded[i]=0;
    for(u32 id=1;id<count;++id){const u32 family=root(cache.parents,u16(id));if(caughtRoots[family>>3]&(1u<<(family&7)))set(excluded,id);}
    return true;
}
}
