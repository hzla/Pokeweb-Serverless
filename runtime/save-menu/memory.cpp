#include <stddef.h>
extern "C" void* memset(void* target,int value,size_t length){
    auto* bytes=static_cast<unsigned char*>(target);
    for(size_t i=0;i<length;++i)bytes[i]=static_cast<unsigned char>(value);
    return target;
}
extern "C" void* memcpy(void* target,const void* source,size_t length){
    auto* dst=static_cast<unsigned char*>(target);
    auto* src=static_cast<const unsigned char*>(source);
    for(size_t i=0;i<length;++i)dst[i]=src[i];
    return target;
}
