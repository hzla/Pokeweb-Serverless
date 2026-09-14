#include <stddef.h>
extern "C" void* memcpy(void* dst,const void* src,size_t size) {
    auto* d=static_cast<unsigned char*>(dst);
    auto* s=static_cast<const unsigned char*>(src);
    for(size_t i=0;i<size;++i) d[i]=s[i];
    return dst;
}
extern "C" void* memset(void* dst,int value,size_t size) {
    auto* d=static_cast<unsigned char*>(dst);
    for(size_t i=0;i<size;++i) d[i]=static_cast<unsigned char>(value);
    return dst;
}
